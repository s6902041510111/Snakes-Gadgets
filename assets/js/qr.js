/* =========================================================
   qr.js — ตัวสร้าง QR Code แบบ standalone (ไม่พึ่ง CDN / ไม่พึ่ง network)
   Byte mode, Error Correction Level M, Version 1–10
   ใช้งาน: QR.toCanvas(canvas, text, { scale, margin, dark, light })
           QR.toDataURL(text, { scale, margin })
           QR.matrix(text) -> { size, modules }
   ========================================================= */
(function (global) {
  'use strict';

  // ---------- ตารางข้อมูล (Level M) ----------
  // version: [จำนวน codeword ทั้งหมด, ec ต่อบล็อก, [[จำนวนบล็อก, data ต่อบล็อก], ...]]
  var EC_TABLE = {
    1: [26, 10, [[1, 16]]],
    2: [44, 16, [[1, 28]]],
    3: [70, 26, [[1, 44]]],
    4: [100, 18, [[2, 32]]],
    5: [134, 24, [[2, 43]]],
    6: [172, 16, [[4, 27]]],
    7: [196, 18, [[4, 31]]],
    8: [242, 22, [[2, 38], [2, 39]]],
    9: [292, 22, [[3, 36], [2, 37]]],
    10: [346, 26, [[4, 43], [1, 44]]]
  };
  var ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]
  };
  var MAX_VERSION = 10;
  var EC_LEVEL_BITS = 0b00; // Level M

  // ---------- GF(256) สำหรับ Reed–Solomon ----------
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGenerator(degree) {
    // สร้างพหุนิยมตัวสร้าง g(x) = (x-a^0)(x-a^1)...(x-a^(degree-1))
    // คำนวณแบบ ascending (constant term ก่อน) แล้ว reverse ตอนส่งคืนให้เป็น descending (lead ก่อน)
    var poly = [1];
    for (var i = 0; i < degree; i++) {
      var next = new Array(poly.length + 1).fill(0);
      for (var j = 0; j < poly.length; j++) {
        next[j] ^= gmul(poly[j], EXP[i]);
        next[j + 1] ^= poly[j];
      }
      poly = next;
    }
    return poly.reverse();
  }

  function rsEncode(data, ecLen) {
    var gen = rsGenerator(ecLen);
    var res = new Array(data.length + ecLen).fill(0);
    for (var i = 0; i < data.length; i++) res[i] = data[i];
    for (var k = 0; k < data.length; k++) {
      var factor = res[k];
      if (factor === 0) continue;
      for (var j = 0; j < gen.length; j++) res[k + j] ^= gmul(gen[j], factor);
    }
    return res.slice(data.length);
  }

  // ---------- เลือก version + สร้าง codeword ----------
  function dataCapacity(version) {
    var groups = EC_TABLE[version][2];
    var total = 0;
    for (var i = 0; i < groups.length; i++) total += groups[i][0] * groups[i][1];
    return total;
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return Array.prototype.slice.call(new TextEncoder().encode(str));
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c >= 0xd800 && c <= 0xdbff) {
        var c2 = str.charCodeAt(i + 1);
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
        i++;
      } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
  }

  function pickVersion(byteLen) {
    for (var v = 1; v <= MAX_VERSION; v++) {
      var countBits = v < 10 ? 8 : 16;
      var neededBits = 4 + countBits + byteLen * 8;
      if (neededBits <= dataCapacity(v) * 8) return v;
    }
    return 0;
  }

  function buildCodewords(bytes, version) {
    var cap = dataCapacity(version);
    var bits = [];
    function push(val, len) {
      for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    }
    push(0b0100, 4);                       // byte mode
    push(bytes.length, version < 10 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);
    var remain = cap * 8 - bits.length;
    push(0, Math.min(4, remain));          // terminator
    while (bits.length % 8) bits.push(0);
    var codewords = [];
    for (var b = 0; b < bits.length; b += 8) {
      var val = 0;
      for (var k = 0; k < 8; k++) val = (val << 1) | bits[b + k];
      codewords.push(val);
    }
    var pads = [0xec, 0x11];
    var p = 0;
    while (codewords.length < cap) codewords.push(pads[p++ % 2]);
    return codewords;
  }

  function interleave(codewords, version) {
    var ecLen = EC_TABLE[version][1];
    var groups = EC_TABLE[version][2];
    var blocks = [];
    var i = 0;
    for (var g = 0; g < groups.length; g++) {
      for (var b = 0; b < groups[g][0]; b++) {
        blocks.push(codewords.slice(i, i + groups[g][1]));
        i += groups[g][1];
      }
    }
    var ecBlocks = blocks.map(function (blk) { return rsEncode(blk, ecLen); });
    var out = [];
    var maxData = blocks.reduce(function (m, b) { return Math.max(m, b.length); }, 0);
    for (var k = 0; k < maxData; k++) {
      for (var j = 0; j < blocks.length; j++) if (k < blocks[j].length) out.push(blocks[j][k]);
    }
    for (var e = 0; e < ecLen; e++) {
      for (var m = 0; m < ecBlocks.length; m++) out.push(ecBlocks[m][e]);
    }
    return out;
  }

  // ---------- สร้างเมทริกซ์ ----------
  function makeMatrix(version) {
    var size = version * 4 + 17;
    var m = [];
    var reserved = [];
    for (var r = 0; r < size; r++) {
      m.push(new Array(size).fill(false));
      reserved.push(new Array(size).fill(false));
    }

    function placeFinder(row, col) {
      for (var dr = -1; dr <= 7; dr++) {
        for (var dc = -1; dc <= 7; dc++) {
          var rr = row + dr, cc = col + dc;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
          var on = (dr >= 0 && dr <= 6 && (dc === 0 || dc === 6)) ||
                   (dc >= 0 && dc <= 6 && (dr === 0 || dr === 6)) ||
                   (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
          m[rr][cc] = on;
          reserved[rr][cc] = true;
        }
      }
    }
    placeFinder(0, 0);
    placeFinder(0, size - 7);
    placeFinder(size - 7, 0);

    for (var i = 8; i < size - 8; i++) {
      var v = i % 2 === 0;
      m[6][i] = v; reserved[6][i] = true;
      m[i][6] = v; reserved[i][6] = true;
    }

    var ap = ALIGN[version];
    for (var ai = 0; ai < ap.length; ai++) {
      for (var aj = 0; aj < ap.length; aj++) {
        var ar = ap[ai], ac = ap[aj];
        if ((ar <= 8 && ac <= 8) || (ar <= 8 && ac >= size - 9) || (ar >= size - 9 && ac <= 8)) continue;
        for (var dr2 = -2; dr2 <= 2; dr2++) {
          for (var dc2 = -2; dc2 <= 2; dc2++) {
            m[ar + dr2][ac + dc2] = Math.max(Math.abs(dr2), Math.abs(dc2)) !== 1;
            reserved[ar + dr2][ac + dc2] = true;
          }
        }
      }
    }

    m[size - 8][8] = true;
    reserved[size - 8][8] = true;

    for (var f = 0; f < 9; f++) {
      reserved[8][f] = true;
      reserved[f][8] = true;
    }
    for (var g2 = 0; g2 < 8; g2++) {
      reserved[8][size - 1 - g2] = true;
      reserved[size - 1 - g2][8] = true;
    }

    if (version >= 7) {
      var vbits = versionBits(version);
      for (var vi = 0; vi < 18; vi++) {
        var bit = ((vbits >>> vi) & 1) === 1;
        var a = Math.floor(vi / 3), c = vi % 3;
        m[a][size - 11 + c] = bit;
        reserved[a][size - 11 + c] = true;
        m[size - 11 + c][a] = bit;
        reserved[size - 11 + c][a] = true;
      }
    }

    return { m: m, reserved: reserved, size: size };
  }

  function versionBits(version) {
    var d = version << 12;
    for (var i = 17; i >= 12; i--) if ((d >>> i) & 1) d ^= 0x1f25 << (i - 12);
    return (version << 12) | d;
  }

  function placeData(state, codewords) {
    var m = state.m, reserved = state.reserved, size = state.size;
    var totalBits = codewords.length * 8;
    var idx = 0;
    var upward = true;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var v = 0; v < size; v++) {
        var row = upward ? size - 1 - v : v;
        for (var c = 0; c < 2; c++) {
          var col = right - c;
          if (reserved[row][col]) continue;
          var bit = 0;
          if (idx < totalBits) bit = (codewords[idx >> 3] >>> (7 - (idx & 7))) & 1;
          m[row][col] = bit === 1;
          idx++;
        }
      }
      upward = !upward;
    }
  }

  var MASKS = [
    function (r, c) { return (r + c) % 2 === 0; },
    function (r) { return r % 2 === 0; },
    function (r, c) { return c % 3 === 0; },
    function (r, c) { return (r + c) % 3 === 0; },
    function (r, c) { return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0; },
    function (r, c) { return ((r * c) % 2) + ((r * c) % 3) === 0; },
    function (r, c) { return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0; },
    function (r, c) { return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0; }
  ];

  function applyMask(state, maskIdx) {
    var m = state.m, reserved = state.reserved, size = state.size;
    var fn = MASKS[maskIdx];
    for (var r = 0; r < size; r++) {
      for (var c = 0; c < size; c++) {
        if (reserved[r][c]) continue;
        if (fn(r, c)) m[r][c] = !m[r][c];
      }
    }
  }

  function formatBits(maskIdx) {
    var data = (EC_LEVEL_BITS << 3) | maskIdx;
    var d = data << 10;
    for (var i = 14; i >= 10; i--) if ((d >>> i) & 1) d ^= 0x537 << (i - 10);
    return ((data << 10) | d) ^ 0x5412;
  }

  function placeFormat(state, maskIdx) {
    var m = state.m, size = state.size;
    var bits = formatBits(maskIdx);
    var i, mod;
    // copy 1 (vertical, ซ้ายบน)
    for (i = 0; i < 6; i++) m[i][8] = (((bits >>> i) & 1) === 1);
    m[7][8] = (((bits >>> 6) & 1) === 1);
    m[8][8] = (((bits >>> 7) & 1) === 1);
    for (i = 8; i <= 14; i++) m[size - 15 + i][8] = (((bits >>> i) & 1) === 1);
    // copy 2 (horizontal, ขวาบน)
    for (i = 0; i < 8; i++) m[8][size - 1 - i] = (((bits >>> i) & 1) === 1);
    m[8][7] = (((bits >>> 8) & 1) === 1);
    for (i = 9; i <= 14; i++) m[8][14 - i] = (((bits >>> i) & 1) === 1);
    // dark module
    m[size - 8][8] = true;
    void mod;
  }

  function penalty(state) {
    var m = state.m, size = state.size;
    var score = 0;
    var r, c, run, i;

    // Rule 1: runs 5+
    for (r = 0; r < size; r++) {
      run = 1;
      for (c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
    for (c = 0; c < size; c++) {
      run = 1;
      for (r = 1; r < size; r++) {
        if (m[r][c] === m[r - 1][c]) { run++; }
        else { if (run >= 5) score += 3 + (run - 5); run = 1; }
      }
      if (run >= 5) score += 3 + (run - 5);
    }

    // Rule 2: 2x2 same
    for (r = 0; r < size - 1; r++) {
      for (c = 0; c < size - 1; c++) {
        var v = m[r][c];
        if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) score += 3;
      }
    }

    // Rule 3: finder-like patterns
    var p1 = [true, false, true, true, true, false, true, false, false, false, false];
    var p2 = [false, false, false, false, true, false, true, true, true, false, true];
    function matchAt(get, len, pos) {
      var a = true, b = true;
      for (i = 0; i < 11; i++) {
        var val = get(pos + i);
        if (val !== p1[i]) a = false;
        if (val !== p2[i]) b = false;
      }
      return (a ? 1 : 0) + (b ? 1 : 0);
    }
    for (r = 0; r < size; r++) {
      for (c = 0; c <= size - 11; c++) {
        score += 40 * matchAt(function (idx) { return m[r][idx]; }, 11, c);
      }
    }
    for (c = 0; c < size; c++) {
      for (r = 0; r <= size - 11; r++) {
        score += 40 * matchAt(function (idx) { return m[idx][c]; }, 11, r);
      }
    }

    // Rule 4: dark ratio
    var dark = 0;
    for (r = 0; r < size; r++) for (c = 0; c < size; c++) if (m[r][c]) dark++;
    var percent = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(percent - 50) / 5) * 10;
    return score;
  }

  // ---------- API ----------
  function build(text) {
    var bytes = utf8Bytes(String(text));
    var version = pickVersion(bytes.length);
    if (!version) return null;
    var codewords = interleave(buildCodewords(bytes, version), version);
    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      var state = makeMatrix(version);
      placeData(state, codewords);
      applyMask(state, mask);
      placeFormat(state, mask);
      var p = penalty(state);
      if (!best || p < best.penalty) best = { state: state, penalty: p };
    }
    return { size: best.state.size, modules: best.state.m, version: version };
  }

  function render(ctx, text, opts) {
    opts = opts || {};
    var scale = opts.scale || 6;
    var margin = opts.margin == null ? 4 : opts.margin;
    var dark = opts.dark || '#0b1220';
    var light = opts.light || '#ffffff';
    var qr = build(text);
    if (!qr) throw new Error('QR: ข้อความยาวเกินขนาดที่รองรับ');
    var dim = qr.size + margin * 2;
    return { qr: qr, dim: dim, px: dim * scale };
  }

  var QR = {
    version: 9,
    matrix: build,
    toCanvas: function (canvas, text, opts) {
      var info = render(null, text, opts);
      var scale = (opts && opts.scale) || 6;
      var margin = (opts && opts.margin != null) ? opts.margin : 4;
      canvas.width = info.dim * scale;
      canvas.height = info.dim * scale;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = (opts && opts.light) || '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = (opts && opts.dark) || '#0b1220';
      var m = info.qr.modules;
      for (var r = 0; r < info.qr.size; r++) {
        for (var c = 0; c < info.qr.size; c++) {
          if (m[r][c]) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
        }
      }
      return info.qr;
    },
    toDataURL: function (text, opts) {
      var cv = document.createElement('canvas');
      QR.toCanvas(cv, text, opts);
      return cv.toDataURL('image/png');
    }
  };

  global.QR = QR;

  // เปิด internals สำหรับการทดสอบ (diagnostics)
  QR._debug = {
    EC_TABLE: EC_TABLE,
    MASKS: MASKS,
    makeMatrix: makeMatrix,
    placeData: placeData,
    applyMask: applyMask,
    placeFormat: placeFormat,
    interleave: interleave,
    buildCodewords: buildCodewords,
    utf8Bytes: utf8Bytes,
    dataCapacity: dataCapacity,
    formatBits: formatBits
  };
})(window);
