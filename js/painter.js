/*!
 * painter.js —— 程序化水墨山水绘制器
 *
 * 对外只有一个入口：Painter.paint(ctx, wx, wy, ww, wh, opts)
 * 在世界坐标矩形 [wx, wx+ww] × [wy, wy+wh] 内绘制画卷内容。
 *
 * 关键性质：绘制完全由世界坐标决定，与调用顺序无关。
 * 因此同一区域无论是首次绘制还是缓存被回收后重建，
 * 结果逐像素一致（相邻分片也能无缝拼接）。
 */
(function (global) {
  'use strict';
  var U = global.U;
  var S = global.SceneData;

  var W = S.WORLD_W, H = S.WORLD_H, L = S.LAYOUT, PEAKS = S.PEAKS;

  /* ---------------------------------------------------------------
   * 山峦分层
   * baseY  山脚基线    hScale 峰高比例   xOff 水平错位
   * 三层错开，形成「层峦叠嶂」；越远越淡、越圆缓、越少细节。
   * ------------------------------------------------------------- */
  var LAYERS = [
    { baseY: 250, hScale: 0.54, xOff: 168, seed: 4101, roughAmp: 26, rocky: 10, key: 'mist', alpha: 0.40, inkA: 0.00, hatch: 0.00, clouds: 0.50 },
    { baseY: 380, hScale: 0.78, xOff: 70, seed: 5203, roughAmp: 38, rocky: 17, key: 'far', alpha: 0.70, inkA: 0.24, hatch: 0.42, clouds: 0.42 },
    { baseY: 582, hScale: 1.15, xOff: 0, seed: 6307, roughAmp: 56, rocky: 28, key: 'mid', alpha: 1.00, inkA: 0.50, hatch: 1.00, clouds: 0.62 }
  ];

  /* 给每个峰加一点不对称与个体差异：真实的山总是「一面陡、一面缓」，
     完全对称的钟形曲线一眼就能看出是公式画的。 */
  (function () {
    for (var i = 0; i < PEAKS.length; i++) {
      var p = PEAKS[i];
      p.skew = (U.h1(p.cx | 0, 7001) - 0.5) * 0.60;
      p.sharpEff = p.sharp * (1.00 + U.h1(p.cx | 0, 7003) * 0.62);
    }
  })();

  /** 山脊在世界坐标 x 处的高度。
   *  峰值叠加定出大体山势，再叠三层扰动：
   *    大起伏 fbm  —— 山体的主要凹凸
   *    细碎 fbm   —— 碎石般的碎边
   *    脊状噪声    —— 只取噪声的「折点」，制造岩石的棱与脊
   *  少了脊状那一层，山就会圆得像沙丘，全无骨力。 */
  function ridgeY(x, lay) {
    var xo = x - lay.xOff;
    var sum = 0;
    for (var i = 0; i < PEAKS.length; i++) {
      var p = PEAKS[i];
      var t = (xo - p.cx) / p.w;
      if (t <= -1 || t >= 1) continue;
      var t2 = t < 0 ? t * (1 + p.skew) : t * (1 - p.skew);
      if (t2 <= -1 || t2 >= 1) continue;
      sum += Math.pow(1 - Math.abs(t2), p.sharpEff) * p.h;
    }
    if (sum <= 0.5) return lay.baseY;
    sum *= lay.hScale;
    var w = 0.30 + 0.70 * U.clamp(sum / 340, 0, 1);
    var rough = U.fbm1(xo * 0.00275, lay.seed, 5, 2.05, 0.53);
    var fine = U.fbm1(xo * 0.0125, lay.seed + 991, 3, 2.4, 0.5);
    var ridged = 1 - Math.abs(U.fbm1(xo * 0.0056, lay.seed + 1777, 3, 2.15, 0.55));
    return lay.baseY
      - sum
      - rough * lay.roughAmp * w
      - fine * lay.roughAmp * 0.30 * w
      - (ridged - 0.52) * (lay.rocky || 0) * w;
  }

  /** 山脊的「坡向」：正值表示此处右高左低，用于判断受光面 */
  function ridgeSlope(x, lay) {
    return ridgeY(x + 9, lay) - ridgeY(x - 9, lay);
  }

  /* 全卷最高峰。分片渲染时若用「本片最高点」做渐变基准，
     相邻两片的渐变位置就会不同，拼出一条明显的色带。
     所以渐变基准必须是只依赖层次、与传入范围无关的全局常量。 */
  var MAX_PEAK_H = 0;
  (function () {
    for (var i = 0; i < PEAKS.length; i++) if (PEAKS[i].h > MAX_PEAK_H) MAX_PEAK_H = PEAKS[i].h;
  })();
  function layerTop(lay) {
    return lay.baseY - MAX_PEAK_H * lay.hScale - lay.roughAmp * 1.35;
  }

  /** 沿山脊向下平移 dY 的窄带路径。
   *  用途见 paintLayer 的「内阴影」：把窄带一条条叠上去，
   *  就得到紧贴山脊起伏的浓淡层次——这是山有「骨」的关键，
   *  水平渐变永远做不到（那是把山涂成一块蛋糕）。 */
  function bandPath(ctx, x0, x1, lay, step, dY) {
    ctx.beginPath();
    var x;
    for (x = x0; x <= x1 + step; x += step) {
      var y = ridgeY(x, lay);
      if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (x = x1 + step; x >= x0 - step; x -= step) {
      ctx.lineTo(x, ridgeY(x, lay) + dY);
    }
    ctx.closePath();
  }

  /* ---------------------------------------------------------------
   * 调色板的横向渐变
   *
   * 分片渲染有一条硬性要求：同一个世界 x，在任何分片里都必须取到同一个颜色。
   * 若像最初那样「按分片中心取一个固定色」，相邻两片的色差会在拼缝处
   * 拉出一条贯穿画面的竖线（实测最大 31/255，一眼可见）。
   *
   * 解法是把每个色相都做成一条**沿 x 的线性渐变**，并且取色点对齐到
   * 全局 64 单位网格——这样两片在重叠区用的是同一组取色点与同一组颜色，
   * 结果逐位相同，拼缝自然消失。
   * 64 单位的量化间距远小于四季过渡区（1500+），肉眼无从分辨色阶。
   * ------------------------------------------------------------- */
  var PAL_STEP = 64;

  /** 沿 x 的调色板渐变；a 省略时输出不透明色 */
  function palGrad(ctx, x0, x1, key, a) {
    var span = x1 - x0;
    var g = ctx.createLinearGradient(x0, 0, x1, 0);
    var stop = function (xx) {
      var c = S.paletteAt(xx)[key];
      g.addColorStop((xx - x0) / span, a === undefined ? U.rgb(c) : U.rgba(c, a));
    };
    stop(x0);
    var s0 = Math.ceil(x0 / PAL_STEP) * PAL_STEP, s1 = Math.floor(x1 / PAL_STEP) * PAL_STEP;
    for (var xx = s0; xx <= s1; xx += PAL_STEP) {
      if (xx <= x0 || xx >= x1) continue;
      stop(xx);
    }
    stop(x1);
    return g;
  }

  /** 同上，但颜色取自「keyA 与 keyB 按 t 混合」 */
  function palGradMix(ctx, x0, x1, keyA, keyB, t, a) {
    var span = x1 - x0;
    var g = ctx.createLinearGradient(x0, 0, x1, 0);
    var stop = function (xx) {
      var p = S.paletteAt(xx);
      var c = U.mix(p[keyA], p[keyB], t);
      g.addColorStop((xx - x0) / span, a === undefined ? U.rgb(c) : U.rgba(c, a));
    };
    stop(x0);
    var s0 = Math.ceil(x0 / PAL_STEP) * PAL_STEP, s1 = Math.floor(x1 / PAL_STEP) * PAL_STEP;
    for (var xx = s0; xx <= s1; xx += PAL_STEP) {
      if (xx <= x0 || xx >= x1) continue;
      stop(xx);
    }
    stop(x1);
    return g;
  }

  /* ---------------------------------------------------------------
   * 积墨贴图
   *
   * 山体若是一整片纯色，放大后就成一块塑料。真实的水墨山是「积」出来的：
   * 淡墨一遍遍罩染，落成一片片浓淡不匀的斑驳。
   *
   * 做法：预生成一张可平铺的低频噪声贴图，用 multiply 罩在山体上。
   * 之所以用「正弦+余弦、频率取斐波那契整数对」而不是普通 fbm：
   * 整数频率天然首尾相接，贴图可无缝平铺；斐波那契频率对能让图案
   * 看起来足够杂乱，不会露出网格感。
   * 贴图锚定在世界坐标原点，所以分片之间同样严丝合缝。
   * ------------------------------------------------------------- */
  var _mottleTex = null;
  function mottleTexture() {
    if (_mottleTex) return _mottleTex;
    var N = 512;
    var cv = U.makeCanvas(N, N);
    var c = cv.getContext('2d');
    var img = c.createImageData(N, N);
    var d = img.data;
    var FIB = [[1, 2], [2, 3], [3, 5], [5, 8], [8, 13], [13, 21]];
    var ph = [], amp = [], norm = 0;
    for (var o = 0; o < FIB.length; o++) {
      ph.push([U.h1(o * 37 + 1, 5153) * 6.2832, U.h1(o * 41 + 7, 5167) * 6.2832]);
      var a0 = Math.pow(0.68, o);
      amp.push(a0);
      norm += a0;
    }
    for (var y = 0; y < N; y++) {
      var ty = y / N * 6.2832;
      for (var x = 0; x < N; x++) {
        var tx = x / N * 6.2832;
        var v = 0;
        for (var o2 = 0; o2 < FIB.length; o2++) {
          v += amp[o2] * Math.sin(tx * FIB[o2][0] + ph[o2][0]) * Math.cos(ty * FIB[o2][1] + ph[o2][1]);
        }
        v /= norm;
        /* 只保留「浓」的一侧，得到一块块不规则的墨渍 */
        var al = U.clamp((v - 0.02) * 0.42, 0, 1);
        var i = (y * N + x) * 4;
        d[i] = 46; d[i + 1] = 50; d[i + 2] = 44;
        d[i + 3] = Math.round(U.clamp(al, 0, 0.22) * 255);
      }
    }
    c.putImageData(img, 0, 0);
    _mottleTex = cv;
    return cv;
  }

  /* 云团贴图：预渲染一次，避免每个云团都 createRadialGradient（很贵） */
  var _cloudSprite = null;
  function cloudSprite() {
    if (_cloudSprite) return _cloudSprite;
    var N = 128;
    var cv = U.makeCanvas(N, N);
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.50, 'rgba(255,255,255,0.58)');
    g.addColorStop(0.78, 'rgba(255,255,255,0.20)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, N, N);
    _cloudSprite = cv;
    return cv;
  }

  /* ---------------------------------------------------------------
   * 绢底
   * ------------------------------------------------------------- */

  /** 生成一次纸纹 pattern（细颗粒 + 横向纤维），全局复用 */
  var _silkTex = null;
  function silkTexture() {
    if (_silkTex) return _silkTex;
    var N = 256;
    var cv = U.makeCanvas(N, N);
    var c = cv.getContext('2d');
    var img = c.createImageData(N, N);
    var d = img.data;
    for (var y = 0; y < N; y++) {
      for (var x = 0; x < N; x++) {
        var i = (y * N + x) * 4;
        /* 细颗粒 */
        var g = U.h2(x, y, 991) * 0.55 + U.n2(x * 0.12, y * 0.12, 771) * 0.45;
        /* 横向纤维：沿 x 拉长的低频起伏 */
        var fib = U.n1(y * 0.42, 313) * 0.5 + U.n1(y * 0.11, 517) * 0.5;
        var v = g * 0.30 + fib * 0.22;
        var lum = U.clamp(128 + v * 96, 0, 255);
        d[i] = lum; d[i + 1] = lum; d[i + 2] = lum;
        d[i + 3] = 255;
      }
    }
    c.putImageData(img, 0, 0);
    _silkTex = cv;
    return cv;
  }

  /** 在指定矩形内铺绢底：底色渐变的横向过渡 + 叠一层纸纹 */
  function paintSilk(ctx, wx, wy, ww, wh, pal) {
    var pa = S.paletteAt(wx), pb = S.paletteAt(wx + ww);
    var g = ctx.createLinearGradient(wx, 0, wx + ww, 0);
    g.addColorStop(0, U.rgb(pa.silk));
    g.addColorStop(1, U.rgb(pb.silk));
    ctx.fillStyle = g;
    ctx.fillRect(wx, wy, ww, wh);

    /* 纸纹：低透明度叠加，让绢面有纤维感 */
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.globalCompositeOperation = 'multiply';
    var pat = ctx.createPattern(silkTexture(), 'repeat');
    ctx.fillStyle = pat;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.restore();

    /* 四角的陈年水渍感：极淡的暖褐 */
    ctx.save();
    ctx.globalAlpha = 0.05;
    var vg = ctx.createLinearGradient(wx, wy, wx, wy + wh);
    vg.addColorStop(0, '#8A6A44');
    vg.addColorStop(0.22, 'rgba(138,106,68,0)');
    vg.addColorStop(0.78, 'rgba(138,106,68,0)');
    vg.addColorStop(1, '#8A6A44');
    ctx.fillStyle = vg;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.restore();
  }

  /* ---------------------------------------------------------------
   * 远天云气
   * ------------------------------------------------------------- */
  function paintSky(ctx, wx, wy, ww, wh, pal) {
    ctx.save();
    ctx.lineCap = 'round';
    var step = 26;
    for (var x = Math.floor(wx / step) * step; x < wx + ww + step; x += step) {
      var r = U.h1(x, 8801);
      if (r < 0.58) continue;
      var y = 52 + U.h1(x, 8803) * 180;
      var len = 90 + U.h1(x, 8807) * 260;
      var th = 5 + U.h1(x, 8811) * 20;
      var a = 0.022 + U.h1(x, 8813) * 0.038;
      ctx.globalAlpha = a;
      ctx.strokeStyle = U.rgba(pal.mist, 1);
      ctx.lineWidth = th;
      ctx.beginPath();
      var wob = U.n1(x * 0.004, 8819) * 16;
      ctx.moveTo(x, y + wob);
      ctx.quadraticCurveTo(x + len * 0.5, y + wob - 10, x + len, y + wob + 6);
      ctx.stroke();
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------
   * 山体
   * ------------------------------------------------------------- */

  /** 收集某个 x 区间内的山脊采样点（世界坐标），步长随画质自适应 */
  function ridgePoints(x0, x1, lay, step) {
    var pts = [];
    var sx = Math.floor(x0 / step) * step;
    for (var x = sx; x <= x1 + step; x += step) {
      pts.push(x, ridgeY(x, lay));
    }
    return pts;
  }

  /** 画一层山：山体 + 沿脊内阴影 + 山脚雾 + 披麻皴 + 苔点 + 墨线 + 矾头
   *
   *  绘制顺序是有讲究的：墨线必须落在皴与苔点之后，
   *  否则轮廓会被笔触糊掉；而内阴影必须紧贴山体，它承担了全部「体积」表达。
   */
  function paintLayer(ctx, wx, ww, lay, pal, detail, step) {
    var x0 = wx, x1 = wx + ww;
    step = step || 4;
    var pts = ridgePoints(x0, x1, lay, step);
    if (pts.length < 4) return;

    var col = pal[lay.key];
    var baseY = lay.baseY;

    /* 每层都向下填到水面附近。层与层之间必须「不透明地叠加」——
       若让某一层在中途淡出，它下面的渐隐区就会从谷地里露成一片白，
       画面会断成上下两截。远与近的差别改由「颜色」表现。 */
    var bottomY = L.shore + 26;
    function ridgePath() {
      ctx.beginPath();
      ctx.moveTo(pts[0], bottomY);
      for (var j = 0; j < pts.length; j += 2) ctx.lineTo(pts[j], pts[j + 1]);
      ctx.lineTo(pts[pts.length - 2], bottomY);
      ctx.closePath();
    }

    /* --- ① 山体基色 ---
       用「沿 x 的调色板渐变」而不是分片中心的一个固定色，
       否则四季过渡处相邻分片会拼出一条竖向色差。
       上下（山脊浓、山脚淡）的变化交给 ② 的内阴影与山脚雾。 */
    ctx.save();
    ridgePath();
    ctx.fillStyle = palGrad(ctx, x0, x1, lay.key);
    ctx.fill();
    /* 积墨：一层低频斑驳。没有它，山体在放大后就是一块纯色塑料。 */
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = ctx.createPattern(mottleTexture(), 'repeat');
    ctx.fill();
    ctx.restore();

    /* --- ② 沿脊内阴影：山体的体积全在这一步 ---
       把山脊曲线逐条向下平移 dY，取它与山脊之间的窄带填墨，
       近脊处墨最重、往下逐层减淡。因为窄带紧贴山脊起伏，
       呈现的是「山骨」的凹凸；换成水平渐变，山就塌成一块蛋糕了。 */
    ctx.save();
    ridgePath();
    ctx.clip();
    ctx.fillStyle = palGrad(ctx, x0, x1, 'ink', 1);
    for (var b = 0; b < 7; b++) {
      var dY = 7 * Math.pow(1.72, b);
      var al = (lay.inkA * 0.42) * Math.pow(0.70, b);
      if (al < 0.010) break;
      bandPath(ctx, x0, x1, lay, 5, dY);
      ctx.globalAlpha = al;
      ctx.fill();
    }
    ctx.restore();

    /* --- ③ 山脚雾：只在山脚压一层薄雾，浓度必须很轻，
           否则会把整座山漂白（这是最容易翻车的一处） --- */
    ctx.save();
    var fogH = (baseY - layerTop(lay)) * 0.17;
    var fg = ctx.createLinearGradient(0, baseY - fogH, 0, baseY + 22);
    fg.addColorStop(0, U.rgba(pal.silk, 0));
    fg.addColorStop(0.70, U.rgba(pal.silk, 0.10));
    fg.addColorStop(1, U.rgba(pal.silk, 0.26));
    ctx.fillStyle = fg;
    ridgePath();
    ctx.fill();
    ctx.restore();

    if (!detail) return;

    /* --- ④ 披麻皴：顺坡向下的「叶形」笔触 ---
       关键：用 fill 而不是 stroke。均匀粗细的直线看起来只是划痕；
       两头尖、中段丰的叶形才带得出毛笔的锥度与提按。
       只在「有岩骨」的地方成簇下笔，长度差异要拉大——
       短促一撇与直落山脚必须并存，否则就是一排栅栏。 */
    if (lay.hatch > 0.25) {
      var NBK = 5;
      var paths = [null, null, null, null, null];
      var SP = 7;
      var sx0 = Math.floor(x0 / SP) * SP;
      for (var hx = sx0; hx <= x1 + SP; hx += SP) {
        var cl = U.fbm1(hx * 0.0036, lay.seed + 501, 3, 2.15, 0.55);
        if (cl < -0.02) continue;
        var cnt = 1 + Math.round((cl + 0.02) * (2.0 + lay.hatch * 2.4));
        for (var k = 0; k < cnt; k++) {
          var hj = hx + (U.h1(hx * 31 + k * 7, lay.seed + 509) - 0.5) * SP * 2.4;
          var hid = Math.round(hj) | 0;
          var ry = ridgeY(hj, lay);
          var depth = baseY - ry;
          if (depth < 34) continue;
          var r1 = U.h1(hid * 13 + k * 17, lay.seed + 71);
          var r2 = U.h1(hid * 29 + k * 23, lay.seed + 73);
          var r3 = U.h1(hid * 41 + k * 29, lay.seed + 79);
          var startT = 0.05 + 0.46 * r2;
          var y0 = ry + depth * startT;
          var avail = depth * (1 - startT) - 6;
          if (avail < 8) continue;
          /* 长度的重尾分布：多数是中等长度，少数直落山脚。
             披麻皴的笔要「长」，短促的碎笔会把山画成一片草。 */
          var len = avail * (0.20 + Math.pow(r1, 1.5) * 0.86);
          /* 坡向：皴笔必须「顺坡而下、自峰顶扇形散开」，
             不是一根根竖直的毛。ridgeSlope 是 18 世界单位上的落差，
             乘以 len/18 即为这一笔在长度内应发生的水平位移。 */
          var slope = ridgeSlope(hj, lay);
          var lean = U.clamp(len * slope / 18 * 0.55, -len * 0.8, len * 0.8);
          var drift = lean + (r3 - 0.5) * len * 0.26;
          var w = (1.3 + r2 * 3.0) * (0.50 + lay.hatch * 0.75);
          var a = (0.19 + r1 * 0.40) * lay.hatch;
          var bi = U.clamp(Math.round(a / 0.11), 1, NBK) - 1;
          var pk = paths[bi] || (paths[bi] = new Path2D());
          /* 起笔尖 → 中段丰 → 收笔尖，且整笔随 drift 弯过去。
             直的等宽线只是划痕，带弧度的锥形笔触才是「皴」。 */
          pk.moveTo(hj, y0);
          pk.lineTo(hj - w + drift * 0.12, y0 + len * 0.30);
          pk.lineTo(hj + w * 0.66 + drift * 0.62, y0 + len * 0.60);
          pk.lineTo(hj + drift, y0 + len);
          pk.closePath();
        }
      }
      ctx.fillStyle = palGrad(ctx, x0, x1, 'ink', 1);
      for (var bk = 0; bk < NBK; bk++) {
        if (!paths[bk]) continue;
        ctx.globalAlpha = 0.12 + bk * 0.10;
        ctx.fill(paths[bk]);
      }
      ctx.globalAlpha = 1;
    }

    /* --- ⑤ 点苔：山脊与岩面上的浓墨点簇 ---
       最见效的一层。缺了它，山体就是一块染了色的布。
       苔要「成片」而不是「均匀撒芝麻」，所以先过一道低频噪声，
       再在允许的位置上密堆小点。整层裁剪在山体内，免得越出轮廓。 */
    if (lay.hatch > 0.7) {
      ctx.save();
      ridgePath();
      ctx.clip();
      var mp = null;
      var MSP = 15;
      var mx0 = Math.floor(x0 / MSP) * MSP;
      for (var mx = mx0; mx <= x1 + MSP; mx += MSP) {
        if (U.fbm1(mx * 0.0022, lay.seed + 603, 2, 2.0, 0.5) < -0.10) continue;
        var ry2 = ridgeY(mx, lay);
        if (baseY - ry2 < 70) continue;
        var nn = 2 + Math.round(U.h1(mx, lay.seed + 607) * 4);
        for (var m = 0; m < nn; m++) {
          var ax = mx + (U.h1(mx * 7 + m * 13, lay.seed + 611) - 0.5) * 26;
          var ay = ridgeY(ax, lay) + 2 + U.h1(mx * 11 + m * 17, lay.seed + 613) * 40;
          var rad = 1.0 + U.h1(mx * 17 + m * 19, lay.seed + 617) * 2.2;
          if (!mp) mp = new Path2D();
          mp.moveTo(ax + rad, ay);
          mp.arc(ax, ay, rad, 0, 6.2832);
        }
      }
      if (mp) {
        ctx.globalAlpha = 0.46;
        ctx.fillStyle = palGrad(ctx, x0, x1, 'ink', 1);
        ctx.fill(mp);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }

    /* --- ⑥ 山脊墨线：分段变宽的毛笔轮廓 ---
       每约 96 世界单位一段，段内按「高出山脚多少」决定提按：
       峰顶下笔重（粗且浓），鞍部提笔轻（细且淡）。
       均匀一条线会像贴上去的边框，不像画的。 */
    if (lay.inkA > 0.05) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = palGrad(ctx, x0, x1, 'ink', 1);
      var SEG = 96;
      var s0 = Math.floor(x0 / SEG) * SEG;
      for (var s = s0; s < x1 + SEG; s += SEG) {
        var hSum = 0, hN = 0;
        for (var q = 0; q <= SEG; q += 12) {
          hSum += Math.max(0, baseY - ridgeY(s + q, lay));
          hN++;
        }
        var tw = U.clamp(hSum / hN / 330, 0, 1);
        ctx.beginPath();
        for (var q2 = 0; q2 <= SEG; q2 += 3) {
          var xx = s + q2, yy = ridgeY(xx, lay);
          if (q2 === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
        }
        ctx.globalAlpha = lay.inkA * (0.34 + tw * 0.86);
        ctx.lineWidth = 1.4 + tw * 4.0;
        ctx.stroke();
      }

      /* 峰头再压一笔：整卷的「骨节」都在这里 */
      var hp = null;
      for (var n2 = 2; n2 < pts.length - 2; n2 += 2) {
        var yv = pts[n2 + 1];
        if (!(yv < pts[n2 - 1] && yv < pts[n2 + 3])) continue;
        var hAbove = baseY - yv;
        if (hAbove < 96) continue;
        var span = Math.round(28 + hAbove * 0.16);
        if (!hp) hp = new Path2D();
        hp.moveTo(pts[n2] - span, ridgeY(pts[n2] - span, lay));
        for (var q3 = -span + 4; q3 <= span; q3 += 4) {
          hp.lineTo(pts[n2] + q3, ridgeY(pts[n2] + q3, lay));
        }
      }
      if (hp) {
        ctx.globalAlpha = Math.min(0.88, lay.inkA * 1.6);
        ctx.lineWidth = 3.0;
        ctx.stroke(hp);
      }
      ctx.restore();
    }

    /* --- ⑦ 矾头：峰顶的小石堆，国画山水的标志性细节 ---
       必须裁在山体内：一旦向上越出轮廓线，峰顶就多出一顶小帽子。 */
    if (lay.hatch > 0.8) {
      ctx.save();
      ridgePath();
      ctx.clip();
      for (var si = 4; si < pts.length - 4; si += 2) {
        var sy = pts[si + 1];
        if (!(sy < pts[si - 1] && sy < pts[si + 3])) continue;
        if (sy > baseY - 110) continue;
        var nStone = 2 + Math.round(U.h1(pts[si], lay.seed + 401) * 3);
        ctx.beginPath();
        for (var t = 0; t < nStone; t++) {
          var ox = (U.h1(pts[si] + t * 13, lay.seed + 409) - 0.5) * 34;
          var sw = 6 + U.h1(pts[si] + t * 19, lay.seed + 421) * 9;
          var sh = 4 + U.h1(pts[si] + t * 23, lay.seed + 431) * 6;
          /* 矾头要「坐」在山脊上，不能向上冒出去——
             一旦高于轮廓线，峰顶就会多出一顶小帽子，非常出戏。 */
          var oy = sh * 0.75 + (U.h1(pts[si] + t * 17, lay.seed + 419) - 0.5) * 9;
          ctx.moveTo(pts[si] + ox - sw, sy + oy + sh);
          ctx.lineTo(pts[si] + ox - sw * 0.35, sy + oy - sh);
          ctx.lineTo(pts[si] + ox + sw * 0.55, sy + oy - sh * 0.45);
          ctx.lineTo(pts[si] + ox + sw, sy + oy + sh);
        }
        ctx.fillStyle = palGradMix(ctx, x0, x1, lay.key, 'ink', 0.34, 0.58);
        ctx.fill();
        ctx.strokeStyle = U.rgba(pal.ink, 0.40);
        ctx.lineWidth = 1.15;
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** 云气：团块状而非直线雾带。国画的云是「留白」，必须是不规则的团。
   *  浓度要压住——三层山的云会叠加，一旦每层都浓，整座山就被漂白了。 */
  function paintClouds(ctx, x0, x1, lay, pal) {
    if (!lay.clouds) return;
    var density = lay.clouds;
    var step = 74;
    var spr = cloudSprite();
    ctx.save();
    for (var x = Math.floor(x0 / step) * step; x < x1 + step; x += step) {
      var pick = U.h1(x, 5551 + lay.seed);
      if (pick > 0.03 + density * 0.20) continue;
      var cx = x + U.h1(x, 5553 + lay.seed) * step;
      /* 云横山腰：云团贴着山脚上下摆动，才像「云气」而不是「白斑」 */
      var cy = lay.baseY - 54 + U.h1(x, 5557 + lay.seed) * 110;
      var cw = 70 + U.h1(x, 5561 + lay.seed) * 210;
      var ch = 12 + U.h1(x, 5563 + lay.seed) * 28;
      var a = 0.13 + U.h1(x, 5567 + lay.seed) * 0.26;

      ctx.globalAlpha = a;
      ctx.drawImage(spr, cx - cw, cy - ch * 2, cw * 2, ch * 4);
    }
    ctx.restore();
  }

  /* ---------------------------------------------------------------
   * 山脚林带
   * 用「点叶」法画出成片的树林，把山体与水岸分开。
   * 缺了这条带子，山会像浮在半空。
   *
   * 要点：树必须成片、成团、有浓淡。一根根等距的孤立细线只会读成
   * 「草丛」，所以这里做了三件事：
   *   ① 先铺一层横向墨晕，把散落的树点连成「带」；
   *   ② 前后两排错开，避免像栅栏；
   *   ③ 叶点按三档浓淡分桶批量填充，林子里自然就有深浅。
   * ------------------------------------------------------------- */
  /* 林带底色：一层极淡的横向墨晕，把散落的树点连成「带」。
     它只是个色块，不需要摆动，所以留在静态层——省掉每帧一块渐变填充。 */
  function paintTreelineBand(ctx, x0, x1, pal) {
    var baseY = L.ridgeBase + 8;
    ctx.save();
    var bw = ctx.createLinearGradient(0, baseY - 104, 0, baseY + 20);
    bw.addColorStop(0, U.rgba(pal.ink, 0));
    bw.addColorStop(0.50, U.rgba(pal.ink, 0.095));
    bw.addColorStop(1, U.rgba(U.mix(pal.ink, pal.mid, 0.35), 0.26));
    ctx.fillStyle = bw;
    ctx.fillRect(x0, baseY - 104, x1 - x0, 124);
    ctx.restore();
  }

  /** 林中的树：树干 + 点叶树冠。
   * -------------------------------------------------------------
   * 要点：树必须成片、成团、有浓淡。一根根等距的孤立细线只会读成
   * 「草丛」，所以这里做了三件事：
   *   ① 前后两排错开，避免像栅栏；
   *   ② 叶点按三档浓淡分桶批量填充（Path2D），林子里自然有深浅；
   *   ③ 整棵树随离地高度横向摆开——树根不动、树梢摆得最狠。
   *
   * 因为要摆，这层由灵动层每帧重绘，**静态层绝不能画**，否则重影。
   * dots 控制每棵树的叶点数，供灵动层按性能降级。
   * ------------------------------------------------------------- */
  function treelineFoliage(ctx, x0, x1, pal, dots, step) {
    var baseY = L.ridgeBase + 8;
    var nDot = dots === undefined ? 30 : dots;
    ctx.save();

    /* step 可调：概览视距下整卷 12000 单位全在视口里，按 20 铺要画 600 棵树，
       每帧几千个叶点，白花力气。 */
    step = step || 20;
    var sx = Math.floor(x0 / step) * step;
    var trunk = null;
    var leaf = [new Path2D(), new Path2D(), new Path2D()];

    for (var tx = sx; tx < x1 + step; tx += step) {
      if (U.h1(tx, 8101) < 0.16) continue;
      /* 前后两排 */
      var row = U.h1(tx, 8105) > 0.45 ? 0 : 1;
      var by = baseY - row * 16 + (U.h1(tx, 8103) - 0.5) * 14;
      var h = 46 + U.h1(tx, 8107) * (row ? 58 : 40);
      var w = h * (0.50 + U.h1(tx, 8109) * 0.34);
      var lean = (U.h1(tx, 8111) - 0.5) * 10;
      /* 该树此刻被风吹开的量：与树高成正比 */
      var sway = global.Motifs.windTilt(tx) * h * 0.9;

      /* 树干：根部锚定在 (tx, by)，梢部才随风走 */
      if (!trunk) trunk = new Path2D();
      trunk.moveTo(tx, by);
      trunk.lineTo(tx + lean + sway, by - h * 0.62);

      /* 树冠。点叶要密、要成团。 */
      var tone = U.h1(tx, 8119);
      var pp = leaf[tone < 0.34 ? 0 : (tone < 0.72 ? 1 : 2)];
      var cx = tx + lean * 0.7 + sway;

      if (nDot === 0) {
        /* nDot = 0：整块实心冠。
           为什么需要这条路：静态分片是在高分辨率下烘焙、再缩小显示的，
           而灵动层是**直接在视距尺度上画**。概览视距（0.094）下叶点半径
           只有 0.2~0.5px，逐个画出来是一层淡噪点而不是树冠——缩放平均
           这件事，实时绘制是享受不到的。所以小视距下改成填一块实心椭圆，
           缩下去正是「点叶团成一片」该有的样子，而且便宜得多。 */
        var cy = by - h * 0.76;
        pp.moveTo(cx + w * 0.52, cy);
        pp.ellipse(cx, cy, w * 0.52, h * 0.30, 0, 0, 6.2832);
      } else {
        for (var k = 0; k < nDot; k++) {
          var a = U.h1(tx + k * 13, 8113);
          var b2 = U.h1(tx + k * 17, 8117);
          /* 只动 x，不动 y —— 剪切变换的位移是纯横向的。
             顺手给 y 也加一点「摆」会让树冠与树干梢部脱节，看着像整棵树在上下颠。 */
          var px = cx + (a - 0.5) * w;
          var py = by - h * 0.48 - b2 * h * 0.58;
          var rad = 2.0 + a * 3.2;
          pp.moveTo(px + rad, py);
          pp.arc(px, py, rad, 0, 6.2832);
        }
      }
    }

    if (trunk) {
      ctx.strokeStyle = U.rgba(pal.ink, 0.66);
      ctx.lineWidth = 1.9;
      ctx.lineCap = 'round';
      ctx.stroke(trunk);
    }
    var tones = [[0.30, 0.52], [0.08, 0.66], [0.00, 0.46]];
    for (var q = 0; q < 3; q++) {
      ctx.fillStyle = palGradMix(ctx, x0, x1, 'ink', 'mid', tones[q][0], tones[q][1]);
      ctx.fill(leaf[q]);
    }
    ctx.restore();
  }

  /** 水中洲渚：小片陆地 + 卵石 + 芦苇，为水面前景增加落脚点 */
  function paintIslets(ctx, x0, x1, pal) {
    var step = 470;
    ctx.save();
    for (var x = Math.floor(x0 / step) * step; x < x1 + step; x += step) {
      var r0 = U.h1(x, 8201);
      if (r0 < 0.46) continue;
      var cx = x + U.h1(x, 8203) * step;
      var cy = L.waterMid + (U.h1(x, 8207) - 0.5) * 52;
      var w = 22 + U.h1(x, 8211) * 24;
      var h = 4 + U.h1(x, 8213) * 5;

      /* 洲渚本体：一枚扁平的浅色土坡 */
      ctx.beginPath();
      ctx.moveTo(cx - w, cy);
      ctx.quadraticCurveTo(cx - w * 0.4, cy - h * 1.7, cx, cy - h * 1.5);
      ctx.quadraticCurveTo(cx + w * 0.45, cy - h * 1.7, cx + w, cy);
      ctx.closePath();
      ctx.fillStyle = palGradMix(ctx, x0, x1, 'near', 'silk', 0.34, 0.62);
      ctx.fill();
      ctx.strokeStyle = U.rgba(pal.ink, 0.30);
      ctx.lineWidth = 1.2;
      ctx.stroke();

      /* 洲上芦苇 */
      ctx.lineCap = 'round';
      var nr = 3 + Math.round(U.h1(x, 8217) * 4);
      for (var i = 0; i < nr; i++) {
        var rx = cx - w * 0.6 + (i + 0.5) / nr * w * 1.2;
        var rh = 14 + U.h1(x + i * 31, 8221) * 22;
        var rw = (U.h1(x + i * 37, 8223) - 0.5) * 16;
        ctx.beginPath();
        ctx.moveTo(rx, cy - h * 1.2);
        ctx.quadraticCurveTo(rx + rw * 0.4, cy - h * 1.2 - rh * 0.6, rx + rw, cy - h * 1.2 - rh);
        ctx.strokeStyle = U.rgba(pal.ink, 0.38);
        ctx.lineWidth = 1.0;
        ctx.stroke();
      }

      /* 卵石 */
      ctx.beginPath();
      for (var s = 0; s < 3; s++) {
        var sx2 = cx + (U.h1(x + s * 41, 8227) - 0.5) * w * 1.5;
        var sw2 = 4 + U.h1(x + s * 43, 8229) * 6;
        ctx.moveTo(sx2, cy + 1);
        ctx.ellipse(sx2, cy + 1, sw2, sw2 * 0.5, 0, 0, 6.2832);
      }
      ctx.fillStyle = U.rgba(pal.rock, 0.52);
      ctx.fill();
      ctx.strokeStyle = U.rgba(pal.ink, 0.30);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 山体倒影：先把水面清成绢底，再把山形镜像 + 水平抖纹叠上去 */
  function paintReflection(ctx, wx, ww, pal, detail) {
    var shore = L.shore;
    var maxD = L.waterBottom - shore + 46;

    ctx.save();
    /* 清出水域：用绢色盖掉山体垂到水下的那一截，岸线由此变得干净 */
    var pa = S.paletteAt(wx), pb = S.paletteAt(wx + ww);
    var wg0 = ctx.createLinearGradient(wx, 0, wx + ww, 0);
    wg0.addColorStop(0, U.rgb(pa.silk));
    wg0.addColorStop(1, U.rgb(pb.silk));
    ctx.fillStyle = wg0;
    ctx.fillRect(wx, shore, ww, H - shore);
    ctx.restore();

    var lay = LAYERS[2], lay2 = LAYERS[1];

    ctx.save();
    ctx.beginPath();
    ctx.rect(wx, shore, ww, maxD);
    ctx.clip();

    /* 镜像山形：近层更清晰、远层更淡 */
    [lay, lay2].forEach(function (ly) {
      var alpha = ly === lay ? 0.24 : 0.12;
      var squash = 0.62;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      var pts = ridgePoints(wx, wx + ww, ly, 6);
      ctx.moveTo(pts[0], shore + 24);
      for (var i = 0; i < pts.length; i += 2) {
        ctx.lineTo(pts[i], shore + (shore - pts[i + 1]) * squash * 0.58 + 8);
      }
      ctx.lineTo(pts[pts.length - 2], shore + 24);
      ctx.closePath();
      ctx.fillStyle = palGrad(ctx, wx, wx + ww, ly.key);
      ctx.fill();
      ctx.restore();
    });

    /* 水平撕纹：水波撕碎倒影，越往下越碎 */
    if (detail) {
      ctx.globalCompositeOperation = 'destination-out';
      var y = shore + 3;
      while (y < shore + maxD) {
        var t = (y - shore) / maxD;
        var rr0 = U.h1(Math.round(y), 9101);
        var a = U.clamp(0.04 + t * 0.26, 0, 0.32) * (0.4 + rr0 * 0.6);
        ctx.globalAlpha = a;
        ctx.fillStyle = '#000';
        var sx = Math.floor(wx / 7) * 7;
        for (var x = sx; x < wx + ww; x += 7) {
          var rr = U.h1(x * 131 + Math.round(y) * 17, 9203);
          if (rr < 0.46) continue;
          ctx.fillRect(x, y, 4 + rr * 13, 2 + rr * 2);
        }
        y += 3.5;
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** 水波纹线 + 岸线 + 天光反射带 */
  function paintWater(ctx, wx, ww, pal, detail) {
    var shore = L.shore;
    ctx.save();

    /* 岸线：一条略重的横向墨线，水陆分界 */
    ctx.beginPath();
    for (var x = wx; x <= wx + ww; x += 5) {
      var y = shore + U.fbm1(x * 0.0035, 7401, 3, 2.2, 0.5) * 8;
      if (x === wx) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = U.rgba(pal.ink, 0.46);
    ctx.lineWidth = 2.4;
    ctx.stroke();

    if (!detail) { ctx.restore(); return; }

    /* 近岸墨色晕染：让水陆之间有过渡 */
    var wg = ctx.createLinearGradient(0, shore, 0, shore + 54);
    wg.addColorStop(0, U.rgba(pal.ink, 0.19));
    wg.addColorStop(1, U.rgba(pal.ink, 0));
    ctx.fillStyle = wg;
    ctx.fillRect(wx, shore, ww, 54);

    /* 天光反射带：水面横向的亮条。绢底本身就是浅色，
       所以这里必须用比绢底更亮的白，才能显出「水光」。
       数量与强度都要克制，铺满整片水就成了白雾。 */
    for (var b0 = 0; b0 < 3; b0++) {
      var by0 = shore + 20 + b0 * ((L.waterBottom - shore - 20) / 3.4);
      var bx = Math.floor(wx / 34) * 34;
      ctx.beginPath();
      for (var x0 = bx; x0 < wx + ww; x0 += 34) {
        var r0 = U.h1(x0 * 3 + Math.round(by0) * 7, 9601);
        if (r0 < 0.66) continue;
        var l0 = 30 + r0 * 130;
        var yy0 = by0 + (U.h1(x0 + Math.round(by0), 9603) - 0.5) * 12;
        ctx.moveTo(x0, yy0);
        ctx.lineTo(x0 + l0, yy0);
      }
      ctx.strokeStyle = 'rgba(255,254,250,' + (0.17 - b0 * 0.032).toFixed(3) + ')';
      ctx.lineWidth = 5.0 - b0 * 0.8;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    /* 波纹：水平细短线。水是「留白」，所以波纹必须少而轻——
       近岸略密、往下迅速稀疏并淡尽，一旦铺满整片水就成了「一片草」。
       注意 strokeStyle 必须在这里重设为墨色：上一段「天光反射带」
       把 strokeStyle 留成了白色，不重设的话波纹会画成一堆白线。 */
    ctx.lineCap = 'round';
    ctx.strokeStyle = palGrad(ctx, wx, wx + ww, 'ink', 1);
    var bands = 15;
    for (var b = 0; b < bands; b++) {
      var tt = b / bands;
      var by = shore + 13 + b * ((L.waterBottom - shore - 13) / bands);
      var density = 0.62 - tt * 0.44;
      var fade = 1 - tt * 0.78;
      var sx = Math.floor(wx / 11) * 11;
      ctx.beginPath();
      var curA = -1;
      for (var x2 = sx; x2 < wx + ww; x2 += 11) {
        var r = U.h1(x2 * 7 + Math.round(by) * 13, 9503);
        if (r < density) continue;
        var len = 10 + r * (36 + b * 2.6);
        var yy = by + (U.h1(x2 + Math.round(by), 9511) - 0.5) * 10;
        var a = (0.05 + r * 0.13) * fade;
        if (Math.abs(a - curA) > 0.014) {
          if (curA > 0) { ctx.globalAlpha = curA; ctx.stroke(); }
          ctx.beginPath(); curA = a;
        }
        ctx.moveTo(x2, yy);
        ctx.lineTo(x2 + len, yy + U.n1(x2 * 0.02, 9521) * 2);
      }
      if (curA > 0) { ctx.globalAlpha = curA; ctx.stroke(); }
    }
    ctx.globalAlpha = 1;

    /* 远水渐隐：让水面下游淡入绢色，避免大面积死白 */
    ctx.globalAlpha = 1;
    var vg = ctx.createLinearGradient(0, shore + 60, 0, L.waterBottom + 40);
    vg.addColorStop(0, U.rgba(pal.silk, 0));
    vg.addColorStop(1, U.rgba(pal.silk, 0.55));
    ctx.fillStyle = vg;
    ctx.fillRect(wx, shore + 60, ww, L.waterBottom + 40 - shore - 60);
    ctx.restore();
  }

  /* ---------------------------------------------------------------
   * 画边收尾：底部渐隐入绢，像长卷的下缘
   * ------------------------------------------------------------- */
  function paintGround(ctx, wx, ww, pal, detail) {
    ctx.save();
    var y0 = L.waterBottom - 34;
    var g = ctx.createLinearGradient(0, y0, 0, H);
    g.addColorStop(0, U.rgba(pal.silk, 0));
    g.addColorStop(0.6, U.rgba(pal.silk, 0.42));
    g.addColorStop(1, U.rgba(pal.silk, 0.78));
    ctx.fillStyle = g;
    ctx.fillRect(wx, y0, ww, H - y0);
    ctx.restore();
  }

  /* ---------------------------------------------------------------
   * 题跋
   * ------------------------------------------------------------- */

  /** 竖排文字：逐字下落（Canvas 没有竖排，只能手动排） */
  function vText(ctx, text, x, y, size, color, alpha, lh, bold) {
    ctx.save();
    ctx.font = (bold ? '600 ' : '') + size + 'px "Songti SC","STSong","SimSun","Noto Serif SC",serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = U.rgba(color, alpha);
    for (var i = 0; i < text.length; i++) {
      ctx.fillText(text.charAt(i), x, y + i * lh);
    }
    ctx.restore();
  }

  /** 在画卷上题字落款。位置与尺寸固定，故分片之间能严丝合缝。
   *  颜色按题跋自身的世界 x 取，不能按分片取——
   *  题跋可能正好骑在分片边界上，被两片各画一次；若两片取色不同，
   *  叠起来就会出现一层淡淡的双影。 */
  function paintInscriptions(ctx, x0, x1, pal) {
    var list = S.INSCRIPTIONS;
    for (var n = 0; n < list.length; n++) {
      var ins = list[n];
      if (ins.x < x0 - 260 || ins.x > x1 + 260) continue;
      var ip = S.paletteAt(ins.x);

      var titleW = ins.title.length * 26;
      var verseW = ins.lines.length * 23;
      var totalW = titleW + verseW + 62;
      var totalH = Math.max(titleW, ins.lines[0].length * 22);

      /* 题跋处的「留白」：画家特意空出的绢面，让墨字能读。
         填充范围必须正好等于渐变的半径，否则在半径之外仍有半透明像素，
         矩形的四条边会露出来，看起来像贴了一张纸。 */
      ctx.save();
      var cx = ins.x - totalW * 0.34 + 20, cy = ins.y + totalH * 0.42;
      var R = Math.max(totalW, totalH) * 0.78;
      var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, U.rgba(ip.silk, 0.80));
      g.addColorStop(0.62, U.rgba(ip.silk, 0.42));
      g.addColorStop(1, U.rgba(ip.silk, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.restore();

      /* 标题（最右一列，字大） */
      vText(ctx, ins.title, ins.x, ins.y, 19, ip.ink, 0.74, 26, true);

      /* 诗文：每句一列，自右向左 */
      for (var i = 0; i < ins.lines.length; i++) {
        vText(ctx, ins.lines[i], ins.x - 34 - i * 23, ins.y + 8, 15, ip.ink, 0.62, 22);
      }

      /* 落款 */
      vText(ctx, ins.by.replace(/《|》/g, '·'), ins.x - 34 - ins.lines.length * 23 - 6, ins.y + 16, 10.5, ip.ink, 0.44, 15);

      /* 朱文印 */
      var sealY = ins.y + ins.title.length * 26 + 14;
      ctx.save();
      ctx.fillStyle = U.rgba(U.hex('#C8452F'), 0.82);
      ctx.fillRect(ins.x - 10, sealY, 20, 20);
      ctx.strokeStyle = U.rgba(U.hex('#B03A24'), 0.9);
      ctx.lineWidth = 1;
      ctx.strokeRect(ins.x - 10.5, sealY - 0.5, 21, 21);
      var sc = ins.seal.charAt(0), sc2 = ins.seal.charAt(1) || '';
      ctx.font = '10px "Songti SC","STSong","SimSun",serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(255,248,240,0.94)';
      if (sc2) {
        ctx.fillText(sc, ins.x, sealY + 6.5);
        ctx.fillText(sc2, ins.x, sealY + 15);
      } else {
        ctx.fillText(sc, ins.x, sealY + 10.5);
      }
      ctx.restore();
    }
  }

  /* ---------------------------------------------------------------
   * 对外入口
   * ------------------------------------------------------------- */

  /**
   * @param ctx  2D 上下文（内部自行处理平移与裁剪）
   * @param wx,wy,ww,wh  世界坐标矩形
   * @param opts { detail:boolean, step:number }
   *        detail=false 时跳过皴法/波纹/点景，用于低清占位与迷你地图
   *        step 控制山脊采样步长（迷你地图可放大到 16 以上）
   */
  function paint(ctx, wx, wy, ww, wh, opts) {
    opts = opts || {};
    var detail = opts.detail !== false;
    var step = opts.step || 4;
    /* pad：向外多画一圈，让分片拼接处的像素是「有上下文的完整像素」。
       若严格按分片边界 clip，边缘会被抗锯齿切成半透明，相邻两片就拼出了一条缝。 */
    var pad = opts.pad === undefined ? 16 : opts.pad;
    var pal = S.paletteAt(wx + ww * 0.5);

    ctx.save();
    /* 必须先平移到世界坐标系，再按世界坐标裁剪。
       若在 translate 之前 clip，裁剪矩形会落在屏幕坐标系里，
       1000 号分片之后就会整块被裁空（画面只剩低清占位层）。 */
    ctx.translate(-wx, -wy);
    ctx.beginPath();
    ctx.rect(wx - pad, wy - pad, ww + pad * 2, wh + pad * 2);
    ctx.clip();

    var ex0 = wx - pad, exw = ww + pad * 2;

    paintSilk(ctx, wx, wy, ww, wh, pal);
    paintSky(ctx, ex0, wy, exw, wh, pal);

    for (var i = 0; i < LAYERS.length; i++) {
      paintLayer(ctx, ex0, exw, LAYERS[i], pal, detail, step);
      paintClouds(ctx, ex0, exw, LAYERS[i], pal);
    }
    if (detail) paintTreelineBand(ctx, ex0, ex0 + exw, pal);

    paintReflection(ctx, ex0, exw, pal, detail);
    paintWater(ctx, ex0, exw, pal, detail);
    if (detail) paintIslets(ctx, ex0, ex0 + exw, pal);
    paintGround(ctx, ex0, exw, pal, detail);

    if (detail) {
      /* 'static'：跳过由灵动层接管的植物与舟，避免画两遍 */
      if (global.Motifs) global.Motifs.paintAll(ctx, ex0, ex0 + exw, pal, 'static');
      paintInscriptions(ctx, ex0, ex0 + exw, pal);
    }

    ctx.restore();
  }

  global.Painter = {
    paint: paint,
    ridgeY: ridgeY,
    LAYERS: LAYERS,
    paintSilk: paintSilk,
    silkTexture: silkTexture,
    paintTreelineBand: paintTreelineBand,
    treelineFoliage: treelineFoliage,
    palGrad: palGrad,
    palGradMix: palGradMix
  };
})(typeof window !== 'undefined' ? window : globalThis);
