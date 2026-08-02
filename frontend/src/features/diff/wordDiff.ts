/**
 * Intra-line ("word") diff between a paired deletion and addition.
 *
 * Git gives us whole changed lines and nothing finer. When a line changed by
 * one identifier, colouring all of it red and all of it green makes the reader
 * find the difference by eye; marking the tokens that actually moved is the
 * whole value of a diff viewer over `git diff` in a terminal.
 *
 * Three guards keep this from being a performance trap, because it runs on
 * every rendered change row:
 *
 * 1. **Long lines are skipped.** LCS is O(n·m); a minified bundle on one line
 *    would hang the renderer. Over `MAX_LINE_CHARS`, the pair renders plainly.
 * 2. **Common prefixes and suffixes are trimmed before the DP runs.** On a
 *    typical edit that leaves a handful of tokens in the middle, so the
 *    quadratic part almost never sees the full line.
 * 3. **Dissimilar pairs return null.** Two lines that share almost nothing were
 *    not "edited" — one was replaced. Marking every token as changed is noise
 *    that reads as a bug, so the pair falls back to whole-line colouring.
 */

export interface WordSegment {
  readonly text: string;
  /** True when this run is the part that differs from the other side. */
  readonly changed: boolean;
}

export interface WordDiff {
  readonly oldSegments: readonly WordSegment[];
  readonly newSegments: readonly WordSegment[];
}

/** Beyond this, the pair is rendered without intra-line marks. */
const MAX_LINE_CHARS = 1000;

/** Ceiling on the DP after affixes are trimmed. */
const MAX_MIDDLE_TOKENS = 200;

/**
 * Below this share of characters in common, the lines are treated as unrelated.
 * 0.25 was chosen against real patches: a renamed variable stays far above it,
 * a rewritten line falls well below.
 */
const MIN_SIMILARITY = 0.25;

/**
 * Identifiers, whitespace runs, and single punctuation characters.
 *
 * Splitting on `\b` would break `foo_bar` and `$el` apart; splitting on
 * whitespace alone would hide a changed argument inside `f(a,b)`. Unicode
 * classes rather than `\w` so a diff of non-ASCII identifiers behaves.
 */
const TOKEN = /[\p{L}\p{N}_$]+|\s+|[^\p{L}\p{N}_$\s]/gu;

export function tokenize(text: string): string[] {
  return text.match(TOKEN) ?? [];
}

/** Longest common subsequence of two token runs, as a pair of keep-masks. */
function lcsMasks(a: readonly string[], b: readonly string[]): [boolean[], boolean[]] {
  const rows = a.length;
  const cols = b.length;
  // (rows+1) × (cols+1), flattened — one allocation instead of rows+1 of them.
  const table = new Uint16Array((rows + 1) * (cols + 1));

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      const here = i * (cols + 1) + j;
      table[here] =
        a[i] === b[j]
          ? (table[here + cols + 2] ?? 0) + 1
          : Math.max(table[here + cols + 1] ?? 0, table[here + 1] ?? 0);
    }
  }

  const keepA = new Array<boolean>(rows).fill(false);
  const keepB = new Array<boolean>(cols).fill(false);
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    const here = i * (cols + 1) + j;
    if (a[i] === b[j]) {
      keepA[i] = true;
      keepB[j] = true;
      i += 1;
      j += 1;
    } else if ((table[here + cols + 1] ?? 0) >= (table[here + 1] ?? 0)) {
      i += 1;
    } else {
      j += 1;
    }
  }

  return [keepA, keepB];
}

/** Collapse a token list plus keep-mask into runs of same-flag text. */
function toSegments(tokens: readonly string[], keep: readonly boolean[]): WordSegment[] {
  const segments: WordSegment[] = [];
  for (const [index, token] of tokens.entries()) {
    const changed = keep[index] !== true;
    const last = segments[segments.length - 1];
    if (last !== undefined && last.changed === changed) {
      segments[segments.length - 1] = { text: last.text + token, changed };
    } else {
      segments.push({ text: token, changed });
    }
  }
  return segments;
}

/**
 * Refine one deletion/addition pair, or return null to render it plainly.
 *
 * Null is a real answer, not a failure: "these two lines have nothing in
 * common" is information, and the caller shows the ordinary red/green rows.
 */
export function wordDiff(oldText: string, newText: string): WordDiff | null {
  if (oldText === '' || newText === '') return null;
  if (oldText === newText) return null;
  if (oldText.length > MAX_LINE_CHARS || newText.length > MAX_LINE_CHARS) return null;

  const oldTokens = tokenize(oldText);
  const newTokens = tokenize(newText);

  // Trim the identical head and tail — the cheap part, and usually most of it.
  let head = 0;
  while (
    head < oldTokens.length &&
    head < newTokens.length &&
    oldTokens[head] === newTokens[head]
  ) {
    head += 1;
  }
  let tail = 0;
  while (
    tail < oldTokens.length - head &&
    tail < newTokens.length - head &&
    oldTokens[oldTokens.length - 1 - tail] === newTokens[newTokens.length - 1 - tail]
  ) {
    tail += 1;
  }

  const oldMiddle = oldTokens.slice(head, oldTokens.length - tail);
  const newMiddle = newTokens.slice(head, newTokens.length - tail);
  if (oldMiddle.length > MAX_MIDDLE_TOKENS || newMiddle.length > MAX_MIDDLE_TOKENS) return null;

  const [keepOldMiddle, keepNewMiddle] =
    oldMiddle.length === 0 || newMiddle.length === 0
      ? [
          new Array<boolean>(oldMiddle.length).fill(false),
          new Array<boolean>(newMiddle.length).fill(false),
        ]
      : lcsMasks(oldMiddle, newMiddle);

  const affix = (length: number) => new Array<boolean>(length).fill(true);
  const keepOld = [...affix(head), ...keepOldMiddle, ...affix(tail)];
  const keepNew = [...affix(head), ...keepNewMiddle, ...affix(tail)];

  // Similarity is measured in characters, not tokens: a line differing by one
  // long string literal shares most of its tokens but almost none of its text.
  let common = 0;
  for (const [index, token] of oldTokens.entries()) {
    if (keepOld[index] === true) common += token.length;
  }
  if (common / Math.max(oldText.length, newText.length) < MIN_SIMILARITY) return null;

  return {
    oldSegments: toSegments(oldTokens, keepOld),
    newSegments: toSegments(newTokens, keepNew),
  };
}
