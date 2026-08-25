// Личный баланс наличных администратора: приходы денег и сверка с расходами,
// отмеченными галочкой "оплачено из личных наличных" (см. server/routes/expenses.js).
// Весь раздел доступен только администратору.

const express = require('express');
const pool = require('../db');
const { requireUser, requireAdmin } = require('../auth');

const router = express.Router();

// Текущий баланс: сумма приходов минус сумма расходов, отмеченных как "из наличных"
router.get('/summary', requireUser, requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COALESCE((SELECT SUM(amount) FROM cash_balance_entries), 0) AS income_total,
        COALESCE((SELECT SUM(amount) FROM expenses WHERE from_personal_cash = TRUE), 0) AS expenses_total
    `);
    const incomeTotal = Number(rows[0].income_total);
    const expensesTotal = Number(rows[0].expenses_total);
    res.json({
      income_total: incomeTotal,
      expenses_total: expensesTotal,
      balance: incomeTotal - expensesTotal
    });
  } catch (err) {
    next(err);
  }
});

// Список приходов (последние сверху)
router.get('/entries', requireUser, requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 500);
    const { rows } = await pool.query(
      `SELECT ce.id, ce.amount, ce.entry_date, ce.comment, ce.created_at, u.name AS user_name
       FROM cash_balance_entries ce
       JOIN users u ON u.id = ce.user_id
       ORDER BY ce.entry_date DESC, ce.id DESC
       LIMIT $1`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Добавить приход (или корректировку остатка — сумма может быть отрицательной,
// см. кнопку "Указать остаток на сегодня" во фронтенде)
router.post('/entries', requireUser, requireAdmin, async (req, res, next) => {
  try {
    const amount = Number(req.body.amount);
    const entryDate = req.body.entry_date || new Date().toISOString().slice(0, 10);
    const comment = (req.body.comment || '').trim() || null;

    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ error: 'Сумма не может быть нулевой' });
    }

    const { rows } = await pool.query(
      `INSERT INTO cash_balance_entries (amount, entry_date, comment, user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, amount, entry_date, comment, created_at`,
      [amount, entryDate, comment, req.currentUser.id]
    );
    res.status(201).json({ ...rows[0], user_name: req.currentUser.name });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
