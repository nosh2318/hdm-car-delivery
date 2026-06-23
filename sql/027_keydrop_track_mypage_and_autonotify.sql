-- ============================================================
-- KEYDROP 待ち合わせ位置連動：マイページ自動表示＋ステータス変更で自動メール
-- 札幌＝reservations / Supabase ckrxttbnawkclshczsia / SQL Editorで1回RUN
-- 前提：026_keydrop_live_tracking.sql 適用済（列・track系RPC）
-- ============================================================

-- 1) マイページ用：メール一致で kd_status と track_token を返す（マイページは既にメール認証済）
--    → クライアント(index.html)はこのtokenで track.html を埋め込み表示できる
create or replace function keydrop_mypage_token(p_res text, p_mail text)
returns table(kd_status text, track_token text)
language sql security definer set search_path = public as $$
  select r.kd_status, r.kd_track_token
  from reservations r
  where upper(r.id) = upper(p_res)
    and lower(coalesce(r.mail,'')) = lower(p_mail)
$$;

grant execute on function keydrop_mypage_token(text,text) to anon, authenticated;

-- 2) ステータスが delivering / collecting に変わったら、自動でメールをキュー投入
--    （既存 keydrop-send-mail cron が拾って送信。track_url は token から生成）
create or replace function keydrop_track_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.ota = 'KEYDROP'
     and NEW.kd_track_token is not null
     and NEW.kd_status in ('delivering','collecting')
     and NEW.kd_status is distinct from OLD.kd_status
     and coalesce(NEW.mail,'') like '%@%'
  then
    insert into keydrop_notifications(type, to_email, reservation_id, payload, sent)
    values(
      case when NEW.kd_status = 'collecting' then 'track_collecting' else 'track_delivering' end,
      NEW.mail,
      NEW.id,
      jsonb_build_object(
        'name', NEW.name,
        'track_url', 'https://keydrop.jp/track.html?r=' || NEW.id || '&t=' || NEW.kd_track_token
      ),
      false
    );
  end if;
  return NEW;
end $$;

drop trigger if exists trg_keydrop_track_notify on reservations;
create trigger trg_keydrop_track_notify
  after update of kd_status on reservations
  for each row execute function keydrop_track_notify();

-- 注：keydrop-send-mail に type='track_delivering'/'track_collecting' のテンプレ追加＋再デプロイが必要
--     （未追加だと既定テンプレで送られるため、必ずテンプレ追加後にこのトリガーを活かす）
