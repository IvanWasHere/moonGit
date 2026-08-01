package store

import (
	"path/filepath"
	"testing"
)

func openTemp(t *testing.T) *Service {
	t.Helper()
	s := New()
	if err := s.Open(filepath.Join(t.TempDir(), "test.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close() })
	return s
}

func TestExecAndQuery(t *testing.T) {
	s := openTemp(t)

	if _, err := s.Exec(`create table t (id integer primary key, name text, n real)`, nil); err != nil {
		t.Fatal(err)
	}
	res, err := s.Exec(`insert into t (name, n) values (?, ?)`, []any{"alpha", 1.5})
	if err != nil {
		t.Fatal(err)
	}
	if res.RowsAffected != 1 || res.LastInsertID != 1 {
		t.Fatalf("unexpected exec result: %+v", res)
	}

	q, err := s.Query(`select id, name, n from t`, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(q.Rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(q.Rows))
	}
	if got := q.Columns; got[0] != "id" || got[1] != "name" {
		t.Errorf("columns = %v", got)
	}
	// TEXT must come back as a string, not []byte — otherwise it would reach
	// the frontend base64-encoded.
	if _, ok := q.Rows[0][1].(string); !ok {
		t.Errorf("name column is %T, want string", q.Rows[0][1])
	}
}

func TestQueryEmptyResultIsNotNull(t *testing.T) {
	s := openTemp(t)
	if _, err := s.Exec(`create table t (id integer)`, nil); err != nil {
		t.Fatal(err)
	}
	q, err := s.Query(`select id from t`, nil)
	if err != nil {
		t.Fatal(err)
	}
	// An empty slice serialises as [], a nil slice as null. The frontend should
	// never have to guard against null here.
	if q.Rows == nil {
		t.Error("Rows is nil; it should be an empty slice")
	}
}

func TestExecBatchIsAtomic(t *testing.T) {
	s := openTemp(t)
	if _, err := s.Exec(`create table t (id integer primary key)`, nil); err != nil {
		t.Fatal(err)
	}

	_, err := s.ExecBatch([]Statement{
		{SQL: `insert into t (id) values (1)`},
		{SQL: `insert into t (id) values (2)`},
		{SQL: `insert into this_table_does_not_exist (id) values (3)`},
	})
	if err == nil {
		t.Fatal("expected the batch to fail")
	}

	q, qErr := s.Query(`select count(*) from t`, nil)
	if qErr != nil {
		t.Fatal(qErr)
	}
	if n := q.Rows[0][0]; n != int64(0) {
		t.Errorf("rolled-back batch left %v rows; the transaction was not atomic", n)
	}
}

func TestExecBatchCommits(t *testing.T) {
	s := openTemp(t)
	if _, err := s.Exec(`create table t (id integer primary key)`, nil); err != nil {
		t.Fatal(err)
	}
	res, err := s.ExecBatch([]Statement{
		{SQL: `insert into t (id) values (?)`, Args: []any{1}},
		{SQL: `insert into t (id) values (?)`, Args: []any{2}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.RowsAffected != 2 {
		t.Errorf("RowsAffected = %d, want 2", res.RowsAffected)
	}
}

func TestQueryOnClosedDB(t *testing.T) {
	s := New()
	if _, err := s.Query(`select 1`, nil); err == nil {
		t.Fatal("expected an error when the database is not open")
	}
}

// FTS5 decides whether commit search gets a real index or a LIKE fallback
// (PLAN.md §1.2). This records which one this build actually supports.
func TestFTS5Availability(t *testing.T) {
	s := openTemp(t)
	info := s.Info()

	t.Logf("sqlite %s, FTS5=%v, journal=%s", info.Version, info.HasFTS5, info.JournalMode)

	if !info.Open {
		t.Fatal("database reports itself closed after Open")
	}
	if info.Version == "" {
		t.Error("no sqlite version reported")
	}
	if !info.HasFTS5 {
		t.Log("NOTE: FTS5 unavailable — commit search must use the LIKE fallback")
	}
}

func TestWALEnabled(t *testing.T) {
	s := openTemp(t)
	if mode := s.Info().JournalMode; mode != "wal" {
		t.Errorf("journal_mode = %q, want wal (writes would block reads)", mode)
	}
}
