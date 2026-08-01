import { Cancel, Info, Run, RunStream, SetGitPath } from '../../../wailsjs/go/gitexec/Service';
import { onEvent } from './events';
import type {
  GitChunkEvent,
  GitInfo,
  GitRunRequest,
  GitRunResult,
  GitStreamRequest,
  GitStreamResult,
} from './types';

/** Run git and buffer the whole output. Use only where output is bounded. */
export function runGit(req: GitRunRequest): Promise<GitRunResult> {
  return Run(req);
}

export function gitInfo(): Promise<GitInfo> {
  return Info();
}

export function setGitPath(path: string): Promise<GitInfo> {
  return SetGitPath(path);
}

export function cancelGit(runId: string): Promise<boolean> {
  return Cancel(runId);
}

export interface StreamHandlers {
  /** Called for each chunk, in order. Chunks never split a record. */
  onChunk: (data: string, seq: number) => void;
  signal?: AbortSignal;
}

/**
 * Run git and receive stdout incrementally.
 *
 * This exists because `git log` on a large repository is hundreds of megabytes,
 * and returning that through a single RPC would stall the webview bridge
 * (PLAN.md §4.1). Chunks arrive as events while the returned promise stays
 * pending; it resolves once the process exits.
 *
 * Chunk ordering is guaranteed by the event bus, and `seq` is contiguous — a
 * gap means a dropped event, which is worth failing loudly on rather than
 * silently parsing a hole.
 */
export async function runGitStream(
  req: GitStreamRequest,
  { onChunk, signal }: StreamHandlers,
): Promise<GitStreamResult> {
  const runId = crypto.randomUUID();

  let expectedSeq = 0;
  const unsubscribe = onEvent<GitChunkEvent>(`git:chunk:${runId}`, (event) => {
    if (event.seq !== expectedSeq) {
      throw new Error(
        `git stream ${runId}: expected chunk ${expectedSeq}, got ${event.seq} — an event was dropped`,
      );
    }
    expectedSeq += 1;
    onChunk(event.data, event.seq);
  });

  const abort = () => void cancelGit(runId);
  signal?.addEventListener('abort', abort, { once: true });

  try {
    if (signal?.aborted) {
      // Already cancelled before we started; don't spawn the process at all.
      return {
        stderr: '',
        exitCode: -1,
        durationMs: 0,
        timedOut: false,
        canceled: true,
        bytesOut: 0,
        chunks: 0,
      };
    }
    return (await RunStream(runId, req));
  } finally {
    unsubscribe();
    signal?.removeEventListener('abort', abort);
  }
}
