#!/usr/bin/env bash
# 功能冒烟：把长卷的交互路径都跑一遍，报告状态与页面错误。
# 用法: bash tools/smoke.sh
# 前置: 项目根目录跑 `python -m http.server 8788 --bind 127.0.0.1`
#
# 为什么要有这个：无头截图只能证明「某一刻画面是对的」，
# 证明不了「拖拽 / 滚轮 / 键盘 / 迷你地图 / 自动漫游」这些路径还活着。
# 改动 engine 的相机、缓存、绘制之后，务必跑一遍。
set -u
cd "$(dirname "$0")/.." || exit 1

# 工具链一律走环境变量，默认用 PATH 上的命令；
# 本机若要钉死某个解释器，跑之前 export NODE=/path/to/node 即可。
NODE="${NODE:-node}"

read -r -d '' SCRIPT <<'JS'
(function () {
  var errs = [];
  window.addEventListener('error', function (e) { errs.push('' + e.message); });
  var e = KV.engine();
  var cv = document.getElementById('scroll-canvas');
  var rep = {};
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function ev(el, type, opts) {
    var o = Object.assign({ bubbles: true, cancelable: true }, opts || {});
    el.dispatchEvent(new (type.indexOf('wheel') === 0 ? WheelEvent
      : type.indexOf('touch') === 0 ? TouchEvent : PointerEvent)(type, o));
  }
  function pt(type, x, y) { ev(cv, type, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true }); }
  function snap(tag) {
    rep[tag] = { s: +e.view.scale.toFixed(4), x: Math.round(e.view.x), y: Math.round(e.view.y) };
  }

  /* 等所有基于 dt 的动画真正落定再快照。
   *
   * 为什么不能写死 sleep：无头 Chrome 的 rAF 实测只有 ~11fps（≈89ms/帧），
   * 一个 dur=0.24s 的缩放动画要跑 3 帧 ≈ 270ms，而带惯性/分片时更久。
   * 固定 sleep(400) 取快照会读到动画中间值 —— 于是「滚轮平移不该改缩放」
   * 这条断言会假阴性（实测 c2 曾报 false，其实引擎没错，是采样早了一帧）。
   * 判据用引擎自己的状态位，不猜时间。 */
  function idle() {
    return !e.scaleAnim && !e.focusAnim
      && Math.abs(e.vel.x) < 0.5 && Math.abs(e.vel.y) < 0.5;
  }
  async function settle(maxMs) {
    var t0 = Date.now(), lim = maxMs || 4000;
    while (Date.now() - t0 < lim) {
      if (idle()) { await sleep(80); if (idle()) return true; }
      await sleep(60);
    }
    return false;
  }
  /* 分片队列排空（背景细化完成），否则下一条一致性断言会混进「山在细化」 */
  async function settleTiles(maxMs) {
    var t0 = Date.now(), lim = maxMs || 5000;
    while (Date.now() - t0 < lim && e.queue && e.queue.length) await sleep(70);
    return !(e.queue && e.queue.length);
  }

  /* 收起遮罩 */
  var I = document.getElementById('intro');
  I.classList.add('gone'); I.style.display = 'none';

  return (async function () {
    await sleep(900);
    /* 无头环境的帧率是理解下面一切时序的前提，记进报告一起看 */
    var _f = 0, _t0 = performance.now();
    (function _tk() { if (performance.now() - _t0 < 800) { _f++; requestAnimationFrame(_tk); } })();
    await sleep(900);
    rep['环境_rAF帧率'] = +(_f / ((performance.now() - _t0) / 1000)).toFixed(1);
    snap('a_初始');

    /* 滚轮：不按 Ctrl 是平移，按住 Ctrl 才是缩放 */
    ev(cv, 'wheel', { deltaY: -600, clientX: 640, clientY: 360, ctrlKey: true }); await settle();
    snap('b_Ctrl滚轮放大');
    ev(cv, 'wheel', { deltaY: 900, clientX: 640, clientY: 360, ctrlKey: true });  await settle();
    snap('c_Ctrl滚轮缩小');
    var beforePan = e.view.x;
    ev(cv, 'wheel', { deltaY: 600, clientX: 640, clientY: 360 }); await settle();
    snap('c2_平移后');
    rep['c2_滚轮平移'] = Math.abs(e.view.x - beforePan) > 20;
    /* 必须「快照比快照」：快照里的 s 已 toFixed(4)，拿它去比 e.view.scale 原值
       （如 0.322931…）会因 3e-5 的差判不等，是个假阴性。 */
    rep['c2_缩放未变'] = rep['c2_平移后'].s === rep['c_Ctrl滚轮缩小'].s;

    /* 拖拽平移 */
    pt('pointerdown', 640, 360);
    for (var i = 1; i <= 8; i++) { pt('pointermove', 640 - i * 26, 360 - i * 4); await sleep(16); }
    pt('pointerup', 640 - 8 * 26, 360 - 32);
    await settle();                                snap('d_拖拽后');

    /* 双击对焦 */
    ev(cv, 'dblclick', { clientX: 700, clientY: 380 }); await settle(5000);
    snap('e_双击对焦');

    /* 回车到正常视距，再走一遍分片缓存路径 */
    e.focusOn(4100, 470, 0.95, 0.3);
    await settle(5000); await settleTiles();
    snap('f_视距0.95');
    rep['f_分片数'] = e.stats.tiles;

    /* 顶栏按钮 / 底部芯片 */
    var ids = ['btn-first', 'btn-prev', 'btn-next', 'btn-last', 'btn-mood', 'btn-rain', 'btn-alive', 'btn-rand'];
    for (var j = 0; j < ids.length; j++) {
      var b = document.getElementById(ids[j]);
      if (!b) { errs.push('缺少按钮 ' + ids[j]); continue; }
      b.click(); await sleep(220);
    }
    await settle(6000);
    snap('g_芯片按钮后');

    /* 灵动层：上面点过 btn-alive，此时应当是关的；再点一次开回来 */
    var fx = KV.fx();
    rep['g1_灵动已关'] = fx.alive.on === false;
    rep['g1_关时耗时归零'] = fx.alive.ms === 0;
    document.getElementById('btn-alive').click(); await sleep(500);
    rep['g2_灵动已开'] = fx.alive.on === true;
    rep['g2_耗时'] = Math.round(fx.alive.ms * 10) / 10;
    rep['g2_质量档'] = fx.alive.qUsed;
    /* 「任一时刻视口内至少两个行人」是 scene-data 里 WALKERS 的设计保证，
       这里只查它确实在跑（本帧画了几个），不重复算覆盖。 */
    rep['g2_本帧画行人'] = fx.alive.walkers;
    rep['g2_行人总数'] = window.SceneData.WALKERS.length;

    /* 自动漫游：开 → 轮询确认确实在移动 → 关。
       漫游是持续位移，不能等它「落定」，只能轮询「动没动」。 */
    document.getElementById('btn-tour').click();
    var tx0 = e.view.x, moved = false, tt0 = Date.now();
    while (Date.now() - tt0 < 3000 && !moved) {
      await sleep(120); if (Math.abs(e.view.x - tx0) > 1) moved = true;
    }
    rep['h_漫游中移动'] = moved;
    document.getElementById('btn-tour').click(); await settle(4000);

    /* 整卷 / 回观察视距 */
    document.getElementById('btn-overview').click(); await settle(7000); await settleTiles(7000);
    snap('i_整卷');
    rep['i_是概览'] = e.isOverview();
    document.getElementById('btn-overview').click(); await settle(7000); await settleTiles(7000);
    snap('j_回观察');
    rep['j_非概览'] = !e.isOverview();

    /* 迷你地图点击 + 题跋卡片 */
    var mini = document.getElementById('minimap');
    var r = mini.getBoundingClientRect();
    var beforeMini = e.view.x;
    mini.dispatchEvent(new MouseEvent('click', {
      bubbles: true, clientX: r.left + r.width * 0.72, clientY: r.top + r.height / 2
    }));
    await settle(7000);
    snap('k_点迷你地图');
    rep['k_地图跳转'] = Math.abs(e.view.x - beforeMini) > 100;
    UI.selectInscription(3, true); await sleep(700);
    rep['l_卡片可见'] = document.getElementById('card').classList.contains('show');
    rep['l_卡片题'] = (document.getElementById('card-title') || {}).textContent;
    document.getElementById('card-close').click(); await sleep(300);
    rep['m_卡片已关'] = !document.getElementById('card').classList.contains('show');

    /* 键盘（a = 灵动开关） */
    var keys = ['ArrowRight', 'ArrowLeft', 'm', 'r', 'x', 'v', 'a', 'Home', 'End'];
    for (var k = 0; k < keys.length; k++) {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: keys[k], bubbles: true }));
      await sleep(260);
    }
    await settle(7000); await settleTiles(5000); snap('n_键盘后');
    rep['n_错误数'] = errs.length;
    rep['n_错误'] = errs.slice(0, 6);
    return JSON.stringify(rep, null, 1);
  })();
})()
JS

"$NODE" tools/shot.js "${URL:-http://127.0.0.1:8788}/" "shots/_diag/smoke.png" 3000 "$SCRIPT" 1280 720
