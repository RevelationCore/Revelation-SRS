#!/usr/bin/env node
// Phase 9: automated quality checks over the generated tutorial assets.
// Exits non-zero (and prints every failure, not just the first) if
// anything required is missing or inconsistent.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDuration, probeStreams } from './lib/ffmpeg.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS_DIR = path.join(REPO_ROOT, 'docs/tutorial-video');
const GEN_DIR = path.join(REPO_ROOT, 'tutorials/generated');
const OUTPUT_DIR = path.join(REPO_ROOT, 'tutorials/output');

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}
function warn(message) {
  warnings.push(message);
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function checkNarrationScenes() {
  const jsonPath = path.join(DOCS_DIR, 'overview-narration.json');
  if (!(await exists(jsonPath))) {
    fail(`Missing narration script: ${jsonPath}`);
    return null;
  }
  const narration = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  if (!Array.isArray(narration.scenes) || narration.scenes.length === 0) {
    fail(`${jsonPath} has no scenes`);
    return null;
  }
  for (const scene of narration.scenes) {
    if (!scene.id || !scene.narration || !scene.estimatedDurationSeconds) {
      fail(`Narration scene missing required fields: ${JSON.stringify(scene)}`);
    }
  }
  return narration;
}

async function checkAudioFiles(narration) {
  const manifestPath = path.join(GEN_DIR, 'audio/manifest.json');
  if (!(await exists(manifestPath))) {
    fail(`Missing audio manifest: ${manifestPath} — run "pnpm tutorial:narrate" first`);
    return null;
  }
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  if (narration && manifest.scenes.length !== narration.scenes.length) {
    fail(`Audio manifest has ${manifest.scenes.length} scenes but narration script has ${narration.scenes.length}`);
  }
  for (const scene of manifest.scenes) {
    const filePath = path.join(REPO_ROOT, scene.file);
    if (!(await exists(filePath))) {
      fail(`Missing audio file for ${scene.id}: ${filePath}`);
      continue;
    }
    const stat = await fs.stat(filePath);
    if (stat.size === 0) fail(`Audio file for ${scene.id} is empty: ${filePath}`);
  }
  const combined = path.join(GEN_DIR, 'audio/combined.mp3');
  if (!(await exists(combined))) fail(`Missing combined narration track: ${combined}`);
  return manifest;
}

function parseTimestamp(ts) {
  const [h, m, rest] = ts.split(':');
  const s = parseFloat(rest.replace(',', '.'));
  return Number(h) * 3600 + Number(m) * 60 + s;
}

async function checkCaptionTiming(label, filePath, timestampPattern) {
  if (!(await exists(filePath))) {
    fail(`Missing caption file: ${filePath}`);
    return;
  }
  const content = await fs.readFile(filePath, 'utf8');
  const matches = [...content.matchAll(timestampPattern)];
  if (matches.length === 0) {
    fail(`${label} has no caption cues: ${filePath}`);
    return;
  }
  let prevEnd = -1;
  for (const match of matches) {
    const start = parseTimestamp(match[1]);
    const end = parseTimestamp(match[2]);
    if (end <= start) fail(`${label}: cue end (${match[2]}) is not after start (${match[1]})`);
    if (start < prevEnd - 0.01) fail(`${label}: cue starting at ${match[1]} overlaps the previous cue`);
    prevEnd = end;
  }
}

async function checkRecording() {
  const testResultsDir = path.join(GEN_DIR, 'test-results');
  const found = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.webm')) found.push(full);
    }
  }
  await walk(testResultsDir);
  if (found.length === 0) {
    fail(`No recorded video found under ${testResultsDir} — run "pnpm tutorial:record" first`);
    return;
  }
  for (const file of found) {
    const duration = await getDuration(file).catch(() => 0);
    if (duration <= 0) fail(`Recorded video has zero/invalid duration: ${file}`);
  }

  const consoleErrorsPath = path.join(GEN_DIR, 'checkpoints/console-errors.json');
  if (await exists(consoleErrorsPath)) {
    const data = JSON.parse(await fs.readFile(consoleErrorsPath, 'utf8'));
    if (data.consoleErrorCount > 0) {
      warn(`Recording captured ${data.consoleErrorCount} browser console error(s) — see ${consoleErrorsPath}`);
    }
  } else {
    warn(`No console-errors.json found (expected from the automation spec) — cannot confirm the app logged no errors`);
  }

  const expectedCheckpoints = [
    'scene-03-dashboard.png',
    'scene-04-my-modules-before.png',
    'scene-05-browse-modules.png',
    'scene-06-confirm-prompt.png',
    'scene-08-registration-confirmed.png',
    'scene-09-notifications.png',
    'scene-09-timetable.png',
  ];
  for (const name of expectedCheckpoints) {
    const p = path.join(GEN_DIR, 'checkpoints', name);
    if (!(await exists(p))) fail(`Missing checkpoint screenshot: ${p} — a storyboard step likely failed silently`);
  }
}

async function checkFinalOutputs() {
  const required = [
    'application-overview.mp4',
    'application-overview-captioned.mp4',
    'application-overview.vtt',
    'application-overview.srt',
  ];
  const durations = {};
  for (const name of required) {
    const p = path.join(OUTPUT_DIR, name);
    if (!(await exists(p))) {
      fail(`Missing required final output: ${p}`);
      continue;
    }
    const stat = await fs.stat(p);
    if (stat.size === 0) {
      fail(`Final output is empty: ${p}`);
      continue;
    }
    if (name.endsWith('.mp4')) {
      const info = await probeStreams(p);
      if (!info.hasVideo) fail(`${p} has no video stream`);
      if (!info.hasAudio) fail(`${p} has no audio stream`);
      durations[name] = info.duration;
    }
  }

  if (durations['application-overview.mp4'] && durations['application-overview-captioned.mp4']) {
    const diff = Math.abs(durations['application-overview.mp4'] - durations['application-overview-captioned.mp4']);
    if (diff > 1) {
      fail(
        `Duration mismatch between application-overview.mp4 (${durations['application-overview.mp4'].toFixed(2)}s) ` +
          `and application-overview-captioned.mp4 (${durations['application-overview-captioned.mp4'].toFixed(2)}s)`,
      );
    }
  }
}

async function checkForSecrets() {
  const scanDirs = ['tutorials/setup', 'tutorials/automation', 'tutorials/scripts'];
  const secretPatterns = [
    { name: 'OpenAI-style API key', pattern: /sk-[A-Za-z0-9]{20,}/ },
    { name: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
    { name: 'generic bearer token literal', pattern: /Bearer [A-Za-z0-9._-]{25,}/ },
  ];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(path.join(REPO_ROOT, dir), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(rel);
      else if (/\.(mjs|ts|js|json)$/.test(entry.name)) {
        const content = await fs.readFile(path.join(REPO_ROOT, rel), 'utf8');
        for (const { name, pattern } of secretPatterns) {
          if (pattern.test(content)) fail(`Possible hard-coded ${name} found in ${rel}`);
        }
      }
    }
  }
  for (const dir of scanDirs) await walk(dir);
}

async function main() {
  const narration = await checkNarrationScenes();
  await checkAudioFiles(narration);
  await checkCaptionTiming(
    'generated/captions/overview.vtt',
    path.join(GEN_DIR, 'captions/overview.vtt'),
    /(\d\d:\d\d:\d\d\.\d\d\d) --> (\d\d:\d\d:\d\d\.\d\d\d)/g,
  );
  await checkCaptionTiming(
    'generated/captions/overview.srt',
    path.join(GEN_DIR, 'captions/overview.srt'),
    /(\d\d:\d\d:\d\d,\d\d\d) --> (\d\d:\d\d:\d\d,\d\d\d)/g,
  );
  await checkRecording();
  await checkFinalOutputs();
  if (await exists(path.join(OUTPUT_DIR, 'application-overview.vtt'))) {
    await checkCaptionTiming(
      'output/application-overview.vtt',
      path.join(OUTPUT_DIR, 'application-overview.vtt'),
      /(\d\d:\d\d:\d\d\.\d\d\d) --> (\d\d:\d\d:\d\d\.\d\d\d)/g,
    );
  }
  await checkForSecrets();

  console.log(`\nQuality check: ${failures.length} failure(s), ${warnings.length} warning(s).`);
  for (const w of warnings) console.log(`  WARN  ${w}`);
  for (const f of failures) console.log(`  FAIL  ${f}`);

  if (failures.length > 0) {
    process.exitCode = 1;
  } else {
    console.log('\nAll quality checks passed.');
  }
}

main().catch((error) => {
  console.error('\nQuality check crashed:', error.message);
  process.exitCode = 1;
});
