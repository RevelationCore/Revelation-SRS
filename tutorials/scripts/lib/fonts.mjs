import fs from 'node:fs/promises';

// Title-card text is rendered with ffmpeg's drawtext filter, which needs
// an explicit font file (ffmpeg-static isn't built with fontconfig).
// TUTORIAL_TITLE_FONT overrides the path; otherwise the first existing
// candidate below is used, covering this project's macOS dev machine and
// common Linux CI images.
const CANDIDATES = [
  process.env['TUTORIAL_TITLE_FONT'],
  '/System/Library/Fonts/Supplemental/Arial.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
].filter(Boolean);

export async function findTitleFont() {
  for (const candidate of CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next candidate
    }
  }
  throw new Error(
    `No usable font file found for title cards. Set TUTORIAL_TITLE_FONT to a .ttf path. Tried: ${CANDIDATES.join(', ')}`,
  );
}
