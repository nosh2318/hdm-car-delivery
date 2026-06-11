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
var FROM_NAME  = 'CARデリバリー KEY-DROP';
var MYPAGE_URL = 'https://keydrop.jp/?mypage=1';
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
      var mail = (n.type === 'confirm') ? _buildConfirmMail_(n)
               : (n.type === 'cancel_ack') ? _buildCancelAckMail_(n)
               : (n.type === 'cancel_done') ? _buildCancelDoneMail_(n)
               : (n.type === 'change_done') ? _buildChangeDoneMail_(n)
               : _buildCancelRequestMail_(n);
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
  var subject = 'CARデリバリー KEY-DROP ご予約が確定しました';
  var body =
    (p.name || 'お客様') + ' 様\n\n' +
    'この度はCARデリバリーKEY-DROPをご利用いただき誠にありがとうございます。\n' +
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
    '※ご予約内容の変更は公式LINEにて承ります（貸出の時間・場所＝貸出3日前19:00まで／返却＝返却2時間前まで／オプション・補償＝貸出前日19:00まで／日程・車種＝原則お取り直し）。\n' +
    '※キャンセルのご依頼はマイページの「キャンセルをリクエスト」より承ります。\n\n' +
    '■ お問い合わせ\n' +
    '公式LINE：' + LINE_URL + '（ID: ' + LINE_ID + '）\n' +
    '営業時間：9:00〜19:00\n\n' +
    'CARデリバリー KEY-DROP\n';
  return { subject: subject, body: body };
}

/** キャンセル依頼 受付メール（顧客向け） */
function _buildCancelAckMail_(n) {
  var p = n.payload || {};
  var id = n.reservation_id || '';
  var subject = 'CARデリバリー KEY-DROP キャンセル依頼を受け付けました（予約番号 ' + id + '）';
  var body =
    (p.name || 'お客様') + ' 様\n\n' +
    'キャンセルのご依頼を受け付けいたしました。\n' +
    '※この時点ではまだキャンセルは確定しておりません。\n' +
    '内容（返金可否・キャンセル料）を確認のうえ、担当者より折り返しご連絡いたします。\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '■ ご依頼内容\n' +
    '予約番号　：' + id + '\n' +
    '車両クラス：' + (p.vehicleClass || '') + '\n' +
    'お届け　　：' + _dt_(p.lend_date, p.lend_time) + '\n' +
    'ご返却　　：' + _dt_(p.return_date, p.return_time) + '\n' +
    'お支払い額：' + _yen_(p.price) + '\n' +
    'ご依頼理由：' + (p.reason || '（記入なし）') + '\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    '■ キャンセル料（目安）\n' +
    '・7日前まで：無料\n' +
    '・6〜3日前：基本料金の20%\n' +
    '・2〜1日前：基本料金の30%\n' +
    '・当日以降：基本料金の50%\n' +
    '※航空便欠航時は欠航証明書のご提示でキャンセル料無料。\n\n' +
    '■ ご確認\n' +
    'マイページで現在の状況をご確認いただけます。\n' +
    MYPAGE_URL + '\n\n' +
    '■ お問い合わせ\n' +
    '公式LINE：' + LINE_URL + '（ID: ' + LINE_ID + '）\n' +
    '営業時間：9:00〜19:00\n\n' +
    'CARデリバリー KEY-DROP\n';
  return { subject: subject, body: body };
}

/** キャンセル確定（返金）メール（顧客向け） */
function _buildCancelDoneMail_(n) {
  var p = n.payload || {};
  var id = n.reservation_id || '';
  var subject = 'CARデリバリー KEY-DROP キャンセルが確定しました（予約番号 ' + id + '）';
  var body =
    (p.name || 'お客様') + ' 様\n\n' +
    'ご予約のキャンセルが確定いたしました。\n' +
    'ご返金の手続きを行いましたのでお知らせいたします。\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '■ キャンセル内容\n' +
    '予約番号　：' + id + '\n' +
    '車両クラス：' + (p.vehicleClass || '') + '\n' +
    'お届け予定：' + (p.lend_date || '') + '\n' +
    'お支払い額：' + _yen_(p.paid) + '\n' +
    'キャンセル料：' + _yen_(p.fee) + (p.rate != null ? '（' + p.rate + '%）' : '') + '\n' +
    'ご返金額　：' + _yen_(p.refund) + '\n' +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    '※ご返金はカード会社の処理により、反映までお時間をいただく場合がございます。\n\n' +
    '■ お問い合わせ\n' +
    '公式LINE：' + LINE_URL + '（ID: ' + LINE_ID + '）\n' +
    '営業時間：9:00〜19:00\n\n' +
    'またのご利用を心よりお待ちしております。\n' +
    'CARデリバリー KEY-DROP\n';
  return { subject: subject, body: body };
}

/** 変更承認・反映メール（顧客向け） */
function _buildChangeDoneMail_(n) {
  var p = n.payload || {};
  var id = n.reservation_id || '';
  var d = p.del || null, c = p.col || null;
  var subject = 'CARデリバリー KEY-DROP ご予約内容の変更が確定しました（予約番号 ' + id + '）';
  var body =
    (p.name || 'お客様') + ' 様\n\n' +
    'ご依頼いただいた変更を確認し、反映いたしました。\n\n' +
    '━━━━━━━━━━━━━━━━━━━━\n' +
    '■ 変更後の内容\n' +
    '予約番号　：' + id + '\n' +
    (d ? ('お届け　　：' + (d.time || '') + (d.place ? '　' + d.place : '') + '\n') : '') +
    (c ? ('ご返却　　：' + (c.time || '') + (c.place ? '　' + c.place : '') + '\n') : '') +
    '━━━━━━━━━━━━━━━━━━━━\n\n' +
    '■ ご確認\n' +
    'マイページで最新の予約内容をご確認いただけます。\n' +
    MYPAGE_URL + '\n\n' +
    '■ お問い合わせ\n' +
    '公式LINE：' + LINE_URL + '（ID: ' + LINE_ID + '）\n' +
    '営業時間：9:00〜19:00\n\n' +
    'CARデリバリー KEY-DROP\n';
  return { subject: subject, body: body };
}

/** キャンセル依頼メール（運営向け） */
function _buildCancelRequestMail_(n) {
  var p = n.payload || {};
  var id = n.reservation_id || '';
  var subject = '【KEY-DROP】キャンセル依頼 予約番号 ' + id + ' / ' + (p.name || '') + '様';
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
