-- Add optional L-shape count to units master
alter table public.units
  add column if not exists l_shape_count integer;

comment on column public.units.l_shape_count is
  'Optional count of L-shape members for unit shape management';
