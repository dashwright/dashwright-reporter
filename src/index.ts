/**
 * @file packages/reporter/src/index.ts
 * @description Public API for @dashwright/reporter.
 *
 * Re-exports the reporter class, upload function, and config utilities so
 * consumers can import everything from a single entry point.
 */

export { DashWrightReporter } from './reporter';
export { upload } from './upload';
export { resolveConfig } from './config';
export type { UploadOptions, UploadResult } from './upload';
export type { ReporterConfig, ConfigOptions, ConfigFile } from './config';
export type { DashWrightReporterOptions } from './reporter';

// Default export = the reporter class (Playwright loads it via `default`)
export { DashWrightReporter as default } from './reporter';
