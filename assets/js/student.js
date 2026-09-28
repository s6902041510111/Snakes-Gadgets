/* =========================================================
   student.js — หน้านักเรียน (มือถือ/แท็บเล็ต)
   เข้าร่วมห้อง → สุ่มการ์ดส่วนตัว → อ่านคำใบ้จากจอ → เคลมคำตอบ
   ========================================================= */
(function (global) {
  'use strict';

  var ITS = global.ITS;
  var store = ITS.store, game = ITS.game, ui = ITS.ui, rooms = ITS.rooms;
  var el = ui.el, h = ui.h, esc = game.escapeHtml;
  var KEY = store.KEYS;

  var state = {
    joined: false,
    sid: null,
    me: null,
    session: null,
    set: null,
    selectedItemId: null,
    lastSig: '',
    feedbackKey: '',
    markedRound: -1,
    scoreBeforeClaim: 0,
    finishedShown: false,
    goalShown: false
  };

  /* ---------------- identity (จำชื่อ + หมายเลขนักเรียน) ---------------- */
  function identity() {
    var x = store.read(KEY.identity) || {};
    return x && typeof x === 'object' ? x : {};
  }
  function saveIdentity(patch) {
    var x = Object.assign({}, identity(), patch);
    store.write(KEY.identity, x);
    return x;
  }

  function codeParam() {
    try { return game.normalizeCode(new URLSearchParams(location.search).get('code')); }
    catch (e) { return ''; }
  }

  /* ---------------- join ---------------- */
  function showJoinView() {
    el('viewGame').classList.add('hidden');
    el('viewJoin').classList.remove('hidden');
    window.scrollTo(0, 0);
  }
  function showGameView() {
    el('viewJoin').classList.add('hidden');
    el('viewGame').classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  function doJoin() {
    var code = game.normalizeCode(el('joinCodeInput').value);
    var name = String(el('joinNameInput').value || '').trim();
    var err = el('joinError');
    err.classList.add('hidden');
    if (!code) { err.textContent = '❌ กรอกรหัสห้องก่อน (รหัสอยู่บนจอ Projector)'; err.classList.remove('hidden'); return; }
    if (!name) { err.textContent = '❌ กรอกชื่อตัวเองก่อน'; err.classList.remove('hidden'); return; }

    var sess = rooms.findOpenByCode(code);
    if (!sess) {
      err.textContent = '❌ ไม่พบห้องเล่นที่ยังเปิดอยู่สำหรับรหัสนี้ (รหัสผิด หรือเกมจบแล้ว)';
      err.classList.remove('hidden');
      return;
    }
    var idT = identity();
    var seed = idT.seed || ('stu_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36));
    var res = rooms.join(sess.id, name, seed);
    if (!res.ok) { err.textContent = '❌ ' + res.errors.join(' · '); err.classList.remove('hidden'); return; }

    state.me = res.player;
    state.feedbackKey = claimKeyFrom(state.me, sess) || '';
    state.markedRound = sess.current && sess.current.round ? sess.current.round - 1 : -1;
    state.scoreBeforeClaim = state.me.score || 0;
    saveIdentity({ name: state.me.name, seed: seed, playerId: state.me.id, sessionId: sess.id, code: code });
    state.joined = true;
    state.sid = sess.id;
    state.session = sess;
    state.set = rooms.setOf(sess);

    ui.SFX.join();
    ui.toast('เข้าห้อง "' + sess.joinCode + '" แล้ว 🎉', 'ok');
    showGameView();
    render(true);
    bindGameOnce();
  }

  /** คีย์สถานะปัจจุบันของรอบ (ใช้กันการ toast ซ้ำตอนกลับเข้ามาใหม่) */
  function claimKeyFrom(me, s) {
    if (!me || !me.claim || !s || !s.current) return '';
    if (me.claim.round !== s.current.round) return '';
    return me.claim.round + ':' + me.claim.status;
  }

  /* ---------------- binding ---------------- */
  var gameBound = false;
  function bindGameOnce() {
    if (gameBound) return;
    gameBound = true;
    store.subscribe(KEY.sessions, function () { onData(false); });
    el('btnClaim').addEventListener('click', submitClaim);
    el('btnLeave').addEventListener('click', function () {
      ui.confirm({
        title: 'ออกจากเกม?',
        message: 'จะกลับไปหน้าตั้งชื่อ (คะแนนเดิมในห้องยังอยู่)',
        okLabel: 'ออกได้'
      }).then(function (ok) {
        if (!ok) return;
        saveIdentity({ name: '' });
        state.joined = false;
        state.me = null;
        state.session = null;
        state.selectedItemId = null;
        showJoinView();
        el('joinNameInput').value = '';
      });
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') onData(true);
    });
  }

  /* ---------------- data pipeline ---------------- */
  function sigOf(s) {
    var me = state.me;
    var my = me ? [me.score, me.pos, me.correctItemIds && me.correctItemIds.length, me.bingoAwarded, me.reachedGoal,
      me.claim && (me.claim.round + ':' + me.claim.status + ':' + (me.claim.itemId || ''))] : [];
    return JSON.stringify([s.status, s.round, s.current && s.current.revealed, s.current && s.current.answered,
      s.results.length, s.players.length, state.selectedItemId, my]);
  }

  function onData(force) {
    if (!state.sid) return;
    var idT = identity();
    var s = rooms.get(state.sid);
    if (!s) {
      // ห้องถูกลบ/ถูกเคลียร์ → กลับไปหน้าตั้งชื่อ (เดิมจอค้างคาเกม)
      state.joined = false;
      state.session = null;
      state.me = null;
      state.selectedItemId = null;
      showJoinView();
      return;
    }
    var me = game.findPlayer(s, idT.playerId) || game.findPlayerByName(s, idT.name) || state.me;
    if (!me) return;
    state.me = me;
    var sig = sigOf(s);
    if (!force && sig === state.lastSig) return;
    state.lastSig = sig;
    // รอบคำถามใหม่ → เคลียร์การ์ดที่แตะเลือกไว้ในรอบก่อน (กันกด "เคลม" ซ้ำของเดิม)
    if (s.current && state.session && state.session.current &&
        s.current.round !== state.session.current.round) {
      state.selectedItemId = null;
    }
    state.session = s;
    state.set = rooms.setOf(s) || state.set;

    render(false);
    processRoundFeedback();
  }

  function render(isJoin) {
    var s = state.session, me = state.me;
    if (!s || !me || !state.joined) return;

    // ฉลองเมื่อถึงเส้นชัย (พูดครั้งเดียวต่อการถึงเส้นชัย)
    if (me.reachedGoal && !state.goalShown && s.status === 'playing') {
      state.goalShown = true;
      ui.confetti(80);
      ui.SFX.win();
      ui.toast('👑 ถึงเส้นชัยช่อง ' + s.trackLength + ' แล้ว! สุดยอด!', 'ok', 4200);
    }
    if (!me.reachedGoal && s.status === 'playing') state.goalShown = false;

    el('meName').textContent = me.name;
    el('meRoom').textContent = s.joinCode || '-';
    el('meRound').textContent = s.round + '/' + s.rounds;
    var av = el('meAvatar');
    av.style.background = me.color || '#00f3ff';
    av.textContent = (me.name || '?').slice(0, 1).toUpperCase();
    el('meScore').textContent = me.score + ' คะแนน';
    var rank = game.ranking(s).findIndex(function (p) { return p.id === me.id; }) + 1;
    el('meRank').textContent = 'อันดับ ' + (rank || '-') + '/' + (s.players || []).length;

    renderHint();
    renderBoard();
    renderClaimControls();
    renderMiniLb();
    renderFinished();
  }

  /* ---------------- hint area ---------------- */
  function renderHint() {
    var box = el('hintInner');
    box.innerHTML = '';
    var s = state.session, me = state.me, cur = s.current;

    if (s.status === 'finished') {
      box.appendChild(h('div', { class: 'stack center', style: 'gap:6px' }, [
        h('div', { class: 'tile-ico', text: '🏆' }),
        h('div', { class: 'proj-word-sm neon-green', text: 'จบเกมแล้ว!' }),
        h('div', { class: 'sm muted', text: 'ดูผลอันดับได้ด้านล่างเลย' })
      ]));
      return;
    }
    if (!cur) {
      box.appendChild(h('div', { class: 'stack center', style: 'gap:6px' }, [
        h('div', { class: 'tile-ico', text: '🎲' }),
        h('div', { class: 'sm', text: s.status === 'lobby' ? 'รอครูเริ่มเกม…' : 'รอคำถามถัดไป…' })
      ]));
      return;
    }

    var mine = me.claim && me.claim.round === cur.round;
    var isWrong = mine && me.claim.status === 'wrong';
    var done = mine && me.claim.status === 'correct';
    var item = rooms.itemById(s, cur.itemId) || cur;

    if (cur.answered) {
      // เฉลยแล้ว
      box.appendChild(h('div', { class: 'stack center', style: 'gap:6px' }, [
        h('div', { class: 'word-ico', text: item.icon || '💻' }),
        h('div', { class: 'word-term proj-word-sm neon-cyan', text: cur.term }),
        h('div', { class: 'sm muted', text: item.meaning }),
        isWrong
          ? h('span', { class: 'chip chip-red', text: 'ขออภัย ตอบไม่ถูกในรอบนี้ 🙈' })
          : (done ? h('span', { class: 'chip chip-green', text: '✅ ตอบถูกแล้ว!' }) : h('span', { class: 'chip chip-amber', text: 'รอบนี้ยังไม่ได้เคลม' }))
      ]));
      return;
    }

    // ยังไม่เฉลย = โชว์คำใบ้
    box.appendChild(h('div', { class: 'stack center', style: 'gap:6px' }, [
      h('div', { class: 'tiny muted', text: '💡 คำใบ้ (บนจอ Projector)' }),
      h('div', { class: 'proj-word-sm', style: 'max-width:52ch;line-height:1.4', text: item.meaning }),
      h('div', { class: 'tiny muted', text: 'คำถามข้อที่ ' + cur.round + '/' + s.rounds + ' — หาไอคอน/ชื่อที่ตรงกันในการ์ดของคุณ' })
    ]));
  }

  /* ---------------- board ---------------- */
  function canClaim() {
    var s = state.session, me = state.me;
    if (!me || !s) return false;
    if (s.status !== 'playing' || !s.current || s.current.answered) return false;
    // เคลมได้ครั้งเดียวต่อรอบ (กดไปแล้วจะเคลมซ้ำไม่ได้ ไม่ว่ากำลังตรวจ/ถูก/ผิด)
    if (me.claim && me.claim.round === s.current.round) return false;
    return true;
  }

  function renderBoard() {
    var box = el('board');
    box.innerHTML = '';
    var s = state.session, me = state.me;
    var size = s.gridSize || 4;
    box.classList.toggle('is3', size === 3);

    var board = me.board || [];
    var doneSet = {};
    (me.correctItemIds || []).forEach(function (id) { doneSet[id] = true; });
    var bingoCells = me.bingoCells || [];
    var claimable = canClaim();
    var cur = s.current;

    board.forEach(function (cell) {
      var it = state.set ? (state.set.items || []).filter(function (i) { return i.id === cell.itemId; })[0] : null;
      it = it || { icon: '💻', term: '?', meaning: '' };
      var isCorrectTile = doneSet[cell.itemId];
      var isWrongTile = !!(me.claim && me.claim.status === 'wrong' && me.claim.itemId === cell.itemId);
      var isAnswerTile = !!(cur && cur.answered && cur.itemId === cell.itemId);
      var isSelected = state.selectedItemId === cell.itemId;

      var cls = 'tile';
      if (isSelected) cls += ' is-selected';
      if (isCorrectTile) cls += ' is-correct';
      if (isWrongTile) cls += ' is-wrong';
      if (isAnswerTile && !isCorrectTile) cls += ' is-answer';
      if (bingoCells.indexOf(cell.pos) > -1) cls += ' is-bingo';
      if (!claimable || isCorrectTile || (me.claim && me.claim.status === 'pending')) cls += ' is-locked';

      var node = h('button', {
        class: cls,
        type: 'button',
        onclick: function () {
          if (!claimable || isCorrectTile) { ui.SFX.wrong(); return; }
          state.selectedItemId = (state.selectedItemId === cell.itemId ? null : cell.itemId);
          ui.SFX.click();
          render(false);
        }
      }, [
        h('span', { class: 't-cat', text: it.category || '' }),
        h('span', { class: 't-ico', text: it.icon || '💻' }),
        h('span', { class: 't-term', text: it.term })
      ]);
      box.appendChild(node);
    });
  }

  /* ---------------- claim ---------------- */
  function submitClaim() {
    var me = state.me, s = state.session;
    if (!canClaim()) { ui.toast('รอบนี้ยังเคลมไม่ได้', 'warn'); return; }
    if (!state.selectedItemId) { ui.toast('แตะเลือกการ์ดที่คิดว่าถูกก่อน', 'warn'); return; }
    var item = state.set ? (state.set.items || []).filter(function (i) { return i.id === state.selectedItemId; })[0] : null;
    if (!item) return;
    ui.SFX.click();
    state.scoreBeforeClaim = me.score || 0;
    rooms.submitClaim(state.sid, me.id, item.id, item.term, function (ok, claim) {
      if (ok) {
        state.feedbackKey = '';
        render(false);
        ui.SFX.correct();
        ui.toast('ส่งคำตอบ "' + item.term + '" แล้ว — รอครูตรวจ…', 'info', 2200);
      } else {
        ui.toast('ส่งคำตอบไม่สำเร็จ กรุณาลองใหม่', 'err');
      }
    });
  }

  function renderClaimControls() {
    var s = state.session, me = state.me;
    var btn = el('btnClaim');
    var line = el('claimStatus');
    line.innerHTML = '';
    var chip = null;
    if (!s || !me) { chip = h('span', { class: 'chip', text: '…' }); }
    else if (s.status === 'lobby') { chip = h('span', { class: 'chip', text: 'รอครูเริ่มเกม' }); }
    else if (s.status === 'finished') { chip = h('span', { class: 'chip chip-amber', text: 'จบเกมแล้ว' }); }
    else if (!s.current) { chip = h('span', { class: 'chip', text: 'รอบนี้ยังไม่เริ่ม' }); }
    else if (s.current.answered) { chip = h('span', { class: 'chip chip-amber', text: 'รอบนี้ปิดแล้ว' }); }
    else if (me.claim && me.claim.status === 'pending') { chip = h('span', { class: 'chip chip-cyan', style: 'animation:pulse 1.2s infinite', text: '📮 ส่งแล้ว รอครูตรวจ…' }); }
    else if (me.claim && me.claim.status === 'wrong') { chip = h('span', { class: 'chip chip-red', text: '❌ รอบนี้ตอบผิด' }); }
    else if (me.claim && me.claim.status === 'correct') { chip = h('span', { class: 'chip chip-green', text: '✅ ตอบถูกไปแล้ว' }); }
    else { chip = h('span', { class: 'chip', text: state.selectedItemId ? '✨ เลือกแล้ว กดเคลมได้เลย!' : 'แตะการ์ดที่ตรงกับคำใบ้ด้านบน' }); }

    line.appendChild(chip);
    btn.disabled = !(canClaim() && state.selectedItemId);
    if (!btn.disabled) btn.classList.add('glow');
    else btn.classList.remove('glow');
  }

  /* ---------------- feedback หลังครูตรวจ ---------------- */
  function processRoundFeedback() {
    var me = state.me, s = state.session;
    if (!me || !s || !s.current) return;
    var cur = s.current;
    var claim = me.claim;
    if (!claim || claim.round !== cur.round) return;

    // นับเครื่องหมายถูก + ตรวจบิงโก (ครั้งเดียวต่อรอบ/คน) — ต้องรันแม้เป็น tab กลับเข้ามาใหม่
    // หลังถูกตรวจแล้ว ไม่งั้นจะพลาด +150 และเครื่องหมายบนกระดาน
    if (claim.status === 'correct' && state.markedRound !== cur.round) {
      state.markedRound = cur.round;
      rooms.markCorrect(state.sid, me.id, claim.itemId, function (fresh) {
        if (fresh) {
          state.session = fresh;
          state.me = game.findPlayer(fresh, me.id) || state.me;
          render(false);
        }
      });
    }

    var key = claim.round + ':' + claim.status;
    if (state.feedbackKey === key) return;
    state.feedbackKey = key;

    if (claim.status === 'correct') {
      // markCorrect ทำงานแบบ synchronous → state.me เป็น object ใหม่ (คะแนน+บิงโกอัปเดตแล้ว)
      // ใช้ตัวใหม่แทนตัวเก่า ไม่งั้น toast "บิงโก" จะไม่โผล่
      var liveMe = state.me || me;
      var delta = (liveMe.score || 0) - (state.scoreBeforeClaim || 0);
      ui.SFX.correct();
      if (liveMe.bingoAwarded) {
        ui.confetti(120);
        ui.toast('🎯 บิงโก! ต่อแถวได้ — โบนัส ' + game.SCORING.bingoBonus + ' (ได้ทั้งหมด +' + delta + ' คะแนน)', 'ok', 3600);
      } else {
        ui.toast('ตอบถูก! +' + (delta > 0 ? delta : 100) + ' คะแนน ⚡', 'ok', 2400);
      }
    } else if (claim.status === 'wrong') {
      ui.SFX.wrong();
      ui.toast('ครูตรวจแล้ว: ยังไม่ถูก ลองใหม่รอบหน้า!', 'err', 2600);
    }
  }

  /* ---------------- mini leaderboard + finished ---------------- */
  function renderMiniLb() {
    var box = el('miniLb');
    box.innerHTML = '';
    var s = state.session, me = state.me;
    if (!s) return;
    var list = game.ranking(s).slice(0, 5);
    if (!list.length) {
      box.appendChild(h('div', { class: 'tiny muted', text: 'ยังไม่มีอันดับ' }));
      return;
    }
    list.forEach(function (p, i) {
      var isMe = me && p.id === me.id;
      box.appendChild(h('div', { class: 'lb-row' + (isMe ? ' is-top' : ''), style: isMe ? 'border-color:var(--green)' : '' }, [
        h('div', { class: 'rank-badge' + (i < 3 ? ' rank-' + (i + 1) : ''), text: String(i + 1) }),
        h('div', { class: 'pname', style: 'flex:1', text: p.name + (isMe ? ' (ฉัน)' : '') }),
        h('div', { class: 'sm muted', style: 'min-width:3ch;text-align:right', text: '🔥' + p.bestStreak }),
        h('div', { class: 'lb-score', text: p.score })
      ]));
    });
  }

  function renderFinished() {
    var s = state.session;
    if (!s) return;
    if (s.status === 'finished' && !state.finishedShown) {
      state.finishedShown = true;
      ui.confetti(100);
      ui.SFX.win();
      var me = state.me;
      var rank = game.ranking(s).findIndex(function (p) { return p.id === (me && me.id); }) + 1;
      ui.toast('จบเกมแล้ว! อันดับของฉัน: #' + rank, 'ok', 4200);
    }
    if (s.status !== 'finished') state.finishedShown = false;
  }

  /* ---------------- boot ---------------- */
  function boot() {
    ui.setSound((store.read(store.KEYS.prefs) || {}).sound !== false);

    var cp = codeParam();
    var id = identity();
    if (cp) el('joinCodeInput').value = cp;
    if (id.name) el('joinNameInput').value = id.name;

    el('btnJoin').addEventListener('click', doJoin);
    el('joinCodeInput').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') el('joinNameInput').focus();
    });
    el('joinNameInput').addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') doJoin();
    });

    // เข้าห้องอัตโนมัติถ้าเคยเล่นห้องนี้อยู่แล้ว
    var targetCode = cp || game.normalizeCode(id.code);
    if (targetCode && id.name && id.playerId) {
      var sess = rooms.findOpenByCode(targetCode);
      if (sess) {
        var res = rooms.join(sess.id, id.name, id.seed);
        if (res.ok) {
          state.me = res.player;
          state.feedbackKey = claimKeyFrom(state.me, sess) || '';
          state.markedRound = sess.current && sess.current.round ? sess.current.round - 1 : -1;
          state.scoreBeforeClaim = state.me.score || 0;
          state.joined = true;
          state.sid = sess.id;
          state.session = sess;
          state.set = rooms.setOf(sess);
          showGameView();
          bindGameOnce();
          render(true);
          ui.toast('กลับเข้าเกมต่อเรียบร้อย', 'info', 1800);
          return;
        }
      }
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);