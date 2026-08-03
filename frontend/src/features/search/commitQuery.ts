/**
 * The Journal search box: a typed query string turned into `git log` flags.
 *
 * The whole design question here is what a bare word means. `git log --grep`
 * takes a *regular expression* and ORs multiple patterns together, so the
 * literal reading of "fix parser" is "commits matching /fix/ or /parser/" —
 * which is not what anyone typing two words into a search box wants, and gets
 * stranger the moment they search for a version number or a filename and `.`
 * starts matching everything.
 *
 * So the defaults invert git's: terms are **fixed strings**, matched
 * **case-insensitively**, and **ANDed** (`--all-match`). Regular expressions
 * are still reachable, by writing the term as `/…/` — explicit, and visible in
 * the query itself rather than hidden in a settings toggle.
 *
 * Qualifiers borrow the syntax every code host has trained people on:
 *
 *     fix parser              message contains "fix" AND "parser"
 *     author:ivan             author matches ivan
 *     author:"Ivan M"         quoted, for values with spaces
 *     path:src/git file:log   limited to paths matching either
 *     since:"2 weeks ago"     git's own approxidate
 *     /parse.*error/          a real regex
 *
 * An unrecognised `key:value` is **not an error** — it is searched as text.
 * `TODO:refactor` is a plausible thing to look for in a commit message, and a
 * search box that rejects input is worse than one that takes it literally. The
 * chips above the results are what tell the user which parts were understood.
 */

import type { CommitSearchParams } from '@/services/git';

/** A pattern and whether the user asked for it to be read as a regex. */
export interface Pattern {
  readonly text: string;
  readonly isRegex: boolean;
}

export interface CommitQuery {
  /** Message patterns, ANDed together. */
  readonly message: readonly Pattern[];
  readonly author: Pattern | null;
  /** Pathspecs, ORed by git. */
  readonly paths: readonly string[];
  /** Passed to git verbatim — it parses "2 weeks ago" better than we would. */
  readonly since: string | null;
  readonly until: string | null;
  /** Nothing to filter on: the query was blank or only whitespace. */
  readonly isEmpty: boolean;
}

/** Aliases, so the user does not have to remember which word we picked. */
const QUALIFIERS: Readonly<Record<string, 'author' | 'path' | 'since' | 'until' | 'message'>> = {
  author: 'author',
  by: 'author',
  path: 'path',
  file: 'path',
  in: 'path',
  since: 'since',
  after: 'since',
  until: 'until',
  before: 'until',
  message: 'message',
  msg: 'message',
};

interface Token {
  /**
   * The text before the colon **as typed**, or null for a bare term.
   *
   * Not lowercased here: an unrecognised qualifier is searched as literal text
   * (see the header), and folding the case first would turn a search for
   * `TODO:refactor` into one for `todo:refactor`. Lowercasing happens at the
   * lookup instead, where it is only about matching a qualifier name.
   */
  readonly key: string | null;
  readonly value: string;
  /** True when the value was quoted — which suppresses qualifier splitting. */
  readonly quoted: boolean;
}

/**
 * Split on whitespace, but keep quoted runs together.
 *
 * The quote can open *after* the colon (`author:"Ivan M"`), so this cannot be
 * a split-then-parse: the tokenizer has to know it is mid-token when it meets
 * the quote. An unterminated quote runs to the end of the input rather than
 * failing — the user is still typing it.
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let current = '';
  let key: string | null = null;
  let quoted = false;
  let inQuotes = false;

  const flush = () => {
    if (current !== '' || key !== null) {
      tokens.push({ key, value: current, quoted });
    }
    current = '';
    key = null;
    quoted = false;
  };

  for (const char of input) {
    if (char === '"') {
      inQuotes = !inQuotes;
      // Remember that this token was quoted even after the closing quote, so
      // `path:"a b"` keeps its space and `"a:b"` stays literal text.
      if (inQuotes) quoted = true;
      continue;
    }
    if (!inQuotes && /\s/.test(char)) {
      flush();
      continue;
    }
    // The first colon of an unquoted token separates qualifier from value.
    // Later colons belong to the value — `since:2026-01-02T10:00` is one date.
    if (char === ':' && !inQuotes && !quoted && key === null && current !== '') {
      key = current;
      current = '';
      continue;
    }
    current += char;
  }
  flush();
  return tokens;
}

/** `/…/` marks a regex; anything else is a literal. */
function toPattern(value: string): Pattern {
  if (value.length >= 2 && value.startsWith('/') && value.endsWith('/')) {
    return { text: value.slice(1, -1), isRegex: true };
  }
  return { text: value, isRegex: false };
}

/**
 * A pathspec for a value the user typed.
 *
 * A bare word is wrapped in wildcards, because `file:log` should find
 * `src/services/git/parsers/log.ts` — a search box that only accepted full
 * paths would be a worse version of typing the path. Git's wildcards match `/`
 * as well, so one `*` on each side is enough to reach any depth, and the
 * `:(icase)` magic keeps it consistent with the case-insensitive text match.
 *
 * A value that already contains a slash or a wildcard is passed through
 * untouched — at that point the user is writing a pathspec, not a word.
 */
function toPathspec(value: string): string {
  if (value.includes('/') || value.includes('*') || value.startsWith(':')) return value;
  return `:(icase)*${value}*`;
}

export function parseCommitQuery(input: string): CommitQuery {
  const message: Pattern[] = [];
  const paths: string[] = [];
  let author: Pattern | null = null;
  let since: string | null = null;
  let until: string | null = null;

  for (const token of tokenize(input)) {
    if (token.value === '') continue;
    const qualifier = token.key === null ? null : QUALIFIERS[token.key.toLowerCase()];

    // `foo:bar` with an unknown qualifier is text, colon and all — see the
    // header. Same for anything the user quoted.
    if (token.key !== null && qualifier === undefined) {
      message.push(toPattern(`${token.key}:${token.value}`));
      continue;
    }

    switch (qualifier) {
      case 'author':
        author = toPattern(token.value);
        break;
      case 'path':
        paths.push(toPathspec(token.value));
        break;
      case 'since':
        since = token.value;
        break;
      case 'until':
        until = token.value;
        break;
      default:
        message.push(toPattern(token.value));
        break;
    }
  }

  return {
    message,
    author,
    paths,
    since,
    until,
    isEmpty:
      message.length === 0 &&
      author === null &&
      paths.length === 0 &&
      since === null &&
      until === null,
  };
}

/** Escape a literal so an extended-regexp git run still matches it verbatim. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Turn a parsed query into `git log` arguments.
 *
 * **The pattern type is one flag for the whole command**, not one per pattern:
 * `--fixed-strings` and `--extended-regexp` both apply to every limiting
 * pattern git was given, including `--author`. So a query mixing a literal and
 * a regex cannot be expressed as-is — it has to pick extended-regexp and
 * escape the literals into it. Getting this backwards would silently turn
 * `fix v1.2` into a pattern where `.` matches any character.
 */
export function toLogParams(query: CommitQuery): CommitSearchParams {
  if (query.isEmpty) return {};

  const patterns = [...query.message, ...(query.author === null ? [] : [query.author])];
  const useRegex = patterns.some((pattern) => pattern.isRegex);
  const render = (pattern: Pattern): string =>
    useRegex && !pattern.isRegex ? escapeRegex(pattern.text) : pattern.text;

  const grep = query.message.map(render);

  return {
    patternType: useRegex ? 'extended' : 'fixed',
    ignoreCase: true,
    ...(grep.length > 0 && { grep }),
    // Only meaningful with more than one pattern, and git ignores it otherwise
    // — but sending it unconditionally keeps the AND rule in one place.
    ...(grep.length > 1 && { allMatch: true }),
    ...(query.author !== null && { author: render(query.author) }),
    ...(query.paths.length > 0 && { paths: query.paths }),
    ...(query.since !== null && { since: query.since }),
    ...(query.until !== null && { until: query.until }),
  };
}

/** Label for each recognised part of the query, for the chips under the box. */
export function describeQuery(query: CommitQuery): string[] {
  const chips: string[] = [];
  for (const pattern of query.message) {
    chips.push(pattern.isRegex ? `message ~ /${pattern.text}/` : `message: ${pattern.text}`);
  }
  if (query.author !== null) chips.push(`author: ${query.author.text}`);
  for (const path of query.paths) chips.push(`path: ${path}`);
  if (query.since !== null) chips.push(`since: ${query.since}`);
  if (query.until !== null) chips.push(`until: ${query.until}`);
  return chips;
}
