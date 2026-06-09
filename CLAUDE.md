# HDM Car Delivery - プロジェクトコンテキスト

---

## 🎨 KEYDROP リスキン完了（2026-06-09・commit c4a7c7c・本番反映）
- **ブランド名確定＝KEYDROP**（旧称KAMUIから変更）「Sapporo Car Delivery Service」。配色＝**ブラック#1a1a1a × イエロー#FABE00**（白背景）。
- 実施：ネイビー#002063→#1a1a1a 全置換／ロゴ`images/logo_header.png`をKEYDROPロゴに・ヒーロー4枚(`top_banner_01/02/03/05.jpg`)を新メインビジュアルに差替(sips最適化 各172-320KB・元は`images/_pre_keydrop`削除済→git履歴に)／ヘッダー&メニュー白化・ハンバーガー/✕黒・PCナビ黒文字／btn-primary=黒CTA(白字)・vc-select-btn=黄(選択)／title/alt/footer=KEYDROP。**レイアウト/予約ロジックは不変**。素材原本は`images/keydrop/`。
- ⚠️ **未決：create-booking の `ota` 値が "KAMUI" のまま**（ブランド名変更前に実装）。ブランド=KEYDROPなら **ota="KEYDROP"（or短縮"KD"）に変えるべき**（SPK解析タブD/GAS切り分けのブランド識別子＝分析に直結）。要オーナー判断→決まれば index.ts + デプロイ + （既存KAMUI予約があればDB更新）。

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
