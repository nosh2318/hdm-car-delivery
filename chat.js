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
    ja: { title: 'KEYDROP サポート', sub: 'よくある質問にお答えします', ph: '質問を入力（例：料金は？）',
      greet: 'こんにちは！KEYDROPのよくある質問にお答えします🔑 下のボタンか、知りたいことを入力してください。',
      none: '申し訳ございません、うまく見つかりませんでした。お手数ですが公式LINEまたはお電話でお問い合わせください。',
      more: 'こちらもよく見られています', line: '公式LINEで質問', tel: '電話する（' + TEL + '）',
      send: '送信', open: 'チャットで質問', related: 'もしかして：' },
    en: { title: 'KEYDROP Support', sub: 'We answer common questions', ph: 'Type your question (e.g. price?)',
      greet: 'Hi! I can answer common KEYDROP questions🔑 Tap a button below or type what you want to know.',
      none: 'Sorry, I could not find that. Please contact us via Official LINE or phone.',
      more: 'People also ask', line: 'Ask on Official LINE', tel: 'Call (' + TEL + ')',
      send: 'Send', open: 'Chat with us', related: 'Did you mean:' },
    zh: { title: 'KEYDROP 客服', sub: '為您解答常見問題', ph: '輸入問題（例：費用？）',
      greet: '您好！我可以回答KEYDROP的常見問題🔑 請點下方按鈕或輸入您想了解的內容。',
      none: '抱歉，沒有找到相關內容。請透過官方LINE或電話與我們聯絡。',
      more: '其他人也在問', line: '用官方LINE詢問', tel: '撥打電話（' + TEL + '）',
      send: '送出', open: '線上諮詢', related: '您是不是想問：' },
    ko: { title: 'KEYDROP 고객지원', sub: '자주 묻는 질문에 답합니다', ph: '질문을 입력（예: 요금?）',
      greet: '안녕하세요! KEYDROP 자주 묻는 질문에 답해 드립니다🔑 아래 버튼을 누르거나 궁금한 점을 입력하세요.',
      none: '죄송합니다. 찾지 못했습니다. 공식 LINE 또는 전화로 문의해 주세요.',
      more: '이런 질문도 많이 해요', line: '공식 LINE으로 문의', tel: '전화하기（' + TEL + '）',
      send: '보내기', open: '채팅 문의', related: '혹시 이건가요:' }
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

  function search(query) {
    var lg = lang(); var list = FAQ[lg] && FAQ[lg].length ? FAQ[lg] : FAQ.ja;
    var qb = bigrams(expand(norm(query)));
    var qkeys = Object.keys(qb);
    if (!qkeys.length) return [];
    var scored = list.map(function (e) {
      var hit = 0;
      var eb = bigrams(e.q + e.q + e.q + ' ' + e.blob); // 質問文を重み付け
      for (var k = 0; k < qkeys.length; k++) if (eb[qkeys[k]]) hit++;
      return { e: e, score: hit / Math.max(4, qkeys.length) };
    }).filter(function (x) { return x.score > 0.18; });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, 4).map(function (x) { return x.e; });
  }

  // ---- UI ----
  function css() {
    if (document.getElementById('kdchat-css')) return;
    var s = document.createElement('style'); s.id = 'kdchat-css';
    s.textContent = [
      '.kdc-fab{position:fixed;left:14px;bottom:16px;z-index:1500;display:flex;align-items:center;gap:8px;background:linear-gradient(135deg,#1a1a1a,#333);color:#fff;border:2px solid #FABE00;border-radius:999px;padding:11px 16px 11px 13px;font-weight:800;font-size:13.5px;cursor:pointer;box-shadow:0 6px 20px rgba(0,0,0,.28);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif}',
      '.kdc-fab span.k{color:#FABE00}',
      '.kdc-fab:active{transform:scale(.96)}',
      '@media(max-width:520px){.kdc-fab{font-size:0;padding:13px;gap:0}.kdc-fab .lbl{display:none}}',
      '.kdc-panel{position:fixed;left:14px;bottom:16px;z-index:1600;width:min(380px,calc(100vw - 28px));height:min(560px,calc(100dvh - 90px));background:#fff;border-radius:18px;box-shadow:0 14px 50px rgba(0,0,0,.32);display:none;flex-direction:column;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif}',
      '.kdc-panel.open{display:flex;animation:kdcUp .22s cubic-bezier(.18,.9,.32,1.1)}',
      '@keyframes kdcUp{from{transform:translateY(16px);opacity:0}to{transform:translateY(0);opacity:1}}',
      '.kdc-head{background:linear-gradient(135deg,#1a1a1a,#333);color:#fff;padding:13px 15px;display:flex;align-items:center;gap:10px}',
      '.kdc-head .ti{font-weight:800;font-size:15px}.kdc-head .ti .k{color:#FABE00}',
      '.kdc-head .su{font-size:11px;opacity:.8;margin-top:1px}',
      '.kdc-x{margin-left:auto;background:none;border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer;opacity:.85;padding:0 2px}',
      '.kdc-body{flex:1;overflow-y:auto;padding:14px;background:#f6f7f9;display:flex;flex-direction:column;gap:10px}',
      '.kdc-msg{max-width:88%;padding:10px 13px;border-radius:14px;font-size:13.5px;line-height:1.55;word-break:break-word}',
      '.kdc-bot{align-self:flex-start;background:#fff;color:#1a1a1a;border:1px solid #e5e7eb;border-bottom-left-radius:5px}',
      '.kdc-user{align-self:flex-end;background:#FABE00;color:#1a1a1a;font-weight:700;border-bottom-right-radius:5px}',
      '.kdc-bot .a p{margin:0 0 6px}.kdc-bot .a ul,.kdc-bot .a ol{margin:4px 0 6px;padding-left:18px}.kdc-bot .a li{margin:2px 0}',
      '.kdc-bot .a .ttl{font-weight:800;margin:7px 0 3px}.kdc-bot .a .warn{background:#fff7ed;border:1px solid #fed7aa;border-radius:9px;padding:7px 9px;font-size:12.5px;margin:5px 0}',
      '.kdc-bot .a .blue,.kdc-bot .a a{color:#2563eb}.kdc-bot .a b{color:#1a1a1a}',
      '.kdc-q{font-weight:800;font-size:13px;margin:0 0 5px;color:#111}',
      '.kdc-chips{display:flex;flex-wrap:wrap;gap:7px}',
      '.kdc-chip{background:#fff;border:1px solid #d1d5db;border-radius:999px;padding:7px 12px;font-size:12.5px;cursor:pointer;color:#1f2937;text-align:left;line-height:1.3}',
      '.kdc-chip:active{background:#f3f4f6}',
      '.kdc-lbl{font-size:11.5px;color:#6b7280;font-weight:700;margin:2px 0 -2px}',
      '.kdc-cta{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px}',
      '.kdc-cta a{flex:1;min-width:120px;text-align:center;text-decoration:none;font-weight:800;font-size:12.5px;padding:9px;border-radius:11px}',
      '.kdc-cta .line{background:#06c755;color:#fff}.kdc-cta .tel{background:#1a1a1a;color:#fff}',
      '.kdc-foot{display:flex;gap:8px;padding:10px;border-top:1px solid #eceef1;background:#fff}',
      '.kdc-foot input{flex:1;border:1.5px solid #d1d5db;border-radius:11px;padding:10px 12px;font-size:16px;outline:none}',
      '.kdc-foot input:focus{border-color:#FABE00}',
      '.kdc-foot button{background:#1a1a1a;color:#fff;border:none;border-radius:11px;padding:0 15px;font-weight:800;font-size:13px;cursor:pointer}'
    ].join('');
    document.head.appendChild(s);
  }

  var bodyEl, inputEl, panelEl;
  function add(html, who) {
    var d = document.createElement('div');
    d.className = 'kdc-msg ' + (who === 'user' ? 'kdc-user' : 'kdc-bot');
    d.innerHTML = html;
    bodyEl.appendChild(d);
    bodyEl.scrollTop = bodyEl.scrollHeight;
    return d;
  }
  function chips(items, onPick) {
    var wrap = document.createElement('div'); wrap.className = 'kdc-chips';
    items.forEach(function (it) {
      var b = document.createElement('button'); b.className = 'kdc-chip'; b.textContent = it.q;
      b.onclick = function () { onPick(it); };
      wrap.appendChild(b);
    });
    bodyEl.appendChild(wrap); bodyEl.scrollTop = bodyEl.scrollHeight;
  }
  function quickList() {
    var lg = lang(); var list = FAQ[lg] && FAQ[lg].length ? FAQ[lg] : FAQ.ja;
    return list.slice(0, 6);
  }
  function answer(entry) {
    add('<div class="kdc-q">' + entry.q + '</div><div class="a">' + entry.a + '</div>', 'bot');
    // 関連（同検索の2〜4位）
    var rel = search(entry.q).filter(function (e) { return e.q !== entry.q; }).slice(0, 3);
    if (rel.length) { var l = document.createElement('div'); l.className = 'kdc-lbl'; l.textContent = L().more; bodyEl.appendChild(l); chips(rel, answer); }
  }
  function noResult() {
    add(L().none, 'bot');
    var c = document.createElement('div'); c.className = 'kdc-cta';
    c.innerHTML = '<a class="line" href="' + LINE_URL + '" target="_blank" rel="noopener">' + L().line + '</a>'
      + '<a class="tel" href="tel:' + TEL.replace(/-/g, '') + '">' + L().tel + '</a>';
    bodyEl.appendChild(c); bodyEl.scrollTop = bodyEl.scrollHeight;
  }
  function ask(q) {
    add(q.replace(/</g, '&lt;'), 'user');
    var res = search(q);
    if (!res.length) { noResult(); return; }
    answer(res[0]);
  }
  function greet() {
    bodyEl.innerHTML = '';
    add(L().greet, 'bot');
    if (faqLoaded) chips(quickList(), answer);
  }

  function build() {
    css();
    var fab = document.createElement('button');
    fab.className = 'kdc-fab';
    fab.innerHTML = '💬 <span class="lbl"><span class="k">?</span> ' + L().open + '</span>';
    fab.onclick = open;
    document.body.appendChild(fab);

    panelEl = document.createElement('div');
    panelEl.className = 'kdc-panel';
    panelEl.innerHTML =
      '<div class="kdc-head"><div><div class="ti">KEY<span class="k">DROP</span> ' + L().title.replace(/^KEYDROP\s*/, '') + '</div><div class="su">' + L().sub + '</div></div><button class="kdc-x" aria-label="close">×</button></div>'
      + '<div class="kdc-body"></div>'
      + '<div class="kdc-foot"><input type="text" placeholder="' + L().ph + '"><button>' + L().send + '</button></div>';
    document.body.appendChild(panelEl);
    bodyEl = panelEl.querySelector('.kdc-body');
    inputEl = panelEl.querySelector('input');
    panelEl.querySelector('.kdc-x').onclick = close;
    var sendBtn = panelEl.querySelector('.kdc-foot button');
    function submit() { var v = inputEl.value.trim(); if (!v) return; inputEl.value = ''; ask(v); }
    sendBtn.onclick = submit;
    inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
  }
  function open() {
    panelEl.classList.add('open');
    if (!bodyEl.childElementCount) greet();
    setTimeout(function () { try { inputEl.focus(); } catch (e) {} }, 150);
  }
  function close() { panelEl.classList.remove('open'); }

  function init() {
    build();
    loadFAQ().then(function () { /* 既に開いていれば quick chips 追加 */ if (panelEl.classList.contains('open') && bodyEl.childElementCount <= 1) greet(); })
      .catch(function () { /* fetch失敗でもUIは出す（検索は空→LINE誘導） */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
