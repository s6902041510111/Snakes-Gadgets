/* =========================================================
   store.js — ชั้นจัดการข้อมูลกลาง (LocalStorage + BroadcastChannel)
   ทุกคีย์เก็บเป็น JSON Object: { rev, updatedAt, payload }
   รองรับการต่อยอดไปใช้บน Vercel (KV / Blob) ดู ITS.remote
   ========================================================= */
(function (global) {
  'use strict';

  var NS = 'itsc:v1:';
  var KEYS = {
    auth: NS + 'auth',
    sets: NS + 'sets',
    sessions: NS + 'sessions',
    prefs: NS + 'prefs',
    identity: NS + 'identity'   // local only (ไม่ sync)
  };
  var SCHEMA = 1;
  var TAB_ID = 'tab_' + Math.random().toString(36).slice(2, 10);
  var CHANNEL = 'itsc-sync-v1';
  var POLL_MS = 600;

  var memoryFallback = {};   // ใช้เมื่อ localStorage ใช้ไม่ได้ (เช่น โหมดส่วนตัว)
  var lsOk = (function () {
    try {
      var k = NS + '__probe';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return true;
    } catch (e) { return false; }
  })();

  var cache = {};           // key -> envelope
  var revs = {};            // key -> rev ล่าสุดที่เห็น
  var subs = {};            // key -> [cb]
  var channel = null;

  /* ---------------- low level ---------------- */
  function rawGet(key) {
    if (lsOk) {
      try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    return memoryFallback[key] || null;
  }

  function rawSet(key, value) {
    memoryFallback[key] = value;
    if (!lsOk) return true;
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      console.warn('[store] เขียน localStorage ไม่สำเร็จ:', e && e.name);
      return false;
    }
  }

  /* ---------------- envelope helpers ---------------- */
  function empty(key) {
    return { schema: SCHEMA, rev: 0, updatedAt: new Date().toISOString(), payload: key === KEYS.sets || key === KEYS.sessions ? { items: [] } : {} };
  }

  function load(key) {
    var raw = rawGet(key);
    if (!raw) { cache[key] = empty(key); revs[key] = 0; return cache[key]; }
    try {
      var env = JSON.parse(raw);
      if (!env || typeof env !== 'object' || !('payload' in env)) throw new Error('bad envelope');
      if (env.schema !== SCHEMA) env = migrate(key, env);
      cache[key] = env;
      revs[key] = env.rev || 0;
    } catch (e) {
      console.warn('[store] อ่านข้อมูลเสีย สร้างใหม่:', key, e && e.message);
      cache[key] = empty(key);
      revs[key] = 0;
    }
    return cache[key];
  }

  function migrate(key, env) {
    // จุดต่ออนาคต: แปลง schema เก่าให้เป็น schema ปัจจุบัน
    env.schema = SCHEMA;
    if (!env.payload) env.payload = (key === KEYS.sets || key === KEYS.sessions) ? { items: [] } : {};
    return env;
  }

  function notify(key) {
    var list = subs[key] || [];
    for (var i = 0; i < list.length; i++) {
      try { list[i](cache[key].payload, cache[key]); } catch (e) { console.error('[store] subscriber error', e); }
    }
  }

  function broadcast(key) {
    if (!channel) return;
    try { channel.postMessage({ key: key, rev: revs[key], tab: TAB_ID }); } catch (e) { /* ignore */ }
  }

  function commit(key, env) {
    env.rev = (revs[key] || 0) + 1;
    env.updatedAt = new Date().toISOString();
    env.schema = SCHEMA;
    rawSet(key, JSON.stringify(env));
    cache[key] = env;
    revs[key] = env.rev;
    notify(key);
    broadcast(key);
    return env.payload;
  }

  /* ---------------- public API ---------------- */
  var Store = {
    KEYS: KEYS,
    SCHEMA: SCHEMA,
    tabId: TAB_ID,
    storageAvailable: lsOk,

    read: function (key) {
      if (!cache[key]) load(key);
      return cache[key].payload;
    },

    write: function (key, payload) {
      if (!cache[key]) load(key);
      return commit(key, { schema: SCHEMA, rev: 0, updatedAt: '', payload: payload });
    },

    /** อ่าน → แก้ไข → เขียน (ใช้กับการแก้ไขข้อมูลที่อาจชนกัน) */
    update: function (key, mutator) {
      if (!cache[key]) load(key);
      // ดึงข้อมูลล่าสุดจาก storage ก่อนแก้ไข (ไม่ notify — กันหน้าต่างอื่นเขียนทับงานเรา)
      // เช่น ครูตรวจคำตอบ เร็วเกิน 600ms หน้าต่างนักเรียนยังไม่ทันได้โพล — ถ้าไม่ refresh
      // ครูจะเขียนจาก state เก่าและลบ claim ของนักเรียนทิ้ง
      try {
        var rawNow = rawGet(key);
        if (rawNow) {
          var envNow = JSON.parse(rawNow);
          if (envNow && typeof envNow.rev === 'number' && envNow.rev > (revs[key] || 0)) {
            cache[key] = envNow;
            revs[key] = envNow.rev;
          }
        }
      } catch (e) { /* ignore */ }
      var next = JSON.parse(JSON.stringify(cache[key].payload));
      var result = mutator(next);
      return commit(key, { schema: SCHEMA, rev: 0, updatedAt: '', payload: result === undefined ? next : result });
    },

    subscribe: function (key, cb) {
      if (!cache[key]) load(key);
      (subs[key] = subs[key] || []).push(cb);
      return function () {
        subs[key] = (subs[key] || []).filter(function (f) { return f !== cb; });
      };
    },

    /** ตรวจสอบว่ามีการเปลี่ยนแปลงจากหน้าต่าง/อุปกรณ์อื่นหรือไม่ */
    refresh: function (key) {
      var raw = rawGet(key);
      if (raw == null) return false;
      var env;
      try { env = JSON.parse(raw); } catch (e) { return false; }
      if (!env || typeof env.rev !== 'number') return false;
      if ((revs[key] || 0) >= env.rev) return false;
      cache[key] = env;
      revs[key] = env.rev;
      notify(key);
      return true;
    },

    /* ---------------- auth helpers ---------------- */
    hashPassword: function (plain) {
      var salt = Store._salt();
      if (global.crypto && global.crypto.subtle && global.TextEncoder) {
        return global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + plain))
          .then(function (buf) {
            var arr = Array.from(new Uint8Array(buf));
            return arr.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
          })
          .then(function (hash) { return { algo: 'sha256', salt: salt, hash: hash }; })
          .catch(function () { return { algo: 'fnv1a', salt: salt, hash: fnv(salt + '|' + plain) }; });
      }
      return Promise.resolve({ algo: 'fnv1a', salt: salt, hash: fnv(salt + '|' + plain) });
    },

    verifyPassword: function (record, plain) {
      if (!record || !record.hash) return Promise.resolve(false);
      if (record.algo === 'sha256' && global.crypto && global.crypto.subtle && global.TextEncoder) {
        return global.crypto.subtle.digest('SHA-256', new TextEncoder().encode(record.salt + '|' + plain))
          .then(function (buf) {
            var arr = Array.from(new Uint8Array(buf));
            var hash = arr.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
            return hash === record.hash;
          })
          .catch(function () { return false; });
      }
      return Promise.resolve(fnv(record.salt + '|' + plain) === record.hash);
    },

    _salt: function () {
      return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
    },

    /* ---------------- bulk operations ---------------- */
    snapshot: function () {
      var out = {};
      Object.keys(KEYS).forEach(function (name) {
        if (name === 'identity') return;
        out[name] = Store.read(KEYS[name]);
      });
      return {
        app: 'it-snake-ladder-class',
        schema: SCHEMA,
        exportedAt: new Date().toISOString(),
        data: out
      };
    },

    importSnapshot: function (snap) {
      if (!snap || !snap.data) throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
      Object.keys(KEYS).forEach(function (name) {
        if (name === 'identity') return;
        if (snap.data[name]) Store.write(KEYS[name], snap.data[name]);
      });
      return true;
    },

    resetAll: function () {
      Object.keys(KEYS).forEach(function (name) {
        if (name === 'identity') return;
        if (lsOk) { try { localStorage.removeItem(KEYS[name]); } catch (e) { /* ignore */ } }
        delete memoryFallback[KEYS[name]];
        delete cache[KEYS[name]];
        revs[KEYS[name]] = 0;
        load(KEYS[name]);
        notify(KEYS[name]);
      });
    },

    estimateUsage: function () {
      var total = 0;
      Object.keys(KEYS).forEach(function (name) {
        var raw = rawGet(KEYS[name]);
        if (raw) total += raw.length;
      });
      return total; // bytes (UTF-16 approximation)
    },

    tabId_: TAB_ID
  };

  function fnv(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }

  /* ---------------- wiring ---------------- */
  function start() {
    Object.keys(KEYS).forEach(load);

    if (typeof global.BroadcastChannel === 'function') {
      try {
        channel = new global.BroadcastChannel(CHANNEL);
        channel.onmessage = function (ev) {
          var msg = ev && ev.data;
          if (!msg || msg.tab === TAB_ID || !msg.key) return;
          Store.refresh(msg.key);
        };
      } catch (e) { channel = null; }
    }

    global.addEventListener('storage', function (ev) {
      if (ev.key && ev.key.indexOf(NS) === 0) {
        var name = ev.key.slice(NS.length);
        var key = KEYS[name];
        if (key) Store.refresh(key);
      }
    });

    // polling กันพลาด เผื่อ BroadcastChannel/storage event ไม่ทำงาน (เช่น file:// บนบางเบราว์เซอร์)
    setInterval(function () {
      if (document.visibilityState === 'hidden' && !hasSubscribers()) return;
      Object.keys(KEYS).forEach(function (name) { if (name !== 'identity') Store.refresh(KEYS[name]); });
    }, POLL_MS);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        Object.keys(KEYS).forEach(function (name) { if (name !== 'identity') Store.refresh(KEYS[name]); });
      }
    });
  }

  function hasSubscribers() {
    return Object.keys(subs).some(function (k) { return (subs[k] || []).length > 0; });
  }

  global.ITS = global.ITS || {};
  global.ITS.store = Store;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
