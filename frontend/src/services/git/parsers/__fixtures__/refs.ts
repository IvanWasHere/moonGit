/**
 * Real `git for-each-ref` output, captured from git 2.47.1.
 *
 * Generated against purpose-built repositories using the parser's own format
 * string, which is re-exported below as FIXTURE_FORMAT. The test asserts it still
 * equals FOR_EACH_REF_FORMAT, so editing the field list without regenerating
 * these fixtures fails loudly instead of silently shifting every field by one.
 */

/** The exact --format these fixtures were produced with. */
export const FIXTURE_FORMAT =
  '%(refname)%00%(refname:short)%00%(objecttype)%00%(objectname)%00%(*objecttype)%00%(*objectname)%00%(HEAD)%00%(upstream)%00%(upstream:short)%00%(upstream:track)%00%(symref)%00%(creatordate:unix)%00%(authorname)%00%(*authorname)%00%(subject)';

/**
 * Branches covering every upstream state (ahead, behind, diverged, gone, none),
 * a nested refname, remote-tracking branches including the origin/HEAD symref,
 * and both annotated and lightweight tags.
 */
export const REFS_EVERYTHING =
  'refs/heads/feature/nested-name\x00feature/nested-name\x00commit\x00fbfb961f10bfdcb17beffd8dd82832f6a51244ca\x00\x00\x00 \x00refs/remotes/origin/feature/nested-name\x00origin/feature/nested-name\x00[ahead 1, behind 1]\x00\x001785613949\x00t\x00\x00diverged commit\nrefs/heads/gone-branch\x00gone-branch\x00commit\x00fbfb961f10bfdcb17beffd8dd82832f6a51244ca\x00\x00\x00 \x00refs/remotes/origin/gone-branch\x00origin/gone-branch\x00[gone]\x00\x001785613949\x00t\x00\x00diverged commit\nrefs/heads/local-only\x00local-only\x00commit\x00f5ab07b285742097458c3f899fa35496629bf8af\x00\x00\x00 \x00\x00\x00\x00\x001785613724\x00t\x00\x00local only work\nrefs/heads/main\x00main\x00commit\x002563cb39dea822fc2970ab5e72fdbb648f72149b\x00\x00\x00*\x00refs/remotes/origin/main\x00origin/main\x00[behind 1]\x00\x001785613724\x00t\x00\x00first commit\nrefs/heads/multiline-subject\x00multiline-subject\x00commit\x0087352062adf79313b2462370599ee8ba0bd2bf54\x00\x00\x00 \x00\x00\x00\x00\x001785613835\x00t\x00\x00subject line one subject line two\nrefs/heads/weird/name-with.dots_and-dashes\x00weird/name-with.dots_and-dashes\x00commit\x002563cb39dea822fc2970ab5e72fdbb648f72149b\x00\x00\x00 \x00\x00\x00\x00\x001785613724\x00t\x00\x00first commit\nrefs/remotes/origin/HEAD\x00origin\x00commit\x00bd7d9a2aa9c30db41dc45fefeb538ebd791b53ca\x00\x00\x00 \x00\x00\x00\x00refs/remotes/origin/main\x001785613724\x00t\x00\x00will be pushed\nrefs/remotes/origin/feature/nested-name\x00origin/feature/nested-name\x00commit\x00dcd6178a8b01da257e6cdc68c9807db0edd9f889\x00\x00\x00 \x00\x00\x00\x00\x001785613724\x00t\x00\x00ahead by one\nrefs/remotes/origin/main\x00origin/main\x00commit\x00bd7d9a2aa9c30db41dc45fefeb538ebd791b53ca\x00\x00\x00 \x00\x00\x00\x00\x001785613724\x00t\x00\x00will be pushed\nrefs/tags/annotated-tag\x00annotated-tag\x00tag\x00ac5264bfe577fa19b4285e7d616f47b2e28348bd\x00commit\x00f5ab07b285742097458c3f899fa35496629bf8af\x00 \x00\x00\x00\x00\x001785613724\x00\x00t\x00an annotated tag\nrefs/tags/lightweight-tag\x00lightweight-tag\x00commit\x00f5ab07b285742097458c3f899fa35496629bf8af\x00\x00\x00 \x00\x00\x00\x00\x001785613724\x00t\x00\x00local only work\nrefs/tags/multiline-tag\x00multiline-tag\x00tag\x00bdaddf2288513aa96d4a4b9f233467ca0f44e09e\x00commit\x002563cb39dea822fc2970ab5e72fdbb648f72149b\x00 \x00\x00\x00\x00\x001785614082\x00\x00t\x00tag subject line one tag subject line two\n';

/** Detached HEAD: no ref carries the `*` marker. */
export const REFS_DETACHED =
  'refs/heads/main\x00main\x00commit\x00160b4ea650f406a260024365c24a5776b45b5cdc\x00\x00\x00 \x00\x00\x00\x00\x001785613380\x00t\x00\x00second\n';

/** A repository with no commits, and therefore no refs at all. */
export const REFS_EMPTY = '';
