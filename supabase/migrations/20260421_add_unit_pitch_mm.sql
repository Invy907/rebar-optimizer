alter table public.units
  add column if not exists pitch_mm integer;

comment on column public.units.pitch_mm is
  'Independent pitch field used for unit identity and count calculation';
