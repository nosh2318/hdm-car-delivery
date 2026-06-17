/* ============================================================
   KEYDROP チャットサポート（C案＝ルールベース・LLM不使用・無料）
   - 知識源は faq.html を実行時に fetch して解析（18問×4言語を自動取込）
     → FAQを直せば bot も自動追従（二重管理なし）
   - 文字バイグラム重なり + 軽い類義語展開で「賢いFAQ検索」
   - ヒットしなければ 公式LINE / TEL へ誘導
   - 単一ファイル・vanilla JS・自己マウント（index.html へは <script> 1行）
   ============================================================ */
(function () {
  'use strict';
  if (window.__kdChatMounted) return;
  window.__kdChatMounted = true;

  var LINE_URL = 'https://lin.ee/ZxBknUv';
  var TEL = '050-1785-2711';

  // ---- 行動ログ（匿名・ヒット率計測。keydrop_faq_logs へ INSERT） ----
  var SB_URL = 'https://ckrxttbnawkclshczsia.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNrcnh0dGJuYXdrY2xzaGN6c2lhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4Nzg1NTAsImV4cCI6MjA4NzQ1NDU1MH0.kDC_UDVWvcrS97wzqQ3NXP79ewjgYwF4vSFdV7y06S8';
  function areaStore() {
    try { var a = (new URLSearchParams(location.search).get('area') || '').toLowerCase(); if (/naha|nha|oki/.test(a)) return 'nha'; } catch (e) {}
    return 'spk';
  }
  function sid() {
    try { var s = sessionStorage.getItem('kd_faq_sid'); if (!s) { s = 'f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); sessionStorage.setItem('kd_faq_sid', s); } return s; } catch (e) { return ''; }
  }
  function logEv(event, extra) {
    try {
      var body = { store: areaStore(), lang: lang(), event: event, session_id: sid() };
      if (extra && extra.query) body.query = String(extra.query).slice(0, 200);
      if (extra && extra.question) body.question = String(extra.question).slice(0, 300);
      fetch(SB_URL + '/rest/v1/keydrop_faq_logs', {
        method: 'POST', keepalive: true,
        headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
        body: JSON.stringify(body)
      }).catch(function () {});
    } catch (e) {}
  }

  // ---- 言語 ----
  function lang() {
    try {
      var s = localStorage.getItem('kd_lang');
      if (s && ['ja', 'en', 'zh', 'ko'].indexOf(s) >= 0) return s;
    } catch (e) {}
    var n = (navigator.language || 'ja').toLowerCase();
    if (n.indexOf('ko') === 0) return 'ko';
    if (n.indexOf('zh') === 0) return 'zh';
    if (n.indexOf('en') === 0) return 'en';
    return 'ja';
  }

  var UI = {
    ja: { title: 'よくある質問', sub: '知りたいことを検索 / 一覧から選べます', open: 'よくある質問',
      ph: 'キーワードで検索（例：料金）',
      fbAsk: 'このページで解決しましたか？', fbYes: 'はい', fbNo: 'いいえ', fbThanks: 'お役に立てて良かったです🔑',
      other: 'こちらは解決になりそうですか？', lineQ: '公式LINEで質問する',
      none: '該当が見つかりませんでした。公式LINEでお気軽にお問い合わせください。' },
    en: { title: 'FAQ / Help', sub: 'Search or pick from the list', open: 'FAQ / Help',
      ph: 'Search by keyword (e.g. price)',
      fbAsk: 'Did this solve your question?', fbYes: 'Yes', fbNo: 'No', fbThanks: 'Glad it helped🔑',
      other: 'Maybe one of these?', lineQ: 'Ask on Official LINE',
      none: 'No match found. Please feel free to ask us on Official LINE.' },
    zh: { title: '常見問題', sub: '可搜尋或從清單選擇', open: '常見問題',
      ph: '輸入關鍵字搜尋（例：費用）',
      fbAsk: '這個頁面解決了您的問題嗎？', fbYes: '是', fbNo: '否', fbThanks: '很高興能幫上忙🔑',
      other: '這些是否能解決呢？', lineQ: '用官方LINE詢問',
      none: '找不到相關內容。歡迎透過官方LINE與我們聯絡。' },
    ko: { title: '자주 묻는 질문', sub: '검색하거나 목록에서 선택하세요', open: '자주 묻는 질문',
      ph: '키워드로 검색（예: 요금）',
      fbAsk: '이 페이지로 해결되셨나요?', fbYes: '예', fbNo: '아니오', fbThanks: '도움이 되어 기쁩니다🔑',
      other: '혹시 이건 어떠세요?', lineQ: '공식 LINE으로 문의',
      none: '관련 내용을 찾지 못했습니다. 공식 LINE으로 문의해 주세요.' }
  };
  function L() { return UI[lang()] || UI.ja; }

  // ---- 類義語展開（口語→FAQに出てくる語へ寄せる。バイグラム一致を補強） ----
  var SYN = [
    ['いくら|値段|価格|相場|料金|費用|how much|price|cost|fee|費用|價格|요금|가격|얼마', '料金 価格 費用 price cost'],
    ['キャンセル|取消|取り消|解約|cancel|취소|取消', 'キャンセル cancel 取消 취소'],
    ['変更|かえ|変えたい|change|edit|變更|변경', '変更 change 變更 변경'],
    ['支払|払い|決済|カード|クレジット|payment|pay|card|付款|결제|카드', '支払い 決済 カード payment card'],
    ['領収|レシート|receipt|收據|영수증', '領収書 receipt 收據 영수증'],
    ['免許|ライセンス|国際免許|license|licence|driving|駕照|면허', '免許 国際免許 license 駕照 면허'],
    ['保険|補償|免責|cdw|noc|insurance|coverage|保險|보험', '補償 保険 免責 NOC insurance coverage'],
    ['オプション|チャイルド|ジュニア|シート|子供|こども|child|junior|seat|安全座椅|시트|아이', 'オプション チャイルドシート ジュニアシート child seat'],
    ['給油|ガソリン|満タン|燃料|fuel|gas|加油|주유|기름', '給油 満タン 燃料 fuel'],
    ['返却|返す|返車|return|還車|반납', '返却 return 還車 반납'],
    ['事故|ぶつけ|accident|事故|사고', '事故 accident 사고'],
    ['故障|動かない|パンク|breakdown|trouble|故障|고장', '故障 自走不可 breakdown'],
    ['範囲|エリア|どこまで|配達|デリバリー|area|range|deliver|範圍|外送|배달|지역', 'デリバリー 範囲 エリア area delivery'],
    ['店舗|店|お店|store|shop|門市|매장', '店舗 store 門市 매장'],
    ['装備|ナビ|etc|bluetooth|equipment|裝備|장비', '装備 ナビ ETC equipment'],
    ['車種|車|モデル|選べ|model|car|車種|차종', '車種 model 車種'],
    ['年齢|何歳|条件|資格|age|eligib|條件|연령|조건', '利用条件 年齢 eligibility'],
    ['流れ|手順|貸出|受取|ピックアップ|pickup|flow|流程|흐름|받', '貸し出し 流れ pickup'],
    ['予約|booking|reserve|預約|예약', '予約 booking 予約'],
    ['営業時間|何時|open|hours|営業|영업', '営業 9:00 19:00 open hours']
  ];
  function expand(q) {
    var add = '';
    for (var i = 0; i < SYN.length; i++) {
      var trig = SYN[i][0].split('|');
      for (var j = 0; j < trig.length; j++) {
        if (trig[j] && q.indexOf(trig[j]) >= 0) { add += ' ' + SYN[i][1]; break; }
      }
    }
    return q + ' ' + add;
  }

  function norm(s) {
    return (s || '').toLowerCase().replace(/[\s　,.、。!！?？「」（）()・/／]+/g, '');
  }
  function bigrams(s) {
    s = norm(s);
    var out = {};
    if (s.length < 2) { if (s) out[s] = 1; return out; }
    for (var i = 0; i < s.length - 1; i++) out[s.substr(i, 2)] = 1;
    return out;
  }

  // ---- FAQ 知識ベース（faq.html を fetch して構築） ----
  var FAQ = { ja: [], en: [], zh: [], ko: [] };
  var faqLoaded = false;
  function loadFAQ() {
    return fetch('faq.html', { cache: 'no-cache' }).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html');
      ['ja', 'en', 'zh', 'ko'].forEach(function (lg) {
        var pane = doc.querySelector('.pane[data-lang="' + lg + '"]');
        if (!pane) return;
        pane.querySelectorAll('details').forEach(function (d) {
          var sum = d.querySelector('summary');
          var ans = d.querySelector('.a');
          if (!sum || !ans) return;
          var q = sum.textContent.trim();
          FAQ[lg].push({ q: q, a: ans.innerHTML, blob: norm(expand(q + ' ' + ans.textContent)) });
        });
      });
      faqLoaded = true;
    });
  }

  // 検索：バイグラム重なり＋類義語展開で近い候補を複数返す
  function search(query) {
    var lg = lang(); var list = FAQ[lg] && FAQ[lg].length ? FAQ[lg] : FAQ.ja;
    var qb = bigrams(expand(norm(query)));
    var qkeys = Object.keys(qb);
    if (!qkeys.length) return [];
    var scored = list.map(function (e) {
      var hit = 0, eb = bigrams(e.q + e.q + e.q + ' ' + e.blob); // 質問文を重み付け
      for (var k = 0; k < qkeys.length; k++) if (eb[qkeys[k]]) hit++;
      return { e: e, s: hit / Math.max(4, qkeys.length) };
    }).filter(function (x) { return x.s > 0.18; });
    scored.sort(function (a, b) { return b.s - a.s; });
    return scored.slice(0, 6).map(function (x) { return x.e; });
  }

  // ---- UI（検索＋アコーディオン＋解決フィードバック） ----
  function css() {
    if (document.getElementById('kdchat-css')) return;
    var FF = 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif';
    var s = document.createElement('style'); s.id = 'kdchat-css';
    s.textContent = [
      '.kd-help-h{cursor:pointer}',
      '@media(max-width:767px){.kd-help-h span{display:none}}',
      // フォールバックFAB（ヘッダーが無いページ用）
      '.kdc-fab{position:fixed;left:14px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:6px;background:linear-gradient(135deg,#1a1a1a,#333);color:#fff;border:2px solid #FABE00;border-radius:999px;padding:11px 16px;font-weight:800;font-size:13px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.28);' + FF + '}',
      '.kdc-fab:active{transform:scale(.96)}',
      // 全面スクリム（背景マップへのタップ貫通・誤操作を防止）
      '.kdc-scrim{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483000;display:none}',
      '.kdc-scrim.open{display:block}',
      // パネル
      '.kdc-panel{position:fixed;left:14px;bottom:16px;z-index:2147483001;width:min(380px,calc(100vw - 28px));height:min(560px,calc(100dvh - 90px));background:#fff;border-radius:18px;box-shadow:0 14px 50px rgba(0,0,0,.4);display:none;flex-direction:column;overflow:hidden;' + FF + '}',
      '.kdc-panel.open{display:flex;animation:kdcUp .22s cubic-bezier(.18,.9,.32,1.1)}',
      '@keyframes kdcUp{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}',
      '@media(max-width:520px){.kdc-panel{left:0;right:0;bottom:0;top:auto;width:100vw;height:86dvh;border-radius:16px 16px 0 0}}',
      '.kdc-head{background:linear-gradient(135deg,#1a1a1a,#333);color:#fff;padding:14px 16px;display:flex;align-items:center;gap:10px;flex:none}',
      '.kdc-head .ti{font-weight:800;font-size:15px}.kdc-head .ti .k{color:#FABE00}',
      '.kdc-head .su{font-size:11px;opacity:.82;margin-top:2px}',
      '.kdc-x{margin-left:auto;background:rgba(255,255,255,.14);border:none;color:#fff;font-size:20px;line-height:1;cursor:pointer;width:32px;height:32px;border-radius:50%;flex:none}',
      // ボディ（アコーディオン一覧）
      '.kdc-body{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;background:#fff}',
      '.kdc-item{border-bottom:1px solid #eceef1}',
      '.kdc-item>summary{list-style:none;cursor:pointer;padding:14px 15px;font-size:13.5px;font-weight:700;color:#1a1a1a;display:flex;align-items:flex-start;gap:9px;line-height:1.45}',
      '.kdc-item>summary::-webkit-details-marker{display:none}',
      '.kdc-item>summary::before{content:"＋";color:#FABE00;font-weight:900;font-size:15px;line-height:1.35;flex:none}',
      '.kdc-item[open]>summary{background:#fffdf5}',
      '.kdc-item[open]>summary::before{content:"－"}',
      '.kdc-item .a{padding:2px 15px 15px 33px;font-size:13px;line-height:1.65;color:#333}',
      '.kdc-item .a p{margin:0 0 7px}.kdc-item .a ul,.kdc-item .a ol{margin:5px 0 7px;padding-left:18px}.kdc-item .a li{margin:3px 0}',
      '.kdc-item .a .ttl{font-weight:800;margin:8px 0 3px;color:#111}',
      '.kdc-item .a .warn{background:#fff7ed;border:1px solid #fed7aa;border-radius:9px;padding:8px 10px;font-size:12.5px;margin:6px 0}',
      '.kdc-item .a .blue,.kdc-item .a a{color:#2563eb}.kdc-item .a b{color:#1a1a1a}',
      '.kdc-item .a .info{background:#f6f7f9;border-radius:10px;padding:10px 12px;margin-top:6px}.kdc-item .a .info .row{display:flex;gap:8px;margin:3px 0;font-size:12.5px}.kdc-item .a .info .k{color:#6b7280;min-width:84px}',
      '.kdc-empty{padding:24px 16px;text-align:center;color:#6b7280;font-size:13px}',
      // 検索バー
      '.kdc-search{padding:10px 12px;border-bottom:1px solid #eceef1;background:#fff;position:relative;flex:none}',
      '.kdc-search input{width:100%;border:1.5px solid #d1d5db;border-radius:11px;padding:9px 34px 9px 12px;font-size:16px;outline:none;box-sizing:border-box;' + FF + '}',
      '.kdc-search input:focus{border-color:#FABE00}',
      '.kdc-clear{display:none;position:absolute;right:22px;top:50%;transform:translateY(-50%);background:#e5e7eb;border:none;border-radius:50%;width:22px;height:22px;font-size:13px;line-height:1;cursor:pointer;color:#374151}',
      // 解決フィードバック
      '.kdc-fb{margin-top:11px;padding-top:10px;border-top:1px dashed #e5e7eb;display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12.5px;color:#374151}',
      '.kdc-fb>span{font-weight:700}',
      '.kdc-fb .yes,.kdc-fb .no{border:1px solid #d1d5db;background:#fff;border-radius:999px;padding:5px 16px;font-size:12.5px;font-weight:800;cursor:pointer}',
      '.kdc-fb .yes{color:#059669;border-color:#a7f3d0}.kdc-fb .no{color:#dc2626;border-color:#fecaca}',
      '.kdc-fb .ok{color:#059669;font-weight:800}',
      '.kdc-fb-more{flex-basis:100%;font-weight:700;color:#6b7280;margin-top:2px}',
      '.kdc-fb-chips{flex-basis:100%;display:flex;flex-direction:column;gap:6px}',
      '.kdc-chip2{text-align:left;background:#f6f7f9;border:1px solid #e5e7eb;border-radius:9px;padding:8px 10px;font-size:12.5px;cursor:pointer;color:#1f2937;line-height:1.35}',
      '.kdc-fb-line{display:inline-block;background:#06c755;color:#fff;text-decoration:none;font-weight:800;font-size:12.5px;padding:9px 15px;border-radius:10px;margin-top:4px}'
    ].join('');
    document.head.appendChild(s);
  }

  var bodyEl, panelEl, scrimEl;
  function allList() {
    var lg = lang(); return FAQ[lg] && FAQ[lg].length ? FAQ[lg] : FAQ.ja;
  }
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // 1項目（<details>）。開いたら view ログ＋「解決しましたか？」を表示
  function buildItem(it, peers) {
    var d = document.createElement('details'); d.className = 'kdc-item';
    d.innerHTML = '<summary>' + esc(it.q) + '</summary><div class="a">' + it.a + '</div>';
    var ansEl = d.querySelector('.a');
    d.addEventListener('toggle', function () {
      if (!d.open) return;
      logEv('view', { question: it.q });
      if (d._fb) return; d._fb = true;
      var fb = document.createElement('div'); fb.className = 'kdc-fb';
      fb.innerHTML = '<span>' + L().fbAsk + '</span><button class="yes">' + L().fbYes + '</button><button class="no">' + L().fbNo + '</button>';
      fb.querySelector('.yes').onclick = function () { logEv('resolved', { question: it.q }); fb.innerHTML = '<span class="ok">' + L().fbThanks + '</span>'; };
      fb.querySelector('.no').onclick = function () {
        logEv('unresolved', { question: it.q });
        var others = (peers || []).filter(function (p) { return p.q !== it.q; }).slice(0, 3);
        fb.innerHTML = (others.length ? '<div class="kdc-fb-more">' + L().other + '</div><div class="kdc-fb-chips"></div>' : '')
          + '<a class="kdc-fb-line" href="' + LINE_URL + '" target="_blank" rel="noopener">' + L().lineQ + '</a>';
        var ln = fb.querySelector('.kdc-fb-line'); if (ln) ln.onclick = function () { logEv('escalate_line', { question: it.q }); };
        var box = fb.querySelector('.kdc-fb-chips');
        if (box) others.forEach(function (o) {
          var b = document.createElement('button'); b.className = 'kdc-chip2'; b.textContent = o.q;
          b.onclick = function () { d.open = false; var t = document.getElementById(o._domid); if (t) { t.open = true; t.scrollIntoView({ block: 'nearest' }); } };
          box.appendChild(b);
        });
      };
      ansEl.appendChild(fb);
    });
    return d;
  }

  // 一覧（または検索結果）を描画。同時に開くのは1つだけ
  function renderList(entries, isSearch) {
    entries = entries || allList();
    bodyEl.innerHTML = '';
    if (isSearch && !entries.length) {
      var e = document.createElement('div'); e.className = 'kdc-empty';
      e.innerHTML = esc(L().none) + '<div style="margin-top:11px"><a class="kdc-fb-line" href="' + LINE_URL + '" target="_blank" rel="noopener">' + L().lineQ + '</a></div>';
      var a = e.querySelector('a'); if (a) a.onclick = function () { logEv('escalate_line', {}); };
      bodyEl.appendChild(e); return;
    }
    var acc = document.createElement('div');
    entries.forEach(function (it, i) { it._domid = 'kdc-i-' + i; var d = buildItem(it, entries); d.id = it._domid; acc.appendChild(d); });
    // toggle はバブルしないので capture で受ける → 開いたら他を閉じる（1つだけ開く）
    acc.addEventListener('toggle', function (ev) {
      var d = ev.target;
      if (d && d.tagName === 'DETAILS' && d.open) acc.querySelectorAll('details[open]').forEach(function (o) { if (o !== d) o.open = false; });
    }, true);
    bodyEl.appendChild(acc);
  }

  function buildPanel() {
    css();
    scrimEl = document.createElement('div');
    scrimEl.className = 'kdc-scrim';
    scrimEl.onclick = close;
    document.body.appendChild(scrimEl);

    panelEl = document.createElement('div');
    panelEl.className = 'kdc-panel';
    panelEl.innerHTML =
      '<div class="kdc-head"><div><div class="ti">KEY<span class="k">DROP</span> ' + L().title + '</div><div class="su">' + L().sub + '</div></div><button class="kdc-x" aria-label="close">×</button></div>'
      + '<div class="kdc-search"><input type="text" placeholder="' + esc(L().ph) + '"><button class="kdc-clear" aria-label="clear">×</button></div>'
      + '<div class="kdc-body"></div>';
    document.body.appendChild(panelEl);
    bodyEl = panelEl.querySelector('.kdc-body');
    panelEl.querySelector('.kdc-x').onclick = close;
    // 検索：入力＝近い候補を複数表示／空＝全件。ログはタイプ確定（1.3秒静止）で1回
    var inp = panelEl.querySelector('.kdc-search input');
    var clr = panelEl.querySelector('.kdc-clear');
    var rT = null, lT = null;
    inp.addEventListener('input', function () {
      var v = inp.value.trim();
      clr.style.display = v ? 'block' : 'none';
      clearTimeout(rT); clearTimeout(lT);
      if (!v) { renderList(allList(), false); return; }
      rT = setTimeout(function () { renderList(search(v), true); }, 280);
      if (v.length >= 2) lT = setTimeout(function () { var r = search(v); logEv(r.length ? 'search' : 'no_result', { query: v }); }, 1300);
    });
    clr.onclick = function () { inp.value = ''; clr.style.display = 'none'; renderList(allList(), false); inp.focus(); };
  }
  // ヘッダー（上部バー）の🌐の隣に「❓よくある質問」を常設（スマホで見つけやすい・下部カードと重ならない）
  function mountHelpBtn() {
    var boxes = document.querySelectorAll('.header-actions');
    if (!boxes.length) return false;
    boxes.forEach(function (box) {
      if (box.querySelector('.kd-help-h')) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'kd-lang-btn kd-help-h';
      b.innerHTML = '❓ <span>' + L().open + '</span>';
      b.onclick = function (e) { e.stopPropagation(); open(); };
      box.insertBefore(b, box.firstChild);
    });
    return true;
  }
  // ヘッダーが無いページ用フォールバック（エリア選択ゲート等）
  function buildFab() {
    if (document.querySelector('.kdc-fab')) return;
    var fab = document.createElement('button');
    fab.className = 'kdc-fab';
    fab.innerHTML = '❓ <span class="lbl">' + L().open + '</span>';
    fab.onclick = open;
    document.body.appendChild(fab);
  }
  function open() {
    if (!bodyEl.childElementCount) renderList(allList(), false);
    scrimEl.classList.add('open');
    panelEl.classList.add('open');
    logEv('open', {});
  }
  function close() {
    panelEl.classList.remove('open');
    scrimEl.classList.remove('open');
  }

  function init() {
    buildPanel();
    mountHelpBtn();
    setInterval(mountHelpBtn, 1200); // 再描画でヘッダーが作り直されても❓を再注入
    setTimeout(function () { if (!document.querySelector('.kd-help-h')) buildFab(); }, 3000); // ヘッダーが無いページ用フォールバック
    loadFAQ().then(function () { if (panelEl.classList.contains('open')) renderList(); })
      .catch(function () { /* fetch失敗でもUIは出る（一覧が空になるだけ） */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
