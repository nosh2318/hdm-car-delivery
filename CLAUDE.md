# HDM Car Delivery - プロジェクトコンテキスト

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
