// Простая идентификация без паролей: фронтенд хранит выбранного пользователя
// в localStorage и присылает его id в заголовке X-User-Id при каждом запросе,
// который должен быть привязан к конкретному человеку (создание расхода,
// админ-операции). Публичное чтение (список расходов, отчёты) доступа не требует —
// приложение рассчитано на маленькую доверенную команду, ссылка на сайт не публикуется.

const pool = require('./db');

async function requireUser(req, res, next) {
  const userId = parseInt(req.header('X-User-Id'), 10);
  if (!userId) {
    return res.status(401).json({ error: 'Не выбран пользователь. Обновите страницу и выберите себя из списка.' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT id, name, is_admin, is_active FROM users WHERE id = $1',
      [userId]
    );
    if (!rows.length || !rows[0].is_active) {
      return res.status(401).json({ error: 'Пользователь не найден или деактивирован.' });
    }
    req.currentUser = rows[0];
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.currentUser || !req.currentUser.is_admin) {
    return res.status(403).json({ error: 'Действие доступно только администратору.' });
  }
  next();
}

module.exports = { requireUser, requireAdmin };
