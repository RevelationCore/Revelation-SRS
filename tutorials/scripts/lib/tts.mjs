// Minimal TTS client. Deliberately dependency-free (uses Node's built-in
// fetch) rather than pulling in a provider SDK, since only one HTTP call
// per scene is needed. Configured entirely via environment variables —
// no credentials are ever hard-coded here.
//
//   TUTORIAL_TTS_PROVIDER   "openai" | "elevenlabs"
//   TUTORIAL_TTS_API_KEY    provider API key
//   TUTORIAL_TTS_VOICE      provider-specific voice name/id
//   TUTORIAL_TTS_MODEL      provider-specific model name (optional)
//
// Voice defaults favour a calm, professional, British-English-leaning
// option where the provider supports one, per the narration style guide
// in docs/tutorial-video/overview-narration.md.

import fs from 'node:fs/promises';

export function readTtsConfig() {
  const provider = process.env['TUTORIAL_TTS_PROVIDER']?.trim().toLowerCase() ?? '';
  const apiKey = process.env['TUTORIAL_TTS_API_KEY']?.trim() ?? '';
  const voice = process.env['TUTORIAL_TTS_VOICE']?.trim() ?? '';
  const model = process.env['TUTORIAL_TTS_MODEL']?.trim() ?? '';
  return { provider, apiKey, voice, model };
}

export function hasTtsCredentials(config = readTtsConfig()) {
  return Boolean(config.provider && config.apiKey);
}

async function synthesizeOpenAi(text, outFile, config) {
  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o-mini-tts',
      voice: config.voice || 'alloy',
      input: text,
      response_format: 'mp3',
    }),
  });
  if (!response.ok) {
    throw new Error(`OpenAI TTS request failed: ${response.status} ${await response.text()}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(outFile, Buffer.from(arrayBuffer));
}

async function synthesizeElevenLabs(text, outFile, config) {
  const voiceId = config.voice || 'pNInz6obpgDQGcFmaJgB'; // "Adam" — a default ElevenLabs voice id
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': config.apiKey,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: config.model || 'eleven_multilingual_v2',
    }),
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs TTS request failed: ${response.status} ${await response.text()}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await fs.writeFile(outFile, Buffer.from(arrayBuffer));
}

/** Synthesizes `text` to `outFile` (mp3). Throws on failure. */
export async function synthesizeScene(text, outFile, config = readTtsConfig()) {
  if (config.provider === 'openai') return synthesizeOpenAi(text, outFile, config);
  if (config.provider === 'elevenlabs') return synthesizeElevenLabs(text, outFile, config);
  throw new Error(
    `Unknown TUTORIAL_TTS_PROVIDER "${config.provider}" — supported values are "openai" or "elevenlabs".`,
  );
}
