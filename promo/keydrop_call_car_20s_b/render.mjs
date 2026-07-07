import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.dirname(new URL(import.meta.url).pathname);
const ffmpeg = '/Users/noritakaoshita/Desktop/SNS/auto-sns-content-factory/tools/ffmpeg';
const font = '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc';
const assets = path.join(root, 'assets');
const work = path.join(root, 'work');
const output = path.join(root, 'KEYDROP_車で遊ぼう_都市とロードトリップ_20sec.mp4');

const esc = (text) => text.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'");
const textFilter = (main, sub = '', accent = '0xFFC400', shout = 'PLAY') => {
  const shade = 'drawbox=x=0:y=1240:w=1080:h=680:color=white@0.80:t=fill';
  const label = `drawtext=fontfile='/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf':text='${shout}':fontsize=34:fontcolor=0x111111:x=74:y=1370`;
  const line = `drawbox=x=74:y=1424:w=96:h=8:color=${accent}:t=fill`;
  const headline = `drawtext=fontfile='${font}':text='${esc(main)}':fontsize=116:fontcolor=0x111111:x=72:y=1470`;
  const secondary = sub ? `,drawtext=fontfile='${font}':text='${esc(sub)}':fontsize=32:fontcolor=0x333333:x=76:y=1645` : '';
  return `${shade},${label},${line},${headline}${secondary}`;
};

const scenes = [
  { image: '01-coast-drive.png', duration: 2.8, main: '車で、遊ぼう。', sub: '道を選ぶところから、旅は始まる。', pan: 'right', accent: '0xFFC400', shout: 'PLAY THE ROAD' },
  { image: '02-city-map.png', duration: 2.8, main: '街から、呼ぶ。', sub: 'マップで現在地を共有。', pan: 'left', accent: '0xFFC400', shout: 'CALL YOUR CAR' },
  { image: '03-city-handoff.png', duration: 3.0, main: 'キーを、受け取る。', sub: 'スタッフが車を指定場所へ。', pan: 'right', accent: '0xFFC400', shout: 'CAR DELIVERY' },
  { image: '02-city-map.png', duration: 3.0, main: '会えたら、出発。', sub: 'キックボードで軽快に離脱。', pan: 'right', accent: '0xFFC400', shout: 'MEET & GO' },
  { image: '04-hokkaido-drive.png', duration: 3.6, main: '次の景色へ。', sub: '新しい、呼ぶレンタカー。', pan: 'left', accent: '0xFFC400', shout: 'KEYDROP' },
];

const segmentFiles = [];
for (let i = 0; i < scenes.length; i += 1) {
  const scene = scenes[i];
  const out = path.join(work, `scene-${String(i + 1).padStart(2, '0')}.mp4`);
  segmentFiles.push(out);
  const motion = scene.pan === 'left'
    ? "zoompan=z='min(max(zoom,pzoom)+0.0018,1.17)':x='iw/2-(iw/zoom/2)-70+140*on/120':y='ih/2-(ih/zoom/2)+25*sin(on/18)':d=1:s=1080x1920:fps=30"
    : "zoompan=z='min(max(zoom,pzoom)+0.0018,1.17)':x='iw/2-(iw/zoom/2)+70-140*on/120':y='ih/2-(ih/zoom/2)+25*cos(on/18)':d=1:s=1080x1920:fps=30";
  const vf = [
    'scale=1350:2400:force_original_aspect_ratio=increase',
    motion,
    'eq=saturation=1.08:contrast=1.03:brightness=0.015',
    textFilter(scene.main, scene.sub, scene.accent, scene.shout),
    'fade=t=in:st=0:d=0.18',
    `fade=t=out:st=${Math.max(0, scene.duration - 0.18)}:d=0.18`,
    'format=yuv420p',
  ].join(',');
  execFileSync(ffmpeg, [
    '-y', '-loop', '1', '-framerate', '30', '-i', path.join(assets, scene.image),
    '-t', String(scene.duration), '-vf', vf,
    '-r', '30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', out,
  ], { stdio: 'inherit' });
}

const areaCard = path.join(work, 'scene-06.mp4');
segmentFiles.push(areaCard);
const areaFilter = [
  `drawtext=fontfile='/System/Library/Fonts/Supplemental/Arial Bold Italic.ttf':text='SERVICE AREA':fontsize=34:fontcolor=0x111111:x=90:y=560`,
  'drawbox=x=90:y=620:w=120:h=10:color=0xFFC400:t=fill',
  `drawtext=fontfile='${font}':text='展開エリア':fontsize=82:fontcolor=0x111111:x=90:y=680`,
  `drawtext=fontfile='${font}':text='沖縄':fontsize=54:fontcolor=0xC99A00:x=90:y=880`,
  `drawtext=fontfile='${font}':text='那覇市・豊見城市':fontsize=58:fontcolor=0x111111:x=270:y=875`,
  `drawtext=fontfile='${font}':text='北海道':fontsize=54:fontcolor=0xC99A00:x=90:y=1030`,
  `drawtext=fontfile='${font}':text='札幌市・北広島市':fontsize=58:fontcolor=0x111111:x=300:y=1025`,
  'fade=t=in:st=0:d=0.2,fade=t=out:st=2.0:d=0.2,format=yuv420p',
].join(',');
execFileSync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'color=c=white:s=1080x1920:r=30:d=2.2',
  '-vf', areaFilter, '-t', '2.2', '-r', '30',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', areaCard,
], { stdio: 'inherit' });

const endCard = path.join(work, 'scene-07.mp4');
segmentFiles.push(endCard);
const endFilter = [
  '[1:v]scale=760:-1[logo]',
  '[0:v][logo]overlay=(W-w)/2:520',
  'drawbox=x=90:y=760:w=900:h=10:color=0xFFC400:t=fill',
  `drawtext=fontfile='${font}':text='車で、遊ぼう。':fontsize=104:fontcolor=0x111111:x=(w-text_w)/2:y=850`,
  `drawtext=fontfile='${font}':text='新しい、呼ぶレンタカー。':fontsize=42:fontcolor=0x333333:x=(w-text_w)/2:y=1010`,
  `drawtext=fontfile='${font}':text='地図で呼ぶ。届いたら、走り出す。':fontsize=32:fontcolor=0x555555:x=(w-text_w)/2:y=1155`,
  `drawtext=fontfile='/System/Library/Fonts/Supplemental/Arial Bold.ttf':text='keydrop.jp':fontsize=44:fontcolor=0x111111:x=(w-text_w)/2:y=1280`,
  'fade=t=in:st=0:d=0.25,format=yuv420p',
].join(',');
execFileSync(ffmpeg, [
  '-y', '-f', 'lavfi', '-i', 'color=c=white:s=1080x1920:r=30:d=2.6',
  '-loop', '1', '-i', path.join(assets, 'keydrop-logo.png'),
  '-filter_complex', endFilter, '-t', '2.6', '-r', '30',
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-an', endCard,
], { stdio: 'inherit' });

const concatFile = path.join(work, 'concat.txt');
writeFileSync(concatFile, segmentFiles.map((file) => `file '${file}'`).join('\n') + '\n');
const silent = path.join(work, 'silent.mp4');
execFileSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', silent], { stdio: 'inherit' });

execFileSync(ffmpeg, [
  '-y', '-i', silent, '-t', '20', '-r', '30',
  '-c:v', 'copy', '-an', '-movflags', '+faststart', output,
], { stdio: 'inherit' });

console.log(output);
