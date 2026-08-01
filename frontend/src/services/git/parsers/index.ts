/**
 * Parsers: pure functions from git's bytes to domain objects. No I/O, no
 * React, no stores — which is what makes them the cheapest place in the
 * codebase to test exhaustively (PLAN.md §5).
 */
export * from './status';
