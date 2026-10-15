(function () {
  'use strict';

  // ---------------------------------------------------------------------
  // Утилиты
  // ---------------------------------------------------------------------

  const USER_STORAGE_KEY = 'expenseAppUser';
  const COOKIE_NAME = 'expenseAppUser';

  function setCookie(name, value, days) {
    const d = new Date();
    d.setTime(d.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
  }

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function saveCurrentUser(user) {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    setCookie(COOKIE_NAME, JSON.stringify(user), 365);
  }

  function loadStoredUser() {
    try {
      const raw = localStorage.getItem(USER_STORAGE_KEY) || getCookie(COOKIE_NAME);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function clearStoredUser() {
    localStorage.removeItem(USER_STORAGE_KEY);
    setCookie(COOKIE_NAME, '', -1);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toISODate(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function formatMoney(n) {
    const num = Number(n) || 0;
    return num.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽';
  }

  function formatDateRu(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}.${m}.${y}`;
  }

  function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0 = вс
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
  }

  function periodToRange(period) {
    const now = new Date();
    if (period === 'today') {
      const iso = toISODate(now);
      return { from: iso, to: iso };
    }
    if (period === 'this_week') {
      const monday = getMonday(now);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: toISODate(monday), to: toISODate(sunday) };
    }
    if (period === 'last_week') {
      const monday = getMonday(now);
      monday.setDate(monday.getDate() - 7);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: toISODate(monday), to: toISODate(sunday) };
    }
    if (period === 'this_month') {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { from: toISODate(from), to: toISODate(to) };
    }
    if (period === 'last_month') {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      return { from: toISODate(from), to: toISODate(to) };
    }
    return { from: '', to: '' };
  }

  // ---------------------------------------------------------------------
  // Связь и несохранённые расходы
  // ---------------------------------------------------------------------

  let netProblem = false;
  function setNetProblem(on) {
    netProblem = on;
    renderNetBanner();
  }
  function renderNetBanner() {
    const el = document.getElementById('net-banner');
    if (!el) return;
    const offline = navigator.onLine === false;
    if (offline || netProblem) {
      el.textContent = offline
        ? '📵 Нет интернета. Расходы сейчас НЕ сохраняются, цифры на экране могут быть устаревшими.'
        : '⚠️ Нет связи с сервером. Расходы сейчас НЕ сохраняются, цифры на экране могут быть устаревшими.';
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }
  window.addEventListener('online', () => {
    netProblem = false;
    renderNetBanner();
    if (state.user) loadCategories().catch(() => {});
    refreshCurrentScreen();
  });
  window.addEventListener('offline', renderNetBanner);

  // Расход хранится на телефоне, пока сервер не подтвердил запись. Если связь
  // пропала или приложение закрыли — он остаётся в красном списке сверху.
  const PENDING_KEY = 'expensePending';
  function loadPending() {
    try { return JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); } catch (e) { return []; }
  }
  function savePending(list) {
    try { localStorage.setItem(PENDING_KEY, JSON.stringify(list)); } catch (e) { /* ничего */ }
    renderPendingBanner();
  }
  function addPending(item) {
    savePending(loadPending().filter((p) => p.client_id !== item.client_id).concat([item]));
  }
  function removePending(clientId) {
    savePending(loadPending().filter((p) => p.client_id !== clientId));
  }
  function newClientId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  function renderPendingBanner() {
    const el = document.getElementById('pending-banner');
    if (!el) return;
    const list = loadPending();
    if (!list.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="pending-title">❌ Не подтверждено сервером: ${list.length}. В отчётах и балансе этих расходов НЕТ — отправьте их.</div>
      ${list.map((p) => `
        <div class="pending-row">
          <span>${escapeHtml(p.category_name)} · ${formatMoney(p.amount)} · ${formatDateRu(p.expense_date)}${p.from_personal_cash ? ' · 💵' : ''}</span>
          <span>
            <button class="mark-cash-btn" data-pending-send="${p.client_id}">Отправить</button>
            <button class="expense-delete-btn" data-pending-drop="${p.client_id}" title="Не сохранять">✕</button>
          </span>
        </div>`).join('')}`;
    el.querySelectorAll('[data-pending-send]').forEach((b) => b.addEventListener('click', () => sendPending(b.dataset.pendingSend)));
    el.querySelectorAll('[data-pending-drop]').forEach((b) => b.addEventListener('click', () => {
      if (!confirm('Не сохранять этот расход? Он будет удалён с телефона.')) return;
      removePending(b.dataset.pendingDrop);
    }));
  }
  async function postExpense(item) {
    const saved = await api('/api/expenses', {
      method: 'POST',
      body: JSON.stringify({
        client_id: item.client_id,
        category_id: item.category_id,
        amount: item.amount,
        expense_date: item.expense_date,
        comment: item.comment,
        from_personal_cash: item.from_personal_cash
      })
    });
    removePending(item.client_id);
    return saved;
  }
  async function sendPending(clientId) {
    const item = loadPending().find((p) => p.client_id === clientId);
    if (!item) return;
    try {
      const saved = await postExpense(item);
      if (item.from_personal_cash && !saved.from_personal_cash) {
        alert('Расход сохранён, но с баланса НЕ списан. Профиль → «Мои расходы без отметки» → «💵 Из моих».');
      } else {
        showToast(saved.already_saved ? 'Этот расход уже был сохранён ранее — дубля нет' : 'Сохранено');
      }
      refreshCurrentScreen();
    } catch (e) {
      if (!e.network) removePending(clientId); // сервер отказал по существу — повтор не поможет
      alert('Не сохранено: ' + e.message);
    }
  }
  function refreshCurrentScreen() {
    if (state.user && state.currentScreen) goToScreen(state.currentScreen);
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 2500);
  }

  // ---------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------

  async function api(path, options = {}) {
    const headers = Object.assign({}, options.headers || {});
    if (state.user) headers['X-User-Id'] = state.user.id;
    if (options.body) headers['Content-Type'] = 'application/json';

    // Запись (POST/PATCH/DELETE) ждём не дольше 20 секунд, чтение — 30
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), options.method && options.method !== 'GET' ? 20000 : 30000) : null;
    let res;
    try {
      res = await fetch(path, Object.assign({}, options, { headers }, ctrl ? { signal: ctrl.signal } : {}));
    } catch (e) {
      const err = new Error(navigator.onLine === false
        ? 'Нет интернета'
        : 'Нет связи с сервером (сервер не ответил)');
      err.network = true;
      setNetProblem(true);
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    setNetProblem(false);
    let data = null;
    try { data = await res.json(); } catch (e) { /* пусто (например, CSV) */ }
    if (!res.ok) {
      const message = (data && data.error) || `Ошибка запроса (${res.status})`;
      throw new Error(message);
    }
    return data;
  }

  // ---------------------------------------------------------------------
  // Состояние
  // ---------------------------------------------------------------------

  const state = {
    user: null,
    categoryGroups: [],   // [{id, name, categories:[{id,name}]}]
    modal: { categoryId: null, categoryName: null, amount: '', date: '', comment: '' },
    currentScreen: 'home',
    reportTab: 'operations'
  };

  // ---------------------------------------------------------------------
  // Экран входа
  // ---------------------------------------------------------------------

  async function renderLogin() {
    document.getElementById('screen-login').classList.remove('hidden');
    document.getElementById('app').classList.add('hidden');

    const list = document.getElementById('name-list');
    list.innerHTML = '<div class="field-label">Загрузка...</div>';

    const users = await api('/api/users');
    list.innerHTML = '';
    users.forEach((u) => {
      const btn = document.createElement('button');
      btn.className = 'name-btn';
      btn.textContent = u.name;
      btn.addEventListener('click', () => selectUser(u));
      list.appendChild(btn);
    });
  }

  async function selectUser(u) {
    const full = await api(`/api/users/me?userId=${u.id}`);
    state.user = full;
    saveCurrentUser(full);
    await startApp();
  }

  // ---------------------------------------------------------------------
  // Запуск приложения
  // ---------------------------------------------------------------------

  async function startApp() {
    document.getElementById('screen-login').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('header-user').textContent = state.user.name;

    try {
      await loadCategories();
    } catch (e) {
      if (!e.network) showToast(e.message);
    }
    goToScreen('home');
  }

  async function loadCategories() {
    try {
      state.categoryGroups = await api('/api/categories');
      try { localStorage.setItem('expenseCategories', JSON.stringify(state.categoryGroups)); } catch (e) { /* ничего */ }
    } catch (e) {
      // Без связи — категории из прошлой загрузки, чтобы расход можно было записать в очередь
      try { state.categoryGroups = JSON.parse(localStorage.getItem('expenseCategories') || '[]'); } catch (x) { state.categoryGroups = []; }
      if (!state.categoryGroups.length) throw e;
    }

    // Фильтр по разделу/категории (экран «Расходы»)
    const groupSel = document.getElementById('f-group');
    const catSel = document.getElementById('f-category');
    groupSel.innerHTML = '<option value="">Все разделы</option>' +
      state.categoryGroups.map((g) => `<option value="${g.id}">${g.name}</option>`).join('');
    function refreshCatSelect(groupId) {
      const groups = groupId ? state.categoryGroups.filter((g) => String(g.id) === String(groupId)) : state.categoryGroups;
      const opts = [];
      groups.forEach((g) => g.categories.forEach((c) => opts.push(`<option value="${c.id}">${c.name}</option>`)));
      catSel.innerHTML = '<option value="">Все категории</option>' + opts.join('');
    }
    refreshCatSelect('');
    groupSel.onchange = () => { refreshCatSelect(groupSel.value); loadExpensesScreen(); };

    // Пользователи для фильтра
    const users = await api('/api/users');
    const userSel = document.getElementById('f-user');
    userSel.innerHTML = '<option value="">Все пользователи</option>' +
      users.map((u) => `<option value="${u.id}">${u.name}</option>`).join('');
  }

  // ---------------------------------------------------------------------
  // Навигация
  // ---------------------------------------------------------------------

  function goToScreen(name) {
    state.currentScreen = name;
    ['home', 'expenses', 'reports', 'profile'].forEach((s) => {
      document.getElementById(`screen-${s}`).classList.toggle('hidden', s !== name);
    });
    document.querySelectorAll('.bottom-nav button').forEach((b) => {
      b.classList.toggle('active', b.dataset.screen === name);
    });
    const titles = { home: 'Главная', expenses: 'Расходы', reports: 'Отчёты', profile: 'Профиль' };
    document.getElementById('header-title').textContent = titles[name];

    const loaders = { home: loadHomeScreen, expenses: loadExpensesScreen, reports: loadReportsScreen, profile: loadProfileScreen };
    Promise.resolve().then(loaders[name]).catch((e) => {
      if (!e.network) showToast(e.message);
    });
    renderNetBanner();
    renderPendingBanner();
  }

  document.querySelectorAll('.bottom-nav button').forEach((b) => {
    b.addEventListener('click', () => goToScreen(b.dataset.screen));
  });

  // ---------------------------------------------------------------------
  // Главная
  // ---------------------------------------------------------------------

  async function loadHomeScreen() {
    const now = new Date();
    const today = toISODate(now);
    const monthStart = toISODate(new Date(now.getFullYear(), now.getMonth(), 1));

    const [summary, recent] = await Promise.all([
      api(`/api/expenses/summary?today=${today}&monthStart=${monthStart}`),
      api('/api/expenses/recent?limit=10')
    ]);

    document.getElementById('sum-today').textContent = formatMoney(summary.today_sum);
    document.getElementById('sum-month').textContent = formatMoney(summary.month_sum);

    const list = document.getElementById('recent-list');
    list.innerHTML = recent.length ? recent.map(expenseCardHtml).join('') :
      '<div class="field-label">Расходов пока нет</div>';
  }

  // Все показанные расходы по id — для окна «Исправить»
  const shownExpenses = {};

  function expenseCardHtml(e, opts = {}) {
    shownExpenses[e.id] = e;
    const isAdmin = state.user && state.user.is_admin;
    const canDelete = opts.deletable && isAdmin;
    const canEdit = (opts.deletable || opts.editable) && isAdmin;
    return `
      <div class="expense-card">
        <div class="main">
          <div class="category">${e.from_personal_cash ? '💵 ' : ''}${escapeHtml(e.category_name)}</div>
          <div class="meta">${formatDateRu(e.expense_date)} · ${escapeHtml(e.group_name)} · ${escapeHtml(e.user_name)}</div>
          ${e.comment ? `<div class="comment">${escapeHtml(e.comment)}</div>` : ''}
        </div>
        <div class="actions">
          <div class="amount">${formatMoney(e.amount)}</div>
          ${opts.markCash && isAdmin ? `<button class="mark-cash-btn" data-mark-cash="${e.id}">💵 Из моих</button>` : ''}
          <div>
            ${canEdit ? `<button class="expense-edit-btn" data-edit-expense="${e.id}" title="Исправить">✎</button>` : ''}
            ${canDelete ? `<button class="expense-delete-btn" data-delete-expense="${e.id}" title="Удалить">✕</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  // Кнопки на карточках расходов: удалить, исправить, «💵 Из моих»
  function wireExpenseDeleteButtons(container, onDone) {
    container.querySelectorAll('[data-delete-expense]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить эту запись расхода? Действие необратимо.')) return;
        try {
          await api(`/api/expenses/${btn.dataset.deleteExpense}`, { method: 'DELETE' });
          showToast('Запись удалена');
          onDone();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
    container.querySelectorAll('[data-edit-expense]').forEach((btn) => {
      btn.addEventListener('click', () => openEditModal(shownExpenses[btn.dataset.editExpense], onDone));
    });
    container.querySelectorAll('[data-mark-cash]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const e = shownExpenses[btn.dataset.markCash];
        if (!confirm(`Списать с баланса: ${e.category_name}, ${formatMoney(e.amount)}?`)) return;
        try {
          const upd = await api(`/api/expenses/${e.id}`, { method: 'PATCH', body: JSON.stringify({ from_personal_cash: true }) });
          if (!upd.from_personal_cash) throw new Error('Отметка не сохранилась — сообщите разработчику');
          showToast('Списано с баланса');
          onDone();
        } catch (err) {
          showToast(err.message);
        }
      });
    });
  }

  // ---------------------------------------------------------------------
  // Исправление расхода (администратор)
  // ---------------------------------------------------------------------

  let editState = null;

  function openEditModal(e, onDone) {
    if (!e) return;
    editState = { id: e.id, onDone };
    const sel = document.getElementById('edit-category');
    sel.innerHTML = state.categoryGroups.map((g) => `
      <optgroup label="${escapeHtml(g.name)}">
        ${g.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
      </optgroup>`).join('');
    if (!sel.querySelector(`option[value="${e.category_id}"]`)) {
      sel.insertAdjacentHTML('afterbegin', `<option value="${e.category_id}">${escapeHtml(e.category_name)}</option>`);
    }
    sel.value = String(e.category_id);
    document.getElementById('edit-amount').value = Number(e.amount);
    document.getElementById('edit-date').value = String(e.expense_date).slice(0, 10);
    document.getElementById('edit-comment').value = e.comment || '';
    document.getElementById('edit-from-cash').checked = !!e.from_personal_cash;
    document.getElementById('modal-edit').classList.remove('hidden');
  }

  function closeEditModal() {
    document.getElementById('modal-edit').classList.add('hidden');
    editState = null;
  }

  document.getElementById('btn-close-edit').addEventListener('click', closeEditModal);
  document.getElementById('modal-edit').addEventListener('click', (ev) => {
    if (ev.target.id === 'modal-edit') closeEditModal();
  });

  document.getElementById('btn-save-edit').addEventListener('click', async () => {
    if (!editState) return;
    const amount = parseFloat(String(document.getElementById('edit-amount').value).replace(',', '.'));
    if (!amount || amount <= 0) { showToast('Укажите сумму больше нуля'); return; }
    const wantCash = document.getElementById('edit-from-cash').checked;
    const btn = document.getElementById('btn-save-edit');
    btn.disabled = true;
    try {
      const upd = await api(`/api/expenses/${editState.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          category_id: Number(document.getElementById('edit-category').value),
          amount,
          expense_date: document.getElementById('edit-date').value,
          comment: document.getElementById('edit-comment').value,
          from_personal_cash: wantCash
        })
      });
      if (upd.from_personal_cash !== wantCash) throw new Error('Отметка «из моих» не сохранилась — сообщите разработчику');
      const onDone = editState.onDone;
      closeEditModal();
      showToast(upd.changed && upd.changed.length ? 'Исправлено' : 'Изменений нет');
      if (onDone) onDone();
    } catch (err) {
      showToast(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ---------------------------------------------------------------------
  // Расходы
  // ---------------------------------------------------------------------

  function wireExpensesFilters() {
    const period = document.getElementById('f-period');
    const customBox = document.getElementById('f-custom-dates');
    period.onchange = () => {
      customBox.classList.toggle('hidden', period.value !== 'custom');
      loadExpensesScreen();
    };
    document.getElementById('f-category').onchange = loadExpensesScreen;
    document.getElementById('f-user').onchange = loadExpensesScreen;
    document.getElementById('f-date-from').onchange = loadExpensesScreen;
    document.getElementById('f-date-to').onchange = loadExpensesScreen;
  }

  async function loadExpensesScreen() {
    const period = document.getElementById('f-period').value;
    const params = new URLSearchParams();

    if (period && period !== 'custom') {
      const { from, to } = periodToRange(period);
      params.set('date_from', from);
      params.set('date_to', to);
    } else if (period === 'custom') {
      const from = document.getElementById('f-date-from').value;
      const to = document.getElementById('f-date-to').value;
      if (from) params.set('date_from', from);
      if (to) params.set('date_to', to);
    }

    const groupId = document.getElementById('f-group').value;
    const categoryId = document.getElementById('f-category').value;
    const userId = document.getElementById('f-user').value;
    if (groupId) params.set('group_id', groupId);
    if (categoryId) params.set('category_id', categoryId);
    if (userId) params.set('user_id', userId);
    params.set('limit', '500');

    const rows = await api(`/api/expenses?${params.toString()}`);
    const isAdmin = state.user && state.user.is_admin;

    const cardsBox = document.getElementById('expenses-cards');
    cardsBox.innerHTML = rows.length ? rows.map((e) => expenseCardHtml(e, { deletable: true })).join('') :
      '<div class="field-label">Ничего не найдено</div>';
    wireExpenseDeleteButtons(cardsBox, loadExpensesScreen);

    const tbody = document.getElementById('expenses-table-body');
    tbody.innerHTML = rows.map((e) => `
      <tr>
        <td>${formatDateRu(e.expense_date)}</td>
        <td>${e.group_name}</td>
        <td>${e.from_personal_cash ? '💵 ' : ''}${e.category_name}</td>
        <td>${formatMoney(e.amount)}</td>
        <td>${e.comment ? escapeHtml(e.comment) : ''}</td>
        <td>${e.user_name}</td>
        <td>${isAdmin ? `<button class="expense-edit-btn" data-edit-expense="${e.id}" title="Исправить">✎</button><button class="expense-delete-btn" data-delete-expense="${e.id}" title="Удалить">✕</button>` : ''}</td>
      </tr>`).join('');
    wireExpenseDeleteButtons(tbody, loadExpensesScreen);
  }

  // ---------------------------------------------------------------------
  // Отчёты
  // ---------------------------------------------------------------------

  function wireReportsControls() {
    document.querySelectorAll('.tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.tabs button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        state.reportTab = b.dataset.tab;
        loadReportsScreen();
      });
    });
    const period = document.getElementById('r-period');
    const customBox = document.getElementById('r-custom-dates');
    period.onchange = () => {
      customBox.classList.toggle('hidden', period.value !== 'custom');
      loadReportsScreen();
    };
    document.getElementById('r-date-from').onchange = loadReportsScreen;
    document.getElementById('r-date-to').onchange = loadReportsScreen;
  }

  function currentReportRange() {
    const period = document.getElementById('r-period').value;
    if (period === 'custom') {
      return {
        from: document.getElementById('r-date-from').value,
        to: document.getElementById('r-date-to').value
      };
    }
    return periodToRange(period);
  }

  async function loadReportsScreen() {
    const { from, to } = currentReportRange();
    const params = new URLSearchParams();
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);

    const body = document.getElementById('report-body');
    const exportLink = document.getElementById('export-link');

    if (state.reportTab === 'operations') {
      const rows = await api(`/api/reports/operations?${params.toString()}`);
      body.innerHTML = rows.length ? rows.map(expenseCardHtml).join('') : '<div class="field-label">Нет данных за период</div>';
      params.set('type', 'operations');
    } else if (state.reportTab === 'by-category') {
      const rows = await api(`/api/reports/by-category?${params.toString()}`);
      const groups = {};
      let total = 0, count = 0;
      rows.forEach((r) => {
        groups[r.group_name] = groups[r.group_name] || [];
        groups[r.group_name].push(r);
        total += r.total;
        count += r.count;
      });
      body.innerHTML = Object.keys(groups).map((gName) => `
        <div class="group-report">
          <h3>${gName}</h3>
          ${groups[gName].map((r) => `
            <div class="report-row">
              <span>${r.category_name} <span class="count">(${r.count})</span></span>
              <span>${formatMoney(r.total)}</span>
            </div>`).join('')}
        </div>`).join('') +
        `<div class="report-total"><span>Итого (${count})</span><span>${formatMoney(total)}</span></div>`;
      if (!rows.length) body.innerHTML = '<div class="field-label">Нет данных за период</div>';
      params.set('type', 'by-category');
    } else {
      const rows = await api(`/api/reports/by-user?${params.toString()}`);
      let total = 0, count = 0;
      body.innerHTML = rows.map((r) => {
        total += r.total; count += r.count;
        return `
          <div class="report-row">
            <span>${r.user_name} <span class="count">(${r.count})</span></span>
            <span>${formatMoney(r.total)}</span>
          </div>`;
      }).join('') + (rows.length ? `<div class="report-total"><span>Итого (${count})</span><span>${formatMoney(total)}</span></div>` : '<div class="field-label">Нет данных за период</div>');
      params.set('type', 'by-user');
    }

    exportLink.href = `/api/reports/export?${params.toString()}`;
  }

  // ---------------------------------------------------------------------
  // Профиль / администрирование
  // ---------------------------------------------------------------------

  async function loadProfileScreen() {
    document.getElementById('profile-name').textContent = state.user.name;
    document.getElementById('profile-badge').textContent = state.user.is_admin ? 'Администратор' : 'Пользователь';
    document.getElementById('profile-badge').classList.toggle('admin', state.user.is_admin);

    const adminBlock = document.getElementById('admin-block');
    adminBlock.classList.toggle('hidden', !state.user.is_admin);
    if (!state.user.is_admin) return;
    const balanceDone = loadBalanceBlock(); // баланс первым и независимо от остального

    const users = await api('/api/users/admin/all');
    document.getElementById('admin-users-list').innerHTML = users.map((u) => `
      <div class="list-row">
        <div>${u.name} ${u.is_admin ? '<span class="badge admin">админ</span>' : ''} ${!u.is_active ? '<span class="badge">выключен</span>' : ''}</div>
        <button class="btn-secondary" data-toggle-user="${u.id}" data-active="${u.is_active}" style="width:auto;padding:8px 12px;margin:0;">
          ${u.is_active ? 'Выключить' : 'Включить'}
        </button>
      </div>`).join('');

    document.querySelectorAll('[data-toggle-user]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.toggleUser;
        const active = btn.dataset.active === 'true';
        await api(`/api/users/admin/${id}`, { method: 'PATCH', body: JSON.stringify({ is_active: !active }) });
        loadProfileScreen();
      });
    });

    const catGroups = await api('/api/categories?all=1');
    document.getElementById('admin-categories-list').innerHTML = catGroups.map((g) => `
      <div style="margin-bottom:10px;">
        <div class="field-label" style="margin-bottom:6px;">${g.name}</div>
        ${g.categories.map((c) => `
          <div class="list-row">
            <span>${c.name} ${!c.is_active ? '<span class="badge">скрыта</span>' : ''}</span>
            <span>
              <button class="btn-secondary" data-rename-cat="${c.id}" data-name="${escapeHtml(c.name)}" style="width:auto;padding:6px 10px;margin:0;">✎</button>
              <button class="btn-secondary btn-danger" data-delete-cat="${c.id}" style="width:auto;padding:6px 10px;margin:0;">✕</button>
            </span>
          </div>`).join('')}
      </div>`).join('');

    document.querySelectorAll('[data-rename-cat]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const name = prompt('Новое название категории:', btn.dataset.name);
        if (!name || !name.trim()) return;
        await api(`/api/categories/${btn.dataset.renameCat}`, { method: 'PATCH', body: JSON.stringify({ name: name.trim() }) });
        await loadCategories();
        loadProfileScreen();
      });
    });
    document.querySelectorAll('[data-delete-cat]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Удалить категорию?')) return;
        await api(`/api/categories/${btn.dataset.deleteCat}`, { method: 'DELETE' });
        await loadCategories();
        loadProfileScreen();
      });
    });

    await balanceDone;
  }

  // Личный баланс наличных (только для администратора)
  async function loadBalanceBlock() {
    const amountEl = document.getElementById('balance-amount');
    const statusEl = document.getElementById('balance-status');
    amountEl.textContent = '…';
    statusEl.className = 'field-label';
    statusEl.textContent = 'Загружаю…';
    try {
      await loadBalanceBlockData();
      const now = new Date();
      const pending = loadPending();
      statusEl.className = pending.length ? 'balance-status bad' : 'balance-status ok';
      statusEl.textContent = pending.length
        ? `⚠️ Есть несохранённые расходы (${pending.length}) — в балансе их нет. Отправьте их (красный список сверху).`
        : `✓ Актуально на ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
    } catch (e) {
      amountEl.textContent = '— ₽';
      document.getElementById('balance-detail').textContent = '';
      statusEl.className = 'balance-status bad';
      statusEl.textContent = `❌ Баланс не загрузился: ${e.message}. Не опирайтесь на старые цифры — обновите экран, когда появится связь.`;
    }
  }

  async function loadBalanceBlockData() {
    const from14 = new Date();
    from14.setDate(from14.getDate() - 13);
    const [summary, entries, spent, unmarked] = await Promise.all([
      api('/api/balance/summary'),
      api('/api/balance/entries?limit=15'),
      api('/api/expenses?from_personal_cash=1&limit=30'),
      api(`/api/expenses?from_personal_cash=0&user_id=${state.user.id}&date_from=${toISODate(from14)}&limit=50`)
    ]);

    state.lastBalance = summary.balance;
    document.getElementById('balance-amount').textContent = formatMoney(summary.balance);
    document.getElementById('balance-detail').textContent =
      `Внесено (приходы и корректировки): ${formatMoney(summary.income_total)} · Расходы из наличных: ${formatMoney(summary.expenses_total)}`;

    // Списано с баланса — последние 30 расходов с отметкой «из личных»
    const spentBox = document.getElementById('balance-spent-list');
    document.getElementById('balance-spent-total').textContent = spent.length
      ? `Последние ${spent.length}: ${formatMoney(spent.reduce((s, e) => s + Number(e.amount), 0))}`
      : '';
    spentBox.innerHTML = spent.length ? spent.map((e) => expenseCardHtml(e, { editable: true })).join('')
      : '<div class="field-label">Пока ничего не списано</div>';
    wireExpenseDeleteButtons(spentBox, loadBalanceBlock);

    // Мои расходы за 14 дней без отметки — можно списать одной кнопкой
    const unmarkedBox = document.getElementById('balance-unmarked-list');
    unmarkedBox.innerHTML = unmarked.length ? unmarked.map((e) => expenseCardHtml(e, { editable: true, markCash: true })).join('')
      : '<div class="field-label">Нет</div>';
    wireExpenseDeleteButtons(unmarkedBox, loadBalanceBlock);

    const list = document.getElementById('balance-income-list');
    list.innerHTML = entries.length ? entries.map((en) => `
      <div class="list-row">
        <span>${formatDateRu(en.entry_date)}${en.comment ? ' · ' + escapeHtml(en.comment) : ''}</span>
        <span>${en.amount >= 0 ? '+' : ''}${formatMoney(en.amount)}</span>
      </div>`).join('') : '<div class="field-label">Записей пока нет</div>';
  }

  document.getElementById('btn-switch-user').addEventListener('click', () => {
    if (!confirm('Выбрать другого пользователя на этом устройстве?')) return;
    clearStoredUser();
    state.user = null;
    location.reload();
  });

  document.getElementById('btn-add-user').addEventListener('click', async () => {
    const name = prompt('Имя нового пользователя:');
    if (!name || !name.trim()) return;
    await api('/api/users/admin', { method: 'POST', body: JSON.stringify({ name: name.trim() }) });
    loadProfileScreen();
  });

  document.getElementById('btn-add-category').addEventListener('click', async () => {
    const groups = state.categoryGroups;
    const groupNames = groups.map((g, i) => `${i + 1}) ${g.name}`).join('\n');
    const groupIdx = prompt(`Номер раздела:\n${groupNames}`);
    const idx = parseInt(groupIdx, 10) - 1;
    if (isNaN(idx) || !groups[idx]) return;
    const name = prompt('Название новой категории:');
    if (!name || !name.trim()) return;
    await api('/api/categories', { method: 'POST', body: JSON.stringify({ name: name.trim(), group_id: groups[idx].id }) });
    await loadCategories();
    loadProfileScreen();
  });

  document.getElementById('btn-add-income').addEventListener('click', async () => {
    const amountRaw = prompt('Сумма прихода, ₽:');
    if (!amountRaw) return;
    const amount = parseFloat(amountRaw.replace(',', '.'));
    if (!amount || amount <= 0) { showToast('Укажите сумму больше нуля'); return; }
    const comment = prompt('Комментарий (необязательно):') || '';
    try {
      await api('/api/balance/entries', { method: 'POST', body: JSON.stringify({ amount, comment }) });
      loadProfileScreen();
    } catch (e) {
      showToast(e.message);
    }
  });

  document.getElementById('btn-adjust-balance').addEventListener('click', async () => {
    try {
      const summary = await api('/api/balance/summary');
      const raw = prompt(`Сейчас в приложении баланс: ${formatMoney(summary.balance)}\nВведите фактический остаток на сегодня, ₽:`);
      if (raw === null || raw.trim() === '') return;
      const actual = parseFloat(raw.replace(',', '.'));
      if (isNaN(actual)) { showToast('Введите число'); return; }

      const diff = Math.round((actual - summary.balance) * 100) / 100;
      if (diff === 0) { showToast('Баланс уже совпадает, ничего не меняем'); return; }

      await api('/api/balance/entries', {
        method: 'POST',
        body: JSON.stringify({ amount: diff, comment: `Корректировка остатка на ${toISODate(new Date())}` })
      });
      loadProfileScreen();
    } catch (e) {
      showToast(e.message);
    }
  });

  // ---------------------------------------------------------------------
  // Модалка добавления расхода
  // ---------------------------------------------------------------------

  function resetCashCheckbox() {
    const row = document.getElementById('cash-checkbox-row');
    const box = document.getElementById('input-from-cash');
    box.checked = false;
    row.classList.toggle('hidden', !(state.user && state.user.is_admin));
  }

  function openExpenseModal() {
    if (!state.categoryGroups.length) loadCategories().then(renderCategoryPicker).catch(() => {});
    state.modal = { categoryId: null, categoryName: null, amount: '', date: toISODate(new Date()), comment: '', clientId: newClientId() };
    document.getElementById('save-error').classList.add('hidden');
    document.getElementById('input-amount').value = '';
    document.getElementById('input-comment').value = '';
    document.getElementById('input-date').value = state.modal.date;
    resetCashCheckbox();
    renderCategoryPicker();
    showModalStep(1);
    document.getElementById('modal-expense').classList.remove('hidden');
  }

  function closeExpenseModal() {
    document.getElementById('modal-expense').classList.add('hidden');
  }

  function renderCategoryPicker() {
    const box = document.getElementById('modal-category-groups');
    box.innerHTML = state.categoryGroups.map((g) => `
      <div class="group-block">
        <h3>${g.name}</h3>
        <div class="category-grid">
          ${g.categories.map((c) => `<button class="category-btn" data-cat-id="${c.id}" data-cat-name="${escapeHtml(c.name)}">${c.name}</button>`).join('')}
        </div>
      </div>`).join('');

    box.querySelectorAll('.category-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.modal.categoryId = btn.dataset.catId;
        state.modal.categoryName = btn.dataset.catName;
        showModalStep(2);
        setTimeout(() => document.getElementById('input-amount').focus(), 100);
      });
    });
  }

  function showModalStep(n) {
    for (let i = 1; i <= 4; i++) {
      document.getElementById(`step-${i}`).classList.toggle('hidden', i !== n);
    }
    document.getElementById('step-confirm').classList.add('hidden');
    document.querySelectorAll('.step-dots span').forEach((dot) => {
      dot.classList.toggle('active', Number(dot.dataset.step) === n);
    });
  }

  document.getElementById('btn-add-expense').addEventListener('click', openExpenseModal);
  document.getElementById('btn-close-modal').addEventListener('click', closeExpenseModal);

  document.getElementById('btn-amount-next').addEventListener('click', () => {
    const val = parseFloat(document.getElementById('input-amount').value.replace(',', '.'));
    const err = document.getElementById('amount-error');
    if (!val || val <= 0) { err.classList.remove('hidden'); return; }
    err.classList.add('hidden');
    state.modal.amount = val;
    showModalStep(3);
  });

  document.getElementById('btn-date-next').addEventListener('click', () => {
    state.modal.date = document.getElementById('input-date').value || toISODate(new Date());
    showModalStep(4);
  });

  document.getElementById('btn-save-expense').addEventListener('click', async () => {
    state.modal.comment = document.getElementById('input-comment').value.trim();
    const fromCash = document.getElementById('input-from-cash').checked;
    const btn = document.getElementById('btn-save-expense');
    const errBox = document.getElementById('save-error');
    errBox.classList.add('hidden');
    if (!state.modal.clientId) state.modal.clientId = newClientId();
    const item = {
      client_id: state.modal.clientId,
      category_id: state.modal.categoryId,
      category_name: state.modal.categoryName,
      amount: state.modal.amount,
      expense_date: state.modal.date,
      comment: state.modal.comment,
      from_personal_cash: fromCash
    };
    // Сначала — на телефон: если связь оборвётся или приложение закроют, расход не потеряется
    addPending(item);
    btn.disabled = true;
    btn.textContent = 'Сохраняю…';
    try {
      const saved = await postExpense(item);
      document.getElementById('confirm-text').textContent =
        `${state.modal.categoryName}, ${formatMoney(state.modal.amount)}`;
      // Проверка списания: показываем, что сохранилось на сервере, а не что отмечено
      const cashBox = document.getElementById('confirm-cash');
      cashBox.className = 'confirm-cash hidden';
      if (fromCash && !saved.from_personal_cash) {
        cashBox.className = 'confirm-cash bad';
        cashBox.textContent = '⚠️ С баланса НЕ списано. Откройте Профиль → «Мои расходы без отметки» и нажмите «💵 Из моих».';
      } else if (saved.from_personal_cash) {
        cashBox.className = 'confirm-cash ok';
        cashBox.textContent = '💵 Списано с баланса';
        api('/api/balance/summary').then((sm) => {
          cashBox.textContent = `💵 Списано с баланса. Остаток: ${formatMoney(sm.balance)}`;
        }).catch(() => { cashBox.textContent = '💵 Списано с баланса (остаток не загрузился — смотрите в Профиле)'; });
      }
      for (let i = 1; i <= 4; i++) document.getElementById(`step-${i}`).classList.add('hidden');
      document.getElementById('step-confirm').classList.remove('hidden');
      if (state.currentScreen === 'home') loadHomeScreen().catch(() => {});
    } catch (e) {
      if (!e.network) removePending(item.client_id); // сервер отказал (например, нет прав) — повтор не поможет
      errBox.innerHTML = e.network
        ? `❌ Сервер НЕ подтвердил сохранение: ${escapeHtml(e.message)}.<br>Считайте, что расхода в программе нет. Он ждёт на телефоне в красном списке сверху — когда появится связь, нажмите «Сохранить расход» ещё раз или «Отправить» в списке. Дубля не будет.`
        : `❌ Расход НЕ сохранён: ${escapeHtml(e.message)}`;
      errBox.classList.remove('hidden');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Сохранить расход';
    }
  });

  document.getElementById('btn-add-more').addEventListener('click', () => {
    state.modal = { categoryId: null, categoryName: null, amount: '', date: toISODate(new Date()), comment: '', clientId: newClientId() };
    document.getElementById('save-error').classList.add('hidden');
    document.getElementById('input-amount').value = '';
    document.getElementById('input-comment').value = '';
    document.getElementById('input-date').value = state.modal.date;
    resetCashCheckbox();
    renderCategoryPicker();
    showModalStep(1);
  });

  document.getElementById('btn-done').addEventListener('click', () => {
    closeExpenseModal();
    if (state.currentScreen === 'expenses') loadExpensesScreen();
    if (state.currentScreen === 'reports') loadReportsScreen();
  });

  document.getElementById('modal-expense').addEventListener('click', (e) => {
    if (e.target.id === 'modal-expense') closeExpenseModal();
  });

  // ---------------------------------------------------------------------
  // Инициализация
  // ---------------------------------------------------------------------

  wireExpensesFilters();
  wireReportsControls();

  (async function init() {
    const stored = loadStoredUser();
    if (!stored) {
      await renderLogin();
      return;
    }
    try {
      const fresh = await api(`/api/users/me?userId=${stored.id}`);
      state.user = fresh;
      saveCurrentUser(fresh);
    } catch (e) {
      if (!e.network) {
        // Сервер ответил, что пользователя нет или он выключен — выбрать заново
        clearStoredUser();
        await renderLogin();
        return;
      }
      // Нет связи: открываемся под сохранённым пользователем, красная плашка сверху
      state.user = stored;
    }
    await startApp();
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    });
  }
})();
