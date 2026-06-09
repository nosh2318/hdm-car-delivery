# KEYDROP 顧客予約サイト UI 実装記録（2026-06-09）

札幌デリバリーレンタカー「KEYDROP」顧客予約サイト（`hdm-car-delivery`）のUI全面改修ログ。
本番: https://nosh2318.github.io/hdm-car-delivery/ ／ 単一HTML（`index.html`・素のJS）／GitHub Pages（push即デプロイ・SWなし）。

---

## 0. 設計コンセプト（差別化）
- **「地図から車を呼ぶ」体験**を全工程で一貫させる（一般的なレンタカーの“車種リスト”にしない）。
- フロー＝**お届け → 回収 → 車両 →（確認→オプション→予約手続き）**。各ステップで「日付＋時間＋場所」をFIX。
- お届け＝黄(#FABE00)／回収＝黒(#1a1a1a) で全UI色分け。ブランド＝黒×黄。

## 1. 画面レイアウト
### TOP（renderTopScreen・PC/モバイル統一）
- 縦フロー：①日付＋時間（最上部）②マップ（場所＝残り空間をflex:1で充填）③確定＋次へ。
- **PC（≥900px）は2カラム**：左＝キービジュアル（バナー4枚クロスフェード `kvFade`・テキスト/マスコットなし、`contain`で焼込テキスト全表示）／右＝予約機能（`.top-2col` / `.top-visual` / `.kd-flow`）。
- **モバイル**：上部にスリムなキービジュアル帯 `.kv-mobile`（160px・`cover`・上下を白フェード `::after` で馴染ませ・テキストなし）。PCでは非表示。
- ガイド帯 `#kdGuide`（マスコット＋STEP文言）は**右カラム(.kd-flow)の先頭に挿入**＝PCで左ビジュアルに被らない。文言「STEP1：CARデリバリーの お届け日時と場所を決めよう！🔑」／回収「STEP2：CARデリバリーの 回収日時と場所を決めてね🏁」。
- ステップpill（お届け/回収/車両）は**廃止**（ガイド帯と冗長）。
- **1画面フィット**：地図画面は `.app-container.kd-mapscreen { height:100dvh; overflow:hidden }`（render()で付与）＋`#app{flex:1}`。min-heightだとflex:1の子が伸びず下に白が出る罠を回避。

### ヘッダー
- ロゴ＝KEYDROPワードマーク単体に再トリミング（`images/logo_header.png?v=3`・656×89）。**白以外(黒+黄)で検出**して左の黄≡バーが切れないように＋余白18px。`?v=N`でキャッシュ更新。
- タグライン「SAPPORO CAR DELIVERY SERVICE」をロゴ横に（italic/uppercase/900・黄縦線区切り）。モバイル小/PC大。

## 2. 地図（Leaflet）
- ピンは2種：**お届け＝マスコット画像**（`mascot_pin.png`・`kd-pin-mascot`）／**回収＝🏁黒**（`pin-collect`）。両方に**常時ラベル**（`.kd-mk-del`黄「📍お届け場所」／`.kd-mk-col`黒「🏁回収場所」）＝スタート/ゴールが地図で一目。
- **両ピンを地図に一括表示**：`fitToPins()`が `map.fitBounds([お届け, 回収], {padding:60, maxZoom:15})`。map-init後に呼ぶ。
- ドラッグ：場所ステップは両ピン操作可、`step_vehicle`はロック（`updateMarkerDragging`）。両ピンとも常時表示（別アイコンで区別）。
- タップ：`locStep==='collection'`なら`setCollectionPin`、他は`setDeliveryPin`。`step_vehicle`はタップ無効（閲覧用）。
- **KEYDROP拠点フラグ（baseMarker）は廃止**（一度実装→削除）。
- タイル再描画：`ResizeObserver`(mapWrap)＋`invalidateSize`多段（PC白抜け/切れ対策）。
- 地図再生成（render時 #map が新規）＝`map.remove()→initMap`→`restorePins()`（state からピン復元・逆ジオで住所上書きしないようaddr渡し）。

## 3. ステップ詳細
### お届け / 回収（renderStepDateStrip + renderLocationStepPanel）
- 上部 `#dateStrip`：日付＋時間（`stepDateTimeRow`）＋「下の地図で◯◯場所を選ぶ」。
- **未入力の日付/時間は黄グロー点滅**（`.kd-need`＝`kdNeedBlink`）。入力で停止。**回収日時は自動コピーしない**（空のまま点滅＝回収もユーザーが明示FIX）。
- 下部 `#locPanel`：住所カード（お届け黄／回収黒）＋CTA。
  - お届け：「次へ: 回収場所と時間を決める ›」（startDate+startTime+deliveryAddrで活性）。
  - 回収：「🔁 お届けと同じ」「‹戻る」＋**お届け先参照カード（タップで戻って変更）**＋「🏁 この回収場所で決めて車両を見る ›」（endDate+endTime+collectionAddrで活性）。
- 住所はフル取得（`fetchFullAddress`・nominatim zoom18/番地・建物まで、英語ジャンク`direction`等除去）。`deliveryAddrFull/collectionAddrFull`＋座標を予約payloadへ。
- 地図上の住所バッジ（旧`renderLocationBadge`）は**廃止**（重複/被り回避）。住所はパネルのカードに一本化。

### 車両選択（step_vehicle・renderVehicleScreen）＝Uber型
- **地図を残し「この場所へお届け」体験を維持**（一般的なリスト化を回避）。
- **PCは縦割り2カラム**（`.veh-split`：地図左 `.veh-map` / 車両リスト右 `.veh-sheet` 480〜560px）。モバイルは縦積み（地図上＋ボトムシート）。
- 上部条件バー：「‹戻る」＋「📅 日付・時間を変更」（冗長な日付サマリー文は削除）。
- **日付変更フロー**：開く→4枠が点滅＋案内→変更→「🔍 この日程で検索する」(`applyVehDateSearch`)で点滅消えて再検索。
- 車両は公開クラス（A/A2/B/B2/C/S/F/H）を全表示。クラスチップ＋「🚗この場所へお届けできる車」。
- **空車0**：クラスチップ/見出しを隠し、マスコット＋「大変申し訳ございませんが該当日に空車がございません」＋「📅日付を変更して探す」のみ。クラス絞込0件（他クラス空きあり）は軽い案内に分離。

### 確認（renderConfirmScreen）以降
- 戻る先＝`step_vehicle`＋「‹車両選択へ戻る」ボタン（車両選択後に戻れない問題を解消）。
- 合計ラベル「お支払い見積もり」→「**基本料金**」。
- ボタン統合：「オプション確認／予約手続きに進む ›」（→options→form）。

## 4. データ連携（在庫＝SPK札幌と同一DB `ckrxttbnawkclshczsia`）
- 読取＝公開ビュー（`public_vehicles_v`/`public_busy_v`/`public_maint_v`/`public_delivery_config_v`）。anon可・基テーブル閉。
- 書込＝Edge Function `create-booking`（`ota=KEYDROP`／採番`WEB-YYMM-xxxx`）。予約payloadに `del/col_place`＋`del/col_place_full`＋`del/col_lat,lng` を送信（保存はDB列追加待ち）。

## 5. 🔴 残作業（オーナー側・まとめてDB RUN／コードは送信側まで実装済）
1. **価格マスター**：`supabase/migrations/003_class_price.sql`（`app_settings.hdm_keydrop_price` ＋ 公開ビュー`public_class_price_v`）を RUN → 顧客が自動でSPK価格を読む（現在は`CLASS_PRICES`フォールバック）。
2. **住所/座標の保存**：`reservations` に `del_lat/del_lng/col_lat/col_lng/del_place_full/col_place_full` 列追加＋`create-booking`で保存（送信側は実装済）。
3. **SPK専用価格表UI**：`keydrop-prices.html` 新設（`hdm_keydrop_price` 編集）＋TOP導線。
4. **決済（Phase B）**：Square Payment Link＋`payment-webhook`で`confirmed`化＋`spk_accounting`起票。
5. 独立ドメイン／CORS絞り（最後）。
6. **🔴 Google Places検索の有効化（リリース前必須）**：検索ボックスはGoogle Places Autocomplete実装済（`loadGooglePlaces`・キー`AIzaSyCoX1EyEx-N5A0r4vRzC1KmVp3T29HILbI`／project handyman-491221）。**未設定の間はNominatimにフォールバック**（壊れない）。有効化に必要なオーナー作業：
   - (a) **Places API を有効化**（＋Maps JavaScript API）
   - (b) **APIキーのHTTPリファラ制限に `https://nosh2318.github.io/*`（独立ドメイン取得後はそのドメインも）を追加**
   - (c) **請求先(Billing)を有効化**
   - (d) **予算アラート＋API割当(quota)上限を設定**（暴発防止。小規模は無料枠内でほぼ¥0／Autocompleteのみ課金・地図はOSMで課金なし）
   - 確認：設定後にサイトで「ベッセルイン札幌…」等を入力し候補が出ればOK。出なければ(a)(b)(c)を再確認。
   - ※採用方針＝「検索だけGoogle／地図はOSM(無料)」。地図ごとGoogle化は未採用（コスト増のため見送り）。

## 6. 運用メモ
- **キャッシュ**：no-cacheメタ入り。画像更新は `?v=N` を上げる。確認時は URL末尾に `?v=日付` を付けると確実。
- ヘッドレス確認は地図タイルが灰色になる（実機では表示）。`force-device-scale-factor`＋`virtual-time-budget`でスクショ検証。
- 主要関数：`renderTopScreen / renderStepDateStrip / renderLocationStepPanel / renderVehicleScreen / renderVehiclePanel / initMap / setDeliveryPin / setCollectionPin / restorePins / fitToPins / updateMarkerDragging / mountHeaderMascot(guide) / fetchAvailableVehicles / createBookingOnServer`。
