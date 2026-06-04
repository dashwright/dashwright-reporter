/**
 * @file packages/reporter/src/reporter.ts
 * @description Playwright reporter plugin for @dashwright/reporter.
 *
 * Automatically uploads the Playwright HTML report to DashWright after each
 * test run. Add to `playwright.config.ts`:
 *
 *   reporter: [
 *     ['html'],
 *     ['@dashwright/reporter', { apiKey: process.env.DASHWRIGHT_API_KEY }],
 *   ]
 *
 * The `html` reporter must run before this one (ordering in the array) so that
 * `playwright-report/` is written before `onEnd` is called.
 *
 * Configuration options (all optional — see ConfigOptions):
 *   apiKey    DashWright API key (`dw_...`). Falls back to DASHWRIGHT_API_KEY env var.
 *   baseUrl   DashWright base URL. Falls back to DASHWRIGHT_BASE_URL env var.
 *   dir       Report directory (default: `playwright-report`).
 *   design    Dashboard design.
 *   theme     Dashboard theme.
 *   label     Human-readable label for history.
 *   branch    Git branch (default: git HEAD branch via env/git command).
 *   commit    Short commit SHA.
 *   runId     CI run ID.
 *   quiet     Suppress upload output.
 *   enabled   Set to `false` to disable the reporter without removing it from config.
 */

import type { Reporter, FullResult } from '@playwright/test/reporter';
import { resolveConfig, type ConfigOptions } from './config';
import { upload } from './upload';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options accepted by the DashWright reporter plugin. */
export interface DashWrightReporterOptions extends ConfigOptions {
  /** Report directory to upload (default: `playwright-report`). */
  dir?: string;
  /** Dashboard design name. */
  design?: string;
  /** Design theme. */
  theme?: string;
  /** Human-readable label. Defaults to CI environment info if detectable. */
  label?: string;
  /**
   * Project/repo identifier. Each distinct value appears as a separate entry
   * in the DashWright project picker (e.g. `'my-api-service'`).
   * Falls back to the `DASHWRIGHT_PROJECT` environment variable.
   */
  project?: string;
  /** Git branch. Auto-detected from common CI env vars when not supplied. */
  branch?: string;
  /** Short commit SHA. Auto-detected from common CI env vars when not supplied. */
  commit?: string;
  /** CI run identifier. Auto-detected from common CI env vars when not supplied. */
  runId?: string;
  /**
   * Identity of the person who ran the tests (git user / CI actor).
   * Auto-detected from common CI env vars (`GITHUB_ACTOR`, `GITLAB_USER_LOGIN`,
   * `BUILD_REQUESTEDFOR`) when not supplied.
   * Shown as "by {actor}" in run items in the generated dashboard.
   */
  actor?: string;
  /** Suppress upload progress output. Default: false. */
  quiet?: boolean;
  /**
   * Set to `false` to disable this reporter without removing it from the config.
   * Useful for conditional enablement: `enabled: !!process.env.DASHWRIGHT_API_KEY`.
   * Default: true.
   */
  enabled?: boolean;
}

// ---------------------------------------------------------------------------
// CI environment detection
// ---------------------------------------------------------------------------

/**
 * @function detectCiMetadata
 * @description Reads common CI environment variables to auto-populate branch,
 * commit SHA, and run ID when they are not supplied by the user.
 *
 * Supported CI environments: GitHub Actions, GitLab CI, Azure Pipelines,
 * CircleCI, Bitbucket Pipelines, Jenkins, and the DASHWRIGHT_* overrides.
 */
function detectCiMetadata(): { branch?: string; commit?: string; runId?: string; actor?: string } {
  const branch =
    process.env.GITHUB_REF_NAME ||         // GitHub Actions
    process.env.CI_COMMIT_REF_NAME ||       // GitLab CI
    process.env.BUILD_SOURCEBRANCH?.replace('refs/heads/', '') || // Azure Pipelines
    process.env.CIRCLE_BRANCH ||            // CircleCI
    process.env.BITBUCKET_BRANCH ||         // Bitbucket
    process.env.GIT_BRANCH;                 // Jenkins

  const commit =
    process.env.GITHUB_SHA?.slice(0, 7) ||
    process.env.CI_COMMIT_SHORT_SHA ||
    process.env.BUILD_SOURCEVERSION?.slice(0, 7) ||
    process.env.CIRCLE_SHA1?.slice(0, 7) ||
    process.env.BITBUCKET_COMMIT?.slice(0, 7) ||
    process.env.GIT_COMMIT?.slice(0, 7);

  const runId =
    process.env.GITHUB_RUN_ID ||
    process.env.CI_PIPELINE_ID ||
    process.env.BUILD_BUILDID ||
    process.env.CIRCLE_BUILD_NUM ||
    process.env.BITBUCKET_BUILD_NUMBER;

  // Actor: person who triggered the CI run. Used to show "by {actor}" in the dashboard.
  const actor =
    process.env.GITHUB_ACTOR ||            // GitHub Actions
    process.env.GITLAB_USER_LOGIN ||        // GitLab CI (username)
    process.env.GITLAB_USER_NAME ||         // GitLab CI (full name)
    process.env.BUILD_REQUESTEDFOR ||       // Azure Pipelines
    process.env.CIRCLE_USERNAME;            // CircleCI

  return { branch, commit, runId, actor };
}

// ---------------------------------------------------------------------------
// Reporter implementation
// ---------------------------------------------------------------------------

/**
 * @class DashWrightReporter
 * @implements {Reporter}
 * @description Playwright reporter that uploads the HTML report to DashWright
 * automatically after each test run.
 */
export class DashWrightReporter implements Reporter {
  private readonly options: DashWrightReporterOptions;

  constructor(options: DashWrightReporterOptions = {}) {
    this.options = options;
  }

  // onBegin/onTestBegin/onTestEnd are intentionally not implemented —
  // we only need the final result in `onEnd`.
  onBegin(): void {}
  onTestBegin(): void {}
  onTestEnd(): void {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async onEnd(_result: FullResult): Promise<void> {
    // Respect the `enabled` flag — allows conditional disabling without config changes
    if (this.options.enabled === false) return;

    let config;
    try {
      config = resolveConfig({
        apiKey: this.options.apiKey,
        baseUrl: this.options.baseUrl,
      });
    } catch (err: unknown) {
      // Missing API key — skip silently with a warning so missing config doesn't
      // break CI runs that don't have the key set yet.
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[DashWright] Skipping upload: ${msg}\n`);
      return;
    }

    const ciMeta = detectCiMetadata();

    try {
      await upload(config, {
        dir: this.options.dir,
        design: this.options.design,
        theme: this.options.theme,
        label: this.options.label,
        project: this.options.project,
        branch: this.options.branch || ciMeta.branch,
        commit: this.options.commit || ciMeta.commit,
        runId: this.options.runId || ciMeta.runId,
        actor: this.options.actor || ciMeta.actor,
        verbose: !this.options.quiet,
      });
    } catch (err: unknown) {
      // Upload failures are non-fatal — they should never cause the test run to
      // appear as a failure in CI. Log the error and continue.
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[DashWright] Upload failed (non-fatal): ${msg}\n`);
    }
  }
}

// Default export required by Playwright's reporter loader
export default DashWrightReporter;
