(() => {
  'use strict';

  const API = 'https://nusuk-key-api.ali-mohamed2823.workers.dev';
  const LINK = 'https://services.nusuk.sa/app?p=27&id=';
  const $ = id => document.getElementById(id);

  const hiddenKey = 'nusuk_keys_hidden_v1';
  const tokenKey = 'nusuk_admin_token_v1';

  let codes = [];
  let pinned = [];
  let total = 0;
  let today = 0;
  let offset = 0;
  let limit = 50;
  let loading = false;
  let hasMore = true;
  let searchTimer = null;
  let adminToken = sessionStorage.getItem(tokenKey) || '';

  const hiddenCodes = new Set(
    JSON.parse(localStorage.getItem(hiddenKey) || '[]')
  );

  function toast(message) {
    const el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2500);
  }

  async function api(path, options = {}) {
    const headers = {
      ...(options.headers || {})
    };

    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }

    if (adminToken) {
      headers.Authorization = `Bearer ${adminToken}`;
    }

    const response = await fetch(API + path, {
      ...options,
      headers
    });

    let data = {};
    try {
      data = await response.json();
    } catch (_) {}

    if (!response.ok) {
      throw new Error(data.error || data.message || `خطأ ${response.status}`);
    }

    return data;
  }

  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[char]);
  }

  function saveHidden() {
    localStorage.setItem(hiddenKey, JSON.stringify([...hiddenCodes]));
  }

  function updateStats() {
    const visible = codes.filter(code => !hiddenCodes.has(code.code));

    if ($('totalCount')) $('totalCount').textContent = total.toLocaleString('en-US');
    if ($('todayCount')) $('todayCount').textContent = today.toLocaleString('en-US');
    if ($('usedCount')) $('usedCount').textContent = hiddenCodes.size.toLocaleString('en-US');
    if ($('shownCount')) $('shownCount').textContent = visible.length.toLocaleString('en-US');
  }

  function codeCard(item, isPinned = false) {
    const code = escapeHTML(item.code);

    return `
      <div class="code-card ${isPinned ? 'pinned' : ''}">
        <div class="code-value">${code}</div>
        <div class="code-actions">
          <button type="button" class="open-code" data-code="${code}">فتح نسك</button>
          <button type="button" class="copy-code" data-code="${code}">نسخ</button>
          <button type="button" class="hide-code" data-code="${code}">إخفاء</button>
        </div>
      </div>
    `;
  }

  function render() {
    const pinnedSlot = $('pinnedSlot');
    const codesList = $('codesList');

    if (pinnedSlot) {
      pinnedSlot.innerHTML = pinned
        .filter(item => !hiddenCodes.has(item.code))
        .map(item => codeCard(item, true))
        .join('');
    }

    if (codesList) {
      const visible = codes.filter(item => !hiddenCodes.has(item.code));
      codesList.innerHTML = visible.map(item => codeCard(item)).join('');
    }

    updateStats();

    if ($('loadMore')) {
      $('loadMore').style.display = hasMore ? '' : 'none';
    }
  }

  async function loadCodes(reset = false) {
    if (loading) return;
    loading = true;

    if (reset) {
      offset = 0;
      codes = [];
      hasMore = true;
    }

    const search = $('searchInput')?.value?.trim() || '';
    const sort = $('sortSelect')?.value || 'newest';

    try {
      const params = new URLSearchParams({
        search,
        sort,
        offset: String(offset),
        limit: String(limit)
      });

      const data = await api('/api/codes?' + params.toString());

      pinned = data.pinned || [];
      const received = data.codes || [];

      if (reset) {
        codes = received;
      } else {
        codes = [...codes, ...received];
      }

      total = Number(data.total || 0);
      today = Number(data.today || 0);
      offset += received.length;
      hasMore = received.length === limit;

      render();
    } catch (error) {
      toast('تعذر تحميل الأكواد: ' + error.message);
    } finally {
      loading = false;
    }
  }

  async function shareCodes() {
    const input = $('bulkCodes');
    const result = $('submitResult');
    const raw = input?.value?.trim() || '';

    if (!raw) {
      if (result) result.textContent = 'اكتب الأكواد أولاً';
      return;
    }

    const codesToShare = raw
      .split(/[\s,،;]+/)
      .map(value => value.trim())
      .filter(Boolean);

    if (!codesToShare.length) return;

    try {
      if (result) result.textContent = 'جاري إرسال الأكواد...';

      const data = await api('/api/share', {
        method: 'POST',
        body: JSON.stringify({ codes: codesToShare })
      });

      if (result) {
        result.textContent =
          `تمت الإضافة: ${data.added || 0} | مكرر: ${data.duplicates || 0} | غير صالح: ${data.invalid || 0} | فشل: ${data.failed || 0}`;
      }

      if (input) input.value = '';
      await loadCodes(true);
    } catch (error) {
      if (result) result.textContent = 'حدث خطأ: ' + error.message;
    }
  }

  async function loginAdmin() {
    const email = $('adminEmail')?.value?.trim() || '';
    const password = $('adminPassword')?.value || '';
    const result = $('loginResult');

    if (!email || !password) {
      if (result) result.textContent = 'أدخل البريد الإلكتروني وكلمة المرور';
      return;
    }

    try {
      if (result) result.textContent = 'جاري تسجيل الدخول...';

      const data = await api('/api/admin/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
      });

      adminToken = data.token;
      sessionStorage.setItem(tokenKey, adminToken);

      if (result) result.textContent = 'تم تسجيل الدخول بنجاح';

      showAdminTools(true);
      await loadAdminCodes();
    } catch (error) {
      if (result) result.textContent = 'فشل تسجيل الدخول: ' + error.message;
    }
  }

  function showAdminTools(show) {
    const tools = $('adminTools');
    const login = $('adminLogin');

    if (tools) tools.style.display = show ? '' : 'none';
    if (login) login.style.display = show ? 'none' : '';
  }

  async function loadAdminCodes() {
    try {
      const data = await api('/api/admin/codes');
      const list = $('adminCodes');

      if (!list) return;

      const items = data.codes || [];

      list.innerHTML = items.map(item => `
        <div class="admin-code-row">
          <span>${escapeHTML(item.code)}</span>
          <div>
            <button type="button"
              class="toggle-pin"
              data-id="${escapeHTML(item.id)}"
              data-pinned="${item.is_pinned ? '1' : '0'}">
              ${item.is_pinned ? 'إلغاء التثبيت' : 'تثبيت'}
            </button>
            <button type="button"
              class="delete-code"
              data-id="${escapeHTML(item.id)}">
              حذف
            </button>
          </div>
        </div>
      `).join('');
    } catch (error) {
      toast('تعذر تحميل لوحة الإدارة: ' + error.message);
    }
  }

  async function addPinned() {
    const input = $('pinnedCodeInput');
    const result = $('pinnedResult');
    const code = input?.value?.trim() || '';

    if (!code) {
      if (result) result.textContent = 'اكتب الكود أولاً';
      return;
    }

    try {
      const data = await api('/api/admin/pinned', {
        method: 'POST',
        body: JSON.stringify({ code })
      });

      if (result) result.textContent = data.message || 'تمت العملية';
      if (input) input.value = '';

      await loadAdminCodes();
      await loadCodes(true);
    } catch (error) {
      if (result) result.textContent = 'حدث خطأ: ' + error.message;
    }
  }

  async function togglePin(id, pinnedValue) {
    try {
      await api(`/api/admin/codes/${encodeURIComponent(id)}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ is_pinned: !pinnedValue })
      });

      await loadAdminCodes();
      await loadCodes(true);
      toast('تم تحديث التثبيت');
    } catch (error) {
      toast('تعذر تحديث التثبيت: ' + error.message);
    }
  }

  async function deleteCode(id) {
    if (!confirm('هل أنت متأكد من حذف هذا الكود؟')) return;

    try {
      await api(`/api/admin/codes/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });

      await loadAdminCodes();
      await loadCodes(true);
      toast('تم الحذف');
    } catch (error) {
      toast('تعذر الحذف: ' + error.message);
    }
  }

  function logoutAdmin() {
    adminToken = '';
    sessionStorage.removeItem(tokenKey);
    showAdminTools(false);

    if ($('adminPassword')) $('adminPassword').value = '';
    if ($('loginResult')) $('loginResult').textContent = '';

    toast('تم تسجيل الخروج');
  }

  function setupTabs() {
    document.querySelectorAll('.tab[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;

        document.querySelectorAll('.tab[data-tab]').forEach(item => {
          item.classList.toggle('active', item === tab);
        });

        document.querySelectorAll('.panel').forEach(panel => {
          panel.style.display = panel.id === target + 'Panel' ? '' : 'none';
        });
      });
    });
  }

  function setupEvents() {
    $('loadMore')?.addEventListener('click', () => loadCodes(false));
    $('refreshBtn')?.addEventListener('click', () => loadCodes(true));
    $('submitCodes')?.addEventListener('click', shareCodes);
    $('loginBtn')?.addEventListener('click', loginAdmin);
    $('addPinnedBtn')?.addEventListener('click', addPinned);
    $('adminRefresh')?.addEventListener('click', loadAdminCodes);
    $('logoutBtn')?.addEventListener('click', logoutAdmin);

    $('adminToggle')?.addEventListener('click', () => {
      const panel = $('adminPanel');
      if (panel) {
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
      }
    });

    $('clearHidden')?.addEventListener('click', () => {
      if (!confirm('هل تريد إظهار الأكواد المخفية مرة أخرى؟')) return;
      hiddenCodes.clear();
      saveHidden();
      render();
      toast('تم إظهار الأكواد المخفية');
    });

    $('searchInput')?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadCodes(true), 350);
    });

    $('sortSelect')?.addEventListener('change', () => loadCodes(true));

    document.addEventListener('click', async event => {
      const openButton = event.target.closest('.open-code');
      const copyButton = event.target.closest('.copy-code');
      const hideButton = event.target.closest('.hide-code');
      const pinButton = event.target.closest('.toggle-pin');
      const deleteButton = event.target.closest('.delete-code');

      if (openButton) {
        const code = openButton.dataset.code;
        window.open(LINK + encodeURIComponent(code), '_blank');
      }

      if (copyButton) {
        try {
          await navigator.clipboard.writeText(copyButton.dataset.code);
          toast('تم نسخ الكود');
        } catch (_) {
          toast('تعذر النسخ');
        }
      }

      if (hideButton) {
        hiddenCodes.add(hideButton.dataset.code);
        saveHidden();
        render();
        toast('تم إخفاء الكود');
      }

      if (pinButton) {
        await togglePin(
          pinButton.dataset.id,
          pinButton.dataset.pinned === '1'
        );
      }

      if (deleteButton) {
        await deleteCode(deleteButton.dataset.id);
      }
    });
  }

  function init() {
    setupTabs();
    setupEvents();

    if (adminToken) {
      showAdminTools(true);
    } else {
      showAdminTools(false);
    }

    loadCodes(true);

    if (adminToken) {
      loadAdminCodes();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
