/**
 * @file packages/reporter/src/__tests__/upload.test.ts
 * @description Unit tests for the upload() function — covers directory validation,
 * zip creation, FormData construction, fetch error handling, and success path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReporterConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Hoist mocks
// ---------------------------------------------------------------------------

const { existsSyncMock, archiveMock } = vi.hoisted(() => {
  const archiveMock = {
    on: vi.fn(),
    directory: vi.fn(),
    finalize: vi.fn(),
  };
  return {
    existsSyncMock: vi.fn<(p: string) => boolean>(),
    archiveMock,
  };
});

vi.mock('node:fs', () => ({
  default: { existsSync: existsSyncMock },
  existsSync: existsSyncMock,
}));

// Mock archiver — zipDirectory does a dynamic import('archiver')
vi.mock('archiver', () => ({
  default: vi.fn(() => archiveMock),
}));

import { upload } from '../upload.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIG: ReporterConfig = {
  apiKey: 'dw_test_key',
  baseUrl: 'https://app.dashwright.io',
};

function makeArchiverThatSucceeds(zipBytes = Buffer.from('fake-zip')) {
  archiveMock.on.mockImplementation((event: string, handler: (chunk?: Buffer) => void) => {
    if (event === 'data') {
      // Emit data synchronously after finalize is called
      archiveMock.finalize.mockImplementation(() => {
        handler(zipBytes);
        // Trigger 'end' after data
        const endHandler = archiveMock.on.mock.calls.find(
          (args: unknown[]) => args[0] === 'end',
        )?.[1] as (() => void) | undefined;
        endHandler?.();
      });
    }
  });
}

function makeFetchOk(body: object) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue(body),
  });
}

function makeFetchError(status: number, body?: object) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockResolvedValue(body ?? {}),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('upload', () => {
  beforeEach(() => {
    existsSyncMock.mockReset();
    archiveMock.on.mockReset();
    archiveMock.directory.mockReset();
    archiveMock.finalize.mockReset();
    vi.stubGlobal('fetch', undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('throws when the report directory does not exist', async () => {
    existsSyncMock.mockReturnValue(false);
    await expect(upload(CONFIG, { dir: 'no-such-dir', verbose: false })).rejects.toThrow(
      'Report directory not found',
    );
  });

  it('sends POST with Authorization header and returns dashboardUrl', async () => {
    existsSyncMock.mockReturnValue(true);
    makeArchiverThatSucceeds();
    const fetchMock = makeFetchOk({ sessionId: 'sess-123', previewUrl: '/preview/sess-123' });
    vi.stubGlobal('fetch', fetchMock);

    const result = await upload(CONFIG, { verbose: false });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://app.dashwright.io/api/local/upload');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer dw_test_key');
    expect(result.sessionId).toBe('sess-123');
    expect(result.previewUrl).toBe('/preview/sess-123');
    expect(result.dashboardUrl).toBe('https://app.dashwright.io/preview/sess-123');
  });

  it('throws with server error message on non-ok response', async () => {
    existsSyncMock.mockReturnValue(true);
    makeArchiverThatSucceeds();
    vi.stubGlobal('fetch', makeFetchError(422, { error: 'invalid design' }));

    await expect(upload(CONFIG, { verbose: false })).rejects.toThrow('invalid design');
  });

  it('throws with HTTP status when error response has no body.error', async () => {
    existsSyncMock.mockReturnValue(true);
    makeArchiverThatSucceeds();
    vi.stubGlobal('fetch', makeFetchError(500));

    await expect(upload(CONFIG, { verbose: false })).rejects.toThrow('HTTP 500');
  });

  it('appends optional fields to the FormData when provided', async () => {
    existsSyncMock.mockReturnValue(true);
    makeArchiverThatSucceeds();

    let capturedForm: FormData | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedForm = init.body as FormData;
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({ sessionId: 'x', previewUrl: '/p/x' }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await upload(CONFIG, {
      design: 'aurora',
      theme: 'dark',
      label: 'my-branch',
      branch: 'feat/foo',
      commit: 'abc1234',
      runId: '9999',
      verbose: false,
    });

    expect(capturedForm).toBeDefined();
    expect((capturedForm as FormData).get('design')).toBe('aurora');
    expect((capturedForm as FormData).get('theme')).toBe('dark');
    expect((capturedForm as FormData).get('label')).toBe('my-branch');
    expect((capturedForm as FormData).get('branch')).toBe('feat/foo');
    expect((capturedForm as FormData).get('commit')).toBe('abc1234');
    expect((capturedForm as FormData).get('runId')).toBe('9999');
  });

  it('does not append optional fields when they are omitted', async () => {
    existsSyncMock.mockReturnValue(true);
    makeArchiverThatSucceeds();

    let capturedForm: FormData | undefined;
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      capturedForm = init.body as FormData;
      return Promise.resolve({
        ok: true,
        json: vi.fn().mockResolvedValue({ sessionId: 'x', previewUrl: '/p/x' }),
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await upload(CONFIG, { verbose: false });

    expect((capturedForm as FormData).get('design')).toBeNull();
    expect((capturedForm as FormData).get('branch')).toBeNull();
  });
});
