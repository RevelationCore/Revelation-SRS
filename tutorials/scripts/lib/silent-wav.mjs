// Writes a valid, silent 16-bit PCM mono WAV file of an exact duration.
// Used as the narration placeholder when no TTS credentials are
// configured, so downstream caption/video timing can be built and
// verified even before real voiceover exists.

import fs from 'node:fs/promises';

const SAMPLE_RATE = 24_000;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

export async function writeSilentWav(filePath, durationSeconds) {
  const numSamples = Math.round(durationSeconds * SAMPLE_RATE);
  const dataSize = numSamples * CHANNELS * (BITS_PER_SAMPLE / 8);
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), 28); // byte rate
  buffer.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32); // block align
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);
  // Remaining bytes are already zeroed by Buffer.alloc — silence.

  await fs.writeFile(filePath, buffer);
}
