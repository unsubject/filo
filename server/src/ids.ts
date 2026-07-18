/**
 * ID generation and filename helpers.
 */

/** Generate a URL-safe unique id (crypto.randomUUID is available in Workers). */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

/** Auto-title a new document by timestamp (spec §4.4). */
export function timestampTitle(now: number): string {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/**
 * Build a safe download filename from a document title + seal timestamp
 * (spec §5.3 export semantics). Strips path/control characters, collapses
 * whitespace, and always ends in `.md`.
 */
export function safeExportFilename(title: string, sealedAt: number): string {
  const base = (title || 'document')
    .normalize('NFKC')
    // Drop ASCII control characters unsafe in filenames / headers.
    .replace(/[\u0000-\u001f\u007f]/g, '')
    // Replace path-unsafe characters.
    .replace(/[/\\:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  const safeBase = base.length > 0 ? base : 'document';
  const d = new Date(sealedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  return `${safeBase}-${stamp}.md`;
}
