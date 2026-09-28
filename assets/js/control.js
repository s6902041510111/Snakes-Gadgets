/* =========================================================
   control.js — หน้าจอควบคุมห้องเล่นของครู (teacher.html)
   ● ดึงคำถาม / ตรวจคำเคลม / เรียกคะแนน / ส่งออกผล
   ● ครูเห็นเฉลย แต่บน Projector จะเป็นรูเล็ตก่อนเฉลย
   ========================================================= */
(function (global) {
  'use strict';

  var ITS = global.ITS;
  var store = ITS.store, game = ITS.game, ui = ITS.ui, rooms = ITS.rooms;
  var el = ui.el, h = ui.h, esc = game.escapeHtml;

  var state = { sid: null, session: null, set: null, lastSig: '', timer: null, autoClosed: false };

  /* ---------------- helpers ---------------- */
  function sidFromUrl() {
    try { return new URLSearchParams(location.search).get('s'); }
    catch (e) { return null; }
  }

  function signature(s) {
    return JSON.stringify([
      s.status, s.round, s.current && s.current.revealed, s.current && s.current.answered,
      s.results.length, s.players.map(function (p) {
        return [p.id, p.score, p.pos, p.claim && p.claim.status, p.bingoAwarded, p.reachedGoal, p.disconnected];
      })
    ]);
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') +
      '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  }

  /* ---------------- load + subscribe ---------------- */
  function load() {
    state.sid = sidFromUrl();
    el('btnBack').addEventListener('click', function () { location.href = 'index.html'; });
    el('btnProjector').addEventListener('click', function () {
      if (!state.sid) { ui.toast('ยังไม่มีห้องเล่น — สร้างจากหน้าหลักก่อน', 'warn'); return; }
      global.open('projector.html?s=' + encodeURIComponent(state.sid), '_blank');
    });
    el('btnExportJson').addEventListener('click', function () { exportFile('json'); });
    el('btnExportCsv').addEventListener('click', function () { exportFile('csv'); });
    el('btnEnd').addEventListener('click', endGame);
    el('btnStart').addEventListener('click', startGame);
    el('btnDraw').addEventListener('click', drawNext);
    el('btnAutoJudge').addEventListener('click', autoJudge);

    // subscribe เสมอ — ถ้าเปิดหน้าก่อนมีห้อง/ห้องถูกสร้างทีหลัง จะรับอัตโนมัติ
    store.subscribe(store.KEYS.sessions, function () { onData(false); });
    onData(true);
  }

  function showNoRoom() {
    el('roomName').textContent = 'ไม่พบห้องเล่น';
    el('statusChip').textContent = '—';
    el('flowInner').innerHTML = '';
    el('flowInner').appendChild(h('div', { class: 'stack center', style: 'gap:10px' }, [
      h('div', { class: 'ico', style: 'font-size:3rem', text: '🚪' }),
      h('div', { class: 'sm', text: 'ไม่พบห้องเล่นนี้ (อาจถูกลบไปแล้ว หรือใช้ ID ผิด)' }),
      h('button', { class: 'btn btn-cyan', onclick: function () { location.href = 'index.html'; } }, '← กลับไปหน้าหลัก')
    ]));
  }

  function onData(force) {
    var s = rooms.get(state.sid);
    if (!s && !state.sid) {
      var list = rooms.all();
      if (list.length) state.sid = list[0].id;
      s = rooms.get(state.sid);
    }
    if (!s) { showNoRoom(); return; }
    var sig = signature(s);
    if (!force && sig === state.lastSig) return;
    state.lastSig = sig;
    state.session = s;
    if (!state.set) state.set = rooms.setOf(s);
    if (s.status !== 'finished') state.podiumShown = false;
    render();
    syncTimer();
  }

  /* ---------------- actions ---------------- */
  function startGame() {
    if (!state.sid) { ui.toast('ยังไม่มีห้องเล่น', 'warn'); return; }
    var res = rooms.update(state.sid, function (d) { return game.startSession(d); });
    if (res.ok) { ui.SFX.join(); ui.toast('เริ่มเกมแล้ว! กดสุ่มคำถามได้เลย', 'ok'); }
  }

  function drawNext() {
    var s = state.session;
    if (!s) return;
    if (s.status === 'lobby') { ui.toast('กด "เริ่มเล่น" ก่อน', 'warn'); return; }
    if (s.current && !s.current.answered) { ui.toast('ยังไม่จบรอบปัจจุบัน กด "เฉลย/จบรอบ" ก่อน', 'warn'); return; }
    var res = rooms.update(s.id, function (d) {
      var set = rooms.setOf(d) || state.set;
      var cur = game.drawQuestion(d, set);
      if (!cur) game.finishSession(d, 'rounds');
      return d;
    });
    if (res.ok) {
      if (res.session.status === 'finished') {
        ui.SFX.win();
        ui.toast('ครบทุกคำถามแล้ว 🎉 จัดอันดับผลให้ดูบน Projector', 'ok');
      } else {
        state.autoClosed = false;
        ui.SFX.spin();
        ui.toast('สุ่มคำถามแล้ว: ' + res.session.current.term + ' (คนอื่นยังไม่เห็นเฉลย)', 'info');
      }
    }
  }

  function judge(playerId, correct) {
    var s = state.session;
    if (!s || !s.current) return;
    if (s.current.answered) { ui.toast('รอบนี้ปิดรับคำตอบแล้ว', 'warn'); return; }
    var res = rooms.update(s.id, function (d) {
      var p = game.findPlayer(d, playerId);
      if (!p || !p.claim || p.claim.status !== 'pending') return d;
      game.resolveClaim(d, playerId, correct, p.claim.term);
      return d;
    });
    if (res.ok) {
      ui.SFX[correct ? 'correct' : 'wrong']();
      ui.toast(correct ? 'ตรวจถูกต้อง ✅' : 'ตอบผิด ❌', correct ? 'ok' : 'err', 1600);
    } else {
      ui.toast('คำขอเคลมนี้ตรวจไปแล้ว', 'warn');
    }
  }

  function autoJudge() {
    if (!state.sid) { ui.toast('ยังไม่มีห้องเล่น', 'warn'); return; }
    var res = rooms.update(state.sid, function (d) {
      if (!d.current || d.current.answered) return d;
      var n = 0;
      d.players.forEach(function (p) {
        if (p.claim && p.claim.status === 'pending') {
          game.resolveClaim(d, p.id, null, p.claim.term);
          n++;
        }
      });
      return d;
    });
    if (res.ok) {
      ui.SFX.tick();
      ui.toast(res.session.current && res.session.current.answered ? 'รอบถูกปิดแล้ว' : 'ตรวจคำเคลมเรียบร้อย', 'ok');
    }
  }

  /** เฉลย + ปิดรับคำตอบ + ตัดสินคำเคลมที่ค้างอยู่ */
  function closeRound() {
    if (!state.sid || !state.session) { ui.toast('ยังไม่มีห้องเล่น', 'warn'); return; }
    var res = rooms.update(state.sid, function (d) {
      if (!d.current || d.current.answered) return d;
      d.current.revealed = true;
      d.current.answered = true;
      d.players.forEach(function (p) {
        if (p.claim && p.claim.status === 'pending') game.resolveClaim(d, p.id, null, p.claim.term);
      });
      d.current.resolvedAt = Date.now();
      return d;
    });
    if (res.ok) {
      ui.SFX.tick();
      ui.toast('เฉลย "' + res.session.current.term + '" แล้ว — พร้อมสุ่มคำถามถัดไป', 'ok');
    }
  }

  function endGame() {
    var s = state.session;
    if (!s) { ui.toast('ยังไม่มีห้องเล่น', 'warn'); return; }
    ui.confirm({
      title: 'จบเกมและประกาศผล',
      message: 'ต้องการจบเกมห้อง "' + s.setName + '" ทันทีหรือไม่? (คำถามที่ยังเล่นอยู่จะถูกตัดจบ)',
      okLabel: '🏁 จบเกมเลย'
    }).then(function (ok) {
      if (!ok) return;
      rooms.update(s.id, function (d) { return game.finishSession(d, 'manual'); });
      ui.SFX.win();
      ui.toast('จบเกมแล้ว 🎉 ดูผลบนหน้าจอ Projector', 'ok');
    });
  }

  function adjScore(playerId, delta) {
    var changed = { v: false };
    rooms.update(state.sid, function (d) {
      var p = game.findPlayer(d, playerId);
      if (!p) return d;
      var next = Math.max(0, (p.score || 0) + delta);
      if (next === (p.score || 0) && delta < 0) return d; // แต้ม 0 แล้ว ไม่ต้องลง log
      p.score = next;
      changed.v = true;
      game.addLog(d, 'adjust', 'ครูปรับคะแนน ' + p.name + ' ' + (delta > 0 ? '+' : '') + delta);
      return d;
    });
    if (changed.v) ui.SFX.click();
  }

  function exportFile(kind) {
    var s = state.session, set = state.set;
    if (!s) { ui.toast('ยังไม่มีห้องเล่น', 'warn'); return; }
    var base = 'itsc-' + ui.fileSafe(s.setName || 'result') + '-' + s.joinCode + '-' + stamp();
    if (kind === 'json') {
      ui.download(base + '.json', JSON.stringify(game.exportSession(s, set), null, 2));
    } else {
      ui.download(base + '.csv', game.toCsv(s), 'text/csv;charset=utf-8');
    }
    ui.toast('ส่งออกไฟล์ .' + kind + ' แล้ว', 'ok');
  }

  /* ---------------- timer ---------------- */
  function syncTimer() {
    clearInterval(state.timer);
    state.timer = null;
    var s = state.session;
    if (!s || s.status !== 'playing' || !s.current || s.current.answered) {
      var bar = el('timerFill');
      if (bar) { bar.style.width = '0%'; el('timerTxt').textContent = '—'; el('timerTxt').classList.remove('low'); }
      return;
    }
    state.timer = setInterval(tickTimer, 400);
    tickTimer();
  }

  function tickTimer() {
    var s = state.session, cur = s.current;
    var bar = el('timerFill');
    if (!bar || !cur) return;
    var left = Math.max(0, cur.drawnAt + game.SCORING.timeLimitMs - Date.now());
    var frac = left / game.SCORING.timeLimitMs;
    bar.style.width = Math.round(frac * 100) + '%';
    bar.classList.toggle('is-low', frac < 0.3);
    var txt = el('timerTxt');
    txt.textContent = Math.ceil(left / 1000) + ' วินาที';
    txt.classList.toggle('low', frac < 0.3);
    var deadline = cur.drawnAt + game.SCORING.timeLimitMs + 3500;
    if (!state.autoClosed && Date.now() > deadline) {
      state.autoClosed = true;
      var btn = el('btnReveal');
      if (btn) btn.classList.add('glow');
      ui.SFX.tick();
      ui.toast('⏰ หมดเวลาตอบแล้ว — กด "เฉลย/จบรอบ" ได้เลย', 'info', 3800);
    }
  }

  /* ---------------- render ---------------- */
  function render() {
    var s = state.session, set = state.set;
    el('roomName').textContent = s.setName || 'ห้องเรียน';
    el('joinCode').textContent = s.joinCode || '-';
    el('roundInfo').textContent = 'รอบ ' + s.round + '/' + s.rounds;
    var statusChip = el('statusChip');
    statusChip.className = 'chip ' + (s.status === 'playing' ? 'chip-green' : s.status === 'finished' ? 'chip-amber' : 'chip-cyan');
    statusChip.textContent = s.status === 'playing' ? 'กำลังเล่น' : s.status === 'finished' ? 'จบเกมแล้ว' : 'รอนักเรียนเข้าร่วม';
    el('countPlayers').textContent = (s.players || []).length + ' คน';

    renderFlow();
    renderRoster();
    renderClaims();
    renderFeed();
  }

  function renderFlow() {
    var inner = el('flowInner');
    inner.innerHTML = '';
    var s = state.session, set = state.set;
    if (!set) { inner.textContent = 'ไม่พบข้อมูลชุดกิจกรรมของห้องนี้'; return; }

    if (s.status === 'lobby') {
      inner.appendChild(h('div', { class: 'stack center', style: 'gap:10px;padding:8px 0' }, [
        h('div', { class: 'tile-ico', text: '🕹️' }),
        h('div', { class: 'proj-word-sm neon-cyan', text: 'ห้องพร้อมรอแล้ว' }),
        h('div', { class: 'sm muted', text: 'เปิดหน้าจอ Projector ให้นักเรียนเห็นรหัสห้อง + QR แล้วกด "เริ่มเล่น"' }),
        h('div', { class: 'row wrapy center', style: 'justify-content:center;gap:6px' }, [
          h('span', { class: 'chip chip-cyan', text: s.gridSize + 'x' + s.gridSize + ' ต่อใบ' }),
          h('span', { class: 'chip chip-purple', text: (set.items || []).length + ' อุปกรณ์' }),
          h('span', { class: 'chip chip-green', text: s.rounds + ' รอบคำถาม' }),
          h('span', { class: 'chip', text: 'คนที่เล่น: ' + (s.players || []).length })
        ])
      ]));
      return;
    }

    if (s.status === 'finished') {
      renderPodium(inner, s);
      return;
    }

    // playing
    var cur = s.current;
    if (!cur) {
      inner.appendChild(h('div', { class: 'stack center', style: 'gap:10px' }, [
        h('div', { class: 'tile-ico', text: '🎲' }),
        h('div', { class: 'proj-word-sm neon-purple', text: 'พร้อมเริ่มรอบที่ ' + (s.round + 1) }),
        h('div', { class: 'sm muted', text: 'กด "สุ่มคำถามถัดไป" เพื่อดึงคำถาม — วงล้อจะหมุนบน Projector' })
      ]));
      return;
    }

    var item = rooms.itemById(s, cur.itemId) || cur;
    var stage = h('div', { class: 'word-stage', style: 'min-height:120px' }, [
      h('div', { class: 'word-ico', text: item.icon || '💻' }),
      h('div', { class: 'word-term neon-cyan proj-word', text: cur.term }),
      h('div', { class: 'sm', text: item.meaning || cur.meaning }),
      h('div', { class: 'tiny muted', text: '🔒 คำนี้ยังเป็นความลับบนจอ จนกว่าจะกด "เฉลย"' })
    ]);

    var timerArea = h('div', { class: 'stack', style: 'gap:6px' }, [
      h('div', { class: 'row-between' }, [
        h('span', { class: 'tiny muted', text: '⏱ เวลาตอบ (อ้างอิงโบนัสความเร็ว)' }),
        h('span', { class: 'mono neon-cyan countdown', id: 'timerTxt', text: '—' })
      ]),
      h('div', { class: 'timer-bar' }, [h('div', { class: 'timer-fill', id: 'timerFill' })])
    ]);

    var btns = h('div', { class: 'row wrapy', style: 'gap:8px;margin-top:4px' }, [
      h('button', {
        class: 'btn ' + (cur.answered ? 'btn-ghost is-disabled' : 'btn-green'), id: 'btnReveal',
        onclick: function () {
          if (cur.answered) { ui.toast('รอบนี้ปิดไปแล้ว', 'warn'); return; }
          closeRound();
        }
      }, cur.answered ? '✅ รอบนี้เฉลยแล้ว' : '🔔 เฉลย / จบรอบ'),
      h('button', {
        class: 'btn btn-purple' + (cur.answered ? '' : ' is-disabled'),
        onclick: function () { if (cur.answered) drawNext(); }
      }, '🎲 สุ่มคำถามถัดไป'),
      h('span', { class: 'chip ' + (cur.revealed ? 'chip-green' : 'chip-amber'), text: cur.revealed ? '✨ เฉลยแสดงบนจอแล้ว' : '🎰 วงล้อกำลังหมุนบนจอ' })
    ]);

    var roundChip = h('div', { class: 'row wrapy', style: 'gap:6px;margin-bottom:10px' }, [
      h('span', { class: 'chip chip-cyan', text: 'คำถามข้อที่ ' + cur.round + '/' + s.rounds }),
      h('span', { class: 'chip chip-purple', text: 'ผู้ตอบแล้ว: ' + (s.players || []).filter(function (p) { return p.claim && p.claim.round === cur.round; }).length + '/' + (s.players || []).length })
    ]);

    inner.appendChild(h('div', { class: 'stack', style: 'gap:14px' }, [roundChip, stage, timerArea, btns]));
  }

  function renderPodium(inner, s) {
    var rank = game.ranking(s);
    if (!state.podiumShown) {
      state.podiumShown = true;
      ui.confetti();
      ui.SFX.win();
    }
    var top3 = rank.slice(0, 3);
    inner.appendChild(h('div', { class: 'stack center', style: 'gap:12px' }, [
      h('div', { class: 'tile-ico', text: '🏆' }),
      h('div', { class: 'proj-word-sm neon-green', text: 'จบเกมแล้ว!' }),
      h('div', { class: 'sm muted', text: 'รอบที่เล่น ' + s.round + '/' + s.rounds + ' · ชมผลบน Projector' }),
      h('div', { class: 'row center wrapy', style: 'justify-content:center;gap:10px' },
        top3.map(function (p, i) {
          var medals = ['🥇', '🥈', '🥉'];
          return h('div', { class: 'glass-soft', style: 'border:1px solid var(--line);min-width:150px;text-align:center;padding:14px 18px' }, [
            h('div', { style: 'font-size:2rem', text: medals[i] }),
            h('div', { class: 'pname neon-cyan', text: p.name }),
            h('div', { class: 'mono neon-green', style: 'font-size:1.2rem', text: p.score + ' คะแนน' })
          ]);
        })),
      h('button', { class: 'btn btn-cyan', onclick: function () { location.href = 'index.html'; } }, '← กลับไปหน้าหลัก')
    ]));
  }

  function renderRoster() {
    var box = el('roster');
    box.innerHTML = '';
    var s = state.session;
    var list = game.ranking(s);
    if (!list.length) {
      box.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'ico', text: '🧑‍🎓' }),
        h('div', { text: 'ยังไม่มีนักเรียนเข้าร่วม' })
      ]));
      return;
    }
    list.forEach(function (p, i) {
      var claimChip = null;
      if (p.claim && p.claim.status === 'pending') {
        claimChip = h('span', { class: 'chip chip-amber', text: '📮 เคลม: ' + p.claim.term });
      } else if (p.claim && p.claim.status === 'correct') {
        claimChip = h('span', { class: 'chip chip-green', text: '✔ ถูก' });
      } else if (p.claim && p.claim.status === 'wrong') {
        claimChip = h('span', { class: 'chip chip-red', text: '✘ ผิด' });
      }
      var row = h('div', {
        class: 'prow' + (p.claim && p.claim.status === 'pending' ? ' is-claiming' : ''),
        style: 'flex-wrap:wrap'
      }, [
        h('div', { class: 'rank-badge' + (i < 3 ? ' rank-' + (i + 1) : ''), text: String(i + 1) }),
        h('div', { class: 'avatar', style: 'background:' + p.color, text: (p.name || '?').slice(0, 1).toUpperCase() }),
        h('div', { class: 'grow' }, [
          h('div', { class: 'row' }, [
            h('span', { class: 'pname', text: p.name }),
            claimChip
          ]),
          h('div', { class: 'pmini', text: '✅ ' + p.correct + '/' + p.answered + ' · 🔥' + p.streak + ' · ช่อง ' + p.pos + (p.bingoAwarded ? ' · 🎯บิงโก' : '') })
        ]),
        h('div', { class: 'row', style: 'gap:5px' }, [
          h('button', { class: 'btn btn-ghost btn-sm btn-icon', title: 'ลบ 5 คะแนน', onclick: function () { adjScore(p.id, -5); } }, '−5'),
          h('span', { class: 'mono neon-green', style: 'font-weight:700;min-width:3.5ch;text-align:center', text: p.score }),
          h('button', { class: 'btn btn-ghost btn-sm btn-icon', title: 'เพิ่ม 5 คะแนน', onclick: function () { adjScore(p.id, +5); } }, '+5')
        ])
      ]);
      box.appendChild(row);
    });
  }

  function renderClaims() {
    var box = el('claimList');
    box.innerHTML = '';
    var s = state.session;
    var pend = (s.players || []).filter(function (p) { return p.claim && p.claim.status === 'pending'; });
    if (!pend.length) {
      box.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'ico', text: '📮' }),
        h('div', { text: 'ยังไม่มีคำร้องขอจากนักเรียน' })
      ]));
      el('btnAutoJudge').classList.add('hidden');
      return;
    }
    el('btnAutoJudge').classList.remove('hidden');
    pend.forEach(function (p) {
      box.appendChild(h('div', { class: 'prow claim-row' }, [
        h('div', { class: 'avatar', style: 'background:' + p.color, text: (p.name || '?').slice(0, 1).toUpperCase() }),
        h('div', { class: 'grow' }, [
          h('div', { class: 'pname', text: p.name }),
          h('div', { class: 'row wrapy' }, [
            h('span', { class: 'chip chip-cyan mono', text: p.claim.term }),
            h('span', { class: 'chip', text: game.fmtMs(p.claim.ms) })
          ])
        ]),
        h('div', { class: 'row', style: 'gap:6px' }, [
          h('button', { class: 'btn btn-green btn-sm', title: 'ตอบถูก', onclick: function () { judge(p.id, true); } }, '✔ ถูก'),
          h('button', { class: 'btn btn-danger btn-sm', title: 'ตอบผิด', onclick: function () { judge(p.id, false); } }, '✘ ผิด')
        ])
      ]));
    });
  }

  function renderFeed() {
    var box = el('feed');
    box.innerHTML = '';
    var log = (state.session.log || []).slice(-36).reverse();
    if (!log.length) {
      box.appendChild(h('div', { class: 'tiny muted', text: 'ยังไม่มีเหตุการณ์' }));
      return;
    }
    var icon = { created: '🏗️', join: '🚪', draw: '🎲', claim: '📮', correct: '✅', wrong: '❌', start: '▶️', finish: '🏁', bingo: '🎯', adjust: '✚', ladder: '🪜', snake: '🐍' };
    log.forEach(function (e) {
      box.appendChild(h('div', { class: 'feed-item' }, [
        h('span', { text: icon[e.type] || '•' }),
        h('div', { class: 'grow', style: 'min-width:0' }, [
          h('span', { style: 'opacity:.9', text: e.text }),
          h('div', { class: 'tiny muted', text: ui.fmtClock(e.at) })
        ])
      ]));
    });
  }

  /* ---------------- boot ---------------- */
  function boot() {
    ui.setSound((store.read(store.KEYS.prefs) || {}).sound !== false);
    load();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') onData(true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);