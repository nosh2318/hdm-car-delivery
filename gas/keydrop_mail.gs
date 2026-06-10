/**
 * KEYDROP 通知メール送信ワーカー（GAS・5分トリガー）
 * 2026-06-10 / omni
 *
 * 役割: Supabase の通知キュー keydrop_notifications(sent=false) を回収し、
 *       reserve@rent-handyman.jp から送信して sent=true にする。
 *   - type='confirm'        : 予約完了（入金確認）→ 顧客へ
 *   - type='cancel_request' : キャンセル依頼     → 運営へ
 *
 * 前提（新規GASプロジェクトを noritaka.oshita@gmail.com で作成）:
 *   1) スクリプトプロパティ SUPABASE_SERVICE_KEY に Supabase service_role キー（JWT・legacy）を設定
 *      ※ keydrop_notifications は RLSで anon/authenticated 不可＝service_role 必須
 *   2) Gmail に reserve@rent-handyman.jp の「名前を指定して送信(send-as)」エイリアスが登録済みであること
 *   3) setupKeydropMailTrigger() を1回手動実行して5分トリガーを作成
 *
 * 緊急停止: sendKeydropNotifications 冒頭に return; を入れる（関数は残す）。
 */

var SB_URL = 'https://ckrxttbnawkclshczsia.supabase.co';
var FROM_EMAIL = 'reserve@rent-handyman.jp';
var FROM_NAME  = 'CARデリバリー KEYDROP';
var MYPAGE_URL = 'https://nosh2318.github.io/hdm-car-delivery/?mypage=1';
var LINE_URL   = 'https://lin.ee/g6iDNYz';
var LINE_ID    = '@730kyhwl';
var TEL        = '050-1724-6197';

function _sbKey_() {
  var k = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  if (!k) throw new Error('SUPABASE_SERVICE_KEY 未設定');
  return k;
}
function _sbGet_(path) {
  var res = UrlFetchApp.fetch(SB_URL + '/rest/v1/' + path, {
    method: 'get', muteHttpExceptions: true,
    headers: { apikey: _sbKey_(), Authorization: 'Bearer ' + _sbKey_() }
  });
  if (res.getResponseCode() >= 300) { Logger.log('sbGet ' + path + ': ' + res.getContentText()); return []; }
  return JSON.parse(res.getContentText() || '[]');
}
function _sbPatch_(path, body) {
  var res = UrlFetchApp.fetch(SB_URL + '/rest/v1/' + path, {
    method: 'patch', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: _sbKey_(), Authorization: 'Bearer ' + _sbKey_(), Prefer: 'return=minimal' },
    payload: JSON.stringify(body)
  });
  return res.getResponseCode() < 300;
}

function _yen_(n) { return '¥' + Number(n || 0).toLocaleString('ja-JP'); }
function _dt_(d, t) { return (d || '') + (t ? ' ' + t : ''); }

/** メイン：5分トリガー */
function sendKeydropNotifications() {
  var rows = _sbGet_('keydrop_notifications?sent=eq.false&order=created_at.asc&limit=50&select=*');
  if (!rows || rows.length === 0) return;
  var okCount = 0, ngCount = 0;
  for (var i = 0; i < rows.length; i++) {
    var n = rows[i];
    try {
      var mail = (n.type === 'confirm') ? _buildConfirmMail_(n) : _buildCancelRequestMail_(n);
      if (!n.to_email || n.to_email.indexOf('@') < 0) throw new Error('宛先不正: ' + n.to_email);
      GmailApp.sendEmail(n.to_email, mail.subject, mail.body, { from: FROM_EMAIL, name: FROM_NAME });
      _sbPatch_('keydrop_notifications?id=eq.' + n.id, { sent: true, sent_at: new Date().toISOString(), error: null });
      okCount++;
    } catch (e) {
      _sbPatch_('keydrop_notifications?id=eq.' + n.id, { error: String(e).slice(0, 480) });
      ngCount++;
      Logger.log('[keydrop_mail] id=' + n.id + ' err=' + e);
    }
  }
  Logger.log('[keydrop_mail] sent=' + okCount + ' failed=' + ngCount);
}

/** 予約完了メール（顧客向け） */
function _buildConfirmMail_(n) {
  var p = n.payload || {};
  var id = n.reservation_id || '';
  var subject = '【KEYDROP】ご予約が確定しました（予約番号 ' + id + '）';
  var body =
    (p.name || 'お客様') + ' 様\n\n' +
    'この度はCARデリバリーKEYDROPをご利用いただき誠にありがとうございます。\n' +
    'お支払いを確認し、ご予約が確定いたしました。\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '■ ご予約内容\n' +
    '予約番号　：' + id + '\n' +
    '車両クラス：' + (p.vehicleClass || '') + '\n' +
    'お届け　　：' + _dt_(p.lend_date, p.lend_time) + '\n' +
    '　　場所　：' + (p.del_place || '（ご指定の場所）') + '\n' +
    'ご返却　　：' + _dt_(p.return_date, p.return_time) + '\n' +
    '　　場所　：' + (p.col_place || p.del_place || '（ご指定の場所）') + '\n' +
    'ご利用人数：' + (p.people || 1) + '名\n' +
    '補償　　　：' + (p.insurance || 'なし') + '\n' +
    'お支払い額：' + _yen_(p.price) + '\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    '■ ご予約の確認・変更・キャンセル\n' +
    'マイページからお手続きいただけます（予約番号＋登録メールでログイン）。\n' +
    MYPAGE_URL + '\n' +
    '※お届け・回収の場所/時間の変更は出発24時間前まで。\n' +
    '※キャンセルのご依頼はマイページの「キャンセルをリクエスト」より承ります。\n\n' +
    '■ お問い合わせ\n' +
    '公式LINE：' + LINE_URL + '（ID: ' + LINE_ID + '）\n' +
    '緊急連絡先：' + TEL + '（営業時間 9:00〜19:00）\n\n' +
    'CARデリバリー KEYDROP\n';
  return { subject: subject, body: body };
}

/** キャンセル依頼メール（運営向け） */
function _buildCancelRequestMail_(n) {
  var p = n.payload || {};
  var id = n.reservation_id || '';
  var subject = '【KEYDROP】キャンセル依頼 予約番号 ' + id + ' / ' + (p.name || '') + '様';
  var body =
    '顧客がマイページでキャンセルを依頼しました。\n' +
    '返金額（キャンセル料率）を判断のうえ、SPK admin で確定処理をしてください。\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '予約番号　：' + id + '\n' +
    '氏名　　　：' + (p.name || '') + '\n' +
    '連絡先　　：' + (p.mail || '') + ' / ' + (p.tel || '') + '\n' +
    '車両クラス：' + (p.vehicleClass || '') + '\n' +
    '期間　　　：' + _dt_(p.lend_date, p.lend_time) + ' 〜 ' + _dt_(p.return_date, p.return_time) + '\n' +
    'お届け場所：' + (p.del_place || '') + '\n' +
    '回収場所　：' + (p.col_place || '') + '\n' +
    '金額　　　：' + _yen_(p.price) + '\n' +
    '現ステータス：' + (p.status || '') + '\n' +
    'キャンセル理由：' + (p.reason || '（記入なし）') + '\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    '■ 対応手順\n' +
    '1) 返金額（キャンセル料率）を判断\n' +
    '2) Square で返金（必要時）\n' +
    '3) SPK admin（データタブ）で status を「キャンセル」に変更\n' +
    '4) 顧客へ確定のご連絡（LINE/メール）\n';
  return { subject: subject, body: body };
}

/** 5分トリガー設定（1回だけ手動実行） */
function setupKeydropMailTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'sendKeydropNotifications') ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger('sendKeydropNotifications').timeBased().everyMinutes(5).create();
  Logger.log('keydrop_mail trigger set (5min)');
}

/** 動作確認（手動）：キュー先頭の未送信を1件ドライ表示 */
function debugKeydropMail() {
  var rows = _sbGet_('keydrop_notifications?sent=eq.false&order=created_at.asc&limit=1&select=*');
  if (!rows.length) { Logger.log('未送信なし'); return; }
  var n = rows[0];
  var mail = (n.type === 'confirm') ? _buildConfirmMail_(n) : _buildCancelRequestMail_(n);
  Logger.log('TO: ' + n.to_email + '\nSUBJECT: ' + mail.subject + '\n\n' + mail.body);
}
