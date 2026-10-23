#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { USAGE, UsageError, exitCode, parseCli } from '../src/args.js';
import { migrate } from '../src/migrate.js';
import { formatText } from '../src/report.js';

let opts;
try {
  opts = parseCli(process.argv.slice(2));
} catch (e) {
  process.stderr.write(`${e instanceof UsageError || e.code?.startsWith('ERR_PARSE_ARGS') ? e.message : e.stack}\n\n${USAGE}`);
  process.exit(64);
}
if (opts.help) { process.stdout.write(USAGE); process.exit(0); }

const report = await migrate(opts, (m) => process.stderr.write(`${m}\n`));
const text = formatText(report);
await mkdir(opts.reportDir, { recursive: true });
const stamp = report.startedAt.replace(/[:.]/g, '-');
const base = path.join(opts.reportDir, `${opts.targetDb}-${stamp}`);
await writeFile(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
await writeFile(`${base}.txt`, `${text}\n`);
process.stdout.write(`${text}\n\nReportes: ${base}.json, ${base}.txt\n`);
process.exit(exitCode(report.status));
