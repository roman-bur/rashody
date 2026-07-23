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
    const [y, m, d] = iso.split('-');
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

    const res = await fetch(path, Object.assign({}, options, { headers }));
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

    await loadCategories();
    goToScreen('home');
  }

  async function loadCategories() {
    state.categoryGroups = await api('/api/categories');

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

    if (name === 'home') loadHomeScreen();
    if (name === 'expenses') loadExpensesScreen();
    if (name === 'reports') loadReportsScreen();
    if (name === 'profile') loadProfileScreen();
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

  function expenseCardHtml(e) {
    return `
      <div class="expense-card">
        <div class="main">
          <div class="category">${e.category_name}</div>
          <div class="meta">${formatDateRu(e.expense_date)} · ${e.group_name} · ${e.user_name}</div>
          ${e.comment ? `<div class="comment">${escapeHtml(e.comment)}</div>` : ''}
        </div>
        <div class="amount">${formatMoney(e.amount)}</div>
      </div>`;
  }

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

    const cardsBox = document.getElementById('expenses-cards');
    cardsBox.innerHTML = rows.length ? rows.map(expenseCardHtml).join('') :
      '<div class="field-label">Ничего не найдено</div>';

    const tbody = document.getElementById('expenses-table-body');
    tbody.innerHTML = rows.map((e) => `
      <tr>
        <td>${formatDateRu(e.expense_date)}</td>
        <td>${e.group_name}</td>
        <td>${e.category_name}</td>
        <td>${formatMoney(e.amount)}</td>
        <td>${e.comment ? escapeHtml(e.comment) : ''}</td>
        <td>${e.user_name}</td>
      </tr>`).join('');
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
      body.innerHTML = rows.length ? rows.map((e) => `
        <div class="expense-card">
          <div class="main">
            <div class="category">${e.category_name}</div>
            <div class="meta">${formatDateRu(e.expense_date)} · ${e.group_name} · ${e.user_name}</div>
            ${e.comment ? `<div class="comment">${escapeHtml(e.comment)}</div>` : ''}
          </div>
          <div class="amount">${formatMoney(e.amount)}</div>
        </div>`).join('') : '<div class="field-label">Нет данных за период</div>';
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

  // ---------------------------------------------------------------------
  // Модалка добавления расхода
  // ---------------------------------------------------------------------

  function openExpenseModal() {
    state.modal = { categoryId: null, categoryName: null, amount: '', date: toISODate(new Date()), comment: '' };
    document.getElementById('input-amount').value = '';
    document.getElementById('input-comment').value = '';
    document.getElementById('input-date').value = state.modal.date;
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
    const btn = document.getElementById('btn-save-expense');
    btn.disabled = true;
    try {
      await api('/api/expenses', {
        method: 'POST',
        body: JSON.stringify({
          category_id: state.modal.categoryId,
          amount: state.modal.amount,
          expense_date: state.modal.date,
          comment: state.modal.comment
        })
      });
      document.getElementById('confirm-text').textContent =
        `${state.modal.categoryName}, ${formatMoney(state.modal.amount)}`;
      for (let i = 1; i <= 4; i++) document.getElementById(`step-${i}`).classList.add('hidden');
      document.getElementById('step-confirm').classList.remove('hidden');
      if (state.currentScreen === 'home') loadHomeScreen();
    } catch (e) {
      showToast(e.message);
    } finally {
      btn.disabled = false;
    }
  });

  document.getElementById('btn-add-more').addEventListener('click', () => {
    state.modal = { categoryId: null, categoryName: null, amount: '', date: toISODate(new Date()), comment: '' };
    document.getElementById('input-amount').value = '';
    document.getElementById('input-comment').value = '';
    document.getElementById('input-date').value = state.modal.date;
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
      await startApp();
    } catch (e) {
      clearStoredUser();
      await renderLogin();
    }
  })();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/service-worker.js').catch(() => {});
    });
  }
})();
