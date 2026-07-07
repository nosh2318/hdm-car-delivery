import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const ffmpeg = '/Users/noritakaoshita/Desktop/SNS/auto-sns-content-factory/tools/ffmpeg';
const jp = '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc';
const en = '/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf';
const assets = path.join(root, 'assets');
const work = path.join(root, 'work');
const output = path.join(root, 'KEYDROP_AI実写ミックス_那覇_20sec.mp4');
const parts = [];

const run = (args) => execFileSync(ffmpeg, args, { stdio: 'inherit' });
const add = (name) => { const p = path.join(work, name); parts.push(p); return p; };
const esc = (s) => s.replaceAll(':', '\\:').replaceAll("'", "\\'");

const card = (name, duration, bg, filters) => {
  const out = add(name);
  run(['-y', '-f', 'lavfi', '-i', `color=c=${bg}:s=1080x1920:r=30:d=${duration}`,
    '-vf', `${filters},fade=t=in:st=0:d=0.12,fade=t=out:st=${duration - .12}:d=0.12,format=yuv420p`,
    '-t', String(duration), '-r', '30', '-c:v', 'libx264', '-crf', '18', '-an', out]);
};

const photo = (name, image, duration, filter) => {
  const out = add(name);
  const base = "scale=1350:2400,zoompan=z='min(max(zoom,pzoom)+0.0012,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30";
  run(['-y', '-loop', '1', '-framerate', '30', '-i', path.join(assets, image), '-t', String(duration),
    '-vf', `${base},eq=saturation=1.06:contrast=1.05,${filter},fade=t=out:st=${duration - .12}:d=0.12,format=yuv420p`,
    '-r', '30', '-c:v', 'libx264', '-crf', '18', '-an', out]);
};

card('01-open.mp4', 2.2, '0x0A0A0A', [
  'drawbox=x=72:y=420:w=18:h=520:color=0xFFC400:t=fill',
  `drawtext=fontfile='${en}':text='KEYDROP PRESENTS':fontsize=34:fontcolor=0xFFC400:x=126:y=430`,
  `drawtext=fontfile='${jp}':text='車で、':fontsize=142:fontcolor=white:x=120:y=560`,
  `drawtext=fontfile='${jp}':text='遊ぼう。':fontsize=164:fontcolor=white:x=120:y=735`,
  `drawtext=fontfile='${en}':text='CALL. MEET. DRIVE.':fontsize=42:fontcolor=white@0.65:x=126:y=1020`,
].join(','));

photo('02-road.mp4', '01-coast-drive.jpg', 3.2, [
  'drawbox=x=0:y=0:w=1080:h=150:color=black@0.62:t=fill',
  `drawtext=fontfile='${en}':text='01 / PLAY':fontsize=38:fontcolor=0xFFC400:x=64:y=54`,
  `drawtext=fontfile='${jp}':text='この車が、本当に届く。':fontsize=46:fontcolor=white:x=350:y=52`,
  'drawbox=x=760:y=1770:w=260:h=10:color=0xFFC400:t=fill',
].join(','));

photo('03-map.mp4', '02-city-map.png', 3.2, [
  'drawbox=x=54:y=1390:w=972:h=250:color=black@0.66:t=fill',
  `drawtext=fontfile='${en}':text='CALL YOUR CAR':fontsize=36:fontcolor=0xFFC400:x=88:y=1430`,
  `drawtext=fontfile='${jp}':text='地図で、車を呼ぶ。':fontsize=76:fontcolor=white:x=84:y=1500`,
].join(','));

photo('04-handoff.mp4', '03-city-handoff.png', 3.0, [
  'drawbox=x=54:y=1390:w=972:h=250:color=black@0.66:t=fill',
  `drawtext=fontfile='${en}':text='MEET & GO':fontsize=36:fontcolor=0xFFC400:x=88:y=1430`,
  `drawtext=fontfile='${jp}':text='キーを受け取る。':fontsize=82:fontcolor=white:x=84:y=1500`,
].join(','));

photo('05-hokkaido.mp4', '04-hokkaido-drive.jpg', 3.2, [
  `drawtext=fontfile='${en}':text='NEXT SCENE':fontsize=40:fontcolor=0x111111:x=70:y=120`,
  'drawbox=x=70:y=180:w=130:h=10:color=0xFFC400:t=fill',
  `drawtext=fontfile='${jp}':text='沖縄を、もっと自由に。':fontsize=76:fontcolor=0x111111:x=68:y=225`,
].join(','));

card('06-area.mp4', 2.2, '0xFFC400', [
  `drawtext=fontfile='${en}':text='SERVICE AREA':fontsize=38:fontcolor=0x111111:x=78:y=500`,
  `drawtext=fontfile='${jp}':text='沖縄':fontsize=88:fontcolor=0x111111:x=76:y=640`,
  `drawtext=fontfile='${jp}':text='那覇市・豊見城市':fontsize=72:fontcolor=0x111111:x=78:y=790`,
  'drawbox=x=78:y=930:w=924:h=5:color=0x111111:t=fill',
  `drawtext=fontfile='${jp}':text='NAHA / TOMIGUSUKU':fontsize=42:fontcolor=0x111111:x=78:y=990`,
].join(','));

const end = add('07-end.mp4');
const endFilter = [
  '[1:v]scale=760:-1[logo]', '[0:v][logo]overlay=(W-w)/2:620',
  'drawbox=x=150:y=890:w=780:h=9:color=0xFFC400:t=fill',
  `drawtext=fontfile='${jp}':text='新しい、呼ぶレンタカー。':fontsize=50:fontcolor=0x111111:x=(w-text_w)/2:y=990`,
  `drawtext=fontfile='${en}':text='keydrop.jp':fontsize=48:fontcolor=0x111111:x=(w-text_w)/2:y=1120`,
  'fade=t=in:st=0:d=0.15,format=yuv420p',
].join(',');
run(['-y', '-f', 'lavfi', '-i', 'color=c=white:s=1080x1920:r=30:d=3', '-loop', '1', '-i', path.join(assets, 'keydrop-logo.png'),
  '-filter_complex', endFilter, '-t', '3', '-r', '30', '-c:v', 'libx264', '-crf', '18', '-an', end]);

const list = path.join(work, 'concat.txt');
writeFileSync(list, parts.map((p) => `file '${p}'`).join('\n') + '\n');
const baseVideo = path.join(work, 'base-no-logo.mp4');
run(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-t', '20', '-c:v', 'copy', '-an', baseVideo]);
run(['-y', '-i', baseVideo, '-loop', '1', '-i', path.join(assets, 'keydrop-logo.png'),
  '-filter_complex', "[1:v]scale=280:-1[mark];[0:v][mark]overlay=40:40:enable='lt(t,17)'",
  '-t', '20', '-r', '30', '-c:v', 'libx264', '-crf', '18', '-an', '-movflags', '+faststart', output]);
console.log(output);
