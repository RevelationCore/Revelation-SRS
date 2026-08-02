// Builds WebVTT and SRT caption files from a list of
// { start, end, text } cues (seconds, floating point).

function pad(n, width = 2) {
  return String(Math.floor(n)).padStart(width, '0');
}

function vttTimestamp(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const ms = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}.${String(ms).padStart(3, '0')}`;
}

function srtTimestamp(totalSeconds) {
  return vttTimestamp(totalSeconds).replace('.', ',');
}

export function buildVtt(cues) {
  const lines = ['WEBVTT', ''];
  cues.forEach((cue, i) => {
    lines.push(String(i + 1));
    lines.push(`${vttTimestamp(cue.start)} --> ${vttTimestamp(cue.end)}`);
    lines.push(cue.text);
    lines.push('');
  });
  return lines.join('\n');
}

export function buildSrt(cues) {
  const lines = [];
  cues.forEach((cue, i) => {
    lines.push(String(i + 1));
    lines.push(`${srtTimestamp(cue.start)} --> ${srtTimestamp(cue.end)}`);
    lines.push(cue.text);
    lines.push('');
  });
  return lines.join('\n');
}
