#!/usr/bin/env node
// `pnpm tutorial:analyse` — the Phase 1 analysis is a hand-written
// investigation (docs/tutorial-video/application-analysis.md), not
// something regenerated on every run. This prints it so it's easy to
// review from the command line; to update it, re-investigate the app and
// edit the file directly (see "Updating the tutorial after application
// changes" in tutorials/README.md).

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ANALYSIS_PATH = path.join(REPO_ROOT, 'docs/tutorial-video/application-analysis.md');

const content = await fs.readFile(ANALYSIS_PATH, 'utf8').catch(() => null);
if (content === null) {
  console.error(`Not found: ${ANALYSIS_PATH}`);
  console.error('Run the Phase 1 investigation and write this file before continuing.');
  process.exitCode = 1;
} else {
  console.log(content);
}
