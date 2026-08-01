/**
 * Icon registry — the single place lucide-react is imported.
 *
 * The mockup (ui-example/index.html) used Font Awesome 6.5.1 from a CDN, which
 * cannot ship in an offline app (PLAN.md §1.3). Every `i.fa-solid.fa-*` in the
 * mockup maps to exactly one entry here, so the substitution stays auditable
 * and components reference semantic names (`Icons.Pull`) rather than either
 * icon library's naming.
 *
 * Note: lucide v1 renamed several icons — `Filter` is now `Funnel`, and there
 * is no `History` (the closest match to `fa-clock-rotate-left` is
 * `ClockArrowLeft`). Verify against node_modules before adding entries.
 */
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  CircleAlert,
  CircleCheck,
  ClockArrowLeft,
  Columns3,
  FileCheck,
  FileCode,
  FileDiff,
  Folder,
  FolderOpen,
  Funnel,
  GitBranch,
  GitCompare,
  GitMerge,
  Info,
  Minimize2,
  Minus,
  Pen,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanSearch,
  ScrollText,
  Search,
  SquarePen,
  Star,
  Tag,
  Trash2,
  User,
  UserPen,
  X,
  type LucideIcon,
} from 'lucide-react';

export type { LucideIcon };

export const Icons = {
  // --- menubar: left section (ui-example L458–468) ---
  /** fa-arrow-down */ Pull: ArrowDown,
  /** fa-arrows-rotate */ Sync: RefreshCw,
  /** fa-arrow-up */ Push: ArrowUp,
  /** fa-code-branch */ GitFlow: GitBranch,
  /** fa-code-merge */ Merge: GitMerge,
  /** fa-check */ Commit: Check,

  // --- menubar: center section (ui-example L471–492) ---
  /** fa-plus */ Stage: Plus,
  /** fa-pen-to-square */ IndexEditor: SquarePen,
  /** fa-minus */ Unstage: Minus,
  /** fa-xmark */ Remove: X,
  /** fa-ban */ Abort: Ban,
  /** fa-rotate-left */ Discard: RotateCcw,
  /** fa-trash */ Delete: Trash2,

  // --- menubar: right section (ui-example L495–500) ---
  /** fa-clock-rotate-left */ Log: ClockArrowLeft,
  /** fa-user-pen */ Blame: UserPen,
  /** fa-magnifying-glass-chart */ Investigate: ScanSearch,
  /** fa-columns */ MainView: Columns3,
  /** fa-code-compare */ ReviewView: GitCompare,

  // --- panels & lists ---
  /** fa-folder */ Repository: Folder,
  RepositoryOpen: FolderOpen,
  /** fa-code-branch */ Branch: GitBranch,
  /** fa-file-code */ File: FileCode,
  /** fa-compress */ CollapseAll: Minimize2,
  /** fa-search */ Search,
  /** fa-filter */ Filter: Funnel,
  /** fa-pen */ NewCommit: Pen,
  Tag,
  Favorite: Star,

  // --- empty states (ui-example L561, 590, 624–625, 647, 702) ---
  /** fa-scroll */ Journal: ScrollText,
  /** fa-diff */ Diff: FileDiff,
  /** fa-file-circle-check */ NoDiff: FileCheck,
  /** fa-check-circle */ Clean: CircleCheck,
  /** fa-message */ CommitMessages: SquarePen,
  /** fa-user */ Author: User,

  // --- toasts (ui-example L797) ---
  ToastSuccess: CircleCheck,
  ToastError: CircleAlert,
  ToastInfo: Info,
} as const satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof Icons;
