(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const API = 'https://nusuk-key-api.ali-mohamed2823.workers.dev';
  const LINK = 'https://services.nusuk.sa/app?p=27&id=';
  const hiddenKey = 'nusuk_keys_hidden_v3'; // reset old hidden state once
  const tokenKey = 'nusuk_admin_token_v1';

  let allCodes = [];
  let normalOffset = 0;
  let hasMore = false;
  let loadingMore = false;
  let loadToken = 0;
  let totalCodesCount = 0;
  let todayCodesCount = 0;
  let searchTimer = null;
  let adminToken = sessionStorage.getItem(tokenKey) || '';
  let hidden = new Set();

  const pageSize = 30;
  const valid = s => /^NG-[A-Za-z0-9]{8}$/.test(s);

  try {
    hidden = new Set(JSON.parse(localStorage.getItem(hiddenKey) || '[]'));
  } catch {}

  async function api(path, options = {}, admin = false) {
    const headers = { ...(options.headers || {}) };
    if (options.body && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
    if (admin && adminToken) {
      headers.Authorization = 'Bearer ' + adminToken;
    }

    const response = await fetch(API + path, { ...options, headers });
    let data = {};
    try { data = await response.json(); } catch {}

    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function message(text, type = 'error') {
    const el = $('submitResult');
    if (!el) return;
    el.className = 'result ' + type;
    el.textContent = text;
  }

  function toast(text) {
    const el = $('toast');
    if (!el) return;
    el.textContent = text;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }

  function saveHidden() {
    localStorage.setItem(hiddenKey, JSON.stringify([...hidden]));
  }

  function hide(code) {
    hidden.add(code);
    saveHidden();
  }

  function updateStats() {
    const visible = allCodes.filter(c => c.is_pinned || !hidden.has(c.code));
    if ($('totalCount')) $('totalCount').textContent = totalCodesCount.toLocaleString('en-US');
    if ($('todayCount')) $('todayCount').textContent = todayCodesCount.toLocaleString('en-US');
    if ($('usedCount')) $('usedCount').textContent = hidden.size.toLocaleString('en-US');
    if ($('shownCount')) $('shownCount').textContent = visible.length.toLocaleString('en-US');
  }

  function setTab(tab) {
    document.querySelectorAll('.tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    if ($('codesPanel')) $('codesPanel').hidden = tab !== 'codes';
    if ($('sharePanel')) $('sharePanel').hidden = tab !== 'share';
    if ($('adminPanel')) $('adminPanel').hidden = true;
  }

  function card(c) {
    const el = document.createElement('article');
    el.className = 'code-card' + (c.is_pinned ? ' pinned' : '');

    const top = document.createElement('div');
    top.className = 'code-top';

    const label = document.createElement('span');
    label.className = 'code-label';
    label.textContent = c.is_pinned ? 'مفتاح مثبت' : 'مفتاح مشاركة';
    top.append(label);

    if (c.is_pinned) {
      const badge = document.createElement('span');
      badge.className = 'pin-badge';
      badge.textContent = 'مميز';
      top.append(badge);
    }

    const code = document.createElement('span');
    code.className = 'code-value';
    code.textContent = c.code;
    el.append(top, code);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const open = document.createElement('button');
    open.className = 'open-btn';
    open.textContent = '↗ فتح في نسك';
    open.onclick = () => {
      hide(c.code);
      updateStats();
      render();
      window.open(LINK + encodeURIComponent(c.code), '_blank', 'noopener');
    };

    const copy = document.createElement('button');
    copy.className = 'copy-btn';
    copy.textContent = '▢ نسخ';
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(c.code);
        hide(c.code);
        el.remove(); // إخفاء البطاقة المنسوخة فقط دون إعادة رسم القائمة كلها
        updateStats();
        toast('تم نسخ المفتاح');
      } catch {
        toast('تعذر النسخ التلقائي. انسخ المفتاح يدويًا: ' + c.code);
      }
    };

    actions.append(open, copy);
    el.append(actions);
    return el;
  }

  function render() {
    const list = $('codesList');
    const pin = $('pinnedSlot');
    if (!list || !pin) return;

    list.innerHTML = '';
    pin.innerHTML = '';

    const q = $('searchInput') ? $('searchInput').value.trim().toLowerCase() : '';
    const pinned = allCodes.filter(c => c.is_pinned && c.code.toLowerCase().includes(q));
    const normal = allCodes.filter(c =>
      !c.is_pinned && !hidden.has(c.code) && c.code.toLowerCase().includes(q)
    );

    pinned.forEach(c => pin.append(card(c)));

    if (!normal.length && !pin.children.length) {
      list.innerHTML = '<div class="empty">لا توجد مفاتيح ظاهرة.</div>';
    } else {
      normal.forEach(c => list.append(card(c)));
    }

    if ($('loadMore')) {
      $('loadMore').hidden = !hasMore;
      $('loadMore').disabled = loadingMore;
      $('loadMore').textContent = loadingMore ? 'جارٍ التحميل...' : 'عرض المزيد';
    }
    updateStats();
  }

  async function load() {
    const token = ++loadToken;
    normalOffset = 0;
    hasMore = false;
    loadingMore = false;
    allCodes = [];

    if ($('codesList')) $('codesList').innerHTML = '<div class="loading">جارٍ تحميل المفاتيح...</div>';

    try {
      const q = $('searchInput') ? $('searchInput').value.trim() : '';
      const sort = $('sortSelect') ? $('sortSelect').value : 'new';
      const params = new URLSearchParams({ search: q, sort, offset: '0', limit: String(pageSize) });
      const data = await api('/api/codes?' + params.toString());

      if (token !== loadToken) return;
      const pinned = data.pinned || [];
      const normal = data.codes || [];
      allCodes = [...pinned, ...normal];
      totalCodesCount = Number(data.total || 0);
      todayCodesCount = Number(data.today || 0);
      normalOffset = normal.length;
      hasMore = normal.length === pageSize;
      render();
    } catch (error) {
      if (token !== loadToken) return;
      console.error('Load error:', error);
      if ($('codesList')) $('codesList').textContent = 'تعذر تحميل المفاتيح: ' + error.message;
    }
  }

  async function loadMoreCodes() {
    if (!hasMore || loadingMore) return;
    loadingMore = true;
    render();

    try {
      const q = $('searchInput') ? $('searchInput').value.trim() : '';
      const sort = $('sortSelect') ? $('sortSelect').value : 'new';
      const params = new URLSearchParams({
        search: q, sort, offset: String(normalOffset), limit: String(pageSize)
      });
      const data = await api('/api/codes?' + params.toString());
      const batch = data.codes || [];
      allCodes.push(...batch);
      normalOffset += batch.length;
      hasMore = batch.length === pageSize;
      render();
    } catch (error) {
      console.error('Load more error:', error);
      toast('تعذر تحميل المزيد: ' + error.message);
    } finally {
      loadingMore = false;
      render();
    }
  }

  async function shareCodes() {
    const btn = $('submitCodes');
    const input = $('bulkCodes');
    if (!btn || !input) return;

    const tokens = (input.value || '').split(/[\s,;]+/)
      .map(s => s.trim()).filter(Boolean)
      .map(s => {
        const match = s.match(/NG-[A-Za-z0-9]{8}/i);
        return match ? match[0] : s;
      });

    const unique = [...new Set(tokens.map(s =>
      s.toUpperCase().startsWith('NG-') ? 'NG-' + s.slice(3) : s
    ))];
    const validCodes = unique.filter(valid);
    const invalid = unique.length - validCodes.length;

    if (!validCodes.length) {
      message('لم نعثر على مفاتيح صحيحة. تأكد أن كل مفتاح يتكون من NG- ثم 8 أحرف أو أرقام.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'جارٍ الإرسال...';
    message('جارٍ إرسال المفاتيح إلى قاعدة البيانات...', 'success');

    try {
      const result = await api('/api/share', {
        method: 'POST',
        body: JSON.stringify({ codes: validCodes })
      });

      const failed = Number(result.failed || 0);
      message(
        `انتهى الإرسال.\nمفاتيح جديدة: ${result.added || 0}\nمكررة: ${result.duplicates || 0}\nغير صالحة: ${invalid + (result.invalid || 0)}\nمفاتيح فشل إرسالها: ${failed}`,
        failed ? 'error' : 'success'
      );

      if (!failed) input.value = '';
      await load();
    } catch (error) {
      console.error('Share error:', error);
      message('تعذر إرسال المفاتيح: ' + error.message);
    } finally {
      btn.disabled = false;
      btn.textContent = '＋ مشاركة المفاتيح';
    }
  }

  function adminMessage(text, type = 'error') {
    const el = $('pinnedResult');
    if (!el) { toast(text); return; }
    el.className = 'result ' + type;
    el.textContent = text;
  }

  function clearAdminSession() {
    adminToken = '';
    sessionStorage.removeItem(tokenKey);
    if ($('adminTools')) $('adminTools').hidden = true;
    if ($('adminLogin')) $('adminLogin').hidden = false;
  }

  async function addPinnedCode() {
    const input = $('pinnedCodeInput');
    if (!input || !adminToken) {
      adminMessage('سجّل دخولك إلى لوحة الإدارة أولاً.');
      return;
    }

    const code = input.value.trim().toUpperCase();
    if (!valid(code)) {
      adminMessage('المفتاح غير صحيح. يجب أن يبدأ بـ NG- ويتبعه 8 أحرف أو أرقام.');
      return;
    }

    const btn = $('addPinnedBtn');
    if (btn) btn.disabled = true;

    try {
      await api('/api/admin/pinned', {
        method: 'POST',
        body: JSON.stringify({ code })
      }, true);

      adminMessage('تمت إضافة المفتاح المميز أو تحديثه بنجاح.', 'success');
      input.value = '';
      await load();
      await adminLoad();
    } catch (error) {
      adminMessage('تعذرت إضافة المفتاح: ' + error.message);
      if (error.status === 401) clearAdminSession();
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function togglePinned(c) {
    if (!adminToken || !c.id) return;
    try {
      await api('/api/admin/codes/' + encodeURIComponent(c.id) + '/pin', {
        method: 'PATCH',
        body: JSON.stringify({ is_pinned: !c.is_pinned })
      }, true);
      toast(c.is_pinned ? 'تم إلغاء تمييز المفتاح' : 'تم تمييز المفتاح');
      await load();
      await adminLoad();
    } catch (error) {
      toast('تعذر تغيير حالة المفتاح: ' + error.message);
      if (error.status === 401) clearAdminSession();
    }
  }

  async function deleteCode(c) {
    if (!adminToken || !c.id) return;
    if (!confirm('هل تريد حذف هذا المفتاح نهائياً من قائمة الجميع؟')) return;

    try {
      await api('/api/admin/codes/' + encodeURIComponent(c.id), {
        method: 'DELETE'
      }, true);
      toast('تم حذف المفتاح');
      await load();
      await adminLoad();
    } catch (error) {
      toast('تعذر الحذف: ' + error.message);
      if (error.status === 401) clearAdminSession();
    }
  }

  async function adminLoad() {
    if (!adminToken) return;
    const container = $('adminCodes');
    if (!container) return;

    container.innerHTML = '<div class="loading">جارٍ تحميل مفاتيح الإدارة...</div>';

    try {
      const data = await api('/api/admin/codes', {}, true);
      const pinnedCodes = data.pinned || [];
      const normalCodes = data.codes || [];
      container.innerHTML = '';

      if (!pinnedCodes.length && !normalCodes.length) {
        container.innerHTML = '<div class="empty">لا توجد مفاتيح لإدارتها.</div>';
        return;
      }

      const heading1 = document.createElement('h3');
      heading1.textContent = 'المفاتيح المميزة (' + pinnedCodes.length + ')';
      container.append(heading1);
      pinnedCodes.forEach(c => addAdminRow(container, c));

      const heading2 = document.createElement('h3');
      heading2.textContent = 'المفاتيح العادية (أحدث 100)';
      container.append(heading2);
      normalCodes.forEach(c => addAdminRow(container, c));
    } catch (error) {
      console.error('Admin load error:', error);
      container.textContent = 'تعذر تحميل المفاتيح: ' + error.message;
      if (error.status === 401) clearAdminSession();
    }
  }

  function addAdminRow(container, c) {
    const row = document.createElement('div');
    row.className = 'admin-code';

    const span = document.createElement('span');
    span.textContent = c.code;

    const toggle = document.createElement('button');
    toggle.className = 'primary-btn';
    toggle.textContent = c.is_pinned ? 'إلغاء التمييز' : 'تمييز';
    toggle.onclick = () => togglePinned(c);

    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.textContent = 'حذف';
    del.onclick = () => deleteCode(c);

    row.append(span, toggle, del);
    container.append(row);
  }

  function start() {
    document.querySelectorAll('.tab').forEach(b => {
      b.addEventListener('click', () => setTab(b.dataset.tab));
    });

    if ($('searchInput')) {
      $('searchInput').addEventListener('input', () => {
        clearTimeout(searchTimer);
        loadToken++;
        searchTimer = setTimeout(load, 350);
      });
    }
    if ($('sortSelect')) $('sortSelect').addEventListener('change', load);
    if ($('loadMore')) $('loadMore').onclick = loadMoreCodes;
    if ($('refreshBtn')) $('refreshBtn').onclick = load;

    if ($('clearHidden')) {
      $('clearHidden').onclick = () => {
        hidden.clear();
        saveHidden();
        render();
        toast('تم إظهار كل المفاتيح مرة أخرى');
      };
    }

    if ($('submitCodes')) {
      $('submitCodes').addEventListener('click', event => {
        event.preventDefault();
        shareCodes();
      });
    }

    if ($('adminToggle')) {
      $('adminToggle').onclick = () => {
        if ($('codesPanel')) $('codesPanel').hidden = true;
        if ($('sharePanel')) $('sharePanel').hidden = true;
        if ($('adminPanel')) $('adminPanel').hidden = false;
      };
    }

    if ($('loginBtn')) {
      $('loginBtn').onclick = async () => {
        const result = $('loginResult');
        const btn = $('loginBtn');
        if (btn) btn.disabled = true;

        try {
          const email = $('adminEmail') ? $('adminEmail').value.trim() : '';
          const password = $('adminPassword') ? $('adminPassword').value : '';

          const data = await api('/api/admin/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
          });

          adminToken = data.token;
          sessionStorage.setItem(tokenKey, adminToken);

          if (result) {
            result.className = 'result success';
            result.textContent = 'تم تسجيل الدخول بنجاح.';
          }
          if ($('adminLogin')) $('adminLogin').hidden = true;
          if ($('adminTools')) $('adminTools').hidden = false;
          await adminLoad();
        } catch (error) {
          if (result) {
            result.className = 'result error';
            result.textContent = 'تعذر تسجيل الدخول: ' + error.message;
          }
        } finally {
          if (btn) btn.disabled = false;
        }
      };
    }

    if ($('addPinnedBtn')) $('addPinnedBtn').onclick = addPinnedCode;
    if ($('pinnedCodeInput')) {
      $('pinnedCodeInput').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          addPinnedCode();
        }
      });
    }
    if ($('adminRefresh')) $('adminRefresh').onclick = adminLoad;

    if ($('logoutBtn')) {
      $('logoutBtn').onclick = () => {
        clearAdminSession();
        if ($('loginResult')) {
          $('loginResult').className = 'result success';
          $('loginResult').textContent = 'تم تسجيل الخروج.';
        }
      };
    }

    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
