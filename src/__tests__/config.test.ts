/**
 * @file packages/reporter/src/__tests__/config.test.ts
 * @description Unit tests for resolveConfig — covers the four-tier priority chain.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Hoist mocks
// ---------------------------------------------------------------------------

const { readFileSyncMock } = vi.hoisted(() => ({
  readFileSyncMock: vi.fn<(p: string, enc: string) => string>(),
}));

vi.mock('node:fs', () => ({
  default: { readFileSync: readFileSyncMock },
  readFileSync: readFileSyncMock,
}));

import { resolveConfig } from '../config.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CONFIG_FILE = path.join(os.homedir(), '.dashwright', 'config.json');

function mockConfigFile(contents: object) {
  readFileSyncMock.mockImplementation((p: string) => {
    if (p === CONFIG_FILE) return JSON.stringify(contents);
    throw new Error('ENOENT');
  });
}

function noConfigFile() {
  readFileSyncMock.mockImplementation(() => { throw new Error('ENOENT'); });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveConfig', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.DASHWRIGHT_API_KEY = process.env.DASHWRIGHT_API_KEY;
    savedEnv.DASHWRIGHT_BASE_URL = process.env.DASHWRIGHT_BASE_URL;
    delete process.env.DASHWRIGHT_API_KEY;
    delete process.env.DASHWRIGHT_BASE_URL;
    readFileSyncMock.mockReset();
    noConfigFile();
  });

  afterEach(() => {
    if (savedEnv.DASHWRIGHT_API_KEY !== undefined) {
      process.env.DASHWRIGHT_API_KEY = savedEnv.DASHWRIGHT_API_KEY;
    } else {
      delete process.env.DASHWRIGHT_API_KEY;
    }
    if (savedEnv.DASHWRIGHT_BASE_URL !== undefined) {
      process.env.DASHWRIGHT_BASE_URL = savedEnv.DASHWRIGHT_BASE_URL;
    } else {
      delete process.env.DASHWRIGHT_BASE_URL;
    }
  });

  it('throws when no API key is available from any source', () => {
    expect(() => resolveConfig()).toThrow('API key not found');
  });

  it('uses programmatic apiKey (tier 1)', () => {
    const cfg = resolveConfig({ apiKey: 'dw_prog' });
    expect(cfg.apiKey).toBe('dw_prog');
  });

  it('uses DASHWRIGHT_API_KEY env var (tier 2)', () => {
    process.env.DASHWRIGHT_API_KEY = 'dw_env';
    const cfg = resolveConfig();
    expect(cfg.apiKey).toBe('dw_env');
  });

  it('uses config file apiKey (tier 3)', () => {
    mockConfigFile({ apiKey: 'dw_file' });
    const cfg = resolveConfig();
    expect(cfg.apiKey).toBe('dw_file');
  });

  it('programmatic option overrides env var', () => {
    process.env.DASHWRIGHT_API_KEY = 'dw_env';
    const cfg = resolveConfig({ apiKey: 'dw_prog' });
    expect(cfg.apiKey).toBe('dw_prog');
  });

  it('env var overrides config file', () => {
    process.env.DASHWRIGHT_API_KEY = 'dw_env';
    mockConfigFile({ apiKey: 'dw_file' });
    const cfg = resolveConfig();
    expect(cfg.apiKey).toBe('dw_env');
  });

  it('uses default baseUrl when no baseUrl is configured', () => {
    const cfg = resolveConfig({ apiKey: 'dw_test' });
    expect(cfg.baseUrl).toBe('https://app.dashwright.io');
  });

  it('uses programmatic baseUrl', () => {
    const cfg = resolveConfig({ apiKey: 'dw_test', baseUrl: 'https://self.hosted' });
    expect(cfg.baseUrl).toBe('https://self.hosted');
  });

  it('uses DASHWRIGHT_BASE_URL env var for baseUrl', () => {
    process.env.DASHWRIGHT_BASE_URL = 'https://env.host';
    const cfg = resolveConfig({ apiKey: 'dw_test' });
    expect(cfg.baseUrl).toBe('https://env.host');
  });

  it('uses config file baseUrl', () => {
    mockConfigFile({ apiKey: 'dw_file', baseUrl: 'https://file.host' });
    const cfg = resolveConfig();
    expect(cfg.baseUrl).toBe('https://file.host');
  });

  it('strips trailing slash from baseUrl', () => {
    const cfg = resolveConfig({ apiKey: 'dw_test', baseUrl: 'https://self.hosted/' });
    expect(cfg.baseUrl).toBe('https://self.hosted');
  });

  it('ignores malformed config file and falls through to next tier', () => {
    readFileSyncMock.mockImplementation((p: string) => {
      if (p === CONFIG_FILE) return 'not-valid-json';
      throw new Error('ENOENT');
    });
    process.env.DASHWRIGHT_API_KEY = 'dw_env';
    const cfg = resolveConfig();
    expect(cfg.apiKey).toBe('dw_env');
  });
});
