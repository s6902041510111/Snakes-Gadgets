/* =========================================================
   sets.js — CRUD ชุดกิจกรรม (ชุดคำศัพท์อุปกรณ์ไอที)
   ข้อมูลเก็บเป็น JSON Object ใน ITS.store เพื่อพร้อมต่อยอดไปใช้บน Vercel
   ========================================================= */
(function (global) {
  'use strict';

  var store = global.ITS.store;
  var game = global.ITS.game;
  var KEY = store.KEYS.sets;

  function collection() {
    var data = store.read(KEY);
    if (!data || !Array.isArray(data.items)) data = { items: [] };
    return data;
  }

  function save(items) {
    return store.write(KEY, { items: items });
  }

  function ensureSeeds() {
    var col = collection();
    if (col.items.length) return col.items;
    var presets = global.ITS.dataset.defaults();
    presets.forEach(function (p) { p.createdAt = new Date().toISOString(); p.updatedAt = p.createdAt; p.builtin = true; });
    save(presets);
    return presets;
  }

  function list() {
    return collection().items.slice().sort(function (a, b) {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  function get(id) {
    return collection().items.filter(function (s) { return s.id === id; })[0] || null;
  }

  function validate(data, ignoreId) {
    var errors = [];
    if (!data.name || !String(data.name).trim()) errors.push('กรุกชื่อชุดกิจกรรม');
    var grid = Number(data.gridSize) || 4;
    if ([3, 4].indexOf(grid) === -1) errors.push('ขนาดกระดานต้องเป็น 3x3 หรือ 4x4');
    var items = (data.items || []).filter(function (i) { return i && String(i.term || '').trim(); });
    var need = grid * grid;
    if (items.length < need) errors.push('ต้องมีอุปกรณ์อย่างน้อย ' + need + ' รายการ (กระดาน ' + grid + 'x' + grid + ')');
    var seen = {};
    items.forEach(function (i) {
      var key = String(i.term).trim().toLowerCase();
      if (seen[key]) errors.push('ชื่ออุปกรณ์ซ้ำ: ' + i.term);
      seen[key] = true;
      if (!String(i.meaning || '').trim()) errors.push('ยังไม่ได้ใส่ความหมาย/คำใบ้ของ "' + i.term + '"');
    });
    if (errors.length && ignoreId) errors = errors.map(function (e) { return e; });
    return { ok: errors.length === 0, errors: errors, itemCount: items.length, required: need };
  }

  function normalize(data) {
    var grid = Number(data.gridSize) || 4;
    var items = (data.items || [])
      .filter(function (i) { return i && String(i.term || '').trim(); })
      .map(function (i, idx) {
        return {
          id: i.id || game.uid('itm'),
          term: String(i.term).trim().slice(0, 40),
          meaning: String(i.meaning || '').trim().slice(0, 240),
          icon: String(i.icon || '💻').trim().slice(0, 4) || '💻',
          category: String(i.category || 'ทั่วไป').trim().slice(0, 30),
          order: idx
        };
      });
    var trackLength = Math.max(10, Math.min(60, Number(data.trackLength) || 30));
    var sl = data.snakesLadders || { ladders: [], snakes: [] };
    function cleanPairs(list) {
      return (list || [])
        .map(function (p) { return [Number(p[0]), Number(p[1])]; })
        .filter(function (p) { return p[0] >= 0 && p[1] >= 0 && p[0] < trackLength && p[1] < trackLength; });
    }
    var ladders = cleanPairs(sl.ladders);
    var snakes = cleanPairs(sl.snakes);
    if (!ladders.length && !snakes.length) {
      var auto = global.ITS.dataset.autoSnakesLadders(trackLength, items.map(function (i) { return i.id; }));
      ladders = auto.ladders;
      snakes = auto.snakes;
    }
    var patterns = (data.winPatterns && data.winPatterns.length) ? data.winPatterns.slice() : ['row', 'col', 'diag'];
    return {
      name: String(data.name || 'ชุดกิจกรรมใหม่').trim().slice(0, 80),
      grade: String(data.grade || '').trim().slice(0, 40),
      description: String(data.description || '').trim().slice(0, 240),
      gridSize: grid,
      rounds: Math.max(1, Math.min(40, Number(data.rounds) || 8)),
      trackLength: trackLength,
      winPatterns: patterns,
      snakesLadders: { ladders: ladders, snakes: snakes },
      items: items
    };
  }

  function create(data) {
    var clean = normalize(data);
    var check = validate(clean);
    if (!check.ok) return { ok: false, errors: check.errors };
    var nowIso = new Date().toISOString();
    var set = Object.assign({ id: game.uid('set'), createdAt: nowIso, updatedAt: nowIso }, clean);
    var items = collection().items.slice();
    items.push(set);
    save(items);
    return { ok: true, set: set };
  }

  function update(id, data) {
    var items = collection().items.slice();
    var idx = items.findIndex(function (s) { return s.id === id; });
    if (idx === -1) return { ok: false, errors: ['ไม่พบชุดกิจกรรม'] };
    var clean = normalize(data);
    var check = validate(clean);
    if (!check.ok) return { ok: false, errors: check.errors };
    items[idx] = Object.assign({}, items[idx], clean, { id: id, updatedAt: new Date().toISOString() });
    save(items);
    return { ok: true, set: items[idx] };
  }

  function remove(id) {
    var items = collection().items.filter(function (s) { return s.id !== id; });
    save(items);
    return items;
  }

  function duplicate(id) {
    var src = get(id);
    if (!src) return { ok: false, errors: ['ไม่พบชุดกิจกรรม'] };
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = game.uid('set');
    copy.name = src.name + ' (สำเนา)';
    copy.builtin = false;
    copy.items = copy.items.map(function (i) { return Object.assign({}, i, { id: game.uid('itm') }); });
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    var items = collection().items.slice();
    items.push(copy);
    save(items);
    return { ok: true, set: copy };
  }

  /** นำเข้าชุดสำเร็จรูปจาก dataset */
  function importPreset(presetId) {
    var preset = global.ITS.dataset.presets.filter(function (p) { return p.id === presetId; })[0];
    if (!preset) return { ok: false, errors: ['ไม่พบชุดสำเร็จรูป'] };
    var copy = JSON.parse(JSON.stringify(preset));
    copy.id = game.uid('set');
    copy.items = copy.items.map(function (i) { return Object.assign({}, i, { id: game.uid('itm') }); });
    copy.builtin = false;
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    var items = collection().items.slice();
    items.push(copy);
    save(items);
    return { ok: true, set: copy };
  }

  global.ITS = global.ITS || {};
  global.ITS.sets = {
    ensureSeeds: ensureSeeds,
    list: list,
    get: get,
    create: create,
    update: update,
    remove: remove,
    duplicate: duplicate,
    importPreset: importPreset,
    validate: validate,
    normalize: normalize
  };
})(window);
