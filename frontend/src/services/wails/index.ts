/**
 * The Wails bridge — the ONLY directory permitted to import from `wailsjs/`.
 *
 * Enforced by ESLint (`no-restricted-imports` in eslint.config.js), not by
 * convention. Everything above this layer imports from here, which is what
 * keeps a Wails v2 → v3 migration contained to one directory (PLAN.md §1.1).
 */
export * from './types';
export * from './app';
export * from './git';
export * from './fs';
export * from './watch';
export * from './db';
export * from './ui';
export * from './pty';
export * from './appmenu';
export * from './secrets';
export * from './events';
