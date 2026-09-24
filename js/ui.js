/*!
 * ui.js —— 界面层
 *
 * 题跋卡片、迷你地图、季节徽章、进度、控制按钮。
 * DOM 更新降频到 ~12 Hz，避免每帧触发布局。
 */
(function (global) {
  'use strict';
  var U = global.U, S = global.SceneData;

  var WORLD_W = S.WORLD_W, WORLD_H = S.WORLD_H;

  var engine = null, fx = null, cb = {};
  var el = {};
  var minimapReady = false;
  var lastSeasonKey = null;
  var lastPct = -1;

  function $(id) { return document.getElementById(id); }

  /* ---------------------------------------------------------------
   * 迷你地图
   * ------------------------------------------------------------- */

  function buildMinimap() {
    var cv = el.miniCanvas;
    var box = el.minimap.getBoundingClientRect();
    var cssW = Math.max(200, box.width || 900);
    var cssH = Math.max(30, box.height || 42);

    /* 长卷 13:1，缩略图按容器宽铺满，高度自适应并居中 */
    var scale = cssW / WORLD_W;
    var h = Math.max(24, WORLD_H * scale);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    cv.width = Math.round(cssW * dpr);
    cv.height = Math.round(cssH * dpr);
    var c = cv.getContext('2d');
    c.scale(dpr, dpr);

    var drawH = Math.min(h, cssH);
    var offY = (cssH - drawH) / 2;
    var s2 = drawH / WORLD_H;

    c.save();
    c.translate(0, offY);
    c.scale(s2, s2);
    global.Painter.paint(c, 0, 0, WORLD_W, WORLD_H, { detail: false, step: 18 });
    c.restore();

    minimapReady = true;
    el.miniMapScale = s2;
    el.miniOffsetY = offY;
  }

  function buildMarks() {
    if (!minimapReady) return;
    el.miniMarks.innerHTML = '';
    S.INSCRIPTIONS.forEach(function (ins, i) {
      var d = document.createElement('div');
      d.className = 'mini-mark';
      d.style.left = (ins.x / WORLD_W * 100) + '%';
      d.title = ins.title;
      d.addEventListener('click', function (ev) {
        ev.stopPropagation();
        selectInscription(i, true);
      });
      el.miniMarks.appendChild(d);
    });
  }

  /** 迷你地图上的四时色带 */
  function drawSeasonBands() {
    var cv = el.miniCanvas;
    var c = cv.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.width / dpr, h = cv.height / dpr;
    c.save();
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.globalCompositeOperation = 'multiply';
    S.SEASON_BANDS.forEach(function (b) {
      c.fillStyle = U.rgba(S.paletteAt((b.x0 + b.x1) / 2).mid, 0.16);
      c.fillRect(b.x0 / WORLD_W * w, 0, (b.x1 - b.x0) / WORLD_W * w, h);
    });
    c.restore();
  }

  function updateViewportBox() {
    if (!minimapReady) return;
    var box = el.minimap.getBoundingClientRect();
    var p = engine.progress();
    var visFrac = Math.min(1, engine.visibleW() / WORLD_W);
    var w = Math.max(2, visFrac * box.width);
    /* 用 view.x 直接换算，比 progress 更贴合（概览缩小时也能正确显示） */
    var denom = WORLD_W - engine.visibleW();
    var left = denom > 0 ? (engine.view.x / denom) * (box.width - w) : 0;
    left = U.clamp(left, 0, Math.max(0, box.width - w));
    el.miniViewport.style.cssText =
      'left:' + left + 'px;width:' + w + 'px;';
  }

  /* ---------------------------------------------------------------
   * 题跋
   * ------------------------------------------------------------- */

  var curIdx = -1;

  function selectInscription(i, fly) {
    var ins = S.INSCRIPTIONS[i];
    if (!ins) return;
    curIdx = i;
    el.cardSeal.textContent = ins.seal;
    el.cardTitle.textContent = ins.title;
    /* 每句一个 span，交给 flex row-reverse 排成「首句在最右」的竖排 */
    el.cardVerses.innerHTML = ins.lines.map(function (l) {
      return '<span>' + String(l).replace(/[&<>"]/g, function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
      }) + '</span>';
    }).join('');
    el.cardBy.textContent = ins.by;
    el.card.classList.add('show');
    el.card.setAttribute('aria-hidden', 'false');
    if (fly) engine.goTo(ins.x, { scale: Math.max(engine.view.scale, engine.fitHeightScale * 1.25), dur: 0.95 });
  }

  function hideCard() {
    el.card.classList.remove('show');
    el.card.setAttribute('aria-hidden', 'true');
    curIdx = -1;
  }

  /** 找出离视口中心最近的题跋 */
  function nearestInscription() {
    if (!S.INSCRIPTIONS.length) return -1;
    var c = engine.view.x + engine.visibleW() / 2;
    var best = 0, bd = Infinity;
    for (var i = 0; i < S.INSCRIPTIONS.length; i++) {
      var d = Math.abs(S.INSCRIPTIONS[i].x - c);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* ---------------------------------------------------------------
   * 周期更新（约 12 Hz）
   * ------------------------------------------------------------- */

  var acc = 0;
  function tick(dt) {
    acc += dt;
    if (acc < 1 / 12) return;
    acc = 0;
    if (!engine) return;

    /* 进度 */
    var pct = Math.round(engine.progress() * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      el.progFill.style.width = pct + '%';
      el.progNum.textContent = pct + '%';
    }
    updateViewportBox();

    /* 季节徽章 */
    var season = S.seasonAt(engine.view.x + engine.visibleW() / 2);
    if (season.key !== lastSeasonKey) {
      lastSeasonKey = season.key;
      el.seasonName.textContent = season.name;
      el.seasonMotto.textContent = season.motto;
      el.seasonBadge.classList.add('pop');
      setTimeout(function () { el.seasonBadge.classList.remove('pop'); }, 420);
    }
  }

  /* ---------------------------------------------------------------
   * 装载
   * ------------------------------------------------------------- */

  function init(e, f, callbacks) {
    engine = e; fx = f; cb = callbacks || {};

    el = {
      minimap: $('minimap'),
      miniCanvas: $('minimap-canvas'),
      miniViewport: $('mini-viewport'),
      miniMarks: $('mini-marks'),
      card: $('card'),
      cardSeal: $('card-seal'),
      cardTitle: $('card-title'),
      cardVerses: $('card-verses'),
      cardBy: $('card-by'),
      cardClose: $('card-close'),
      seasonBadge: $('season-badge'),
      seasonName: document.querySelector('.season-name'),
      seasonMotto: document.querySelector('.season-motto'),
      progFill: $('prog-fill'),
      progNum: $('prog-num'),
      hint: $('hint'),
      tourIco: $('tour-ico'),
      tourLabel: $('tour-label'),
      btnTour: $('btn-tour'),
      moodTxt: $('mood-txt'),
      btnRain: $('btn-rain'),
      btnMood: $('btn-mood'),
      btnOverview: $('btn-overview'),
      btnAlive: $('btn-alive'),
      intro: $('intro'),
      introGo: $('intro-go'),
      loading: $('loading')
    };

    buildMinimap();
    drawSeasonBands();
    buildMarks();

    /* —— 事件绑定 —— */
    el.cardClose.addEventListener('click', hideCard);

    el.minimap.addEventListener('click', function (ev) {
      var r = el.minimap.getBoundingClientRect();
      var t = U.clamp((ev.clientX - r.left) / r.width, 0, 1);
      engine.seek(t, 0.6);
    });

    el.minimap.addEventListener('keydown', function (ev) {
      var step = 0.05;
      if (ev.key === 'ArrowLeft') { engine.seek(U.clamp(engine.progress() - step, 0, 1), 0.35); ev.preventDefault(); }
      if (ev.key === 'ArrowRight') { engine.seek(U.clamp(engine.progress() + step, 0, 1), 0.35); ev.preventDefault(); }
    });

    $('btn-first').addEventListener('click', function () { engine.seek(0, 1.0); });
    $('btn-last').addEventListener('click', function () { engine.seek(1, 1.4); });
    $('btn-prev').addEventListener('click', function () { stepScene(-1); });
    $('btn-next').addEventListener('click', function () { stepScene(1); });

    el.btnTour.addEventListener('click', function () { cb.onTour && cb.onTour(); });

    el.btnOverview.addEventListener('click', function () {
      if (engine.isOverview()) engine.fitHeight();
      else engine.overview();
      syncOverviewBtn();
    });

    el.btnRain.addEventListener('click', function () {
      var on = cb.onRain && cb.onRain();
      el.btnRain.classList.toggle('on', !!on);
    });

    el.btnMood.addEventListener('click', function () {
      var m = cb.onMood && cb.onMood();
      var map = { noon: '午', dawn: '晨', dusk: '暮' };
      el.moodTxt.textContent = map[m] || '午';
      el.btnMood.classList.toggle('on', m !== 'noon');
    });

    $('btn-rand').addEventListener('click', function () {
      var x = 200 + Math.random() * (WORLD_W - 900);
      engine.goTo(x, { scale: engine.fitHeightScale * (1 + Math.random() * 0.5), dur: 1.25 });
    });

    /* 「灵动」开关：默认开。掉帧的机器上可以关掉，立刻回到纯静态长卷 */
    if (el.btnAlive) {
      el.btnAlive.addEventListener('click', function () {
        var on = cb.onAlive && cb.onAlive();
        syncAliveBtn(!!on);
      });
    }

    /* 切到题跋：直接给最近的 */
    global.addEventListener('keydown', function (ev) {
      if (ev.key === 'i' || ev.key === 'I') {
        var i = nearestInscription();
        if (i >= 0) { if (curIdx === i) hideCard(); else selectInscription(i, true); }
      }
    });
  }

  /** 跳到下一/上一景（按题跋节点） */
  function stepScene(dir) {
    var c = engine.view.x + engine.visibleW() / 2;
    var list = S.INSCRIPTIONS;
    var target = null;
    for (var i = 0; i < list.length; i++) {
      if (dir > 0 && list[i].x > c + 220) { target = list[i]; break; }
      if (dir < 0 && list[i].x < c - 220) { target = list[i]; }
    }
    if (!target) engine.seek(dir > 0 ? 1 : 0, 1.2);
    else engine.goTo(target.x, { scale: Math.max(engine.view.scale, engine.fitHeightScale * 1.15), dur: 1.05 });
  }

  function syncOverviewBtn() {
    el.btnOverview.classList.toggle('on', engine.isOverview());
  }

  /** 灵动开关的视觉：开着不强调（它本来就是默认），关掉才显眼 */
  function syncAliveBtn(on) {
    if (!el.btnAlive) return;
    el.btnAlive.classList.toggle('off', !on);
    el.btnAlive.title = on
      ? '灵动：人物行走 / 水流动 / 树随风（A）—— 点击关闭'
      : '灵动已关闭，画面回到静态长卷（A）—— 点击开启';
  }

  function setTour(running) {
    el.btnTour.classList.toggle('running', running);
    el.tourIco.textContent = running ? '❚❚' : '▶';
    if (el.tourLabel) el.tourLabel.textContent = running ? '漫游中' : '自动漫游';
    el.btnTour.title = running ? '暂停漫游（空格）' : '自动漫游（空格）';
  }

  function showHint(v) { el.hint.classList.toggle('show', !!v); }
  function showLoading(v) { el.loading.hidden = !v; }

  function dismissIntro() {
    el.intro.classList.add('gone');
    setTimeout(function () { el.intro.style.display = 'none'; }, 900);
  }

  global.UI = {
    init: init, tick: tick,
    selectInscription: selectInscription, hideCard: hideCard,
    nearestInscription: nearestInscription,
    setTour: setTour, showHint: showHint, showLoading: showLoading,
    dismissIntro: dismissIntro, syncOverviewBtn: syncOverviewBtn,
    syncAliveBtn: syncAliveBtn,
    rebuildMinimap: function () { buildMinimap(); drawSeasonBands(); buildMarks(); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
