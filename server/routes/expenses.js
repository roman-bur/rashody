const express = require('express');
const pool = require('../db');
const { requireUser } = require('../auth');
const { buildFilters, BASE_SELECT } = require('../expenseQueries');

const router = express.Router();

// Список расходов с фильтрами (период, категория, раздел, пользователь)
router.get('/', async (req, res, next) => {
  try {
    const { whereSql, values, nextIndex } = buildFilters(req.query, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
    const offset = parseInt(req.query.offset, 10) || 0;

    const { rows } = await pool.query(
      `${BASE_SELECT} ${whereSql}
       ORDER BY e.expense_date DESC, e.id DESC
       LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`,
      [...values, limit, offset]
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Последние N расходов — для главного экрана
router.get('/recent', async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const { rows } = await pool.query(`${BASE_SELECT} ORDER BY e.created_at DESC LIMIT $1`, [limit]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Итоги за сегодня и текущий месяц — для главного экрана.
// today/monthStart передаются с фронтенда (локальная дата браузера), чтобы не зависеть
// от часового пояса сервера.
router.get('/summary', async (req, res, next) => {
  try {
    const today = req.query.today;
    const monthStart = req.query.monthStart;
    if (!today || !monthStart) {
      return res.status(400).json({ error: 'today и monthStart обязательны (YYYY-MM-DD)' });
    }
    const { rows } = await pool.query(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE expense_date = $1), 0) AS today_sum,
         COALESCE(SUM(amount) FILTER (WHERE expense_date >= $2), 0) AS month_sum
       FROM expenses`,
      [today, monthStart]
    );
    res.json({
      today_sum: Number(rows[0].today_sum),
      month_sum: Number(rows[0].month_sum)
    });
  } catch (err) {
    next(err);
  }
});

// Добавить расход — главный сценарий приложения
router.post('/', requireUser, async (req, res, next) => {
  try {
    const categoryId = parseInt(req.body.category_id, 10);
    const amount = Number(req.body.amount);
    const expenseDate = req.body.expense_date || new Date().toISOString().slice(0, 10);
    const comment = (req.body.comment || '').trim() || null;

    if (!categoryId) return res.status(400).json({ error: 'Выберите категорию' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Укажите сумму больше нуля' });

    const { rows: catRows } = await pool.query(
      'SELECT id, name FROM categories WHERE id = $1 AND is_active = TRUE',
      [categoryId]
    );
    if (!catRows.length) return res.status(400).json({ error: 'Категория не найдена или отключена' });

    const { rows } = await pool.query(
      `INSERT INTO expenses (category_id, amount, expense_date, comment, user_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, category_id, amount, expense_date, comment, user_id, created_at`,
      [categoryId, amount, expenseDate, comment, req.currentUser.id]
    );

    res.status(201).json({
      ...rows[0],
      category_name: catRows[0].name,
      user_name: req.currentUser.name
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
