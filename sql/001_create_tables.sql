-- ============================================================
-- 001_create_tables.sql
-- Базовая структура БД учёта расходов.
-- Скрипт идемпотентен: повторный запуск ничего не сломает.
-- ============================================================

-- Пользователи (вход по имени, без паролей)
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  is_admin    BOOLEAN NOT NULL DEFAULT FALSE,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Разделы (группы) категорий: Закупки, Аренда и коммуналка, Маркетинг, Прочее, Зарплаты
CREATE TABLE IF NOT EXISTS category_groups (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- Категории расходов
CREATE TABLE IF NOT EXISTS categories (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  group_id    INTEGER NOT NULL REFERENCES category_groups(id) ON DELETE RESTRICT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (name, group_id)
);

-- Расходы
CREATE TABLE IF NOT EXISTS expenses (
  id            SERIAL PRIMARY KEY,
  category_id   INTEGER NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  expense_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  comment       TEXT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Служебная таблица применённых миграций (используется server/migrate.js)
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
