import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Icons } from '@/components/icons';
import { useIgnoreFileText, useRemotes, useRepoConfig } from '@/queries/git';
import { useRemoteAction, useSetRepoConfig, useWriteIgnoreFile } from '@/queries/mutations';
import { showMessage } from '@/services/wails';
import { IGNORE_FILES, ignoreFile, type IgnoreFileId } from '@/services/ignoreFiles';
import { showToast } from '@/stores/notificationStore';
import { useWorkspaceStore, type RepoSettingsTab } from '@/stores/workspaceStore';
import { fileName } from '@/utils/format';
import {
  CONFIG_GROUPS,
  configMap,
  INHERIT,
  MANAGED_KEYS,
  resolveValue,
  type ConfigKeySpec,
} from './configKeys';
import styles from './RepoSettingsModal.module.css';

/**
 * Repository settings (PLAN.md §9 item 10).
 *
 * The distinction this panel exists to hold is **repository versus
 * application**. `SettingsModal` edits moonGit's own preferences, which live in
 * SQLite and follow the install. Everything here is the repository's — it lives
 * in `.git/config` and `.gitignore`, it is what the command line sees too, and
 * a colleague who clones the repository gets some of it. Mixing the two into
 * one panel would make "does this follow me to my other machine?" unanswerable.
 *
 * Nothing here is mirrored into SQLite. Git's files are the source of truth,
 * the same rule §1.2 applies to refs and status.
 */
export function RepoSettingsModal({
  tab,
  onClose,
}: {
  readonly tab: RepoSettingsTab;
  readonly onClose: () => void;
}) {
  const repoPath = useWorkspaceStore((state) => state.repoPath);
  const openRepoSettings = useWorkspaceStore((state) => state.openRepoSettings);

  // Escape closes, as it does for every other overlay. On `window` because the
  // focus may be inside a textarea that would otherwise swallow it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  if (repoPath === null) return null;

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(event) => event.stopPropagation()}>
        <div className={styles.header}>
          <span>Repository Settings</span>
          <span className={styles.repoName}>{fileName(repoPath)}</span>
          <span className={styles.spacer} />
          <button type="button" className={styles.close} onClick={onClose} title="Close">
            <Icons.Close size={14} />
          </button>
        </div>

        <div className={styles.content}>
          <nav className={styles.sidebar}>
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={`${styles.tab} ${tab === entry.id ? styles.tabActive : ''}`}
                onClick={() => openRepoSettings(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>

          <div className={styles.body}>
            {tab === 'general' && <GeneralTab repoPath={repoPath} />}
            {tab === 'ignore' && <IgnoreTab repoPath={repoPath} />}
            {tab === 'remotes' && <RemotesTab repoPath={repoPath} />}
          </div>
        </div>
      </div>
    </div>
  );
}

const TABS: readonly { id: RepoSettingsTab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'ignore', label: 'Ignore' },
  { id: 'remotes', label: 'Remotes' },
];

/* -------------------------------------------------------------------------- */
/* General                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The config form, plus every other local key read-only underneath.
 *
 * The read-only list matters more than it looks: this panel writes to the same
 * file the user's own `git config` does, and showing only the seven keys with
 * controls would imply the rest is not there. A repository with a
 * `core.hooksPath` or an `includeIf` is a repository whose behaviour a form
 * cannot explain, and hiding that would be the panel lying by omission.
 */
function GeneralTab({ repoPath }: { readonly repoPath: string }) {
  const local = useRepoConfig(repoPath, 'local');
  const effective = useRepoConfig(repoPath, 'effective');
  const setConfig = useSetRepoConfig(repoPath);

  if (local.isPending || effective.isPending) {
    return <p className={styles.empty}>Reading the repository's config…</p>;
  }
  if (local.isError) {
    return <p className={styles.empty}>{local.error.message}</p>;
  }

  const localMap = configMap(local.data ?? []);
  const effectiveMap = configMap(effective.data ?? []);

  const apply = (key: string, value: string) => {
    setConfig.mutate(
      // The empty value means "stop overriding", which is an unset rather than
      // a write of "" — those are different things to git, and a key set to
      // the empty string is not the same as an absent one.
      { key, value: value.trim() === '' ? null : value },
      {
        onSuccess: () =>
          showToast(value.trim() === '' ? `${key} unset` : `${key} set`, 'success'),
        onError: (error) => showToast(error.message, 'error'),
      },
    );
  };

  const unmanaged = (local.data ?? []).filter((entry) => !MANAGED_KEYS.includes(entry.key));

  return (
    <>
      {CONFIG_GROUPS.map((group) => (
        <section key={group.title} className={styles.section}>
          <h2 className={styles.sectionTitle}>{group.title}</h2>
          {group.hint !== undefined && <p className={styles.hint}>{group.hint}</p>}
          {group.keys.map((spec) => {
            const resolved = resolveValue(spec.key, localMap, effectiveMap);
            return (
              <ConfigField
                /*
                 * The value is part of the key, so a write remounts the field
                 * rather than an effect syncing the draft to it. Same outcome,
                 * one fewer place for the two to disagree — and no render that
                 * shows the old value before the effect corrects it.
                 */
                key={`${spec.key}:${resolved.origin}:${resolved.value}`}
                spec={spec}
                resolved={resolved}
                onApply={(value) => apply(spec.key, value)}
              />
            );
          })}
        </section>
      ))}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Everything else in .git/config</h2>
        <p className={styles.hint}>
          Read-only. These are the repository's other local settings — including the ones git
          wrote itself when the repository was created.
        </p>
        {unmanaged.length === 0 ? (
          <p className={styles.note}>Nothing else is set locally.</p>
        ) : (
          <ul className={styles.rawList}>
            {unmanaged.map((entry) => (
              <li key={`${entry.key}=${entry.value}`}>
                <span className={styles.rawKey}>{entry.key}</span>{' '}
                <span className={styles.rawValue}>{entry.value}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/**
 * One config row.
 *
 * Text fields commit on blur or Enter rather than on every keystroke — the
 * app's "no Save button" rule (§9's Phase 6.8 entry) still holds, but a write
 * per character would run `git config` a dozen times for one email address and
 * leave the file mid-word if the user walked away. A select commits on change,
 * because there is no half-chosen dropdown.
 */
function ConfigField({
  spec,
  resolved,
  onApply,
}: {
  readonly spec: ConfigKeySpec;
  readonly resolved: { origin: 'local' | 'inherited' | 'unset'; value: string };
  readonly onApply: (value: string) => void;
}) {
  // Initialised from the resolved value, which is also part of this
  // component's key upstream — so a refetch after a write builds a new field
  // rather than leaving a stale draft in an old one.
  const [draft, setDraft] = useState(resolved.origin === 'local' ? resolved.value : '');

  return (
    <>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{spec.label}</span>
        <span className={styles.fieldControl}>
          {spec.control.kind === 'text' ? (
            <input
              className={styles.input}
              placeholder={
                resolved.origin === 'inherited' ? resolved.value : spec.control.placeholder
              }
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => {
                if (draft !== (resolved.origin === 'local' ? resolved.value : '')) onApply(draft);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
            />
          ) : (
            <select
              className={styles.select}
              value={resolved.origin === 'local' ? resolved.value : INHERIT}
              onChange={(event) => onApply(event.target.value)}
            >
              {spec.control.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.value === INHERIT && resolved.origin === 'inherited'
                    ? `Inherit (${resolved.value})`
                    : option.label}
                </option>
              ))}
            </select>
          )}
          <span className={styles.origin}>
            {resolved.origin === 'local' && 'set here'}
            {resolved.origin === 'inherited' && 'inherited'}
            {resolved.origin === 'unset' && 'not set'}
          </span>
        </span>
      </label>
      {spec.hint !== undefined && <p className={styles.fieldHint}>{spec.hint}</p>}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Ignore                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The two ignore files, edited as text.
 *
 * **This one has a Save button**, and it is the deliberate exception to the
 * rule the application Settings panel states so firmly. The reasons a
 * preferences panel should apply immediately do not transfer to a text editor:
 * a half-typed ignore rule is not a preference in an intermediate state, it is
 * a *file* in an intermediate state — written to disk it would be committed by
 * the next `git add`, and every keystroke would wake the watcher and re-run
 * `status` against rules the user has not finished writing.
 */
function IgnoreTab({ repoPath }: { readonly repoPath: string }) {
  const [file, setFile] = useState<IgnoreFileId>('repo');
  const [draft, setDraft] = useState<string | null>(null);

  const stored = useIgnoreFileText(repoPath, file);
  const write = useWriteIgnoreFile(repoPath);

  // Null means "showing the file as it is on disk". Any edit puts a string
  // here, and saving or switching files clears it — so `dirty` is a fact about
  // the draft rather than a flag that can disagree with it.
  const text = draft ?? stored.data ?? '';
  const dirty = draft !== null && draft !== (stored.data ?? '');

  const selectFile = (next: IgnoreFileId) => {
    if (dirty) {
      void (async () => {
        const choice = await showMessage({
          kind: 'warning',
          title: 'Discard changes?',
          message: `${ignoreFile(file).label} has unsaved changes.`,
          buttons: ['Cancel', 'Discard'],
          defaultButton: 'Cancel',
          cancelButton: 'Cancel',
        });
        if (choice !== 'Discard') return;
        setDraft(null);
        setFile(next);
      })();
      return;
    }
    setDraft(null);
    setFile(next);
  };

  const save = () => {
    write.mutate(
      { file, text },
      {
        onSuccess: () => {
          setDraft(null);
          showToast(`${ignoreFile(file).label} saved`, 'success');
        },
        onError: (error) => showToast(error.message, 'error'),
      },
    );
  };

  return (
    <>
      <div className={styles.editorHeader}>
        <div className={styles.segmented}>
          {IGNORE_FILES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`${styles.segment} ${file === entry.id ? styles.segmentActive : ''}`}
              onClick={() => selectFile(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {dirty && <span className={styles.dirty}>unsaved</span>}
      </div>

      <textarea
        className={styles.textarea}
        spellCheck={false}
        value={text}
        placeholder={'# One pattern per line\nnode_modules/\n*.log'}
        onChange={(event) => setDraft(event.target.value)}
      />

      <div className={styles.editorFooter}>
        <span className={styles.footerHint}>{ignoreFile(file).hint}</span>
        <Button size="sm" onClick={() => setDraft(null)} disabled={!dirty}>
          Revert
        </Button>
        <Button size="sm" variant="primary" onClick={save} disabled={!dirty || write.isPending}>
          {write.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Remotes                                                                     */
/* -------------------------------------------------------------------------- */

function RemotesTab({ repoPath }: { readonly repoPath: string }) {
  const remotes = useRemotes(repoPath);
  const action = useRemoteAction(repoPath);

  const [newName, setNewName] = useState('');
  const [newUrl, setNewUrl] = useState('');

  const report = (error: Error) => showToast(error.message, 'error');

  const add = () => {
    action.mutate(
      { action: 'add', name: newName.trim(), url: newUrl.trim() },
      {
        onSuccess: () => {
          setNewName('');
          setNewUrl('');
          showToast(`Added ${newName.trim()}`, 'success');
        },
        onError: report,
      },
    );
  };

  const remove = (name: string) => {
    void (async () => {
      const choice = await showMessage({
        kind: 'warning',
        title: `Remove ${name}?`,
        message: `Remove the remote “${name}”? Its remote-tracking branches go with it, and any branch tracking it loses its upstream.`,
        buttons: ['Cancel', 'Remove'],
        defaultButton: 'Cancel',
        cancelButton: 'Cancel',
      });
      if (choice !== 'Remove') return;
      action.mutate(
        { action: 'remove', name },
        { onSuccess: () => showToast(`Removed ${name}`, 'info'), onError: report },
      );
    })();
  };

  if (remotes.isPending) return <p className={styles.empty}>Reading remotes…</p>;

  const list = remotes.data ?? [];

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Remotes</h2>
      <p className={styles.hint}>
        Editing a URL retargets the remote in place; renaming also moves its remote-tracking
        branches and repoints every branch that tracks it.
      </p>

      {list.length === 0 && (
        <p className={styles.note}>
          No remotes. Fetch, pull and push have nowhere to go until one is added.
        </p>
      )}

      {list.map((remote) => (
        <RemoteRow
          // The URL is in the key for the same reason as the config fields
          // above: a successful retarget rebuilds the row around the new value
          // instead of reconciling a draft against it.
          key={`${remote.name}:${remote.url}`}
          name={remote.name}
          url={remote.url}
          busy={action.isPending}
          onSetUrl={(url) =>
            action.mutate(
              { action: 'setUrl', name: remote.name, url },
              { onSuccess: () => showToast(`${remote.name} retargeted`, 'success'), onError: report },
            )
          }
          onRename={(to) =>
            action.mutate(
              { action: 'rename', name: remote.name, to },
              {
                onSuccess: () => showToast(`${remote.name} renamed to ${to}`, 'success'),
                onError: report,
              },
            )
          }
          onRemove={() => remove(remote.name)}
        />
      ))}

      <div className={styles.addRow}>
        <input
          className={styles.input}
          placeholder="name"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <input
          className={styles.input}
          placeholder="git@github.com:owner/repo.git"
          value={newUrl}
          onChange={(event) => setNewUrl(event.target.value)}
        />
        <Button
          size="sm"
          onClick={add}
          disabled={newName.trim() === '' || newUrl.trim() === '' || action.isPending}
        >
          Add
        </Button>
      </div>
    </section>
  );
}

/**
 * One remote.
 *
 * The URL is an editable field committing on blur, the name is not: renaming
 * is a distinct operation with side effects on refs and upstreams, and a text
 * box that silently ran it when focus moved would be the wrong shape for
 * something that rewrites `refs/remotes/*`.
 */
function RemoteRow({
  name,
  url,
  busy,
  onSetUrl,
  onRename,
  onRemove,
}: {
  readonly name: string;
  readonly url: string;
  readonly busy: boolean;
  readonly onSetUrl: (url: string) => void;
  readonly onRename: (to: string) => void;
  readonly onRemove: () => void;
}) {
  const [draft, setDraft] = useState(url);
  const [renaming, setRenaming] = useState<string | null>(null);

  if (renaming !== null) {
    return (
      <div className={styles.remoteRow}>
        <input
          className={styles.input}
          value={renaming}
          autoFocus
          onChange={(event) => setRenaming(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setRenaming(null);
            if (event.key === 'Enter' && renaming.trim() !== '' && renaming !== name) {
              onRename(renaming.trim());
              setRenaming(null);
            }
          }}
        />
        <div className={styles.remoteActions}>
          <button
            type="button"
            className={styles.iconButton}
            title="Cancel"
            onClick={() => setRenaming(null)}
          >
            <Icons.Close size={13} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.remoteRow}>
      <span className={styles.remoteName} title={name}>
        {name}
      </span>
      <input
        className={styles.input}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (draft.trim() !== url && draft.trim() !== '') onSetUrl(draft.trim());
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') setDraft(url);
        }}
      />
      <div className={styles.remoteActions}>
        <button
          type="button"
          className={styles.iconButton}
          title="Rename"
          onClick={() => setRenaming(name)}
        >
          <Icons.Rename size={13} />
        </button>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.danger}`}
          title="Remove"
          onClick={onRemove}
        >
          <Icons.Delete size={13} />
        </button>
      </div>
    </div>
  );
}
