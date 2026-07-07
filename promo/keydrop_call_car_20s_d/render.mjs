import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const ffmpeg = '/Users/noritakaoshita/Desktop/SNS/auto-sns-content-factory/tools/ffmpeg';
const jp = '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc';
const en = '/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf';
const assets = path.join(root, 'assets');
const work = path.join(root, 'work');
const output = path.join(root, 'KEYDROP_車で遊ぼう_家族旅行_20sec.mp4');
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
  `drawtext=fontfile='${en}':text='CALL. MEET. FAMILY DRIVE.':fontsize=39:fontcolor=white@0.65:x=126:y=1020`,
].join(','));

photo('02-road.mp4', '01-coast-drive.png', 3.2, [
  'drawbox=x=0:y=0:w=1080:h=150:color=black@0.62:t=fill',
  `drawtext=fontfile='${en}':text='01 / PLAY':fontsize=38:fontcolor=0xFFC400:x=64:y=54`,
  `drawtext=fontfile='${jp}':text='家族の道が、始まる。':fontsize=58:fontcolor=white:x=350:y=48`,
  'drawbox=x=760:y=1770:w=260:h=10:color=0xFFC400:t=fill',
].join(','));

const split = add('03-split.mp4');
const splitFilter = [
  '[0:v]scale=1080:1920,crop=540:1920:270:0[left]',
  '[1:v]scale=1080:1920,crop=540:1920:270:0[right]',
  '[left][right]hstack=inputs=2[base]',
  '[base]drawbox=x=532:y=0:w=16:h=1920:color=0xFFC400:t=fill',
  `drawtext=fontfile='${en}':text='CALL':fontsize=42:fontcolor=0xFFC400:x=54:y=90`,
  `drawtext=fontfile='${en}':text='ARRIVE':fontsize=42:fontcolor=0xFFC400:x=730:y=90`,
  `drawtext=fontfile='${jp}':text='地図で呼ぶ。':fontsize=62:fontcolor=white:borderw=3:bordercolor=black@0.45:x=54:y=1550`,
  `drawtext=fontfile='${jp}':text='車が届く。':fontsize=62:fontcolor=white:borderw=3:bordercolor=black@0.45:x=650:y=1550`,
  'fade=t=in:st=0:d=0.12,fade=t=out:st=3.08:d=0.12,format=yuv420p',
].join(',');
run(['-y', '-loop', '1', '-i', path.join(assets, '02-city-map.png'), '-loop', '1', '-i', path.join(assets, '03-city-handoff.png'),
  '-filter_complex', splitFilter, '-t', '3.2', '-r', '30', '-c:v', 'libx264', '-crf', '18', '-an', split]);

photo('04-handoff.mp4', '03-city-handoff.png', 3.0, [
  'drawbox=x=54:y=1390:w=972:h=250:color=black@0.66:t=fill',
  `drawtext=fontfile='${en}':text='MEET & GO':fontsize=36:fontcolor=0xFFC400:x=88:y=1430`,
  `drawtext=fontfile='${jp}':text='キーを受け取る。':fontsize=82:fontcolor=white:x=84:y=1500`,
].join(','));

photo('05-hokkaido.mp4', '04-hokkaido-drive.png', 3.2, [
  `drawtext=fontfile='${en}':text='NEXT SCENE':fontsize=40:fontcolor=0x111111:x=70:y=120`,
  'drawbox=x=70:y=180:w=130:h=10:color=0xFFC400:t=fill',
  `drawtext=fontfile='${jp}':text='家族で、次の景色へ。':fontsize=74:fontcolor=0x111111:x=68:y=225`,
].join(','));

card('06-area.mp4', 2.2, '0xFFC400', [
  `drawtext=fontfile='${en}':text='SERVICE AREA':fontsize=38:fontcolor=0x111111:x=78:y=500`,
  `drawtext=fontfile='${jp}':text='沖縄':fontsize=88:fontcolor=0x111111:x=76:y=640`,
  `drawtext=fontfile='${jp}':text='那覇市・豊見城市':fontsize=58:fontcolor=0x111111:x=78:y=760`,
  'drawbox=x=78:y=900:w=924:h=5:color=0x111111:t=fill',
  `drawtext=fontfile='${jp}':text='北海道':fontsize=88:fontcolor=0x111111:x=76:y=975`,
  `drawtext=fontfile='${jp}':text='札幌市・北広島市':fontsize=58:fontcolor=0x111111:x=78:y=1095`,
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
run(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-t', '20', '-c:v', 'copy', '-an', '-movflags', '+faststart', output]);
console.log(output);
