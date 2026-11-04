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
  } catch {
    hidden = new Set();
  }

  const valid = s => /^NG-[A-Za-z0-9]{8}$/.test(s);

  function message(text, type = 'error') {
    const el = $('submitResult');
    if (!el) return;
    el.className = 'result ' + type;
    el.textContent = text;
  }

  function toast(msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2500);
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

    const code = document.createElement('span');
    code.className = 'code-value';
    code.textContent = c.code;

    top.append(label);

    if (c.is_pinned) {
      const badge = document.createElement('span');
      badge.className = 'pin-badge';
      badge.textContent = 'مميز';
      top.append(badge);
    }

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

    list.innerHTML = '';
    pin.innerHTML = '';

    const q = $('searchInput').value.trim().toLowerCase();

    let arr = allCodes.filter(c =>
      !c.is_pinned &&
      !hidden.has(c.code) &&
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
      list.innerHTML = '<div class="empty">لا توجد مفاتيح ظاهرة. جرّب البحث أو أضف مفاتيح جديدة.</div>';
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
      $('codesList').innerHTML =
        '<div class="empty">تعذر تحميل المفاتيح: ' + error.message + '</div>';
    }
  }

  async function shareCodes() {
    const btn = $('submitCodes');

    try {
      const raw = $('bulkCodes').value;

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
        message('لم نعثر على مفاتيح صحيحة. تأكد من صيغة المفاتيح.');
        return;
      }

      if (!db) {
        message('الاتصال بقاعدة البيانات غير متاح. راجع إعدادات Supabase.');
        return;
      }

      btn.disabled = true;

      let added = 0;
      let failed = 0;
      let completed = 0;

      const totalBatches = Math.ceil(validCodes.length / 300);

      for (let i = 0; i < validCodes.length; i += 300) {
        const batch = validCodes.slice(i, i + 300);

        btn.textContent =
          `جارٍ إرسال الدفعة ${Math.ceil((i + 1) / 300)} من ${totalBatches}...`;

        message(
          `تم تجهيز ${validCodes.length} مفتاح. جارٍ إرسال ${completed} من ${validCodes.length}...`,
          'success'
        );

        const rows = batch.map(code => ({
          code,
          is_pinned: false
        }));

        try {
          const { data, error } = await db
            .from('nusuk_codes')
            .upsert(rows, {
              onConflict: 'code',
              ignoreDuplicates: true
            })
            .select('id');

          if (error) throw error;

          added += (data || []).length;
          completed += batch.length;

        } catch (error) {
          console.error('Batch error:', error);
          failed += batch.length;
          completed += batch.length;
        }
      }

      const duplicates = validCodes.length - added - failed;

      if (failed === validCodes.length) {
        message(
          'فشل إرسال جميع المفاتيح. السبب: تحقق من صلاحيات قاعدة البيانات. ' +
          'التفاصيل: افتح Console لمراجعة الخطأ.',
          'error'
        );
      } else {
        message(
          `انتهى الإرسال.\n` +
          `مفاتيح جديدة: ${added}\n` +
          `مكررة: ${duplicates}\n` +
          `غير صالحة: ${invalid}\n` +
          `دفعات فاشلة: ${failed}`,
          failed ? 'error' : 'success'
        );

        if (failed === 0) {
          $('bulkCodes').value = '';
        }

        await load();
      }

    } catch (error) {
      console.error('Share error:', error);
      message('حدث خطأ أثناء الإرسال: ' + error.message);
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

    $('submitCodes').onclick = shareCodes;

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
        $('loginResult').textContent = 'تعذر تسجيل الدخول.';
        return;
      }

      adminUser = data.user;

      const { data: row } = await db
        .from('site_admins')
        .select('user_id')
        .eq('user_id', adminUser.id)
        .maybeSingle();

      if (!row) {
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
