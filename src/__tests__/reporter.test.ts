/**
 * @file packages/reporter/src/__tests__/reporter.test.ts
 * @description Unit tests for DashWrightReporter.onEnd() — covers the enabled flag,
 * missing API key handling, CI metadata detection, upload delegation, and non-fatal
 * upload failures.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FullResult } from '@playwright/test/reporter';

// ---------------------------------------------------------------------------
// Hoist mocks
// ---------------------------------------------------------------------------

const { resolveConfigMock, uploadMock } = vi.hoisted(() => ({
  resolveConfigMock: vi.fn(),
  uploadMock: vi.fn(),
}));

vi.mock('../config.js', () => ({ resolveConfig: resolveConfigMock }));
vi.mock('../upload.js', () => ({ upload: uploadMock }));

import { DashWrightReporter } from '../reporter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FULL_RESULT: FullResult = { status: 'passed', startTime: new Date(), duration: 1000 };
const RESOLVED_CONFIG = { apiKey: 'dw_test', baseUrl: 'https://app.dashwright.io' };

function makeReporter(options: ConstructorParameters<typeof DashWrightReporter>[0] = {}) {
  return new DashWrightReporter(options);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

describe('DashWrightReporter.onEnd', () => {
  // Declared as any to avoid fighting TypeScript's overload resolution for process.stderr.write
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stderrSpy: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    resolveConfigMock.mockReset();
    uploadMock.mockReset();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    resolveConfigMock.mockReturnValue(RESOLVED_CONFIG);
    uploadMock.mockResolvedValue({
      sessionId: 'sess-1',
      previewUrl: '/preview/sess-1',
      dashboardUrl: 'https://app.dashwright.io/preview/sess-1',
    });
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it('returns early without calling upload when enabled is false', async () => {
    const reporter = makeReporter({ enabled: false });
    await reporter.onEnd(FULL_RESULT);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(resolveConfigMock).not.toHaveBeenCalled();
  });

  it('writes to stderr and skips upload when resolveConfig throws (missing API key)', async () => {
    resolveConfigMock.mockImplementation(() => { throw new Error('API key not found'); });
    const reporter = makeReporter();
    await reporter.onEnd(FULL_RESULT);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('API key not found'),
    );
  });

  it('calls upload with the resolved config', async () => {
    const reporter = makeReporter({ apiKey: 'dw_explicit' });
    await reporter.onEnd(FULL_RESULT);
    expect(resolveConfigMock).toHaveBeenCalledWith({ apiKey: 'dw_explicit', baseUrl: undefined });
    expect(uploadMock).toHaveBeenCalledWith(RESOLVED_CONFIG, expect.any(Object));
  });

  it('passes explicit options to upload', async () => {
    const reporter = makeReporter({
      apiKey: 'dw_k',
      dir: 'my-report',
      design: 'aurora',
      theme: 'dark',
      label: 'feat/test',
      branch: 'feat/test',
      commit: 'abc1234',
      runId: '42',
      quiet: true,
    });
    await reporter.onEnd(FULL_RESULT);
    expect(uploadMock).toHaveBeenCalledWith(
      RESOLVED_CONFIG,
      expect.objectContaining({
        dir: 'my-report',
        design: 'aurora',
        theme: 'dark',
        label: 'feat/test',
        branch: 'feat/test',
        commit: 'abc1234',
        runId: '42',
        verbose: false, // quiet:true → verbose:false
      }),
    );
  });

  it('does not rethrow when upload throws — failure is non-fatal', async () => {
    uploadMock.mockRejectedValue(new Error('network failure'));
    const reporter = makeReporter();
    await expect(reporter.onEnd(FULL_RESULT)).resolves.toBeUndefined();
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('network failure'),
    );
  });

  describe('CI metadata auto-detection', () => {
    const ciEnvVars = [
      'GITHUB_REF_NAME',
      'CI_COMMIT_REF_NAME',
      'BUILD_SOURCEBRANCH',
      'CIRCLE_BRANCH',
      'BITBUCKET_BRANCH',
      'GIT_BRANCH',
      'GITHUB_SHA',
      'CI_COMMIT_SHORT_SHA',
      'BUILD_SOURCEVERSION',
      'CIRCLE_SHA1',
      'BITBUCKET_COMMIT',
      'GIT_COMMIT',
      'GITHUB_RUN_ID',
      'CI_PIPELINE_ID',
      'BUILD_BUILDID',
      'CIRCLE_BUILD_NUM',
      'BITBUCKET_BUILD_NUMBER',
    ];

    beforeEach(() => {
      ciEnvVars.forEach((v) => delete process.env[v]);
    });

    afterEach(() => {
      ciEnvVars.forEach((v) => delete process.env[v]);
    });

    it('auto-detects branch from GITHUB_REF_NAME', async () => {
      process.env.GITHUB_REF_NAME = 'feat/auto-branch';
      const reporter = makeReporter();
      await reporter.onEnd(FULL_RESULT);
      expect(uploadMock).toHaveBeenCalledWith(
        RESOLVED_CONFIG,
        expect.objectContaining({ branch: 'feat/auto-branch' }),
      );
    });

    it('auto-detects short commit from GITHUB_SHA (first 7 chars)', async () => {
      process.env.GITHUB_SHA = 'abcdef1234567';
      const reporter = makeReporter();
      await reporter.onEnd(FULL_RESULT);
      expect(uploadMock).toHaveBeenCalledWith(
        RESOLVED_CONFIG,
        expect.objectContaining({ commit: 'abcdef1' }),
      );
    });

    it('auto-detects runId from GITHUB_RUN_ID', async () => {
      process.env.GITHUB_RUN_ID = '12345678';
      const reporter = makeReporter();
      await reporter.onEnd(FULL_RESULT);
      expect(uploadMock).toHaveBeenCalledWith(
        RESOLVED_CONFIG,
        expect.objectContaining({ runId: '12345678' }),
      );
    });

    it('explicit branch option overrides CI env var', async () => {
      process.env.GITHUB_REF_NAME = 'ci-branch';
      const reporter = makeReporter({ branch: 'explicit-branch' });
      await reporter.onEnd(FULL_RESULT);
      expect(uploadMock).toHaveBeenCalledWith(
        RESOLVED_CONFIG,
        expect.objectContaining({ branch: 'explicit-branch' }),
      );
    });

    it('strips refs/heads/ from Azure BUILD_SOURCEBRANCH', async () => {
      process.env.BUILD_SOURCEBRANCH = 'refs/heads/main';
      const reporter = makeReporter();
      await reporter.onEnd(FULL_RESULT);
      expect(uploadMock).toHaveBeenCalledWith(
        RESOLVED_CONFIG,
        expect.objectContaining({ branch: 'main' }),
      );
    });
  });
});
