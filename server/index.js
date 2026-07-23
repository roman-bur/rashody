require('./env').loadEnv();

const path = require('path');
const express = require('express');

const usersRouter = require('./routes/users');
const categoriesRouter = require('./routes/categories');
const expensesRouter = require('./routes/expenses');
const reportsRouter = require('./routes/reports');

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

app.use('/api/users', usersRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/reports', reportsRouter);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Статика фронтенда (PWA)
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

// Любой не-API маршрут — отдаём index.html (на случай прямых переходов по ссылке)
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Обработчик ошибок
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер учёта расходов запущен на порту ${PORT}`);
});
