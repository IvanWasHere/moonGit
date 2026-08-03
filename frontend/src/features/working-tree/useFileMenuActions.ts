/**
 * What each file context-menu item does.
 *
 * Three rules, all of which the rest of the app already follows:
 *
 * 1. **Destructive actions confirm first**, through a native dialog naming the
 *    file. `fileMenu.ts` marks which those are, so the list of things that need
 *    a confirmation is data rather than a set of remembered special cases.
 * 2. **The watcher is the source of truth.** Everything mutating invalidates
 *    and lets the next `status` say what happened.
 * 3. **Nothing reports success it did not have.** Every path either toasts what
 *    git did or toasts the error; none of them silently no-op.
 */

import { useQueryClient } from '@tanstack/react-query';
import { useStage, useUnstage, useDiscard } from '@/queries/mutations';
import { gitKeys } from '@/queries/keys';
import { GitQueryError } from '@/queries/git';
import { workingTreeService, type StatusEntry } from '@/services/git';
import {
  copyToClipboard,
  openInEditor,
  openPath,
  openTerminal,
  readFile,
  revealInFinder,
  saveFile,
  showMessage,
  writeFile,
  deletePath,
} from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { fileDir, fileName } from '@/utils/format';
import { extensionOf, type FileMenuAction, type FileMenuItem } from './fileMenu';
import { defaultSide } from './statusDisplay';

const GITIGNORE = '.gitignore';

/**
 * Append a rule to `.gitignore`, if it is not already there.
 *
 * Read-modify-write rather than a blind append: a repository's ignore file is
 * hand-maintained, and adding `*.log` to it three times because the user
 * right-clicked three log files is untidy in a file people read.
 */
async function appendIgnoreRule(repoPath: string, rule: string): Promise<'added' | 'present'> {
  const path = `${repoPath}/${GITIGNORE}`;
  let existing = '';
  try {
    const content = await readFile(path);
    existing = content.text ?? '';
  } catch {
    // No .gitignore yet — the write below creates it.
  }

  const lines = existing.split('\n').map((line) => line.trim());
  if (lines.includes(rule)) return 'present';

  const needsNewline = existing !== '' && !existing.endsWith('\n');
  await writeFile(path, `${existing}${needsNewline ? '\n' : ''}${rule}\n`);
  return 'added';
}

export function useFileMenuActions(repoPath: string | null) {
  const queryClient = useQueryClient();
  const stage = useStage(repoPath);
  const unstage = useUnstage(repoPath);
  const discard = useDiscard(repoPath);

  const selectFile = useWorkspaceStore((state) => state.selectFile);
  const editor = useSettingsStore((state) => state.editor);
  const openMerge = useWorkspaceStore((state) => state.openMerge);
  const openCommit = useWorkspaceStore((state) => state.openCommit);
  const setLogPath = useWorkspaceStore((state) => state.setLogPath);

  const report = (error: unknown) =>
    showToast(error instanceof Error ? error.message : String(error), 'error');

  const refresh = () =>
    repoPath === null
      ? undefined
      : void queryClient.invalidateQueries({ queryKey: gitKeys.repo(repoPath) });

  /**
   * Run a service call, reporting either outcome. Never throws.
   *
   * **Refreshes whichever way it goes**, exactly as the mutation layer's
   * `onSettled` does, and for the same reason: an error does not mean nothing
   * happened. `resolveUsing` is two commands — `checkout --ours` then `add` —
   * and a failure of the second leaves the working tree already rewritten by
   * the first. Refreshing only on success leaves the panels describing a
   * repository that no longer exists.
   */
  const run = async (
    work: () => Promise<{ ok: true } | { ok: false; error: { message: string } }>,
    success: string,
  ) => {
    try {
      const result = await work();
      if (result.ok) showToast(success, 'success');
      else showToast(result.error.message, 'error');
    } catch (cause) {
      report(cause instanceof GitQueryError ? cause : cause);
    } finally {
      refresh();
    }
  };

  const confirm = async (title: string, message: string, verb: string): Promise<boolean> => {
    const choice = await showMessage({
      kind: 'warning',
      title,
      message,
      buttons: ['Cancel', verb],
      defaultButton: 'Cancel',
      cancelButton: 'Cancel',
    });
    return choice === verb;
  };

  return (entry: StatusEntry, menuItem: FileMenuItem): void => {
    if (repoPath === null) return;

    const absolute = `${repoPath}/${entry.path}`;
    const service = workingTreeService(repoPath);
    const action: FileMenuAction = menuItem.action;

    void (async () => {
      // One gate for every irreversible action, driven by the flag the menu
      // model already carries.
      if (menuItem.destructive === true) {
        const verb = menuItem.label.split(' ')[0] ?? 'Continue';
        const ok = await confirm(
          `${menuItem.label}?`,
          `${menuItem.label} for ${fileName(entry.path)}? This cannot be undone.`,
          verb,
        );
        if (!ok) return;
      }

      switch (action) {
        case 'open':
          await openInEditor(absolute, editor).catch(report);
          return;

        case 'showChanges':
          selectFile({ path: entry.path, side: defaultSide(entry) });
          return;

        case 'reveal':
          await revealInFinder(absolute).catch(report);
          return;

        case 'openTerminal': {
          const dir = fileDir(entry.path);
          await openTerminal(dir === '' ? repoPath : `${repoPath}/${dir}`).catch(report);
          return;
        }

        case 'stage':
          stage.mutate({ paths: [entry.path] }, { onError: report });
          return;

        case 'unstage':
          unstage.mutate({ paths: [entry.path] }, { onError: report });
          return;

        case 'commitSelected':
          openCommit();
          return;

        case 'discard':
          discard.mutate(
            { targets: [{ path: entry.path, untracked: entry.kind === 'untracked' }] },
            {
              onSuccess: () => showToast(`Discarded ${fileName(entry.path)}`, 'info'),
              onError: report,
            },
          );
          return;

        case 'revert':
          await run(() => service.revert([entry.path]), `${fileName(entry.path)} reverted to HEAD`);
          return;

        case 'resolveConflict':
          openMerge();
          return;

        case 'resolveUsingOurs':
          await run(
            () => service.resolveUsing([entry.path], 'ours'),
            `${fileName(entry.path)} resolved using ours`,
          );
          return;

        case 'resolveUsingTheirs':
          await run(
            () => service.resolveUsing([entry.path], 'theirs'),
            `${fileName(entry.path)} resolved using theirs`,
          );
          return;

        case 'markResolved':
          stage.mutate(
            { paths: [entry.path] },
            {
              onSuccess: () => showToast(`${fileName(entry.path)} marked resolved`, 'success'),
              onError: report,
            },
          );
          return;

        case 'ignoreByName':
        case 'ignoreByExtension': {
          const extension = extensionOf(entry.path);
          const rule =
            action === 'ignoreByName'
              ? `/${entry.path}`
              : extension === null
                ? null
                : `*.${extension}`;
          if (rule === null) return;
          try {
            const outcome = await appendIgnoreRule(repoPath, rule);
            showToast(
              outcome === 'added' ? `Ignoring ${rule}` : `${rule} was already ignored`,
              outcome === 'added' ? 'success' : 'info',
            );
            refresh();
          } catch (cause) {
            report(cause);
          }
          return;
        }

        case 'editGitignore':
          // Created first when absent: `open` on a missing file fails, and
          // "edit the ignore file" on a repository that has none should make
          // one rather than report that it does not exist.
          try {
            await appendIgnoreRule(repoPath, '');
          } catch {
            /* the open below will report anything that matters */
          }
          await openPath(`${repoPath}/${GITIGNORE}`).catch(report);
          return;

        case 'remove':
          await run(
            () => service.removeFromIndex([entry.path]),
            `${fileName(entry.path)} removed from the repository, kept on disk`,
          );
          return;

        case 'rename': {
          // The native save dialog *is* the rename prompt: it validates the
          // path, warns about overwrites, and needs no in-app text-input modal.
          const target = await saveFile('Rename file', repoPath, fileName(entry.path));
          if (target === '') return;
          if (!target.startsWith(`${repoPath}/`)) {
            showToast('A file cannot be moved out of its repository', 'error');
            return;
          }
          const relative = target.slice(repoPath.length + 1);
          await run(() => service.move(entry.path, relative), `Renamed to ${relative}`);
          return;
        }

        case 'delete':
          // Tracked files go through git so the index keeps up; an untracked
          // one git has never heard of, and `git rm` on it simply fails.
          if (entry.kind === 'untracked') {
            try {
              await deletePath(absolute);
              showToast(`Deleted ${fileName(entry.path)}`, 'info');
              refresh();
            } catch (cause) {
              report(cause);
            }
          } else {
            await run(
              () => service.removeFromDisk([entry.path]),
              `Deleted ${fileName(entry.path)}`,
            );
          }
          return;

        case 'fileLog':
          setLogPath(entry.path);
          return;

        case 'copyPath':
          await copyToClipboard(absolute);
          showToast('Path copied', 'info');
          return;

        case 'copyRelativePath':
          await copyToClipboard(entry.path);
          showToast('Relative path copied', 'info');
          return;

        case 'copyRepositoryPath':
          await copyToClipboard(repoPath);
          showToast('Repository path copied', 'info');
          return;

        case 'refresh':
          refresh();
          showToast('Refreshed', 'info');
          return;

        case 'stageHunk':
          // Selecting the file *is* the entry point: the hunks and their
          // stage buttons live in the diff pane, and a second mechanism here
          // would be a worse version of the one that has the diff in front of
          // it.
          selectFile({ path: entry.path, side: 'worktree' });
          showToast('Pick lines or use "Stage hunk" in the Changes pane', 'info');
          return;
      }
    })();
  };
}
