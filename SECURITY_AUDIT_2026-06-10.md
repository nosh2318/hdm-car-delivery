# 🔒 セキュリティ監査・是正記録（SPK / KEYDROP 共有DB）2026-06-10

対象DB: `ckrxttbnawkclshczsia`（NHA/SPK/KEYDROP 共有）。anon key は公開物（誰でも持てる）前提で「anonで何が読めて/書けてしまうか」を実測監査。

## ✅ 是正済み（本日・最優先＝認証情報＋財務）
| テーブル | 問題（修正前） | 対応 | 検証 |
|---|---|---|---|
| `app_settings` | **anon READ で `team_password=handyman2026` 漏洩**／**anon INSERT・UPDATE で誰でも価格・設定・パスワード改変可** | public の SELECT/INSERT/UPDATE ポリシー3本を削除（authenticated の auth_full_access のみ残す） | anon read=[] / anon write=401・0行 / 顧客の公開ビュー(価格・配達範囲)は生存(security_invoker=off でRLSバイパス) / SPK admin(authenticated)は読み書き可 |
| `spk_accounting` | anon で会計データ READ/WRITE 可（財務漏洩） | public ALL ポリシー削除 | anon=[] / authenticated=200 |
| `nha_accounting` | 同上 | public ALL ポリシー削除 | anon=[] / authenticated=200 |

### ✅ team_password 変更済み（2026-06-10）
- 旧 `handyman2026`（平文・漏洩）→ **新パスコード `Hdm-SPK-2026`** に変更。
- **DBには SHA-256 ハッシュで保存**（`dd7966...`・平文を置かない）。app `checkPassword` は `value.length===64` でハッシュ比較するので新パスで通る（node/app sha256一致確認済）。
- これはSPKアプリ**ログイン2段目のパスコード**（1段目＝Supabase Auth member@/oshita@）。staffへ新パスコードを周知。別の値にしたい場合は sha256(新値) を app_settings.team_password に再upsertするだけ。

### 追加ロック（2026-06-10・authenticated policyあり＝安全に実施）
- `monthly_snapshots` `sq_terminal_failed` `store_events`：public ALL 削除（anon=[] / authenticated=200 検証済）。
- `hdm_todo`：anon専用ポリシー削除（旧・per-table版へ移行済＝封鎖でOK）。

## ✅ 併せて確認済み（安全だった）
- anon INSERT `reservations` → 401（RLSで拒否）。顧客の書込は Edge Function `create-booking`(service_role) 経由に一本化。
- RPC `keydrop_book` → anon/authenticated は 401（service_roleのみ・revoke済）。割当はアトミック（advisory lock）でダブルブッキング防止。
- 公開ビュー `public_*_v` は全て security_invoker=off ＝ベーステーブルのanonを締めても顧客表示は壊れない。

## ✅ Phase 2-① 問い合わせアプリ 完了（2026-06-10）
- **アプリ**(handyman-inquiry.vercel.app)：認証ゼロ→**ログイン必須化**（signInWithPasswordゲート追加・同じsbクライアントが認証セッション保持→全`.from`がauthenticated）。Vercel本番デプロイ済。ソース＝`~/Desktop/HANDYMAN/inquiry_system/inquiry_manager.html`＋`inquiry_deploy/index.html`。
- **GAS**(HANDYMAN 問い合わせ管理)：anonキー→**service_role化**（オーナー貼付済）。
- **DB**：`inquiries`/`handyman_knowledge`/`reply_templates` の public(anon) ALL ポリシー削除→authenticated(アプリ)＋service_role(GAS)のみ。検証：anon=[]、auth=200。
- ログイン情報：`oshita@g-lines.jp`/`nosh2318`（or `member@g-lines.jp`/`8888`）。staff周知要。

## ⚠️ 残り（anon全開・段階対応が必要＝アプリ依存を確認してから締める）
網羅スキャンで public(anon) に ALL 等を許可している残りテーブル。**一部はアプリが正規にanonを使う**ため、無闇に締めると現場APPが壊れる。各APPの認証方式を確認→authenticated/Edge Fn/narrowポリシーへ移行してから締める。

| テーブル | 使ってる可能性のあるAPP | 推奨対応 |
|---|---|---|
| `vehicle_twins` / `check_events` | 傷チェックAPP(handyman-damage)＝**anon正規利用**。公開共有 v.html は `share_enabled=true` の narrow policy あり | ALL(vt_all/ce_all)を「自店舗のみ」等へ絞る。共有読取は既存narrow維持。**※締める前にdamage appをauthenticated化 or narrow検証** |
| `received_invoices` | invoice_manager.html(file://・anon) + SPKタブ(authenticated) | invoice_managerをauthenticated化 → anon ALL削除 |
| `sns_app_state` | SNS自動投稿GAS・monitor等 | 用途確認の上 anon ALL削除 |
| ~~`inquiries`/`handyman_knowledge`/`reply_templates`~~ | ✅ **Phase 2-①で完了** | — |

## 体制（恒久ルール）
1. **anonは「公開ビュー読取」と「Edge Function呼び出し」のみ**を原則とする。ベーステーブルへの anon 直READ/WRITE は持たせない。
2. **顧客(KEYDROP)書込は必ず Edge Function(service_role)経由**（create-booking）。anon直INSERT/PATCHを作らない。
3. **PII/財務/認証情報テーブルは authenticated（admin）か service_role(GAS)のみ**。
4. 新テーブル作成時は **デフォルトで anon ポリシーを付けない**。公開が必要なら **非PIIだけの公開ビュー(security_invoker=off)** を作る。
5. **CORS**：create-booking は現在 `*` → 独自ドメイン公開時にKEYDROPドメインへ絞る（Phase D）。
6. **service_role キーはEdge Function内のみ**。クライアント/リポジトリに置かない。
7. **secret類はapp_settingsに平文で置かない**（team_password等）。最低ハッシュ、本来はSupabase Auth/Secretsへ。

## 監査コマンド（再実行用）
```
-- public(anon)に許可してる全ポリシー
select tablename, policyname, cmd from pg_policies where ('public'=any(roles) or 'anon'=any(roles)) and schemaname='public' order by tablename;
-- 実測: anonでREAD/WRITEを叩いて [] / 401 を確認（apikey=anon, Authorization=anon）
```
