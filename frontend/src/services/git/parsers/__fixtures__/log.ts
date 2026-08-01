/**
 * Real `git log -z --decorate=full` output, captured from git 2.47.1.
 *
 * Produced with the parser's own format string, re-exported as FIXTURE_FORMAT so
 * the test can assert the two have not drifted apart.
 */

/** The exact --format these fixtures were produced with. */
export const FIXTURE_FORMAT =
  '%H%x00%h%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%D%x00%s%x00%b';

/**
 * A whole history: a root commit, a merge with two parents, a commit whose
 * message has a multi-line body, one whose subject git folded onto a single
 * line, decorations for HEAD, a tag and a remote-tracking branch, and a
 * non-ASCII author name.
 */
export const LOG_HISTORY =
  'fc220571fa08a51dcb823d303fe583ae2aad712b\x00fc22057\x00a37369fe6b3f4a483ef9135fcaeeea8c54244696\x00Ivan Marinković\x00a@b.c\x001785614592\x00Ivan Marinković\x00a@b.c\x001785614592\x00HEAD -> refs/heads/main\x00multi line subject\x00real body\n\x00a37369fe6b3f4a483ef9135fcaeeea8c54244696\x00a37369f\x006aba4888ae54c92928fd4ec982eb1609ea1afb85 1de9816cb1e76ee4877a4e3475fef98a87ccfd12\x00Ivan Marinković\x00a@b.c\x001785614395\x00Ivan Marinković\x00a@b.c\x001785614395\x00tag: refs/tags/v1.0, refs/remotes/origin/main\x00merge side into main\x00\x006aba4888ae54c92928fd4ec982eb1609ea1afb85\x006aba488\x005cdabfde13cb4359ed045b6189dc8c1ebbad654e\x00Ivan Marinković\x00a@b.c\x001785614395\x00Ivan Marinković\x00a@b.c\x001785614395\x00\x00main commit\x00\x001de9816cb1e76ee4877a4e3475fef98a87ccfd12\x001de9816\x005cdabfde13cb4359ed045b6189dc8c1ebbad654e\x00Ivan Marinković\x00a@b.c\x001785614395\x00Ivan Marinković\x00a@b.c\x001785614395\x00refs/heads/side\x00side commit\x00\x005cdabfde13cb4359ed045b6189dc8c1ebbad654e\x005cdabfd\x006c65c06560c5674706977e03668102ce2d8a086e\x00Ivan Marinković\x00a@b.c\x001785614395\x00Ivan Marinković\x00a@b.c\x001785614395\x00\x00subject here\x00body line one\nbody line two\n\x006c65c06560c5674706977e03668102ce2d8a086e\x006c65c06\x00\x00Ivan Marinković\x00a@b.c\x001785614395\x00Ivan Marinković\x00a@b.c\x001785614395\x00\x00first commit\x00\x00';

/** One commit, for the bounded-query path. */
export const LOG_SINGLE =
  'fc220571fa08a51dcb823d303fe583ae2aad712b\x00fc22057\x00a37369fe6b3f4a483ef9135fcaeeea8c54244696\x00Ivan Marinković\x00a@b.c\x001785614592\x00Ivan Marinković\x00a@b.c\x001785614592\x00HEAD -> refs/heads/main\x00multi line subject\x00real body\n\x00';

/** A repository with no commits: git exits non-zero and prints nothing. */
export const LOG_EMPTY = '';
