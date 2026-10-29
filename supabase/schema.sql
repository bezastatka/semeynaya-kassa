-- Семейная касса: схема базы для Supabase.
-- Выполните этот файл целиком в Supabase → SQL Editor → New query → Run.
-- Повторный запуск безопасен: всё создаётся через "if not exists" / "or replace".

-- 1. Документы приложения. Каждая запись — один документ по пути:
--    data/users/<id пользователя>/...   личные данные (видит только владелец)
--    accounts/<id счёта>/...            общий счёт (видят только участники)
create table if not exists public.docs (
  path       text primary key,
  parent     text not null,
  data       jsonb not null default '{}'::jsonb,
  owner      uuid not null default auth.uid(),
  acc        text generated always as (case when path like 'accounts/%' then split_part(path, '/', 2) end) stored,
  uspace     text generated always as (case when path like 'data/users/%' then split_part(path, '/', 3) end) stored,
  updated_at timestamptz not null default now(),
  constraint docs_path_ok check (path ~ '^[A-Za-z0-9_\-.~:@+]+(/[A-Za-z0-9_\-.~:@+]+)+$' and length(path) <= 1000),
  constraint docs_size_ok check (pg_column_size(data) <= 262144)
);
create index if not exists docs_parent_idx on public.docs (parent);
create index if not exists docs_parent_date_idx on public.docs (parent, (data->>'date'));
create index if not exists docs_parent_month_idx on public.docs (parent, (data->>'month'));
create index if not exists docs_code_idx on public.docs ((upper(data->>'code'))) where parent = 'accounts';
create index if not exists docs_acc_idx on public.docs (acc);

alter table public.docs enable row level security;
alter table public.docs replica identity full;

-- 2. Участник ли текущий пользователь общего счёта.
create or replace function public.is_member(acc_id text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.docs
    where path = 'accounts/' || acc_id and (data->'members') ? (auth.uid()::text)
  )
$$;

-- 3. Правила доступа.
drop policy if exists docs_select on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;

create policy docs_select on public.docs for select to authenticated using (
  uspace = auth.uid()::text or (acc is not null and public.is_member(acc))
);

create policy docs_insert on public.docs for insert to authenticated with check (
  uspace = auth.uid()::text
  or (acc is not null and public.is_member(acc))
  or (path ~ '^accounts/[^/]+$' and parent = 'accounts'
      and (data->'members') ? (auth.uid()::text) and data->>'owner' = auth.uid()::text)
);

create policy docs_update on public.docs for update to authenticated
  using (uspace = auth.uid()::text or (acc is not null and public.is_member(acc)))
  with check (uspace = auth.uid()::text or (acc is not null and public.is_member(acc)));

create policy docs_delete on public.docs for delete to authenticated using (
  uspace = auth.uid()::text or (acc is not null and public.is_member(acc))
);

-- 4. Частичное обновление документа (поля верхнего уровня сливаются).
create or replace function public.doc_update(p_path text, p_patch jsonb) returns boolean
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  update public.docs set data = data || p_patch, updated_at = now() where path = p_path;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not_found' using errcode = 'P0002'; end if;
  return true;
end $$;

-- 5. Вход в общий счёт по коду приглашения.
create or replace function public.join_account(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare v_path text;
begin
  if auth.uid() is null then raise exception 'not_signed_in'; end if;
  select path into v_path from public.docs
   where parent = 'accounts' and upper(data->>'code') = upper(trim(p_code)) limit 1;
  if v_path is null then return null; end if;
  update public.docs
     set data = jsonb_set(data, '{members}', coalesce(data->'members', '[]'::jsonb) || to_jsonb(auth.uid()::text)), updated_at = now()
   where path = v_path and not coalesce((data->'members') ? (auth.uid()::text), false);
  return split_part(v_path, '/', 2);
end $$;
revoke all on function public.join_account(text) from public, anon;
grant execute on function public.join_account(text) to authenticated;

-- 6. Имена людей (видны только тем, с кем есть общий счёт).
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  name       text not null default '' check (length(name) <= 60),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create or replace function public.shares_account(other uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.docs
    where parent = 'accounts'
      and (data->'members') ? (auth.uid()::text)
      and (data->'members') ? (other::text)
  )
$$;

drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_upsert on public.profiles;
drop policy if exists profiles_update on public.profiles;
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or public.shares_account(id));
create policy profiles_upsert on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- 7. Живые обновления.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;

-- 8. Сколько места занято (для счётчика в настройках).
create or replace function public.my_usage() returns json
language sql stable security invoker set search_path = public as $$
  select json_build_object('docs', count(*), 'bytes', coalesce(sum(pg_column_size(data)), 0)) from public.docs
$$;
