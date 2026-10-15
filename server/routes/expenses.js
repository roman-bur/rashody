const express = require('express');
const pool = require('../db');
const { requireUser, requireAdmin } = require('../auth');
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
    // Отметку "из личных наличных" может проставить только администратор — это его
    // личный учёт, обычным пользователям галочка в интерфейсе не показывается вовсе.
    const fromPersonalCash = req.currentUser.is_admin && req.body.from_personal_cash === true;
    // Раньше отметка от не-администратора молча отбрасывалась — расход сохранялся без
    // списания с баланса, и никто об этом не знал. Теперь — явная ошибка.
    if (req.body.from_personal_cash === true && !req.currentUser.is_admin) {
      return res.status(403).json({ error: 'Отметку «из личных наличных» может ставить только администратор. Расход не сохранён.' });
    }

    if (!categoryId) return res.status(400).json({ error: 'Выберите категорию' });
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Укажите сумму больше нуля' });

    const { rows: catRows } = await pool.query(
      'SELECT id, name FROM categories WHERE id = $1 AND is_active = TRUE',
      [categoryId]
    );
    if (!catRows.length) return res.status(400).json({ error: 'Категория не найдена или отключена' });

    const { rows } = await pool.query(
      `INSERT INTO expenses (category_id, amount, expense_date, comment, user_id, from_personal_cash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, category_id, amount, expense_date, comment, user_id, created_at, from_personal_cash`,
      [categoryId, amount, expenseDate, comment, req.currentUser.id, fromPersonalCash]
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

// Исправить расход — только администратор: категория, сумма, дата, комментарий и
// отметка «из личных наличных». Баланс пересчитывается сам (он считается из отметок),
// старое и новое значение пишутся в журнал expense_changes.
router.patch('/:id', requireUser, requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });

    await client.query('BEGIN');
    const { rows: oldRows } = await client.query(
      `SELECT id, category_id, amount, expense_date::text AS expense_date, comment, from_personal_cash
       FROM expenses WHERE id = $1 FOR UPDATE`,
      [id]
    );
    if (!oldRows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Расход не найден' });
    }
    const old = oldRows[0];
    old.amount = Number(old.amount);
    const next_ = { ...old };
    const b = req.body || {};

    if (b.category_id !== undefined) {
      const categoryId = parseInt(b.category_id, 10);
      const { rows } = await client.query('SELECT id FROM categories WHERE id = $1', [categoryId || 0]);
      if (!rows.length) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Категория не найдена' }); }
      next_.category_id = categoryId;
    }
    if (b.amount !== undefined) {
      const amount = Number(b.amount);
      if (!amount || amount <= 0) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Укажите сумму больше нуля' }); }
      next_.amount = amount;
    }
    if (b.expense_date !== undefined) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.expense_date))) { await client.query('ROLLBACK'); return res.status(400).json({ error: 'Некорректная дата' }); }
      next_.expense_date = b.expense_date;
    }
    if (b.comment !== undefined) next_.comment = String(b.comment || '').trim() || null;
    if (b.from_personal_cash !== undefined) next_.from_personal_cash = b.from_personal_cash === true;

    const changed = {};
    const before = {};
    for (const k of ['category_id', 'amount', 'expense_date', 'comment', 'from_personal_cash']) {
      if (next_[k] !== old[k]) { before[k] = old[k]; changed[k] = next_[k]; }
    }
    if (Object.keys(changed).length) {
      await client.query(
        `UPDATE expenses SET category_id = $1, amount = $2, expense_date = $3, comment = $4, from_personal_cash = $5
         WHERE id = $6`,
        [next_.category_id, next_.amount, next_.expense_date, next_.comment, next_.from_personal_cash, id]
      );
      await client.query(
        `INSERT INTO expense_changes (expense_id, user_id, old_values, new_values) VALUES ($1, $2, $3, $4)`,
        [id, req.currentUser.id, JSON.stringify(before), JSON.stringify(changed)]
      );
    }
    await client.query('COMMIT');

    const { rows } = await pool.query(`${BASE_SELECT} WHERE e.id = $1`, [id]);
    res.json({ ...rows[0], changed: Object.keys(changed) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    next(err);
  } finally {
    client.release();
  }
});

// Удалить расход — только администратор. Осознанно узкая функция: нужна на случай
// сбоев (задвоенная запись из-за потери связи и т.п.), не как обычный рабочий сценарий.
router.delete('/:id', requireUser, requireAdmin, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'Некорректный id' });

    const { rowCount } = await pool.query('DELETE FROM expenses WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Расход не найден' });
    res.json({ id, deleted: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
