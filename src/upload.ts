/**
 * @file packages/reporter/src/upload.ts
 * @description Core upload function for the @dashwright/reporter package.
 *
 * Zips a Playwright report directory (default: `playwright-report/`) and
 * POSTs it to the DashWright `/api/local/upload` endpoint using multipart
 * form-data. Streams progress to stdout when `verbose` is true.
 *
 * Used by both the CLI (`cli.ts`) and the Playwright reporter plugin (`reporter.ts`).
 */

import fs from 'node:fs';
import path from 'node:path';

import type { ReporterConfig } from './config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for a single upload operation. */
export interface UploadOptions {
  /** Path to the directory to zip and upload. Defaults to `playwright-report`. */
  dir?: string;
  /** Dashboard design. Omitting uses the server default. */
  design?: string;
  /** Dashboard theme for the chosen design. */
  theme?: string;
  /** Human-readable label shown in history (e.g. `feat/my-branch`). */
  label?: string;
  /** Git branch name — stored in run metadata for future analytics. */
  branch?: string;
  /** Short commit SHA — stored in run metadata. */
  commit?: string;
  /** Arbitrary run identifier (e.g. CI job ID) — stored in metadata. */
  runId?: string;
  /**
   * Project/repo identifier. Each distinct value gets its own dashboard in the
   * DashWright project picker (e.g. `'my-api-service'`, `'web-frontend'`).
   * Falls back to the `DASHWRIGHT_PROJECT` environment variable.
   */
  project?: string;
  /**
   * Identity of the person who ran the tests (e.g. git username or CI actor).
   * Shown as "by {actor}" in run items in the generated dashboard.
   * Auto-detected from CI env vars when not supplied — see `detectCiMetadata`.
   */
  actor?: string;
  /** Print progress messages to stdout. Default: true. */
  verbose?: boolean;
}

/** Successful upload result. */
export interface UploadResult {
  sessionId: string;
  previewUrl: string;
  /** Full URL constructed from baseUrl + previewUrl for direct browser access. */
  dashboardUrl: string;
}

// ---------------------------------------------------------------------------
// Zip helper
// ---------------------------------------------------------------------------

/**
 * @function zipDirectory
 * @description Creates a ZIP archive of the given directory in memory.
 *
 * Uses the standard Node.js `zlib` + manual tar-like streaming instead of a
 * heavy dependency. In practice Playwright reports are already small (< 50 MB
 * compressed), so buffering is acceptable.
 *
 * We use a minimal ZIP implementation here to avoid adding a build dependency
 * on `archiver` or `jszip` to the reporter package. The server-side extraction
 * (`unzipper`) accepts standard ZIP archives.
 */
async function zipDirectory(dirPath: string): Promise<Buffer> {
  // Use dynamic import so the package doesn't hard-require archiver at module load.
  const { default: archiver } = await import('archiver');

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver('zip', { zlib: { level: 6 } });

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.directory(dirPath, false);
    archive.finalize();
  });
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * @function upload
 * @description Zips the Playwright report directory and uploads it to DashWright.
 *
 * @param config  - Resolved DashWright config (API key, base URL).
 * @param options - Upload options (dir, label, branch, etc.).
 * @returns Upload result containing the dashboard URL.
 * @throws When the directory is not found, or the server returns an error.
 */
export async function upload(
  config: ReporterConfig,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const {
    dir = 'playwright-report',
    design,
    theme,
    label,
    project = process.env.DASHWRIGHT_PROJECT,
    branch,
    commit,
    runId,
    actor,
    verbose = true,
  } = options;

  const resolvedDir = path.resolve(dir);

  if (!fs.existsSync(resolvedDir)) {
    throw new Error(
      `Report directory not found: ${resolvedDir}\n` +
      'Run `npx playwright test` first, or pass --dir to specify a different path.',
    );
  }

  if (verbose) process.stdout.write(`[DashWright] Zipping ${resolvedDir}...\n`);
  const zipBuffer = await zipDirectory(resolvedDir);
  if (verbose) {
    process.stdout.write(
      `[DashWright] Zip size: ${(zipBuffer.byteLength / 1024).toFixed(1)} KB\n`,
    );
  }

  const form = new FormData();
  // Uint8Array ensures the buffer is a compatible BlobPart across Node versions
  form.append('file', new Blob([new Uint8Array(zipBuffer)], { type: 'application/zip' }), 'report.zip');
  if (design) form.append('design', design);
  if (theme) form.append('theme', theme);
  if (label) form.append('label', label);
  if (project) form.append('project', project);
  if (branch) form.append('branch', branch);
  if (commit) form.append('commit', commit);
  if (runId) form.append('runId', runId);
  if (actor) form.append('actor', actor);

  const url = `${config.baseUrl}/api/local/upload`;
  if (verbose) process.stdout.write(`[DashWright] Uploading to ${url}...\n`);

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body: form,
  });

  if (!response.ok) {
    let errorMessage = `HTTP ${response.status}`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error) errorMessage = body.error;
    } catch {
      // Ignore parse failure — use the status code message
    }
    throw new Error(`[DashWright] Upload failed: ${errorMessage}`);
  }

  const result = await response.json() as { sessionId: string; previewUrl: string };
  const dashboardUrl = `${config.baseUrl}${result.previewUrl}`;

  if (verbose) {
    process.stdout.write(`[DashWright] Dashboard ready: ${dashboardUrl}\n`);
  }

  return { sessionId: result.sessionId, previewUrl: result.previewUrl, dashboardUrl };
}
