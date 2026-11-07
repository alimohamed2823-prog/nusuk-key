
(() => {
  'use strict';

  const $ = id => document.getElementById(id);

  const cfg = window.NUSUK_CONFIG || {};
  const LINK = 'https://services.nusuk.sa/app?p=27&id=';
  const hiddenKey = 'nusuk_keys_hidden_v1';

  let db = null;
  let allCodes = [];
  let normalOffset = 0;
  let hasMore = false;
  let loadingMore = false;
  let loadToken = 0;
  let totalCodesCount = 0;
  let todayCodesCount = 0;
  let searchTimer = null;

  const pageSize = 30;
  const batchSize = 1000;

  let adminUser = null;
  let hidden = new Set();

  try {
    hidden = new Set(JSON.parse(localStorage.getItem(hiddenKey) || '[]'));
  } catch {}

  const valid = s => /^NG-[A-Za-z0-9]{8}$/.test(s);

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
    const visible = allCodes.filter(c =>
      c.is_pinned || !hidden.has(c.code)
    );

    if ($('totalCount')) {
      $('totalCount').textContent =
        totalCodesCount.toLocaleString('en-US');
    }

    if ($('todayCount')) {
      $('todayCount').textContent =
        todayCodesCount.toLocaleString('en-US');
    }

    if ($('usedCount')) {
      $('usedCount').textContent =
        hidden.size.toLocaleString('en-US');
    }

    if ($('shownCount')) {
      $('shownCount').textContent =
        visible.length.toLocaleString('en-US');
    }
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
        toast('تم نسخ المفتاح');
      } catch {
        toast('انسخ المفتاح يدويًا: ' + c.code);
      }

      hide(c.code);
      updateStats();
      render();
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

    const q = $('searchInput')
      ? $('searchInput').value.trim().toLowerCase()
      : '';

    const pinned = allCodes.filter(c => c.is_pinned);

    const arr = allCodes.filter(c =>
      !c.is_pinned &&
      !hidden.has(c.code) &&
      c.code.toLowerCase().includes(q)
    );

    const matchingPinned = pinned.filter(c =>
      c.code.toLowerCase().includes(q)
    );

    const sort = $('sortSelect')
      ? $('sortSelect').value
      : 'new';

    if (sort === 'random') {
      arr.sort(() => Math.random() - 0.5);
    }

    matchingPinned.forEach(c => pin.append(card(c)));

    if (!arr.length && !pin.children.length) {
      list.innerHTML =
        '<div class="empty">لا توجد مفاتيح ظاهرة.</div>';
    } else {
      arr.forEach(c => list.append(card(c)));
    }

    if ($('loadMore')) {
      $('loadMore').hidden = !hasMore;
      $('loadMore').disabled = loadingMore;
      $('loadMore').textContent =
        loadingMore ? 'جارٍ التحميل...' : 'عرض المزيد';
    }

    updateStats();
  }

  // جلب جميع المفاتيح المميزة على دفعات
  async function fetchAllPinned(q, token) {
    const result = [];
    let offset = 0;

    while (true) {
      let query = db.from('nusuk_codes')
        .select('id,code,is_pinned,created_at')
        .eq('is_pinned', true)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(offset, offset + batchSize - 1);

      if (q) {
        query = query.ilike('code', `%${q}%`);
      }

      const { data, error } = await query;

      if (error) throw error;
      if (token !== loadToken) return [];

      const batch = data || [];
      result.push(...batch);
      offset += batch.length;

      if (batch.length < batchSize) break;
    }

    return result;
  }

  // تحميل المفاتيح المميزة وأول 30 مفتاحًا عاديًا
  async function load() {
    if (!db) {
      allCodes = [];
      totalCodesCount = 0;
      todayCodesCount = 0;
      render();
      return;
    }

    const token = ++loadToken;

    normalOffset = 0;
    hasMore = false;
    loadingMore = false;
    allCodes = [];

    if ($('codesList')) {
      $('codesList').innerHTML =
        '<div class="loading">جارٍ تحميل المفاتيح...</div>';
    }

    try {
      const q = $('searchInput')
        ? $('searchInput').value.trim()
        : '';

      const sort = $('sortSelect')
        ? $('sortSelect').value
        : 'new';

      let normalQuery = db.from('nusuk_codes')
        .select('id,code,is_pinned,created_at')
        .eq('is_pinned', false)
        .order('created_at', { ascending: sort === 'old' })
        .order('id', { ascending: sort === 'old' })
        .range(0, pageSize - 1);

      if (q) {
        normalQuery = normalQuery.ilike('code', `%${q}%`);
      }

      const now = new Date();
      const startOfDay = new Date(now);
      startOfDay.setHours(0, 0, 0, 0);

      const startOfTomorrow = new Date(startOfDay);
      startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);

      const [pinned, normal, total, today] = await Promise.all([
        fetchAllPinned(q, token),

        normalQuery,

        db.from('nusuk_codes')
          .select('id', { count: 'exact', head: true }),

        db.from('nusuk_codes')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', startOfDay.toISOString())
          .lt('created_at', startOfTomorrow.toISOString())
      ]);

      if (token !== loadToken) return;

      if (normal.error) throw normal.error;
      if (total.error) throw total.error;
      if (today.error) throw today.error;

      const normalCodes = normal.data || [];

      if (sort === 'random') {
        normalCodes.sort(() => Math.random() - 0.5);
      }

      allCodes = [...pinned, ...normalCodes];

      totalCodesCount = total.count || 0;
      todayCodesCount = today.count || 0;

      normalOffset = normalCodes.length;
      hasMore = normalCodes.length === pageSize;

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

  // تحميل 30 مفتاحًا إضافيًا عند الضغط على عرض المزيد
  async function loadMoreCodes() {
    if (!db || !hasMore || loadingMore) return;

    loadingMore = true;
    render();

    try {
      const q = $('searchInput')
        ? $('searchInput').value.trim()
        : '';

      const sort = $('sortSelect')
        ? $('sortSelect').value
        : 'new';

      let query = db.from('nusuk_codes')
        .select('id,code,is_pinned,created_at')
        .eq('is_pinned', false)
        .order('created_at', { ascending: sort === 'old' })
        .order('id', { ascending: sort === 'old' })
        .range(normalOffset, normalOffset + pageSize - 1);

      if (q) {
        query = query.ilike('code', `%${q}%`);
      }

      const { data, error } = await query;

      if (error) throw error;

      const batch = data || [];

      if (sort === 'random') {
        batch.sort(() => Math.random() - 0.5);
      }

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

    if (!db) {
      message('الاتصال بقاعدة البيانات غير متاح. راجع إعدادات Supabase.');
      return;
    }

    const raw = input.value || '';

    const tokens = raw.split(/[\s,;]+/)
      .map(s => s.trim())
      .filter(Boolean)
      .map(s => {
        const match = s.match(/NG-[A-Za-z0-9]{8}/i);
        return match ? match[0] : s;
      });

    const unique = [...new Set(tokens.map(s =>
      s.toUpperCase().startsWith('NG-')
        ? 'NG-' + s.slice(3)
        : s
    ))];

    const validCodes = unique.filter(valid);
    const invalid = unique.length - validCodes.length;

    if (!validCodes.length) {
      message('لم نعثر على مفاتيح صحيحة. تأكد أن كل مفتاح يتكون من NG- ثم 8 أحرف أو أرقام.');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'جارٍ الإرسال...';
    message('جارٍ الاتصال بقاعدة البيانات...', 'success');

    let added = 0;
    let failed = 0;
    let duplicates = 0;
    const errors = [];

    try {
      for (let i = 0; i < validCodes.length; i += 100) {
        const batch = validCodes.slice(i, i + 100);

        message(
          `جارٍ إرسال الدفعة ${Math.floor(i / 100) + 1} من ${Math.ceil(validCodes.length / 100)}...`,
          'success'
        );

        const rows = batch.map(code => ({
          code,
          is_pinned: false
        }));

        const { data, error } = await db
          .from('nusuk_codes')
          .upsert(rows, {
            onConflict: 'code',
            ignoreDuplicates: true
          })
          .select('id');

        if (error) {
          failed += batch.length;
          errors.push(error.message);
          console.error('Supabase insert error:', error);
        } else {
          const inserted = (data || []).length;
          added += inserted;
          duplicates += batch.length - inserted;
        }
      }

      if (failed === validCodes.length) {
        message(
          'لم تتم إضافة أي مفتاح.\nسبب المشكلة: ' +
          (errors[0] || 'خطأ غير معروف')
        );
      } else {
        message(
          `انتهى الإرسال.\n` +
          `مفاتيح جديدة: ${added}\n` +
          `مكررة: ${duplicates}\n` +
          `غير صالحة: ${invalid}\n` +
          `مفاتيح فشل إرسالها: ${failed}` +
          (errors.length ? '\nالخطأ: ' + errors[0] : ''),
          failed ? 'error' : 'success'
        );

        if (failed === 0) input.value = '';

        await load();
      }

    } catch (error) {
      console.error('Share error:', error);
      message('حدث خطأ: ' + error.message);

    } finally {
      btn.disabled = false;
      btn.textContent = '＋ مشاركة المفاتيح';
    }
  }

  function adminMessage(text, type = 'error') {
    const el = $('pinnedResult');

    if (!el) {
      toast(text);
      return;
    }

    el.className = 'result ' + type;
    el.textContent = text;
  }

  // إضافة مفتاح مميز أو تحويل مفتاح موجود إلى مميز
  async function addPinnedCode() {
    const input = $('pinnedCodeInput');

    if (!input || !db || !adminUser) {
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
      const { data: existing, error: findError } = await db
        .from('nusuk_codes')
        .select('id,is_pinned')
        .eq('code', code)
        .maybeSingle();

      if (findError) throw findError;

      if (existing) {
        if (existing.is_pinned) {
          adminMessage('هذا المفتاح مميز بالفعل.', 'success');
          return;
        }

        const { error } = await db
          .from('nusuk_codes')
          .update({ is_pinned: true })
          .eq('id', existing.id);

        if (error) throw error;

        adminMessage('تم تحويل المفتاح الموجود إلى مفتاح مميز بنجاح.', 'success');

      } else {
        const { error } = await db
          .from('nusuk_codes')
          .insert({ code, is_pinned: true });

        if (error) throw error;

        adminMessage('تمت إضافة المفتاح المميز بنجاح.', 'success');
      }

      input.value = '';
      await load();
      await adminLoad();

    } catch (error) {
      console.error('Add pinned error:', error);
      adminMessage('تعذرت إضافة المفتاح: ' + error.message);

    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // تغيير حالة التمييز لأي مفتاح
  async function togglePinned(c) {
    if (!adminUser || !db || !c.id) return;

    const nextValue = !c.is_pinned;

    try {
      const { error } = await db
        .from('nusuk_codes')
        .update({ is_pinned: nextValue })
        .eq('id', c.id);

      if (error) throw error;

      toast(nextValue ? 'تم تمييز المفتاح' : 'تم إلغاء تمييز المفتاح');

      await load();
      await adminLoad();

    } catch (error) {
      console.error('Toggle pinned error:', error);
      toast('تعذر تغيير حالة المفتاح: ' + error.message);
    }
  }

  // حذف مفتاح
  async function deleteCode(c) {
    if (!adminUser || !db || !c.id) return;

    if (!confirm('هل تريد حذف هذا المفتاح نهائياً من قائمة الجميع؟')) return;

    try {
      const { error } = await db
        .from('nusuk_codes')
        .delete()
        .eq('id', c.id);

      if (error) throw error;

      toast('تم حذف المفتاح');

      await load();
      await adminLoad();

    } catch (error) {
      console.error('Delete error:', error);
      toast('تعذر الحذف: ' + error.message);
    }
  }

  // عرض المفاتيح المميزة وأحدث 100 مفتاح عادي في الإدارة
  async function adminLoad() {
    if (!db || !adminUser) return;

    const container = $('adminCodes');
    if (!container) return;

    container.innerHTML =
      '<div class="loading">جارٍ تحميل مفاتيح الإدارة...</div>';

    try {
      const [pinnedResult, normalResult] = await Promise.all([
        db.from('nusuk_codes')
          .select('id,code,is_pinned,created_at')
          .eq('is_pinned', true)
          .order('created_at', { ascending: false }),

        db.from('nusuk_codes')
          .select('id,code,is_pinned,created_at')
          .eq('is_pinned', false)
          .order('created_at', { ascending: false })
          .limit(100)
      ]);

      if (pinnedResult.error) throw pinnedResult.error;
      if (normalResult.error) throw normalResult.error;

      const pinnedCodes = pinnedResult.data || [];
      const normalCodes = normalResult.data || [];

      container.innerHTML = '';

      if (!pinnedCodes.length && !normalCodes.length) {
        container.innerHTML =
          '<div class="empty">لا توجد مفاتيح لإدارتها.</div>';
        return;
      }

      const heading1 = document.createElement('h3');
      heading1.textContent =
        'المفاتيح المميزة (' + pinnedCodes.length + ')';

      container.append(heading1);

      pinnedCodes.forEach(c => addAdminRow(container, c));

      const heading2 = document.createElement('h3');
      heading2.textContent = 'المفاتيح العادية (أحدث 100)';

      container.append(heading2);

      normalCodes.forEach(c => addAdminRow(container, c));

    } catch (error) {
      console.error('Admin load error:', error);
      container.textContent =
        'تعذر تحميل المفاتيح: ' + error.message;
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
    try {
      if (
        cfg.SUPABASE_URL &&
        cfg.SUPABASE_ANON_KEY &&
        window.supabase &&
        typeof window.supabase.createClient === 'function'
      ) {
        db = window.supabase.createClient(
          cfg.SUPABASE_URL,
          cfg.SUPABASE_ANON_KEY
        );
      }
    } catch (error) {
      console.error('Supabase initialization error:', error);
    }

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
        if (!db) {
          $('loginResult').textContent =
            'تعذر الاتصال بقاعدة البيانات.';
          return;
        }

        const { data, error } = await db.auth.signInWithPassword({
          email: $('adminEmail').value,
          password: $('adminPassword').value
        });

        if (error) {
          $('loginResult').className = 'result error';
          $('loginResult').textContent =
            'تعذر تسجيل الدخول: ' + error.message;
          return;
        }

        adminUser = data.user;

        const { data: row, error: adminError } = await db
          .from('site_admins')
          .select('user_id')
          .eq('user_id', adminUser.id)
          .maybeSingle();

        if (adminError || !row) {
          await db.auth.signOut();
          adminUser = null;

          $('loginResult').className = 'result error';
          $('loginResult').textContent =
            'هذا الحساب ليس لديه صلاحية إدارة.';
          return;
        }

        $('adminLogin').hidden = true;
        $('adminTools').hidden = false;

        adminLoad();
      };
    }

    if ($('addPinnedBtn')) {
      $('addPinnedBtn').onclick = addPinnedCode;
    }

    if ($('pinnedCodeInput')) {
      $('pinnedCodeInput').addEventListener('keydown', event => {
        if (event.key === 'Enter') {
          event.preventDefault();
          addPinnedCode();
        }
      });
    }

    if ($('adminRefresh')) {
      $('adminRefresh').onclick = adminLoad;
    }

    if ($('logoutBtn')) {
      $('logoutBtn').onclick = async () => {
        if (db) await db.auth.signOut();

        adminUser = null;

        $('adminTools').hidden = true;
        $('adminLogin').hidden = false;
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
