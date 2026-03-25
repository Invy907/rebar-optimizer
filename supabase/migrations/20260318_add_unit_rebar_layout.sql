-- Add optional rebar layout layer to units
alter table public.units
  add column if not exists rebar_layout jsonb;

comment on column public.units.rebar_layout is
  'Rebar placement layer (rebars/spacings/annotations) for unit detail editor';
