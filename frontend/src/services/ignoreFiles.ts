/**
 * The two ignore files a repository has, and the text manipulation around them.
 *
 * Separate from the component because the interesting parts — where each file
 * lives, and whether a rule is already in one — are decidable without a DOM,
 * and because the file context menu's "Ignore by Name" needs the same
 * append-if-absent behaviour. One implementation, asserted once.
 */

import { readFile, writeFile } from './wails';

export type IgnoreFileId = 'repo' | 'local';

export interface IgnoreFile {
  readonly id: IgnoreFileId;
  readonly label: string;
  /** Path relative to the repository root. */
  readonly relative: string;
  readonly hint: string;
}

/**
 * `.gitignore` is committed and shared; `.git/info/exclude` is neither.
 *
 * Offering both is the point rather than completeness: "ignore this, but only
 * for me" is a real and frequent intention — a scratch directory, an editor's
 * droppings — and doing it in `.gitignore` means committing a rule that is
 * nobody else's business. There is a third layer, `core.excludesFile`, which is
 * the user's global one; it is deliberately absent because it is not part of
 * *this repository* and editing it from a repository panel would be a
 * surprising place to change every repository at once.
 */
export const IGNORE_FILES: readonly IgnoreFile[] = [
  {
    id: 'repo',
    label: '.gitignore',
    relative: '.gitignore',
    hint: 'Committed and shared with everyone who clones this repository.',
  },
  {
    id: 'local',
    label: '.git/info/exclude',
    relative: '.git/info/exclude',
    hint: 'Private to this clone. Never committed, never pushed.',
  },
];

export function ignoreFile(id: IgnoreFileId): IgnoreFile {
  return IGNORE_FILES.find((file) => file.id === id) ?? (IGNORE_FILES[0] as IgnoreFile);
}

/**
 * Read an ignore file, treating "there isn't one" as empty.
 *
 * A repository with no `.gitignore` is the normal starting state, not an error
 * to report — the editor should open on a blank file that saving will create.
 */
export async function readIgnoreFile(repoPath: string, id: IgnoreFileId): Promise<string> {
  try {
    const content = await readFile(`${repoPath}/${ignoreFile(id).relative}`);
    return content.text ?? '';
  } catch {
    return '';
  }
}

export function writeIgnoreFile(repoPath: string, id: IgnoreFileId, text: string): Promise<void> {
  return writeFile(`${repoPath}/${ignoreFile(id).relative}`, ensureTrailingNewline(text));
}

/**
 * A text file ends with a newline.
 *
 * Not pedantry here: git's own tooling, and every `>>` append anybody does from
 * a shell, assumes it. Saving a file whose last line has no terminator means
 * the next appended rule lands on the same line and silently changes it.
 */
export function ensureTrailingNewline(text: string): string {
  if (text === '') return '';
  return text.endsWith('\n') ? text : `${text}\n`;
}

/**
 * Add a rule unless it is already there, returning the new text or null.
 *
 * Read-modify-write rather than a blind append: an ignore file is
 * hand-maintained and read by people, and `*.log` appearing three times
 * because somebody right-clicked three log files is untidy in a way they will
 * have to clean up.
 *
 * Comparison ignores surrounding whitespace but nothing else — `!build` is not
 * `build`, and `/dist` is not `dist`. Both distinctions change what git does.
 */
export function addRule(text: string, rule: string): string | null {
  const trimmed = rule.trim();
  if (trimmed === '') return null;

  const present = text.split('\n').some((line) => line.trim() === trimmed);
  if (present) return null;

  const base = ensureTrailingNewline(text);
  return `${base}${trimmed}\n`;
}

/**
 * The rule a file's own name becomes.
 *
 * Anchored with a leading slash so it matches *this* file rather than every
 * file with that name anywhere in the tree — ignoring `src/config.ts` should
 * not also ignore `test/fixtures/config.ts`.
 */
export function ruleForPath(path: string): string {
  return `/${path}`;
}
