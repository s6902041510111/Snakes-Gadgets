/* =========================================================
   game.js — ตรรกะเกมบันไดงู Active Learning (ใช้ร่วมกันทุกหน้าจอ)
   ========================================================= */
(function (global) {
  'use strict';

  var SCORING = {
    correct: 100,        // คะแนนฐาน
    speedMax: 50,        // โบนัสความเร็วสูงสุด
    streakStep: 10,      // โบนัสต่อคำตอบถูกติดกัน
    streakMax: 50,       // เพดานโบนัส streak
    timeLimitMs: 20000,  // เวลาอ้างอิงคิดโบนัสความเร็ว
    bingoBonus: 150      // โบนัสบิงโก
  };

  var PLAYER_COLORS = ['#00f3ff', '#9d4edd', '#00ff88', '#ffc247', '#ff5fa2', '#4dabf7', '#ff8b3d', '#a5d66f'];

  /* ---------------- utilities ---------------- */
  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function shuffle(arr, rnd) {
    var a = arr.slice();
    var random = rnd || Math.random;
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function now() { return Date.now(); }

  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }

  function fmtMs(ms) {
    if (ms == null || isNaN(ms)) return '-';
    if (ms < 1000) return ms + ' มิลลิวินาที';
    return (ms / 1000).toFixed(1) + ' วิ';
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ไม่ใช้ I, O, 0, 1 กันสับสน

  function makeJoinCode(existing, length) {
    var len = length || (4 + Math.floor(Math.random() * 3)); // 4-6 หลัก
    for (var attempt = 0; attempt < 200; attempt++) {
      var code = '';
      for (var i = 0; i < len; i++) code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
      var clash = (existing || []).some(function (c) { return String(c).toUpperCase() === code; });
      if (!clash) return code;
    }
    // กันกรณีสุดท้าย (200 ครั้งยังชน) — สุ่มจากตัวอักษรที่ใช้ได้จริง ไม่เอา uid ที่อาจติด '_'
    var fb = '';
    for (var k = 0; k < len; k++) fb += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    return fb;
  }

  function normalizeCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /* ---------------- session ---------------- */
  function createSession(set, teacherName) {
    var itemIds = (set.items || []).map(function (i) { return i.id; });
    // ใช้บันได/งูที่ครูกำหนด ถ้ามี (งูอย่างเดียวก็ต้องเก็บ ไม่ใช่ไปสุ่มใหม่)
    var sl = set.snakesLadders;
    var hasCustom = sl && ((sl.ladders || []).length || (sl.snakes || []).length);
    var snakesLadders = hasCustom
      ? sl
      : global.ITS.dataset.autoSnakesLadders(set.trackLength || 30, itemIds);
    return {
      id: uid('ses'),
      setId: set.id,
      setName: set.name,
      teacher: teacherName || 'ครู',
      joinCode: makeJoinCode([], 4 + Math.floor(Math.random() * 3)),
      status: 'lobby',              // lobby | playing | finished
      rounds: clamp(set.rounds || 8, 1, 99),
      gridSize: set.gridSize || 4,
      trackLength: set.trackLength || 30,
      winPatterns: (set.winPatterns || ['row', 'col', 'diag']).slice(),
      snakesLadders: snakesLadders,
      promptMode: 'meaning',        // meaning = โชว์คำใบ้, term = โชว์ชื่ออุปกรณ์
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      finishedReason: null,
      round: 0,
      current: null,                // คำถามที่กำลังเล่น
      deck: shuffle(itemIds),       // ลำดับการสุ่มที่เหลือ
      usedItemIds: [],
      results: [],                  // ผลลัพธ์รายรอบ
      players: [],
      log: [{ at: now(), type: 'created', text: 'สร้างห้อง ' + set.name }]
    };
  }

  function itemById(set, itemId) {
    var list = (set && set.items) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === itemId) return list[i];
    return null;
  }

  function addLog(session, type, text) {
    session.log.push({ at: now(), type: type, text: text });
    if (session.log.length > 200) session.log.shift();
  }

  function startSession(session) {
    session.status = 'playing';
    session.startedAt = new Date().toISOString();
    addLog(session, 'start', 'เริ่มกิจกรรม');
    return session;
  }

  function drawQuestion(session, set, opts) {
    opts = opts || {};
    if (session.status !== 'playing') return null;
    if (session.round >= session.rounds) return null;
    if (!session.deck.length) {
      session.deck = shuffle((set.items || []).map(function (i) { return i.id; }));
    }
    var itemId = session.deck.pop();
    var item = itemById(set, itemId);
    if (!item) return null;
    session.round += 1;
    session.usedItemIds.push(itemId);
    session.current = {
      round: session.round,
      itemId: item.id,
      term: item.term,
      meaning: item.meaning,
      icon: item.icon,
      category: item.category,
      promptMode: opts.promptMode || session.promptMode,
      drawnAt: now(),
      revealed: false,
      answered: false
    };
    session.players.forEach(function (p) { p.claim = null; });
    addLog(session, 'draw', 'สุ่มคำถาม: ' + item.term);
    return session.current;
  }

  function scoreFor(ms, streak) {
    var base = SCORING.correct;
    var t = clamp(ms == null ? SCORING.timeLimitMs : ms, 0, SCORING.timeLimitMs);
    var speed = Math.round(((SCORING.timeLimitMs - t) / SCORING.timeLimitMs) * SCORING.speedMax);
    var st = Math.min(streak * SCORING.streakStep, SCORING.streakMax);
    return { base: base, speed: speed, streak: st, total: base + speed + st };
  }

  /** เดินบันไดงู 1 ก้าว + ตรวจบันได/งู */
  function moveToken(session, from) {
    var target = clamp(from + 1, 0, session.trackLength);
    var event = { from: from, to: target, kind: 'step' };
    var sl = session.snakesLadders || { ladders: [], snakes: [] };
    var ladder = (sl.ladders || []).find(function (l) { return l[0] === target; });
    if (ladder) {
      // บันไดมีลำดับก่อนงู (ถ้าช้อนกันโดยไม่ตั้งใจ)
      event.kind = 'ladder'; event.to = clamp(ladder[1], 0, session.trackLength); event.fromTile = target;
    } else {
      var snake = (sl.snakes || []).find(function (s) { return s[0] === target; });
      if (snake) { event.kind = 'snake'; event.to = clamp(snake[1], 0, session.trackLength); event.fromTile = target; }
    }
    // ถึงช่องสุดท้าย = ผู้ชนะ (รวมกรณีขึ้นบันไดมาหยุดที่เส้นชัยพอดี)
    if (target === session.trackLength || event.to === session.trackLength) event.kind = 'goal';
    return event;
  }

  /**
   * ตรวจคำตอบของนักเรียน 1 คน
   * correct = boolean (ครูตัดสิน) หรือ null (ใช้การเทียบอัตโนมัติ)
   */
  function resolveClaim(session, playerId, correct, answerTerm) {
    var p = findPlayer(session, playerId);
    if (!p || !p.claim || p.claim.status !== 'pending') return null;
    var q = session.current;
    if (!q) return null;
    var isRight = correct === null ? (answerTerm === q.term) : !!correct;
    var ms = p.claim.ms;
    p.claim.status = isRight ? 'correct' : 'wrong';
    p.claim.checkedAt = now();

    var gained = 0, breakdown = null, move = null;
    if (isRight) {
      p.streak += 1;
      p.correct += 1;
      p.bestStreak = Math.max(p.bestStreak, p.streak);
      breakdown = scoreFor(ms, p.streak);
      gained = breakdown.total;
      p.score += gained;
      p.totalMs += (ms || 0);
      p.answered += 1;
      move = moveToken(session, p.pos);
      p.pos = move.to;
      p.bingoAwarded = p.bingoAwarded || false;
      if (move.kind === 'goal') p.reachedGoal = true;
    } else {
      p.wrong += 1;
      p.streak = 0;
      p.answered += 1;
      p.totalMs += (ms || 0);
    }

    session.results.push({
      round: q.round,
      itemId: q.itemId,
      term: q.term,
      playerId: p.id,
      playerName: p.name,
      correct: isRight,
      answerTerm: answerTerm,
      ms: ms,
      points: gained,
      breakdown: breakdown,
      move: move,
      at: now()
    });

    // หมายเหตุ: การตรวจคำเคลมคนเดียว "ไม่ปิดรอบ" — ครูตรวจคนอื่นต่อได้
    // จนกว่าจะกด "เฉลย/จบรอบ" (closeRound) ถึงจะเปิดเฉลย + ปิดรับคำตอบ
    addLog(session, isRight ? 'correct' : 'wrong',
      p.name + ' ตอบ "' + (answerTerm || '-') + '" ' + (isRight ? 'ถูกต้อง +' + gained + ' คะแนน' : 'ยังไม่ถูก'));
    return { player: p, gained: gained, breakdown: breakdown, correct: isRight, move: move };
  }

  function findPlayer(session, playerId) {
    for (var i = 0; i < session.players.length; i++) if (session.players[i].id === playerId) return session.players[i];
    return null;
  }

  function findPlayerByName(session, name) {
    var low = String(name || '').trim().toLowerCase();
    for (var i = 0; i < session.players.length; i++) {
      if (String(session.players[i].name).trim().toLowerCase() === low) return session.players[i];
    }
    return null;
  }

  function addPlayer(session, name, identitySeed) {
    var clean = String(name || '').trim().slice(0, 24) || 'นักเรียน';
    var existing = findPlayerByName(session, clean);
    if (existing) {
      existing.joinedAt = now();
      existing.lastSeenAt = now();
      existing.disconnected = false;
      return { player: existing, rejoined: true };
    }
    var player = {
      id: uid('pl'),
      name: clean,
      seat: session.players.length + 1,
      color: PLAYER_COLORS[session.players.length % PLAYER_COLORS.length],
      score: 0,
      correct: 0,
      wrong: 0,
      streak: 0,
      bestStreak: 0,
      answered: 0,
      totalMs: 0,
      pos: 0,
      bonus: 0,
      bingoAwarded: false,
      reachedGoal: false,
      joinedAt: now(),
      lastSeenAt: now(),
      disconnected: false,
      seed: identitySeed || null,
      claim: null
    };
    session.players.push(player);
    addLog(session, 'join', clean + ' เข้าร่วมห้อง');
    return { player: player, rejoined: false };
  }

  function ranking(session) {
    return (session.players || []).slice().sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (b.pos !== a.pos) return b.pos - a.pos;
      return (a.seat || 0) - (b.seat || 0);
    });
  }

  function stats(session) {
    var players = session.players || [];
    var answered = 0, correct = 0, totalMs = 0, msCount = 0;
    players.forEach(function (p) {
      answered += p.answered || 0;
      correct += p.correct || 0;
      totalMs += p.totalMs || 0;
      msCount += p.answered || 0;
    });
    return {
      players: players.length,
      answered: answered,
      correct: correct,
      wrong: answered - correct,
      accuracy: answered ? Math.round((correct / answered) * 100) : 0,
      avgMs: msCount ? Math.round(totalMs / msCount) : 0,
      roundsPlayed: (function () {
        var seen = {};
        (session.results || []).forEach(function (r) { seen[r.round] = true; });
        return Object.keys(seen).length;
      })(),
      bestStreak: players.reduce(function (m, p) { return Math.max(m, p.bestStreak || 0); }, 0),
      bingos: players.filter(function (p) { return p.bingoAwarded; }).length
    };
  }

  function finishSession(session, reason) {
    session.status = 'finished';
    session.finishedAt = new Date().toISOString();
    session.finishedReason = reason || 'manual';
    addLog(session, 'finish', 'จบกิจกรรม (' + (reason === 'rounds' ? 'ครบตามจำนวนรอบ' : 'ครูกดจบเกม') + ')');
    return session;
  }

  /* ---------------- student board ---------------- */
  /** สร้างการ์ดบันไดงูส่วนตัว (สลับตำแหน่งต่างกันในแต่ละคน) */
  function buildBoard(gridSize, itemIds, seed) {
    var rnd = seeded(seed || String(Math.random()));
    return shuffle(itemIds.slice(0, gridSize * gridSize), rnd).map(function (id, idx) {
      return { pos: idx, itemId: id };
    });
  }

  function seeded(seed) {
    var h = 2166136261;
    for (var i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return function () {
      h += 0x6D2B79F5;
      var t = h;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** ตรวจว่าการ์ดของนักเรียนบิงโกตามรูปแบบที่กำหนดหรือไม่ */
  function checkBingo(board, correctItemIds, patterns, gridSize) {
    var size = gridSize || Math.round(Math.sqrt(board.length));
    var grid = [];   // grid[r][c] = { pos, ok }
    for (var r = 0; r < size; r++) {
      grid.push([]);
      for (var c = 0; c < size; c++) {
        var pos = r * size + c;
        var cell = board.filter(function (b) { return b.pos === pos; })[0];
        grid[r].push({ pos: pos, ok: cell ? correctItemIds.indexOf(cell.itemId) !== -1 : false });
      }
    }
    var lines = [];
    if (patterns.indexOf('row') !== -1) {
      for (var i = 0; i < size; i++) lines.push(grid[i].slice());
    }
    if (patterns.indexOf('col') !== -1) {
      for (var j = 0; j < size; j++) lines.push(grid.map(function (row) { return row[j]; }));
    }
    if (patterns.indexOf('diag') !== -1) {
      lines.push(grid.map(function (row, idx) { return row[idx]; }));
      lines.push(grid.map(function (row, idx) { return row[size - 1 - idx]; }));
    }
    var hit = lines.find(function (line) { return line.every(function (c) { return c.ok; }); });
    if (!hit) return null;
    // คืนเฉพาะช่องเส้นที่ชนะ (ไม่เอาช่องถูกแบบลอย ๆ มาแถม)
    return { line: hit.map(function (c) { return c.ok; }), cells: hit.map(function (c) { return c.pos; }) };
  }

  /* ---------------- export ---------------- */
  function exportSession(session, set) {
    return {
      app: 'it-snake-ladder-class',
      type: 'session-result',
      schema: 1,
      exportedAt: new Date().toISOString(),
      session: {
        id: session.id,
        setId: session.setId,
        setName: session.setName,
        teacher: session.teacher,
        joinCode: session.joinCode,
        status: session.status,
        rounds: session.rounds,
        gridSize: session.gridSize,
        trackLength: session.trackLength,
        createdAt: session.createdAt,
        startedAt: session.startedAt,
        finishedAt: session.finishedAt,
        finishedReason: session.finishedReason,
        roundPlayed: session.round,
        snakesLadders: session.snakesLadders
      },
      set: set ? { id: set.id, name: set.name, grade: set.grade, items: set.items } : null,
      statistics: stats(session),
      leaderboard: ranking(session).map(function (p, i) {
        return {
          rank: i + 1,
          name: p.name,
          score: p.score,
          correct: p.correct,
          wrong: p.wrong,
          streakBest: p.bestStreak,
          position: p.pos,
          reachedGoal: !!p.reachedGoal,
          bingo: !!p.bingoAwarded,
          avgResponseMs: p.answered ? Math.round(p.totalMs / p.answered) : 0
        };
      }),
      rounds: (session.results || []).map(function (r) {
        return {
          round: r.round,
          term: r.term,
          student: r.playerName,
          answer: r.answerTerm,
          correct: r.correct,
          ms: r.ms,
          points: r.points,
          move: r.move ? r.move.kind : null
        };
      }),
      log: session.log
    };
  }

  function toCsv(session) {
    var rows = [];
    var st = stats(session);
    rows.push(['IT Snake & Ladder Class — ผลการประเมิน']);
    rows.push(['ชุดกิจกรรม', session.setName]);
    rows.push(['ครูผู้สอน', session.teacher]);
    rows.push(['รหัสห้อง', session.joinCode]);
    rows.push(['วันที่', new Date().toISOString()]);
    rows.push([]);
    rows.push(['อันดับ', 'ชื่อ', 'คะแนน', 'ตอบถูก', 'ตอบผิด', 'Streak สูงสุด', 'ตำแหน่งบนกระดาน', 'บิงโก', 'เวลาเฉลี่ย (มิลลิวินาที)']);
    ranking(session).forEach(function (p, i) {
      rows.push([
        i + 1, p.name, p.score, p.correct, p.wrong, p.bestStreak, p.pos,
        p.bingoAwarded ? 'ชนะ' : '-',
        p.answered ? Math.round(p.totalMs / p.answered) : 0
      ]);
    });
    rows.push([]);
    rows.push(['สรุปรวม']);
    rows.push(['จำนวนนักเรียน', st.players]);
    rows.push(['ตอบทั้งหมด', st.answered]);
    rows.push(['ตอบถูก', st.correct]);
    rows.push(['ความแม่นยำ (%)', st.accuracy]);
    rows.push(['เวลาเฉลี่ย (มิลลิวินาที)', st.avgMs]);
    rows.push(['Streak สูงสุด', st.bestStreak]);
    rows.push(['คนที่บิงโก', st.bingos]);
    rows.push([]);
    rows.push(['รายละเอียดรอบคำถาม']);
    rows.push(['รอบ', 'คำตอบที่สุ่มได้', 'นักเรียน', 'คำตอบที่เลือก', 'ถูก/ผิด', 'ใช้เวลา (มิลลิวินาที)', 'คะแนนที่ได้']);
    (session.results || []).forEach(function (r) {
      rows.push([r.round, r.term, r.playerName, r.answerTerm, r.correct ? 'ถูก' : 'ผิด', r.ms, r.points]);
    });
    return rows.map(function (r) {
      return r.map(function (cell) {
        var v = String(cell == null ? '' : cell);
        // กันสูตรหลุดใน Excel (=, +, -, @, tab) — ใส่เครื่องหมาย ' นำหน้า
        if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\r\n');
  }

  global.ITS = global.ITS || {};
  global.ITS.game = {
    SCORING: SCORING,
    PLAYER_COLORS: PLAYER_COLORS,
    uid: uid,
    shuffle: shuffle,
    clamp: clamp,
    fmtMs: fmtMs,
    escapeHtml: escapeHtml,
    makeJoinCode: makeJoinCode,
    normalizeCode: normalizeCode,
    createSession: createSession,
    itemById: itemById,
    addLog: addLog,
    startSession: startSession,
    drawQuestion: drawQuestion,
    scoreFor: scoreFor,
    moveToken: moveToken,
    resolveClaim: resolveClaim,
    findPlayer: findPlayer,
    findPlayerByName: findPlayerByName,
    addPlayer: addPlayer,
    ranking: ranking,
    stats: stats,
    finishSession: finishSession,
    buildBoard: buildBoard,
    seeded: seeded,
    checkBingo: checkBoardBingo,
    exportSession: exportSession,
    toCsv: toCsv
  };

  function checkBoardBingo(board, correctItemIds, patterns, gridSize) {
    return checkBingo(board, correctItemIds, patterns, gridSize);
  }
})(window);
