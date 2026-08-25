-- ============================================================
-- 006_cash_balance_allow_negative.sql
-- Разрешаем в приходах наличного баланса отрицательные суммы —
-- нужно для функции "Указать остаток на сегодня": приложение считает
-- разницу между фактическим и посчитанным остатком и записывает её
-- как обычную запись в cash_balance_entries (положительную или
-- отрицательную), не трогая историю прошлых записей.
-- ============================================================

ALTER TABLE cash_balance_entries DROP CONSTRAINT IF EXISTS cash_balance_entries_amount_check;
ALTER TABLE cash_balance_entries ADD CONSTRAINT cash_balance_entries_amount_check CHECK (amount <> 0);
