-- 代車リクエスト（KEYDROP札幌・提案/チャット型）2026-08-24
create table if not exists daisha_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  store text default 'spk',
  use_case text, start_date text, end_date text, period_note text,
  del_place text, col_place text, same_col boolean default true,
  cust_type text, company text, name text, tel text, email text,
  choice1 text, choice2 text, choice3 text, memo text,
  status text default 'new', staff_note text
);
alter table daisha_requests enable row level security; -- 書込は EF(service_role)のみ

create table if not exists daisha_messages (
  id bigint generated always as identity primary key,
  request_id uuid references daisha_requests(id) on delete cascade,
  sender text, body text, created_at timestamptz default now(),
  read_by_staff boolean default false, read_by_customer boolean default false
);
alter table daisha_messages enable row level security;
create index if not exists idx_daisha_msg_req on daisha_messages(request_id, id);
