package fsapi

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteFileIsAtomicAndPreservesMode(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "sub", "file.txt")
	s := New()

	if err := s.WriteFile(path, "first"); err != nil {
		t.Fatal(err)
	}
	// Parent directories are created on demand.
	if got, _ := os.ReadFile(path); string(got) != "first" {
		t.Fatalf("content = %q", got)
	}

	// An executable file must not silently become non-executable on rewrite —
	// this API is used for conflict resolution on real working-tree files.
	if err := os.Chmod(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := s.WriteFile(path, "second"); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if perm := fi.Mode().Perm(); perm != 0o755 {
		t.Errorf("mode = %v, want 0755 (mode was not preserved)", perm)
	}

	// No temp files may be left behind.
	entries, _ := os.ReadDir(filepath.Dir(path))
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".moongit-") {
			t.Errorf("temp file %q was left behind", e.Name())
		}
	}
}

func TestReadFileDetectsBinary(t *testing.T) {
	dir := t.TempDir()
	s := New()

	textPath := filepath.Join(dir, "a.txt")
	if err := os.WriteFile(textPath, []byte("hello\nworld\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	text, err := s.ReadFile(textPath)
	if err != nil {
		t.Fatal(err)
	}
	if text.IsBinary || text.Text != "hello\nworld\n" {
		t.Errorf("text file misread: %+v", text)
	}

	binPath := filepath.Join(dir, "b.bin")
	if err := os.WriteFile(binPath, []byte{0x89, 0x50, 0x00, 0x4e, 0x47}, 0o644); err != nil {
		t.Fatal(err)
	}
	bin, err := s.ReadFile(binPath)
	if err != nil {
		t.Fatal(err)
	}
	if !bin.IsBinary {
		t.Error("NUL-containing file was not detected as binary")
	}
	if bin.Base64 == "" {
		t.Error("binary file returned no base64 payload")
	}
	if decoded, _ := base64.StdEncoding.DecodeString(bin.Base64); len(decoded) != 5 {
		t.Errorf("base64 decoded to %d bytes, want 5", len(decoded))
	}
}

// Invalid UTF-8 cannot survive the JSON bridge, so it must be treated as binary
// even without a NUL byte.
func TestReadFileTreatsInvalidUTF8AsBinary(t *testing.T) {
	path := filepath.Join(t.TempDir(), "latin1.txt")
	if err := os.WriteFile(path, []byte{0x48, 0xe9, 0x6c, 0x6c, 0x6f}, 0o644); err != nil {
		t.Fatal(err)
	}
	got, err := New().ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !got.IsBinary {
		t.Error("invalid UTF-8 was returned as text; it would be mangled in transit")
	}
}

func TestReadFileRejectsDirectory(t *testing.T) {
	if _, err := New().ReadFile(t.TempDir()); err == nil {
		t.Fatal("expected an error when reading a directory")
	}
}

func TestListDirSortsDirectoriesFirst(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{"zeta.txt", "alpha.txt"} {
		if err := os.WriteFile(filepath.Join(dir, name), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"zdir", "adir"} {
		if err := os.Mkdir(filepath.Join(dir, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}

	entries, err := New().ListDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"adir", "zdir", "alpha.txt", "zeta.txt"}
	if len(entries) != len(want) {
		t.Fatalf("got %d entries, want %d", len(entries), len(want))
	}
	for i, w := range want {
		if entries[i].Name != w {
			t.Errorf("entry %d = %q, want %q", i, entries[i].Name, w)
		}
	}
}
