-- Allow users to rename / edit their own presets
create policy "user_unit_presets_update_own"
  on public.user_unit_presets for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

