/*!
 * 千山四时 · 数字长卷
 * util.js —— 确定性随机 / 噪声 / 缓动 / 色彩
 *
 * 设计约束：本项目采用「分块惰性渲染 + LRU 缓存」，
 * 任意一块画布随时可能被丢弃后重建。因此所有绘制细节
 * 必须能由「世界坐标」唯一确定地重算出来，
 * 绝不能依赖调用顺序或全局计数器。
 */
(function (global) {
  'use strict';

  /* ---------------------------------------------------------------
   * 一、确定性随机
   * ------------------------------------------------------------- */

  /** 可复现的 PRNG（用于初始化场景参数，不用于逐像素绘制） */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * 一维整数 hash → [0,1)
   * 这是全项目最底层的随机源：给定 (n, seed) 永远得到同一个值。
   */
  function h1(n, seed) {
    var h = Math.imul(n | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /** 二维整数 hash → [0,1) */
  function h2(x, y, seed) {
    var h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  /* ---------------------------------------------------------------
   * 二、值噪声（Value Noise）与分形叠加（fBm）
   * ------------------------------------------------------------- */

  /** 一维平滑值噪声，输出 [-1,1] */
  function n1(x, seed) {
    var i = Math.floor(x), f = x - i;
    var u = f * f * (3 - 2 * f);
    var a = h1(i, seed), b = h1(i + 1, seed);
    return (a + (b - a) * u) * 2 - 1;
  }

  /**
   * 一维分形噪声。长卷的山脊轮廓、水纹疏密都靠它。
   * oct 越大细节越碎，gain 控制高频衰减。
   */
  function fbm1(x, seed, oct, lac, gain) {
    oct = oct || 4; lac = lac || 2.0; gain = gain || 0.5;
    var s = 0, amp = 1, freq = 1, norm = 0;
    for (var o = 0; o < oct; o++) {
      s += amp * n1(x * freq, seed + o * 131);
      norm += amp;
      amp *= gain;
      freq *= lac;
    }
    return s / norm;
  }

  /** 二维平滑值噪声，输出 [-1,1] */
  function n2(x, y, seed) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var ux = fx * fx * (3 - 2 * fx);
    var uy = fy * fy * (3 - 2 * fy);
    var a = h2(ix, iy, seed), b = h2(ix + 1, iy, seed);
    var c = h2(ix, iy + 1, seed), d = h2(ix + 1, iy + 1, seed);
    var top = a + (b - a) * ux;
    var bot = c + (d - c) * ux;
    return (top + (bot - top) * uy) * 2 - 1;
  }

  /** 二维分形噪声，输出约 [-1,1] */
  function fbm2(x, y, seed, oct, lac, gain) {
    oct = oct || 4; lac = lac || 2.0; gain = gain || 0.5;
    var s = 0, amp = 1, freq = 1, norm = 0;
    for (var o = 0; o < oct; o++) {
      s += amp * n2(x * freq, y * freq, seed + o * 977);
      norm += amp;
      amp *= gain;
      freq *= lac;
    }
    return s / norm;
  }

  /* ---------------------------------------------------------------
   * 三、数学与缓动
   * ------------------------------------------------------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smoothstep(a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  }
  /** 与帧率无关的指数趋近插值（惯性滚动 / 镜头跟随的基础） */
  function damp(cur, target, lambda, dt) {
    return lerp(cur, target, 1 - Math.exp(-lambda * dt));
  }

  var Ease = {
    linear: function (t) { return t; },
    outCubic: function (t) { var u = 1 - t; return 1 - u * u * u; },
    outQuint: function (t) { var u = 1 - t; return 1 - u * u * u * u * u; },
    inOutCubic: function (t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    },
    inOutQuint: function (t) {
      return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
    },
    outBack: function (t) {
      var c1 = 1.70158, c3 = c1 + 1, u = t - 1;
      return 1 + c3 * u * u * u + c1 * u * u;
    }
  };

  /* ---------------------------------------------------------------
   * 四、色彩（全部用 [r,g,b] 数值数组，便于插值）
   * ------------------------------------------------------------- */

  /** '#rrggbb' → [r,g,b] */
  function hex(s) {
    var n = parseInt(s.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) {
    return 'rgba(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ',' + a + ')';
  }
  function rgb(c) {
    return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')';
  }
  /** 线性混合两种颜色 */
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  /** 调整明度：t>0 变亮（向白），t<0 变暗（向墨） */
  function shade(c, t) {
    return t >= 0 ? mix(c, [255, 255, 255], t) : mix(c, [20, 18, 16], -t);
  }

  /* ---------------------------------------------------------------
   * 五、离屏画布工具
   * ------------------------------------------------------------- */

  function makeCanvas(w, h) {
    var cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.ceil(w));
    cv.height = Math.max(1, Math.ceil(h));
    return cv;
  }

  /**
   * 帕累托式 LRU：用于分片缓存与低清预览缓存。
   */
  function LRU(limit, onEvict) {
    var map = new Map();
    return {
      limit: limit,
      get: function (k) {
        if (!map.has(k)) return undefined;
        var v = map.get(k);
        map.delete(k); map.set(k, v); // 提到队尾
        return v;
      },
      peek: function (k) { return map.get(k); },
      set: function (k, v) {
        if (map.has(k)) map.delete(k);
        map.set(k, v);
        while (map.size > this.limit) {
          var oldest = map.keys().next().value;
          var val = map.get(oldest);
          map.delete(oldest);
          if (onEvict) onEvict(val, oldest);
        }
      },
      has: function (k) { return map.has(k); },
      get size() { return map.size; },
      clear: function () { map.clear(); },
      keys: function () { return map.keys(); }
    };
  }

  var U = {
    mulberry32: mulberry32, h1: h1, h2: h2,
    n1: n1, fbm1: fbm1, n2: n2, fbm2: fbm2,
    clamp: clamp, lerp: lerp, smoothstep: smoothstep, damp: damp,
    Ease: Ease,
    hex: hex, rgba: rgba, rgb: rgb, mix: mix, shade: shade,
    makeCanvas: makeCanvas, LRU: LRU
  };

  global.U = U;
  if (typeof module !== 'undefined' && module.exports) module.exports = U;
})(typeof window !== 'undefined' ? window : globalThis);
