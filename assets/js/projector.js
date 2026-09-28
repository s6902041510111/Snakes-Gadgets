/* =========================================================
   projector.js — หน้าจอฉาย (Projector) สำหรับนักเรียนดูรวม
   ● รหัสห้อง + QR (lobby)  ● วงล้อสุ่มคำถาม  ● กระดานรวม  ● อันดับสด
   ========================================================= */
(function (global) {
  'use strict';

  var ITS = global.ITS;
  var store = ITS.store, game = ITS.game, ui = ITS.ui, rooms = ITS.rooms;
  var el = ui.el, h = ui.h, esc = game.escapeHtml;

  var state = { sid: null, session: null, set: null, lastSig: '', lastDrawnAt: 0, lastPlayerCount: -1, lastResultCount: -1, lastPodium: false, roulette: null, qrCode: null };

  function sidFromUrl() {
    try { return new URLSearchParams(location.search).get('s'); }
    catch (e) { return null; }
  }

  function signature(s) {
    return JSON.stringify([
      s.status, s.round, s.current && s.current.revealed, s.current && s.current.answered,
      s.results.length, s.players.map(function (p) {
        return [p.id, p.name, p.score, p.pos, p.bingoAwarded, p.reachedGoal, p.disconnected, p.claim && p.claim.status];
      })
    ]);
  }

  function load() {
    state.sid = sidFromUrl();
    // subscribe เสมอ — เปิดจอโปรเจกเตอร์ก่อนมีห้องก็ใช้ได้ (ห้องสร้างทีหลังจะโผล่เอง)
    store.subscribe(store.KEYS.sessions, function () { onData(false); });
    global.addEventListener('resize', function () { if (state.session) drawTrack(); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') onData(true);
    });
    onData(true);
  }

  function noRoom() {
    el('projTitle').textContent = 'ไม่พบห้องเล่น';
    el('stageInner').innerHTML = '';
    el('stageInner').appendChild(h('div', { class: 'stack center' }, [
      h('div', { style: 'font-size:3rem', text: '🚪' }),
      h('p', { class: 'sm muted', text: 'ไม่พบห้องเล่นนี้ — เปิดห้องจากหน้าครูก่อน หรือลิงก์ผิด' })
    ]));
  }

  function onData(force) {
    var s = rooms.get(state.sid);
    if (!s && !state.sid) {
      var list = rooms.all();
      if (list.length) state.sid = list[0].id;
      s = rooms.get(state.sid);
    }
    if (!s) { noRoom(); return; }
    var sig = signature(s);
    if (!force && sig === state.lastSig) return;
    state.lastSig = sig;
    state.session = s;
    if (!state.set) state.set = rooms.setOf(s);
    render();
  }

  /* ---------------- render ---------------- */
  function render() {
    var s = state.session;
    el('projTitle').textContent = s.setName || 'IT Snake & Ladder Class';
    el('projSub').textContent = 'บันไดงูไอที · ครู ' + s.teacher + ' · รอบเล่น ' + s.round + '/' + s.rounds;
    var chip = el('projStatusChip');
    chip.className = 'chip ' + (s.status === 'playing' ? 'chip-green' : s.status === 'finished' ? 'chip-amber' : 'chip-cyan');
    chip.textContent = s.status === 'playing' ? 'กำลังเล่น' : s.status === 'finished' ? 'จบเกมแล้ว' : 'รอนักเรียนเข้าร่วม';
    el('roundChip').textContent = 'รอบ ' + s.round + '/' + s.rounds;

    var online = (s.players || []).filter(function (p) { return !p.disconnected; }).length;
    el('onlineChip').textContent = (s.players || []).length === 0 ? '🟢 รอผู้เล่นเข้าร่วม' : '🟢 ออนไลน์ ' + online + '/' + (s.players || []).length;

    // เสียงเมื่อมีคนเข้าใหม่ และเมื่อมีผลลัพธ์ใหม่ (บันได/งู)
    if (state.lastPlayerCount >= 0 && (s.players || []).length > state.lastPlayerCount) ui.SFX.join();
    state.lastPlayerCount = (s.players || []).length;

    renderStage();
    drawTrack();
    renderLeaderboard();

    var rc = (s.results || []).length;
    if (state.lastResultCount >= 0 && rc > state.lastResultCount) {
      var last = s.results[s.results.length - 1];
      if (last && last.move) {
        if (last.move.kind === 'ladder') ui.SFX.ladder();
        else if (last.move.kind === 'snake') ui.SFX.snake();
      }
    }
    state.lastResultCount = rc;
  }

  /* ---------------- stage: lobby / roulette / reveal / podium ---------------- */
  function renderStage() {
    var box = el('stageInner');
    var s = state.session;

    if (s.status === 'finished') {
      stopRoulette();
      renderPodium(box, s);
      return;
    }

    if (s.status === 'lobby') {
      stopRoulette();
      renderLobby(box, s);
      return;
    }

    // playing
    var cur = s.current;
    if (!cur) {
      stopRoulette();
      box.innerHTML = '';
      box.appendChild(h('div', { class: 'stack center', style: 'gap:8px' }, [
        h('div', { class: 'word-ico', text: '🎲' }),
        h('div', { class: 'proj-word neon-purple', text: 'กำลังเตรียมคำถาม…' }),
        h('div', { class: 'proj-word-sm muted', text: 'ครูกำลังสุ่มคำถาม ให้ทุกคนตั้งใจ!' })
      ]));
      return;
    }

    if (!cur.revealed) {
      if (state.lastDrawnAt !== cur.drawnAt) {
        state.lastDrawnAt = cur.drawnAt;
        startRoulette(box, s);
      }
      return; // roulette keeps running
    }

    stopRoulette();
    state.lastDrawnAt = cur.drawnAt;
    var item = rooms.itemById(s, cur.itemId) || cur;
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'word-stage', style: 'min-width:0;width:100%;flex:1' }, [
      h('div', { class: 'word-ico', text: item.icon || '💻' }),
      h('div', { class: 'word-term word-main proj-word neon-cyan', text: cur.term }),
      h('div', { class: 'proj-word-sm', text: item.meaning || cur.meaning }),
      h('div', { class: 'tiny muted', text: 'คำถามข้อที่ ' + cur.round + '/' + s.rounds + ' · ผู้ตอบแล้ว: ' + (s.players || []).filter(function (p) { return p.claim && p.claim.round === cur.round; }).length + ' คน' })
    ]));
  }

  function randomItem() {
    var items = (state.set && state.set.items) || [];
    var cur = state.session && state.session.current;
    // กันคำตอบจริงหลุดไปโชว์บนวงล้อ (ไม่งั้นนักเรียนรอดูจากจอได้)
    var pool = cur ? items.filter(function (i) { return i.id !== cur.itemId; }) : items;
    if (!pool.length) pool = items;
    return pool[Math.floor(Math.random() * pool.length)] || { icon: '💻', term: '?', meaning: '' };
  }

  function startRoulette(box, s) {
    stopRoulette();
    var cur = s.current;
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'word-stage roulette', style: 'min-width:0;width:100%;flex:1' }, [
      h('div', { class: 'word-ico', id: 'rouIco', text: '🎰' }),
      h('div', { class: 'word-main roulette-word', id: 'rouTerm', text: '...' }),
      h('div', { class: 'tiny muted', text: 'หมุนหาคำถาม… รอครู "เฉลย" เพื่อดูคำตอบ' })
    ]));

    var count = 0;
    var target = cur;
    state.roulette = setInterval(function () {
      var it = randomItem();
      el('rouIco').textContent = it.icon || '💻';
      el('rouTerm').textContent = it.term || '?';
      ui.SFX.tick();
      count++;
      // ตรวจว่าคำตอบถูกเปิดแล้วตอนนี้หรือยัง
      var cur2 = rooms.get(state.sid);
      if (cur2 && cur2.current && cur2.current.revealed && state.lastDrawnAt === cur2.current.drawnAt) {
        stopRoulette();
        render();
      }
    }, 110);
  }

  function stopRoulette() {
    if (state.roulette) { clearInterval(state.roulette); state.roulette = null; }
    var w = el('stageInner');
    if (w) w.classList.remove('roulette');
  }

  function renderLobby(box, s) {
    box.innerHTML = '';
    // canvas ถูกลบใหม่ทุกครั้งที่ render → reset สถานะ QR เพื่อให้วาดใหม่ทุกครั้ง
    // (เดิม state.qrCode เทียบไว้แล้ว → เหลือผ้าใบว่างเปล่าเมื่อมีนักเรียนเข้า)
    state.qrCode = null;
    setTimeout(function () {
      var cv = el('lobbyQR');
      if (cv && global.QR) {
        try { global.QR.toCanvas(cv, ui.joinUrl(s.joinCode), { scale: 7, margin: 2 }); } catch (e) { /* ignore */ }
      }
    }, 60);
    box.appendChild(h('div', { class: 'stack center', style: 'gap:16px;width:100%' }, [
      h('div', { class: 'tiny muted', text: '📱 สแกน QR หรือเปิดหน้านักเรียนแล้วกรอกรหัสห้อง' }),
      h('div', { class: 'proj-big-code', text: s.joinCode }),
      h('div', { class: 'qr-frame projector' }, [h('canvas', { id: 'lobbyQR', width: '420', height: '420', style: 'width:170px;height:170px' })]),
      h('div', { class: 'proj-word-sm muted', style: 'animation:pulse 2s ease-in-out infinite', text: 'รอครูเริ่มเกม…' })
    ]));
  }

  function renderPodium(box, s) {
    box.innerHTML = '';
    if (!state.lastPodium) {
      state.lastPodium = true;
      ui.confetti(160);
      ui.SFX.win();
    }
    var rank = game.ranking(s);
    var medals = ['🥇', '🥈', '🥉'];
    var top3 = rank.slice(0, 3);
    box.appendChild(h('div', { class: 'stack center', style: 'gap:14px;width:100%' }, [
      h('div', { class: 'word-ico', text: '🏆' }),
      h('div', { class: 'proj-word neon-green', text: 'จบเกมแล้ว!' }),
      h('div', { class: 'proj-word-sm muted', text: 'ผลสรุปประจำห้อง ' + s.joinCode }),
      h('div', { class: 'row center wrapy', style: 'justify-content:center;gap:14px' },
        top3.map(function (p, i) {
          return h('div', { class: 'glass-soft', style: 'border:1px solid var(--line);min-width:170px;text-align:center;padding:18px 22px' }, [
            h('div', { style: 'font-size:2.6rem', text: medals[i] }),
            h('div', { class: 'proj-word-sm neon-cyan', text: p.name }),
            h('div', { class: 'mono neon-green', style: 'font-size:1.6rem;font-weight:800', text: p.score + ' คะแนน' })
          ]);
        })),
      h('div', { class: 'stack scroll-y', style: 'gap:6px;max-height:26vh;width:min(640px,92%)' },
        rank.slice(3).map(function (p, i) {
          return h('div', { class: 'lb-row' }, [
            h('div', { class: 'rank-badge', text: String(i + 4) }),
            h('div', { class: 'pname', text: p.name }),
            h('div', { class: 'lb-score', text: p.score })
          ]);
        }))
    ]));
  }

  /* ---------------- leaderboard ---------------- */
  function renderLeaderboard() {
    var box = el('leaderboard');
    box.innerHTML = '';
    var s = state.session;
    var list = game.ranking(s);
    if (!list.length) {
      box.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'ico', text: '🧑‍🎓' }),
        h('div', { text: 'สแกน QR แล้วกรอกชื่อ\nเพื่อเข้าร่วม' })
      ]));
      return;
    }
    var maxScore = Math.max(1, list[0].score);
    list.forEach(function (p, i) {
      var row = h('div', { class: 'lb-row' + (i === 0 && list.length > 1 ? ' is-top' : '') }, [
        h('div', { class: 'rank-badge' + (i < 3 ? ' rank-' + (i + 1) : ''), text: String(i + 1) }),
        h('div', { class: 'grow', style: 'min-width:0' }, [
          h('div', { class: 'row' }, [
            h('span', { class: 'pname', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: p.name }),
            p.bingoAwarded ? h('span', { class: 'chip chip-amber', title: 'ได้บิงโก', text: '🎯' }) : null,
            p.reachedGoal ? h('span', { class: 'chip chip-green', title: 'ถึงเส้นชัย', text: '👑' }) : null,
            p.claim && p.claim.status === 'pending' ? h('span', { class: 'chip chip-cyan', style: 'animation:pulse 1.2s infinite', text: '📮' }) : null
          ]),
          h('div', { class: 'lb-bar' }, [h('i', { style: 'width:' + Math.max(3, Math.round((p.score / maxScore) * 100)) + '%' })])
        ]),
        h('div', { class: 'lb-score', text: p.score })
      ]);
      box.appendChild(row);
    });
  }

  /* ---------------- track (กระดานรวม) ---------------- */
  function drawTrack() {
    var s = state.session;
    var track = el('track');
    var wrap = el('trackWrap');
    track.innerHTML = '';
    var sl = s.snakesLadders || { ladders: [], snakes: [] };
    var n = s.trackLength || 30;

    // เซลล์ 0 = START, 1..n-1 ธรรมดา, n = GOAL
    for (var i = 0; i <= n; i++) {
      var cls = 'track-cell';
      var label = String(i);
      if (i === 0) { cls += ' is-start'; label = '🚩 0'; }
      else if (i === n) { cls += ' is-goal'; label = '🏁 ' + n; }
      var isLadderTile = (sl.ladders || []).some(function (l) { return l[0] === i; });
      var isSnakeTile = (sl.snakes || []).some(function (x) { return x[0] === i; });
      if (isLadderTile) cls += ' is-ladder';
      if (isSnakeTile) cls += ' is-snake';
      var prev = h('div', { class: cls, 'data-pos': String(i) }, [
        h('span', { class: 'mono', text: label }),
        isLadderTile ? h('span', { style: 'font-size:.7rem', text: '🪜' }) : (isSnakeTile ? h('span', { style: 'font-size:.7rem', text: '🐍' }) : null)
      ]);
      track.appendChild(prev);
    }
    wrap.style.gridTemplateColumns = '';

    // โทเคนผู้เล่น
    (s.players || []).forEach(function (p) {
      var cell = track.querySelector('.track-cell[data-pos="' + p.pos + '"]');
      if (!cell) return;
      cell.classList.add('has-token');
      var t = h('span', {
        class: 'token' + (p.reachedGoal ? ' is-goal' : ''),
        style: 'background:' + p.color + ';left:0;top:0',
        title: p.name + ' · ' + p.pos + (p.reachedGoal ? ' · 👑 ถึงเส้นชัยแล้ว!' : '')
      }, p.name.slice(0, 1).toUpperCase() + (p.reachedGoal ? '👑' : ''));
      track.appendChild(t);
      t.dataset.playerId = p.id;
    });

    var goalNames = (s.players || []).filter(function (p) { return p.reachedGoal; }).map(function (p) { return p.name; });
    el('trackLegend').textContent = sl.ladders.length + ' บันได 🪜 · ' + sl.snakes.length + ' งู 🐍 · ถึงช่อง ' + n + ' = ผู้ชนะ' +
      (goalNames.length ? ' · 👑 ' + goalNames.join(', ') + ' ถึงเส้นชัยแล้ว!' : '');
    layoutTrack(wrap);
  }

  function layoutTrack(wrap) {
    var track = el('track');
    var wrapRect = wrap.getBoundingClientRect();

    // โทเคน: วางตามจุดกึ่งกลางของเซลล์เจ้าของ
    var s = state.session;
    (s.players || []).forEach(function (p) {
      var cell = track.querySelector('.track-cell[data-pos="' + p.pos + '"]');
      var t = track.querySelector('.token[data-player-id="' + p.id + '"]');
      if (!cell || !t) return;
      var r = cell.getBoundingClientRect();
      t.style.left = (r.left - wrapRect.left + r.width / 2) + 'px';
      t.style.top = (r.top - wrapRect.top + r.height / 2) + 'px';
    });

    drawSVGLinks(wrap, wrapRect);
  }

  function drawSVGLinks(wrap, wrapRect) {
    var old = wrap.querySelectorAll('svg.track-link');
    [].forEach.call(old, function (s) { s.parentNode && s.parentNode.removeChild(s); });
    var s = state.session;
    var sl = s.snakesLadders || { ladders: [], snakes: [] };
    var track = el('track');
    var pairs = [];
    (sl.ladders || []).forEach(function (l) { pairs.push({ from: l[0], to: l[1], kind: 'ladder' }); });
    (sl.snakes || []).forEach(function (sn) { pairs.push({ from: sn[0], to: sn[1], kind: 'snake' }); });
    if (!pairs.length) return;

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'track-link');
    svg.setAttribute('width', String(wrapRect.width));
    svg.setAttribute('height', String(wrapRect.height));
    svg.setAttribute('viewBox', '0 0 ' + wrapRect.width + ' ' + wrapRect.height);

    function center(pos) {
      var c = track.querySelector('.track-cell[data-pos="' + pos + '"]');
      if (!c) return null;
      var r = c.getBoundingClientRect();
      return { x: r.left - wrapRect.left + r.width / 2, y: r.top - wrapRect.top + r.height / 2 };
    }

    pairs.forEach(function (p) {
      var a = center(p.from), b = center(p.to);
      if (!a || !b) return;
      var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(a.x));
      line.setAttribute('y1', String(a.y));
      line.setAttribute('x2', String(b.x));
      line.setAttribute('y2', String(b.y));
      line.setAttribute('class', p.kind === 'ladder' ? 'ladder-line' : 'snake-line');
      svg.appendChild(line);
    });
    wrap.appendChild(svg);
  }

  /* ---------------- boot ---------------- */
  function boot() {
    ui.setSound((store.read(store.KEYS.prefs) || {}).sound !== false);
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window);