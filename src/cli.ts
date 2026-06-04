#!/usr/bin/env node
/**
 * @file packages/reporter/src/cli.ts
 * @description CLI entrypoint for the @dashwright/reporter package.
 *
 * Usage:
 *   DASHWRIGHT_API_KEY=dw_... dashwright-upload [options]
 *
 * Options:
 *   --dir <path>      Directory to upload (default: playwright-report)
 *   --project <name>  Project/repo identifier (groups runs in the project picker)
 *   --design <name>   Dashboard design
 *   --theme <name>    Design theme
 *   --label <text>    Human-readable label for history
 *   --branch <name>   Git branch name (stored in metadata)
 *   --commit <sha>    Short commit SHA (stored in metadata)
 *   --run-id <id>     Run identifier, e.g. CI job ID (stored in metadata)
 *   --actor <name>    Git/CI actor shown as "by {actor}" in the dashboard (auto-detected in CI)
 *   --api-key <key>   DashWright API key (overrides env var and config file)
 *   --base-url <url>  DashWright base URL (overrides env var and config file)
 *   --quiet           Suppress progress output
 *   --help            Show this help
 */

import process from 'node:process';
import { resolveConfig } from './config';
import { upload } from './upload';

// ---------------------------------------------------------------------------
// Minimal CLI argument parser
// No commander/yargs dependency — keeps the package lightweight.
// ---------------------------------------------------------------------------

interface ParsedArgs {
  dir?: string;
  project?: string;
  design?: string;
  theme?: string;
  label?: string;
  branch?: string;
  commit?: string;
  runId?: string;
  actor?: string;
  apiKey?: string;
  baseUrl?: string;
  quiet?: boolean;
  help?: boolean;
}

/**
 * @function parseArgs
 * @description Parses `--flag value` and `--flag=value` CLI arguments.
 */
function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [key, inlineValue] = arg.split('=');
    const value = inlineValue ?? argv[i + 1];

    switch (key) {
      case '--dir':       args.dir = value; if (!inlineValue) i++; break;
      case '--project':   args.project = value; if (!inlineValue) i++; break;
      case '--design':    args.design = value; if (!inlineValue) i++; break;
      case '--theme':     args.theme = value; if (!inlineValue) i++; break;
      case '--label':     args.label = value; if (!inlineValue) i++; break;
      case '--branch':    args.branch = value; if (!inlineValue) i++; break;
      case '--commit':    args.commit = value; if (!inlineValue) i++; break;
      case '--run-id':    args.runId = value; if (!inlineValue) i++; break;
      case '--actor':     args.actor = value; if (!inlineValue) i++; break;
      case '--api-key':   args.apiKey = value; if (!inlineValue) i++; break;
      case '--base-url':  args.baseUrl = value; if (!inlineValue) i++; break;
      case '--quiet':     args.quiet = true; break;
      case '--help':
      case '-h':          args.help = true; break;
    }
  }
  return args;
}

function printHelp(): void {
  process.stdout.write(`
Usage: dashwright-upload [options]

Upload a Playwright report directory to DashWright.

Options:
  --dir <path>       Directory to upload (default: playwright-report)
  --project <name>   Project/repo identifier (groups runs in the project picker)
  --design <name>    Dashboard design
  --theme <name>     Design theme
  --label <text>     Human-readable label shown in history
  --branch <name>    Git branch name (stored in metadata)
  --commit <sha>     Short commit SHA (stored in metadata)
  --run-id <id>      CI run identifier (stored in metadata)
  --actor <name>     Git/CI actor shown as "by {actor}" in the dashboard (auto-detected in CI)
  --api-key <key>    DashWright API key (overrides DASHWRIGHT_API_KEY env var)
  --base-url <url>   DashWright base URL (overrides DASHWRIGHT_BASE_URL env var)
  --quiet            Suppress progress output
  --help, -h         Show this help

Environment variables:
  DASHWRIGHT_API_KEY   Your DashWright API key (dw_...)
  DASHWRIGHT_BASE_URL  DashWright instance URL (default: https://app.dashwright.io)
  DASHWRIGHT_PROJECT   Project/repo identifier (overridden by --project)

Config file:
  ~/.dashwright/config.json  { "apiKey": "dw_...", "baseUrl": "..." }
`.trimStart());
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let config;
  try {
    config = resolveConfig({ apiKey: args.apiKey, baseUrl: args.baseUrl });
  } catch (err: unknown) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
    process.exit(1);
  }

  try {
    await upload(config, {
      dir: args.dir,
      project: args.project,
      design: args.design,
      theme: args.theme,
      label: args.label,
      branch: args.branch,
      commit: args.commit,
      runId: args.runId,
      actor: args.actor,
      verbose: !args.quiet,
    });
  } catch (err: unknown) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
    process.exit(1);
  }
}

main();
