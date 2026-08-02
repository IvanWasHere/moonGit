import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { blobService, isNullOid, type DiffFile } from '@/services/git';
import { readFileBase64 } from '@/services/wails';
import styles from './DiffPane.module.css';
import { imageTypeForPath } from './languages';

/**
 * Before and after for a picture.
 *
 * Git calls an image a binary file and refuses to diff it, which is correct and
 * useless — "Binary file, no textual diff" is exactly the case where a user
 * most wants to *see* the change. So the two versions are fetched as bytes and
 * shown side by side, with their dimensions and file sizes, which is where the
 * actual answer usually is (an asset re-exported at half resolution reads as
 * identical until the numbers are next to each other).
 *
 * The old side comes from the object database as base64 — not as text, because
 * results cross the Wails bridge as JSON and every byte that is not valid UTF-8
 * would be replaced by U+FFFD (`internal/gitexec/service.go`).
 */

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

interface ImageSide {
  readonly dataUri: string;
  readonly bytes: number;
}

async function loadSide(
  repoPath: string,
  oid: string,
  diskPath: string | null,
  mime: string,
  signal: AbortSignal,
): Promise<ImageSide | null> {
  if (!isNullOid(oid)) {
    const result = await blobService(repoPath).base64(oid, MAX_IMAGE_BYTES, { signal });
    if (!result.ok || result.value === null) return null;
    return { dataUri: `data:${mime};base64,${result.value}`, bytes: byteLength(result.value) };
  }
  if (diskPath === null) return null;

  try {
    const content = await readFileBase64(diskPath);
    if (content.base64 === undefined || content.truncated) return null;
    return { dataUri: `data:${mime};base64,${content.base64}`, bytes: content.size };
  } catch {
    return null;
  }
}

/** Decoded length of a base64 string, without decoding it. */
function byteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, (base64.length * 3) / 4 - padding);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ImageDiff({
  file,
  repoPath,
}: {
  readonly file: DiffFile;
  readonly repoPath: string;
}) {
  const mime = imageTypeForPath(file.path);

  const query = useQuery({
    queryKey: [repoPath, 'fileText', file.path, 'image', file.oldOid, file.newOid],
    queryFn: async ({ signal }) => {
      if (mime === null) return { before: null, after: null };
      const diskPath = file.kind === 'deleted' ? null : `${repoPath}/${file.path}`;
      const [before, after] = await Promise.all([
        loadSide(repoPath, file.oldOid, null, mime, signal),
        loadSide(repoPath, file.newOid, diskPath, mime, signal),
      ]);
      return { before, after };
    },
    enabled: mime !== null,
    staleTime: Infinity,
    retry: false,
  });

  if (mime === null) {
    return <div className={styles.notice}>Binary file — no textual diff</div>;
  }
  if (query.isPending) {
    return <div className={styles.notice}>Loading image…</div>;
  }
  const { before = null, after = null } = query.data ?? {};
  if (before === null && after === null) {
    return <div className={styles.notice}>Image too large to preview</div>;
  }

  return (
    <div className={styles.images}>
      <ImagePane label="Before" side={before} />
      <ImagePane label="After" side={after} />
    </div>
  );
}

function ImagePane({ label, side }: { readonly label: string; readonly side: ImageSide | null }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  if (side === null) {
    return (
      <div className={styles.imagePane}>
        <div className={styles.imageLabel}>{label}</div>
        <div className={styles.imageAbsent}>None</div>
      </div>
    );
  }

  return (
    <div className={styles.imagePane}>
      <div className={styles.imageLabel}>{label}</div>
      <img
        className={styles.image}
        src={side.dataUri}
        alt={label}
        // Dimensions are read off the loaded element rather than by decoding
        // the file, so one code path covers every format the webview supports —
        // including SVG, which has no pixel dimensions to parse at all.
        onLoad={(event) => {
          const img = event.currentTarget;
          setSize({ width: img.naturalWidth, height: img.naturalHeight });
        }}
      />
      <div className={styles.imageMeta}>
        {size !== null && `${size.width} × ${size.height} · `}
        {formatBytes(side.bytes)}
      </div>
    </div>
  );
}
