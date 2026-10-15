-- ============================================================
-- 008_expense_client_id.sql
-- Защита от дублей при плохой связи: телефон даёт каждому расходу
-- свой номер (client_id). Если ответ сервера потерялся и расход
-- отправляют повторно — сервер узнаёт номер и не создаёт второй расход.
-- Только добавление столбца, старые записи не трогаются.
-- ============================================================

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS client_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_client_id ON expenses (client_id) WHERE client_id IS NOT NULL;
