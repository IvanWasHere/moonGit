/**
 * Deciding whether a git invocation mutates the repository.
 *
 * This drives the read/write choice in `RepoLock`, so the failure modes are
 * asymmetric and the design follows from that: calling a write a "read" lets
 * two index-mutating commands overlap, which is the exact bug the lock exists
 * to prevent. Calling a read a "write" only costs concurrency.
 *
 * So the rule is an allowlist, never a blocklist — anything unrecognised,
 * including every plumbing command and every future subcommand, is treated as
 * a write and serialized. A missing entry makes moonGit slower; a wrong entry
 * makes it broken.
 */

/** Global options that consume the following argument, hiding the subcommand behind them. */
const FLAGS_TAKING_A_VALUE = new Set([
  '-c',
  '-C',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
]);

/**
 * Position of the subcommand, or -1 if the argv is nothing but flags.
 *
 * The index rather than the string, because `git -C stash stash list` is a
 * legal invocation and searching for the first occurrence of "stash" would
 * find the path instead of the subcommand.
 */
function subcommandIndex(args: readonly string[]): number {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) break;
    if (!arg.startsWith('-')) return i;
    // `--git-dir=x` carries its value inline; the bare form eats the next arg.
    if (FLAGS_TAKING_A_VALUE.has(arg)) i += 1;
  }
  return -1;
}

/**
 * The subcommand, skipping `git`-level options (`-c core.x=y`, `-C path`).
 * Returns undefined for an argv that is nothing but flags (`git --version`).
 */
export function subcommandOf(args: readonly string[]): string | undefined {
  const index = subcommandIndex(args);
  return index === -1 ? undefined : args[index];
}

/** Commands that never write anything, whatever their arguments. */
const ALWAYS_READ_ONLY = new Set([
  'annotate',
  'blame',
  'cat-file',
  'check-attr',
  'check-ignore',
  'check-ref-format',
  'count-objects',
  'describe',
  'diff',
  'diff-files',
  'diff-index',
  'diff-tree',
  'for-each-ref',
  'grep',
  'log',
  'ls-files',
  'ls-remote',
  'ls-tree',
  'merge-base',
  'name-rev',
  'rev-list',
  'rev-parse',
  'shortlog',
  'show',
  'show-ref',
  'status',
  'var',
  'verify-commit',
  'verify-tag',
  'version',
  'whatchanged',
]);

type ReadOnlyGuard = (rest: readonly string[]) => boolean;

/** Args that are not options. Approximate — a flag's value counts as one — which
 *  is fine, because it is only ever used to ask "were there any at all?". */
function positionals(rest: readonly string[]): string[] {
  return rest.filter((arg) => !arg.startsWith('-'));
}

function firstPositional(rest: readonly string[]): string | undefined {
  return positionals(rest)[0];
}

function hasAny(rest: readonly string[], flags: readonly string[]): boolean {
  return rest.some((arg) => flags.includes(arg) || flags.some((f) => arg.startsWith(`${f}=`)));
}

/**
 * Commands whose mode depends on how they are called. Only the ones the
 * workspace actually calls on a hot path are listed — `stash list` and
 * `config --get` run on every repository open, and serializing those behind
 * an in-flight fetch would be felt.
 */
const CONDITIONAL_READ_ONLY: Readonly<Record<string, ReadOnlyGuard>> = {
  branch: (rest) =>
    positionals(rest).length === 0 ||
    hasAny(rest, [
      '--list',
      '-l',
      '--show-current',
      '--contains',
      '--no-contains',
      '--merged',
      '--no-merged',
      '--points-at',
    ]),
  config: (rest) =>
    hasAny(rest, ['--get', '--get-all', '--get-regexp', '--get-urlmatch', '--list', '-l']),
  notes: (rest) => isOneOf(firstPositional(rest), ['list', 'show']),
  remote: (rest) => {
    const first = firstPositional(rest);
    return first === undefined || isOneOf(first, ['show', 'get-url']);
  },
  stash: (rest) => isOneOf(firstPositional(rest), ['list', 'show']),
  submodule: (rest) => isOneOf(firstPositional(rest), ['status', 'summary']),
  'symbolic-ref': (rest) => positionals(rest).length <= 1,
  tag: (rest) =>
    positionals(rest).length === 0 ||
    hasAny(rest, ['--list', '-l', '--contains', '--no-contains', '--points-at', '--merged']),
  worktree: (rest) => firstPositional(rest) === 'list',
};

function isOneOf(value: string | undefined, candidates: readonly string[]): boolean {
  return value !== undefined && candidates.includes(value);
}

export function isReadOnly(args: readonly string[]): boolean {
  const index = subcommandIndex(args);
  // `git --version` and friends touch nothing.
  if (index === -1) return true;

  const subcommand = args[index];
  if (subcommand === undefined) return true;
  if (ALWAYS_READ_ONLY.has(subcommand)) return true;

  const guard = CONDITIONAL_READ_ONLY[subcommand];
  if (guard === undefined) return false;

  return guard(args.slice(index + 1));
}
