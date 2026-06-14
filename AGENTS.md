# HDM Car Delivery - プロジェクトコンテキスト

## KEYDROP TOPエリアゲート刷新（2026-06-15）
- 素の `keydrop.jp` で表示される `kdShowAreaGate()` をPC/スマホ共通の新デザインへ刷新
- メインキャッチは `WHERE TO DROP YOUR KEY?` を固定表示。`レンタカーを指定場所に呼ぶ` / `スマートに借りて、自由に走ろう` は補助コピーとして多言語連動
- 構成: メイン角丸ビジュアル + 札幌/那覇カード + 利用3ステップのみ
- 札幌/那覇カードは既存 `kdPickArea()` に接続し、予約フロー・マップ機能は変更なし
- PC画像: `images/keydrop_gate_pc.jpg`、スマホ画像: `images/keydrop_gate_sp.jpg`
- 表示は軽量JPEG（各約320KB）を使用
- 旧4エリア、特徴4項目、マスコットCTA、外側の言語/SKIP UIはゲートから削除
- 多言語ボタンは新ゲート内へ再実装。日本語/英語/繁中/韓国語でキャッチ・案内・エリア説明・3ステップを即時切替
- 言語選択は既存 `state.lang` と `localStorage.kd_lang` に接続し、エリア選択後の予約画面へ引き継ぐ
- 車両・背景写真はキャッチを主役にするため、PC/スマホとも軽いblur・低彩度・透過を適用
- `main` pushでGitHub Pagesへ反映

## プロジェクト概要
レンタカーデリバリーサービス「HDM Car Delivery」のプロトタイプUI。
iPhone端末フレーム内で動作するシングルページHTMLアプリケーション。
バニラJS（フレームワークなし）で構成。

## KEYDROP プロモーション動画（2026-06-11）
- ユーザー提供スクリーンショットは「サービスイメージ・実画面の挿入素材」であり、動画の主役にしない。
- CM本編はゼロから作る都会的な世界観が主役：人物が場所を指定 → 車両が街を走って到着 → 鍵を受け取る → そのまま出発。
- 実サービス画面は全体の2〜3割程度に抑え、「実際に使えるサービス」の裏付けとして途中に短く組み込む。
- コピー軸：`借りに行かない。届く。` / `CAR DELIVERY PLATFORM` / `移動を、もっと自由に。`
- 制作ファイル：`promo/promo.html`、生成CM素材は `promo/assets/generated/`、フレームは `promo/frames/`。
- 初回のUI中心案は `promo/promo_ui_first_draft.html` に退避。今後これを本案として復活させない。
- 完成動画：`promo/KEYDROP_promotion_CM.mp4`（29秒 / 1280x720 / H.264 + AACステレオ）。人物・車・都市のCMカット約80%、実サービス画面約20%。
- 2026-06-11 修正版：`promo/KEYDROP_promotion_CM_silent.mp4`。音声・音楽を完全削除。最終画面の「日本では〜プラットフォーム」と「借りに行かない。届く。」を削除し、「スマートに借りて、自由に走ろう」へ変更。
- 2026-06-11 欧米人＋モバイルUI版：`promo/KEYDROP_promotion_western_mobile_silent.mp4`。出演カットを欧米人へ統一。サービス紹介をユーザー提供の `File (4).png`（場所指定）→`File (5).png`（車両選択）→`File (6).png`（予約確認）の3画面へ差し替え。無音。
- 2026-06-11 日本人＋モバイルUI版：`promo/KEYDROP_promotion_japanese_mobile_silent.mp4`。欧米人版と同じ構成・モバイル3画面・最終コピーで、出演カットのみ日本人へ変更。無音。
- 2026-06-11 ショート動画版（9:16 / 1080x1920 / 29秒 / 無音）：欧米版=`promo/KEYDROP_short_western_1080x1920_silent.mp4`、日本版=`promo/KEYDROP_short_japanese_1080x1920_silent.mp4`。単純cropではなく縦専用にテロップ・人物・モバイル3画面・最終ロゴを再配置。

## ファイル構成
```
hdm-car-delivery/
├── AGENTS.md          ← このファイル（Codex用コンテキスト）
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
- **2026-06-11 若年層向けショートCM**: 20代の友人旅行を軸にした、明るくカジュアルな縦型29秒・無音版を追加。札幌の街、車両受け渡し、ドライブ、郊外旅行と、モバイル版サービス画面3点を「場所→車→予約」の順で構成。制作ソースは `promo/promo_youth_short.html`。確認用動画は `promo/KEYDROP_short_youth_preview.gif`、H.264出力先は `promo/KEYDROP_short_youth_1080x1920_silent.mp4`。
- **v1 (original.html)**: デリバリーモードのみ（マップベース）
- **v2 (index.html)**: 来店モード追加（エリア/店舗/クラス選択フロー）
  - モード切替トグル（デリバリー/来店）
  - AREAS（8エリア）、STORES（18店舗）データ追加
  - 来店モード用ヘルパー関数追加
  - 来店モードでは return_select をスキップ
  - 予約フォームに予約タイプ表示を追加
