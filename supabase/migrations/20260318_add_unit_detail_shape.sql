-- Add optional detail shape data to units master
alter table public.units
  add column if not exists detail_spec jsonb,
  add column if not exists detail_geometry jsonb;

comment on column public.units.detail_spec is
  'Parametric detail specification for unit shape editor';
comment on column public.units.detail_geometry is
  'Derived geometry payload used by preview/editor';
