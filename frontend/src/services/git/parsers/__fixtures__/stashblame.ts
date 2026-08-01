/**
 * Real `git stash list` and `git blame --porcelain` output, captured from git 2.47.1.
 */

/** The exact --format the stash fixtures were produced with. */
export const STASH_FIXTURE_FORMAT = '%gd%x00%H%x00%P%x00%gs%x00%ct';

/**
 * Four stashes: one auto-named ("WIP on main: …"), two with explicit messages,
 * one made on a different branch, and one created with -u so its commit has a
 * third parent holding the untracked tree.
 */
export const STASH_LIST =
  'stash@{0}\x00ec8ac779f8125c522bcdef6793b94c921f709370\x00ffd1b3e6fcd0380a70be69c19dad7a9806367cc6 66302ebd12af98e930e2f1ee00f87608275d544c\x00On feature/side: made on a branch\x001785616771\x00stash@{1}\x007f02c45f097b29bf60c7f926e97eec37ce04218a\x00ffd1b3e6fcd0380a70be69c19dad7a9806367cc6 ce89faef759079eaaeed2cceaf33a78be30e06b9 c102036e6a80a9db56247b9e404dab2e4982e833\x00On main: with untracked files\x001785616771\x00stash@{2}\x00dc60ced691f57641fec1eafef274ea39df4a5ca3\x00ffd1b3e6fcd0380a70be69c19dad7a9806367cc6 ce89faef759079eaaeed2cceaf33a78be30e06b9\x00On main: work in progress on the parser\x001785616771\x00stash@{3}\x00c651874d3a4881159ddef0e74d41434056447476\x00ffd1b3e6fcd0380a70be69c19dad7a9806367cc6 ce89faef759079eaaeed2cceaf33a78be30e06b9\x00WIP on main: ffd1b3e first commit\x001785616771\x00';

/** No stashes at all. */
export const STASH_EMPTY = '';

/**
 * Blame of a file touched by three commits, so the output exercises the part
 * that matters: the metadata block appears once per commit and later runs of
 * the same commit carry only a header line and content.
 */
export const BLAME_FILE =
  'ffd1b3e6fcd0380a70be69c19dad7a9806367cc6 1 1 2\nauthor Ivan Marinković\nauthor-mail <a@b.c>\nauthor-time 1785616771\nauthor-tz +0200\ncommitter Ivan Marinković\ncommitter-mail <a@b.c>\ncommitter-time 1785616771\ncommitter-tz +0200\nsummary first commit\nboundary\nfilename a.txt\n\t1\nffd1b3e6fcd0380a70be69c19dad7a9806367cc6 2 2\n\t2\nd7c3c22289916757eba9c858c38bca9f758f65fa 3 3 1\nauthor Ivan Marinković\nauthor-mail <a@b.c>\nauthor-time 1785616803\nauthor-tz +0200\ncommitter Ivan Marinković\ncommitter-mail <a@b.c>\ncommitter-time 1785616803\ncommitter-tz +0200\nsummary third commit edits a line\nprevious 48f36501be92750715e87e1a27b1c36506f870c7 a.txt\nfilename a.txt\n\tthree\nffd1b3e6fcd0380a70be69c19dad7a9806367cc6 4 4 2\n\t4\nffd1b3e6fcd0380a70be69c19dad7a9806367cc6 5 5\n\t5\n48f36501be92750715e87e1a27b1c36506f870c7 6 6 1\nauthor Ivan Marinković\nauthor-mail <a@b.c>\nauthor-time 1785616803\nauthor-tz +0200\ncommitter Ivan Marinković\ncommitter-mail <a@b.c>\ncommitter-time 1785616803\ncommitter-tz +0200\nsummary second commit adds a line\nprevious ffd1b3e6fcd0380a70be69c19dad7a9806367cc6 a.txt\nfilename a.txt\n\tsix\n';
