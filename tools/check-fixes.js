/*!
 * tools/check-fixes.js —— 三项报修的验收脚本（在页面里跑，返回 JSON）
 *
 * 起因：这三条都**只能靠像素以外的证据**才能定性 ——
 *   ① 「船在动」：无头截图只有单帧，看不出位移；且船的巡航是正弦，
 *      恰好取到折返点就会得到「没动」的假阴性。
 *   ② 「老弱妇孺看得见」：行人的位置是 t 的函数，任何单帧都只说明「那一刻」。
 *   ③ 「客栈在卷首」：得看数据，不是看画面。
 *
 * 所以这里直接调页面里**同一份**函数（boatBob / probe / SceneData），
 * 把「画出来的那一份」原样取回来核验，不重写第二套公式。
 *
 * 用法: node tools/shot.js <url> shots/_diag/checks.png 2600 "$(cat tools/check-fixes.js)" 1280 720
 */
(function () {
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  return (async function () {
    await sleep(1500);
    var I = document.getElementById('intro');
    if (I) { I.classList.add('gone'); I.style.display = 'none'; }
    var e = KV.engine(), f = KV.fx(), al = f.alive, S = window.SceneData;
    var rep = {};

    /* —— 卷首视口：与 boot() 的 goTo(240, fitHeightScale) 完全一致 ——
       world x = clamp(240 − vw/2/s, 0, …) → 0；world y = 0。 */
    var s = e.fitHeightScale, vw = e.vw, vh = e.vh;
    var viewX = Math.max(0, Math.min(240 - vw / 2 / s, S.WORLD_W - vw / s));
    var viewY = 0;
    rep.视口 = { scale: +s.toFixed(4), x: Math.round(viewX), y: viewY,
                visW: Math.round(vw / s), vh: vh };
    var visX0 = viewX, visX1 = viewX + vw / s;
    var dockEl = document.getElementById('dock');
    var dockTop = dockEl ? Math.round(dockEl.getBoundingClientRect().top) : vh;
    rep.底栏上沿_屏幕px = dockTop;

    /* ============ ① 船：真有位移吗 ============ */
    var boats = [];
    for (var i = 0; i < S.MOTIFS.length; i++) {
      var m = S.MOTIFS[i];
      if (m.type === 'boat' || m.type === 'sail') boats.push(m);
    }
    rep.船数 = boats.length;

    /* 采样轨迹（世界坐标 x）。同时给出「逐段最大速率」与「总行程」，
       这两项一起才能说明是「在航」而不是「在抖」。 */
    var samples = [];
    var TS = [0, 5, 10, 15, 20, 25, 30, 40, 50, 57.5, 60];
    for (var k = 0; k < boats.length; k++) {
      var b = boats[k];
      var row = { x: b.x, y: b.y, flip: b.flip ? 1 : 0, nav: [] };
      for (var j = 0; j < TS.length; j++) {
        /* 直接调绘制用的那一份：boatBob（船身与浪痕共用的就是这个）。
           WIND.t 由 setWind 注入，与 alive.draw 每帧做的事一致。 */
        Motifs.setWind(TS[j], 1);
        var bb = Motifs.boatBob(b);
        row.nav.push({ t: TS[j], dx: +bb.dx.toFixed(3), dir: bb.navDir,
                       spd: +bb.navSpd.toFixed(3) });
      }
      Motifs.setWind(0, 1);
      var vmax = 0, dmin = 1e9, dmax = -1e9, prev = null;
      for (var q = 0; q < TS.length; q++) {
        var dxq = row.nav[q].dx;
        if (dxq < dmin) dmin = dxq;
        if (dxq > dmax) dmax = dxq;
        if (prev !== null) {
          var v = Math.abs(dxq - prev) / (TS[q] - TS[q - 1]);
          if (v > vmax) vmax = v;
        }
        prev = dxq;
      }
      row.行程 = +(dmax - dmin).toFixed(1);
      row.最大速率 = +vmax.toFixed(2);
      samples.push(row);
    }
    rep.船的巡航 = samples;
    rep.船最大速率_世界单位每秒 = +Math.max.apply(null, samples.map(function (r) { return r.最大速率; })).toFixed(2);
    rep.船行程_最小值 = +Math.min.apply(null, samples.map(function (r) { return r.行程; })).toFixed(1);

    /* ============ ② 人：卷首视口里都有谁 ============ */
    al.t = 0;                                   /* 开卷那一刻 */
    function folkAt(t) {
      al.t = t;
      var all = al.probe(e);
      var inView = [], kinds = {};
      for (var i = 0; i < all.length; i++) {
        var p = all[i];
        if (p.sx < -20 || p.sx > vw + 20) continue;
        if (p.sy < 0 || p.sy > dockTop - 4) continue;   /* 被底栏压住的不算「看得见」 */
        inView.push(p);
      }
      for (var j = 0; j < inView.length; j++) {
        kinds[inView[j].kind] = (kinds[inView[j].kind] || 0) + 1;
      }
      return { n: inView.length, kinds: kinds, list: inView };
    }
    rep.卷首_t0 = folkAt(0);
    rep.卷首_t18 = folkAt(18);
    rep.卷首_t40 = folkAt(40);
    /* 老弱妇孺：整卷里有多少、且速度是否一律 14（覆盖率保证靠它） */
    var speeds = {}, weak = 0;
    for (var w = 0; w < S.WALKERS.length; w++) {
      var wk = S.WALKERS[w];
      speeds[wk.speed] = (speeds[wk.speed] || 0) + 1;
      if (wk.kind === 'elder' || wk.kind === 'woman' || wk.kind === 'child') weak++;
    }
    rep.行人总数 = S.WALKERS.length;
    rep.行人速度分布 = speeds;
    rep.行人中的老弱妇孺 = weak;
    rep.常住村民 = (S.VILLAGERS || []).length;
    var vk = {};
    (S.VILLAGERS || []).forEach(function (v) { vk[v.kind] = (vk[v.kind] || 0) + 1; });
    rep.村民构成 = vk;

    /* ============ ③ 客栈：卷首有没有 ============ */
    var inns = [];
    for (var n2 = 0; n2 < S.MOTIFS.length; n2++) {
      if (S.MOTIFS[n2].type === 'inn') inns.push(S.MOTIFS[n2].x);
    }
    rep.客栈位置 = inns;
    rep.卷首有客栈 = inns.some(function (x) { return x >= visX0 && x <= visX1; });
    var houses = [];
    for (var n3 = 0; n3 < S.MOTIFS.length; n3++) {
      var t3 = S.MOTIFS[n3].type;
      if (t3 === 'inn' || t3 === 'cottage' || t3 === 'farmstead' || t3 === 'well') {
        if (S.MOTIFS[n3].x >= visX0 && S.MOTIFS[n3].x <= visX1) houses.push(t3 + '@' + S.MOTIFS[n3].x);
      }
    }
    rep.卷首屋舍 = houses;

    /* ============ ④ 水流：唯一速度 ============ */
    rep.水流速度_配置 = S.FLOW.speed;

    al.t = 0;
    return JSON.stringify(rep, null, 1);
  })();
})()
