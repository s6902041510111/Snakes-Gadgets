/* =========================================================
   teacher.js — ตัวควบคุมหน้าแผงครูผู้สอน (index.html)
   เข้าสู่ระบบ → จัดการชุดกิจกรรม → เปิดห้องเล่น
   ========================================================= */
(function (global) {
  'use strict';

  var ITS = global.ITS;
  var store = ITS.store, game = ITS.game, ui = ITS.ui, sets = ITS.sets, rooms = ITS.rooms;
  var el = ui.el, h = ui.h, esc = game.escapeHtml;
  var KEY = store.KEYS;

  var DEFAULT_USER = 'Sathita';
  var DEFAULT_PASS = '1234';
  var LOGIN_FLAG = 'itsc:v1:login';
  var state = { teacher: DEFAULT_USER, query: '' };

  /* =======================================================
     0. ตัวช่วยเล็ก ๆ
     ======================================================= */
  function prefs() {
    var p = store.read(KEY.prefs);
    if (!p || typeof p !== 'object') p = {};
    return p;
  }
  function savePrefs(patch) {
    var p = prefs();
    Object.keys(patch).forEach(function (k) { p[k] = patch[k]; });
    store.write(KEY.prefs, p);
  }
  function loggedIn() {
    try { return sessionStorage.getItem(LOGIN_FLAG) === '1'; } catch (e) { return false; }
  }
  function markLoggedIn(on) {
    try { on ? sessionStorage.setItem(LOGIN_FLAG, '1') : sessionStorage.removeItem(LOGIN_FLAG); }
    catch (e) { /* ignore */ }
  }
  function stamp() {
    var d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
      '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  }

  /* =======================================================
     1. ระบบเข้าสู่ระบบ (Teacher Auth)
     ======================================================= */
  function ensureAuth() {
    var a = store.read(KEY.auth) || {};
    if (a.username && a.password) return Promise.resolve(a);
    return store.hashPassword(DEFAULT_PASS).then(function (pw) {
      var rec = {
        username: DEFAULT_USER,
        password: pw,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      store.write(KEY.auth, rec);
      return rec;
    });
  }

  function attemptLogin(user, pass) {
    var a = store.read(KEY.auth) || {};
    var okUser = String(user || '').trim().toLowerCase() === String(a.username || '').toLowerCase();
    return store.verifyPassword(a.password, pass).then(function (okPass) {
      return okUser && okPass;
    });
  }

  function bindLogin() {
    var form = el('loginForm');
    var errBox = el('loginError');
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      errBox.classList.add('hidden');
      var u = el('loginUser').value;
      var p = el('loginPass').value;
      ensureAuth().then(function () {
        return attemptLogin(u, p);
      }).then(function (ok) {
        if (!ok) {
          errBox.textContent = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';
          errBox.classList.remove('hidden');
          form.classList.remove('shake');
          void form.offsetWidth;
          form.classList.add('shake');
          el('loginPass').select();
          return;
        }
        var a = store.read(KEY.auth) || {};
        state.teacher = a.username || DEFAULT_USER;
        savePrefs({ lastTeacher: state.teacher });
        markLoggedIn(true);
        ui.SFX.correct();
        enterApp();
      });
    });
  }

  /* =======================================================
     2. สลับหน้าจอ
     ======================================================= */
  function showLogin() {
    el('viewApp').classList.add('hidden');
    el('viewLogin').classList.remove('hidden');
    el('loginUser').focus();
  }

  function enterApp() {
    el('viewLogin').classList.add('hidden');
    el('viewApp').classList.remove('hidden');
    el('helloTeacher').innerHTML = 'สวัสดีครู <b class="neon-cyan">' + esc(state.teacher) + '</b> 👋';
    renderAll();
  }

  function bindLogout() {
    el('btnLogout').addEventListener('click', function () {
      ui.confirm({
        title: 'ออกจากระบบ',
        message: 'ต้องการออกจากหน้าครูผู้สอนใช่หรือไม่? (ข้อมูลชุดกิจกรรมและผลคะแนนยังอยู่ครบ)',
        okLabel: 'ออกจากระบบ'
      }).then(function (ok) {
        if (!ok) return;
        markLoggedIn(false);
        showLogin();
        el('loginPass').value = '';
        ui.toast('ออกจากระบบแล้ว', 'info');
      });
    });
  }

  /* =======================================================
     3. แผงสถิติ
     ======================================================= */
  function renderStats() {
    var list = sets.list();
    var terms = 0;
    list.forEach(function (s) { terms += (s.items || []).length; });
    var t = rooms.totals();
    el('statSets').textContent = String(list.length);
    el('statTerms').textContent = String(terms);
    el('statSessions').textContent = String(t.rooms);
    el('statPlayers').textContent = String(t.players);
    var kb = store.estimateUsage() / 1024;
    var chip = el('storageChip');
    if (chip) {
      chip.textContent = '💾 ' + kb.toFixed(1) + ' KB';
      chip.title = store.storageAvailable
        ? 'พื้นที่จัดเก็บข้อมูลในเบราว์เซอร์ (LocalStorage + BroadcastChannel)'
        : 'LocalStorage ใช้ไม่ได้ — ข้อมูลจะอยู่ในหน่วยความจำของหน้านี้เท่านั้น';
    }
  }

  /* =======================================================
     4. การ์ดชุดกิจกรรม
     ======================================================= */
  function setCard(s) {
    var n = (s.items || []).length;
    var badges = h('div', { class: 'row wrapy', style: 'gap:6px;margin-top:8px' }, [
      h('span', { class: 'chip chip-cyan', text: s.gridSize + 'x' + s.gridSize }),
      h('span', { class: 'chip chip-purple', text: n + ' อุปกรณ์' }),
      h('span', { class: 'chip chip-green', text: s.rounds + ' รอบ' }),
      h('span', { class: 'chip', text: 'กระดาน ' + (s.trackLength || 30) + ' ช่อง' })
    ]);

    var actions = h('div', { class: 'row wrapy', style: 'margin-top:12px;gap:6px' }, [
      h('button', {
        class: 'btn btn-cyan btn-sm grow', onclick: function () { launchSet(s.id); }
      }, '▶️ เปิดห้องเล่น'),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'แก้ไขชุดกิจกรรม', onclick: function () { openSetEditor(s.id); } }, '✏️'),
      h('button', { class: 'btn btn-ghost btn-sm', title: 'ทำสำเนา', onclick: function () { doDuplicate(s.id); } }, '⧉'),
      h('button', { class: 'btn btn-danger btn-sm', title: 'ลบชุดกิจกรรม', onclick: function () { doRemove(s.id); } }, '🗑️')
    ]);

    return h('div', { class: 'glass-soft set-card', style: 'border:1px solid var(--line)' }, [
      h('div', { class: 'row-between' }, [
        h('div', { class: 'pname grow' }, [
          h('span', { text: (s.items && s.items[0] ? s.items[0].icon : '🗂️') + ' ' }),
          h('span', { class: 'neon-cyan', text: s.name })
        ]),
        s.builtin ? h('span', { class: 'chip chip-amber', text: 'สำเร็จรูป' }) : null
      ]),
      h('div', { class: 'tiny muted', style: 'margin-top:2px' }, [
        h('span', { text: (s.grade || 'ไม่ระบุระดับ') + ' · แก้ไข ' + ui.timeAgo(s.updatedAt) })
      ]),
      s.description ? h('div', { class: 'tiny muted', style: 'margin-top:6px', text: s.description }) : null,
      badges,
      actions
    ]);
  }

  function renderSets() {
    var grid = el('setsGrid');
    grid.innerHTML = '';
    var q = state.query.trim().toLowerCase();
    var list = sets.list().filter(function (s) {
      if (!q) return true;
      if (String(s.name).toLowerCase().indexOf(q) !== -1) return true;
      if (String(s.grade || '').toLowerCase().indexOf(q) !== -1) return true;
      return (s.items || []).some(function (i) {
        return String(i.term).toLowerCase().indexOf(q) !== -1 ||
          String(i.meaning).toLowerCase().indexOf(q) !== -1;
      });
    });

    if (!list.length) {
      grid.appendChild(h('div', { class: 'empty', style: 'grid-column:1/-1' }, [
        h('div', { class: 'ico', text: q ? '🔍' : '🗂️' }),
        h('div', { text: q ? 'ไม่พบชุดกิจกรรมที่ค้นหา' : 'ยังไม่มีชุดกิจกรรม กด "สร้างชุดใหม่" เพื่อเริ่มต้น' })
      ]));
      return;
    }
    list.forEach(function (s) { grid.appendChild(setCard(s)); });
  }

  function doDuplicate(id) {
    var r = sets.duplicate(id);
    if (r.ok) { ui.SFX.correct(); ui.toast('ทำสำเนาชุดกิจกรรมแล้ว', 'ok'); }
    else ui.toast(r.errors[0], 'err');
  }

  function doRemove(id) {
    var s = sets.get(id);
    if (!s) return;
    ui.confirm({
      title: 'ลบชุดกิจกรรม',
      message: 'ต้องการลบชุด "' + s.name + '" ใช่หรือไม่?',
      detail: 'ผลการเล่นที่เคยใช้ชุดนี้จะยังคงอยู่ในประวัติ',
      okLabel: 'ลบเลย', danger: true
    }).then(function (ok) {
      if (!ok) return;
      sets.remove(id);
      ui.toast('ลบชุดกิจกรรมแล้ว', 'info');
    });
  }

  /* =======================================================
     5. ตัวแก้ไขชุดกิจกรรม (Set Editor)
     ======================================================= */
  var ICON_PRESETS = ['🖥️', '🧠', '🎮', '💾', '🖱️', '⌨️', '🖨️', '🕸️', '📶', '💡', '📀', '🔌', '🗂️', '📁', '🌐', '🔐', '📷', '🔊', '🔋', '🧩', '☁️', '📊', '⚙️', '🧰', '🕹️', '📡'];

  function parsePairs(text) {
    return String(text || '')
      .split(/[\n,;]+/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean)
      .map(function (line) {
        var m = line.match(/(-?\d+)\s*(?:->|→|=>|,|\s+)\s*(-?\d+)/);
        return m ? [Number(m[1]), Number(m[2])] : null;
      })
      .filter(Boolean)
      .filter(function (p) { return p[0] !== p[1]; });
  }

  function openSetEditor(setId) {
    var existing = setId ? sets.get(setId) : null;
    var draft = existing ? JSON.parse(JSON.stringify(existing)) : {
      name: '', grade: '', description: '',
      gridSize: 4, rounds: 8, trackLength: 30,
      winPatterns: ['row', 'col', 'diag'],
      snakesLadders: { ladders: [], snakes: [] },
      items: []
    };
    if (!draft.items.length) {
      for (var i = 0; i < 9; i++) {
        draft.items.push({ id: game.uid('itm'), term: '', meaning: '', icon: '💻', category: 'ทั่วไป' });
      }
    }

    var body = h('div', { class: 'stack', style: 'gap:14px' });
    var errBox = h('div', { class: 'chip chip-red hidden', style: 'white-space:normal;display:block;line-height:1.7' });

    /* --- ข้อมูลหลัก --- */
    var fName = h('input', { class: 'input', value: draft.name, placeholder: 'เช่น อุปกรณ์ไอทีพื้นฐาน' });
    var fGrade = h('input', { class: 'input', value: draft.grade || '', placeholder: 'เช่น ป.4 – ม.1' });
    var fDesc = h('textarea', { class: 'textarea', placeholder: 'คำอธิบายชุดกิจกรรม (ไม่บังคับ)' });
    fDesc.value = draft.description || '';

    body.appendChild(h('div', { class: 'grid gap-3', style: 'grid-template-columns:2fr 1fr' }, [
      h('div', { class: 'field' }, [h('label', { class: 'label', text: 'ชื่อชุดกิจกรรม *' }), fName]),
      h('div', { class: 'field' }, [h('label', { class: 'label', text: 'ระดับชั้น' }), fGrade])
    ]));
    body.appendChild(h('div', { class: 'field' }, [h('label', { class: 'label', text: 'คำอธิบาย' }), fDesc]));

    /* --- ตัวเลือกเกม --- */
    var sizeOpts = h('div', { class: 'row wrapy', style: 'gap:8px' });
    [3, 4].forEach(function (n) {
      var b = h('button', {
        type: 'button',
        class: 'btn btn-sm size-opt' + (Number(draft.gridSize) === n ? ' on' : ''),
        onclick: function () {
          draft.gridSize = n;
          [].forEach.call(sizeOpts.children, function (c) { c.classList.remove('on'); });
          b.classList.add('on');
          updateSlotHint();
          ui.SFX.click();
        }
      }, n + ' x ' + n + ' ช่อง');
      sizeOpts.appendChild(b);
    });

    var fRounds = h('input', { class: 'input', type: 'number', min: '1', max: '40', value: String(draft.rounds || 8) });
    var fTrack = h('input', { class: 'input', type: 'number', min: '10', max: '60', value: String(draft.trackLength || 30) });

    var patWrap = h('div', { class: 'row wrapy', style: 'gap:8px' });
    var PATTERNS = [
      { key: 'row', label: 'แถว (Row)' },
      { key: 'col', label: 'คอลัมน์ (Col)' },
      { key: 'diag', label: 'ทแยง (Diag)' }
    ];
    PATTERNS.forEach(function (p) {
      var on = (draft.winPatterns || []).indexOf(p.key) !== -1;
      var b = h('button', {
        type: 'button',
        class: 'btn btn-sm pattern-opt' + (on ? ' on' : ''),
        onclick: function () {
          var list = draft.winPatterns || (draft.winPatterns = []);
          var idx = list.indexOf(p.key);
          if (idx === -1) list.push(p.key); else list.splice(idx, 1);
          b.classList.toggle('on');
          ui.SFX.click();
        }
      }, p.label);
      patWrap.appendChild(b);
    });

    var slotHint = h('div', { class: 'tiny neon-amber' });
    function updateSlotHint() {
      var need = Number(draft.gridSize) * Number(draft.gridSize);
      var have = draft.items.filter(function (i) { return String(i.term || '').trim(); }).length;
      slotHint.textContent = 'กระดานต้องมีอุปกรณ์อย่างน้อย ' + need + ' รายการ (ตอนนี้มี ' + have + ')';
      slotHint.style.color = have >= need ? 'var(--green)' : 'var(--amber)';
    }

    body.appendChild(h('div', { class: 'glass-soft', style: 'border:1px solid var(--line)' }, [
      h('div', { class: 'panel-title', style: 'margin-bottom:10px' }, [h('span', { class: 'dot' }), h('span', { text: 'กติกาเกม' })]),
      h('div', { class: 'grid gap-3', style: 'grid-template-columns:repeat(auto-fit,minmax(150px,1fr))' }, [
        h('div', { class: 'field' }, [h('label', { class: 'label', text: 'ขนาดกระดานนักเรียน' }), sizeOpts]),
        h('div', { class: 'field' }, [h('label', { class: 'label', text: 'จำนวนรอบคำถาม' }), fRounds]),
        h('div', { class: 'field' }, [h('label', { class: 'label', text: 'จำนวนช่องกระดานรวม' }), fTrack]),
        h('div', { class: 'field' }, [h('label', { class: 'label', text: 'รูปแบบชนะ (บิงโก)' }), patWrap])
      ]),
      h('div', { class: 'tiny muted', style: 'margin-top:8px', text: 'คำใบ้: ต้องมีอย่างน้อย 1 รูปแบบที่เลือกไว้' })
    ]));
    updateSlotHint();

    /* --- ตารางอุปกรณ์ --- */
    var itemHead = h('tr', {}, [
      h('th', { style: 'width:62px', text: 'ไอคอน' }),
      h('th', { style: 'width:150px', text: 'ชื่ออุปกรณ์ *' }),
      h('th', { text: 'ความหมาย / คำใบ้ *' }),
      h('th', { style: 'width:120px', text: 'หมวดหมู่' }),
      h('th', { style: 'width:44px', text: '' })
    ]);
    var itemBody = h('tbody');
    var itemTable = h('table', { class: 'table' }, [h('thead', {}, [itemHead]), itemBody]);

    /** เก็บค่าที่พิมพ์อยู่ตอนนี้ลง draft.items ก่อน (กันกด "เพิ่มแถว/ลบแถว" แล้วข้อมูลในช่องหาย) */
    function syncDraft() {
      [].forEach.call(itemBody.children, function (row, idx) {
        var r = row._refs;
        if (!r) return;
        var it = draft.items[idx];
        if (!it) { it = draft.items[idx] = { id: game.uid('itm') }; }
        it.term = r.termInput.value.trim();
        it.meaning = r.meanInput.value.trim();
        it.icon = r.iconInput.value.trim() || '💻';
        it.category = r.catInput.value.trim() || 'ทั่วไป';
      });
    }

    function drawItems() {
      itemBody.innerHTML = '';
      draft.items.forEach(function (it, idx) {
        var iconInput = h('input', { class: 'input', value: it.icon || '💻', maxlength: '4' });
        var termInput = h('input', { class: 'input', value: it.term || '', placeholder: 'เช่น CPU' });
        var meanInput = h('input', { class: 'input', value: it.meaning || '', placeholder: 'เช่น สมองของคอมพิวเตอร์...' });
        var catInput = h('input', { class: 'input', value: it.category || 'ทั่วไป' });
        var row = h('tr', { class: 'item-row' }, [
          h('td', {}, [iconInput]),
          h('td', {}, [termInput]),
          h('td', {}, [meanInput]),
          h('td', {}, [catInput]),
          h('td', {}, [h('button', {
            class: 'btn btn-danger btn-sm btn-icon', title: 'ลบแถวนี้',
            onclick: function () {
              syncDraft();
              draft.items.splice(idx, 1);
              drawItems(); updateSlotHint(); ui.SFX.click();
            }
          }, '✕')])
        ]);
        row._refs = { iconInput, termInput, meanInput, catInput };
        itemBody.appendChild(row);
      });
    }
    drawItems();

    function collectItems() {
      var out = [];
      [].forEach.call(itemBody.children, function (row, idx) {
        var r = row._refs;
        var term = r.termInput.value.trim();
        if (!term) return;
        out.push({
          id: (draft.items[idx] && draft.items[idx].id) || game.uid('itm'),
          term: term,
          meaning: r.meanInput.value.trim(),
          icon: r.iconInput.value.trim() || '💻',
          category: r.catInput.value.trim() || 'ทั่วไป'
        });
      });
      return out;
    }

    var iconPicker = h('div', { class: 'row wrapy scroll-y', style: 'gap:4px;max-height:88px' },
      ICON_PRESETS.map(function (ic) {
        return h('button', {
          type: 'button', class: 'btn btn-ghost btn-sm', style: 'padding:4px 7px;font-size:1.05rem',
          title: 'ใช้ไอคอนนี้กับช่องที่เลือกในตาราง',
          onclick: function () { fillIcon(ic); }
        }, ic);
      }));

    function fillIcon(ic) {
      var first = itemBody.querySelector('input');
      if (first) { first.value = ic; ui.SFX.click(); ui.toast('ตั้งไอคอนช่องแรกเป็น ' + ic, 'info', 1400); }
    }

    body.appendChild(h('div', { class: 'glass-soft', style: 'border:1px solid var(--line)' }, [
      h('div', { class: 'row-between', style: 'margin-bottom:10px' }, [
        h('div', { class: 'panel-title' }, [h('span', { class: 'dot' }), h('span', { text: 'รายการอุปกรณ์ไอที' })]),
        h('div', { class: 'row' }, [
          slotHint,
          h('button', {
            class: 'btn btn-green btn-sm', type: 'button',
            onclick: function () {
              syncDraft();
              draft.items.push({ id: game.uid('itm'), term: '', meaning: '', icon: '💻', category: 'ทั่วไป' });
              drawItems(); updateSlotHint(); ui.SFX.click();
            }
          }, '➕ เพิ่มแถว')
        ])
      ]),
      h('div', { class: 'scroll-y', style: 'max-height:44vh' }, [itemTable]),
      h('div', { class: 'tiny muted', style: 'margin:8px 0 4px', text: 'คลิกไอคอนด้านล่างเพื่อใส่ลงช่องแรก:' }),
      iconPicker
    ]));

    /* --- บันได / งู --- */
    var fLadders = h('textarea', { class: 'textarea', style: 'min-height:64px', placeholder: 'เช่น 3→8, 7→14, 17→24' });
    var fSnakes = h('textarea', { class: 'textarea', style: 'min-height:64px', placeholder: 'เช่น 25→16, 29→20' });
    function pairsToText(pairs) {
      return (pairs || []).map(function (p) { return p[0] + '→' + p[1]; }).join(', ');
    }
    fLadders.value = pairsToText(draft.snakesLadders && draft.snakesLadders.ladders);
    fSnakes.value = pairsToText(draft.snakesLadders && draft.snakesLadders.snakes);

    body.appendChild(h('div', { class: 'glass-soft', style: 'border:1px solid var(--line)' }, [
      h('div', { class: 'row-between', style: 'margin-bottom:10px' }, [
        h('div', { class: 'panel-title' }, [h('span', { class: 'dot' }), h('span', { text: 'บันได ⬆️ และ งู 🐍' })]),
        h('button', {
          class: 'btn btn-ghost btn-sm', type: 'button',
          onclick: function () {
            var auto = ITS.dataset.autoSnakesLadders(Number(fTrack.value) || 30, collectItems().map(function (i) { return i.id; }));
            fLadders.value = pairsToText(auto.ladders);
            fSnakes.value = pairsToText(auto.snakes);
            ui.SFX.click();
            ui.toast('สุ่มบันได/งูให้อัตโนมัติแล้ว', 'ok');
          }
        }, '🎲 สุ่มอัตโนมัติ')
      ]),
      h('div', { class: 'grid gap-3', style: 'grid-template-columns:1fr 1fr' }, [
        h('div', { class: 'field' }, [h('label', { class: 'label', text: 'บันได (ขยับขึ้น)' }), fLadders]),
        h('div', { class: 'field' }, [h('label', { class: 'label', text: 'งู (ถูกกิน ถอยหลัง)' }), fSnakes])
      ]),
      h('div', { class: 'tiny muted', style: 'margin-top:6px', text: 'เขียนเป็น "ต้นทาง→ปลายทาง" คั่นด้วยจุลภาค ตัวเลขต้องอยู่ในช่วง 0 – จำนวนช่องกระดานรวม' })
    ]));

    body.appendChild(errBox);

    var m = ui.modal({
      title: existing ? '✏️ แก้ไขชุดกิจกรรม' : '➕ สร้างชุดกิจกรรมใหม่',
      wide: true,
      content: body,
      actions: [
        { label: 'ยกเลิก', class: 'btn-ghost' },
        {
          label: '💾 บันทึกชุดกิจกรรม', class: 'btn-cyan', onClick: function () {
            if (!draft.winPatterns || !draft.winPatterns.length) {
              errBox.textContent = '❌ ต้องเลือกอย่างน้อย 1 รูปแบบชนะ (แถว/คอลัมน์/ทแยง)';
              errBox.classList.remove('hidden');
              ui.SFX.wrong();
              return false;
            }
            var payload = {
              name: fName.value,
              grade: fGrade.value,
              description: fDesc.value,
              gridSize: draft.gridSize,
              rounds: Number(fRounds.value) || 8,
              trackLength: Number(fTrack.value) || 30,
              winPatterns: draft.winPatterns,
              snakesLadders: { ladders: parsePairs(fLadders.value), snakes: parsePairs(fSnakes.value) },
              items: collectItems()
            };
            var r = existing ? sets.update(existing.id, payload) : sets.create(payload);
            if (!r.ok) {
              errBox.textContent = '❌ ' + r.errors.join(' • ');
              errBox.classList.remove('hidden');
              ui.SFX.wrong();
              return false;
            }
            ui.SFX.correct();
            ui.toast(existing ? 'บันทึกชุดกิจกรรมแล้ว' : 'สร้างชุดกิจกรรมใหม่แล้ว', 'ok');
            return true;
          }
        }
      ]
    });
    return m;
  }

  /* =======================================================
     6. ประวัติการเล่น
     ======================================================= */
  var STATUS = {
    lobby: { label: 'รอนักเรียนเข้าร่วม', chip: 'chip-cyan' },
    playing: { label: 'กำลังเล่น', chip: 'chip-green' },
    finished: { label: 'จบแล้ว', chip: 'chip-amber' }
  };

  function sessionRow(s) {
    var st = STATUS[s.status] || STATUS.lobby;
    var open = function () { location.href = 'teacher.html?s=' + encodeURIComponent(s.id); };
    return h('div', {
      class: 'prow', style: 'cursor:pointer', title: 'คลิกเพื่อเปิดห้องควบคุม', onclick: open
    }, [
      h('div', { class: 'avatar', style: 'background:linear-gradient(150deg,#9d4edd,#00f3ff)', text: '🎮' }),
      h('div', { class: 'grow' }, [
        h('div', { class: 'pname' }, [
          h('span', { class: 'neon-cyan', text: s.setName || '-' }),
          h('span', { class: 'muted', text: ' · ห้อง ' }),
          h('span', { class: 'mono neon-purple', text: s.joinCode })
        ]),
        h('div', { class: 'pmini', text: '👥 ' + (s.players || []).length + ' คน · ✅ ' + (s.results || []).filter(function (r) { return r.correct; }).length +
          ' คำตอบ · ' + ui.timeAgo(s.createdAt) })
      ]),
      h('span', { class: 'chip ' + st.chip, text: st.label }),
      h('button', {
        class: 'btn btn-ghost btn-sm', title: 'เปิดหน้าจอ Projector',
        onclick: function (ev) { ev.stopPropagation(); global.open('projector.html?s=' + encodeURIComponent(s.id), '_blank'); }
      }, '📽️')
    ]);
  }

  function renderSessions() {
    var box = el('sessionsList');
    box.innerHTML = '';
    var list = rooms.all();
    if (!list.length) {
      box.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'ico', text: '🕹️' }),
        h('div', { text: 'ยังไม่มีประวัติการเล่น — กด "เปิดห้องเล่น" ที่การ์ดชุดกิจกรรมเพื่อเริ่ม' })
      ]));
      return;
    }
    list.slice(0, 25).forEach(function (s) { box.appendChild(sessionRow(s)); });
    if (list.length > 25) {
      box.appendChild(h('div', { class: 'tiny muted center', text: '… และอีก ' + (list.length - 25) + ' ห้อง (ย้อนหลังทั้งหมดอยู่ในข้อมูลที่ส่งออกได้)' }));
    }
  }

  /* =======================================================
     7. เปิดห้องเล่น (Launch)
     ======================================================= */
  function launchSet(setId) {
    var set = sets.get(setId);
    if (!set) { ui.toast('ไม่พบชุดกิจกรรม', 'err'); return; }
    var check = sets.validate(set);
    if (!check.ok) {
      ui.modal({
        title: '⚠️ ยังเปิดห้องเล่นไม่ได้',
        content: h('div', { class: 'stack' }, [
          h('p', { class: 'sm', text: 'ชุดกิจกรรม "' + set.name + '" ยังข้อมูลไม่ครบ:' }),
          h('div', { class: 'stack', style: 'gap:6px' }, check.errors.map(function (e) {
            return h('div', { class: 'chip chip-red', text: e });
          })),
          h('p', { class: 'tiny muted', text: 'กด "แก้ไขชุดกิจกรรม" เพื่อเติมข้อมูลให้ครบก่อน' })
        ]),
        actions: [
          { label: 'ปิด', class: 'btn-ghost' },
          { label: '✏️ แก้ไขชุดกิจกรรม', class: 'btn-cyan', onClick: function () { openSetEditor(setId); } }
        ]
      });
      return;
    }

    var session = rooms.create(set, state.teacher);
    ui.SFX.join();
    var ctrlWin = global.open('teacher.html?s=' + encodeURIComponent(session.id), '_blank');
    var url = ui.joinUrl(session.joinCode);

    var canvas = h('canvas', { width: '420', height: '420', style: 'width:180px;height:180px;image-rendering:pixelated' });
    setTimeout(function () {
      try { if (global.QR) global.QR.toCanvas(canvas, url, { scale: 7, margin: 2 }); } catch (e) { /* ignore */ }
    }, 60);

    var box = h('div', { class: 'stack' }, [
      h('div', { class: 'center stack', style: 'gap:4px' }, [
        h('div', { class: 'tiny muted', text: 'รหัสห้อง (Join Code) — ให้นักเรียนเข้าร่วม' }),
        h('div', { class: 'code-chip', text: session.joinCode })
      ]),
      h('div', { class: 'row', style: 'gap:14px;justify-content:center;align-items:center;flex-wrap:wrap' }, [
        h('div', { class: 'qr-frame' }, [canvas]),
        h('div', { class: 'stack', style: 'gap:8px;min-width:220px' }, [
          h('div', { class: 'chip chip-cyan', text: '🗂️ ' + session.setName }),
          h('div', { class: 'chip chip-purple', text: '🎯 ' + session.rounds + ' รอบคำถาม' }),
          h('div', { class: 'chip chip-green', text: '🎲 กระดาน ' + session.trackLength + ' ช่อง' }),
          h('button', {
            class: 'btn btn-ghost btn-sm',
            onclick: function () {
              ui.copyText(session.joinCode).then(function (ok) {
                ui.toast(ok ? 'คัดลอกรหัสห้องแล้ว' : 'คัดลอกไม่สำเร็จ', ok ? 'ok' : 'err');
              });
            }
          }, '📋 คัดลอกรหัสห้อง'),
          h('button', {
            class: 'btn btn-ghost btn-sm',
            onclick: function () {
              ui.copyText(url).then(function (ok) {
                ui.toast(ok ? 'คัดลอกลิงก์เข้าร่วมแล้ว' : 'คัดลอกไม่สำเร็จ', ok ? 'ok' : 'err');
              });
            }
          }, '🔗 คัดลอกลิงก์เข้าร่วม')
        ])
      ]),
      h('div', { class: 'chip chip-amber', style: 'white-space:normal;display:block;line-height:1.7' },
        '⚠️ เปิดหน้าจอ Projector บนเครื่องที่ต่อเครื่องฉาย แล้วเปิดหน้านักเรียนบนเครื่อง/มือถือที่เข้าห้องนี้\n' +
        'ระบบซิงค์ด้วย LocalStorage + BroadcastChannel → ต้องเปิดทุกหน้าจอบนเครื่องเดียวกัน')
    ]);

    ui.modal({
      title: '🚀 เปิดห้องเล่นแล้ว — ' + session.joinCode,
      content: box,
      onClose: function () { renderAll(); },
      actions: [
        { label: '📽️ เปิดหน้าจอ Projector', class: 'btn-purple', onClick: function () { global.open('projector.html?s=' + encodeURIComponent(session.id), '_blank'); } },
        { label: '🎮 เปิดหน้านักเรียน (ทดลอง)', class: 'btn-ghost', onClick: function () { global.open('student.html?code=' + session.joinCode, '_blank'); } },
        {
          label: '✅ เริ่มควบคุมห้องนี้', class: 'btn-green', onClick: function () {
            if (!ctrlWin) location.href = 'teacher.html?s=' + encodeURIComponent(session.id);
          }
        }
      ]
    });
  }

  /* =======================================================
     8. ตั้งค่า / เปลี่ยนบัญชี / ข้อมูล
     ======================================================= */
  function openSettings() {
    var a = store.read(KEY.auth) || {};
    var p = prefs();

    var fUser = h('input', { class: 'input', value: a.username || DEFAULT_USER, autocomplete: 'username' });
    var fOld = h('input', { class: 'input', type: 'password', placeholder: 'รหัสผ่านเดิม', autocomplete: 'current-password' });
    var fNew = h('input', { class: 'input', type: 'password', placeholder: 'รหัสผ่านใหม่ (อย่างน้อย 4 ตัวอักษร)', autocomplete: 'new-password' });
    var fNew2 = h('input', { class: 'input', type: 'password', placeholder: 'ยืนยันรหัสผ่านใหม่', autocomplete: 'new-password' });
    var errBox = h('div', { class: 'chip chip-red hidden', style: 'white-space:normal;display:block;line-height:1.7' });

    var soundSw = h('div', { class: 'switch' + (p.sound === false ? '' : ' is-on'), role: 'switch' });
    soundSw.addEventListener('click', function () {
      soundSw.classList.toggle('is-on');
      savePrefs({ sound: soundSw.classList.contains('is-on') });
      if (soundSw.classList.contains('is-on')) ui.SFX.correct();
    });

    var form = h('div', { class: 'stack', style: 'gap:12px' }, [
      h('div', { class: 'panel-title' }, [h('span', { class: 'dot' }), h('span', { text: 'บัญชีครูผู้สอน' })]),
      h('div', { class: 'field' }, [h('label', { class: 'label', text: 'ชื่อผู้ใช้ (Username)' }), fUser]),
      h('div', { class: 'divider'}),
      h('div', { class: 'field' }, [h('label', { class: 'label', text: 'รหัสผ่านเดิม (เว้นว่างไว้ถ้าไม่เปลี่ยนรหัสผ่าน)' }), fOld]),
      h('div', { class: 'field' }, [h('label', { class: 'label', text: 'รหัสผ่านใหม่' }), fNew]),
      h('div', { class: 'field' }, [h('label', { class: 'label', text: 'ยืนยันรหัสผ่านใหม่' }), fNew2]),
      errBox
    ]);

    var dataBox = h('div', { class: 'stack', style: 'gap:10px' }, [
      h('div', { class: 'panel-title' }, [h('span', { class: 'dot' }), h('span', { text: 'ข้อมูล & เสียง' })]),
      h('div', { class: 'row-between' }, [
        h('div', {}, [
          h('div', { class: 'sm', text: 'เสียงประกอบเกม' }),
          h('div', { class: 'tiny muted', text: 'เสียงแจ้งเตือนตอนสุ่มคำถาม/ตอบถูก' })
        ]),
        soundSw
      ]),
      h('div', { class: 'divider'}),
      h('div', { class: 'row wrapy', style: 'gap:8px' }, [
        h('button', { class: 'btn btn-ghost btn-sm', onclick: exportAll }, '⬇️ ส่งออกข้อมูลทั้งหมด (JSON)'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: importAll }, '⬆️ นำเข้าข้อมูล'),
        h('button', { class: 'btn btn-ghost btn-sm', onclick: function () { rooms.clearFinished(); ui.toast('ล้างห้องที่จบแล้วทิ้ง', 'info'); } },
          '🧹 ล้างประวัติห้องที่จบแล้ว'),
        h('button', { class: 'btn btn-danger btn-sm', onclick: resetAll }, '♻️ รีเซ็ตข้อมูลทั้งหมด')
      ]),
      h('div', { class: 'tiny muted', text: 'ข้อมูลทั้งหมดถูกเก็บเป็น JSON Object ในเบราว์เซอร์ (LocalStorage) และซิงค์ข้ามหน้าต่างด้วย BroadcastChannel' })
    ]);

    var m = null;
    ui.modal({
      title: '⚙️ ตั้งค่า',
      wide: true,
      content: h('div', { class: 'stack', style: 'gap:16px' }, [form, h('div', { class: 'divider' }), dataBox]),
      actions: [
        { label: 'ยกเลิก', class: 'btn-ghost' },
        {
          label: '💾 บันทึกการตั้งค่า', class: 'btn-cyan', onClick: function () {
            var newUser = fUser.value.trim();
            if (!newUser) { errBox.textContent = '❌ กรุกชื่อผู้ใช้'; errBox.classList.remove('hidden'); return false; }
            var newPass = fNew.value, newPass2 = fNew2.value;
            if (newPass || newPass2) {
              if (newPass.length < 4) { errBox.textContent = '❌ รหัสผ่านใหม่ต้องยาวอย่างน้อย 4 ตัวอักษร'; errBox.classList.remove('hidden'); return false; }
              if (newPass !== newPass2) { errBox.textContent = '❌ ยืนยันรหัสผ่านใหม่ไม่ตรงกัน'; errBox.classList.remove('hidden'); return false; }
            }
            var chain = (newPass || newPass2) ? store.verifyPassword(a.password, fOld.value) : Promise.resolve(true);
            chain.then(function (oldOk) {
              if (!oldOk) { errBox.textContent = '❌ รหัสผ่านเดิมไม่ถูกต้อง'; errBox.classList.remove('hidden'); return; }
              var rec = { username: newUser, password: a.password, updatedAt: new Date().toISOString() };
              if (newPass) {
                store.hashPassword(newPass).then(function (pw) {
                  rec.password = pw;
                  finishSave(rec, newUser);
                });
              } else {
                finishSave(rec, newUser);
              }
              function finishSave(payload, username) {
                store.write(KEY.auth, Object.assign({}, a, payload));
                state.teacher = username;
                savePrefs({ lastTeacher: username });
                errBox.classList.add('hidden');
                ui.SFX.correct();
                ui.toast('บันทึกการตั้งค่าแล้ว', 'ok');
                enterApp();
                m.close();
              }
            });
            return false;
          }
        }
      ],
      onOpen: function (api) { m = api; }
    });
  }

  function exportAll() {
    var snap = store.snapshot();
    ui.download('it-snake-ladder-data-' + stamp() + '.json', JSON.stringify(snap, null, 2));
    ui.toast('ส่งออกไฟล์ JSON แล้ว', 'ok');
  }

  function importAll() {
    var input = h('input', { type: 'file', accept: 'application/json,.json' });
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var snap = JSON.parse(String(reader.result));
          store.importSnapshot(snap);
          ensureAuth().then(function () {
            state.teacher = (store.read(KEY.auth) || {}).username || DEFAULT_USER;
            enterApp();
            ui.SFX.correct();
            ui.toast('นำเข้าข้อมูลสำเร็จ', 'ok');
          });
        } catch (e) {
          ui.toast('เปิดไฟล์ไม่สำเร็จ: ' + (e && e.message), 'err', 4000);
        }
      };
      reader.readAsText(f);
    });
    input.click();
  }

  function resetAll() {
    ui.confirm({
      title: 'รีเซ็ตข้อมูลทั้งหมด',
      message: 'จะลบชุดกิจกรรม ประวัติการเล่น และบัญชีครูทั้งหมด แล้วกลับไปค่าเริ่มต้น (Sathita / 1234)',
      detail: 'แนะนำให้ "ส่งออกข้อมูลทั้งหมด" ก่อนรีเซ็ต',
      okLabel: 'รีเซ็ตทั้งหมด', danger: true
    }).then(function (ok) {
      if (!ok) return;
      store.resetAll();
      state.teacher = DEFAULT_USER;
      ensureAuth().then(function () {
        sets.ensureSeeds();
        markLoggedIn(false);
        showLogin();
        ui.toast('รีเซ็ตข้อมูลเรียบร้อย', 'ok');
      });
    });
  }

  /* =======================================================
     9. ชุดสำเร็จรูป + ค้นหา
     ======================================================= */
  function openPresetPicker() {
    var list = ITS.dataset.presets || [];
    var m = null;
    ui.modal({
      title: '📥 เพิ่มชุดกิจกรรมสำเร็จรูป',
      content: h('div', { class: 'stack', style: 'gap:10px' }, list.map(function (p) {
        return h('div', { class: 'prow' }, [
          h('div', { class: 'avatar', style: 'background:linear-gradient(150deg,#00f3ff,#9d4edd)', text: (p.items[0] && p.items[0].icon) || '🗂️' }),
          h('div', { class: 'grow' }, [
            h('div', { class: 'pname neon-cyan', text: p.name }),
            h('div', { class: 'pmini', text: p.grade + ' · ' + p.items.length + ' อุปกรณ์ · ' + p.description })
          ]),
          h('button', {
            class: 'btn btn-cyan btn-sm',
            onclick: function () {
              var r = sets.importPreset(p.id);
              if (r.ok) { ui.SFX.correct(); ui.toast('เพิ่มชุด "' + p.name + '" แล้ว', 'ok'); m.close(); }
              else ui.toast(r.errors[0], 'err');
            }
          }, 'เพิ่ม')
        ]);
      })),
      actions: [{ label: 'ปิด', class: 'btn-ghost' }],
      onOpen: function (api) { m = api; }
    });
  }

  /* =======================================================
     10. Boot
     ======================================================= */
  function renderAll() {
    renderStats();
    renderSets();
    renderSessions();
  }

  function boot() {
    ui.setSound(prefs().sound !== false);

    ensureAuth().then(function () {
      sets.ensureSeeds();
      if (loggedIn()) {
        state.teacher = (store.read(KEY.auth) || {}).username || DEFAULT_USER;
        enterApp();
      } else {
        showLogin();
      }
    });

    bindLogin();
    bindLogout();
    el('btnSettings').addEventListener('click', openSettings);
    el('btnNewSet').addEventListener('click', function () { openSetEditor(null); });
    el('btnImportPreset').addEventListener('click', openPresetPicker);
    el('btnExportAll').addEventListener('click', exportAll);
    el('btnImportData').addEventListener('click', importAll);
    el('loginPass').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') el('loginForm').requestSubmit ? el('loginForm').requestSubmit() : el('loginForm').dispatchEvent(new Event('submit', { cancelable: true }));
    });
    el('searchSets').addEventListener('input', function (ev) {
      state.query = ev.target.value;
      renderSets();
    });

    // ซิงค์ข้อมูลจากหน้าต่างอื่น
    store.subscribe(store.KEYS.sets, function () {
      if (!el('viewApp').classList.contains('hidden')) { renderSets(); renderStats(); }
    });
    store.subscribe(store.KEYS.sessions, function () {
      if (!el('viewApp').classList.contains('hidden')) { renderSessions(); renderStats(); }
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === '/' && document.activeElement !== el('searchSets')) {
        ev.preventDefault();
        el('searchSets').focus();
      }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);
