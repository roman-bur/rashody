-- ============================================================
-- 005_personal_cash_balance.sql
-- Личный баланс наличных (для администратора): приходы денег +
-- отметка на расходах "оплачено из личных наличных".
-- Идемпотентно, безопасно запускать повторно.
-- ============================================================

-- Отметка на расходе: оплачен из личных наличных, а не с рабочего счёта
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS from_personal_cash BOOLEAN NOT NULL DEFAULT FALSE;

-- Приходы денег в личный наличный баланс
CREATE TABLE IF NOT EXISTS cash_balance_entries (
  id          SERIAL PRIMARY KEY,
  amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  entry_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  comment     TEXT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cash_entries_date ON cash_balance_entries (entry_date);
CREATE INDEX IF NOT EXISTS idx_expenses_from_cash ON expenses (from_personal_cash) WHERE from_personal_cash = TRUE;
