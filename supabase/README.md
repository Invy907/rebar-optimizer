# Supabase

## 既定ユニットの投入

`seed-default-units.sql` を Supabase **SQL Editor** で実行すると、旧アプリ内モックと同等の 6 件が `units` に入ります。

- 事前に **少なくとも 1 アカウントでサインアップ** しておく（`user_id` に使うため）
- 既に同じ `code` の行があるとユニーク制約で失敗する場合は、重複を消すか SQL を調整してください
