/**
 * The config keys the General tab offers, as data.
 *
 * A short, opinionated list rather than a form over every key git has. The
 * repository's whole config is still visible — the panel lists the raw local
 * entries underneath — but the keys with a *control* are the ones where an
 * ordinary person has an intention ("commit as this address here", "stop
 * rewriting my line endings") and where a wrong value is felt.
 *
 * Anything not here is edited in the file, which the repository's own
 * `git config -e` and the terminal drawer both reach. A settings panel that
 * tries to be a config editor ends up being a worse text editor.
 */

export interface ChoiceOption {
  readonly value: string;
  readonly label: string;
}

export type ConfigControl =
  | { readonly kind: 'text'; readonly placeholder?: string }
  | { readonly kind: 'choice'; readonly options: readonly ChoiceOption[] };

export interface ConfigKeySpec {
  readonly key: string;
  readonly label: string;
  readonly hint?: string;
  readonly control: ConfigControl;
}

export interface ConfigGroup {
  readonly title: string;
  readonly hint?: string;
  readonly keys: readonly ConfigKeySpec[];
}

/** The empty choice means "no local value" — the inherited one applies. */
export const INHERIT = '';

const bool: readonly ChoiceOption[] = [
  { value: INHERIT, label: 'Inherit' },
  { value: 'true', label: 'true' },
  { value: 'false', label: 'false' },
];

export const CONFIG_GROUPS: readonly ConfigGroup[] = [
  {
    title: 'Identity',
    hint: 'Set here, these override the global identity for commits made in this repository.',
    keys: [
      {
        key: 'user.name',
        label: 'Name',
        control: { kind: 'text', placeholder: 'Inherited from global config' },
      },
      {
        key: 'user.email',
        label: 'Email',
        hint: 'The address every commit made here is attributed to.',
        control: { kind: 'text', placeholder: 'Inherited from global config' },
      },
    ],
  },
  {
    title: 'Working tree',
    keys: [
      {
        key: 'core.autocrlf',
        label: 'Line endings',
        hint: '“input” commits LF and leaves the working tree alone — the usual choice on macOS.',
        control: {
          kind: 'choice',
          options: [
            { value: INHERIT, label: 'Inherit' },
            { value: 'input', label: 'input' },
            { value: 'true', label: 'true' },
            { value: 'false', label: 'false' },
          ],
        },
      },
      {
        key: 'core.filemode',
        label: 'Track file mode',
        hint: 'Off on filesystems that cannot store the executable bit, or every file looks changed.',
        control: { kind: 'choice', options: bool },
      },
      {
        key: 'core.ignorecase',
        label: 'Case-insensitive paths',
        hint: 'Set by git when the repository is created, from what the filesystem can do. Changing it on an existing repository is rarely what you want.',
        control: { kind: 'choice', options: bool },
      },
    ],
  },
  {
    title: 'Pull and push',
    keys: [
      {
        key: 'pull.rebase',
        label: 'Pull strategy',
        hint: 'moonGit’s own Pull is --ff-only regardless; this is what the command line does here.',
        control: {
          kind: 'choice',
          options: [
            { value: INHERIT, label: 'Inherit' },
            { value: 'false', label: 'merge' },
            { value: 'true', label: 'rebase' },
            { value: 'merges', label: 'rebase, keeping merges' },
          ],
        },
      },
      {
        key: 'push.default',
        label: 'Push default',
        control: {
          kind: 'choice',
          options: [
            { value: INHERIT, label: 'Inherit' },
            { value: 'simple', label: 'simple' },
            { value: 'current', label: 'current' },
            { value: 'upstream', label: 'upstream' },
            { value: 'nothing', label: 'nothing' },
          ],
        },
      },
    ],
  },
];

/** Every key with a control, flat — used to split the raw list into "other". */
export const MANAGED_KEYS: readonly string[] = CONFIG_GROUPS.flatMap((group) =>
  group.keys.map((spec) => spec.key),
);

/**
 * What a field should show, and where the value came from.
 *
 * The distinction the panel exists to make: an empty `user.email` box is a lie
 * if the global config has one, because commits made here will carry it. So a
 * field is `local` (set in this repository), `inherited` (showing someone
 * else's value, greyed), or `unset` (nobody has one).
 */
export type ValueOrigin = 'local' | 'inherited' | 'unset';

export interface ResolvedValue {
  readonly origin: ValueOrigin;
  /** The local value when there is one, otherwise the inherited one. */
  readonly value: string;
}

export function resolveValue(
  key: string,
  local: ReadonlyMap<string, string>,
  effective: ReadonlyMap<string, string>,
): ResolvedValue {
  const localValue = local.get(key);
  if (localValue !== undefined) return { origin: 'local', value: localValue };

  const inherited = effective.get(key);
  if (inherited !== undefined) return { origin: 'inherited', value: inherited };

  return { origin: 'unset', value: '' };
}

/**
 * Config keys are case-insensitive in their section and name, and git reports
 * them lowercased — but a subsection is case-*sensitive* and is reported as
 * written. Lowercasing the whole key would merge `remote.Origin.url` into
 * `remote.origin.url`, so only the parts git itself normalises are touched.
 */
export function configMap(entries: readonly { key: string; value: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    // Last wins, which is git's own rule for a key repeated in one file.
    map.set(entry.key, entry.value);
  }
  return map;
}
