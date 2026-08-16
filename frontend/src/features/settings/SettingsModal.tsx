import { useEffect, useState } from 'react';
import { Button } from '@/components/Button';
import { Icons } from '@/components/icons';
import { gitInfo, setGitPath, keychainAvailable, type GitInfo } from '@/services/wails';
import { showToast } from '@/stores/notificationStore';
import { useSettingsStore, type ThemeChoice } from '@/stores/settingsStore';
import styles from './SettingsModal.module.css';
import { useDialog } from '@/components/useDialog';
import { accentContrast, AA_NORMAL } from '@/services/theme/accent';

/**
 * Application settings (PLAN.md §9 item 8).
 *
 * A modal, like every other overlay in the app, rather than a route: settings
 * are always opened *from* somewhere and closed back to it, and a route would
 * make "where was I" a thing to restore.
 *
 * **Nothing here has a Save button.** Every control writes through on change —
 * theme applies instantly, the rest persists to the `preferences` table. A
 * panel with pending state has to answer what escape means, and the answer
 * people expect from a preferences window is "it already applied".
 *
 * The one exception is the git path, which is *validated* before it is kept:
 * a bad path there breaks every command in the app, so it is the one setting
 * that can be rejected.
 */
export function SettingsModal({ onClose }: { readonly onClose: () => void }) {
  const settings = useSettingsStore();
  const dialog = useDialog('Settings', onClose);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.panel}
        {...dialog}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <span>Settings</span>
          <button type="button" className={styles.close} onClick={onClose} title="Close">
            <Icons.Close size={14} />
          </button>
        </div>

        <div className={styles.body}>
          <Section
            title="Appearance"
            hint="Applies immediately. “System” follows the desktop's light/dark setting."
          >
            <Field label="Theme">
              <div className={styles.segmented}>
                {(['system', 'dark', 'light'] as const).map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    className={`${styles.segment} ${
                      settings.theme === choice ? styles.segmentActive : ''
                    }`}
                    onClick={() => settings.set({ theme: choice })}
                  >
                    {LABELS[choice]}
                  </button>
                ))}
              </div>
            </Field>
            {settings.theme === 'system' && (
              <p className={styles.note}>Currently showing the {settings.resolved} theme.</p>
            )}
            <Field label="Accent">
              <AccentPicker />
            </Field>
          </Section>

          <GitSection />

          <Section
            title="Editor"
            hint="Used by “Open File”. Leave empty to use whatever the OS opens the file with."
          >
            <Field label="Command">
              <input
                className={styles.input}
                placeholder="e.g. code -w"
                value={settings.editor}
                onChange={(event) => settings.set({ editor: event.target.value })}
              />
            </Field>
          </Section>

          <CredentialsSection />
        </div>
      </div>
    </div>
  );
}

const LABELS: Record<ThemeChoice, string> = {
  system: 'System',
  dark: 'Dark',
  light: 'Light',
};

/**
 * Presets plus a colour well, and a live readability figure (PLAN.md §11, 8.5).
 *
 * The readout is the part worth defending. 8.1 measured the app's own accent
 * failing WCAG AA on some surfaces, so *refusing* a dim colour would hold the
 * user to a standard the product does not meet — but offering a colour well
 * with no feedback at all invites picking a navy that renders the active tab
 * invisible against a dark panel. It reports; it does not enforce.
 *
 * Measured against `--bg-panel`, because accent-coloured text in this app is
 * overwhelmingly panel furniture: headers, the active tab, branch labels.
 */
function AccentPicker() {
  const settings = useSettingsStore();
  const current = settings.accent;
  const ratio = current === '' ? null : accentContrast(current, settings.resolved);

  return (
    <div className={styles.accentRow}>
      <button
        type="button"
        aria-pressed={current === ''}
        className={`${styles.segment} ${current === '' ? styles.segmentActive : ''}`}
        onClick={() => settings.set({ accent: '' })}
      >
        Default
      </button>

      {ACCENT_PRESETS.map((preset) => (
        <button
          key={preset.hex}
          type="button"
          title={preset.name}
          aria-label={preset.name}
          aria-pressed={current.toLowerCase() === preset.hex}
          className={`${styles.swatch} ${
            current.toLowerCase() === preset.hex ? styles.swatchOn : ''
          }`}
          style={{ background: preset.hex }}
          onClick={() => settings.set({ accent: preset.hex })}
        />
      ))}

      {/* The escape hatch from the presets. `value` needs a concrete colour, so
          "default" shows the theme's own rather than a black well. */}
      <input
        type="color"
        aria-label="Custom accent"
        className={styles.colorWell}
        value={current === '' ? THEME_ACCENT[settings.resolved] : current}
        onChange={(event) => settings.set({ accent: event.target.value })}
      />

      {ratio !== null && (
        <span className={ratio >= AA_NORMAL ? styles.note : styles.error}>
          {ratio.toFixed(1)}:1{ratio >= AA_NORMAL ? '' : ' — dim against the panel'}
        </span>
      )}
    </div>
  );
}

/** The shipped accents, so the colour well opens on the current colour. */
const THEME_ACCENT: Record<'dark' | 'light', string> = {
  dark: '#e8a838',
  light: '#9a6700',
};

const ACCENT_PRESETS = [
  { name: 'Amber', hex: '#e8a838' },
  { name: 'Blue', hex: '#58a6ff' },
  { name: 'Green', hex: '#3fb950' },
  { name: 'Purple', hex: '#bc8cff' },
  { name: 'Red', hex: '#f85149' },
  { name: 'Cyan', hex: '#56d4dd' },
] as const;

/**
 * The git binary, and proof that it works.
 *
 * This is the only setting that can be wrong in a way that breaks everything,
 * so it does not just store what was typed — it asks the Go service to resolve
 * the path and report the version, and keeps the value only if that succeeded.
 * A settings panel that accepts `/usr/bin/gti` and lets the user discover the
 * problem through every other screen failing is worse than no panel.
 */
function GitSection() {
  const settings = useSettingsStore();
  const [draft, setDraft] = useState(settings.gitPath);
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    gitInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  const apply = async () => {
    setChecking(true);
    setError(null);
    try {
      const resolved = await setGitPath(draft);
      setInfo(resolved);
      settings.set({ gitPath: draft });
      showToast(`Using git ${resolved.version}`, 'success');
    } catch (cause) {
      // The service refused it and kept the previous binary, so the app is
      // still working — this is a rejected input, not a broken install.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setChecking(false);
    }
  };

  return (
    <Section title="Git" hint="Leave empty to use the first git on PATH.">
      <Field label="Binary">
        <input
          className={styles.input}
          placeholder="/usr/bin/git"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void apply();
          }}
        />
        <Button size="sm" onClick={() => void apply()} disabled={checking}>
          {checking ? 'Checking…' : 'Apply'}
        </Button>
      </Field>
      {error !== null && <p className={styles.error}>{error}</p>}
      {info !== null && (
        <p className={styles.note}>
          {info.version} · <span className={styles.mono}>{info.path}</span>
        </p>
      )}
    </Section>
  );
}

/**
 * Credentials live in the OS keychain and nowhere else (`internal/creds`), so
 * this reports rather than edits: the place to revoke a stored secret is
 * Keychain Access, and duplicating that here would imply moonGit is holding a
 * copy it is not.
 *
 * What it *is* worth saying is whether the keychain is reachable at all — in a
 * locked or headless session every push fails, and finding that out once here
 * beats finding it out per push.
 */
function CredentialsSection() {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    keychainAvailable()
      .then(setAvailable)
      .catch(() => setAvailable(false));
  }, []);

  return (
    <Section
      title="Credentials"
      hint="Secrets are stored in the OS keychain, never in moonGit's database."
    >
      <p className={styles.note}>
        {available === null && 'Checking the keychain…'}
        {available === true &&
          'Keychain available. Stored credentials are managed in Keychain Access.'}
        {available === false &&
          'Keychain unavailable — pushes and pulls needing a password will fail until it is unlocked.'}
      </p>
    </Section>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {hint !== undefined && <p className={styles.hint}>{hint}</p>}
      {children}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldControl}>{children}</span>
    </label>
  );
}
