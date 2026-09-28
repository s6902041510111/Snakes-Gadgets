/* =========================================================
   rooms.js — จัดการ "ห้องเล่น" (session) ที่ทุกหน้าจอใช้ร่วมกัน
   ครูสร้างห้อง → นักเรียนเข้าร่วม → ครูสุ่มคำถาม/ตัดสิน → จบเกม
   ข้อมูลเก็บเป็น JSON Object ใน ITS.store เพื่อพร้อมต่อยอดไปใช้บน Vercel
   ========================================================= */
(function (global) {
  'use strict';

  var ITS = global.ITS;
  var store = ITS.store;
  var game = ITS.game;
  var KEY = store.KEYS.sessions;

  /* ---------------- พื้นฐาน ---------------- */
  function collection() {
    var data = store.read(KEY);
    if (!data || !Array.isArray(data.items)) data = { items: [] };
    return data;
  }

  function save(items) {
    store.write(KEY, { items: items });
    return items;
  }

  function all() {
    return collection().items.slice().sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  function get(id) {
    if (!id) return null;
    return collection().items.filter(function (s) { return s.id === id; })[0] || null;
  }

  function findByCode(code) {
    var c = game.normalizeCode(code);
    if (!c) return null;
    var list = collection().items;
    for (var i = list.length - 1; i >= 0; i--) {
      if (game.normalizeCode(list[i].joinCode) === c) return list[i];
    }
    return null;
  }

  /** หาห้องที่ยังไม่จบ (ใช้ตอนนักเรียนเข้าร่วม) */
  function findOpenByCode(code) {
    var s = findByCode(code);
    return s && s.status !== 'finished' ? s : null;
  }

  function uniqueCode() {
    var taken = collection().items.map(function (s) { return game.normalizeCode(s.joinCode); });
    return game.makeJoinCode(taken, 4 + Math.floor(Math.random() * 3));
  }

  /** เก็บเฉพาะข้อมูลที่จำเป็นไว้ในห้อง เพื่อให้ห้อง "พึ่งตนเอง" ได้แม้ชุดกิจกรรมถูกลบ */
  function snapshotOf(set) {
    if (!set) return null;
    return {
      id: set.id,
      name: set.name,
      grade: set.grade || '',
      gridSize: set.gridSize || 4,
      items: (set.items || []).map(function (i) {
        return { id: i.id, term: i.term, meaning: i.meaning, icon: i.icon, category: i.category };
      })
    };
  }

  /** คืนชุดกิจกรรมของห้อง (ใช้ snapshot ก่อน เผื่อชุดถูกลบ/แก้ไข) */
  function setOf(session) {
    if (!session) return null;
    if (session.setSnapshot && session.setSnapshot.items) return session.setSnapshot;
    if (global.ITS.sets && global.ITS.sets.get) return global.ITS.sets.get(session.setId);
    return null;
  }

  function itemById(session, itemId) {
    var set = setOf(session);
    return set ? game.itemById(set, itemId) : null;
  }

  /* ---------------- เขียนข้อมูล ---------------- */
  function put(session) {
    var items = collection().items.slice();
    var idx = -1;
    for (var i = 0; i < items.length; i++) if (items[i].id === session.id) { idx = i; break; }
    if (idx === -1) items.push(session);
    else items[idx] = session;
    return save(items);
  }

  /**
   * แก้ไขห้องแบบ read → mutate → write (ปลอดภัยจากการถูกเขียนทับ)
   * mutator(draftSession) คืนค่า session ใหม่ หรือปล่อย undefined เพื่อแก้ draft ในที่
   */
  function update(id, mutator) {
    var out = null;
    store.update(KEY, function (data) {
      if (!data || !Array.isArray(data.items)) data = { items: [] };
      var idx = -1;
      for (var i = 0; i < data.items.length; i++) if (data.items[i].id === id) { idx = i; break; }
      if (idx === -1) return data;
      var draft = data.items[idx];              // store.update คัดลอกลึกให้แล้ว
      var res = mutator(draft);
      data.items[idx] = res || draft;
      out = data.items[idx];
      return data;
    });
    return out ? { ok: true, session: out } : { ok: false, errors: ['ไม่พบห้องเล่น'] };
  }

  function create(set, teacherName) {
    var session = game.createSession(set, teacherName);
    session.joinCode = uniqueCode();
    session.setSnapshot = snapshotOf(set);
    put(session);
    return session;
  }

  function remove(id) {
    save(collection().items.filter(function (s) { return s.id !== id; }));
  }

  function clearFinished() {
    var before = collection().items.length;
    save(collection().items.filter(function (s) { return s.status !== 'finished'; }));
    return before - collection().items.length;
  }

  /* ---------------- การเข้าร่วมของนักเรียน ---------------- */
  /** สร้างการ์ดสุ่มส่วนตัว (คนละคนได้คนละแบบ) */
  function makeBoard(set, gridSize, seed) {
    var ids = (set && set.items ? set.items : []).map(function (i) { return i.id; });
    var rnd = game.seeded(seed);
    return game.buildBoard(gridSize || 4, game.shuffle(ids, rnd), seed);
  }

  /**
   * นักเรียนเข้าร่วมห้อง (เข้าซ้ำได้ ถ้าชื่อเดิม → ใช้ตัวเดิม)
   * board ถูกสร้างครั้งแรกเท่านั้น เพื่อให้การ์ดของตัวเองนิ่ง
   */
  function join(sessionId, name, seed) {
    var playerId = null;
    var res = update(sessionId, function (s) {
      var out = game.addPlayer(s, name, seed);
      var p = out.player;
      playerId = p.id;
      if (!p.board || !p.board.length) {
        var set = setOf(s);
        p.board = makeBoard(set, s.gridSize, p.seed || seed || p.id);
        p.correctItemIds = p.correctItemIds || [];
      }
      p.correctItemIds = p.correctItemIds || [];
      return s;
    });
    if (!res.ok) return { ok: false, errors: res.errors };
    var p = game.findPlayer(res.session, playerId);
    return { ok: true, player: p, session: res.session, rejoined: !!p };
  }

  /** ส่งคำตอบ (เคลม) — เขียนซ้ำอัตโนมัติเมื่อถูกเขียนทับ */
  function submitClaim(sessionId, playerId, itemId, term, cb) {
    var tries = 0;
    var MAX = 4;
    function once() {
      store.refresh(KEY);
      update(sessionId, function (s) {
        if (s.status !== 'playing' || !s.current || s.current.answered) return s;
        var p = game.findPlayer(s, playerId);
        if (!p) return s;
        // เคลมได้ครั้งเดียวต่อรอบ (กันเคลมทับของเดิมที่ครูตรวจไปแล้ว/กำลังตรวจ)
        if (p.claim && p.claim.round === s.current.round) return s;
        var ms = Math.max(0, Date.now() - (s.current.drawnAt || Date.now()));
        p.claim = {
          round: s.current.round,
          itemId: itemId,
          term: term,
          ms: ms,
          at: Date.now(),
          status: 'pending'
        };
        p.lastSeenAt = Date.now();
        game.addLog(s, 'claim', p.name + ' เคลมคำตอบ: ' + term);
        return s;
      });
      // ตรวจว่าคำตอบของเรายังอยู่จริง (กันถูกหน้าต่างอื่นเขียนทับ)
      var s2 = get(sessionId);
      var p2 = s2 ? game.findPlayer(s2, playerId) : null;
      var ok = !!(p2 && p2.claim && p2.claim.term === term &&
        s2.current && p2.claim.round === s2.current.round);
      if (ok) { if (cb) cb(true, p2.claim); return; }
      tries++;
      if (tries < MAX) setTimeout(once, 220 * tries);
      else if (cb) cb(false, null);
    }
    once();
  }

  /** ขีดถูกบนกระดาน + ตรวจบิงโก (ฝั่งนักเรียนเป็นผู้ตรวจ เพราะรู้การ์ดของตัวเอง) */
  function markCorrect(sessionId, playerId, itemId, cb) {
    var res = update(sessionId, function (s) {
      var p = game.findPlayer(s, playerId);
      if (!p) return s;
      p.correctItemIds = p.correctItemIds || [];
      if (p.correctItemIds.indexOf(itemId) === -1) p.correctItemIds.push(itemId);
      if (!p.bingoAwarded) {
        var bingo = game.checkBingo(p.board || [], p.correctItemIds, s.winPatterns, s.gridSize);
        if (bingo) {
          p.bingoAwarded = true;
          p.bonus = (p.bonus || 0) + game.SCORING.bingoBonus;
          p.score = (p.score || 0) + game.SCORING.bingoBonus;
          p.bingoCells = bingo.cells;
          game.addLog(s, 'bingo', p.name + ' ได้บิงโก! +' + game.SCORING.bingoBonus + ' คะแนน');
        }
      }
      return s;
    });
    if (cb) cb(res.ok ? res.session : null);
  }

  /** สร้างการ์ดใหม่ให้นักเรียนคนนั้น (ปุ่ม "สุ่มการ์ดใหม่") */
  function reshuffleBoard(sessionId, playerId) {
    update(sessionId, function (s) {
      var p = game.findPlayer(s, playerId);
      if (!p) return s;
      p.board = makeBoard(setOf(s), s.gridSize, game.uid('b'));
      p.correctItemIds = [];
      return s;
    });
  }

  /* ---------------- สรุป ---------------- */
  function totals() {
    var list = collection().items;
    var players = 0, finished = 0;
    list.forEach(function (s) {
      players += (s.players || []).length;
      if (s.status === 'finished') finished++;
    });
    return { rooms: list.length, players: players, finished: finished };
  }

  ITS.rooms = {
    KEY: KEY,
    all: all,
    get: get,
    findByCode: findByCode,
    findOpenByCode: findOpenByCode,
    uniqueCode: uniqueCode,
    create: create,
    put: put,
    update: update,
    remove: remove,
    clearFinished: clearFinished,
    setOf: setOf,
    itemById: itemById,
    snapshotOf: snapshotOf,
    makeBoard: makeBoard,
    join: join,
    submitClaim: submitClaim,
    markCorrect: markCorrect,
    reshuffleBoard: reshuffleBoard,
    totals: totals
  };
})(window);
