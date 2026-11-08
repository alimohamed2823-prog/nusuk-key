(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  // عنوان Worker الصحيح المتصل بقاعدة Turso
  const API = 'https://nusuk-key-turso-api.ali-mohamed2823-prog.workers.dev/api';

  const NUSUK_LINK = 'https://services.nusuk.sa/app?p=27&id=';
  const HIDDEN_KEY = 'nusuk_keys_hidden_v1';
  const PAGE_SIZE = 30;

  let allCodes = [];
  let totalCount = 0;
  let todayCount = 0;
  let offset = 0;
  let hasMore = false;
  let loadingMore = false;
  let loadToken = 0;
  let searchTimer;
  let adminLoggedIn = false;
  let hidden = new Set();

  try {
    hidden = new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || '[]'));
  } catch {}

  const validCode = code => /^NG-[A-Za-z0-9]{8}$/.test(code);

  async function api(path, options = {}) {
    const response = await fetch(API + path, {
      ...options,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || data.message || `خطأ ${response.status}`);
    }

    return data;
  }

  function toast(message) {
    const el = $('toast');
    if (!el) return;

    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }

  function showResult(id, message, type = 'error') {
    const el = $(id);
    if (!el) return;

    el.className = 'result ' + type;
    el.textContent = message;
  }

  function saveHidden() {
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...hidden]));
    } catch {}
  }

  function hideCode(code) {
    hidden.add(code);
    saveHidden();
  }

  function updateStats() {
    const visible = allCodes.filter(c => c.is_pinned || !hidden.has(c.code));

    if ($('totalCount')) {
      $('totalCount').textContent = totalCount.toLocaleString('en-US');
    }

    if ($('todayCount')) {
      $('todayCount').textContent = todayCount.toLocaleString('en-US');
    }

    if ($('usedCount')) {
      $('usedCount').textContent = hidden.size.toLocaleString('en-US');
    }

    if ($('shownCount')) {
      $('shownCount').textContent = visible.length.toLocaleString('en-US');
    }
  }

  function setTab(tab) {
    document.querySelectorAll('.tab').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === tab);
    });

    if ($('codesPanel')) $('codesPanel').hidden = tab !== 'codes';
    if ($('sharePanel')) $('sharePanel').hidden = tab !== 'share';
    if ($('adminPanel')) $('adminPanel').hidden = true;
  }

  function createCard(item) {
    const card = document.createElement('article');
    card.className = 'code-card' + (item.is_pinned ? ' pinned' : '');

    const top = document.createElement('div');
    top.className = 'code-top';

    const label = document.createElement('span');
    label.className = 'code-label';
    label.textContent = item.is_pinned ? 'مفتاح مثبت' : 'مفتاح مشاركة';
    top.append(label);

    if (item.is_pinned) {
      const badge = document.createElement('span');
      badge.className = 'pin-badge';
      badge.textContent = 'مميز';
      top.append(badge);
    }

    const code = document.createElement('span');
    code.className = 'code-value';
    code.textContent = item.code;

    const actions = document.createElement('div');
    actions.className = 'actions';

    const open = document.createElement('button');
    open.className = 'open-btn';
    open.textContent = '↗ فتح في نسك';

    open.onclick = () => {
      hideCode(item.code);
      updateStats();
      render();
      window.open(
        NUSUK_LINK + encodeURIComponent(item.code),
        '_blank',
        'noopener'
      );
    };

    const copy = document.createElement('button');
    copy.className = 'copy-btn';
    copy.textContent = '▢ نسخ';

    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(item.code);
        toast('تم نسخ المفتاح');
      } catch {
        toast('انسخ المفتاح يدويًا: ' + item.code);
      }

      hideCode(item.code);
      updateStats();
      render();
    };

    actions.append(open, copy);
    card.append(top, code, actions);

    return card;
  }

  function render() {
    const list = $('codesList');
    const pinnedSlot = $('pinnedSlot');

    if (!list || !pinnedSlot) return;

    list.innerHTML = '';
    pinnedSlot.innerHTML = '';

    const query = $('searchInput')
      ? $('searchInput').value.trim().toLowerCase()
      : '';

    const pinned = allCodes.filter(item =>
      item.is_pinned && item.code.toLowerCase().includes(query)
    );

    let normal = allCodes.filter(item =>
      !item.is_pinned &&
      !hidden.has(item.code) &&
      item.code.toLowerCase().includes(query)
    );

    const sort = $('sortSelect') ? $('sortSelect').value : 'new';

    if (sort === 'random') {
      normal = [...normal].sort(() => Math.random() - 0.5);
    }

    pinned.forEach(item => pinnedSlot.append(createCard(item)));

    if (!normal.length && !pinned.length) {
      list.innerHTML = '<div class="empty">لا توجد مفاتيح ظاهرة.</div>';
    } else {
      normal.forEach(item => list.append(createCard(item)));
    }

    if ($('loadMore')) {
      $('loadMore').hidden = !hasMore;
      $('loadMore').disabled = loadingMore;
      $('loadMore').textContent = loadingMore
        ? 'جارٍ التحميل...'
        : 'عرض المزيد';
    }

    updateStats();
  }

  async function load() {
    const token = ++loadToken;

    offset = 0;
    hasMore = false;
    loadingMore = false;
    allCodes = [];

    if ($('codesList')) {
      $('codesList').innerHTML =
        '<div class="loading">جارٍ تحميل المفاتيح...</div>';
    }

    try {
      const query = $('searchInput')
        ? $('searchInput').value.trim()
        : '';

      const sort = $('sortSelect')
        ? $('sortSelect').value
        : 'new';

      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: '0',
        sort
      });

      if (query) params.set('search', query);

      // تحميل الأكواد والإحصائيات من مسارين منفصلين
      const [data, stats] = await Promise.all([
        api('/codes?' + params.toString()),
        api('/stats').catch(error => {
          console.error('Stats error:', error);
          return {};
        })
      ]);

      if (token !== loadToken) return;

      const pinned = Array.isArray(data.pinned) ? data.pinned : [];
      const normal = Array.isArray(data.codes) ? data.codes : [];

      allCodes = [...pinned, ...normal];

      offset = normal.length;
      hasMore = Boolean(data.hasMore);

      totalCount = Number(stats.total ?? data.total ?? 0);
      todayCount = Number(stats.today ?? data.today ?? 0);

      render();

    } catch (error) {
      if (token !== loadToken) return;

      console.error('Load error:', error);

      if ($('codesList')) {
        $('codesList').textContent =
          'تعذر تحميل المفاتيح: ' + error.message;
      }
    }
  }

  async function loadMoreCodes() {
    if (!hasMore || loadingMore) return;

    loadingMore = true;
    render();

    try {
      const query = $('searchInput')
        ? $('searchInput').value.trim()
        : '';

      const sort = $('sortSelect')
        ? $('sortSelect').value
        : 'new';

      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
        sort
      });

      if (query) params.set('search', query);

      const data = await api('/codes?' + params.toString());
      const batch = Array.isArray(data.codes) ? data.codes : [];

      allCodes.push(...batch);
      offset += batch.length;
      hasMore = Boolean(data.hasMore);

    } catch (error) {
      toast('تعذر تحميل المزيد: ' + error.message);

    } finally {
      loadingMore = false;
      render();
    }
  }

  async function shareCodes() {
    const button = $('submitCodes');
    const input = $('bulkCodes');

    if (!button || !input) return;

    const tokens = (input.value || '')
      .split(/[\s,;]+/)
      .map(value => value.trim())
      .filter(Boolean);

    const normalized = tokens.map(value => {
      const match = value.match(/NG-[A-Za-z0-9]{8}/i);
      return match ? 'NG-' + match[0].slice(3) : value;
    });

    const unique = [...new Set(normalized.map(value =>
      value.toUpperCase().startsWith('NG-')
        ? 'NG-' + value.slice(3)
        : value
    ))];

    const valid = unique.filter(validCode);
    const invalid = unique.length - valid.length;

    if (!valid.length) {
      showResult(
        'submitResult',
        'لم نعثر على مفاتيح صحيحة. تأكد أن كل مفتاح يبدأ بـ NG- ويتبعه 8 أحرف أو أرقام.'
      );
      return;
    }

    button.disabled = true;
    button.textContent = 'جارٍ الإرسال...';

    try {
      let added = 0;
      let duplicates = 0;
      let failed = 0;
      const errors = [];

      for (let i = 0; i < valid.length; i += 100) {
        const batch = valid.slice(i, i + 100);

        showResult(
          'submitResult',
          `جارٍ إرسال الدفعة ${Math.floor(i / 100) + 1} من ${Math.ceil(valid.length / 100)}...`,
          'success'
        );

        try {
          const result = await api('/share', {
            method: 'POST',
            body: JSON.stringify({ codes: batch })
          });

          added += Number(result.added || 0);
          duplicates += Number(result.duplicates || 0);
          failed += Number(result.failed || 0);

        } catch (error) {
          failed += batch.length;
          errors.push(error.message);
        }
      }

      showResult(
        'submitResult',
        'انتهى الإرسال.' +
        '\nمفاتيح جديدة: ' + added +
        '\nمكررة: ' + duplicates +
        '\nغير صالحة: ' + invalid +
        '\nفشل إرسالها: ' + failed +
        (errors.length ? '\nالخطأ: ' + errors[0] : ''),
        failed ? 'error' : 'success'
      );

      if (!failed) input.value = '';

      await load();

    } catch (error) {
      showResult('submitResult', 'حدث خطأ: ' + error.message);

    } finally {
      button.disabled = false;
      button.textContent = '＋ مشاركة المفاتيح';
    }
  }

  function showAdminState(loggedIn) {
    adminLoggedIn = loggedIn;

    if ($('adminLogin')) $('adminLogin').hidden = loggedIn;
    if ($('adminTools')) $('adminTools').hidden = !loggedIn;

    if ($('adminEmail')) $('adminEmail').hidden = true;

    if ($('adminPassword')) {
      $('adminPassword').placeholder = 'كلمة مرور الإدارة';
    }
  }

  async function loginAdmin() {
    const password = $('adminPassword')
      ? $('adminPassword').value
      : '';

    if (!password) {
      showResult('loginResult', 'اكتب كلمة مرور الإدارة.');
      return;
    }

    const button = $('loginBtn');

    if (button) button.disabled = true;

    try {
      await api('/admin/login', {
        method: 'POST',
        body: JSON.stringify({ password })
      });

      if ($('adminPassword')) $('adminPassword').value = '';

      showAdminState(true);

      showResult(
        'loginResult',
        'تم تسجيل الدخول بنجاح.',
        'success'
      );

      await adminLoad();

    } catch (error) {
      showResult(
        'loginResult',
        'تعذر تسجيل الدخول: ' + error.message
      );

    } finally {
      if (button) button.disabled = false;
    }
  }

  async function adminLoad() {
    if (!adminLoggedIn) return;

    const container = $('adminCodes');
    if (!container) return;

    container.innerHTML =
      '<div class="loading">جارٍ تحميل مفاتيح الإدارة...</div>';

    try {
      const data = await api('/admin/codes');

      const pinned = Array.isArray(data.pinned)
        ? data.pinned
        : [];

      const normal = Array.isArray(data.normal)
        ? data.normal
        : (Array.isArray(data.codes) ? data.codes : []);

      container.innerHTML = '';

      const heading1 = document.createElement('h3');
      heading1.textContent =
        'المفاتيح المميزة (' + pinned.length + ')';

      container.append(heading1);

      pinned.forEach(item => addAdminRow(container, item));

      const heading2 = document.createElement('h3');
      heading2.textContent =
        'المفاتيح العادية (' + normal.length + ')';

      container.append(heading2);

      normal.forEach(item => addAdminRow(container, item));

    } catch (error) {
      container.textContent =
        'تعذر تحميل المفاتيح: ' + error.message;

      if (/401|403|unauthorized|غير مصرح/i.test(error.message)) {
        showAdminState(false);
      }
    }
  }

  function addAdminRow(container, item) {
    const row = document.createElement('div');
    row.className = 'admin-code';

    const span = document.createElement('span');
    span.textContent = item.code;

    const toggle = document.createElement('button');
    toggle.className = 'primary-btn';
    toggle.textContent = item.is_pinned
      ? 'إلغاء التمييز'
      : 'تمييز';

    toggle.onclick = async () => {
      try {
        await api(
          '/admin/codes/' +
          encodeURIComponent(item.id) +
          '/pinned',
          {
            method: 'PATCH',
            body: JSON.stringify({
              is_pinned: !item.is_pinned
            })
          }
        );

        toast(
          item.is_pinned
            ? 'تم إلغاء التمييز'
            : 'تم تمييز المفتاح'
        );

        await load();
        await adminLoad();

      } catch (error) {
        toast('تعذر تغيير حالة المفتاح: ' + error.message);
      }
    };

    const del = document.createElement('button');
    del.className = 'delete-btn';
    del.textContent = 'حذف';

    del.onclick = async () => {
      if (!confirm('هل تريد حذف هذا المفتاح نهائيًا من قائمة الجميع؟')) {
        return;
      }

      try {
        await api(
          '/admin/codes/' + encodeURIComponent(item.id),
          { method: 'DELETE' }
        );

        toast('تم حذف المفتاح');

        await load();
        await adminLoad();

      } catch (error) {
        toast('تعذر الحذف: ' + error.message);
      }
    };

    row.append(span, toggle, del);
    container.append(row);
  }

  async function addPinnedCode() {
    const input = $('pinnedCodeInput');

    const code = input
      ? input.value.trim().toUpperCase()
      : '';

    if (!validCode(code)) {
      showResult(
        'pinnedResult',
        'المفتاح غير صحيح. يجب أن يبدأ بـ NG- ويتبعه 8 أحرف أو أرقام.'
      );
      return;
    }

    const button = $('addPinnedBtn');

    if (button) button.disabled = true;

    try {
      await api('/admin/pinned', {
        method: 'POST',
        body: JSON.stringify({ code })
      });

      if (input) input.value = '';

      showResult(
        'pinnedResult',
        'تمت إضافة/تثبيت المفتاح بنجاح.',
        'success'
      );

      await load();
      await adminLoad();

    } catch (error) {
      showResult(
        'pinnedResult',
        'تعذرت إضافة المفتاح: ' + error.message
      );

    } finally {
      if (button) button.disabled = false;
    }
  }

  async function logoutAdmin() {
    try {
      await api('/admin/logout', {
        method: 'POST',
        body: '{}'
      });
    } catch {}

    showAdminState(false);

    if ($('adminCodes')) {
      $('adminCodes').innerHTML = '';
    }

    toast('تم تسجيل الخروج');
  }

  function start() {
    if ($('adminEmail')) {
      $('adminEmail').hidden = true;
      $('adminEmail').value = '';
    }

    if ($('adminPassword')) {
      $('adminPassword').placeholder = 'كلمة مرور الإدارة';
    }

    document.querySelectorAll('.tab').forEach(button => {
      button.addEventListener('click', () => {
        setTab(button.dataset.tab);
      });
    });

    if ($('searchInput')) {
      $('searchInput').addEventListener('input', () => {
        clearTimeout(searchTimer);
        loadToken++;
        searchTimer = setTimeout(load, 350);
      });
    }

    if ($('sortSelect')) {
      $('sortSelect').addEventListener('change', load);
    }

    if ($('loadMore')) {
      $('loadMore').onclick = loadMoreCodes;
    }

    if ($('refreshBtn')) {
      $('refreshBtn').onclick = load;
    }

    if ($('clearHidden')) {
      $('clearHidden').onclick = () => {
        hidden.clear();
        saveHidden();
        render();
        toast('تم إظهار كل المفاتيح مرة أخرى');
      };
    }

    if ($('submitCodes')) {
      $('submitCodes').onclick = shareCodes;
    }

    if ($('adminToggle')) {
      $('adminToggle').onclick = () => {
        if ($('codesPanel')) $('codesPanel').hidden = true;
        if ($('sharePanel')) $('sharePanel').hidden = true;
        if ($('adminPanel')) $('adminPanel').hidden = false;

        showAdminState(adminLoggedIn);
      };
    }

    if ($('loginBtn')) {
      $('loginBtn').onclick = loginAdmin;
    }

    if ($('adminPassword')) {
      $('adminPassword').addEventListener('keydown', event => {
        if (event.key === 'Enter') loginAdmin();
      });
    }

    if ($('addPinnedBtn')) {
      $('addPinnedBtn').onclick = addPinnedCode;
    }

    if ($('pinnedCodeInput')) {
      $('pinnedCodeInput').addEventListener('keydown', event => {
        if (event.key === 'Enter') addPinnedCode();
      });
    }

    if ($('adminRefresh')) {
      $('adminRefresh').onclick = adminLoad;
    }

    if ($('logoutBtn')) {
      $('logoutBtn').onclick = logoutAdmin;
    }

    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

})();
