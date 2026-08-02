// Shared ffmpeg/ffprobe helpers for the narration (Phase 6) and video
// assembly (Phase 7) scripts. Uses the ffmpeg-static / ffprobe-static
// npm packages (added as root devDependencies) so no system-level ffmpeg
// installation is required — this repo's dev machine has neither ffmpeg
// nor Homebrew installed.

import { spawn } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

export const FFMPEG = ffmpegPath;
export const FFPROBE = ffprobeStatic.path;

export function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with code ${code}\n${stderr}`));
    });
  });
}

export async function ffmpeg(args) {
  return run(FFMPEG, args);
}

/** Returns the duration of a media file in seconds (float). */
export async function getDuration(filePath) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'json',
    filePath,
  ]);
  const parsed = JSON.parse(stdout);
  const duration = Number(parsed.format?.duration);
  if (!Number.isFinite(duration)) {
    throw new Error(`Could not determine duration of ${filePath}`);
  }
  return duration;
}

/** Returns { hasVideo, hasAudio, duration } for a media file. */
export async function probeStreams(filePath) {
  const { stdout } = await run(FFPROBE, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name',
    '-show_entries', 'format=duration',
    '-of', 'json',
    filePath,
  ]);
  const parsed = JSON.parse(stdout);
  const streams = parsed.streams ?? [];
  return {
    hasVideo: streams.some((s) => s.codec_type === 'video'),
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    duration: Number(parsed.format?.duration ?? NaN),
  };
}
