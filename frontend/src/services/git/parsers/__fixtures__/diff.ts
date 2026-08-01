/**
 * Real `git diff --raw -z --patch` output, captured from git 2.47.1.
 *
 * Captured with the parser's own DIFF_BASE_ARGS, re-exported as FIXTURE_ARGS so
 * the test can assert the flags have not drifted. The flags are load-bearing:
 * -U3 pins context size against the diff.context config, and --no-ext-diff
 * stops a configured external differ from replacing the output entirely.
 */

/** The exact arguments these fixtures were produced with. */
export const FIXTURE_ARGS =
  'diff --raw -z --patch --no-color --no-ext-diff --no-textconv --find-renames --abbrev=64 -U3';

/**
 * Every kind of change in one diff: a rename with content edits, a rename with
 * none, a binary file, a mode-only change, an ordinary multi-hunk modification, a
 * file with no trailing newline, and a submodule pointer move.
 */
export const DIFF_EVERYTHING =
  ':100644 100644 8a1218a1024a212bb3db30becd860315f9f3ac52 01e79c32a8c99c557f0757da7cb6d65b3414466d R060\x00renamed-from.txt\x00added.txt\x00:100644 100644 82a730805dc10b812221b870902492c4c49ee7ce bd9d71e6ad3edf33f62d7b580a0cd9c589ccd896 M\x00image.bin\x00:100644 100755 8a1218a1024a212bb3db30becd860315f9f3ac52 8a1218a1024a212bb3db30becd860315f9f3ac52 M\x00mode-change.txt\x00:100644 100644 0ff3bbb9c8bba2291654cd64067fa417ff54c508 7399f4e15bf5bc04fb2547f036c9e0f8c814b4eb M\x00modified.txt\x00:100644 100644 69db55d99f68896760e56c209fbd5823dae98e66 0165cfff1609a660a766b4aa8b2cddf19c44e308 M\x00no-eol.txt\x00:100644 100644 8a1218a1024a212bb3db30becd860315f9f3ac52 8a1218a1024a212bb3db30becd860315f9f3ac52 R100\x00deleted.txt\x00renamed-to.txt\x00:160000 160000 402e9ee144030d669d2092a1dc7fcb1bf2b18552 77a02c16a918a99d86b1bc44ba2d3a87dc13d8a9 M\x00sub\x00\x00diff --git a/renamed-from.txt b/added.txt\nsimilarity index 60%\nrename from renamed-from.txt\nrename to added.txt\nindex 8a1218a1024a212bb3db30becd860315f9f3ac52..01e79c32a8c99c557f0757da7cb6d65b3414466d 100644\n--- a/renamed-from.txt\n+++ b/added.txt\n@@ -1,5 +1,3 @@\n 1\n 2\n 3\n-4\n-5\ndiff --git a/image.bin b/image.bin\nindex 82a730805dc10b812221b870902492c4c49ee7ce..bd9d71e6ad3edf33f62d7b580a0cd9c589ccd896 100644\nBinary files a/image.bin and b/image.bin differ\ndiff --git a/mode-change.txt b/mode-change.txt\nold mode 100644\nnew mode 100755\ndiff --git a/modified.txt b/modified.txt\nindex 0ff3bbb9c8bba2291654cd64067fa417ff54c508..7399f4e15bf5bc04fb2547f036c9e0f8c814b4eb 100644\n--- a/modified.txt\n+++ b/modified.txt\n@@ -1,6 +1,6 @@\n 1\n 2\n-3\n+three\n 4\n 5\n 6\n@@ -14,7 +14,7 @@\n 14\n 15\n 16\n-17\n+seventeen\n 18\n 19\n 20\ndiff --git a/no-eol.txt b/no-eol.txt\nindex 69db55d99f68896760e56c209fbd5823dae98e66..0165cfff1609a660a766b4aa8b2cddf19c44e308 100644\n--- a/no-eol.txt\n+++ b/no-eol.txt\n@@ -1 +1 @@\n-no trailing newline\n\\ No newline at end of file\n+no trailing newline changed\n\\ No newline at end of file\ndiff --git a/deleted.txt b/renamed-to.txt\nsimilarity index 100%\nrename from deleted.txt\nrename to renamed-to.txt\ndiff --git a/sub b/sub\nindex 402e9ee144030d669d2092a1dc7fcb1bf2b18552..77a02c16a918a99d86b1bc44ba2d3a87dc13d8a9 160000\n--- a/sub\n+++ b/sub\n@@ -1 +1 @@\n-Subproject commit 402e9ee144030d669d2092a1dc7fcb1bf2b18552\n+Subproject commit 77a02c16a918a99d86b1bc44ba2d3a87dc13d8a9\n';

/**
 * Paths that cannot be recovered from patch headers: an unquoted space, a
 * C-quoted embedded quote and backslash, a C-quoted tab, and octal-escaped
 * non-ASCII. The raw section carries all four unescaped.
 */
export const DIFF_AWKWARD_PATHS =
  ':100644 100644 f00c965d8307308469e537302baa73048488f162 0000000000000000000000000000000000000000 M\x00plain.txt\x00:100644 100644 587be6b4c3f93f93c489c0111bba5596147a26cb 0000000000000000000000000000000000000000 M\x00quote"and\\backslash.txt\x00:100644 100644 587be6b4c3f93f93c489c0111bba5596147a26cb 0000000000000000000000000000000000000000 M\x00space in name.txt\x00:100644 100644 587be6b4c3f93f93c489c0111bba5596147a26cb 0000000000000000000000000000000000000000 M\x00tab\there.txt\x00:100644 100644 a629084dc04a343c58c518c9f8cd67e345e439d8 0000000000000000000000000000000000000000 M\x00ünïcode.txt\x00\x00diff --git a/plain.txt b/plain.txt\nindex f00c965d8307308469e537302baa73048488f162..33011fd77b7414b66200a64a0024dab6d1924191 100644\n--- a/plain.txt\n+++ b/plain.txt\n@@ -2,7 +2,7 @@\n 2\n 3\n 4\n-5\n+five\n 6\n 7\n 8\ndiff --git "a/quote\\"and\\\\backslash.txt" "b/quote\\"and\\\\backslash.txt"\nindex 587be6b4c3f93f93c489c0111bba5596147a26cb..b77b4eb1d946f923f61785536da9ca5af6909f06 100644\n--- "a/quote\\"and\\\\backslash.txt"\n+++ "b/quote\\"and\\\\backslash.txt"\n@@ -1 +1,2 @@\n x\n+y\ndiff --git a/space in name.txt b/space in name.txt\nindex 587be6b4c3f93f93c489c0111bba5596147a26cb..b77b4eb1d946f923f61785536da9ca5af6909f06 100644\n--- a/space in name.txt\t\n+++ b/space in name.txt\t\n@@ -1 +1,2 @@\n x\n+y\ndiff --git "a/tab\\there.txt" "b/tab\\there.txt"\nindex 587be6b4c3f93f93c489c0111bba5596147a26cb..b77b4eb1d946f923f61785536da9ca5af6909f06 100644\n--- "a/tab\\there.txt"\n+++ "b/tab\\there.txt"\n@@ -1 +1,2 @@\n x\n+y\ndiff --git "a/\\303\\274n\\303\\257code.txt" "b/\\303\\274n\\303\\257code.txt"\nindex a629084dc04a343c58c518c9f8cd67e345e439d8..edd273fbc201c6037643778fc72bf8d5981d6730 100644\n--- "a/\\303\\274n\\303\\257code.txt"\n+++ "b/\\303\\274n\\303\\257code.txt"\n@@ -1 +1,2 @@\n unicode ćšž\n+more ćšž\n';

/**
 * A conflicted path beside an ordinary one. The conflict is a combined record
 * (two leading colons) and produces no patch section, so pairing by position
 * has to skip it: two raw records, one patch section.
 */
export const DIFF_CONFLICT =
  '::100644 100644 100644 f4c471257eaac2c2f9e51df50f39fc220e5c4f81 37dd5b6c2275800219790bcf2e769ef7d29c8797 0000000000000000000000000000000000000000 MM\x00cf.txt\x00:100644 100644 dbee0265d31298531773537e6e37e4fd1ee71d62 0000000000000000000000000000000000000000 M\x00normal.txt\x00\x00diff --git a/normal.txt b/normal.txt\nindex dbee0265d31298531773537e6e37e4fd1ee71d62..033f3b885147575a2cc90a45d11d2cf82911c186 100644\n--- a/normal.txt\n+++ b/normal.txt\n@@ -1,2 +1,2 @@\n aaa\n-bbb\n+CHANGED\n';

/** No changes at all. */
export const DIFF_EMPTY = '';
