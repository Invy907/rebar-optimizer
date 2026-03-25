-- 旧 MOCK_UNITS と同等のデフォルトユニットを DB に投入するシード
--
-- 前提:
--   1. 少なくとも 1 人がアプリにサインアップ済み（auth.users に行があること）
--   2. Supabase SQL Editor で実行（または psql）
--
-- 既に同じ code の行がある場合はスキップしたい場合は、実行前に units を空にするか
-- 下記の INSERT を code で ON CONFLICT するようテーブル定義を調整してください。

INSERT INTO public.units (
  user_id,
  name,
  code,
  location_type,
  shape_type,
  color,
  mark_number,
  bars,
  spacing_mm,
  description,
  is_active,
  template_id
)
VALUES
(
  (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1),
  '外周部ストレート',
  'red-1',
  '外周部',
  'straight',
  'red',
  1,
  '[{"diameter":"D13","qtyPerUnit":4},{"diameter":"D10","qtyPerUnit":1}]'::jsonb,
  200,
  NULL,
  TRUE,
  'outer_straight'
),
(
  (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1),
  '内部ストレート',
  'blue-1',
  '内部',
  'straight',
  'blue',
  1,
  '[{"diameter":"D13","qtyPerUnit":2},{"diameter":"D10","qtyPerUnit":1}]'::jsonb,
  200,
  NULL,
  TRUE,
  'inner_straight'
),
(
  (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1),
  '外周部出隅コーナー',
  'red-2',
  '外周部',
  'corner_out',
  'red',
  2,
  '[{"diameter":"D13","qtyPerUnit":3},{"diameter":"D10","qtyPerUnit":1}]'::jsonb,
  NULL,
  NULL,
  TRUE,
  'outer_corner_out'
),
(
  (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1),
  '内部T字',
  'blue-4',
  '内部',
  'corner_T',
  'blue',
  4,
  '[{"diameter":"D13","qtyPerUnit":2},{"diameter":"D10","qtyPerUnit":1}]'::jsonb,
  NULL,
  NULL,
  TRUE,
  'inner_T'
),
(
  (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1),
  'ベース部分ユニット筋',
  'emerald-1',
  'ベース',
  'straight',
  'emerald',
  1,
  '[{"diameter":"D13","qtyPerUnit":3},{"diameter":"D10","qtyPerUnit":2}]'::jsonb,
  150,
  NULL,
  TRUE,
  'base_standard'
),
(
  (SELECT id FROM auth.users ORDER BY created_at ASC LIMIT 1),
  '開口補強',
  'violet-1',
  'その他',
  'opening',
  'violet',
  1,
  '[{"diameter":"D13","qtyPerUnit":2}]'::jsonb,
  NULL,
  '非活性（参考用）',
  FALSE,
  'opening_reinforce'
);
