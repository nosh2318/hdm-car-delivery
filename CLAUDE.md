# HDM Car Delivery - プロジェクトコンテキスト

---

## 💳 KEYDROP Square決済＋予約完了メール＋キャンセル依頼（Phase B）実装（2026-06-10）

オーナー指示：「squareを実装」「予約完了時にユーザーへ自動返信メール必須」「キャンセルもマイページに実装＝ユーザーがリクエスト→運営に自動でキャンセルメール」。

### ✅ 反映済み（2026-06-10）
- **client push済**（commit `bf0b06f`・本番反映）。
- **Edge Function 3本 deploy済**：`create-booking`（Square link発行・鍵未設定時はpayUrl=nullで安全degrade）／`keydrop-mypage`（cancel_request追加）／`payment-webhook`（**--no-verify-jwt**でdeploy・SIG鍵未設定の間は全て401で安全）。
- **モバイル下部CTAクリップ不具合も修正・反映済**（後述）。
- ∴ 現状：場所選択〜予約フローは本番で動く。**「支払う」だけ未完**（Square鍵未設定→payUrl null→「決済ページに接続できません→LINE」アラート）。残りはオーナー作業（下記Go-Live 2,3,5＋DB RUN）だけ。
- ⚠️ Squareシークレット設定までは決済不能＝**まだ一般公開しない**（テスト予約はTTLで自動消滅）。

### アーキ（重要設計判断）
- 予約の正本は `reservations`（ota=KEYDROP / 採番KD-YYMM-NNNN-XXX）。金額は `keydrop_book` RPC が**サーバ側で価格マスターから確定**(005)。client値は信用しない。
- 決済フロー：client `processPayment` → `create-booking`(RPCで pending_payment 作成＋**Square Payment Link発行**) → 返却 `payUrl` へ `window.location` リダイレクト → Square Checkout → 決済成功で `redirect_url=...?paid=<予約番号>` に復帰（client が完了画面）→ Square が `payment-webhook` を叩く → **署名検証＋冪等＋pending_payment→confirmed**。
- 🔴 **会計起票しない**：KEYDROP売上は `reservations.price` 経由でダッシュボード/解析に計上済み。`spk_accounting` に入れると**二重計上（AIスタッフ_G事故と同型）**。webhookは状態遷移＋入金記録＋メール投入のみ。
- 突合台帳 `keydrop_payments`(007)：reservation_id PK・square_order_id・status(pending/paid)・paid_at。webhookの冪等性根拠（paidなら再処理しない）。anon/authenticated不可・service_roleのみ。
- レース対策：①TTL 30→**60分**に延長(006)②webhookで「決済成立だが pending_payment が無い(=TTL解放/取消)」を検知し **🔴要対応Slack通知**（入金あるのに枠なし＝再配車/返金を人手で）。

### 📧 通知（メール）＝キュー方式に一本化（重要）
- **`keydrop_notifications`(008)** に Edge Function が「送るべき通知」を1行=1通として積む → **GAS送信ワーカー `gas/keydrop_mail.gs`（5分トリガー）** が `reserve@rent-handyman.jp` から送信し sent=true 化。webhook/関数から直接送らずキュー化＝メール障害でも取りこぼさず再送可。Edge FunctionはGmailエイリアスを使えないのでGASが送信エンジン（既存HANDYMAN踏襲）。
- `type='confirm'`：**予約完了（入金確認）→ 顧客へ**。payment-webhookが confirmed 化と同時に投入（宛先=予約のmail・予約内容＋マイページURL＋LINE）。
- `type='cancel_request'`：**キャンセル依頼 → 運営へ**。運営通知は **Slackが主**（keydrop-mypageが常時Slack通知）。メールは **`KEYDROP_OPS_EMAIL` を設定した時だけ**送る（🔴既定はreserve@にしない＝問い合わせ管理GASがreserve@受信箱を監視→誤取込を避ける。設定するならSlackチャンネルのメール連携アドレス or 専用ops@。未設定ならSlackのみ）。オーナー選択=A（2026-06-10）。

### 🚫 キャンセルは「リクエスト」化（即キャンセルしない）
- マイページのキャンセルボタン＝「**キャンセルをリクエストする**」。理由入力可。`keydrop-mypage action='cancel_request'`：**statusは変えず** reservations.changed_json に `kd_cancel_requested_at`＋理由を記録／d-,c-タスクmemoに🔴依頼マーカー／`keydrop_notifications`に運営宛メール投入／Slack即時通知。
- 返金額（キャンセル料率）の判断は**運営がSPK adminで実施→status=キャンセル確定**。client は「依頼受付・運営から折り返し」バナー表示（statusはキャンセルにしない）。
- 旧 `action='cancel'`（即時自己キャンセル）はEdge Functionに残置（UIからは未使用・将来/admin用）。

### 変更ファイル（working tree）
| ファイル | 変更 |
|---|---|
| `supabase/migrations/006_keydrop_ttl.sql` | TTL 30→60分 |
| `supabase/migrations/007_keydrop_payments.sql` | **新規**：決済台帳 |
| `supabase/migrations/008_keydrop_notifications.sql` | **新規**：通知キュー |
| `supabase/functions/create-booking/index.ts` | `createSquareLink()` 追加・RPC後にリンク発行＋台帳pending記録・`payUrl`返却 |
| `supabase/functions/payment-webhook/index.ts` | **新規**：HMAC署名検証＋冪等＋confirmed化＋Slack＋レース警告＋**confirmメール投入** |
| `supabase/functions/keydrop-mypage/index.ts` | **`action='cancel_request'` 追加**（依頼記録＋運営メール投入＋Slack）。OPS_EMAIL定数 |
| `gas/keydrop_mail.gs` | **新規**：通知キュー送信ワーカー（reserve@・5分） |
| `index.html` | `processPayment`→payUrlリダイレクト／`?paid=`復帰で完了画面／`?mypage=1`でマイページ／キャンセルを`requestCancellation`（cancel_request）に変更＋受付バナー |

### 🔴 Go-Live 順序（この順でないと予約が壊れる）
1. **DB RUN**：`007`・`008` を RUN。`006`(60分版)を再RUN。（005適用済前提・未なら005も）
2. **Square ダッシュボード**：本番アプリで Webhook subscription 作成 → endpoint=`https://ckrxttbnawkclshczsia.supabase.co/functions/v1/payment-webhook` / イベント=`payment.created`,`payment.updated` → **Signature Key 取得**。
3. **Edge Function secrets**（supabase secrets set）：
   - `SQUARE_ACCESS_TOKEN`（本番・PAYMENTS_WRITE/ORDERS） / `SQUARE_LOCATION_ID`=`L8N7J9RKPN3WH`
   - `SQUARE_WEBHOOK_SIGNATURE_KEY`（手順2） / `SQUARE_WEBHOOK_URL`=上記endpoint（署名計算に厳密一致）
   - （任意）`SLACK_BOT_TOKEN` / `SLACK_KEYDROP_CHANNEL`=`C08TDTPEB36`（キャンセル依頼の運営通知＝主） / `KEYDROP_RETURN_URL`
   - `KEYDROP_OPS_EMAIL`：キャンセル依頼メールの宛先。**Slackチャンネルのメール連携アドレス推奨**（reserve@は使わない）。未設定＝メール送らずSlackのみ。
4. **Edge Function デプロイ**：`create-booking`・`keydrop-mypage` 再デプロイ。`payment-webhook` は **`--no-verify-jwt` でデプロイ**（Squareは Supabase JWT を送らない＝verify_jwt ON だと401で届かない・署名検証は関数内）。
   ```
   cd ~/hdm-car-delivery && SUPABASE_ACCESS_TOKEN="$(cat ~/.config/keydrop/sb_token)" \
     ~/.local/share/supabase/supabase functions deploy payment-webhook \
     --project-ref ckrxttbnawkclshczsia --use-api --no-verify-jwt
   ```
5. **GASメール送信ワーカー**：新規GASプロジェクトを noritaka.oshita@gmail.com で作成→`gas/keydrop_mail.gs` 貼付→ScriptProperty `SUPABASE_SERVICE_KEY`(service_role JWT)設定→reserve@ の send-as エイリアス確認→`setupKeydropMailTrigger()` を1回実行（5分トリガー）。`debugKeydropMail()` で本文確認。
6. **client を push**（GitHub Pages＝push即本番）。これで決済リダイレクト＋マイページが動く。
7. **疎通テスト**：少額予約→Square決済→`?paid=`復帰→`reservations.status=confirmed`＋`keydrop_payments.status=paid`＋**顧客に完了メール**＋Slack通知 を確認→テストデータ削除。マイページから「キャンセルをリクエスト」→**運営に依頼メール**＋Slack＋changed_jsonマーカー を確認。署名不正で401も確認。

### ✅ Go-Live ほぼ完了（2026-06-10・残=GASメールのみ）
1. ~~DB RUN~~ ✅ **完了**（007/008/006 を Management API `/v1/projects/{ref}/database/query` で実行＝SQL Editor不要。⚠️python urllibはCloudflare 1010で弾かれる→**curlで叩く**。PAT=`~/.config/keydrop/sb_token`）。TTLは60分でcron登録(`keydrop-expire-pending` */5)。
2. ~~Square管理画面~~ ✅ **完了**（Webhook「KEYDROP」作成・Enabled・events=Payments(2)=payment.created/updated。App=HandymanOnline・Production）。
3. ~~secrets設定~~ ✅ **完了**：`SQUARE_ACCESS_TOKEN`/`SQUARE_LOCATION_ID`=L8N7J9RKPN3WH(既存じゃらんと同じLocation・後で`L8Q5E50YG6M7K`札幌デリバリーに切替可)/`SQUARE_WEBHOOK_SIGNATURE_KEY`/`SQUARE_WEBHOOK_URL`/`SLACK_BOT_TOKEN`/`SLACK_KEYDROP_CHANNEL`=C08TDTPEB36。
4. ~~Edge Functionデプロイ~~ ✅ 完了（3本）。
5. 🔴 **GASメール送信ワーカー（唯一の残り）**：`gas/keydrop_mail.gs` を新規GAS(noritaka.oshita@)化＋ScriptProperty `SUPABASE_SERVICE_KEY`(service_role)＋reserve@ send-asエイリアス＋`setupKeydropMailTrigger()`実行(5分)。**これが無いと完了/キャンセルメールがキューに溜まるだけで届かない**。
6. ~~client push~~ ✅ 完了。
7. ~~疎通テスト（バックエンドE2E）~~ ✅ **完了**：create-booking→Square link発行(WTuSGDML)＋CX-3自動配車＋price¥7,000→署名付きwebhook(payment.updated/COMPLETED)→**reservations.status=confirmed＋keydrop_payments.status=paid＋keydrop_notifications(type=confirm)投入**を実証→テストデータ全削除。署名不正は401・GET405も確認済。**実カード決済での最終確認はGAS設置後にオーナーが1件実施**。

### ✅ 到達点（2026-06-10・全機能ライブ）
- 決済の裏側 完全稼働（支払う→Square→入金webhook→confirmed＋Slack）。実課金アンロック済み。
- **GASメール送信ワーカー 稼働開始**（新規GASプロジェクト・`SUPABASE_SERVICE_KEY`(legacy JWT)設定・`setupKeydropMailTrigger`済・5分間隔）。**予約完了メール 実送信ライブ確認済**（reserve@→顧客・sent=1）。キュー(keydrop_notifications)→reserve@配信。
- **キャンセル/返金 3層 完成**：①顧客マイページ「キャンセルをリクエスト」(ポリシー同意チェック＋送信・独立セクション)→②SPK TOP「🚫KEYDROPキャンセル依頼」リスト(返金額/料率/Square決済ID表示)→③スタッフがSquare手動返金→「確定」(2段階)＝keydrop-refund(記録のみ・自動返金しない)→予約キャンセル/台帳refunded/配車解放/Slack。マーカーは`keydrop_payments.cancel_requested_at`(reservationsにchanged_json列なし)。
- 残りは **実カード決済での最終E2E（オーナーがテスト予約1件）** のみ。⚠️実課金＝テスト後はマイページ→キャンセル依頼→SPKで返金 or Square Dashboardで返金。

### 追記（2026-06-10 後半セッション）
- **スパム対策②レート制限のみ採用**：011 `keydrop_rate`(IP×時間窓・1時間毎purge cron)。create-booking＝IP1時間8件超で429。keydrop-mypage＝IP1時間30回超で429(総当たり防止)。
  - 🔴**①ハニーポットは撤去**（2026-06-10）：隠しテキスト欄をブラウザ自動入力が埋め、実客が「不正なリクエスト」で弾かれた（決済フローで実客ブロックは厳禁）。bot対策はレート制限＋将来③Turnstile(要Cloudflare登録)で対応。隠しフィールド方式は使わない。
- **最短予約=48時間後**（generateDateOptions開始をtoday+2）。
- **メール表記 KEY-DROP**：GAS `keydrop_mail.gs` の FROM_NAME/件名/挨拶/署名を「CARデリバリー KEY-DROP」に＋「緊急連絡先」行削除（営業時間のみ）。⚠️**GASは手動貼付なので、最新版をGASエディタに貼り直すまで旧表記のまま**。
- 🔴**価格マスターUIは既存 `~/spk-task/keydrop-pricing.html`（SPK TOP「💴KEYDROP価格」タイル）が正**。配達範囲UIも既存 `keydrop-admin.html`（「📍KEYDROP配達範囲」）。**新規に作らない**（当方が重複でkeydrop-prices.htmlを作り→撤去した。次回も既存を使う）。価格は `app_settings.hdm_keydrop_price`(prices{class:[閑散,通常,繁忙]}/presets/default)＝keydrop_book(005)がサーバ計算。
- **マップ（最適解＝全部無料・Google不使用）**：地図=OSM/Leaflet(無料)／住所検索=**国土地理院GSI(`msearch.gsi.go.jp/address-search`・無料・キー不要・日本特化)を主→Nominatim(無料)フォールバック**(`searchAddress`→`gsiSearch`)／逆ジオ(map tap→住所)=Nominatim(無料・`fetchFullAddress`)。**Google Placesは有料化リスクのため不使用に切替**（`loadGooglePlaces`は冒頭return・`searchAddress`もGoogle分岐撤去。コードは将来用に残置）。∴マップ系の課金リスク=ゼロ。
- **課金（固定費）**：実質 **Supabase Pro $25/月のみ**（明日変更予定）。GitHub Pages/GAS/地図=無料。Square=取引手数料のみ。月100本規模はPro($25)で余裕（重い閲覧アクセスはPages/OSMが捌き、Supabaseは小さなデータ取得のみ）。

### Edge Functions（4本・全デプロイ済）
- `create-booking`(verify_jwt ON) / `keydrop-mypage`(同・lookup/cancel/update/cancel_request) / `payment-webhook`(**--no-verify-jwt**・署名検証) / `keydrop-refund`(同verify_jwt ON・authenticated限定・記録のみ)。
- secrets：SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID=L8N7J9RKPN3WH / SQUARE_WEBHOOK_SIGNATURE_KEY / SQUARE_WEBHOOK_URL / SLACK_BOT_TOKEN / SLACK_KEYDROP_CHANNEL=C08TDTPEB36。
- DB migration 001–010 全RUN済（Management API `/database/query`＝curl。pythonはCloudflare1010で不可）。keydrop_payments：authenticated SELECT可・更新はservice_role限定。
- Square Webhook「KEYDROP」Enabled(payment.created/updated)・App=HandymanOnline/Production。

### 残（決済導入後）
- 返金フロー（運営確定時の Square Refund 自動化）＝既存 payment_bot のRefund実装が流用可。
- レート制限/CAPTCHA（スパム予約）。
- 独自ドメイン化時：CORS ALLOWED と `KEYDROP_RETURN_URL`・Square redirect を追従。

### 📱 モバイル下部CTAクリップ不具合 修正（2026-06-10・commit `bf0b06f`・反映済）
- 症状：お届け/回収画面の最下部CTA（「次へ」「車両を見る」）がスマホで切れる/出ない（iPhone15含む全デバイス）。
- 真因：TOP(場所)画面が `.kd-mapscreen{height:100dvh;overflow:hidden}`＋内側ラッパー`overflow:hidden`で1画面固定→iOS/Androidのツールバー高さ差で下部がクリップ。
- 修正：**モバイル(max-width:899)のTOPだけ**（`kd-top`クラスにスコープ）`height:auto;overflow:visible`＋`.kd-mapwrap`を固定高`42vh`＋主CTAを`position:sticky;bottom:0`(safe-area対応)で常時表示。**車両画面(step_vehicle=kd-top無し)は従来挙動を維持**。renderTopScreenのインライン`overflow:hidden`ラッパーは`.top-body`クラス化。CTAは`.kd-cta-sticky`でラップ。iPhone15相当(393×852)で下部CTA全表示をヘッドレス検証済。
- 教訓：**モバイルで `100dvh + overflow:hidden` による"1画面フィット"は危険**（ツールバー差で下部クリップ）。地図系は「地図に固定高＋本文はスクロール＋CTAはsticky」が堅牢。

---

## 📝 KEYDROP マイページ変更機能＋日付ズレ修正（2026-06-10）

### 実装したもの（push済・本番稼働）
1. **回収画面(STEP2)にお届け日バッジ**（`renderStepDateStrip` collection枝・回収日セレクタ直上に「📍 お届け M/D(曜) HH:MM〜」）。
2. **🔴日付1日ズレ修正（既存バグ）**：`generateDateOptions`の選択肢valueが`d.toISOString().slice(0,10)`=UTCで、JST午前0時のDateが前日にズレ→ラベル(6/12)と値(6/11)不一致→予約日が1日前で保存されていた。共通ヘルパー`localYMD()`でローカルYMDに統一（選択肢＋`classTotal`のtier判定の2箇所）。コミット`38a5897`。
3. **マイページ 折りたたみFAQ**「📝 予約内容の変更／キャンセルについて」（`renderMypageDetail`・`<details class="mp-faq">`既定で閉）。
4. **マイページ 場所/時間の自己変更機能**（独立セクション「✏️ お届け・回収の変更」）：
   - 編集可＝**confirm/pending（配車前）かつ お届け24h前まで**。`canEditMypage`/`mpWithin24h`。`kd_status`が delivering/active/completed か 24h超過でロック→LINE導線。
   - 変更UI＝時間(営業時間セレクタ)＋場所(Leaflet地図タップ→`fetchFullAddress`逆ジオコード)。`mpEditOpen/renderMpEdit/initMpEditMap/mpEditSave`。変更項目のみ送信。
   - **Edge Function `keydrop-mypage` に `action='update'` 追加**（`supabase/functions/keydrop-mypage/index.ts`）：本人確認(予約番号+メール)→24h前ゲート(`within24h`)→時刻検証(`validTime`)→`reservations`(正本)更新(del_place/col_place＋lend_time&del_time/return_time&col_time)→既存`tasks`(d-/c-)のplace/time同期＋memoに🔔顧客変更マーカー＋changed_json.kd_customer_changed_at→Slack通知`notifySlack`(任意env)。
   - **デプロイ済**：`SUPABASE_ACCESS_TOKEN="$(cat ~/.config/keydrop/sb_token)" npx supabase functions deploy keydrop-mypage --project-ref ckrxttbnawkclshczsia`。Slackシークレット設定済(`SLACK_BOT_TOKEN`/`SLACK_KEYDROP_CHANNEL=C08TDTPEB36`=#sapporo_reservation)。
   - 本番テスト：メール不一致→拒否／キャンセル予約→拒否 を確認。

### ⚠️ 仕様メモ（「編集ボタンが出ない」の正体）
- ✏️編集ボタンは**配車前(confirm/pending)＆お届け24h以上前**の予約だけ表示。それ以外（キャンセル/配車後/24h以内/過去）はロック表示「変更不可→公式LINE」。
- 例(6/10時点): KD-2606-0004/0005(お届け6/13・配車前)=編集可／oshita@g-lines.jpの予約は全キャンセル=出ない。「実装されてない」ではなくテスト予約がロック条件に該当していただけ。

### 🟡 オーナー保留中の判断（未決・次回これを聞く）
- 「お届け・回収の場所/時間 自己変更（✏️の箱）は**希望してない**」「ここに『ご予約後の車種変更は公式LINEにて承る』を表示」との指示あり。
- **未決**：A=✏️箱を残す／B=外して「ご予約後の車種変更は公式LINEにて承ります」案内に置換（場所/時間もLINE統一）。→ **次回まずA/Bを確認**。Bなら`renderMypageDetail`の「予約内容（お届け・回収の場所/時間）の変更：独立セクション」ブロックを車種=LINE案内に差し替え＋折りたたみFAQ②③の文言もLINEに戻す。Edge Functionの`update`はそのまま残置(無害)。

### 関連DBスキーマ（KEYDROP=SPK Supabase ckrxttbnawkclshczsia・ota='KEYDROP'）
- `reservations`: del_place/col_place・lend_time/del_time(お届け時間2系統)・return_time/col_time(回収時間2系統)・kd_status/kd_status_at。**緯度経度カラムは無い＝場所は文字列のみ**。
- `tasks`: `_id`=`d-{resvId}`(DEL:place=お届け場所/time=お届け時間)・`c-{resvId}`(COL:place=回収場所/time=回収時間)・`w-{resvId}`(洗車)。**tasksは本体APPがreservationsから動的生成**。
- 接続: curlは`/auth/v1/token?grant_type=password`(oshita@g-lines.jp/nosh2318)でtoken→REST。デプロイtoken=`~/.config/keydrop/sb_token`(sbp_・30日失効)。

---

## 🗺 TOP地図主役リニューアル＋マスコット＋在庫17台一致＋価格マスター連動準備（2026-06-09 omni）

### ① TOP再設計（モバイル）＝「検索フォーム→結果」地図主役
- ヒーロー画像撤去。TOP＝**日程1行折り畳みバー**(`renderDateBarInner`/`expandDateBar`/`collapseDateBar`・render()を呼ばず`#dateBar`差替で地図を壊さない)＋**地図(主役)**＋場所ステップパネル。
- 場所＝**お届け→回収のステップ式**を地図上で。**お届け＝黄(#FABE00)/回収＝黒(#1a1a1a)** で全UI統一（stepBar pill・STEPバッジ・サマリーカード・地図ピン）。`renderLocationStepPanel`を2ステップ＋色分けに刷新（locStep='vehicle'枝は撤去）。
- **車両は次画面**＝新screen `step_vehicle`(`renderVehicleScreen`)：上部にお届け黄/回収黒サマリー固定＋クラスフィルタ＋条件一致車両。`goToVehicleStep()`は1本化(screen='step_vehicle')。`useSameCollection`も同経路。
- 地図初期化条件に`screen==='top'`追加（モバイルTOPも地図）。再生成時`restorePins()`でピン復元（state→setDeliveryPin/setCollectionPinにaddr渡しで逆ジオ上書き回避）。
- PC版TOP(renderTopScreenPC)は従来all-in-oneのまま（次段で統一）。

### ② KEYDROP マスコット（生成画像3＝鍵+📍ロボ）
- 白背景→透明切り抜き(Pillow・border連結成分のみα0＝白本体保持) `images/mascot.png`(314x520)/`mascot_head.png`/`mascot_pin.png`。
- CSS keyframes(kdFloat/kdWave/kdBounce/kdPeek/kdPinDrop)。**静止画をCSSで生かす方式**(腕個別可動は不可・浮遊/手振り/跳ね/覗き)。
- ヘッダー：`mountHeaderMascot()`が全`.app-logo`にロゴ横相棒を設置(浮遊＋hover手振り＋click跳ね・再render毎)。地図お届けピン＝マスコット。完了/マイページで`mountCornerMascot()`が右下から吹き出し付き登場。

### ③ 在庫の相違解消＝顧客に17台全部（A/A2/B2公開）
- 相違の正体＝公開ビュー(public_vehicles_v)は17台全部出てたが、**顧客UIのクラス白リスト(B/C/S/F/H)でA(2)/A2(3)/B2(2)を非表示**にしていた（設計どおりだったが「配車表に出るのに顧客に出ない」）。
- オーナー判断＝**全部見せる**。VEHICLE_CLASSESにA(プレミアム)/A2/B2追加＋classOrder=['A','A2','B','B2','C','S','F','H']。**クラス表記そのまま**。サーバー(create-booking assignVehicle)は`type=eq.<class>`厳密一致割当＝予約破綻なし。

### ④ 営業時間・検索日
- `generateTimeOptions`＝**9:00〜19:00**(30分・19:00最終)。`generateDateOptions`＝**本日〜4ヶ月後**まで。

### ⑤ 価格＝SPKマスター連動（"全てはSPKがマスター"）※DBは後でまとめてRUN
- オーナー指示「価格はSPKが持つ。今は持っていない→KEYDROP連携専用の価格表を新設」。粒度＝**クラス別定額(v1)**。
- 顧客側はベタ書き`CLASS_PRICES`を**フォールバック化**し、`loadClassPrices()`が`public_class_price_v`(anon)を読み`priceOf(type)`で上書き（ビュー未作成時は自動フォールバック＝今回デプロイで壊れない）。CLASS_PRICES直参照5箇所→`priceOf()`化。
- **DB(保留・まとめてRUN)**＝`supabase/migrations/003_class_price.sql`：app_settings.`hdm_keydrop_price`(JSON)＋公開ビュー`public_class_price_v`。⚠️価格18000/16000/9000等は**暫定値**（SPKで確定編集する）。
- **残（次回）**：SPK側 専用価格表UI `keydrop-prices.html`新設（app_settings hdm_keydrop_price 編集）＋TOP導線。SQLは「価格以外も必要」でオーナーがまとめてRUN予定。

### デプロイ
- hdm-car-delivery＝GitHub Pages・SWなし・バージョン定数なし＝git pushのみ。①〜④＋⑤読み口を本番反映。DDL未RUN（フォールバックで安全）。

---

## 🗺 場所フロー刷新＝「地図から呼ぶ・届ける・回収する」(2026-06-09・差別化の核)
オーナー指示「お届け・回収ともにマップで順に選択→お届け地で提供可能な条件一致車両だけ出す／地図主役＝差別化」を受け、場所画面をステップ式に再設計。
- **state.locStep**（'delivery'→'collection'→'vehicle'）でサブステップ管理。`collectionLat/Lng/collectionAddr`追加。`collectionMarker`(🏁黒ピン)。
- **地図は再構築しない**：step遷移は`renderLocPanel()`で**#locPanelのinnerHTMLのみ差替**（app全体のrender()を呼ばない＝Leaflet地図とピン保持・クリックは`state.locStep`を実行時参照で振り分け）。※render()は#map再構築するので場所画面のstep遷移では使わないのが鉄則。
- フロー：①お届け「車をどこへ届けますか？」(地図/検索でピン→次へ)→②回収「どこで車を返しますか？」(🔁お届けと同じ ボタン or 地図で別指定→車両を見る)→③車両(上部に📍お届け/🏁回収を固定表示＋クラスフィルタ＋条件一致車両のみ)。3ステップともヘッドレスでスクショ確認済。
- 地図クリック・検索(selectAddress)は`locStep==='collection'`なら`setCollectionPin`、他は`setDeliveryPin`に振り分け。`reverseGeocode`冒頭/末尾で`renderLocPanel()`呼び（お届け確定→パネル即反映のバグ修正）。
- createBookingOnServer: `col_place = collectionAddr || deliveryAddr`。confirm画面に回収場所行。
- ⚠️ **PC版TOP(renderTopScreenPC)は従来のall-in-one(map+panel同時)のまま**＝step式は**モバイルのみ**適用。PC統一は次段。旧チェックボックス式回収(toggleSameCollection)は撤去・関数は未使用残置。

## 🎨 KEYDROP デザイン改修2（2026-06-09・オーナーFB8点）
①ヘッダーロゴ拡大(28→40px/PC48)②メインCTA(お届け場所を選ぶ)を黒→**黄に戻す**(btn-primary黄/ダーク文字)③該当車両なし時の注釈(空車0で「予約可能な車両がありません」案内+問い合わせ導線)④選んだお届け場所を車両パネル上部に**sticky固定表示**(✕で変更)⑤確認ページのボタンを「＋オプションを追加(→options)」「予約手続きに進む(→form)」に変更⑥支払い=**Squareクレカのみ**(Apple Pay/PayPay削除・自動選択)⑦日程ラベルを開始/終了→**お届け日/お届け時間/回収日/回収時間**＋**回収場所**追加(state.sameCollection既定true＝お届けと同じ/チェックOFFで住所入力→col_place分岐・確認ページに回収場所行)⑧admin(SPK)連携はcreate-bookingで達成済。state追加: collectionAddr/sameCollection。fn追加: toggleSameCollection。※マップ画面の固定カード/回収UIは実機(地図タイル+クリック)で要目視。

## 🎨 KEYDROP リスキン完了（2026-06-09・commit c4a7c7c・本番反映）
- **ブランド名確定＝KEYDROP**（旧称KAMUIから変更）「Sapporo Car Delivery Service」。配色＝**ブラック#1a1a1a × イエロー#FABE00**（白背景）。
- 実施：ネイビー#002063→#1a1a1a 全置換／ロゴ`images/logo_header.png`をKEYDROPロゴに・ヒーロー4枚(`top_banner_01/02/03/05.jpg`)を新メインビジュアルに差替(sips最適化 各172-320KB・元は`images/_pre_keydrop`削除済→git履歴に)／ヘッダー&メニュー白化・ハンバーガー/✕黒・PCナビ黒文字／btn-primary=黒CTA(白字)・vc-select-btn=黄(選択)／title/alt/footer=KEYDROP。**レイアウト/予約ロジックは不変**。素材原本は`images/keydrop/`。
- ✅ **解決：ota="KEYDROP" / 採番 `KD-YYMM-xxxx` に変更しCLIで再デプロイ済**（2026-06-09・curl実証 KD-2612-0001/ota=KEYDROP→削除）。SPK解析タブD/GAS切り分けのブランド識別子＝KEYDROP。

### 🛠 Edge Function デプロイ手順（CLI・Webエディタ卒業）
- supabase CLI 導入済：`~/.local/share/supabase/supabase`（v2.105.0・本体+`supabase-go`同梱の正式tarball。`supabase_darwin_arm64.tar.gz`=シムのみでNG、`supabase_<ver>_darwin_arm64.tar.gz`が正）。**Docker不要（`--use-api`）**。
- アクセストークン：`~/.config/keydrop/sb_token`（git管理外・600・**リポジトリに絶対書かない**）。Personal Access Token＝**30日で失効**→失効したら https://supabase.com/dashboard/account/tokens で再発行しこのファイルを上書き。
- **デプロイ1発**：
  ```
  cd ~/hdm-car-delivery && SUPABASE_ACCESS_TOKEN="$(cat ~/.config/keydrop/sb_token)" \
    ~/.local/share/supabase/supabase functions deploy create-booking \
    --project-ref ckrxttbnawkclshczsia --use-api
  ```
  関数名を変えれば他Fn（Phase Bの`payment-webhook`等）も同様。verify_jwtはデフォルトON維持（anonキーで通る・UIは apikey+Authorization両送）。

## 🚗 KEYDROP（旧KAMUI）新ブランド 本番化（2026-06-09 omni・進行中）

### 構想（オーナー確定）
- このUI(hdm-car-delivery)を **新ブランド「KAMUI」（案）の顧客予約サイト**として本番化。
- **SPK(札幌)と同一Supabase `ckrxttbnawkclshczsia` ＝同一在庫・同一配車表で運用**。別DB・別在庫を作らない（二重台帳ゼロ＝在庫ズレ原理的に無し）。
- **2ブランド（HANDYMAN既存＋KAMUI新）を `reservations.ota` 列で分離**。単一在庫・単一オペレーション・複数ブランド＝稼働最大化＋運用1箇所。
  - ota: HANDYMAN直販=`HP` / 各OTA=`J/R/S/O/RC/G` / **KAMUI=`KAMUI`**。メール取込もGASが送信元/件名で HANDYMAN/OTA/KAMUI に切り分け（既存の延長）。
  - 分析・売上は ota で分離（解析タブD等でKAMUI実績が見える）。顧客接点(UI/ドメイン/メール)はKAMUIで別ブランド化。
- **原則「全てのデータはSPK(admin)マスターから」**。マスターに無いものは顧客に出さない。顧客UIのハードコード(マスター的データ)は廃止していく。

### 連動の心臓（GAS実装で確認済・重要）
- 予約成立＝**`reservations` INSERT ＋ `fleet` autoAssign の2つだけ**。**tasksは作らない**（SPK APPが reservations+fleet から動的生成して配車表/OPシート/タスク/会計に表示）。
- ∴ 顧客UIが reservations+fleet を「SPKと同じ形」で作れば、**札幌の配車表に自動で出る**（GAS予約と全く同じ経路）。
- autoAssignロジック正本: `~/spk-task/gas-email-import-v2.gs` `insertReservation_`(L1230) / `autoAssignVehicle_`(L1248)。

### 実装済み（push済・本番反映）
- **公開ビュー4本**（`supabase/migrations/001_public_views.sql`・SQL EditorでRUN済）: `public_vehicles_v`/`public_busy_v`/`public_maint_v`/`public_inactive_v`。anon可・**基テーブルは閉じたまま**(`security_invoker=off`で定義者権限・許可列のみ)。→ 札幌の在庫変化が顧客の空き表示へ自動反映。anon検証OK(札幌実車両17台見える/基テーブルvehiclesは0件)。
  - ⚠️ reservations等の**日付列はtext型**→ビューの日付比較は `列::text >= to_char(current_date,'YYYY-MM-DD')`。
- **顧客UI読取をビュー参照に差替**（index.html fetchVehicles/fetchAvailableVehicles）。vehicles/fleet/maintenance/reservations の anon直読みを廃止。
- **配達範囲をDB設定化**（`002_delivery_config.sql`・RUN済）: `app_settings.hdm_delivery_config`(JSON) + 公開ビュー `public_delivery_config_v`。**札幌駅(43.0687,141.3508)中心 半径20km × 札幌市内(住所に「札幌市」)** のAND判定。顧客UIはDB設定を読んで判定（ハードコード`VEHICLE_YARDS`廃止）。anon検証OK。
- プレミアム(Aクラス)削除、**顧客公開クラス外(A/A2/B2預かり)は非表示**（`VEHICLE_CLASSES`をホワイトリスト化＝マスターに車両があっても載ってないクラスは出さない）。顧客に出るのは B/C/S/F/H。
- ラベル「指定場所対応車両」→「指定場所予約可能車両」。
- 住所検索: 選択した名称を「指定場所」として保持（逆ジオで上書きしない）＋画面更新の対称化（検索選択でも `fetchAvailableVehicles()` を呼ぶ・地図クリック経路と揃えた）＋検索クリア✕ボタン(PC/モバイル)＋お届け場所住所を濃く(#1f2937/13px/bold)。

### ✅ Phase A 完了（2026-06-09・本番稼働）
- **create-booking Edge Function デプロイ済**（本番 `https://ckrxttbnawkclshczsia.supabase.co/functions/v1/create-booking`）。Webエディタ(Via Editor)で `Deno.serve` 形式のまま貼付→Deploy。Verify JWT=ON（anonキーで通る・UIは apikey+Authorization:Bearer<anon> 両方送る）。SUPABASE_URL/SERVICE_ROLE_KEYは自動注入＝Secrets設定不要。
- **疎通検証済**: curl正常系→`WEB-2612-0001` 採番→CX-3(CX3)自動配車→reservations(ota=KAMUI/status=pending_payment)+fleet をDB実在確認→テストデータ削除済。異常系(日付不正)も400で弾く。INSERT全19カラム実在・assignVehicleの読取クエリ(fleet埋込join等)全て200を事前検証。
- **顧客UI申込接続 push済**（commit 5ea8520）: `processPayment`→`createBookingOnServer`(POST /functions/v1/create-booking)。GitHub Pages反映済。
- 採番は `WEB-YYMM-xxxx`（ota=KAMUIだが番号prefixはWEBのまま・将来KAMUI-検討）。service_roleはFn内のみ・CORS *(Phase DでKAMUIドメインに絞る)。

### 残作業（次セッションはここから・Phase B〜）
1. **Square決済(Phase B)**: create-bookingでSquare Payment Link発行→`payment-webhook`で`confirmed`化＋`spk_accounting`起票（既存じゃらん事前決済が完成テンプレ・Location `L8N7J9RKPN3WH`）。
4. **「全データSPKから」完成**: クラス名/価格/公開可否のハードコード(`VEHICLE_CLASSES`/`CLASS_PRICES`)をDB化(`hdm_class_config`+公開ビュー)＋SPK adminにクラス公開設定UI。価格はSPK価格表(seasonal)連動。
5. **SPK adminに「配達エリア設定」編集UI**（`hdm_delivery_config`を地図ピン/半径で編集＝オーナーの"adminで設定"完成形）。
6. 独立ドメイン（最後・新規取得＝自前DNS）。Square戻りURL/CORS/CSP追従。

### 関連ドキュメント
- 設計思想・合格ライン: `~/Desktop/HANDYMAN/デリバリーレンタカー_サービス化_設計書_2026-06.md`
- 実装プロセス（既存UI前提の順番）: `~/Desktop/HANDYMAN/デリバリーレンタカー_実装プロセス_2026-06.md`

### Lesson
- 在庫双方向同期＝**同一DB＋公開ビュー(読取)＋Edge Function(書込)** で成立。anon直読み/直PATCH(旧cancelReservation L2765)は廃止していく。
- 公開ビューは `security_invoker=off` で基テーブルRLSを貫通し許可列のみ返す＝PII/コスト非開示で在庫だけ見せられる。
- index.ts(Edge Function/TS)を**SQL Editorに貼らない**（//で構文エラー）。Edge FunctionsセクションでDeploy。

---

## プロジェクト概要
レンタカーデリバリーサービス「HDM Car Delivery」のプロトタイプUI。
iPhone端末フレーム内で動作するシングルページHTMLアプリケーション。
バニラJS（フレームワークなし）で構成。

## ファイル構成
```
hdm-car-delivery/
├── CLAUDE.md          ← このファイル（Claude Code用コンテキスト）
├── index.html         ← メインアプリ（最新版 = 旧hdm_v2.html）
└── original.html      ← 改修前のオリジナル版（参照用）
```

## アーキテクチャ

### 技術スタック
- **HTML/CSS/JS** すべて1ファイル（`index.html`）に内包
- フレームワーク・ライブラリ不使用
- 外部依存なし（完全スタンドアロン）

### 画面構成（state.screen で管理）
| screen値 | 画面名 | 説明 |
|---|---|---|
| `top` | トップ画面 | 日程・場所/店舗選択・車両一覧 |
| `full` | 全画面マップ | デリバリーモード用 |
| `class_select` | クラス選択 | 車種カテゴリ選択 |
| `vehicle_select` | 車両選択 | 車両一覧・詳細 |
| `return_select` | 返却方法選択 | デリバリーモード用（来店モードではスキップ） |
| `auth_select` | 認証画面 | ログイン/新規登録 |
| `reservation_form` | 予約フォーム | ドライバー情報入力 |
| `insurance_options` | 保険選択 | 保険プラン選択 |
| `terms` | 利用規約 | 規約確認・同意 |
| `payment` | 決済画面 | 支払い方法選択 |
| `complete` | 完了画面 | 予約完了 |
| `mypage` | マイページ | 予約一覧・詳細・キャンセル・変更 |
| `partner` | パートナー管理 | デモ用管理画面 |
| `platform` | プラットフォーム管理 | デモ用管理画面 |

### レンダリングパターン
```
グローバル state オブジェクト
    ↓ 変更
render() 関数
    ↓ innerHTML全置換
attachEventListeners() 関数（毎回再バインド）
```

**重要**: `render()` が `app.innerHTML` を全置換するため、イベントリスナーは必ず `attachEventListeners()` 内で毎回登録し直す必要がある。`onclick` インライン属性は例外的に動作する。

### 予約モード（bookingMode）
**2つのモードを切り替え可能:**

#### デリバリーモード（`bookingMode: 'delivery'`）
1. ① 利用期間選択
2. ② マップでお届け場所指定
3. ③ 車両選択
4. → 返却方法選択 → 認証 → 予約フォーム → 保険 → 規約 → 決済 → 完了

#### 来店モード（`bookingMode: 'store'`）
1. ① 利用期間選択（デリバリーと共通）
2. ② 出発店舗選択（エリア → 店舗）
3. ③ 返却店舗（デフォルト: 出発店舗と同じ）
4. ④ 車両選択
5. → 認証（return_selectをスキップ） → 予約フォーム → 保険 → 規約 → 決済 → 完了

## データ構造

### VEHICLE_CLASSES
```javascript
{ compact, compact_suv, sedan, suv, minivan }
// それぞれ name, icon を持つ
```

### PARTNERS
```javascript
{ orix, times, nippon, budget }
// それぞれ name, shortName, icon, color を持つ
```

### SAMPLE_VEHICLES（10台）
```javascript
{ id, name, plate, price, img, classId, mapX, mapY, depot, depotAddr, radiusKm, radiusPx, seats, fuel, discount, partnerId }
```
- partnerId でパートナーに紐づく
- mapX/mapY はデリバリーモードのSVGマップ上の座標
- classId で VEHICLE_CLASSES に紐づく

### AREAS（8エリア）
```javascript
{ id, name }
// hokkaido, tohoku, kanto, chubu, kansai, chugoku, shikoku, kyushu
```

### STORES（18店舗）
```javascript
{ id, name, areaId, addr, partnerId, hours }
// areaId で AREAS に紐づく
// partnerId で PARTNERS に紐づく
```

### SAMPLE_RESERVATIONS（6件）
ステータス0〜5の各状態サンプル。MyPageで表示。

## state オブジェクト主要フィールド
```javascript
{
    screen: 'top',              // 現在の画面
    bookingMode: 'delivery',    // 'delivery' | 'store'
    selectedClass: null,        // 選択中の車種クラス
    selectedVehicle: null,      // 選択中の車両オブジェクト
    datetime: { startDate, startTime, endDate, endTime },

    // デリバリーモード用
    deliveryAddr: '',           // お届け先住所
    deliveryPinPos: null,       // SVGマップ上のピン座標
    returnAddr: '',
    returnMethod: null,         // 'same' | 'other'
    returnPinPos: null,
    pickingReturn: false,       // 返却場所選択中フラグ

    // 来店モード用
    storeArea: null,            // 選択中のエリアID
    storeId: null,              // 選択中の店舗ID
    returnStoreArea: null,      // 返却エリアID
    returnStoreId: null,        // 返却店舗ID
    returnSameStore: true,      // 出発店舗と同じフラグ

    // 認証・予約
    authView: 'select',         // 'select' | 'login' | 'register1' | 'register2' | 'register_complete'
    selectedInsurance: 'basic',
    paymentMethod: null,        // 'card' | 'applepay' | 'paypay'
    termsAgreed: false,

    // マイページ
    selectedReservation: null,
    mypageView: 'list',         // 'list' | 'detail' | 'cancel' | 'modify'

    // その他
    lang: 'ja',                 // 'ja' | 'en'
}
```

## 主要関数一覧

### ヘルパー関数
- `t(key)` — i18n翻訳
- `formatPrice(price, discount)` — 価格フォーマット
- `generateDateOptions(selected)` — 日付select生成
- `generateTimeOptions(selected)` — 時刻select生成
- `getAreaFromAddress(addr)` — 住所からエリア判定
- `getVehiclesForArea(area)` — エリア内車両取得（デリバリー用）
- `getVehiclesForClass(classId)` — クラス別車両取得（デリバリー用）
- `getAvailableVehicles()` — 利用可能車両（デリバリー用）
- `getStoresForArea(areaId)` — エリア内店舗取得（来店用）
- `getStoreVehicles(storeId)` — 店舗の車両取得（来店用、全クラス補完）
- `getStoreAvailableVehicles()` — 利用可能車両（来店用）

### 画面レンダリング関数
- `renderTopScreen()` — トップ画面（モード切替、日程、場所/店舗、車両一覧）
- `renderFullScreen()` — 全画面マップ
- `renderClassSelectScreen()` — クラス選択
- `renderVehicleSelectScreen()` — 車両選択
- `renderReturnSelectScreen()` — 返却方法選択
- `renderAuthSelectScreen()` — 認証画面
- `renderReservationFormScreen()` — 予約フォーム
- `renderInsuranceOptionsScreen()` — 保険選択
- `renderTermsScreen()` — 利用規約
- `renderPaymentScreen()` — 決済
- `renderCompleteScreen()` — 完了
- `renderMyPageScreen()` — マイページ
- `renderPartnerScreen()` — パートナー管理
- `renderPlatformScreen()` — プラットフォーム管理
- `renderDemoNav()` — デモ用ナビゲーションボタン

### コア関数
- `render()` — メインレンダリング（innerHTML全置換）
- `attachEventListeners()` — イベントリスナー登録（render後に毎回呼ばれる）
- `createMapSVG()` — SVGマップ生成

### AI チャット
- `toggleAIChat()` — チャットパネル開閉
- `renderAIChat()` — チャットUI描画
- `sendAIMessage(text)` — メッセージ送信・応答生成

## 開発時の注意事項

### イベントリスナー追加時
新しいUI要素を追加してクリック等のイベントを扱う場合：
1. `attachEventListeners()` 関数内に `document.querySelectorAll` で要素を取得してリスナーを登録
2. または HTML テンプレート内で `onclick="..."` をインラインで記述
3. **絶対にやってはいけない**: render() の外でリスナーを1回だけ登録する（DOMが毎回再生成されるため）

### 新しい画面追加時
1. `state.screen` に新しい値を定義
2. `render()` の switch 文に case を追加
3. `renderXxxScreen()` 関数を作成
4. 必要に応じて `attachEventListeners()` にリスナーを追加
5. `renderDemoNav()` にデモ用ボタンを追加

### CSS追加時
`<style>` タグ内に追記。クラス名は既存の命名規則に合わせる：
- `.screen-name-xxx` （画面固有スタイル）
- `.component-name` （コンポーネント）

### デバッグ
ブラウザで `index.html` を直接開いて動作確認可能。
デモ用ナビゲーション（画面上部のボタン群）で各画面に直接遷移できる。

## カラースキーム
- メイン: `#002063`（ネイビー）
- アクセント: `#FABE00`（イエロー）
- 背景: `white`
- テキスト: `#333`

## 改修履歴
- **v1 (original.html)**: デリバリーモードのみ（マップベース）
- **v2 (index.html)**: 来店モード追加（エリア/店舗/クラス選択フロー）
  - モード切替トグル（デリバリー/来店）
  - AREAS（8エリア）、STORES（18店舗）データ追加
  - 来店モード用ヘルパー関数追加
  - 来店モードでは return_select をスキップ
  - 予約フォームに予約タイプ表示を追加
