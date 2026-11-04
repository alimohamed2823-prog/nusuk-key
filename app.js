
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const cfg = window.NUSUK_CONFIG || {};
  const PIN = 'NG-moe8R4N6';
  const LINK = 'https://services.nusuk.sa/app?p=27&id=';
  const hiddenKey = 'nusuk_keys_hidden_v1';

  let db = null;
  let allCodes = [];
  let page = 1;
  const pageSize = 30;
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
    if (code !== PIN) {
      hidden.add(code);
      saveHidden();
    }
  }

  function updateStats() {
    const visible = allCodes.filter(c => c.is_pinned || !hidden.has(c.code));

    $('totalCount').textContent = allCodes.length.toLocaleString('en-US');
    $('todayCount').textContent = allCodes.filter(c =>
      new Date(c.created_at).toDateString() === new Date().toDateString()
    ).length.toLocaleString('en-US');
    $('usedCount').textContent = hidden.size.toLocaleString('en-US');
    $('shownCount').textContent = visible.length.toLocaleString('en-US');
  }

  function setTab(tab) {
    document.querySelectorAll('.tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    $('codesPanel').hidden = tab !== 'codes';
    $('sharePanel').hidden = tab !== 'share';
    $('adminPanel').hidden = true;
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

    const q = $('searchInput').value.trim().toLowerCase();

    let arr = allCodes.filter(c =>
      !c.is_pinned && !hidden.has(c.code) &&
      c.code.toLowerCase().includes(q)
    );

    const sort = $('sortSelect').value;
    if (sort === 'old') arr.reverse();
    if (sort === 'random') arr.sort(() => Math.random() - 0.5);

    const pinned = allCodes.find(c => c.is_pinned) || {
      code: PIN,
      is_pinned: true
    };

    if (pinned.code.toLowerCase().includes(q)) {
      pin.append(card(pinned));
    }

    const slice = arr.slice(0, page * pageSize);

    if (!slice.length && !pin.children.length) {
      list.innerHTML = '<div class="empty">لا توجد مفاتيح ظاهرة.</div>';
    } else {
      slice.forEach(c => list.append(card(c)));
    }

    $('loadMore').hidden = slice.length >= arr.length;
    $('loadMore').textContent = 'عرض المزيد';
    updateStats();
  }

  async function load() {
    if (!db) {
      allCodes = [{
        code: PIN,
        is_pinned: true,
        created_at: new Date().toISOString()
      }];
      $('codesList').innerHTML =
        '<div class="empty">تعذر الاتصال بقاعدة البيانات. راجع إعدادات Supabase.</div>';
      render();
      return;
    }

    $('codesList').innerHTML = '<div class="loading">جارٍ تحميل المفاتيح...</div>';

    try {
      const { data, error } = await db
        .from('nusuk_codes')
        .select('id,code,is_pinned,created_at')
        .order('created_at', { ascending: false })
        .limit(10000);

      if (error) throw error;

      allCodes = data || [];

      if (!allCodes.some(c => c.code === PIN)) {
        allCodes.unshift({
          code: PIN,
          is_pinned: true,
          created_at: new Date().toISOString()
        });
      }

      page = 1;
      render();
    } catch (error) {
      console.error('Load error:', error);
      $('codesList').textContent = 'تعذر تحميل المفاتيح: ' + error.message;
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

    const validCodes = unique.filter(valid).filter(c => c !== PIN);
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
          (errors[0] || 'خطأ غير معروف') +
          '\nافتح Console إذا احتجنا تفاصيل إضافية.'
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

  async function adminLoad() {
    if (!db) return;

    const { data, error } = await db
      .from('nusuk_codes')
      .select('id,code,is_pinned')
      .order('created_at', { ascending: false })
      .limit(100);

    $('adminCodes').innerHTML = '';

    if (error) {
      toast('تعذر تحميل المفاتيح');
      console.error(error);
      return;
    }

    (data || []).filter(c => !c.is_pinned).forEach(c => {
      const row = document.createElement('div');
      row.className = 'admin-code';

      const span = document.createElement('span');
      span.textContent = c.code;

      const del = document.createElement('button');
      del.className = 'delete-btn';
      del.textContent = 'حذف';

      del.onclick = async () => {
        if (!confirm('حذف هذا المفتاح من قائمة الجميع؟')) return;

        const { error } = await db
          .from('nusuk_codes')
          .delete()
          .eq('id', c.id);

        if (error) {
          toast('تعذر الحذف');
          console.error(error);
        } else {
          toast('تم حذف المفتاح');
          adminLoad();
          load();
        }
      };

      row.append(span, del);
      $('adminCodes').append(row);
    });
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

    $('searchInput').addEventListener('input', () => {
      page = 1;
      render();
    });

    $('sortSelect').addEventListener('change', () => {
      page = 1;
      render();
    });

    $('loadMore').onclick = () => {
      page++;
      render();
    };

    $('refreshBtn').onclick = load;

    $('clearHidden').onclick = () => {
      hidden.clear();
      saveHidden();
      render();
      toast('تم إظهار كل المفاتيح مرة أخرى');
    };

    $('submitCodes').addEventListener('click', event => {
      event.preventDefault();
      shareCodes();
    });

    $('adminToggle').onclick = () => {
      $('codesPanel').hidden = true;
      $('sharePanel').hidden = true;
      $('adminPanel').hidden = false;
    };

    $('loginBtn').onclick = async () => {
      if (!db) {
        $('loginResult').textContent = 'تعذر الاتصال بقاعدة البيانات.';
        return;
      }

      const { data, error } = await db.auth.signInWithPassword({
        email: $('adminEmail').value,
        password: $('adminPassword').value
      });

      if (error) {
        $('loginResult').className = 'result error';
        $('loginResult').textContent = 'تعذر تسجيل الدخول: ' + error.message;
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
        $('loginResult').className = 'result error';
        $('loginResult').textContent = 'هذا الحساب ليس لديه صلاحية إدارة.';
        return;
      }

      $('adminLogin').hidden = true;
      $('adminTools').hidden = false;
      adminLoad();
    };

    $('adminRefresh').onclick = adminLoad;

    $('logoutBtn').onclick = async () => {
      if (db) await db.auth.signOut();
      adminUser = null;
      $('adminTools').hidden = true;
      $('adminLogin').hidden = false;
    };

    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
