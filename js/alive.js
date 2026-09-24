/*!
 * alive.js —— 灵动层
 *
 * 把「会动的」东西集中到这一层，画在动态 canvas 上、每帧重绘：
 *   · 植被：林中的树、岸边的树、芦苇、荷叶 —— 随风摆
 *   · 水面：行进的水线、沿岸浮沫、舟的起伏与浪痕
 *   · 人物：沿卷轴行走的挑担者 / 行人 / 童子
 *
 * 三条硬约束，违反任何一条都会出问题：
 *
 *  ① 这些物件**必须从静态层里拿掉**（见 painter.js 与 motifs.js 的
 *     static / alive 分流）。留在静态层会被烘焙进分片，既摆不动，
 *     又会被灵动层再画一遍，叠出一层比不动更难看的重影。
 *
 *  ② 位置一律由「世界坐标 + 时间」唯一确定，不许把 Math.random() 的结果
 *     存进数组当状态。拖动画卷、分片重建、切季节、切时雨，画面都不能跳。
 *
 *  ③ 每帧有预算。这里按实测耗时自动降级（叶点数 / 芦苇 / 水线密度），
 *     而且按视口宽度封顶。掉帧比不飘更伤沉浸感——尤其在无独显的机器上。
 */
(function (global) {
  'use strict';
  var U = global.U, S = global.SceneData;
  var L = S.LAYOUT;

  var now = function () { return (global.performance || Date).now(); };

/* 视口越宽、同一屏里要动的树越多，质量档就得越低。
   -1 = 概览视距（整卷都看得见）：叶点砍到 6、树距放宽到 70，
        但这个档位**不能跳过植被** —— 树冠只活在灵动层里，
        这里一跳过，概览下整条林带就凭空消失了。 */
function viewQuality(visW) {
  if (visW > 4200) return -1;
  if (visW > 2600) return 0;
  if (visW > 1500) return 1;
  return 2;
}

/* 质量档 → 林带参数 [叶点数, 树距]。下标 = q + 1（因为 q 从 -1 起）。
   叶点数 0 是特殊含义：不点叶，改成填一整块实心树冠 —— 概览视距下
   一个叶点只有零点几像素，逐点画出来是一层淡噪点，不如直接填块。
   正常视距一律 20 的树距，与静态层时代的密度一致。 */
var FOLIAGE = [[0, 26], [14, 20], [21, 20], [30, 20]];

  /* 身高（世界单位）。_figure 与 probe 共用一份，免得「画的」和「报的」漂移。
     37 约合前排林带树高（46~86，均值 66）的六成，默认视距下约 30px ——
     和题跋上的一个字差不多大。这是刻意压着的：山水长卷里的点景人物
     本就该小，靠「会动」而不是靠「大」来抓住眼睛。 */
  function figureH(kind) {
    if (kind === 'child') return 25;
    if (kind === 'elder') return 30;   /* 老叟佝偻，本就比常人矮一截 */
    return 37;
  }

  function Alive() {
    this.t = 0;
    this.on = true;          /* 由「灵动」开关控制 */
    this.q = 2;              /* 自适应质量档，上限 2 */
    this._avg = 0;
    this._lastQ = 0;
    this.ms = 0;
    this.walkers = 0;        /* 上一帧画了几个行人，供自检 */
    this.villagers = 0;      /* 上一帧画了几个常住村民，供自检 */
  }

  Alive.prototype.update = function (dt) {
    this.t += dt;
  };

  Alive.prototype.reset = function () {
    this.t = 0;
    this.q = 2;
    this._avg = 0;
  };

  /* ---------------------------------------------------------------
   * 主绘制
   * ------------------------------------------------------------- */

  Alive.prototype.draw = function (ctx, e) {
    if (!this.on) { this.ms = 0; return; }
    var t0 = now();

    var s = e.view.scale, vx = e.view.x, vy = e.view.y;
    var visW = e.visibleW();
    var pad = 260;
    var x0 = vx - pad, x1 = vx + visW + pad;
    var pal = S.paletteAt(vx + visW / 2);
    /* cap：视口宽度给出的上限；this.q：按实测耗时自适应的上限。取小者。 */
    var cap = viewQuality(visW);
    var q = Math.min(cap, this.q);
    this.qUsed = q;
    this._cap = cap;

    /* 把当前时刻交给 motifs —— 树的摆幅都在那边算 */
    global.Motifs.setWind(this.t, 1);

    ctx.save();
    ctx.scale(s, s);
    ctx.translate(-vx, -vy);

    /* 植被 / 水面 / 岸边纹样：**三个档位都要画**，只是浓淡不同。
       曾经在概览档整个跳过，结果整条林带凭空消失——
       因为树冠只活在这一层，静态层里已经没有它了。 */
    var fol = FOLIAGE[q + 1] || FOLIAGE[1];
    global.Painter.treelineFoliage(ctx, x0, x1, pal, fol[0], fol[1]);

    /* 水面的流动 —— 必须在舟与荷叶之前，否则水线会「划过」船身 */
    this._water(ctx, x0, x1, pal, q, visW);

    /* 岸边的树 / 芦苇 / 荷叶 / 舟 */
    global.Motifs.paintAll(ctx, x0, x1, pal, 'alive');

    /* 行人：概览视距下也保留，他们是「整卷还活着」的唯一线索 */
    this._folk(ctx, x0, x1, pal, q);
    /* 常住村民：定点的人。「村口一定有人」由构图保证，不靠行人的相位碰运气 */
    this._villagers(ctx, x0, x1, pal, q);

    ctx.restore();

    this.ms = now() - t0;
    /* 只在「自适应档位才是瓶颈」时才调档。
       概览视距下瓶颈是视口宽度（cap=-1），这时若还照着耗时往下调 this.q，
       等用户放大回来看时就会莫名其妙地拿到低画质 —— 而且再也升不回去，
       因为升档的判断（<2.4ms）在概览下也永远不满足。 */
    if (cap >= this.q) this._adapt(this.ms);
    else this._avg = 0;
  };

  /* ---------------------------------------------------------------
   * 水面：长波 + 行进的水线 + 沿岸浮沫
   *
   * 光有静态的波纹，水是「冻住」的。要有位移（水线在走）与明暗
   * （光斑在跑）两条线索同时存在，眼睛才认账。
   *
   * 而这两条线索都是**短笔**，凑近了才看得见。所以再垫一层长波：
   * 一笔跨过小半屏、步长也大，整条河「在往下游走」这件事
   * 在概览视距下也一眼看得出来。三层各司其职，缺一层就少一档观感。
   * ------------------------------------------------------------- */

  Alive.prototype._water = function (ctx, x0, x1, pal, q, visW) {
    var F = S.FLOW;
    /* 水面 = 岸线之下、水底之上。原先拿 ground(840) 当水底，水纹一路画到
       水外的岸滩上 —— 白耗一批笔画，还让水纹看起来「浮」在岸上。 */
    var y0 = L.shore + 4, y1 = L.waterBottom - 10;
    /* 流速。**只此一个 base，下面每一层会平移的相位都由它导出。**
       从前这里写 `drift = t * F.speed * 1.5`，而暗流 ×1.85、长波 ×2.3、
       光斑 ×0.4 —— 四层各走各的，互相剪开。读者看到的不是「更快的水」，
       而是「一片在闪的花纹」：谁都看得出来那些线不是在了一起走。
       统一之后，整条河才读得出是**一块布在往下游挪**。
       （F.speed 是唯一的旋钮，见 scene-data.FLOW 的注释。） */
    var base = F.speed;
    var drift = this.t * base;
    /* 视口越宽，水线越稀：每屏条数控制在 100 上下 */
    var step = F.step * Math.max(1, visW / 1500);

    ctx.save();
    ctx.lineCap = 'round';

    /* —— 暗流：比水面深一档的墨色横纹，给水「形」 ——
       原先只用 silk（比水面还亮的绢色）画水纹，叠在浅色水面上只差两三个
       色阶，实测两帧之间 maxdiff 只有 15，「河在流」肉眼完全看不出来。
       水要动，纹路必须**明暗相间**：暗纹立形，亮纹给光，一追一赶才有流向。 */
    var dstep = F.step * 1.31 * Math.max(1, visW / 1500);
    /* 暗流与水面**同速**。原先给它 ×1.85，本意是「深水更快」，
       实际上只是让暗纹从亮纹底下穿出去 —— 一穿就成了闪。
       深浅的差别改由波长与线宽体现（dstep 34 / bstep 96），不再靠速度。 */
    var dd = drift;
    var dg = Math.floor((x0 - dd) / dstep) * dstep;
    ctx.strokeStyle = U.rgb(pal.near);
    for (var d = dg; d <= x1 - dd + dstep; d += dstep) {
      var dx = d + dd;
      if (dx < x0 - 80 || dx > x1 + 80) continue;
      var k1 = U.h1(d, 9501), k2 = U.h1(d, 9503), k3 = U.h1(d, 9507), k4 = U.h1(d, 9511);
      var dy = y0 + (y1 - y0) * (0.06 + k2 * 0.92);
      var dl = 34 + k3 * 92;
      /* 与亮线错开的明灭相位：整片水同时明同时暗，就成闪烁了。
         相位里写 **d（纹理格点）而不是 dx**：dx 已含 drift，再乘系数等于
         把位移重复计一遍，明暗就会以另一个速度掠过水纹 —— 那正是「闪」的来源。
         系数由 base 反推：世界速度 ≈ 1.35 倍流速，比水纹略快，读作碎光被推着走。 */
      var da = (0.055 + k4 * 0.080) * (0.45 + 0.55 * Math.sin(d * 0.0086 - base * this.t * 0.0030 + k1 * 6.28));
      if (da < 0.012) continue;
      ctx.globalAlpha = da;
      ctx.lineWidth = 1.5 + k1 * 1.5;
      ctx.beginPath();
      ctx.moveTo(dx - dl * 0.5, dy);
      ctx.quadraticCurveTo(dx, dy + (k3 - 0.5) * 4.2, dx + dl * 0.5, dy + (k2 - 0.5) * 2.0);
      ctx.stroke();
    }

    /* —— 长波：整条河的水在走。步子大、笔画长，与水面同速 ——
       用暗色（near）而不是绢色：长弧若发亮，缩小后会读成水面的白斑；
       深色长弧才是「暗涌」，在概览视距下也看得出整条河在移动。 */
    var bstep = 96 * Math.max(1, visW / 1500);
    /* 长波是「深流」，与水面同速。原先 ×2.3，本意是让它跑在前面领跑，
       结果只是从水纹里穿出去 —— 同一块水面上两种速度并排，
       读起来就是在打架。深流感改由**步长(96)**与**笔画长(150~370)**给。 */
    var bd = drift;
    var bg0 = Math.floor((x0 - bd) / bstep) * bstep;
    for (var b = bg0; b <= x1 - bd + bstep; b += bstep) {
      var bx = b + bd;
      if (bx < x0 - 200 || bx > x1 + 200) continue;
      var n1 = U.h1(b, 9401), n2 = U.h1(b, 9403), n3 = U.h1(b, 9407);
      var by = y0 + (y1 - y0) * (0.12 + n2 * 0.80);
      var bl = 150 + n1 * 220;
      /* 明灭相位同样写 b（格点），并由 base 反推速度：≈1.2 倍流速。
         原式 `0.9t − bx*0.004` 里 bx 含 drift，两项相抵后相位以 195px/秒 掠过 ——
         比水纹快六倍，一片长弧像被人来回擦。 */
      var ba = (0.042 + n3 * 0.055) * (0.55 + 0.45 * Math.sin(b * 0.004 - base * this.t * 0.0008 + n1 * 6.28));
      if (ba < 0.012) continue;
      ctx.globalAlpha = ba;
      ctx.strokeStyle = U.rgb(pal.near);
      ctx.lineWidth = 2.6 + n1 * 2.6;
      ctx.beginPath();
      ctx.moveTo(bx - bl * 0.5, by);
      /* 一道长弧，别做成直尺 */
      ctx.quadraticCurveTo(bx, by + (n3 - 0.5) * 9, bx + bl * 0.5, by + (n1 - 0.5) * 3.4);
      ctx.stroke();
    }

    /* —— 行进的水线 —— */
    var g0 = Math.floor((x0 - drift) / step) * step;
    for (var g = g0; g <= x1 - drift + step; g += step) {
      var wx = g + drift;
      if (wx < x0 - 60 || wx > x1 + 60) continue;
      var r1 = U.h1(g, 9201), r2 = U.h1(g, 9203);
      var r3 = U.h1(g, 9207), r4 = U.h1(g, 9211);

      /* ty：0 远 / 1 近 —— 近处的水线更长、更疏、更实 */
      var ty = r1 * r1;
      var y = y0 + (y1 - y0) * (0.05 + r2 * 0.95);
      var len = 22 + r3 * 74 * (0.45 + ty);
      /* 行进的光斑。相位必须写 **g（纹理格点）**，写 wx 就把 drift 又算了一遍。
         原式 `(g + drift*0.4)*0.055` 实际只让光斑跑到水纹的 **0.6 倍速** ——
         反光落在水后头，两层对着剪，看着是在闪。注释当时写的是「1.4 倍」，
         与算式差了两倍多，属于「改完没算」。现在按世界速度 = 1.1 倍流速反推：
         0.055 × (1 − 1.1) × base = −0.0055 × base。波长约 114 世界px，一屏十来个。 */
      var glint = 0.5 + 0.5 * Math.sin(g * 0.055 + y * 0.06 - base * this.t * 0.0055);
      var a = (0.105 + r4 * 0.145) * (1 - ty * 0.30) * (0.30 + glint * 0.90);
      if (a < 0.012) continue;

      /* 水线自己也要有横向相位起伏：一条条等高的直线读起来像尺子，
         而且整屏一起上下就不像水、像有人在抖画布。
         起伏取 **0.85 倍流速**（原式 `(g − drift*0.25)*0.02` 实为 1.25 倍，
         比水纹还快 —— 又一处「注释写 0.75、算式给 1.25」）。
         一快一慢叠出层次，而不是两套节奏打架。 */
      var wave = Math.sin(g * 0.02 + base * this.t * 0.003) * 1.9;
      ctx.globalAlpha = a;
      ctx.strokeStyle = U.rgb(pal.silk);
      ctx.lineWidth = 1.5 + ty * 1.6;
      ctx.beginPath();
      ctx.moveTo(wx - len * 0.5, y + wave);
      /* 微微起伏，别画成一根根直尺 */
      ctx.quadraticCurveTo(wx, y + wave + (r3 - 0.5) * 2.6, wx + len * 0.5, y + wave);
      ctx.stroke();
    }

    /* —— 沿岸浮沫：紧贴岸线的一线碎白，随水脉动 —— */
    var fstep = 17 * Math.max(1, visW / 1500);
    var fd = drift;
    var g2 = Math.floor((x0 - fd) / fstep) * fstep;
    ctx.strokeStyle = U.rgb(pal.silk);
    for (var k = g2; k <= x1 - fd + fstep; k += fstep) {
      /* 岸沫跟着水流走（原先只取了 fd 的 0.35 倍，浮沫总落在水纹后头）；
         聚散相位也用固定的 k，才不会一边漂一边换图案。 */
      var fx = k + fd;
      if (fx < x0 - 40 || fx > x1 + 40) continue;
      var m1 = U.h1(k, 9301), m2 = U.h1(k, 9303), m3 = U.h1(k, 9307);
      /* 脉动：浮沫时聚时散（略慢于水流，像泡沫在原地打转再被带走）。
         同样写 k 并按 base 反推：≈1.2 倍流速，与水纹同向，只慢一点点。 */
      var pulse = 0.45 + 0.55 * Math.sin(k * 0.021 - base * this.t * 0.0042);
      var fa = F.shoreFoam * (0.10 + m1 * 0.26) * pulse;
      if (fa < 0.02) continue;
      var fy = L.shore + 2 + m2 * 9;
      var fl = 8 + m3 * 26;
      ctx.globalAlpha = fa;
      ctx.lineWidth = 1.1 + m3 * 0.9;
      ctx.beginPath();
      ctx.moveTo(fx - fl * 0.5, fy);
      ctx.lineTo(fx + fl * 0.5, fy + (m1 - 0.5) * 1.8);
      ctx.stroke();
    }

    /* —— 舟的浪痕：船尾拖出的一道淡淡的水痕 —— */
    for (var i = 0; i < S.MOTIFS.length; i++) {
      var m = S.MOTIFS[i];
      if (m.type !== 'boat' && m.type !== 'sail') continue;
      if (m.x < x0 - 120 || m.x > x1 + 120) continue;
      /* 浪痕的浮动量必须跟船完全一致 —— 走 Motifs.boatBob 这一份。
         两边各算一遍的话，相位迟早对不上，浪痕就会跑到船屁股前面去。 */
      var bb = global.Motifs.boatBob(m);
      var sc = m.s || 1;
      var wy = m.y + bb.dy;
      var wx0 = m.x + bb.dx;          /* 世界坐标，与船身同一份 */
      /* 浪痕拖在**船尾**。舟是来回巡航的，回头那一程船尾换到了另一边，
         所以整条痕按 navDir 换边；换边的一瞬船速恰好过零，
         再让浓度随速度收一下，翻转那一帧就看不见了。 */
      var nd = bb.navDir || 1;
      ctx.globalAlpha = 0.20 * (0.30 + 0.70 * (bb.navSpd === undefined ? 1 : bb.navSpd));
      ctx.strokeStyle = U.rgb(pal.silk);
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(wx0 - 62 * sc * nd, wy + 6);
      ctx.quadraticCurveTo(wx0 - 26 * sc * nd, wy + 2.4, wx0 + 4 * sc * nd, wy + 2.0);
      ctx.stroke();
    }

    ctx.restore();
  };

  /* ---------------------------------------------------------------
   * 行人
   * ------------------------------------------------------------- */

  /* 行人的世界坐标。
   *
   * 位置 = 起始位置 + 速度 × 时间，再对全卷取模 —— 不存任何状态，
   * 所以拖动、切季节、分片重建都会算回同一个位置。
   * dir = +1 顺卷（x 增），-1 逆卷（x 减）。
   *
   * 注意用「起始位置 at」而不是「相位 phase」来定义：逆行者会被镜像，
   * 相位在镜像后就不再均匀了，一堆人挤在一起、另一头空一大段。
   * at 是最终的世界坐标，分层效果不受镜像影响。 */
  Alive.prototype.walkerX = function (w) {
    var span = S.WORLD_W + 320;
    var v = (w.at + 160 + this.t * w.speed * w.dir) % span;
    if (v < 0) v += span;
    return v - 160;
  };

  Alive.prototype._folk = function (ctx, x0, x1, pal, q) {
    var W = S.WALKERS;
    var n = 0;
    ctx.save();
    for (var i = 0; i < W.length; i++) {
      var w = W[i];
      var wx = this.walkerX(w);
      if (wx < x0 - 50 || wx > x1 + 50) continue;
      n++;
      /* 步频与速度成正比：走得快 → 迈得频，脚才不打滑。
         这里用 t*speed 而不是「已经走了多远」——后者会在绕回卷首时
         突变，腿的相位跟着跳一下；而且它在卷首卷尾之外的地方才会绕回，
         那种 bug 平时看不见，只在动画片里露一次脸。 */
      var ph = this.t * w.speed * 0.42 + i * 1.9;
      this._figure(ctx, wx, w.y, w.kind, ph, w.dir, pal, q);
    }
    ctx.restore();
    this.walkers = n;
  };

  /** 常住村民（定点，不随时间位移）。
   *
   *  这一层存在的理由见 scene-data.VILLAGERS 的注释：行人的出现靠相位、
   *  也就是靠运气 —— 想让读者「一定看得见妇人小孩」，光往 WALKERS 里加人
   *  是不够的。定点的人才能由构图保证。 */
  Alive.prototype._villagers = function (ctx, x0, x1, pal, q) {
    var V = S.VILLAGERS || [];
    var n = 0;
    ctx.save();
    for (var i = 0; i < V.length; i++) {
      var v = V[i];
      if (v.x < x0 - 40 || v.x > x1 + 40) continue;
      n++;
      /* amp = 0 的人站定：swing = sin(0) = 0 ⇒ 不迈腿、不摆摆。
         有 amp 的（童子）才有一点原地小动作，幅度小、频率低，
         读作「跳着玩」而不是「原地踏步」。相位由 x 定，各人不同步。 */
      var ph = v.amp ? Math.sin(this.t * 1.7 + v.x * 0.013) * v.amp * 3.0 : 0;
      this._figure(ctx, v.x, v.y, v.kind, ph, v.dir, pal, q);
    }
    ctx.restore();
    this.villagers = n;
  };

  /** 自检用：列出每个「人」此刻的屏幕坐标，供脚本核对
   *  「视口内至少有一个、且不被底栏遮住」。
   *  返回的坐标与 _folk / _villagers 是同一份计算。
   *  still=true 的是常住村民（定点），false 的是行人（随时间走）。 */
  Alive.prototype.probe = function (e) {
    var out = [];
    var s = e.view.scale;
    function put(kind, dir, wx, wy, still) {
      out.push({
        kind: kind, dir: dir, still: !!still,
        wx: Math.round(wx), wy: wy,
        sx: Math.round((wx - e.view.x) * s),
        sy: Math.round((wy - e.view.y) * s),
        h: Math.round(figureH(kind) * s)
      });
    }
    for (var i = 0; i < S.WALKERS.length; i++) {
      var w = S.WALKERS[i];
      put(w.kind, w.dir, this.walkerX(w), w.y, false);
    }
    var V = S.VILLAGERS || [];
    for (var j = 0; j < V.length; j++) {
      var v = V[j];
      put(v.kind, v.dir, v.x, v.y, true);
    }
    return out;
  };

  /** 一个墨笔小人。原点在脚下，向上为负。
   *  kind: bearer 挑担（短打）/ scholar 行人（长袍）/ child 童子
   *
   *  这一版是照着一张三倍放大的「形准对照表」改出来的
   *  （tools/fig-sheet.js 可以把三种人单独画在白底上逐个看）。
   *  在真实画面里调形是徒劳的：背景有树干、竹叶、花瓣，
   *  放大后根本分不清哪一笔是人、哪一笔是树。
   *
   *  三个「像人 / 像棒棒糖」的分界点，都是踩过的坑：
   *
   *   ① **衣摆要盖住腿**。袍子只到大腿、露出两条细腿，必然读成乐高小人；
   *      两条腿在并拢那一帧（走路循环的过渡位）还会合成一根棍，
   *      整个剪影像棒棒糖。国画里长袍压到脚面，只有脚露一点。
   *      所以挑夫（短打，及膝）露小腿，书生（长袍）只露脚尖。
   *
   *   ② **头要明显小于肩**。头直径做到肩宽的七成以上时，
   *      头和身子就会糊成一团墨；四六开才分得开。
   *
   *   ③ **腿要有膝有脚**。从胯到地一根直线、两条腿叉成一个「人」字，
   *      读起来是圆规。膝要折一下，脚要有一小横。
   *
   *  用笔刻意少：走路的小人不需要手臂（书生背手，画里本就看不见）。
   *  笔画再多，缩到 27px 就只剩噪点。 */
  Alive.prototype._figure = function (ctx, x, y, kind, ph, dir, pal, q) {
    var ink = pal.ink;
    var child = kind === 'child';
    var scholar = kind === 'scholar';
    var woman = kind === 'woman';
    var elder = kind === 'elder';
    /* 长袍及地（书生 / 妇人）：腿几乎被遮住，只让脚尖进出。
       妇人下裙及地，与书生长袍同一路画法，区别只在头面上的髻与簪。 */
    var longRobe = scholar || woman;
    var H = figureH(kind);
    var sgn = dir > 0 ? 1 : -1;
    var swing = Math.sin(ph);
    var bob = Math.abs(swing) * H * 0.026;

    ctx.save();
    ctx.translate(x, y - bob);
    ctx.scale(sgn, 1);          /* 朝左的人整体镜像，画法本身只写朝右 */
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var lw = H * 0.046;
    var headR = H * 0.062;
    var headY = -H + headR * 1.05;
    var headX = 0;
    /* 老叟：脖子往前探、头略微压低 —— 一「探」一「压」，佝偻感就出来了。
       只挪头不挪身子，肩线仍横平，读起来才像人而不像问号。 */
    if (elder) { headY += H * 0.030; headX = H * 0.045; }
    var shoulderY = headY + headR * 0.78;
    var hipY = -H * 0.46;
    var legLen = -hipY;
    /* 衣摆高度：决定「露多少腿」，是像人还是像时装剪影的分水岭。
       挑夫穿扎脚裤（及膝），书生穿长袍（几乎触地）。
       衣摆只到大腿、配两条细腿，读出来是短裙加模特；
       长袍若离地太高，脚又会变成垫在衣摆下面的两块砖。 */
    var hemY = -H * (longRobe ? 0.045 : (child ? 0.26 : 0.150));
    /* 肩 / 腰 / 摆三段宽度。缺了「腰」这一收，袍子就成了一个圆锥，
       配上小头活像一枚棋子——这正是上一版学者的问题。
       摆也不能开得太阔：半宽超过身高的 13% 就成一顶钟形罩了。
       妇人肩略窄一线，与男子分开。 */
    var shW = H * (woman ? 0.095 : 0.105);
    var waistW = H * 0.086;
    /* 妇人的下裙比书生的直筒袍更外开一点（0.118 → 0.134）：
       两人都是长袍，若下摆一样宽，剪影就只剩头面上的髻/巾之差，
       隔着三十几像素根本分不出来。给她一个 A 字摆，一望便知是女眷。 */
    var hmW = H * (woman ? 0.134 : (longRobe ? 0.118 : 0.132));
    var waistY = shoulderY + (hemY - shoulderY) * 0.46;
    var bodyH = hemY - shoulderY;
    /* 脚要「踩在」地面上（脚底刚好落在 y=0），不是压着地面线骑上去。
       差这半个笔宽，人就从站着变成陷进地里。 */
    var footY = -lw * 0.45;

    /* —— 腿与脚（一律画在袍子之前）。
       长袍 / 下裙及足，只让脚尖从衣摆底下探出来 ——
       这一笔必须画在填色之前，否则那一小横会浮在衣摆外面，
       读起来像地上掉了根柴火。 —— */
    if (longRobe) {
      ctx.lineCap = 'butt';
      ctx.strokeStyle = U.rgba(ink, 0.68);
      ctx.lineWidth = lw * 0.90;
      /* 长袍把腿全遮住了，走路只能靠脚尖的进出读出来，
         所以脚尖的摆幅要比短打的人更大（±0.095H），否则七帧一模一样。 */
      var fwd = swing * H * 0.095;
      ctx.beginPath();
      ctx.moveTo(hmW * 0.55 + fwd, footY);  ctx.lineTo(hmW * 1.75 + fwd, footY);
      ctx.moveTo(-hmW * 1.62 + fwd, footY); ctx.lineTo(-hmW * 0.48 + fwd, footY);
      ctx.stroke();
      ctx.lineCap = 'round';
    } else {
      var hipDx = H * 0.024;                   /* 胯有点宽度，两条腿就不是同一个点叉出来的 */
      var kx = swing * H * 0.082, fx = swing * H * 0.150;
      var kx2 = -swing * H * 0.052, fx2 = -swing * H * 0.108;

      ctx.strokeStyle = U.rgba(ink, 0.38);      /* 后腿先画、淡一档，前后空间就出来了 */
      ctx.lineWidth = lw * 0.92;
      ctx.beginPath();
      ctx.moveTo(-hipDx, hipY);
      ctx.lineTo(-hipDx + kx2, hipY + legLen * 0.50);
      ctx.lineTo(-hipDx + fx2, footY);
      ctx.stroke();

      ctx.strokeStyle = U.rgba(ink, 0.78);
      ctx.lineWidth = lw * 1.20;
      ctx.beginPath();
      ctx.moveTo(hipDx, hipY);
      ctx.lineTo(hipDx + kx, hipY + legLen * 0.50);
      ctx.lineTo(hipDx + fx, footY);
      ctx.stroke();

      /* 脚：butt 端头方方正正一小横，圆头会变成一颗墨点 */
      ctx.lineCap = 'butt';
      ctx.lineWidth = lw * 1.05;
      ctx.beginPath();
      ctx.moveTo(-hipDx + fx2 - H * 0.016, footY); ctx.lineTo(-hipDx + fx2 + H * 0.040, footY);
      ctx.moveTo(hipDx + fx - H * 0.016, footY);   ctx.lineTo(hipDx + fx + H * 0.056, footY);
      ctx.stroke();
      ctx.lineCap = 'round';
    }

    /* —— 袍身：肩外鼓 → 腰内收 → 摆外开；下摆随步伐前后荡 —— */
    var trail = swing * H * (longRobe ? 0.042 : 0.022);
    /* 摆端一边抬一边落，衣摆就「活」了。
       长袍几乎触地，抬的幅度要收着，否则又露出脚与衣摆之间的缝。 */
    var lift = Math.abs(swing) * H * (longRobe ? 0.018 : 0.030);
    ctx.beginPath();
    ctx.moveTo(-shW, shoulderY);
    ctx.quadraticCurveTo(-shW * 1.05, shoulderY + bodyH * 0.20, -waistW, waistY);
    ctx.quadraticCurveTo(-hmW * 1.00, hemY - bodyH * 0.22, -hmW - trail, hemY + lift * 0.35);
    ctx.quadraticCurveTo(0, hemY + H * 0.024 + lift * 0.5, hmW - trail, hemY - lift * 0.5);
    ctx.quadraticCurveTo(hmW * 1.00, hemY - bodyH * 0.22, waistW, waistY);
    ctx.quadraticCurveTo(shW * 1.05, shoulderY + bodyH * 0.20, shW, shoulderY);
    ctx.closePath();
    ctx.fillStyle = U.rgba(ink, 0.76);
    ctx.fill();

    /* —— 头 —— */
    ctx.beginPath();
    ctx.arc(headX, headY, headR, 0, 6.2832);
    ctx.fillStyle = U.rgba(ink, 0.88);
    ctx.fill();

    if (scholar) {
      /* 头巾：顶上一个小馒头，与常人区分开。
         不画手臂 —— 背手的人在画里本就看不见手，「背手」靠的就是这个留白。 */
      ctx.beginPath();
      ctx.arc(-headR * 0.10, headY - headR * 0.84, headR * 0.60, Math.PI, 0);
      ctx.strokeStyle = U.rgba(ink, 0.82);
      ctx.lineWidth = lw * 0.92;
      ctx.stroke();
    } else if (woman) {
      /* 妇人：脑后挽一个圆髻，斜插一支簪。
         髻要「实心」填出来、簪要「细线」划过去 —— 一实一虚，
         缩到 27px 也还能读出一个「女」字。 */
      ctx.beginPath();
      ctx.arc(headX - headR * 0.74, headY - headR * 0.26, headR * 0.62, 0, 6.2832);
      ctx.fillStyle = U.rgba(ink, 0.80);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(headX - headR * 1.34, headY - headR * 0.26);
      ctx.lineTo(headX - headR * 0.18, headY - headR * 0.62);
      ctx.strokeStyle = U.rgba(ink, 0.60);
      ctx.lineWidth = lw * 0.52;
      ctx.stroke();
    } else if (elder) {
      /* 老叟：拄杖。杖身斜向前、杖头一弯小钩。
         手不画（袖口遮着），杖从袖下探出点地即可。
         杖头必须画在杖身之后、且略带弧，直头会读成一根撑杆。 */
      var cTopX = shW * 1.08, cTopY = shoulderY + H * 0.165;
      var cBotX = shW * 2.55, cBotY = footY;
      ctx.strokeStyle = U.rgba(ink, 0.70);
      ctx.lineWidth = lw * 0.60;
      ctx.beginPath();
      ctx.moveTo(cBotX, cBotY);
      ctx.lineTo(cTopX, cTopY);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cTopX, cTopY);
      ctx.quadraticCurveTo(cTopX - H * 0.018, cTopY - H * 0.032, cTopX - H * 0.056, cTopY - H * 0.026);
      ctx.lineWidth = lw * 0.54;
      ctx.stroke();
    } else if (kind === 'child') {
      /* 童子：短衣，两手前伸像在牵衣角 */
      ctx.strokeStyle = U.rgba(ink, 0.56);
      ctx.lineWidth = lw * 0.80;
      ctx.beginPath();
      ctx.moveTo(shW * 0.55, shoulderY + H * 0.055);
      ctx.lineTo(shW * 2.3, shoulderY + H * 0.170 - swing * 0.6);
      ctx.stroke();
    }

    if (kind === 'bearer') {
      /* 挑担：扁担横过肩，两头挂筐。
         扁担要给一点下弯（直的一条读成飞机翅膀），筐要有口沿。 */
      var poleY = shoulderY - H * 0.060;
      var half = H * 0.40;
      ctx.strokeStyle = U.rgba(ink, 0.78);
      ctx.lineWidth = lw * 0.88;
      ctx.beginPath();
      ctx.moveTo(-half, poleY + H * 0.034);
      ctx.quadraticCurveTo(0, poleY - H * 0.028, half, poleY + H * 0.034);
      ctx.stroke();
      for (var d = -1; d <= 1; d += 2) {
        var bx = d * half * 0.90;
        ctx.lineWidth = lw * 0.66;              /* 吊绳 */
        ctx.beginPath();
        ctx.moveTo(bx, poleY + H * 0.026);
        ctx.lineTo(bx, poleY + H * 0.098);
        ctx.stroke();
        var bw = H * 0.076, bh = H * 0.046, byy = poleY + H * 0.104;
        ctx.beginPath();                        /* 筐身 */
        ctx.ellipse(bx, byy, bw, bh, 0, 0, Math.PI);
        ctx.fillStyle = U.rgba(ink, 0.58);
        ctx.fill();
        ctx.beginPath();                        /* 口沿 */
        ctx.moveTo(bx - bw * 1.10, byy);
        ctx.lineTo(bx + bw * 1.10, byy);
        ctx.lineWidth = lw * 0.80;
        ctx.strokeStyle = U.rgba(ink, 0.74);
        ctx.stroke();
      }
      /* 扶担的手 */
      ctx.strokeStyle = U.rgba(ink, 0.56);
      ctx.lineWidth = lw * 0.76;
      ctx.beginPath();
      ctx.moveTo(shW * 0.7, shoulderY + H * 0.050);
      ctx.lineTo(shW * 1.4, poleY + H * 0.016);
      ctx.stroke();
    }

    ctx.restore();
    return H;
  };

  /* ---------------------------------------------------------------
   * 自适应降级
   * ------------------------------------------------------------- */

  Alive.prototype._adapt = function (ms) {
    this._avg = this._avg * 0.88 + ms * 0.12;
    var t = this.t;
    if (t - this._lastQ < 2.0) return;          /* 迟滞：别每帧来回切档 */
    if (this._avg > 7.5 && this.q > 0) {
      this.q--; this._lastQ = t; this._avg = 0;
    } else if (this._avg < 2.4 && this.q < 2) {
      this.q++; this._lastQ = t; this._avg = 0;
    }
  };

  global.Alive = Alive;
})(typeof window !== 'undefined' ? window : globalThis);
