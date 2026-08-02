#!/usr/bin/env node
// Phase 7: assembles the final tutorial video from the raw Playwright
// screen recording (tutorials/generated/test-results/**/video.webm) and
// the narration audio/captions built by generate-narration.mjs.
//
// Produces, under tutorials/output/:
//   application-overview.mp4             opening card + demo + closing card, narrated
//   application-overview-captioned.mp4   the same, with burned-in captions
//   application-overview.vtt             final, duration-synced captions
//   application-overview.srt             final, duration-synced captions
//
// Uses ffmpeg-static (bundled binary) via tutorials/scripts/lib/ffmpeg.mjs
// — no system ffmpeg installation required.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ffmpeg, getDuration, probeStreams } from './lib/ffmpeg.mjs';
import { findTitleFont } from './lib/fonts.mjs';
import { buildSrt, buildVtt } from './lib/captions.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GEN_DIR = path.join(REPO_ROOT, 'tutorials/generated');
const AUDIO_DIR = path.join(GEN_DIR, 'audio');
const TMP_DIR = path.join(GEN_DIR, 'tmp');
const TEST_RESULTS_DIR = path.join(GEN_DIR, 'test-results');
const OUTPUT_DIR = path.join(REPO_ROOT, 'tutorials/output');

const APP_TITLE = 'Revelation SRS';
const APP_SUBTITLE = 'Student Portal — Overview';
const CLOSING_SUMMARY = 'Sign in, manage your modules, stay on top of everything else.';
const RESOLUTION = { width: 1920, height: 1080 };
const FPS = 30;
const BACKGROUND = '0x1e1b4b'; // deep indigo — matches the app's accent colour

function escapeFilterPath(p) {
  return p.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

async function findLatestRawRecording() {
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
      else if (entry.isFile() && entry.name.endsWith('.webm')) {
        const stat = await fs.stat(full);
        found.push({ full, mtime: stat.mtimeMs });
      }
    }
  }
  await walk(TEST_RESULTS_DIR);
  if (found.length === 0) {
    throw new Error(
      `No recorded video found under ${TEST_RESULTS_DIR}. Run "pnpm tutorial:record" first to produce the screen recording.`,
    );
  }
  found.sort((a, b) => b.mtime - a.mtime);
  return found[0].full;
}

async function renderTitleCard({ outFile, duration, lines }) {
  const font = await findTitleFont();
  const drawtextFilters = [];
  for (const [i, line] of lines.entries()) {
    const txtFile = path.join(TMP_DIR, `${path.basename(outFile, '.mp4')}-line-${i}.txt`);
    await fs.writeFile(txtFile, line.text);
    drawtextFilters.push(
      `drawtext=fontfile='${escapeFilterPath(font)}':textfile='${escapeFilterPath(txtFile)}':` +
        `fontcolor=${line.color}:fontsize=${line.fontsize}:x=(w-text_w)/2:y=${line.y}`,
    );
  }
  await ffmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=${BACKGROUND}:s=${RESOLUTION.width}x${RESOLUTION.height}:d=${duration}:r=${FPS}`,
    '-vf', drawtextFilters.join(','),
    '-t', String(duration),
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-an',
    outFile,
  ]);
}

async function normalizeVideo(inputFile, outFile) {
  await ffmpeg([
    '-y',
    '-i', inputFile,
    '-vf', `scale=${RESOLUTION.width}:${RESOLUTION.height}:force_original_aspect_ratio=decrease,pad=${RESOLUTION.width}:${RESOLUTION.height}:(ow-iw)/2:(oh-ih)/2,fps=${FPS}`,
    '-pix_fmt', 'yuv420p',
    '-c:v', 'libx264',
    '-an',
    outFile,
  ]);
}

async function concatVideos(files, outFile) {
  const inputArgs = files.flatMap((f) => ['-i', f]);
  const filterInputs = files.map((_, i) => `[${i}:v]`).join('');
  const filter = `${filterInputs}concat=n=${files.length}:v=1:a=0[outv]`;
  await ffmpeg(['-y', ...inputArgs, '-filter_complex', filter, '-map', '[outv]', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', outFile]);
}

async function padOrTrimAudioToDuration(inputFile, targetSeconds, outFile) {
  await ffmpeg([
    '-y',
    '-i', inputFile,
    '-af', `apad,atrim=0:${targetSeconds},asetpts=PTS-STARTPTS`,
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    outFile,
  ]);
}

async function concatAudios(files, outFile, { normalize = false } = {}) {
  const inputArgs = files.flatMap((f) => ['-i', f]);
  const filterInputs = files.map((_, i) => `[${i}:a]`).join('');
  const loud = normalize ? ',loudnorm=I=-16:TP=-1.5:LRA=11' : '';
  const filter = `${filterInputs}concat=n=${files.length}:v=0:a=1${loud}[outa]`;
  await ffmpeg(['-y', ...inputArgs, '-filter_complex', filter, '-map', '[outa]', '-c:a', 'libmp3lame', '-b:a', '192k', outFile]);
}

async function main() {
  await fs.mkdir(TMP_DIR, { recursive: true });
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const manifestPath = path.join(AUDIO_DIR, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const scenes = manifest.scenes;
  if (scenes.length < 3) throw new Error(`Expected at least 3 narration scenes in ${manifestPath}`);

  const opening = scenes[0];
  const closing = scenes[scenes.length - 1];
  const middleScenes = scenes.slice(1, -1);

  console.log('Locating raw screen recording...');
  const rawRecording = await findLatestRawRecording();
  const middleVideoDuration = await getDuration(rawRecording);
  console.log(`  ${rawRecording} (${middleVideoDuration.toFixed(2)}s)`);

  console.log('Normalising and rendering video segments...');
  const middleVideo = path.join(TMP_DIR, 'middle.mp4');
  await normalizeVideo(rawRecording, middleVideo);

  const openingVideo = path.join(TMP_DIR, 'opening.mp4');
  await renderTitleCard({
    outFile: openingVideo,
    duration: opening.actualDurationSeconds,
    lines: [
      { text: APP_TITLE, color: 'white', fontsize: 96, y: '(h/2)-120' },
      { text: APP_SUBTITLE, color: '0xc7d2fe', fontsize: 48, y: '(h/2)-10' },
      { text: 'Open source student records system for higher education', color: '0x9ca3af', fontsize: 28, y: '(h/2)+60' },
    ],
  });

  const closingLines = [
    { text: APP_TITLE + ' — Student Portal', color: 'white', fontsize: 72, y: '(h/2)-120' },
    { text: CLOSING_SUMMARY, color: '0xc7d2fe', fontsize: 36, y: '(h/2)-20' },
  ];
  if (manifest.useTts) {
    closingLines.push({
      text: 'Narration in this video is AI-generated.',
      color: '0x9ca3af',
      fontsize: 24,
      y: '(h/2)+60',
    });
  }
  const closingVideo = path.join(TMP_DIR, 'closing.mp4');
  await renderTitleCard({ outFile: closingVideo, duration: closing.actualDurationSeconds, lines: closingLines });

  console.log('Concatenating video segments...');
  const concatenatedVideo = path.join(TMP_DIR, 'concatenated-silent.mp4');
  await concatVideos([openingVideo, middleVideo, closingVideo], concatenatedVideo);

  console.log('Building synced narration audio...');
  const middleAudioFiles = middleScenes.map((s) => path.join(REPO_ROOT, s.file));
  const middleAudioRaw = path.join(TMP_DIR, 'middle-audio-raw.mp3');
  await concatAudios(middleAudioFiles, middleAudioRaw);

  const middleAudioSynced = path.join(TMP_DIR, 'middle-audio-synced.mp3');
  await padOrTrimAudioToDuration(middleAudioRaw, middleVideoDuration, middleAudioSynced);

  const finalAudio = path.join(TMP_DIR, 'final-audio.mp3');
  await concatAudios(
    [path.join(REPO_ROOT, opening.file), middleAudioSynced, path.join(REPO_ROOT, closing.file)],
    finalAudio,
    { normalize: true },
  );

  console.log('Muxing final video...');
  const finalVideoPath = path.join(OUTPUT_DIR, 'application-overview.mp4');
  await ffmpeg([
    '-y',
    '-i', concatenatedVideo,
    '-i', finalAudio,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    '-movflags', '+faststart',
    finalVideoPath,
  ]);

  console.log('Building duration-synced captions...');
  const scaleFactor = middleVideoDuration / middleScenes.reduce((sum, s) => sum + s.actualDurationSeconds, 0);
  let cursor = 0;
  const cues = [];
  cues.push({ start: cursor, end: cursor + opening.actualDurationSeconds, text: opening.narration });
  cursor += opening.actualDurationSeconds;
  for (const scene of middleScenes) {
    const dur = scene.actualDurationSeconds * scaleFactor;
    cues.push({ start: cursor, end: cursor + dur, text: scene.narration });
    cursor += dur;
  }
  cues.push({ start: cursor, end: cursor + closing.actualDurationSeconds, text: closing.narration });
  cursor += closing.actualDurationSeconds;

  const vttPath = path.join(OUTPUT_DIR, 'application-overview.vtt');
  const srtPath = path.join(OUTPUT_DIR, 'application-overview.srt');
  await fs.writeFile(vttPath, buildVtt(cues));
  await fs.writeFile(srtPath, buildSrt(cues));

  console.log('Burning in captions for the captioned output...');
  const captionedPath = path.join(OUTPUT_DIR, 'application-overview-captioned.mp4');
  const subtitleArg = escapeFilterPath(srtPath);
  await ffmpeg([
    '-y',
    '-i', finalVideoPath,
    '-vf', `subtitles='${subtitleArg}':force_style='FontName=Arial,FontSize=20,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,BorderStyle=3'`,
    '-c:v', 'libx264',
    '-c:a', 'copy',
    captionedPath,
  ]);

  console.log('\nVerifying output files have valid video and audio streams...');
  for (const file of [finalVideoPath, captionedPath]) {
    const info = await probeStreams(file);
    if (!info.hasVideo || !info.hasAudio) {
      throw new Error(`${file} is missing a required stream (video: ${info.hasVideo}, audio: ${info.hasAudio})`);
    }
    console.log(`  ${path.basename(file)}: video ✓  audio ✓  duration ${info.duration.toFixed(2)}s`);
  }

  console.log('\nFinal outputs:');
  console.log(`  ${finalVideoPath}`);
  console.log(`  ${captionedPath}`);
  console.log(`  ${vttPath}`);
  console.log(`  ${srtPath}`);
}

main().catch((error) => {
  console.error('\nFailed to build the overview video:', error.message);
  process.exitCode = 1;
});
