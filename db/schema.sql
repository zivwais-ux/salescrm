-- ============================================================================
--  מערכת ניהול מכירות - סכמת Supabase / Postgres
--  Sales management schema. Run this once, then run db/seed.sql.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- agents ----
create table if not exists agents (
  agent_no    text primary key,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- parties ---
-- A party is any business entity in the report. The same number can appear as
-- a ship-to customer (מס. לקוח) and as a paying customer (לקוח משלם), so both
-- roles share one table instead of duplicating names.
create table if not exists parties (
  party_no    text primary key,
  name        text not null,
  created_at  timestamptz not null default now()
);

-- Everything Benny maintains himself about a customer. Kept apart from
-- `parties` so a refresh of the ERP data never overwrites his own work.
create table if not exists customer_profiles (
  party_no    text primary key references parties (party_no) on delete cascade,
  status      text not null default 'active'
              check (status in ('active', 'watch', 'dormant', 'lost', 'prospect')),
  tier        text check (tier in ('A', 'B', 'C')),
  segment     text,
  contact_name  text,
  contact_phone text,
  contact_email text,
  notes       text,
  updated_at  timestamptz not null default now()
);

-- ----------------------------------------------------------------- sales ----
-- One row per customer × payer × month. `amount` is מחיר כולל in ש"ח.
create table if not exists sales (
  id           uuid primary key default gen_random_uuid(),
  customer_no  text not null references parties (party_no) on delete cascade,
  payer_no     text not null references parties (party_no) on delete cascade,
  agent_no     text not null references agents (agent_no),
  year         smallint not null check (year between 2000 and 2100),
  month        smallint not null check (month between 1 and 12),
  amount       numeric(14, 2) not null default 0,
  currency     text not null default 'ILS',
  source       text not null default 'erp' check (source in ('erp', 'manual')),
  updated_at   timestamptz not null default now(),
  -- The same pair can be served by two agents in one month, so the agent is
  -- part of the key rather than a mere attribute.
  unique (customer_no, payer_no, agent_no, year, month)
);

create index if not exists sales_customer_idx on sales (customer_no, year, month);
create index if not exists sales_period_idx   on sales (year, month);

-- ---------------------------------------------------------------- targets ---
create table if not exists targets (
  id           uuid primary key default gen_random_uuid(),
  party_no     text references parties (party_no) on delete cascade,
  agent_no     text references agents (agent_no),
  year         smallint not null,
  month        smallint check (month between 1 and 12),  -- null = יעד שנתי
  amount       numeric(14, 2) not null default 0,
  unique (party_no, year, month)
);

-- ------------------------------------------------------------- activities ---
create table if not exists activities (
  id          uuid primary key default gen_random_uuid(),
  party_no    text not null references parties (party_no) on delete cascade,
  happened_on date not null default current_date,
  kind        text not null default 'note'
              check (kind in ('note', 'call', 'meeting', 'quote', 'issue')),
  title       text not null,
  body        text,
  follow_up_on date,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists activities_party_idx on activities (party_no, happened_on desc);
create index if not exists activities_followup_idx on activities (follow_up_on)
  where done = false;

-- ------------------------------------------------------- audit of changes ---
-- Every manual edit is recorded so the Excel export and the ERP can be
-- reconciled against what was changed in the app.
create table if not exists change_log (
  id          bigserial primary key,
  table_name  text not null,
  row_key     text not null,
  action      text not null check (action in ('insert', 'update', 'delete')),
  before      jsonb,
  after       jsonb,
  changed_by  uuid default auth.uid(),
  changed_at  timestamptz not null default now()
);

create or replace function log_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  key text;
begin
  key := coalesce(
    (to_jsonb(coalesce(new, old)) ->> 'id'),
    (to_jsonb(coalesce(new, old)) ->> 'party_no'),
    (to_jsonb(coalesce(new, old)) ->> 'customer_no'),
    ''
  );
  insert into change_log (table_name, row_key, action, before, after)
  values (
    tg_table_name,
    key,
    lower(tg_op),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sales_log on sales;
create trigger sales_log after insert or update or delete on sales
  for each row execute function log_change();

drop trigger if exists sales_touch on sales;
create trigger sales_touch before update on sales
  for each row execute function touch_updated_at();

drop trigger if exists profiles_log on customer_profiles;
create trigger profiles_log after insert or update or delete on customer_profiles
  for each row execute function log_change();

-- ------------------------------------------------------------------ views ---
-- Yearly total per customer, with the month breakdown the UI charts.
create or replace view customer_year_totals as
select
  s.customer_no,
  p.name as customer_name,
  s.year,
  sum(s.amount)                                        as total,
  count(distinct s.payer_no)                           as payers,
  max(s.month) filter (where s.amount <> 0)            as last_active_month,
  jsonb_object_agg(s.month, s.month_total)             as months
from (
  select customer_no, payer_no, year, month, amount,
         sum(amount) over (partition by customer_no, year, month) as month_total
  from sales
) s
join parties p on p.party_no = s.customer_no
group by s.customer_no, p.name, s.year;

-- Year-over-year comparison, restricted to the months both years actually have.
create or replace view customer_yoy as
with span as (
  select max(year) as cur_year, max(month) filter (where year = (select max(year) from sales)) as cur_month
  from sales
)
select
  c.party_no                                  as customer_no,
  c.name                                      as customer_name,
  coalesce(cur.total, 0)                      as current_ytd,
  coalesce(prev.total, 0)                     as prior_ytd,
  coalesce(cur.total, 0) - coalesce(prev.total, 0) as delta
from parties c
cross join span
left join lateral (
  select sum(amount) as total from sales s
  where s.customer_no = c.party_no and s.year = span.cur_year and s.month <= span.cur_month
) cur on true
left join lateral (
  select sum(amount) as total from sales s
  where s.customer_no = c.party_no and s.year = span.cur_year - 1 and s.month <= span.cur_month
) prev on true
where coalesce(cur.total, 0) <> 0 or coalesce(prev.total, 0) <> 0;

-- -------------------------------------------------------------------- RLS ---
-- Single-tenant setup: any signed-in user reads and writes. Tighten by agent
-- (e.g. using a claim on auth.jwt()) when more agents get accounts.
alter table agents            enable row level security;
alter table parties           enable row level security;
alter table customer_profiles enable row level security;
alter table sales             enable row level security;
alter table targets           enable row level security;
alter table activities        enable row level security;
alter table change_log        enable row level security;

do $$
declare t text;
begin
  foreach t in array array['agents', 'parties', 'customer_profiles', 'sales', 'targets', 'activities']
  loop
    execute format('drop policy if exists %I on %I', t || '_rw', t);
    execute format(
      'create policy %I on %I for all to authenticated using (true) with check (true)',
      t || '_rw', t);
  end loop;

  execute 'drop policy if exists change_log_read on change_log';
  execute 'create policy change_log_read on change_log for select to authenticated using (true)';
end;
$$;
