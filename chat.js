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
    ja: { title: 'KEYDROP サポート', sub: 'よくある質問にお答えします',
      greet: 'こんにちは！KEYDROPのよくある質問です🔑 知りたい項目をタップしてください。',
      more: 'こちらもよく見られています', line: '公式LINEで質問', tel: '電話する（' + TEL + '）',
      open: 'よくある質問', list: '📋 ほかの質問を見る', pick: '質問をタップしてください' },
    en: { title: 'KEYDROP Support', sub: 'We answer common questions',
      greet: 'Hi! Here are common KEYDROP questions🔑 Tap the topic you want to know.',
      more: 'People also ask', line: 'Ask on Official LINE', tel: 'Call (' + TEL + ')',
      open: 'FAQ / Help', list: '📋 See other questions', pick: 'Tap a question' },
    zh: { title: 'KEYDROP 客服', sub: '為您解答常見問題',
      greet: '您好！這是KEYDROP常見問題🔑 請點選您想了解的項目。',
      more: '其他人也在問', line: '用官方LINE詢問', tel: '撥打電話（' + TEL + '）',
      open: '常見問題', list: '📋 查看其他問題', pick: '請點選問題' },
    ko: { title: 'KEYDROP 고객지원', sub: '자주 묻는 질문에 답합니다',
      greet: '안녕하세요! KEYDROP 자주 묻는 질문입니다🔑 원하는 항목을 눌러주세요.',
      more: '이런 질문도 많이 해요', line: '공식 LINE으로 문의', tel: '전화하기（' + TEL + '）',
      open: '자주 묻는 질문', list: '📋 다른 질문 보기', pick: '질문을 눌러주세요' }
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

  // ---- UI（アコーディオン式：項目タップ→開く→再タップで閉じる の固定フロー） ----
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
      '.kdc-empty{padding:24px 16px;text-align:center;color:#6b7280;font-size:13px}'
    ].join('');
    document.head.appendChild(s);
  }

  var bodyEl, panelEl, scrimEl;
  function allList() {
    var lg = lang(); return FAQ[lg] && FAQ[lg].length ? FAQ[lg] : FAQ.ja;
  }
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // 一覧を描画（各項目＝<details>。タップで開閉。同時に開くのは1つだけ）
  function renderList() {
    bodyEl.innerHTML = '';
    var list = allList();
    if (!list.length) { var e = document.createElement('div'); e.className = 'kdc-empty'; e.textContent = '…'; bodyEl.appendChild(e); return; }
    var acc = document.createElement('div');
    list.forEach(function (it) {
      var d = document.createElement('details'); d.className = 'kdc-item';
      d.innerHTML = '<summary>' + esc(it.q) + '</summary><div class="a">' + it.a + '</div>';
      acc.appendChild(d);
    });
    // toggle はバブルしないので capture で受ける → 開いたら他を閉じる（1つだけ開く）
    acc.addEventListener('toggle', function (ev) {
      var d = ev.target;
      if (d && d.tagName === 'DETAILS' && d.open) {
        acc.querySelectorAll('details[open]').forEach(function (o) { if (o !== d) o.open = false; });
      }
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
      + '<div class="kdc-body"></div>';
    document.body.appendChild(panelEl);
    bodyEl = panelEl.querySelector('.kdc-body');
    panelEl.querySelector('.kdc-x').onclick = close;
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
    if (!bodyEl.childElementCount) renderList();
    scrimEl.classList.add('open');
    panelEl.classList.add('open');
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
