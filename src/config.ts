/**
 * @file packages/reporter/src/config.ts
 * @description Configuration loader for the @dashwright/reporter package.
 *
 * Priority (highest to lowest):
 *   1. CLI arguments / programmatic options
 *   2. Environment variables (`DASHWRIGHT_API_KEY`, `DASHWRIGHT_BASE_URL`)
 *   3. Config file (`~/.dashwright/config.json`)
 *   4. Defaults
 *
 * The config file is optional. Missing keys fall through to the next tier.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Default DashWright service URL — overridden by env or config file for self-hosted. */
const DEFAULT_BASE_URL = 'https://app.dashwright.io';

/** Config file location: `~/.dashwright/config.json` */
const CONFIG_FILE_PATH = path.join(os.homedir(), '.dashwright', 'config.json');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Persisted config file shape (`~/.dashwright/config.json`). */
export interface ConfigFile {
  apiKey?: string;
  baseUrl?: string;
}

/** Resolved configuration used at runtime. All fields are required after resolution. */
export interface ReporterConfig {
  /** DashWright API key (`dw_...`). Required for all operations. */
  apiKey: string;
  /** Base URL of the DashWright instance. */
  baseUrl: string;
}

/**
 * Options that callers may pass programmatically or via CLI flags.
 * Any set key takes priority over env vars and the config file.
 */
export interface ConfigOptions {
  apiKey?: string;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * @function readConfigFile
 * @description Reads `~/.dashwright/config.json`, ignoring any parse/read errors.
 * Returns an empty object when the file is missing or malformed.
 */
function readConfigFile(): ConfigFile {
  try {
    const raw = fs.readFileSync(CONFIG_FILE_PATH, 'utf-8');
    return JSON.parse(raw) as ConfigFile;
  } catch {
    return {};
  }
}

/**
 * @function resolveConfig
 * @description Merges configuration from all tiers and returns a resolved config.
 * Throws when `apiKey` cannot be resolved from any source — an API key is always required.
 *
 * @param options - Caller-supplied options (highest priority).
 * @throws When no `apiKey` is available from any source.
 */
export function resolveConfig(options: ConfigOptions = {}): ReporterConfig {
  const file = readConfigFile();

  const apiKey =
    options.apiKey ||
    process.env.DASHWRIGHT_API_KEY ||
    file.apiKey;

  if (!apiKey) {
    throw new Error(
      'DashWright API key not found.\n' +
      'Set DASHWRIGHT_API_KEY env var, pass --api-key, or add "apiKey" to ~/.dashwright/config.json.',
    );
  }

  const baseUrl = (
    options.baseUrl ||
    process.env.DASHWRIGHT_BASE_URL ||
    file.baseUrl ||
    DEFAULT_BASE_URL
  ).replace(/\/$/, '');

  return { apiKey, baseUrl };
}
