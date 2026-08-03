import { migrate } from '@/services/db/migrations';
import { useSettingsStore, watchSystemTheme } from '@/stores/settingsStore';
import { setGitPath } from '@/services/wails';

/**
 * Work that must finish before the first render.
 *
 * The schema qualifies, and — since Phase 6.8 — so does the theme. Everything
 * else (repository list, layout) is loaded by the component that needs it, so
 * a slow read delays one panel rather than the whole window.
 *
 * **The theme is the exception to that rule for one reason: the flash.** Load
 * it after the first paint and a user on a light desktop watches the app
 * render fully dark and then switch, every launch. It is one indexed read and
 * it has to happen before anything is on screen.
 *
 * A failed migration is fatal and says so: running the app against a database
 * it does not understand would corrupt it slowly instead of failing fast. A
 * failed *settings* read is not — it falls back to defaults, because starting
 * in the wrong theme is better than not starting.
 */
export interface BootstrapResult {
  readonly ok: boolean;
  readonly detail: string;
}

export async function bootstrap(): Promise<BootstrapResult> {
  try {
    const outcome = await migrate();

    // After the migration, because the settings row lives in a table the
    // migration may have just created.
    try {
      await useSettingsStore.getState().load();
      watchSystemTheme();
      const { gitPath } = useSettingsStore.getState();
      // The Go service resets to "git" on every launch, so a configured path
      // has to be pushed back to it before the first command runs.
      if (gitPath !== '') await setGitPath(gitPath);
    } catch (cause) {
      console.warn('settings could not be loaded; using defaults', cause);
    }

    const detail =
      outcome.applied.length === 0
        ? `schema up to date at v${outcome.to}`
        : `migrated v${outcome.from} → v${outcome.to}: ${outcome.applied.join(', ')}`;
    return { ok: true, detail };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    console.error('database migration failed', cause);
    return { ok: false, detail: message };
  }
}
