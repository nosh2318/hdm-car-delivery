import { chromium } from '/Users/noritakaoshita/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises'; import path from 'node:path';
const root=path.resolve(import.meta.dirname),frames=path.join(root,'frames_short_youth');
await fs.rm(frames,{recursive:true,force:true});await fs.mkdir(frames,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Users/noritakaoshita/Library/Caches/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-mac-arm64/chrome-headless-shell',args:['--allow-file-access-from-files']});
const page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
await page.goto(`file://${path.join(root,'promo_youth_short.html')}`);await page.evaluate(()=>window.ready);
const fps=24,duration=29;for(let i=0;i<fps*duration;i++){await page.evaluate(t=>window.renderAt(t),i/fps);await page.screenshot({path:path.join(frames,`frame_${String(i).padStart(5,'0')}.jpg`),type:'jpeg',quality:91});if(i%fps===0)process.stdout.write(`${i/fps}s / ${duration}s\n`)}
await browser.close();console.log(frames);
