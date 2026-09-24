/*!
 * scroll.js —— 卷轴引擎
 *
 * 职责：
 *   1. 视口（世界坐标 ↔ 屏幕坐标）与惯性漫游
 *   2. 分块惰性渲染：只渲染视口附近的块，LRU 回收
 *   3. 渐进清晰化：先用一份低清「预渲染带」铺满，再逐块换成高清
 *
 * 长卷为 12000 × 900，纵横比约 13:1，因此纵向永不切块，
 * 只沿横向切成若干 1000 宽的条块。
 */
(function (global) {
  'use strict';
  var U = global.U, S = global.SceneData, Painter = global.Painter;

  var WORLD_W = S.WORLD_W, WORLD_H = S.WORLD_H;

  var TILE_W = 1000;          // 每块宽（世界单位）
  var TILE_Q = 1.2;           // 块内渲染倍率（>1 以提高放大后的清晰度）
  var TILE_PAD = 24;          // 每块左右各多画一圈，消除拼接处的抗锯齿缝
  var MAX_TILES = 6;          // 高清块缓存上限
  var RUBBER = 110;           // 橡皮筋回弹余量（屏幕像素）
  var PV_MAXPX = 4200;        // 低清预览带的画布宽度上限（像素）

  function Engine(opts) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.vw = 0; this.vh = 0;

    this.view = { x: 0, y: 0, scale: 1 };
    this.vel = { x: 0, y: 0 };
    this.dragging = false;

    this.minScale = 0.1;
    this.maxScale = 2.8;
    this.minScaleLive = 0.1;

    this.tiles = U.LRU(MAX_TILES);
    this.queue = [];
    this._queued = Object.create(null);

    this.pv = { x: 0, w: 0, scale: 0.3, canvas: null, dirty: true };

    this.focusAnim = null;
    this.scaleAnim = null;

    this.onStats = opts.onStats || function () {};
    this.stats = { tiles: 0, previewMs: 0, tileMs: 0, fps: 0 };

    this._resize();
    this._resetView();
  }

  /* ---------------------------------------------------------------
   * 尺寸与视口
   * ------------------------------------------------------------- */

  Engine.prototype._resize = function () {
    var r = this.canvas.getBoundingClientRect();
    this.vw = Math.max(320, r.width);
    this.vh = Math.max(240, r.height);
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);

    /* 概览缩放下整幅长卷刚好装进视口；观察缩放下纵向满屏 */
    this.overviewScale = Math.min(this.vw / WORLD_W, this.vh / WORLD_H) * 0.88;
    this.fitHeightScale = this.vh / WORLD_H;
    this.minScale = this.overviewScale;
    this.maxScale = Math.max(2.8, this.fitHeightScale * 2.6);

    this.pv.scale = U.clamp(this.fitHeightScale * 0.38, 0.16, 0.46);
    this.pv.dirty = true;
    this.tiles.clear();
    this.queue.length = 0;
    this._queued = Object.create(null);
  };

  Engine.prototype.resize = function () {
    var oldFit = this.fitHeightScale;
    var ratio = this.view.scale / oldFit;
    this._resize();
    this.view.scale = this.fitHeightScale * ratio;
    this._clamp(true);
  };

  Engine.prototype._resetView = function () {
    this.view.scale = this.fitHeightScale;
    this.view.x = 0;
    this.view.y = 0;
    this._clamp(true);
  };

  Engine.prototype.visibleW = function () { return this.vw / this.view.scale; };
  Engine.prototype.visibleH = function () { return this.vh / this.view.scale; };

  /** 边界约束。soft=true 时允许橡皮筋越界一段。 */
  Engine.prototype._clamp = function (hard) {
    var ww = this.visibleW(), wh = this.visibleH();
    var slack = hard ? 0 : RUBBER / this.view.scale;

    if (ww >= WORLD_W) this.view.x = (WORLD_W - ww) / 2;
    else {
      var lo = -slack, hi = WORLD_W - ww + slack;
      if (this.view.x < lo) this.view.x = lo;
      if (this.view.x > hi) this.view.x = hi;
    }

    if (wh >= WORLD_H) this.view.y = (WORLD_H - wh) / 2;
    else {
      var lo2 = -slack, hi2 = WORLD_H - wh + slack;
      if (this.view.y < lo2) this.view.y = lo2;
      if (this.view.y > hi2) this.view.y = hi2;
    }
  };

  /* 坐标换算 */
  Engine.prototype.screenToWorld = function (sx, sy) {
    return { x: this.view.x + sx / this.view.scale, y: this.view.y + sy / this.view.scale };
  };
  Engine.prototype.worldToScreen = function (wx, wy) {
    return { x: (wx - this.view.x) * this.view.scale, y: (wy - this.view.y) * this.view.scale };
  };

  /* ---------------------------------------------------------------
   * 交互
   * ------------------------------------------------------------- */

  Engine.prototype.beginDrag = function () {
    this.dragging = true;
    this.vel.x = 0; this.vel.y = 0;
    this.focusAnim = null;
  };

  Engine.prototype.dragBy = function (dxScreen, dyScreen) {
    this.view.x -= dxScreen / this.view.scale;
    this.view.y -= dyScreen / this.view.scale;
    this._clamp(false);
  };

  /** 以屏幕上某点为锚点缩放（滚轮 / Ctrl+滚轮 / 双指） */
  Engine.prototype.zoomAt = function (factor, sx, sy, animate) {
    var w = this.screenToWorld(sx, sy);
    var target = U.clamp(this.view.scale * factor, this.minScale, this.maxScale);
    if (animate) {
      this.scaleAnim = { from: this.view.scale, to: target, t: 0, dur: 0.24, ax: w.x, ay: w.y, sx: sx, sy: sy };
    } else {
      this.view.scale = target;
      this.view.x = w.x - sx / this.view.scale;
      this.view.y = w.y - sy / this.view.scale;
    }
    this._clamp(true);
    this.pv.dirty = true;
  };

  Engine.prototype.endDrag = function () {
    this.dragging = false;
    this._clamp(false);
  };

  /** 甩动速度（世界单位/秒） */
  Engine.prototype.fling = function (vx, vy) {
    this.vel.x = vx; this.vel.y = vy;
  };

  /** 对焦动画的目标位置。
   *
   *  这里必须显式处理「视口比画卷还宽／高」的情况（概览缩放一定会遇到）：
   *  此时唯一的合理目标就是**居中**。若图省事写成
   *      clamp(wx - vw/2/s, 0, max(0, WORLD_W - vw/s))
   *  那么 max(...) 为负、被夹成 0，于是整段动画里画卷都贴在顶边，
   *  直到动画结束 _clamp(true) 才「啪」地跳到中间——一次肉眼可见的弹跳。 */
  Engine.prototype._targetX = function (wx, s) {
    var ww = this.vw / s;
    if (ww >= WORLD_W) return (WORLD_W - ww) / 2;
    return U.clamp(wx - this.vw / 2 / s, 0, WORLD_W - ww);
  };
  Engine.prototype._targetY = function (wy, s, bias) {
    var wh = this.vh / s;
    if (wh >= WORLD_H) return (WORLD_H - wh) / 2;
    return U.clamp(wy - this.vh * (bias === undefined ? 0.56 : bias) / s, 0, WORLD_H - wh);
  };

  /** 双击对焦：把世界坐标点平滑推到视口中心并放大 */
  Engine.prototype.focusOn = function (wx, wy, targetScale, dur) {
    var s = U.clamp(targetScale || this.view.scale * 2.0, this.minScale, this.maxScale);
    this.focusAnim = {
      t: 0, dur: dur || 0.85,
      fromX: this.view.x, fromY: this.view.y, fromS: this.view.scale,
      /* 纵向偏下一点：给上方留出题跋空间 */
      toX: this._targetX(wx, s), toY: this._targetY(wy, s, 0.56), toS: s
    };
    this.vel.x = 0; this.vel.y = 0;
  };

  Engine.prototype.isOverview = function () {
    return this.view.scale < this.fitHeightScale * 0.94;
  };

  /* ---------------------------------------------------------------
   * 预渲染带（低清占位）
   * ------------------------------------------------------------- */

  Engine.prototype._ensurePreview = function (force) {
    var visibleW = this.visibleW();
    var PAD = TILE_PAD;
    var pv = this.pv;

    /* 预览带必须覆盖视口宽度，而画布宽度有上限，
       所以分辨率要随「需要覆盖的宽度」自适应。
       分辨率量化到 2 的整数次幂（且向下取），
       否则缩放动画中每帧都会算出新比例，预览带被无休止重建。 */
    var needW = Math.max(visibleW * 1.9, 1400);
    var ps = Math.min(this.fitHeightScale * 0.38, (PV_MAXPX - PAD * 2) / needW);
    ps = U.clamp(Math.pow(2, Math.floor(Math.log(ps) / Math.LN2)), 0.03125, 0.5);

    /* 按量化后的比例反算真正能画下的宽度。
       必须做这一步：若绘制范围大于画布能装下的范围，
       画布上只有一部分内容，而 pv.w 却记着完整宽度，
       概览模式下整卷就会只剩左边一截。 */
    var wantW = Math.min(needW, (PV_MAXPX - PAD * 2) / ps);
    if (wantW < visibleW) wantW = visibleW;
    var wantX = this.view.x - (wantW - visibleW) / 2;

    var need = force || !pv.canvas || pv.dirty || pv.scale !== ps;
    if (!need) {
      if (wantX < pv.x - 4 || wantX + wantW > pv.x + pv.w + 4) need = true;
      if (this.view.x < pv.x - 4 || this.view.x + visibleW > pv.x + pv.w + 4) need = true;
    }
    if (!need) return;

    pv.scale = ps;
    var wpx = Math.ceil((wantW + PAD * 2) * ps), hpx = Math.ceil(WORLD_H * ps);
    var cv = U.makeCanvas(wpx, hpx);
    var c = cv.getContext('2d');
    var t0 = (global.performance || Date).now();
    c.scale(ps, ps);
    c.translate(PAD, 0);
    Painter.paint(c, wantX, 0, wantW, WORLD_H, { detail: false, pad: PAD });

    pv.x = wantX; pv.w = wantW; pv.canvas = cv; pv.dirty = false;
    this.stats.previewMs = Math.round(((global.performance || Date).now() - t0));
  };

  /* ---------------------------------------------------------------
   * 分块高清
   * ------------------------------------------------------------- */

  Engine.prototype._tileKey = function (i) { return i; };

  Engine.prototype._buildTile = function (i) {
    var wx = i * TILE_W;
    var q = TILE_Q, PAD = TILE_PAD;
    /* 画布比块本身宽出两侧 PAD，并平移，使「世界 wx」落在画布的 PAD*q 处。
       这样边缘那一列像素是「有完整上下文」的，与邻块拼接时不留缝。 */
    var cv = U.makeCanvas((TILE_W + PAD * 2) * q, WORLD_H * q);
    var c = cv.getContext('2d');
    c.scale(q, q);
    c.translate(PAD, 0);
    Painter.paint(c, wx, 0, TILE_W, WORLD_H, { detail: true, pad: PAD });
    return cv;
  };

  /** 依据视口决定需要哪些块，并把缺失的排进队列（近的优先） */
  Engine.prototype._scheduleTiles = function () {
    var visibleW = this.visibleW();
    var x0 = this.view.x - visibleW * 0.35;
    var x1 = this.view.x + visibleW * 1.35;
    var i0 = Math.max(0, Math.floor(x0 / TILE_W));
    var i1 = Math.min(Math.ceil(WORLD_W / TILE_W) - 1, Math.floor(x1 / TILE_W));

    /* 需要的块数超过缓存上限时，改用低清预览带。
       注意判据是「实际要几块」而不是「缩放比例是否小于某阈值」——
       后者会让稍远的视距也能铺高清，却在临界点突然掉到低清，
       出现一道明显的清晰度断层。 */
    if (i1 - i0 + 1 > MAX_TILES) { this.queue = []; return; }

    var cx = this.view.x + visibleW / 2;
    var want = [];
    for (var i = i0; i <= i1; i++) {
      if (this.tiles.has(i)) continue;
      want.push(i);
    }
    want.sort(function (a, b) {
      return Math.abs((a + 0.5) * TILE_W - cx) - Math.abs((b + 0.5) * TILE_W - cx);
    });
    this.queue = want;
    this._queued = Object.create(null);
    for (var k = 0; k < want.length; k++) this._queued[want[k]] = true;
  };

  /** 每帧在时间预算内渲染块 */
  Engine.prototype._workTiles = function (budgetMs) {
    if (!this.queue.length) return;
    var t0 = (global.performance || Date).now();
    var work = 0;
    while (this.queue.length && work < budgetMs) {
      var i = this.queue.shift();
      if (this.tiles.has(i)) continue;
      var s = (global.performance || Date).now();
      var cv = this._buildTile(i);
      this.tiles.set(this._tileKey(i), cv);
      var cost = (global.performance || Date).now() - s;
      this.stats.tileMs = Math.round(cost);
      work += cost;
    }
    this.stats.tiles = this.tiles.size;
  };

  /* ---------------------------------------------------------------
   * 每帧更新
   * ------------------------------------------------------------- */

  Engine.prototype.update = function (dtMs) {
    var dt = Math.min(dtMs, 60) / 1000;
    var v = this.view;

    /* 对焦动画 */
    if (this.focusAnim) {
      var f = this.focusAnim;
      f.t = Math.min(1, f.t + dt / f.dur);
      var e = U.Ease.inOutCubic(f.t);
      v.x = U.lerp(f.fromX, f.toX, e);
      v.y = U.lerp(f.fromY, f.toY, e);
      v.scale = U.lerp(f.fromS, f.toS, e);
      if (f.t >= 1) { this.focusAnim = null; this._clamp(true); this.pv.dirty = true; }
      this._ensurePreview(false);
      this._scheduleTiles();
      return;
    }

    /* 缩放动画 */
    if (this.scaleAnim) {
      var sa = this.scaleAnim;
      sa.t = Math.min(1, sa.t + dt / sa.dur);
      var e2 = U.Ease.outCubic(sa.t);
      v.scale = U.lerp(sa.from, sa.to, e2);
      v.x = sa.ax - sa.sx / v.scale;
      v.y = sa.ay - sa.sy / v.scale;
      if (sa.t >= 1) { this.scaleAnim = null; this._clamp(true); this.pv.dirty = true; }
      this._clamp(false);
      this._ensurePreview(false);
      return;
    }

    /* 惯性漫游 */
    if (!this.dragging) {
      var sp = Math.hypot(this.vel.x, this.vel.y);
      if (sp > 1) {
        v.x += this.vel.x * dt;
        v.y += this.vel.y * dt;
        var k = Math.pow(0.0009, dt);
        this.vel.x *= k; this.vel.y *= k;
        if (Math.hypot(this.vel.x, this.vel.y) < 3) { this.vel.x = 0; this.vel.y = 0; }
      } else if (sp > 0) {
        this.vel.x = 0; this.vel.y = 0;
      }
      /* 越界回弹 */
      var ww = this.visibleW(), wh = this.visibleH();
      var ox = 0, oy = 0;
      if (ww < WORLD_W) {
        if (v.x < 0) ox = -v.x; else if (v.x > WORLD_W - ww) ox = WORLD_W - ww - v.x;
      }
      if (wh < WORLD_H) {
        if (v.y < 0) oy = -v.y; else if (v.y > WORLD_H - wh) oy = WORLD_H - wh - v.y;
      }
      if (ox || oy) {
        v.x += ox * (1 - Math.exp(-9 * dt));
        v.y += oy * (1 - Math.exp(-9 * dt));
      }
    }

    this._clamp(false);
    this._ensurePreview(false);
    this._scheduleTiles();
  };

  /* ---------------------------------------------------------------
   * 绘制
   * ------------------------------------------------------------- */

  Engine.prototype.draw = function (mount) {
    var ctx = this.ctx, v = this.view;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    /* 装裱底色（概览缩放下画卷之外露出的部分） */
    ctx.fillStyle = mount || '#2A2622';
    ctx.fillRect(0, 0, this.vw, this.vh);

    var s = v.scale;
    var visW = this.visibleW();

    /* 1) 低清预渲染带 —— 保证任何时刻画面都有内容 */
    var pv = this.pv;
    if (pv.canvas) {
      var padW = TILE_PAD;
      var srcX = (v.x - pv.x + padW) * pv.scale;
      var srcW = visW * pv.scale;
      var sw = pv.canvas.width, sh = pv.canvas.height;
      var cx0 = U.clamp(srcX, 0, sw), cx1 = U.clamp(srcX + srcW, 0, sw);
      if (cx1 > cx0) {
        var dstX = (pv.x - padW + cx0 / pv.scale - v.x) * s;
        var dstW = (cx1 - cx0) / pv.scale * s;
        ctx.drawImage(pv.canvas,
          cx0, 0, cx1 - cx0, sh,
          dstX, -v.y * s, dstW, WORLD_H * s);
      }
    } else {
      /* 预渲染带尚未生成时，先用纯绢色垫底，避免白屏 */
      var pal = S.paletteAt(v.x + visW / 2);
      ctx.fillStyle = U.rgb(pal.silk);
      ctx.fillRect((0 - v.x) * s, (0 - v.y) * s, WORLD_W * s, WORLD_H * s);
    }

    /* 2) 已就绪的高清块，逐一覆盖上去。
       但只有在「视口能靠块填满」时才铺——即所需块数不超过 MAX_TILES。
       概览时视口宽度远超 MAX_TILES*TILE_W，此时若有几块是缩放动画途中
       顺手建好的高清块留在缓存里，它们就会被叠在预览带上：两种渲染
       的内容并不完全一致（detail 不同），接缝处立刻露出错位与色阶。
       宁可整幅退回预览带，也不要一半高清一半低清。 */
    if (Math.ceil(this.visibleW() / TILE_W) + 1 <= MAX_TILES) {
      var it = this.tiles.keys();
      var keys = [];
      while (true) { var r = it.next(); if (r.done) break; keys.push(r.value); }
      keys.sort(function (a, b) { return a - b; });
      for (var k = 0; k < keys.length; k++) {
        var i = keys[k];
        var cv = this.tiles.peek(i);
        if (!cv) continue;
        var wx0 = i * TILE_W;
        var wx1 = Math.min(wx0 + TILE_W, WORLD_W);
        if ((wx1 - v.x) * s < -2 || (wx0 - v.x) * s > this.vw + 2) continue;
        var dx = (wx0 - v.x) * s;
        /* 两个分片之间留极小的重叠，抵消浮点取整产生的一像素缝 */
        var dw = (wx1 - wx0) * s + 0.7;
        /* 只取画布中间那一块（两侧的 PAD 是给边缘像素留的上下文，不显示） */
        ctx.drawImage(cv, TILE_PAD * TILE_Q, 0, (wx1 - wx0) * TILE_Q, cv.height,
          dx, -v.y * s, dw, WORLD_H * s + 0.7);
      }
    }

    /* 3) 尚未就绪的块的边框提示（非常淡，仅用于示意「正在显影」） */
    if (this.queue.length) {
      ctx.save();
      ctx.globalAlpha = 0.05;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      for (var q = 0; q < this.queue.length; q++) {
        var qi = this.queue[q];
        var qx0 = qi * TILE_W;
        ctx.strokeRect((qx0 - v.x) * s, -v.y * s, TILE_W * s, WORLD_H * s);
      }
      ctx.restore();
    }
  };

  /** 主循环入口：更新 + 绘制 + 逐块渲染 */
  Engine.prototype.frame = function (dtMs, mount, tileBudget) {
    this.update(dtMs);
    this.draw(mount);
    this._workTiles(tileBudget === undefined ? 7 : tileBudget);
  };

  /* ---------------------------------------------------------------
   * 便捷操作
   * ------------------------------------------------------------- */

  Engine.prototype.goTo = function (wx, opts) {
    opts = opts || {};
    var dur = opts.dur === undefined ? 0.9 : opts.dur;
    var s = opts.scale || this.view.scale;
    s = U.clamp(s, this.minScale, this.maxScale);
    /* 纵向保持不动；但概览缩放下视口比画卷高，同样要居中 */
    var toY = (this.vh / s >= WORLD_H)
      ? (WORLD_H - this.vh / s) / 2
      : U.clamp(this.view.y, 0, WORLD_H - this.vh / s);
    this.focusAnim = {
      t: 0, dur: dur,
      fromX: this.view.x, fromY: this.view.y, fromS: this.view.scale,
      toX: this._targetX(wx, s), toY: toY, toS: s
    };
    this.vel.x = 0; this.vel.y = 0;
  };

  Engine.prototype.overview = function () {
    this.focusAnim = null;
    this.goTo(this.view.x + this.visibleW() / 2, { scale: this.overviewScale, dur: 0.8 });
  };

  Engine.prototype.fitHeight = function () {
    this.focusAnim = null;
    this.goTo(this.view.x + this.visibleW() / 2, { scale: this.fitHeightScale, dur: 0.7 });
  };

  Engine.prototype.progress = function () {
    var ww = this.visibleW();
    var denom = WORLD_W - ww;
    if (denom <= 0) return 0;
    return U.clamp(this.view.x / denom, 0, 1);
  };

  Engine.prototype.seek = function (p, dur) {
    var ww = this.visibleW();
    this.goTo(p * Math.max(0, WORLD_W - ww) + ww / 2, { dur: dur === undefined ? 0.7 : dur });
  };

  Engine.TILE_W = TILE_W;
  global.Scroll = { Engine: Engine, TILE_W: TILE_W };
})(typeof window !== 'undefined' ? window : globalThis);
