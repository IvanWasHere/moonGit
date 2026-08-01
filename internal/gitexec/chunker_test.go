package gitexec

import (
	"bytes"
	"strings"
	"testing"
)

// The contract that matters: reassembling every emitted chunk must reproduce
// the input exactly, and no chunk may end mid-record.
func TestChunkerNeverSplitsRecords(t *testing.T) {
	const delim = byte(0x00)

	// Records of wildly different sizes, including some larger than the chunk
	// target, so the "record exceeds window" path is exercised.
	var input bytes.Buffer
	sizes := []int{1, 5, 100, 4000, 70000, 3, 250, 12000}
	for i := 0; i < 200; i++ {
		n := sizes[i%len(sizes)]
		input.Write(bytes.Repeat([]byte{byte('a' + i%26)}, n))
		input.WriteByte(delim)
	}

	ch := newChunker(delim, false, 8<<10)
	var got [][]byte
	// Feed in irregular writes — the reader never delivers tidy boundaries.
	src := input.Bytes()
	for off := 0; off < len(src); {
		step := min(1+(off%7919), len(src)-off)
		got = append(got, ch.write(src[off:off+step])...)
		off += step
	}
	if tail := ch.flush(); tail != nil {
		got = append(got, tail)
	}

	var rebuilt bytes.Buffer
	for i, c := range got {
		if len(c) == 0 {
			t.Fatalf("chunk %d is empty", i)
		}
		// Every chunk except possibly the last must end on a record boundary.
		if i < len(got)-1 && c[len(c)-1] != delim {
			t.Errorf("chunk %d ends mid-record (last byte %q)", i, c[len(c)-1])
		}
		rebuilt.Write(c)
	}

	if !bytes.Equal(rebuilt.Bytes(), input.Bytes()) {
		t.Fatalf("reassembled output differs: got %d bytes, want %d",
			rebuilt.Len(), input.Len())
	}
}

func TestChunkerRawModeCutsAnywhere(t *testing.T) {
	input := bytes.Repeat([]byte("x"), 200000)
	ch := newChunker(0, true, 1024)

	var got []byte
	for _, c := range ch.write(input) {
		if len(c) != 1024 {
			t.Errorf("raw chunk = %d bytes, want 1024", len(c))
		}
		got = append(got, c...)
	}
	got = append(got, ch.flush()...)

	if !bytes.Equal(got, input) {
		t.Fatalf("raw reassembly differs: %d vs %d bytes", len(got), len(input))
	}
}

// A record longer than the hard cap must still flush rather than buffer
// without bound — memory safety wins over parseability in the pathological case.
func TestChunkerFlushesPathologicalRecord(t *testing.T) {
	const maxSize = 1024
	ch := newChunker(0x00, false, maxSize)

	// One record far past hard (max * hardChunkMultiple), with no delimiter.
	huge := bytes.Repeat([]byte("y"), maxSize*hardChunkMultiple*2)
	chunks := ch.write(huge)

	if len(chunks) == 0 {
		t.Fatal("no chunks emitted; chunker buffered without bound")
	}
	total := 0
	for _, c := range chunks {
		total += len(c)
	}
	total += len(ch.flush())
	if total != len(huge) {
		t.Fatalf("lost data: emitted %d of %d bytes", total, len(huge))
	}
}

func TestChunkerLineDelimiter(t *testing.T) {
	input := strings.Repeat("a line of output\n", 5000)
	ch := newChunker('\n', false, 512)

	var got strings.Builder
	chunks := ch.write([]byte(input))
	for _, c := range chunks {
		if c[len(c)-1] != '\n' {
			t.Fatalf("chunk does not end on a newline: %q", c[len(c)-5:])
		}
		got.Write(c)
	}
	got.Write(ch.flush())

	if got.String() != input {
		t.Fatal("line-delimited reassembly differs from input")
	}
}
