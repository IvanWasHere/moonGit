package gitexec

import "bytes"

// chunker accumulates bytes from a git process and releases them in pieces that
// are safe for the TypeScript parsers to consume.
//
// This is the whole reason streaming is workable. `git log` on a large history
// is hundreds of megabytes, so it has to be delivered incrementally — but if a
// chunk boundary lands in the middle of a record, the parser on the other side
// sees a truncated commit and either drops it or throws. So chunks are cut at
// the last record delimiter, never at an arbitrary byte offset, and the partial
// tail is carried into the next chunk.
//
// Callers set delim to the delimiter their format uses: 0x00 for `-z` output,
// '\n' for line-oriented output. A delim of 0 with rawOK means "no record
// structure, cut anywhere" (used for binary/patch payloads).
type chunker struct {
	delim byte
	raw   bool // true when there is no record structure to preserve
	max   int  // soft target size before a flush is attempted
	hard  int  // absolute cap; past this we flush even without a delimiter
	buf   []byte
}

const (
	defaultChunkSize = 64 << 10 // 64 KB
	// A single record longer than this is pathological (a commit message the
	// size of a novel, a one-line minified file). Flush anyway rather than
	// buffering without bound — a parser that chokes on it is a better outcome
	// than the app growing to consume all memory.
	hardChunkMultiple = 16
)

func newChunker(delim byte, raw bool, max int) *chunker {
	if max <= 0 {
		max = defaultChunkSize
	}
	return &chunker{
		delim: delim,
		raw:   raw,
		max:   max,
		hard:  max * hardChunkMultiple,
		buf:   make([]byte, 0, max*2),
	}
}

// write appends data and returns any chunks that are ready to emit.
func (c *chunker) write(p []byte) [][]byte {
	c.buf = append(c.buf, p...)

	var out [][]byte
	for len(c.buf) >= c.max {
		cut := c.cutPoint()
		if cut <= 0 {
			break
		}
		chunk := make([]byte, cut)
		copy(chunk, c.buf[:cut])
		out = append(out, chunk)
		c.buf = c.buf[cut:]
	}
	return out
}

// cutPoint returns how many bytes may be released, or 0 to keep buffering.
func (c *chunker) cutPoint() int {
	if c.raw {
		return c.max
	}
	// Cut just past the last delimiter inside the target window, so every
	// emitted chunk ends on a complete record.
	if idx := bytes.LastIndexByte(c.buf[:c.max], c.delim); idx >= 0 {
		return idx + 1
	}
	// No delimiter in the window. Look further before giving up — a single
	// record may legitimately exceed the target size.
	limit := min(len(c.buf), c.hard)
	if idx := bytes.LastIndexByte(c.buf[:limit], c.delim); idx >= 0 {
		return idx + 1
	}
	if len(c.buf) >= c.hard {
		return c.hard // pathological record; flush to bound memory
	}
	return 0
}

// flush returns whatever is left, including a trailing partial record.
func (c *chunker) flush() []byte {
	if len(c.buf) == 0 {
		return nil
	}
	out := make([]byte, len(c.buf))
	copy(out, c.buf)
	c.buf = c.buf[:0]
	return out
}
