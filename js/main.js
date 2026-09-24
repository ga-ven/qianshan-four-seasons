/*!
 * main.js —— 装配、输入与主循环
 */
(function (global) {
  'use strict';
  var U = global.U, S = global.SceneData;

  /* 装裱底色：暖绢色，衬托画卷的明亮。
     必须与 css/style.css 的 --mount 保持一致，否则首帧与稳态会闪一下。 */
  var MOUNT = '#D6C3A0';

  var engine, fx;
  var running = false;
  var lastT = 0;
  var mood = 'noon';
  var rain = false;
  var tour = false;
  var aliveOn = true;             /* 灵动层：人物 / 水流 / 风摆 */
  var TOUR_SPEED = 300;           /* 世界单位 / 秒 */

  /* 输入状态 */
  var ptr = { down: false, id: null, x: 0, y: 0, t: 0, moved: 0, lastX: 0, lastY: 0, lastT: 0, vx: 0, vy: 0 };
  var pinch = null;

  /* ---------------------------------------------------------------
   * 初始化
   * ------------------------------------------------------------- */

  function init() {
    var scrollCanvas = document.getElementById('scroll-canvas');
    var fxCanvas = document.getElementById('fx-canvas');

    engine = new global.Scroll.Engine({
      canvas: scrollCanvas,
      onStats: function () {}
    });
    fx = new global.Fx(fxCanvas);

    /* UI 必须先装载：syncSize 会触发迷你地图重建，依赖 UI 内部的 DOM 缓存 */
    global.UI.init(engine, fx, {
      onTour: toggleTour,
      onRain: function () { rain = !rain; return rain; },
      onMood: function () {
        mood = mood === 'noon' ? 'dusk' : (mood === 'dusk' ? 'dawn' : 'noon');
        return mood;
      },
      onAlive: function () { aliveOn = !aliveOn; return aliveOn; }
    });
    global.UI.syncAliveBtn(aliveOn);

    syncSize();

    bindInput(scrollCanvas);
    bindKeys();

    /* 首屏立刻出一版画面，避免白屏 */
    global.UI.showLoading(true);
    requestAnimationFrame(function () {
      var t0 = (global.performance || Date).now();
      engine._ensurePreview(true);
      engine.draw(MOUNT);
      var cost = Math.round((global.performance || Date).now() - t0);
      if (global.console && console.log) console.log('[千山四时] 首屏占位用时 ' + cost + 'ms');
      global.UI.showLoading(false);
      start();
    });
  }

  function syncSize() {
    var w = global.innerWidth, h = global.innerHeight;
    engine.resize();
    fx.resize(w, h);
    global.UI.rebuildMinimap && global.UI.rebuildMinimap();
  }

  var rzTimer = null;
  global.addEventListener('resize', function () {
    clearTimeout(rzTimer);
    rzTimer = setTimeout(syncSize, 180);
  });

  /* ---------------------------------------------------------------
   * 主循环
   * ------------------------------------------------------------- */

  function start() {
    if (running) return;
    running = true;
    lastT = (global.performance || Date).now();
    requestAnimationFrame(loop);
  }

  function loop(now) {
    var dtMs = Math.min(now - lastT, 64);
    lastT = now;
    var dt = dtMs / 1000;

    if (tour) {
      engine.view.x += TOUR_SPEED * dt;
      var maxX = Math.max(0, S.WORLD_W - engine.visibleW());
      if (engine.view.x >= maxX) {
        engine.view.x = maxX;
        setTourState(false);
      }
    }

    engine.frame(dtMs, MOUNT);
    fx.update(dt, engine, { mood: mood, rain: rain, alive: aliveOn });
    fx.draw(engine);
    global.UI.tick(dt);

    global.UI.syncOverviewBtn();
    requestAnimationFrame(loop);
  }

  function setTourState(v) {
    tour = v;
    global.UI.setTour(v);
  }
  function toggleTour() { setTourState(!tour); }
  function stopTour() { if (tour) setTourState(false); }

  /* ---------------------------------------------------------------
   * 指针输入
   * ------------------------------------------------------------- */

  function bindInput(canvas) {
    canvas.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch' && pinch) return;
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      ptr.down = true; ptr.id = e.pointerId;
      ptr.x = ptr.lastX = e.clientX;
      ptr.y = ptr.lastY = e.clientY;
      ptr.t = ptr.lastT = (global.performance || Date).now();
      ptr.moved = 0; ptr.vx = 0; ptr.vy = 0;
      stopTour();
    });

    canvas.addEventListener('pointermove', function (e) {
      if (pinch) return;

      /* 双指缩放 */
      if (e.pointerType === 'touch') {
        trackTouchForPinch(e);
        if (pinch) return;
      }

      if (!ptr.down || e.pointerId !== ptr.id) return;
      var dx = e.clientX - ptr.lastX;
      var dy = e.clientY - ptr.lastY;
      ptr.moved += Math.abs(dx) + Math.abs(dy);

      if (ptr.moved > 5 && !engine.dragging) engine.beginDrag();
      if (engine.dragging) engine.dragBy(dx, dy);

      var nowT = (global.performance || Date).now();
      var dts = Math.max(8, nowT - ptr.lastT) / 1000;
      var k = 0.72;
      ptr.vx = ptr.vx * (1 - k) + (-dx / engine.view.scale / dts) * k;
      ptr.vy = ptr.vy * (1 - k) + (-dy / engine.view.scale / dts) * k;

      ptr.lastX = e.clientX; ptr.lastY = e.clientY; ptr.lastT = nowT;
    });

    function endPointer(e) {
      if (e.pointerId !== ptr.id) return;
      var wasDrag = engine.dragging;
      var dtMs = (global.performance || Date).now() - ptr.t;
      engine.endDrag();
      ptr.down = false; ptr.id = null;

      if (!wasDrag && ptr.moved < 8 && dtMs < 400) {
        handleTap(e.clientX, e.clientY);
      } else if (wasDrag) {
        var sp = Math.hypot(ptr.vx, ptr.vy);
        if (sp > 40) engine.fling(ptr.vx, ptr.vy);
      }
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    /* —— 滚轮 —— */
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      stopTour();
      if (e.ctrlKey || e.metaKey) {
        var r = canvas.getBoundingClientRect();
        engine.zoomAt(Math.exp(-e.deltaY * 0.0024), e.clientX - r.left, e.clientY - r.top, true);
        return;
      }
      var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      else if (e.deltaMode === 2) d *= 100;
      engine.vel.x += (d / engine.view.scale) * 13;
      /* 纵向内容溢出时允许 Shift 纵移 */
      if (e.shiftKey && engine.visibleH() < S.WORLD_H) {
        engine.vel.y += (e.deltaY / engine.view.scale) * 13;
      }
    }, { passive: false });

    /* —— 双击对焦 —— */
    canvas.addEventListener('dblclick', function (e) {
      var r = canvas.getBoundingClientRect();
      var w = engine.screenToWorld(e.clientX - r.left, e.clientY - r.top);
      stopTour();
      if (engine.view.scale > engine.fitHeightScale * 1.9) {
        engine.fitHeight();
      } else {
        engine.focusOn(w.x, w.y, Math.min(engine.maxScale, engine.view.scale * 2.15), 0.9);
      }
    });

    /* —— 触摸双指 —— */
    canvas.addEventListener('touchstart', function (e) {
      if (e.touches.length === 2) {
        engine.endDrag();
        ptr.down = false;
        var a = e.touches[0], b = e.touches[1];
        pinch = {
          d: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
          cx: (a.clientX + b.clientX) / 2,
          cy: (a.clientY + b.clientY) / 2
        };
        e.preventDefault();
      }
    }, { passive: false });

    canvas.addEventListener('touchmove', function (e) {
      if (e.touches.length === 2 && pinch) {
        var a = e.touches[0], b = e.touches[1];
        var d = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
        var r = canvas.getBoundingClientRect();
        engine.zoomAt(d / Math.max(1, pinch.d), pinch.cx - r.left, pinch.cy - r.top, false);
        pinch.d = d;
        pinch.cx = (a.clientX + b.clientX) / 2;
        pinch.cy = (a.clientY + b.clientY) / 2;
        e.preventDefault();
      }
    }, { passive: false });

    canvas.addEventListener('touchend', function (e) {
      if (e.touches.length < 2) pinch = null;
    });

    /* 右键拖拽也用于平移 */
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    canvas.addEventListener('dragstart', function (e) { e.preventDefault(); });
  }

  var touchMap = Object.create(null);
  function trackTouchForPinch(e) {
    /* 由 touchstart/touchmove 专用处理器管理，这里只做保护 */
    if (pinch) return;
  }

  /** 单击：命中题跋热点则弹卡片；点在水面则起涟漪 */
  function handleTap(clientX, clientY) {
    var r = engine.canvas.getBoundingClientRect();
    var w = engine.screenToWorld(clientX - r.left, clientY - r.top);

    /* 题跋热点：按屏幕距离判定（缩放后仍好点） */
    var best = -1, bd = Infinity;
    for (var i = 0; i < S.INSCRIPTIONS.length; i++) {
      var ins = S.INSCRIPTIONS[i];
      var dx = (ins.x - w.x) * engine.view.scale;
      var dy = (ins.y - w.y) * engine.view.scale;
      var d = Math.hypot(dx, dy);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0 && bd < 120) {
      global.UI.selectInscription(best, false);
      return;
    }
    global.UI.hideCard();
    if (w.y > S.LAYOUT.shore - 20) fx.ripple(w.x, w.y);
  }

  /* ---------------------------------------------------------------
   * 键盘
   * ------------------------------------------------------------- */

  function bindKeys() {
    global.addEventListener('keydown', function (e) {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      var k = e.key;
      switch (k) {
        case ' ':
          e.preventDefault(); toggleTour(); break;
        case 'ArrowRight':
          e.preventDefault(); stopTour(); stepBy(0.09); break;
        case 'ArrowLeft':
          e.preventDefault(); stopTour(); stepBy(-0.09); break;
        case 'Home':
          e.preventDefault(); stopTour(); engine.seek(0, 1.2); break;
        case 'End':
          e.preventDefault(); stopTour(); engine.seek(1, 1.6); break;
        case 'v': case 'V':
          if (engine.isOverview()) engine.fitHeight(); else engine.overview();
          global.UI.syncOverviewBtn(); break;
        case 'r': case 'R':
          rain = !rain;
          document.getElementById('btn-rain').classList.toggle('on', rain);
          break;
        case 'm': case 'M': {
          mood = mood === 'noon' ? 'dusk' : (mood === 'dusk' ? 'dawn' : 'noon');
          var map = { noon: '午', dawn: '晨', dusk: '暮' };
          document.getElementById('mood-txt').textContent = map[mood];
          document.getElementById('btn-mood').classList.toggle('on', mood !== 'noon');
          break;
        }
        case 'x': case 'X':
          stopTour();
          engine.goTo(200 + Math.random() * (S.WORLD_W - 900), { scale: engine.fitHeightScale * (1 + Math.random() * 0.5), dur: 1.3 });
          break;
        case 'a': case 'A':
          aliveOn = !aliveOn;
          global.UI.syncAliveBtn(aliveOn);
          break;
        case 'Escape':
          global.UI.hideCard(); break;
        case '?':
        case 'h': case 'H': {
          var el = document.getElementById('hint');
          el.classList.toggle('show');
          break;
        }
      }
    });
  }

  function stepBy(frac) {
    var p = engine.progress() + frac;
    engine.seek(U.clamp(p, 0, 1), 0.6);
  }

  /* ---------------------------------------------------------------
   * 启动
   * ------------------------------------------------------------- */

  function boot() {
    init();
    var goBtn = document.getElementById('intro-go');
    var begin = function () {
      global.UI.dismissIntro();
      engine.goTo(240, { scale: engine.fitHeightScale, dur: 1.5 });
      setTimeout(function () { global.UI.showHint(true); }, 900);
      setTimeout(function () { global.UI.showHint(false); }, 9000);
    };
    goBtn.addEventListener('click', begin);
    document.getElementById('intro').addEventListener('click', function (e) {
      if (e.target.id === 'intro' || e.target.classList.contains('intro-frame')) begin();
    });
    /* 回车也能展卷 */
    global.addEventListener('keydown', function onEnter(e) {
      if (e.key === 'Enter' && document.getElementById('intro').style.display !== 'none') {
        begin();
        global.removeEventListener('keydown', onEnter);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.KV = { engine: function () { return engine; }, fx: function () { return fx; } };
})(typeof window !== 'undefined' ? window : globalThis);
