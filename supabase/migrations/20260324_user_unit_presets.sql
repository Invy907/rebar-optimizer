-- User-defined unit design presets (separate from public.units rows)
create table if not exists public.user_unit_presets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists user_unit_presets_user_id_created_at_idx
  on public.user_unit_presets (user_id, created_at desc);

comment on table public.user_unit_presets is
  'User-saved unit editor presets (shape + rebar layout), per account';

alter table public.user_unit_presets enable row level security;

create policy "user_unit_presets_select_own"
  on public.user_unit_presets for select
  using (auth.uid() = user_id);

create policy "user_unit_presets_insert_own"
  on public.user_unit_presets for insert
  with check (auth.uid() = user_id);

create policy "user_unit_presets_delete_own"
  on public.user_unit_presets for delete
  using (auth.uid() = user_id);
