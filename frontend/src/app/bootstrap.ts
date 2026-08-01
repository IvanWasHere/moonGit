import { migrate } from '@/services/db/migrations';

/**
 * Work that must finish before the first render.
 *
 * Only the schema qualifies. Everything else — repository list, preferences,
 * layout — is loaded by the component that needs it, so a slow read delays one
 * panel rather than the whole window.
 *
 * A failed migration is fatal and says so: running the app against a database
 * it does not understand would corrupt it slowly instead of failing fast.
 */
export interface BootstrapResult {
  readonly ok: boolean;
  readonly detail: string;
}

export async function bootstrap(): Promise<BootstrapResult> {
  try {
    const outcome = await migrate();
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
