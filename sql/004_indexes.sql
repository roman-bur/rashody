-- ============================================================
-- 004_indexes.sql
-- Индексы для быстрых фильтров и отчётов.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_expenses_date          ON expenses (expense_date);
CREATE INDEX IF NOT EXISTS idx_expenses_category       ON expenses (category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_user           ON expenses (user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date_category  ON expenses (expense_date, category_id);
CREATE INDEX IF NOT EXISTS idx_categories_group        ON categories (group_id);
CREATE INDEX IF NOT EXISTS idx_categories_active       ON categories (is_active);
CREATE INDEX IF NOT EXISTS idx_users_active            ON users (is_active);
