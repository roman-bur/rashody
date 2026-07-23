-- ============================================================
-- 003_seed_users.sql
-- Начальный список пользователей. Роман — администратор.
-- Скрипт идемпотентен (ON CONFLICT DO NOTHING).
-- Чтобы добавить нового человека позже — см. sql/999_migration_template.sql
-- или используйте админ-панель в приложении.
-- ============================================================

INSERT INTO users (name, is_admin) VALUES
  ('Роман', TRUE)
ON CONFLICT (name) DO NOTHING;

INSERT INTO users (name, is_admin) VALUES
  ('Влад', FALSE),
  ('Саша', FALSE),
  ('Анна', FALSE),
  ('Александр', FALSE)
ON CONFLICT (name) DO NOTHING;
