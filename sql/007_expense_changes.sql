-- ============================================================
-- 007_expense_changes.sql
-- Журнал исправлений расходов: кто, когда, что было и что стало.
-- Нужен для кнопки «Изменить» (исправление ошибок, в т. ч. отметки
-- «оплачено из личных наличных»). Только добавление таблицы.
-- ============================================================

CREATE TABLE IF NOT EXISTS expense_changes (
  id          SERIAL PRIMARY KEY,
  expense_id  INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  old_values  JSONB NOT NULL,
  new_values  JSONB NOT NULL,
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_changes_expense ON expense_changes (expense_id);
