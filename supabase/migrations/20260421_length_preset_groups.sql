-- User-defined length preset groups (per account)
create table if not exists public.length_preset_groups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  description text null,
  lengths integer[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists length_preset_groups_user_id_updated_at_idx
  on public.length_preset_groups (user_id, updated_at desc);

comment on table public.length_preset_groups is
  'User-saved length presets (groups of common segment lengths), per account';

alter table public.length_preset_groups enable row level security;

create policy "length_preset_groups_select_own"
  on public.length_preset_groups for select
  using (auth.uid() = user_id);

create policy "length_preset_groups_insert_own"
  on public.length_preset_groups for insert
  with check (auth.uid() = user_id);

create policy "length_preset_groups_update_own"
  on public.length_preset_groups for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "length_preset_groups_delete_own"
  on public.length_preset_groups for delete
  using (auth.uid() = user_id);

-- updated_at auto-maintenance
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists length_preset_groups_set_updated_at on public.length_preset_groups;
create trigger length_preset_groups_set_updated_at
before update on public.length_preset_groups
for each row execute function public.set_updated_at();

