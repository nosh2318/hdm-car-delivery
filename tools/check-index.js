#!/usr/bin/env node
/**
 * check-index.js — KEYDROP 白画面ガード（2026-06-13）
 * index.html 内のインライン JavaScript を抽出して `node --check` で構文検証する。
 * テンプレートリテラル崩れ・括弧不一致・辞書の自己参照などの「構文エラー白画面」を
 * 本番push前に止める（過去事例: 5973a4f ja辞書 vehDateHint 自己参照）。
 *
 * 使い方:  node tools/check-index.js [file ...]   (既定: index.html)
 * 終了コード: 0=OK / 1=構文エラー検出
 *
 * ※ 未定義変数(no-undef)のような実行時エラーは構文チェックでは検出できない。
 *   それらは index.html 側の「描画エラーの受け皿(try/catch+グローバル捕捉)」で
 *   "固着させず復旧UIに倒す" ことで守る（二段構え）。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const files = process.argv.slice(2);
if (files.length === 0) files.push(path.join(__dirname, '..', 'index.html'));

let failed = 0;

for (const file of files) {
  let src;
  try { src = fs.readFileSync(file, 'utf8'); }
  catch (e) { console.error('✗ 読込失敗:', file, e.message); failed++; continue; }

  // <script ...>...</script> を全部拾い、JS実行されるものだけ検証
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m, idx = 0, checked = 0;
  while ((m = re.exec(src)) !== null) {
    const attrs = m[1] || '';
    const code = m[2] || '';
    idx++;
    if (/\bsrc\s*=/.test(attrs)) continue;                       // 外部読込はスキップ
    const typeM = attrs.match(/type\s*=\s*["']?([^"'\s>]+)/i);
    const type = typeM ? typeM[1].toLowerCase() : '';
    // JSとして実行される type のみ検証（json / babel / template はスキップ）
    if (type && !/^(text\/javascript|application\/javascript|module)$/.test(type)) continue;
    if (!code.trim()) continue;

    // 行番号をindex.html基準に合わせる（エラー表示を見やすく）
    const before = src.slice(0, m.index);
    const startLine = before.split('\n').length;
    try {
      // 構文のみ検証（実行しない）
      new vm.Script(code, { filename: `${path.basename(file)}#script${idx}@L${startLine}` });
      checked++;
    } catch (e) {
      failed++;
      console.error(`✗ 構文エラー: ${file} (script #${idx}, おおよそ L${startLine}〜)`);
      console.error('  ', e.message);
    }
  }
  if (checked && !failed) console.log(`✓ ${file} : インラインJS ${checked}ブロック 構文OK`);
  else if (!checked) console.log(`(検証対象のインラインJSなし: ${file})`);
}

if (failed) {
  console.error(`\n❌ 構文エラー ${failed}件 — push中止。修正してください。`);
  process.exit(1);
}
console.log('✅ 構文チェック OK');
process.exit(0);
