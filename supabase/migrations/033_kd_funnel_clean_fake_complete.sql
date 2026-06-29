-- 033 KEYDROP Pulse: 偽の「完了CV」を遡及で除外する
-- 背景: 直近30日の完了(step8)=2件は全てテスト/内部操作（KEYDROP実予約は全てテスト名・実CV=0）。
--       生テーブルはRLSでanon/auth不可 → オーナーがSQL Editorで1回RUN。
-- 効果: 完了した2セッションの「全ステップ行」を selftest_ 化 → 集計ビュー(session_id not like 'selftest%')から完全除外。
--       完了CV=0 になり、そのセッションがファネル各段を水増ししていた分も消える。
-- 以後の内部端末は index.html の ?internal=1（session_idを selftest_ 接頭辞）で自動除外されるため、本SQLは一度きり。

update kd_funnel_log
set session_id = 'selftest_' || session_id
where session_id in (
  select session_id from kd_funnel_log where step_number = 8
)
and session_id not like 'selftest%';

-- 確認（完了は0になるはず）
-- select step_number, step, store, count(distinct session_id) from public_kd_funnel_v_src group by 1,2,3 order by 1;
