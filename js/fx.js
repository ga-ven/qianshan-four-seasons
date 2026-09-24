/*!
 * fx.js —— 动态层
 *
 * 单独一层 canvas 覆盖在画卷之上，每帧重绘。
 * 粒子分两类：
 *   · 世界锚定（落花 / 雨雪 / 飞鸟 / 涟漪）—— 随画卷一起移动，像真的下在画里
 *   · 屏幕锚定（云雾 / 天光）—— 带视差，营造空气感与纵深
 */
(function (global) {
  'use strict';
  var U = global.U, S = global.SceneData;

  var WORLD_W = S.WORLD_W, WORLD_H = S.WORLD_H;
  var L = S.LAYOUT;

  var _fogSprite = null;
  function fogSprite() {
    if (_fogSprite) return _fogSprite;
    var N = 192;
    var cv = U.makeCanvas(N, N);
    var c = cv.getContext('2d');
    var g = c.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    g.addColorStop(0, 'rgba(255,255,255,0.92)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.38)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, N, N);
    _fogSprite = cv;
    return cv;
  }

  /** 世界 x → 该处的季节天气配置 */
  function fxAt(x) { return S.SEASON_FX[S.seasonAt(x).key]; }

  /* 默认视距（1280 宽 ÷ 0.8）下的可视宽度。下面所有「目标条数」都以它为基准 ——
     于是只看得见一季时，条数与旧的「按视口中心取一季」完全一致，
     而缩小到能同时看见四季时，条数按各季的可视宽度分摊。 */
  var REF_W = 1600;

  function Fx(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.vw = 0; this.vh = 0;
    this.time = 0;

    this.petals = [];
    this.snow = [];
    this.rain = [];
    this.fog = [];
    this.birds = [];
    this.ripples = [];

    this.rainActive = 0;      /* 0→1 渐变 */
    this.rainWanted = false;
    this.rainMulAvg = 1;      /* 视口内的平均雨量系数 */
    this.mood = 'noon';

    /* 灵动层：植被摆动 / 水面流动 / 人物行走 */
    this.alive = new global.Alive();

    this._initFog();
  }

  Fx.prototype.resize = function (w, h) {
    this.vw = Math.max(320, w);
    this.vh = Math.max(240, h);
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
  };

  Fx.prototype._initFog = function () {
    this.fog.length = 0;
    for (var i = 0; i < 10; i++) {
      this.fog.push({
        x: U.h1(i * 17, 101) * 2000,
        y: 0.10 + U.h1(i * 23, 103) * 0.72,
        w: 320 + U.h1(i * 29, 107) * 620,
        s: 0.10 + U.h1(i * 31, 109) / 520,
        a: 0.055 + U.h1(i * 37, 113) * 0.085,
        par: 0.12 + U.h1(i * 41, 127) * 0.26
      });
    }
  };

  /** 生成一枚落在可视范围内的世界坐标 */
  Fx.prototype._spawnWorld = function (e, margin) {
    var visW = e.visibleW(), visH = e.visibleH();
    var m = margin === undefined ? 120 : margin;
    return {
      x: e.view.x - m + Math.random() * (visW + m * 2),
      y: e.view.y - m + Math.random() * (visH + m * 2)
    };
  };

  /* ---------------------------------------------------------------
   * 分季取点
   *
   * 卷轴是 12000 世界单位里**并置**着四季的。因此「现在是什么季节」
   * 对于粒子层不是一个问题，而是**每颗粒子各问一次**的问题：
   * 落在 10400 的雪就是冬雪，落在 4500 的雨就是夏雨。
   *
   * 从前这里只按「视口中心」取一个季节配置。默认视距（可视宽 1600）下
   * 只看得见一季，看不出问题；一旦缩到整卷，视口中心落在世界 6000（秋），
   * 于是**冬天那一带开始飘秋天的落叶、并且一粒雪都不下**。
   * 「缩小之后冬天的颜色被盖住了」就是从这里来的。
   * ------------------------------------------------------------- */

  /** 在「会下这种天气」的季节带里取一个世界 x，按各带的可视宽度加权。
   *  找不到任何一条带（例如满屏只有冬天而要撒桃花）时返回 null，
   *  调用方据此不生成粒子 —— 由 _want 保证此时 want 也是 0。 */
  Fx.prototype._pickX = function (e, type) {
    var visW = e.visibleW(), x0 = e.view.x, x1 = x0 + visW;
    var segs = [], tot = 0, i;
    for (i = 0; i < S.SEASON_BANDS.length; i++) {
      var b = S.SEASON_BANDS[i], w = S.SEASON_FX[b.key][type];
      if (!w) continue;
      var lo = Math.max(x0, b.x0), hi = Math.min(x1, b.x1);
      if (hi <= lo) continue;
      segs.push({ lo: lo, hi: hi, w: w * (hi - lo) });
      tot += w * (hi - lo);
    }
    if (!segs.length) return null;
    var r = Math.random() * tot;
    for (i = 0; i < segs.length; i++) {
      r -= segs[i].w;
      if (r <= 0) return segs[i].lo + Math.random() * (segs[i].hi - segs[i].lo);
    }
    var last = segs[segs.length - 1];
    return last.lo + Math.random() * (last.hi - last.lo);
  };

  /** 某种天气在视口内的目标条数：各季按「可视宽度 ÷ REF_W」累加，
   *  超过一倍宽度就按一倍算（那一季已经整段在眼前，再加人只是浪费）。 */
  Fx.prototype._want = function (e, type) {
    var visW = e.visibleW(), x0 = e.view.x, x1 = x0 + visW, tot = 0;
    for (var i = 0; i < S.SEASON_BANDS.length; i++) {
      var b = S.SEASON_BANDS[i], w = S.SEASON_FX[b.key][type];
      if (!w) continue;
      var ov = Math.min(x1, b.x1) - Math.max(x0, b.x0);
      if (ov <= 0) continue;
      tot += w * Math.min(1, ov / REF_W);
    }
    return tot;
  };

  /** 视口内的平均雨量系数。雨量是沿 x 变的（夏盛冬疏），
   *  缩到整卷时视口里同时有 0.22 的冬雨和 1.40 的夏雨，
   *  只取一个数必然有一半是错的，所以取可见宽度上的均值。 */
  Fx.prototype._rainMulAvg = function (e) {
    if (!S.rainMulAt) return 1;
    var n = 16, x0 = e.view.x, visW = e.visibleW(), sum = 0;
    for (var i = 0; i < n; i++) sum += S.rainMulAt(x0 + visW * (i + 0.5) / n);
    return sum / n;
  };

  Fx.prototype.ripple = function (wx, wy) {
    if (this.ripples.length > 24) this.ripples.shift();
    this.ripples.push({ x: wx, y: wy, t: 0, ms: 0, r: 0 });
  };

  /* ---------------------------------------------------------------
   * 更新
   * ------------------------------------------------------------- */

  Fx.prototype.update = function (dt, e, state) {
    this.time += dt;
    this.alive.update(dt);
    if (state && state.alive !== undefined) this.alive.on = !!state.alive;

    if (state && state.mood) this.mood = state.mood;

    this.rainWanted = !!(state && state.rain);
    var wantRain = this.rainWanted ? 1 : 0;
    this.rainActive += (wantRain - this.rainActive) * Math.min(1, dt * 0.9);

    var visW = e.visibleW(), visH = e.visibleH();
    var x0 = e.view.x, x1 = e.view.x + visW, y0 = e.view.y, y1 = e.view.y + visH;

    /* --- 落花 / 落叶（世界锚定，按各自的世界 x 取季） --- */
    var wantPetals = Math.round(this._want(e, 'petals') * (1 - this.rainActive * 0.6));
    this._fit(this.petals, wantPetals, e, function () {
      var wx = this._pickX(e, 'petals');
      var p = this._spawnWorld(e, 60);
      var r = Math.random();
      return {
        x: wx, y: p.y - visH * 0.5,
        vy: 26 + r * 40, vx: -20 + Math.random() * 46,
        rot: Math.random() * 6.28, rv: (Math.random() - 0.5) * 2.4,
        sz: 2.6 + Math.random() * 3.4,
        ph: Math.random() * 6.28,
        pal: fxAt(wx).petalColor
      };
    }.bind(this));

    for (var i = this.petals.length - 1; i >= 0; i--) {
      var p = this.petals[i];
      p.ph += dt * (1.1 + p.sz * 0.11);
      p.x += (p.vx + Math.sin(p.ph) * 22) * dt;
      p.y += p.vy * dt;
      p.rot += p.rv * dt;
      if (p.y > y1 + 60 || p.x < x0 - 200 || p.x > x1 + 200) this.petals.splice(i, 1);
    }

    /* --- 雪（世界锚定。只有冬季带里才生成） --- */
    var wantSnow = Math.round(this._want(e, 'snow') * (1 - this.rainActive * 0.5));
    this._fit(this.snow, wantSnow, e, function () {
      var wx = this._pickX(e, 'snow');
      var p = this._spawnWorld(e, 60);
      var r = Math.random();
      return {
        x: wx, y: p.y - visH * 0.5,
        vy: 18 + r * 30, sz: 1.1 + r * 2.2,
        ph: Math.random() * 6.28, sp: 0.6 + r * 1.5
      };
    }.bind(this));

    for (var j = this.snow.length - 1; j >= 0; j--) {
      var s2 = this.snow[j];
      s2.ph += dt * s2.sp;
      s2.x += Math.sin(s2.ph) * 16 * dt + 6 * dt;
      s2.y += s2.vy * dt;
      if (s2.y > y1 + 60 || s2.x < x0 - 160 || s2.x > x1 + 160) this.snow.splice(j, 1);
    }

    /* --- 雨丝（世界锚定。雨落在每一季，只是各季的粗细疏密不同） ---
       240 是「标准雨量」的基准条数（夏雨 ≈336、冬雨 ≈53）。
       为什么从 190 提到 240：190 时夏雨峰值只有 266 条，铺在 1280×720 上
       约合每 4600 平方像素才一条，看上去仍是一场「稀雨」，撑不起「夏雨」。
       雨量倍率**存在每一滴雨自己身上**：缩到能同时看见夏与冬时，
       同一个视口里夏雨该比冬雨沉，用一个全局系数表达不了。 */
    this.rainMulAvg = this._rainMulAvg(e);
    var wantRainN = Math.round(this.rainActive * 240 * this.rainMulAvg);
    this._fit(this.rain, wantRainN, e, function () {
      /* 雨不分季带，整幅可视宽度上都可能下 */
      var wx = x0 - 80 + Math.random() * (visW + 160);
      var p = this._spawnWorld(e, 80);
      var r = Math.random();
      var mul = S.rainMulAt ? S.rainMulAt(wx) : 1;
      /* 世界单位的雨脚长度。大雨的雨脚本来就长，细雨的雨脚短而碎。 */
      var lenMul = 0.62 + 0.38 * Math.min(1.4, mul);
      return {
        x: wx, y: p.y - visH * 0.6,
        vy: 620 + r * 320, vx: -90 - r * 60,
        len: (18 + r * 26) * lenMul, a: 0.12 + r * 0.22, mul: mul
      };
    }.bind(this));

    for (var k = this.rain.length - 1; k >= 0; k--) {
      var rn = this.rain[k];
      rn.x += rn.vx * dt; rn.y += rn.vy * dt;
      if (rn.y > y1 + 40 || rn.x < x0 - 200) this.rain.splice(k, 1);
    }

    /* --- 涟漪 --- */
    for (var m = this.ripples.length - 1; m >= 0; m--) {
      var rp = this.ripples[m];
      rp.t += dt;
      if (rp.t > 1.9) this.ripples.splice(m, 1);
    }

    /* --- 飞鸟（世界锚定，沿可见区循环飞行；羽色取各自所在季） --- */
    var wantBirds = this._want(e, 'birds');
    this._fit(this.birds, Math.round(wantBirds), e, function (idx) {
      var wx = this._pickX(e, 'birds');
      if (wx === null) wx = x0 + Math.random() * visW;
      return {
        x: wx,
        y: y0 + 40 + Math.random() * (visH * 0.3),
        vx: 26 + Math.random() * 34,
        ph: Math.random() * 6.28,
        sz: 6 + Math.random() * 4,
        col: fxAt(wx).birdsColor,
        yBase: 0
      };
    }.bind(this));
    for (var b = 0; b < this.birds.length; b++) {
      var bd = this.birds[b];
      bd.ph += dt * 3.4;
      bd.x += bd.vx * dt;
      bd.y += (48 - bd.y) * dt * 0.2 + Math.sin(bd.ph * 0.35) * 6 * dt;
      if (bd.x > x1 + 220) bd.x = x0 - 200;
    }

    /* --- 云雾（屏幕锚定 + 视差）---
       位移与视差仍按屏幕走；但「有多浓」要问它脚下那片地的季节，
       问法见 draw()。 */
    for (var f = 0; f < this.fog.length; f++) {
      var fg = this.fog[f];
      fg.x += fg.s * 60 * dt * 10;
      if (fg.x > 2400) fg.x -= 2400;
    }
  };

  /** 把数组长度调整到 want，用 make(idx) 填充新元素 */
  Fx.prototype._fit = function (arr, want, e, make) {
    while (arr.length > want) arr.pop();
    var guard = 0;
    while (arr.length < want && guard++ < 200) arr.push(make(arr.length));
  };

  /* ---------------------------------------------------------------
   * 绘制
   * ------------------------------------------------------------- */

  Fx.prototype.draw = function (e) {
    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.vw, this.vh);

    var s = e.view.scale, vx = e.view.x, vy = e.view.y;
    var sx = function (wx) { return (wx - vx) * s; };
    var sy = function (wy) { return (wy - vy) * s; };

    /* 观察视距（纵向刚好满屏）—— 云雾的浓度与大小都以它为基准。
       概览时 s 只有它的 1/8.5，画面上却挤着整整一卷：
       同一团雾在屏幕上没有变小，相对内容却放大了 8 倍，
       不收敛就会把冬景那一带整片罩白。
       用开方而不是线性：中间视距（s≈0.36，眼前约两屏）只要轻收，
       收到 0.67 就够了；线性会给到 0.45，雾一下子就没了。 */
    var fit = this.vh / WORLD_H;
    var vis = U.clamp(Math.sqrt(s / fit), 0.34, 1);

    /* --- 云雾 --- */
    ctx.save();
    ctx.globalAlpha = 1;
    var spr = fogSprite();
    for (var i = 0; i < this.fog.length; i++) {
      var f = this.fog[i];
      var px = f.x - vx * f.par;
      px = ((px % 2400) + 2400) % 2400;
      px = px / 2400 * (this.vw + 900) - 450;
      var py = f.y * this.vh;
      var w = f.w * (0.55 + s * 0.55);
      /* 浓度问「这团雾脚下是哪一季」，不问视口中心：
         夏湿冬薄是地理属性，缩到整卷时不该由视口中心一个点决定。 */
      var wxFog = U.clamp(vx + (px + w * 0.5) / s, 0, WORLD_W - 1);
      var dens = fxAt(wxFog).fogDensity;
      ctx.globalAlpha = U.clamp(f.a * dens * (1 + this.rainActive * 0.7) * vis, 0, 0.28);
      ctx.drawImage(spr, px - w / 2, py - w * 0.28, w, w * 0.56);
    }
    ctx.restore();

    /* --- 灵动层：植被摆动 / 水面流动 / 人物行走 ---
       放在云雾之后：雾气是空气，该在树的前面；
       又放在落花雨雪之前：那些粒子最终要盖在一切之上。 */
    this.alive.draw(ctx, e);

    /* --- 飞鸟 --- */
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    for (var b = 0; b < this.birds.length; b++) {
      var bd = this.birds[b];
      var bx = sx(bd.x), by = sy(bd.y);
      if (bx < -60 || bx > this.vw + 60 || by < -60 || by > this.vh + 60) continue;
      var flap = Math.sin(bd.ph) * 0.55 + 0.45;
      /* 与雪粒同理：世界尺寸 × s，但托一个下限，
         否则概览时飞鸟只剩零点几个像素，等于没有。 */
      var sz = Math.max(bd.sz * s, 0.9);
      ctx.globalAlpha = 0.62;
      ctx.strokeStyle = bd.col || '#4A5B52';
      ctx.beginPath();
      ctx.moveTo(bx - sz, by + sz * flap * 0.5);
      ctx.quadraticCurveTo(bx - sz * 0.4, by - sz * flap * 0.7, bx, by);
      ctx.quadraticCurveTo(bx + sz * 0.4, by - sz * flap * 0.7, bx + sz, by + sz * flap * 0.5);
      ctx.stroke();
    }
    ctx.restore();

    /* --- 涟漪 --- */
    ctx.save();
    for (var m = 0; m < this.ripples.length; m++) {
      var rp = this.ripples[m];
      var t = rp.t / 1.9;
      var rr = (6 + t * 54) * s;
      ctx.globalAlpha = (1 - t) * 0.34;
      ctx.strokeStyle = '#4A443C';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(sx(rp.x), sy(rp.y), rr, rr * 0.30, 0, 0, 6.2832);
      ctx.stroke();
    }
    ctx.restore();

    /* --- 落花 / 落叶 --- */
    ctx.save();
    for (var p = 0; p < this.petals.length; p++) {
      var pe = this.petals[p];
      var pxx = sx(pe.x), pyy = sy(pe.y);
      if (pxx < -30 || pxx > this.vw + 30 || pyy < -30 || pyy > this.vh + 30) continue;
      ctx.save();
      ctx.translate(pxx, pyy);
      ctx.rotate(pe.rot);
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = pe.pal;
      /* 世界尺寸 × s；概览时托到 0.5px，否则花瓣也一起消失 */
      var w2 = Math.max(pe.sz * s, 0.5), h2 = w2 * 0.55;
      ctx.beginPath();
      ctx.ellipse(0, 0, w2, h2, 0, 0, 6.2832);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();

    /* --- 雪 ---
       半径 = 世界尺寸 × s（与飞鸟 / 落花同口径），再托一个 0.55px 的下限。
       下限是为概览准备的：s=0.094 时 1.1 单位的雪粒只剩 0.09px，
       整层雪会凭空消失，冬景遂退成一片没有雪的灰蓝。 */
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    for (var q = 0; q < this.snow.length; q++) {
      var sn = this.snow[q];
      var sxx = sx(sn.x), syy = sy(sn.y);
      if (sxx < -20 || sxx > this.vw + 20 || syy < -20 || syy > this.vh + 20) continue;
      ctx.globalAlpha = 0.28 + Math.sin(sn.ph) * 0.14;
      ctx.beginPath();
      ctx.arc(sxx, syy, Math.max(sn.sz * s * 0.62, 0.55), 0, 6.2832);
      ctx.fill();
    }
    ctx.restore();

    /* --- 雨 ---
       雨丝的长度与粗细一律「世界尺寸 × s」，与飞鸟 / 雪粒同口径。
       从前这两样都写成了固定屏幕像素：默认视距（s=0.8）看着正常，
       缩到概览（s=0.094）就变成 1.4px 宽、40px 长的巨条 ——
       实测一条雨丝横跨 8.6 倍画卷高度，整幅画糊成一片灰。 */
    if (this.rainActive > 0.01) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#5B6570';
      for (var r = 0; r < this.rain.length; r++) {
        var rn = this.rain[r];
        var rx = sx(rn.x), ry = sy(rn.y);
        if (rx < -40 || rx > this.vw + 40 || ry < -40 || ry > this.vh + 40) continue;
        /* 雨量倍率取自这滴雨自己所在的世界 x：夏雨 1.4 → 更粗更实，
           冬雨 0.22 → 更细更淡。归一在 1.0 上，标准雨量下观感不变。 */
        var rm = Math.min(1.4, rn.mul || 1);
        ctx.lineWidth = Math.max(0.55, (1.20 + 0.36 * rm) * s);
        ctx.globalAlpha = Math.min(0.58, rn.a * this.rainActive * (0.55 + 0.45 * rm));
        /* 雨脚朝速度的反方向斜，斜率直接由 vx/vy 给出，
           不再用一个与视距无关的魔数 0.022。 */
        var k2 = rn.len * s;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + (rn.vx / rn.vy) * k2, ry + k2);
        ctx.stroke();
      }
      ctx.restore();
    }

    /* --- 天光 --- */
    this._drawMood(ctx, e);

    /* --- 雨天的湿润灰调 ---
       全屏的灰纱。这是「整片空气都湿了」的表达，按屏幕面积计，不随视距缩；
       但浓度要收着 —— 0.16+0.10 那两笔实测把整幅画面平均压暗 19%，
       冬景本来就淡，一压就「颜色被盖住」了。 */
    if (this.rainActive > 0.01) {
      ctx.save();
      ctx.globalAlpha = 0.12 * this.rainActive;
      ctx.fillStyle = '#8A93A0';
      ctx.fillRect(0, 0, this.vw, this.vh);
      ctx.globalAlpha = 0.07 * this.rainActive;
      ctx.fillStyle = '#5E6672';
      ctx.fillRect(0, 0, this.vw, this.vh * 0.4);
      ctx.restore();
    }
  };

  /** 晨 / 午 / 暮 三档天光。刻意保持明亮，不用暗色压画面；
   *  但浓度也不能高——超过 0.25 就会盖掉墨色的层次，整卷变成一张色纸。 */
  Fx.prototype._drawMood = function (ctx, e) {
    var m = this.mood;
    if (!m || m === 'noon') return;
    ctx.save();
    if (m === 'dawn') {
      var g = ctx.createLinearGradient(0, 0, this.vw * 0.7, this.vh);
      g.addColorStop(0, 'rgba(255,215,155,0.22)');
      g.addColorStop(0.45, 'rgba(255,228,190,0.09)');
      g.addColorStop(1, 'rgba(255,240,215,0.03)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.vw, this.vh);
    } else if (m === 'dusk') {
      var g2 = ctx.createLinearGradient(0, 0, this.vw, this.vh);
      g2.addColorStop(0, 'rgba(255,176,104,0.22)');
      g2.addColorStop(0.5, 'rgba(255,146,80,0.11)');
      g2.addColorStop(1, 'rgba(212,120,64,0.15)');
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, this.vw, this.vh);
    }
    ctx.restore();
  };

  global.Fx = Fx;
})(typeof window !== 'undefined' ? window : globalThis);
