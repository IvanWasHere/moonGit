// Package fsapi exposes file reads and writes the frontend cannot do itself.
//
// It is intentionally a thin wrapper over os. Deciding *which* file to read is
// business logic and lives in TypeScript.
package fsapi

import (
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"unicode/utf8"
)

// A read has to be bounded somewhere. Anything past this is a file the diff
// viewer will refuse to render anyway (PLAN.md §9 "large file support"), so
// failing with a clear error beats pulling a gigabyte through the Wails bridge
// and hanging the UI.
const MaxReadBytes = 32 << 20 // 32 MB

type FileInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	IsDir   bool   `json:"isDir"`
	ModTime int64  `json:"modTime"` // unix millis
	Mode    string `json:"mode"`
}

// FileContent carries a file's bytes plus enough metadata for the frontend to
// decide how to render it.
type FileContent struct {
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	Text     string `json:"text,omitempty"`
	Base64   string `json:"base64,omitempty"`
	IsBinary bool   `json:"isBinary"`
	Truncate bool   `json:"truncated"`
}

type Service struct{}

func New() *Service { return &Service{} }

// ReadFile returns a file as text, or reports it as binary.
//
// Binary detection matches git's own heuristic — a NUL byte in the leading
// block — so the frontend's idea of "binary" agrees with what git will do in a
// diff. Invalid UTF-8 also counts, since it cannot survive the JSON bridge.
func (s *Service) ReadFile(path string) (FileContent, error) {
	fi, err := os.Stat(path)
	if err != nil {
		return FileContent{}, err
	}
	if fi.IsDir() {
		return FileContent{}, fmt.Errorf("%s is a directory", path)
	}

	f, err := os.Open(path)
	if err != nil {
		return FileContent{}, err
	}
	defer f.Close()

	limit := fi.Size()
	truncated := false
	if limit > MaxReadBytes {
		limit, truncated = MaxReadBytes, true
	}

	buf := make([]byte, limit)
	n, err := f.Read(buf)
	if err != nil && n == 0 && limit > 0 {
		return FileContent{}, err
	}
	buf = buf[:n]

	out := FileContent{Path: path, Size: fi.Size(), Truncate: truncated}
	if isBinary(buf) {
		out.IsBinary = true
		out.Base64 = base64.StdEncoding.EncodeToString(buf)
		return out, nil
	}
	out.Text = string(buf)
	return out, nil
}

// ReadFileBase64 returns raw bytes, for image diffs and anything else the
// frontend needs to hand to the browser as a data URI.
func (s *Service) ReadFileBase64(path string) (FileContent, error) {
	fi, err := os.Stat(path)
	if err != nil {
		return FileContent{}, err
	}
	if fi.Size() > MaxReadBytes {
		return FileContent{}, fmt.Errorf("file is %d bytes, over the %d limit", fi.Size(), MaxReadBytes)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return FileContent{}, err
	}
	return FileContent{
		Path:     path,
		Size:     fi.Size(),
		Base64:   base64.StdEncoding.EncodeToString(b),
		IsBinary: true,
	}, nil
}

// WriteFile writes text to a file, creating parent directories as needed.
//
// The write goes to a temporary file in the same directory and is then renamed
// over the target. A crash mid-write therefore leaves the original intact
// rather than a half-written file — this API is used for conflict resolution,
// where truncating the user's file would mean real data loss.
func (s *Service) WriteFile(path string, contents string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	perm := os.FileMode(0o644)
	if fi, err := os.Stat(path); err == nil {
		perm = fi.Mode().Perm() // preserve the existing mode
	}

	tmp, err := os.CreateTemp(dir, ".moongit-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName) // no-op once the rename succeeds

	if _, err := tmp.WriteString(contents); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmpName, perm); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

// DeletePath removes a file, or an empty directory.
//
// Not recursive, on purpose. A recursive delete reachable from the frontend is
// one wrong path away from removing a working tree, and nothing in the UI
// needs it: deleting a tracked file goes through `git rm`, and the one case
// this serves is an untracked file the user asked to delete. A non-empty
// directory comes back as an error the UI can show rather than a surprise.
func (s *Service) DeletePath(path string) error {
	if _, err := os.Lstat(path); err != nil {
		return err
	}
	return os.Remove(path)
}

func (s *Service) Stat(path string) (FileInfo, error) {
	fi, err := os.Stat(path)
	if err != nil {
		return FileInfo{}, err
	}
	return toFileInfo(path, fi), nil
}

func (s *Service) Exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// ListDir returns a directory's entries, directories first then names, so the
// frontend does not have to re-sort for the file explorer.
func (s *Service) ListDir(path string) ([]FileInfo, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	out := make([]FileInfo, 0, len(entries))
	for _, e := range entries {
		fi, err := e.Info()
		if err != nil {
			continue // vanished between ReadDir and Info; skip it
		}
		out = append(out, toFileInfo(filepath.Join(path, e.Name()), fi))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].IsDir != out[j].IsDir {
			return out[i].IsDir
		}
		return out[i].Name < out[j].Name
	})
	return out, nil
}

// HomeDir is used to seed native dialogs and expand ~ in settings.
func (s *Service) HomeDir() (string, error) {
	return os.UserHomeDir()
}

func toFileInfo(path string, fi os.FileInfo) FileInfo {
	return FileInfo{
		Name:    fi.Name(),
		Path:    path,
		Size:    fi.Size(),
		IsDir:   fi.IsDir(),
		ModTime: fi.ModTime().UnixMilli(),
		Mode:    fi.Mode().String(),
	}
}

// isBinary mirrors git's heuristic: a NUL byte within the first 8000 bytes.
func isBinary(b []byte) bool {
	head := b
	if len(head) > 8000 {
		head = head[:8000]
	}
	for _, c := range head {
		if c == 0 {
			return true
		}
	}
	// Text that is not valid UTF-8 cannot cross the JSON bridge intact.
	return len(b) > 0 && !utf8.Valid(b)
}
