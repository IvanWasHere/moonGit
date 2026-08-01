/**
 * The git layer. Framework-free by lint rule (`services/git` may not import
 * React or Zustand) so every part of it is unit-testable in isolation.
 *
 * Parsers and domain services land here next; today it is the runner and the
 * types everything above it branches on.
 */
export * from './result';
export * from './errors';
export * from './commands';
export * from './RepoLock';
export * from './GitRunner';
export * from './parsers';
export * from './boundary';
export * from './RepositoryService';
export * from './BranchService';
export * from './CommitService';
export * from './DiffService';
export * from './StashService';
export * from './IntegrationService';
export * from './RemoteService';
export * from './WorkingTreeService';
