/**
 * The mockup tagged every branch with a `type` from its seed data
 * (ui-example L443–446). Real branches carry no such field, so it is derived
 * from the name using the git-flow convention the tags were describing.
 *
 * Anything unrecognised is just a branch. Guessing harder — treating any
 * prefix as a type — would fill the panel with tags like `wip` and `ivan`
 * that carry no shared meaning and only add noise.
 */
const KNOWN = new Set([
  'feature',
  'fix',
  'bugfix',
  'hotfix',
  'release',
  'develop',
  'main',
  'master',
]);

export function branchType(shortName: string): string {
  if (shortName === '') return 'branch';

  const prefix = shortName.includes('/') ? (shortName.split('/')[0] ?? '') : shortName;
  return KNOWN.has(prefix) ? prefix : 'branch';
}
