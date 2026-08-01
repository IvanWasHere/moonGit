/**
 * The mockup's Dexie seed (ui-example L261–341), reshaped as typed fixtures.
 *
 * Phase 4 is ported against these rather than against git, so the layout can
 * be compared with the mockup side by side while the data is identical
 * (PLAN.md §7). Real git arrives in Phase 5 and these become test fixtures.
 *
 * Timestamps are relative to module load, matching the mockup's `Date.now() -
 * N` seeds, so "5m ago" stays "5m ago" however long the app has been running.
 */

const NOW = Date.now();

export interface MockRepo {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly status: 'clean' | 'dirty';
  readonly lastSync: number;
}

export interface MockBranch {
  readonly id: number;
  readonly repoId: number;
  readonly name: string;
  readonly type: string;
  readonly isActive: boolean;
  readonly lastCommit: string;
  readonly ahead: number;
  readonly behind: number;
}

export interface MockFile {
  readonly id: number;
  readonly repoId: number;
  readonly branchId: number;
  readonly path: string;
  readonly status: string;
  readonly staged: boolean;
  readonly size: number;
  readonly modified: number;
}

export interface MockCommit {
  readonly id: number;
  readonly repoId: number;
  readonly branchId: number;
  readonly hash: string;
  readonly message: string;
  readonly author: string;
  readonly date: number;
  readonly fileCount: number;
}

export interface MockChange {
  readonly fileId: number;
  readonly type: 'add' | 'remove' | 'context';
  readonly lineFrom: number;
  readonly lineTo: number;
  readonly content: string;
}

export const repos: readonly MockRepo[] = [
  {
    id: 1,
    name: 'frontend-app',
    path: '/workspace/frontend-app',
    status: 'clean',
    lastSync: NOW - 300_000,
  },
  {
    id: 2,
    name: 'api-service',
    path: '/workspace/api-service',
    status: 'dirty',
    lastSync: NOW - 1_200_000,
  },
  {
    id: 3,
    name: 'shared-libs',
    path: '/workspace/shared-libs',
    status: 'clean',
    lastSync: NOW - 7_200_000,
  },
];

export const branches: readonly MockBranch[] = [
  {
    id: 1,
    repoId: 1,
    name: 'main',
    type: 'main',
    isActive: true,
    lastCommit: 'a3f8c21',
    ahead: 0,
    behind: 0,
  },
  {
    id: 2,
    repoId: 1,
    name: 'feature/auth-flow',
    type: 'feature',
    isActive: false,
    lastCommit: 'b7d2e14',
    ahead: 3,
    behind: 1,
  },
  {
    id: 3,
    repoId: 1,
    name: 'feature/dashboard-v2',
    type: 'feature',
    isActive: false,
    lastCommit: 'c1a9f03',
    ahead: 7,
    behind: 2,
  },
  {
    id: 4,
    repoId: 1,
    name: 'fix/memory-leak',
    type: 'fix',
    isActive: false,
    lastCommit: 'e4b7d82',
    ahead: 1,
    behind: 0,
  },
  {
    id: 5,
    repoId: 1,
    name: 'release/2.4.0',
    type: 'release',
    isActive: false,
    lastCommit: 'f9c1a56',
    ahead: 0,
    behind: 5,
  },
  {
    id: 6,
    repoId: 1,
    name: 'develop',
    type: 'develop',
    isActive: false,
    lastCommit: 'd2e8b91',
    ahead: 12,
    behind: 3,
  },
  {
    id: 7,
    repoId: 2,
    name: 'main',
    type: 'main',
    isActive: true,
    lastCommit: 'x7k3m91',
    ahead: 0,
    behind: 4,
  },
  {
    id: 8,
    repoId: 2,
    name: 'feature/rate-limiter',
    type: 'feature',
    isActive: false,
    lastCommit: 'y2p8n44',
    ahead: 5,
    behind: 1,
  },
  {
    id: 9,
    repoId: 2,
    name: 'hotfix/db-connection',
    type: 'hotfix',
    isActive: false,
    lastCommit: 'z9q1w67',
    ahead: 2,
    behind: 0,
  },
  {
    id: 10,
    repoId: 3,
    name: 'main',
    type: 'main',
    isActive: true,
    lastCommit: 'm4r7t22',
    ahead: 0,
    behind: 0,
  },
  {
    id: 11,
    repoId: 3,
    name: 'feature/utils-extensions',
    type: 'feature',
    isActive: false,
    lastCommit: 'n8v2x55',
    ahead: 2,
    behind: 1,
  },
];

export const files: readonly MockFile[] = [
  {
    id: 1,
    repoId: 1,
    branchId: 1,
    path: 'src/components/Header.tsx',
    status: 'modified',
    staged: true,
    size: 3400,
    modified: NOW - 60_000,
  },
  {
    id: 2,
    repoId: 1,
    branchId: 1,
    path: 'src/components/Sidebar.tsx',
    status: 'modified',
    staged: true,
    size: 5200,
    modified: NOW - 120_000,
  },
  {
    id: 3,
    repoId: 1,
    branchId: 1,
    path: 'src/hooks/useAuth.ts',
    status: 'added',
    staged: true,
    size: 1800,
    modified: NOW - 300_000,
  },
  {
    id: 4,
    repoId: 1,
    branchId: 1,
    path: 'src/pages/Dashboard.tsx',
    status: 'modified',
    staged: false,
    size: 8900,
    modified: NOW - 180_000,
  },
  {
    id: 5,
    repoId: 1,
    branchId: 1,
    path: 'src/styles/theme.css',
    status: 'modified',
    staged: false,
    size: 2400,
    modified: NOW - 400_000,
  },
  {
    id: 6,
    repoId: 1,
    branchId: 1,
    path: 'src/utils/helpers.ts',
    status: 'deleted',
    staged: false,
    size: 0,
    modified: NOW - 500_000,
  },
  {
    id: 7,
    repoId: 1,
    branchId: 1,
    path: 'package.json',
    status: 'modified',
    staged: false,
    size: 1200,
    modified: NOW - 600_000,
  },
  {
    id: 8,
    repoId: 1,
    branchId: 1,
    path: 'tsconfig.json',
    status: 'untracked',
    staged: false,
    size: 600,
    modified: NOW - 700_000,
  },
  {
    id: 9,
    repoId: 2,
    branchId: 7,
    path: 'src/middleware/rateLimiter.ts',
    status: 'added',
    staged: true,
    size: 2100,
    modified: NOW - 90_000,
  },
  {
    id: 10,
    repoId: 2,
    branchId: 7,
    path: 'src/routes/users.ts',
    status: 'modified',
    staged: false,
    size: 4500,
    modified: NOW - 200_000,
  },
  {
    id: 11,
    repoId: 2,
    branchId: 7,
    path: 'src/config/database.ts',
    status: 'modified',
    staged: true,
    size: 1800,
    modified: NOW - 150_000,
  },
  {
    id: 12,
    repoId: 2,
    branchId: 7,
    path: 'tests/integration/api.test.ts',
    status: 'added',
    staged: false,
    size: 3200,
    modified: NOW - 350_000,
  },
];

export const commits: readonly MockCommit[] = [
  {
    id: 1,
    repoId: 1,
    branchId: 1,
    hash: 'a3f8c21',
    message: 'Refactor header component with responsive layout',
    author: 'Alex Chen',
    date: NOW - 3_600_000,
    fileCount: 3,
  },
  {
    id: 2,
    repoId: 1,
    branchId: 1,
    hash: 'b7d2e14',
    message: 'Implement OAuth2 callback handler',
    author: 'Sarah Kim',
    date: NOW - 7_200_000,
    fileCount: 5,
  },
  {
    id: 3,
    repoId: 1,
    branchId: 1,
    hash: 'c1a9f03',
    message: 'Add dark mode theme variables',
    author: 'Alex Chen',
    date: NOW - 14_400_000,
    fileCount: 2,
  },
  {
    id: 4,
    repoId: 1,
    branchId: 1,
    hash: 'd2e8b91',
    message: 'Fix router guard redirect loop',
    author: 'Mike Torres',
    date: NOW - 28_800_000,
    fileCount: 1,
  },
  {
    id: 5,
    repoId: 1,
    branchId: 1,
    hash: 'e4b7d82',
    message: 'Update dependencies and fix audit warnings',
    author: 'Sarah Kim',
    date: NOW - 43_200_000,
    fileCount: 4,
  },
  {
    id: 6,
    repoId: 1,
    branchId: 1,
    hash: 'f9c1a56',
    message: 'Initial project setup with Vite and React',
    author: 'Alex Chen',
    date: NOW - 86_400_000,
    fileCount: 18,
  },
  {
    id: 7,
    repoId: 1,
    branchId: 2,
    hash: 'g3h5i78',
    message: 'WIP: auth flow with token refresh',
    author: 'Alex Chen',
    date: NOW - 1_800_000,
    fileCount: 7,
  },
  {
    id: 8,
    repoId: 1,
    branchId: 3,
    hash: 'h6j8k01',
    message: 'Dashboard chart components with real-time data',
    author: 'Mike Torres',
    date: NOW - 5_400_000,
    fileCount: 9,
  },
];

export const changes: readonly MockChange[] = [
  { fileId: 1, type: 'context', lineFrom: 12, lineTo: 12, content: '  return (' },
  {
    fileId: 1,
    type: 'context',
    lineFrom: 13,
    lineTo: 13,
    content: '    <header className="header">',
  },
  {
    fileId: 1,
    type: 'remove',
    lineFrom: 14,
    lineTo: 14,
    content: '      <div className="header-inner">',
  },
  {
    fileId: 1,
    type: 'add',
    lineFrom: 14,
    lineTo: 14,
    content: '      <div className="header-inner flex items-center justify-between w-full px-6">',
  },
  { fileId: 1, type: 'context', lineFrom: 15, lineTo: 15, content: '        <Logo />' },
  {
    fileId: 1,
    type: 'remove',
    lineFrom: 16,
    lineTo: 16,
    content: '        <nav className="nav-links">',
  },
  {
    fileId: 1,
    type: 'add',
    lineFrom: 16,
    lineTo: 16,
    content: '        <nav className="nav-links hidden md:flex items-center gap-4">',
  },
  {
    fileId: 1,
    type: 'context',
    lineFrom: 17,
    lineTo: 17,
    content: '          {links.map(link => (',
  },
  {
    fileId: 1,
    type: 'add',
    lineFrom: 18,
    lineTo: 18,
    content: '            <NavLink key={link.id} {...link} active={currentPath === link.href} />',
  },
  {
    fileId: 1,
    type: 'remove',
    lineFrom: 18,
    lineTo: 18,
    content: '            <a key={link.id} href={link.href}>{link.label}</a>',
  },
  { fileId: 1, type: 'context', lineFrom: 19, lineTo: 19, content: '          ))}' },
  { fileId: 1, type: 'add', lineFrom: 20, lineTo: 20, content: '          <ThemeToggle />' },
  {
    fileId: 1,
    type: 'add',
    lineFrom: 21,
    lineTo: 21,
    content: '          <MobileMenuToggle onClick={toggleMobile} />',
  },
  { fileId: 1, type: 'context', lineFrom: 22, lineTo: 22, content: '        </nav>' },
  { fileId: 1, type: 'context', lineFrom: 23, lineTo: 23, content: '      </div>' },
  { fileId: 2, type: 'context', lineFrom: 1, lineTo: 1, content: 'import React from "react";' },
  {
    fileId: 2,
    type: 'add',
    lineFrom: 2,
    lineTo: 2,
    content: 'import { useLocation } from "react-router-dom";',
  },
  { fileId: 2, type: 'context', lineFrom: 2, lineTo: 3, content: '' },
  { fileId: 2, type: 'context', lineFrom: 3, lineTo: 4, content: 'interface SidebarProps {' },
  { fileId: 2, type: 'remove', lineFrom: 5, lineTo: 5, content: '  collapsed: boolean;' },
  { fileId: 2, type: 'add', lineFrom: 5, lineTo: 5, content: '  collapsed: boolean;' },
  { fileId: 2, type: 'add', lineFrom: 6, lineTo: 6, content: '  activeRoute?: string;' },
  { fileId: 2, type: 'context', lineFrom: 6, lineTo: 7, content: '}' },
];

// --- lookups the panels need ------------------------------------------------

export const branchesForRepo = (repoId: number): MockBranch[] =>
  branches.filter((branch) => branch.repoId === repoId);

export const activeBranchFor = (repoId: number): MockBranch | undefined => {
  const forRepo = branchesForRepo(repoId);
  return forRepo.find((branch) => branch.isActive) ?? forRepo[0];
};

export const filesFor = (repoId: number, branchId: number): MockFile[] =>
  files.filter((file) => file.repoId === repoId && file.branchId === branchId);

export const commitsForRepo = (repoId: number): MockCommit[] =>
  commits.filter((commit) => commit.repoId === repoId).sort((a, b) => b.date - a.date);

export const changesFor = (fileId: number): MockChange[] =>
  changes.filter((change) => change.fileId === fileId);
