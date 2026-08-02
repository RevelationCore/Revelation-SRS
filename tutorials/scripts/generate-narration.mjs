#!/usr/bin/env node
// Phase 6: converts docs/tutorial-video/overview-narration.json into
// per-scene audio, a combined narration track, and WebVTT/SRT captions.
//
// When no TTS credentials are configured (TUTORIAL_TTS_PROVIDER /
// TUTORIAL_TTS_API_KEY), this still completes every other part of the
// phase — it generates correctly-timed silent placeholder audio instead,
// and prints the exact command needed to produce the real voiceover later.

import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ffmpeg, getDuration } from './lib/ffmpeg.mjs';
import { writeSilentWav } from './lib/silent-wav.mjs';
import { hasTtsCredentials, readTtsConfig, synthesizeScene } from './lib/tts.mjs';
import { buildSrt, buildVtt } from './lib/captions.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NARRATION_JSON = path.join(REPO_ROOT, 'docs/tutorial-video/overview-narration.json');
const AUDIO_DIR = path.join(REPO_ROOT, 'tutorials/generated/audio');
const CAPTIONS_DIR = path.join(REPO_ROOT, 'tutorials/generated/captions');

async function main() {
  const narration = JSON.parse(await fs.readFile(NARRATION_JSON, 'utf8'));
  const scenes = narration.scenes;
  if (!Array.isArray(scenes) || scenes.length === 0) {
    throw new Error(`No scenes found in ${NARRATION_JSON}`);
  }

  await fs.mkdir(AUDIO_DIR, { recursive: true });
  await fs.mkdir(CAPTIONS_DIR, { recursive: true });

  const ttsConfig = readTtsConfig();
  const useTts = hasTtsCredentials(ttsConfig);

  console.log(
    useTts
      ? `Using TTS provider "${ttsConfig.provider}" for narration synthesis.`
      : 'No TTS credentials configured (TUTORIAL_TTS_PROVIDER / TUTORIAL_TTS_API_KEY) — generating silent placeholder audio instead.',
  );

  const manifest = [];
  let cursor = 0;
  const cues = [];

  for (const scene of scenes) {
    const ext = useTts ? 'mp3' : 'wav';
    const outFile = path.join(AUDIO_DIR, `${scene.id}.${ext}`);

    if (useTts) {
      await synthesizeScene(scene.narration, outFile, ttsConfig);
    } else {
      await writeSilentWav(outFile, scene.estimatedDurationSeconds);
    }

    const actualDuration = await getDuration(outFile);
    manifest.push({
      id: scene.id,
      title: scene.title,
      file: path.relative(REPO_ROOT, outFile),
      estimatedDurationSeconds: scene.estimatedDurationSeconds,
      actualDurationSeconds: actualDuration,
      narration: scene.narration,
    });

    cues.push({ start: cursor, end: cursor + actualDuration, text: scene.narration });
    cursor += actualDuration;

    console.log(`  [${scene.id}] ${outFile.replace(REPO_ROOT + '/', '')} (${actualDuration.toFixed(2)}s)`);
  }

  // Combined narration track — concatenated in scene order, re-encoded to
  // a single consistent codec so it doesn't matter whether individual
  // scene files are silent WAV or synthesised MP3.
  const combinedFile = path.join(AUDIO_DIR, `combined.mp3`);
  const inputArgs = manifest.flatMap((m) => ['-i', path.join(REPO_ROOT, m.file)]);
  const filterInputs = manifest.map((_, i) => `[${i}:a]`).join('');
  const filter = `${filterInputs}concat=n=${manifest.length}:v=0:a=1[outa]`;
  await ffmpeg([
    '-y',
    ...inputArgs,
    '-filter_complex', filter,
    '-map', '[outa]',
    '-c:a', 'libmp3lame',
    '-b:a', '192k',
    combinedFile,
  ]);
  console.log(`  [combined] ${combinedFile.replace(REPO_ROOT + '/', '')}`);

  await fs.writeFile(path.join(AUDIO_DIR, 'manifest.json'), JSON.stringify({ useTts, scenes: manifest }, null, 2));

  const vttPath = path.join(CAPTIONS_DIR, 'overview.vtt');
  const srtPath = path.join(CAPTIONS_DIR, 'overview.srt');
  await fs.writeFile(vttPath, buildVtt(cues));
  await fs.writeFile(srtPath, buildSrt(cues));
  console.log(`  [captions] ${vttPath.replace(REPO_ROOT + '/', '')}`);
  console.log(`  [captions] ${srtPath.replace(REPO_ROOT + '/', '')}`);

  if (!useTts) {
    console.log('\nPlaceholder silent audio generated for every scene.');
    console.log('To generate the real voiceover, set TTS credentials and re-run this command, e.g.:\n');
    console.log(
      '  TUTORIAL_TTS_PROVIDER=openai TUTORIAL_TTS_API_KEY=sk-... TUTORIAL_TTS_VOICE=alloy pnpm tutorial:narrate\n',
    );
    console.log('Supported TUTORIAL_TTS_PROVIDER values: "openai", "elevenlabs".');
  }
}

main().catch((error) => {
  console.error('\nFailed to generate narration audio/captions:', error.message);
  process.exitCode = 1;
});
