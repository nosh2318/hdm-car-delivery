import fs from 'node:fs';

const sr = 44100, duration = 29, channels = 2;
const frames = sr * duration;
const data = Buffer.alloc(frames * channels * 2);
const notes = [55, 65.41, 73.42, 49];
const clamp = v => Math.max(-1, Math.min(1, v));

for (let i = 0; i < frames; i++) {
  const t = i / sr;
  const beat = t * 1.8;
  const bar = Math.floor(beat / 4);
  const root = notes[bar % notes.length];
  const phase = beat % 1;
  const kick = Math.sin(2 * Math.PI * (52 - 22 * phase) * t) * Math.exp(-phase * 8) * .24;
  const bass = Math.sin(2 * Math.PI * root * t) * .1;
  const pulse = Math.sin(2 * Math.PI * root * 2 * t) * (phase < .3 ? .07 : .025);
  const shimmer = Math.sin(2 * Math.PI * (root * 8) * t) * .018 * (0.5 + 0.5 * Math.sin(t * .7));
  const fade = Math.min(1, t / 1.2, (duration - t) / 1.4);
  const v = clamp((kick + bass + pulse + shimmer) * fade);
  const left = Math.round(v * 32767), right = Math.round(v * .94 * 32767);
  data.writeInt16LE(left, i * 4); data.writeInt16LE(right, i * 4 + 2);
}

const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
header.writeUInt16LE(channels, 22); header.writeUInt32LE(sr, 24);
header.writeUInt32LE(sr * channels * 2, 28); header.writeUInt16LE(channels * 2, 32);
header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
fs.writeFileSync(new URL('./music.wav', import.meta.url), Buffer.concat([header, data]));
