/* =========================================================
   ui.js — ตัวช่วยด้าน UI ร่วมกัน (toast, modal, confetti, เสียง, ดาวน์โหลด)
   ========================================================= */
(function (global) {
  'use strict';

  function el(id) { return document.getElementById(id); }

  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs && (typeof attrs === 'string' || attrs instanceof Node || Array.isArray(attrs))) {
      children = attrs;
      attrs = null;
    }
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(node.style, attrs[k]);
        else if (k.indexOf('on') === 0 && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] != null && attrs[k] !== false) node.setAttribute(k, attrs[k]);
      });
    }
    if (children == null) children = [];
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c == null || c === false) return;
      node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    });
    return node;
  }

  /* ---------------- toast ---------------- */
  function toastLayer() {
    var layer = el('toastLayer');
    if (!layer) {
      layer = h('div', { id: 'toastLayer', class: 'toast-layer' });
      document.body.appendChild(layer);
    }
    return layer;
  }

  function toast(message, type, ms) {
    var icons = { ok: '✅', err: '❌', warn: '⚠️', info: '💡' };
    var node = h('div', { class: 'toast ' + (type || 'info') }, [
      h('span', { class: 't-ico', text: icons[type] || '💡' }),
      h('span', { class: 'grow', text: message })
    ]);
    toastLayer().appendChild(node);
    var life = ms || 2600;
    setTimeout(function () {
      node.classList.add('is-out');
      setTimeout(function () { if (node.parentNode) node.parentNode.removeChild(node); }, 260);
    }, life);
    return node;
  }

  /* ---------------- modal ---------------- */
  function modal(opts) {
    var back = h('div', { class: 'modal-back' });
    var box = h('div', { class: 'modal' + (opts.wide ? ' wide' : '') });
    var head = h('div', { class: 'modal-head' }, [
      h('div', { class: 'panel-title' }, [h('span', { class: 'dot' }), h('span', { text: opts.title || '' })])
    ]);
    var closeBtn = h('button', { class: 'btn btn-ghost btn-sm', title: 'ปิด', onclick: close }, '✕');
    head.appendChild(closeBtn);
    var body = h('div', { class: 'modal-body' });
    if (typeof opts.content === 'string') body.innerHTML = opts.content;
    else if (opts.content) body.appendChild(opts.content);
    box.appendChild(head);
    box.appendChild(body);

    var foot = null;
    if (opts.actions && opts.actions.length) {
      foot = h('div', { class: 'modal-foot' });
      opts.actions.forEach(function (a) {
        foot.appendChild(h('button', {
          class: 'btn ' + (a.class || 'btn-ghost'),
          onclick: function () { if (!a.onClick || a.onClick(api) !== false) { if (a.keepOpen !== true) close(); } }
        }, a.label));
      });
      box.appendChild(foot);
    }
    back.appendChild(box);
    back.addEventListener('click', function (ev) { if (ev.target === back && opts.dismissible !== false) close(); });
    document.body.appendChild(back);

    function onKey(ev) { if (ev.key === 'Escape' && opts.dismissible !== false) close(); }
    document.addEventListener('keydown', onKey);

    function close() {
      document.removeEventListener('keydown', onKey);
      if (back.parentNode) back.parentNode.removeChild(back);
      if (opts.onClose) opts.onClose();
    }

    var api = { close: close, body: body, box: box };
    if (opts.onOpen) opts.onOpen(api);
    return api;
  }

  function confirm(opts) {
    return new Promise(function (resolve) {
      var settled = false;
      modal({
        title: opts.title || 'ยืนยันการทำรายการ',
        content: h('div', { class: 'stack' }, [
          h('p', { class: 'sm', text: opts.message || '' }),
          opts.detail ? h('div', { class: 'chip chip-amber', text: opts.detail }) : null
        ]),
        actions: [
          { label: opts.cancelLabel || 'ยกเลิก', class: 'btn-ghost', onClick: function () { settled = true; resolve(false); } },
          { label: opts.okLabel || 'ยืนยัน', class: opts.danger ? 'btn-danger' : 'btn-cyan', onClick: function () { settled = true; resolve(true); } }
        ],
        onClose: function () { if (!settled) resolve(false); }
      });
    });
  }

  function prompt(opts) {
    return new Promise(function (resolve) {
      var input = h('input', { class: 'input ' + (opts.big ? 'input-code input-lg' : ''), value: opts.value || '', placeholder: opts.placeholder || '' });
      var settled = false;
      var m = modal({
        title: opts.title || 'กรอกข้อมูล',
        content: h('div', { class: 'stack' }, [
          opts.message ? h('p', { class: 'sm muted', text: opts.message }) : null,
          input
        ]),
        actions: [
          { label: 'ยกเลิก', class: 'btn-ghost', onClick: function () { settled = true; resolve(null); } },
          { label: opts.okLabel || 'ตกลง', class: 'btn-cyan', onClick: function () { settled = true; resolve(input.value); } }
        ],
        onOpen: function () { setTimeout(function () { input.focus(); input.select(); }, 60); },
        onClose: function () { if (!settled) resolve(null); }
      });
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { settled = true; resolve(input.value); m.close(); }
      });
    });
  }

  /* ---------------- confetti ---------------- */
  function confetti(count) {
    var layer = el('confettiLayer');
    if (!layer) {
      layer = h('div', { id: 'confettiLayer', class: 'confetti-layer' });
      document.body.appendChild(layer);
    }
    var colors = ['#00f3ff', '#9d4edd', '#00ff88', '#ffc247', '#ff5fa2', '#ffffff'];
    var n = count || 90;
    for (var i = 0; i < n; i++) {
      var piece = h('i', { class: 'confetti' });
      piece.style.left = Math.random() * 100 + 'vw';
      piece.style.top = '-8vh';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.animationDuration = (2 + Math.random() * 2.2) + 's';
      piece.style.animationDelay = (Math.random() * 0.7) + 's';
      piece.style.opacity = String(0.6 + Math.random() * 0.4);
      layer.appendChild(piece);
      (function (p) {
        setTimeout(function () { if (p.parentNode) p.parentNode.removeChild(p); }, 5200);
      })(piece);
    }
  }

  /* ---------------- sound (WebAudio, ไม่ต้องมีไฟล์เสียง) ---------------- */
  var audioCtx = null;
  var soundOn = true;

  function setSound(on) { soundOn = !!on; }
  function getSound() { return soundOn; }

  function playTone(freq, duration, type, volume, delay) {
    if (!soundOn) return;
    try {
      var Ctx = global.AudioContext || global.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t0 = audioCtx.currentTime + (delay || 0);
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(volume || 0.12, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    } catch (e) { /* เสียงไม่สำคัญ */ }
  }

  var SFX = {
    click: function () { playTone(660, 0.06, 'square', 0.05); },
    correct: function () { playTone(660, 0.12, 'triangle', 0.12); playTone(880, 0.14, 'triangle', 0.12, 0.1); playTone(1320, 0.2, 'triangle', 0.1, 0.2); },
    wrong: function () { playTone(220, 0.22, 'sawtooth', 0.09); playTone(160, 0.26, 'sawtooth', 0.08, 0.12); },
    tick: function () { playTone(880, 0.04, 'square', 0.04); },
    spin: function () { playTone(300 + Math.random() * 400, 0.05, 'square', 0.05); },
    join: function () { playTone(520, 0.1, 'sine', 0.1); playTone(780, 0.14, 'sine', 0.1, 0.1); },
    win: function () {
      [523, 659, 784, 1046, 1318].forEach(function (f, i) { playTone(f, 0.28, 'triangle', 0.12, i * 0.13); });
    },
    ladder: function () { [440, 660, 880].forEach(function (f, i) { playTone(f, 0.16, 'square', 0.08, i * 0.09); }); },
    snake: function () { [500, 380, 260].forEach(function (f, i) { playTone(f, 0.2, 'sawtooth', 0.08, i * 0.1); }); }
  };

  /* ---------------- download ---------------- */
  function download(filename, content, mime) {
    if (typeof content === 'string' && mime && mime.indexOf('csv') !== -1 && content.charCodeAt(0) !== 0xFEFF) {
      content = '\uFEFF' + content; // BOM กันภาษาไทยเพี้ยนเมื่อเปิดใน Excel บน Windows
    }
    var blob = new Blob([content], { type: mime || 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = h('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  /* ---------------- misc ---------------- */
  function timeAgo(ts) {
    if (!ts) return '-';
    var diff = Date.now() - new Date(ts).getTime();
    var m = Math.floor(diff / 60000);
    if (m < 1) return 'เมื่อสักครู่';
    if (m < 60) return m + ' นาทีที่แล้ว';
    var hr = Math.floor(m / 60);
    if (hr < 24) return hr + ' ชั่วโมงที่แล้ว';
    return Math.floor(hr / 24) + ' วันที่แล้ว';
  }

  function fmtClock(ts) {
    var d = new Date(ts || Date.now());
    return d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function fmtDateTime(ts) {
    var d = new Date(ts || Date.now());
    return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  }

  /** คืน URL ที่นักเรียนใช้เข้าร่วม (ใช้ทำ QR) */
  function joinUrl(code) {
    var base = location.href.split('#')[0].split('?')[0];
    base = base.replace(/[^/]*$/, 'student.html');
    return base + '?code=' + encodeURIComponent(code);
  }

  function fileSafe(name) {
    return String(name || 'export').replace(/[^\wก-๙\-]+/g, '_').slice(0, 60);
  }

  global.ITS = global.ITS || {};
  global.ITS.ui = {
    el: el, h: h, toast: toast, modal: modal, confirm: confirm, prompt: prompt,
    confetti: confetti, SFX: SFX, setSound: setSound, getSound: getSound,
    download: download, copyText: copyText, timeAgo: timeAgo, fmtClock: fmtClock,
    fmtDateTime: fmtDateTime, joinUrl: joinUrl, fileSafe: fileSafe
  };
})(window);
