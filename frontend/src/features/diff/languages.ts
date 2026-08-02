/**
 * Filename → TextMate grammar, and the dynamic import that loads it.
 *
 * An explicit map rather than Shiki's full bundle. The full bundle is every
 * grammar Shiki ships; naming the ones we load keeps them as separate chunks
 * that arrive only when a file of that kind is opened, and makes the set we
 * support an auditable list rather than a side effect of a dependency.
 *
 * A path with no entry here renders unhighlighted, which is a perfectly good
 * outcome — the diff still reads.
 */

type GrammarLoader = () => Promise<unknown>;

/**
 * Grammar per language id.
 *
 * Several extensions share one id on purpose: `.mjs`/`.cjs` are JavaScript,
 * `.tsx`/`.jsx` both need the `tsx` grammar (the `typescript` grammar does not
 * know JSX, and a React component highlighted without it loses every tag).
 */
const GRAMMARS: Readonly<Record<string, GrammarLoader>> = {
  css: () => import('@shikijs/langs/css'),
  go: () => import('@shikijs/langs/go'),
  html: () => import('@shikijs/langs/html'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  markdown: () => import('@shikijs/langs/markdown'),
  python: () => import('@shikijs/langs/python'),
  rust: () => import('@shikijs/langs/rust'),
  shellscript: () => import('@shikijs/langs/shellscript'),
  sql: () => import('@shikijs/langs/sql'),
  toml: () => import('@shikijs/langs/toml'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
};

const BY_EXTENSION: Readonly<Record<string, string>> = {
  cjs: 'javascript',
  css: 'css',
  go: 'go',
  htm: 'html',
  html: 'html',
  js: 'javascript',
  json: 'json',
  jsonc: 'json',
  jsx: 'tsx',
  md: 'markdown',
  markdown: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  py: 'python',
  rs: 'rust',
  scss: 'css',
  sh: 'shellscript',
  sql: 'sql',
  svg: 'xml',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shellscript',
};

/** Files whose whole name identifies them, extension or not. */
const BY_FILENAME: Readonly<Record<string, string>> = {
  '.bashrc': 'shellscript',
  '.zshrc': 'shellscript',
  dockerfile: 'shellscript',
  makefile: 'shellscript',
};

export function languageForPath(path: string): string | null {
  const name = (path.split('/').pop() ?? '').toLowerCase();
  const byName = BY_FILENAME[name];
  if (byName !== undefined) return byName;

  // `lastIndexOf` rather than a split, so `.eslintrc.json` reads as JSON and a
  // dotfile with no extension (`.gitignore`) reads as no language at all.
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

export function grammarLoader(language: string): GrammarLoader | undefined {
  return GRAMMARS[language];
}

/**
 * The other question this module answers about a filename: is it a picture?
 *
 * Same shape as the grammar lookup and the same reason to be here — deciding
 * what a file *is* from its path, in one place, testable without a component.
 * Only formats a webview will actually render are listed; a `.psd` is binary
 * and stays binary.
 */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  apng: 'image/apng',
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  ico: 'image/x-icon',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/** The MIME type for a path, or null when it is not an image we can render. */
export function imageTypeForPath(path: string): string | null {
  const name = (path.split('/').pop() ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return IMAGE_TYPES[name.slice(dot + 1)] ?? null;
}
