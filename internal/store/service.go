// Package store is a SQL pipe to a local SQLite database.
//
// It deliberately knows nothing about the schema. There are no tables named
// here, no migrations, no models — those live in TypeScript (PLAN.md §1.2).
// Go's only job is to own the file handle and pass statements through, which
// keeps persistence logic in the same language as the rest of the app.
package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	_ "modernc.org/sqlite" // pure-Go driver: no CGO, so universal builds stay simple
)

const appDirName = "moonGit"
const dbFileName = "moongit.db"

type Service struct {
	mu   sync.RWMutex
	db   *sql.DB
	path string
}

func New() *Service { return &Service{} }

// Startup opens the database, creating the application support directory if
// needed. A failure here is reported rather than fatal: the app is still usable
// without persisted preferences, and refusing to launch over a settings store
// would be a poor trade.
func (s *Service) Startup(_ context.Context) error {
	path, err := defaultDBPath()
	if err != nil {
		return err
	}
	return s.Open(path)
}

func (s *Service) Open(path string) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}

	// WAL keeps reads from blocking writes, which matters because layout state
	// is written on every resizer drag while queries are still running.
	dsn := path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return err
	}
	if err := db.Ping(); err != nil {
		return fmt.Errorf("opening %s: %w", path, err)
	}

	s.mu.Lock()
	if s.db != nil {
		_ = s.db.Close()
	}
	s.db, s.path = db, path
	s.mu.Unlock()
	return nil
}

func (s *Service) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.db == nil {
		return nil
	}
	err := s.db.Close()
	s.db = nil
	return err
}

// DBInfo reports where the database lives and what it supports.
type DBInfo struct {
	Path        string `json:"path"`
	Open        bool   `json:"open"`
	Version     string `json:"version"`
	HasFTS5     bool   `json:"hasFts5"`
	PageCount   int64  `json:"pageCount"`
	SizeOnDisk  int64  `json:"sizeOnDisk"`
	JournalMode string `json:"journalMode"`
}

// Info is also how the frontend learns whether FTS5 is available, which decides
// between a real full-text commit index and a plain LIKE fallback (PLAN.md §1.2).
func (s *Service) Info() DBInfo {
	s.mu.RLock()
	db, path := s.db, s.path
	s.mu.RUnlock()

	info := DBInfo{Path: path, Open: db != nil}
	if db == nil {
		return info
	}
	_ = db.QueryRow("select sqlite_version()").Scan(&info.Version)
	_ = db.QueryRow("pragma page_count").Scan(&info.PageCount)
	_ = db.QueryRow("pragma journal_mode").Scan(&info.JournalMode)
	if fi, err := os.Stat(path); err == nil {
		info.SizeOnDisk = fi.Size()
	}
	// The only reliable probe is to try building one.
	if _, err := db.Exec(`create virtual table if not exists __fts_probe using fts5(x)`); err == nil {
		info.HasFTS5 = true
		_, _ = db.Exec(`drop table if exists __fts_probe`)
	}
	return info
}

// QueryResult is a column-oriented result set. Rows are [][]any so a row with
// mixed types survives JSON without the frontend needing per-table structs.
type QueryResult struct {
	Columns []string `json:"columns"`
	Rows    [][]any  `json:"rows"`
}

// Query runs a SELECT. Arguments are always bound, never interpolated.
func (s *Service) Query(query string, args []any) (QueryResult, error) {
	db, err := s.handle()
	if err != nil {
		return QueryResult{}, err
	}

	rows, err := db.Query(query, args...)
	if err != nil {
		return QueryResult{}, err
	}
	defer rows.Close()

	cols, err := rows.Columns()
	if err != nil {
		return QueryResult{}, err
	}

	out := QueryResult{Columns: cols, Rows: [][]any{}}
	for rows.Next() {
		scan := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range scan {
			ptrs[i] = &scan[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return QueryResult{}, err
		}
		for i, v := range scan {
			// []byte would arrive in JSON as a base64 string; SQLite hands back
			// TEXT this way, so convert to something the frontend can use.
			if b, ok := v.([]byte); ok {
				scan[i] = string(b)
			}
		}
		out.Rows = append(out.Rows, scan)
	}
	return out, rows.Err()
}

// ExecResult reports the effect of a write.
type ExecResult struct {
	RowsAffected int64 `json:"rowsAffected"`
	LastInsertID int64 `json:"lastInsertId"`
}

func (s *Service) Exec(query string, args []any) (ExecResult, error) {
	db, err := s.handle()
	if err != nil {
		return ExecResult{}, err
	}
	res, err := db.Exec(query, args...)
	if err != nil {
		return ExecResult{}, err
	}
	affected, _ := res.RowsAffected()
	lastID, _ := res.LastInsertId()
	return ExecResult{RowsAffected: affected, LastInsertID: lastID}, nil
}

// Statement is one entry in a batch.
type Statement struct {
	SQL  string `json:"sql"`
	Args []any  `json:"args,omitempty"`
}

// ExecBatch runs statements in a single transaction, rolling back entirely on
// the first failure.
//
// This exists because migrations and multi-table writes must be atomic, and
// issuing them as separate Exec calls over the Wails bridge could not be — a
// crash between two calls would leave the schema half-applied.
func (s *Service) ExecBatch(statements []Statement) (ExecResult, error) {
	db, err := s.handle()
	if err != nil {
		return ExecResult{}, err
	}
	if len(statements) == 0 {
		return ExecResult{}, nil
	}

	tx, err := db.Begin()
	if err != nil {
		return ExecResult{}, err
	}
	defer func() { _ = tx.Rollback() }() // no-op after a successful Commit

	var total ExecResult
	for i, st := range statements {
		if strings.TrimSpace(st.SQL) == "" {
			continue
		}
		res, err := tx.Exec(st.SQL, st.Args...)
		if err != nil {
			return ExecResult{}, fmt.Errorf("statement %d (%.60s): %w", i, st.SQL, err)
		}
		affected, _ := res.RowsAffected()
		total.RowsAffected += affected
		total.LastInsertID, _ = res.LastInsertId()
	}
	if err := tx.Commit(); err != nil {
		return ExecResult{}, err
	}
	return total, nil
}

func (s *Service) handle() (*sql.DB, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.db == nil {
		return nil, errors.New("database is not open")
	}
	return s.db, nil
}

func defaultDBPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	// ~/Library/Application Support/moonGit on macOS; os.UserConfigDir handles
	// the equivalent elsewhere.
	base, err := os.UserConfigDir()
	if err != nil {
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, appDirName, dbFileName), nil
}
