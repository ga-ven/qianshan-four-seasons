/*!
 * scene-data.js —— 长卷的构图数据
 *
 * 长卷为 12000 × 900 世界单位，横向依次为 春 → 夏 → 秋 → 冬。
 * 题跋取自郭熙《林泉高致·山水训》的四时之山：
 *   春山澹冶而如笑，夏山苍翠而如滴，秋山明净而如妆，冬山惨淡而如睡。
 */
(function (global) {
  'use strict';
  var U = global.U;

  var WORLD_W = 12000;
  var WORLD_H = 900;

  /* 垂直构图线（世界坐标 y）—— 决定山、岸、水的层次。
     注意：界面底部控制台会盖住画面下缘约 150px，
     所以水面必须落在可见区内，不能把水压到最底。 */
  var LAYOUT = {
    sky: 0,
    farBase: 380,     // 远山基线
    ridgeBase: 582,   // 中景山脚
    shore: 632,       // 岸线（水陆交界）
    waterMid: 704,
    waterBottom: 776,
    ground: 840
  };

  /* 四时色调。低饱和，保持水墨气质；主调压深一档，
     否则山会显得像「浅色奶油」而失掉国画的墨骨。 */
  var PALETTES = {
    spring: {
      silk: U.hex('#F8F0E1'),
      mist: U.hex('#B5BCA6'),
      far: U.hex('#8F9E82'),
      mid: U.hex('#67825F'),
      rock: U.hex('#87876D'),
      near: U.hex('#546247'),
      ink: U.hex('#22302A'),
      accent: U.hex('#E9A6A8'),
      water: U.hex('#CBD0BC')
    },
    summer: {
      silk: U.hex('#F5EFDC'),
      mist: U.hex('#A6B491'),
      far: U.hex('#748C6A'),
      mid: U.hex('#456640'),
      rock: U.hex('#666E52'),
      near: U.hex('#384C33'),
      ink: U.hex('#16241B'),
      accent: U.hex('#E8AF6B'),
      water: U.hex('#C0C9AE')
    },
    autumn: {
      silk: U.hex('#F9F0DA'),
      mist: U.hex('#C1AA88'),
      far: U.hex('#9E8568'),
      mid: U.hex('#82532F'),
      rock: U.hex('#8A6E4A'),
      near: U.hex('#664226'),
      ink: U.hex('#2C1F13'),
      accent: U.hex('#D2662B'),
      water: U.hex('#D3C4A0')
    },
    winter: {
      silk: U.hex('#F4F3EE'),
      mist: U.hex('#BCC2C8'),
      far: U.hex('#96A0A9'),
      mid: U.hex('#5C6A73'),
      rock: U.hex('#71797F'),
      near: U.hex('#46525A'),
      ink: U.hex('#232C33'),
      accent: U.hex('#C8452F'),
      water: U.hex('#C6D0D5')
    }
  };

  /*
   * 调色板锚点：沿 x 轴线性插值，
   * 使四季之间是缓变过渡而非生硬拼接。
   */
  var PALETTE_ANCHORS = [
    { x: 0, p: PALETTES.spring },
    { x: 1500, p: PALETTES.spring },
    { x: 3200, p: PALETTES.summer },
    { x: 5800, p: PALETTES.summer },
    { x: 6800, p: PALETTES.autumn },
    { x: 8600, p: PALETTES.autumn },
    { x: 9700, p: PALETTES.winter },
    { x: WORLD_W, p: PALETTES.winter }
  ];

  function paletteAt(x) {
    var A = PALETTE_ANCHORS;
    if (x <= A[0].x) return A[0].p;
    for (var i = 1; i < A.length; i++) {
      if (x <= A[i].x) {
        var t = (x - A[i - 1].x) / (A[i].x - A[i - 1].x);
        t = t * t * (3 - 2 * t);
        var a = A[i - 1].p, b = A[i].p, out = {};
        for (var k in a) out[k] = U.mix(a[k], b[k], t);
        return out;
      }
    }
    return A[A.length - 1].p;
  }

  /* 当前的季节键（用于粒子系统 / 文案），边界处给最近的主导季 */
  var SEASON_BANDS = [
    { x0: 0, x1: 3000, key: 'spring', name: '春', motto: '春山澹冶而如笑' },
    { x0: 3000, x1: 6000, key: 'summer', name: '夏', motto: '夏山苍翠而如滴' },
    { x0: 6000, x1: 9000, key: 'autumn', name: '秋', motto: '秋山明净而如妆' },
    { x0: 9000, x1: 12000, key: 'winter', name: '冬', motto: '冬山惨淡而如睡' }
  ];

  function seasonAt(x) {
    for (var i = 0; i < SEASON_BANDS.length; i++) {
      if (x >= SEASON_BANDS[i].x0 && x < SEASON_BANDS[i].x1) return SEASON_BANDS[i];
    }
    return SEASON_BANDS[SEASON_BANDS.length - 1];
  }

  /*
   * 峰峦。
   * cx 峰心, w 半宽, h 峰高, sharp 尖峭度(1.6 圆缓 ~ 2.8 峻拔), seed 纹理种子
   * 山脊由所有峰的叠加再叠一层分形扰动生成。
   */
  var PEAKS = [
    /* — 春 · 远山含黛，平缓连绵 — */
    { cx: 180, w: 460, h: 158, sharp: 1.6, seed: 11 },
    { cx: 760, w: 540, h: 196, sharp: 1.8, seed: 12 },
    { cx: 1420, w: 400, h: 132, sharp: 1.5, seed: 13 },
    { cx: 1960, w: 620, h: 228, sharp: 2.0, seed: 14 },
    { cx: 2540, w: 470, h: 168, sharp: 1.7, seed: 15 },
    { cx: 2920, w: 360, h: 124, sharp: 1.5, seed: 16 },

    /* — 夏 · 苍翠如滴，主峰峻拔 — */
    { cx: 3280, w: 470, h: 246, sharp: 2.4, seed: 21 },
    { cx: 3860, w: 560, h: 332, sharp: 2.6, seed: 22 },
    { cx: 4400, w: 420, h: 216, sharp: 2.2, seed: 23 },
    { cx: 4960, w: 640, h: 356, sharp: 2.5, seed: 24 },
    { cx: 5520, w: 500, h: 258, sharp: 2.3, seed: 25 },
    { cx: 5920, w: 360, h: 148, sharp: 1.8, seed: 26 },

    /* — 秋 · 明净如妆，轮廓清晰 — */
    { cx: 6360, w: 500, h: 198, sharp: 1.9, seed: 31 },
    { cx: 6920, w: 430, h: 288, sharp: 2.2, seed: 32 },
    { cx: 7520, w: 660, h: 236, sharp: 1.8, seed: 33 },
    { cx: 8180, w: 460, h: 306, sharp: 2.3, seed: 34 },
    { cx: 8720, w: 400, h: 176, sharp: 1.7, seed: 35 },

    /* — 冬 · 惨淡如睡，雪山留白 — */
    { cx: 9420, w: 560, h: 276, sharp: 2.0, seed: 41 },
    { cx: 10060, w: 700, h: 338, sharp: 2.2, seed: 42 },
    { cx: 10800, w: 520, h: 226, sharp: 1.8, seed: 43 },
    { cx: 11420, w: 600, h: 286, sharp: 2.0, seed: 44 },
    { cx: 11940, w: 420, h: 176, sharp: 1.6, seed: 45 }
  ];

  /*
   * 点景。type 决定画法，x/y 为世界坐标锚点，s 为尺度，flip 水平翻转。
   * 位置是构图的一部分，必须固定。
   */
  var MOTIFS = [
    /* —— 春 —— */
    { type: 'willow', x: 480, y: 628, s: 1.05, flip: 0 },
    { type: 'willow', x: 562, y: 638, s: 0.80, flip: 1 },
    { type: 'peach', x: 1080, y: 630, s: 0.95, flip: 0 },
    { type: 'peach', x: 1212, y: 636, s: 0.72, flip: 1 },
    /* 卷首村口。原先最近的一座客栈在 x=5560 —— 读者要翻过大半个卷子
       才遇到第一处「人家」，开卷看到的是纯山水，难怪觉得没有人间烟火。
       这里补一座井、一座客栈，与既有的茅舍(1620)凑成卷首的村口；
       VILLAGERS 里对应的人（妇人/老叟/童子）就在这几笔旁边。 */
    { type: 'well', x: 1290, y: 618, s: 0.92, flip: 0 },
    { type: 'inn', x: 1430, y: 606, s: 0.98, flip: 1 },
    { type: 'cottage', x: 1620, y: 612, s: 1.00, flip: 0 },
    { type: 'boat', x: 1450, y: 700, s: 0.85, flip: 1 },
    { type: 'boat', x: 2180, y: 716, s: 1.05, flip: 0 },
    { type: 'swallow', x: 980, y: 210, s: 1.00, flip: 0 },
    { type: 'swallow', x: 1120, y: 178, s: 0.85, flip: 0 },
    { type: 'swallow', x: 1300, y: 236, s: 0.72, flip: 0 },
    { type: 'rock', x: 2760, y: 610, s: 1.00, flip: 1 },
    { type: 'willow', x: 2860, y: 630, s: 0.88, flip: 0 },

    /* —— 春 · 桃花源 ——
       陶渊明写武陵人「忽逢桃花林，夹岸数百步」而后入村，村里
       「土地平旷，屋舍俨然，有良田美池桑竹之属；阡陌交通，鸡犬相闻」。
       这里只放**人工造物**：茅舍、桑树、井、犬，以及桑树颠上的鸡。
       桃花成林交给下面的 PEACH_ZONES 批量铺，单棵摆不出「林」的气势。

       鸡的 y 是照 mulberry 的树冠高算出来的。冠叶心线在局部 -50、
       叶心最高约 -64、叶面顶约 -70；鸡的腿是画到 0 的，所以「脚」就在 m.y。
       直接把脚放在 -70 的冠尖上，鸡会**悬在叶子上方**（冠顶那几片叶又稀又淡，
       托不住一只鸡）。往下落 8 个单位，脚踩进最上面一层叶里，才像立在树颠。 */
    { type: 'farmstead', x: 1980, y: 606, s: 1.00, flip: 0 },
    { type: 'well', x: 2120, y: 620, s: 1.00, flip: 0 },
    { type: 'mulberry', x: 2260, y: 622, s: 1.00, flip: 0 },
    { type: 'hen', x: 2256, y: 560, s: 1.00, flip: 0 },
    { type: 'dog', x: 2400, y: 622, s: 1.00, flip: 1 },
    { type: 'farmstead', x: 2600, y: 608, s: 0.92, flip: 1 },
    { type: 'mulberry', x: 2680, y: 620, s: 1.00, flip: 0 },
    { type: 'hen', x: 2676, y: 558, s: 1.00, flip: 1 },

    /* —— 夏 —— */
    { type: 'pine', x: 3120, y: 606, s: 1.05, flip: 0 },
    { type: 'waterfall', x: 3934, y: 566, s: 1.15, flip: 0 },
    { type: 'rock', x: 3520, y: 614, s: 0.95, flip: 0 },
    { type: 'pine', x: 4290, y: 610, s: 0.88, flip: 1 },
    { type: 'pavilion', x: 4620, y: 604, s: 1.00, flip: 0 },
    { type: 'lotus', x: 5150, y: 706, s: 1.00, flip: 0 },
    { type: 'lotus', x: 5380, y: 722, s: 0.85, flip: 0 },
    { type: 'boat', x: 5720, y: 696, s: 0.95, flip: 1 },
    { type: 'rock', x: 5990, y: 612, s: 1.00, flip: 0 },
    { type: 'pine', x: 4880, y: 590, s: 0.70, flip: 0 },
    /* 荷塘边的酒家：题跋说「水光潋滟晴方好」，岸边得有个吃酒的去处 */
    { type: 'inn', x: 5560, y: 606, s: 1.00, flip: 1 },

    /* —— 秋 —— */
    { type: 'maple', x: 6220, y: 630, s: 1.00, flip: 0 },
    { type: 'maple', x: 6462, y: 638, s: 0.80, flip: 1 },
    /* 秋村：三户人家围着一眼井。geese 在天上（y=168）不占地面，可以重叠 */
    { type: 'farmstead', x: 6820, y: 610, s: 0.96, flip: 0 },
    { type: 'well', x: 6950, y: 618, s: 0.95, flip: 0 },
    { type: 'farmstead', x: 7090, y: 614, s: 1.00, flip: 1 },
    { type: 'farmstead', x: 7244, y: 606, s: 0.86, flip: 0 },
    { type: 'geese', x: 7060, y: 168, s: 1.00, flip: 0 },
    { type: 'pavilion', x: 7420, y: 606, s: 0.95, flip: 1 },
    { type: 'bridge', x: 7900, y: 622, s: 1.00, flip: 0 },
    /* 桥头客栈：过桥的人歇脚处，酒旗挑出来 */
    { type: 'inn', x: 8140, y: 616, s: 1.05, flip: 0 },
    { type: 'boat', x: 8340, y: 712, s: 0.90, flip: 0 },
    { type: 'rock', x: 8620, y: 610, s: 0.90, flip: 1 },
    { type: 'maple', x: 8880, y: 634, s: 0.92, flip: 0 },

    /* —— 冬 —— */
    { type: 'bare', x: 9260, y: 628, s: 1.00, flip: 0 },
    { type: 'pine', x: 9720, y: 614, s: 0.90, flip: 1 },
    { type: 'boat', x: 10240, y: 726, s: 1.00, flip: 1, fisher: 1 },
    /* 雪中人家：冬山惨淡如睡，尚有一户炊烟 */
    { type: 'farmstead', x: 10700, y: 618, s: 0.90, flip: 1 },
    { type: 'rock', x: 10860, y: 616, s: 0.95, flip: 0 },
    { type: 'bare', x: 11240, y: 634, s: 0.85, flip: 1 },
    { type: 'sail', x: 11620, y: 688, s: 0.80, flip: 0 },
    { type: 'reeds', x: 11900, y: 672, s: 1.00, flip: 0 }
  ];

  /* 芦苇/水草沿水边批量分布，用确定性随机摆放 */
  var REED_ZONES = [
    { x0: 320, x1: 880, y: 634, n: 8 },
    { x0: 2520, x1: 2960, y: 636, n: 7 },
    { x0: 5120, x1: 5580, y: 646, n: 8 },
    { x0: 8620, x1: 9080, y: 638, n: 6 },
    { x0: 11420, x1: 11980, y: 650, n: 8 }
  ];

  /* 水草/浮萍色块仅在夏季水域出现 */
  var LOTUS_ZONES = [
    { x0: 4980, x1: 5660, y: 704, n: 30 }
  ];

  /*
   * 桃花林。《桃花源记》里武陵人「缘溪行，忘路之远近，忽逢桃花林，
   * 夹岸数百步」——单棵两棵摆不出「林」的气势，要成片。
   *
   * 但桃花又**不能压在村舍上**。桃花走的是动态层（要随风摆），
   * 而动态层整层盖在静态层（屋舍、井、桑）之上 —— 一条 y=632 的花带
   * 横过整个村子，茅舍就全被花埋掉了，成了「只见花不见村」。
   * 所以拆成三片、各司其职：
   *   左右两片贴着 630 的岸线，落在村子**东西两头**（夹岸），
   *   中间那一片退到 572（村后），且用 sz 压小 ——
   *   树冠顶多够到屋脊上下，于是「村在林中、林在村后」，
   *   人间烟火还看得见，桃花源的气象也在。
   */
  var PEACH_ZONES = [
    { x0: 1596, x1: 1934, y: 630, n: 12, sz: 0.92 },   /* 西头 · 初见桃林 */
    /* 村后那片**在桑树处断开**（2160~2372 留白）：
       「鸡鸣桑树颠」的鸡立在 553，而村后林冠恰好在 524~572 这一段 ——
       连成一片的话，鸡就埋在花里了，读者只看见一团粉，看不见那只引颈的鸡。 */
    { x0: 1970, x1: 2160, y: 572, n: 5, sz: 0.52 },
    { x0: 2372, x1: 2690, y: 572, n: 7, sz: 0.52 },
    { x0: 2726, x1: 3092, y: 630, n: 13, sz: 0.88 }    /* 东头 · 夹岸数百步 */
  ];

  /*
   * 散落各处的收藏印。
   * 真迹长卷上总是钤满了历代收藏家的朱印，
   * 少了这些小红块，画面就少了一层「流传有序」的味道。
   */
  var SEALS = [
    { x: 232, y: 486, s: 1.15, rot: -3 },
    { x: 404, y: 748, s: 0.85, rot: 2 },
    { x: 1330, y: 486, s: 1.00, rot: 0 },
    { x: 1806, y: 176, s: 0.90, rot: 4 },
    { x: 2680, y: 700, s: 1.05, rot: -2 },
    { x: 3220, y: 452, s: 0.95, rot: 3 },
    { x: 4180, y: 166, s: 1.10, rot: -4 },
    { x: 5380, y: 694, s: 0.90, rot: 2 },
    { x: 6056, y: 466, s: 1.00, rot: 0 },
    { x: 7180, y: 172, s: 0.95, rot: -3 },
    { x: 8060, y: 712, s: 1.05, rot: 3 },
    { x: 9020, y: 456, s: 0.90, rot: -2 },
    { x: 9860, y: 170, s: 1.10, rot: 4 },
    { x: 11060, y: 690, s: 0.95, rot: -3 },
    { x: 11780, y: 448, s: 1.00, rot: 2 }
  ];

  /*
   * 题跋热点。点击（或按题跋导航）时弹出竖排卡片。
   */
  var INSCRIPTIONS = [
    {
      id: 'title',
      x: 640, y: 300,
      title: '千山四时',
      seal: '卷首',
      lines: ['行到水穷处', '坐看云起时'],
      by: '王维《终南别业》'
    },
    {
      id: 'spring',
      x: 1240, y: 336,
      title: '春山澹冶而如笑',
      seal: '春',
      lines: ['迟日江山丽', '春风花草香'],
      by: '杜甫《绝句二首》'
    },
    {
      id: 'summer',
      x: 4380, y: 300,
      title: '夏山苍翠而如滴',
      seal: '夏',
      lines: ['水光潋滟晴方好', '山色空蒙雨亦奇'],
      by: '苏轼《饮湖上初晴后雨》'
    },
    {
      id: 'autumn',
      x: 7560, y: 320,
      title: '秋山明净而如妆',
      seal: '秋',
      lines: ['空山新雨后', '天气晚来秋'],
      by: '王维《山居秋暝》'
    },
    {
      id: 'winter',
      x: 10420, y: 322,
      title: '冬山惨淡而如睡',
      seal: '冬',
      lines: ['孤舟蓑笠翁', '独钓寒江雪'],
      by: '柳宗元《江雪》'
    },
    {
      id: 'colophon',
      x: 11660, y: 306,
      title: '逸笔草草',
      seal: '卷尾',
      lines: ['不求形似', '聊写胸中逸气耳'],
      by: '倪瓒《答张藻仲书》'
    }
  ];

  /*
   * 行人。
   *
   * 长卷不是静态的——得有活物在里头走，画面才「有人间气」。
   * 位置完全由 (at, speed, dir, t) 决定，所以刷新、分片重建、拖动都不会变。
   *
   * 四个关键取舍（前三条都是踩过坑才定下来的）：
   *
   * ① **不要只放一个人**。只放一个的话他绝大部分时间不在视口里，
   *    用户翻半天也碰不上。这里铺 16 个，平均一屏 2 个。
   *
   * ② **起始位置要均匀铺开，不能随机**。随机撒点必然抱团：总有的挤成一堆、
   *    有的留下大段空白。下面按 ~770 的间距铺、各加一点抖动（免得整齐得
   *    像列队），最大间隔 1020 世界单位，小于默认视距的可视宽 1600。
   *
   * ③ **所有人速度齐一（都取 14）**。这是覆盖率的命门：
   *    只要速度不一致，快的人就会追上并穿过慢的人，半天之后原本均匀的
   *    间距全部乱掉——实测空窗（整屏一个行人都没有）占比高达 11%。
   *    速度齐一之后，16 个点的间距**恒久不变**，于是「任一时刻视口内
   *    至少两个行人」是可推理的保证，而不是碰运气。实测 0.00% 空窗。
   *    同速不损失动感：正反两个方向的人本来就以 28 单位/秒互相超越。
   *    步频的差别改由 kind 与索引错相承担，不靠速度差造。
   *
   * ④ 用「起始位置 at」而不是「相位 phase」。逆行者（dir=-1）的坐标是
   *    镜像出来的，相位一旦镜像就不再均匀，分层会当场失效。
   *
   * 纵向分两条道：顺卷者走远道（600~612），逆卷者走近道（618~628）。
   * 两条道上的人擦肩时一前一后，读者一眼就明白是「路上有人来往」，
   * 而不是两个人叠在一起。
   *
   * y 的取值区间也照顾了三件事：林中树脚在 583~597（前排）与 567~581（后排），
   * 行人整体压在树脚之下，才不会被人误读成「站在树杈上」；岸线在 632，
   * 所以最靠外的 628 还在陆上；底栏盖掉屏幕下缘约 150px
   * （默认视距下折合世界坐标 y ≳ 726），离得很远，不会被压住。
   */
  var WALKERS = [
    /* —— 远道：顺卷而行（dir = +1）—— */
    { kind: 'bearer', y: 606, dir: 1, speed: 14, at: 165 },
    { kind: 'child', y: 602, dir: 1, speed: 14, at: 1655 },
    { kind: 'bearer', y: 610, dir: 1, speed: 14, at: 2675 },
    { kind: 'bearer', y: 604, dir: 1, speed: 14, at: 4715 },
    { kind: 'bearer', y: 612, dir: 1, speed: 14, at: 6295 },
    { kind: 'scholar', y: 600, dir: 1, speed: 14, at: 7885 },
    { kind: 'bearer', y: 608, dir: 1, speed: 14, at: 8795 },
    { kind: 'child', y: 611, dir: 1, speed: 14, at: 10305 },
    /* —— 近道：逆卷而行（dir = -1）—— */
    { kind: 'scholar', y: 624, dir: -1, speed: 14, at: 1075 },
    { kind: 'scholar', y: 628, dir: -1, speed: 14, at: 3255 },
    { kind: 'child', y: 620, dir: -1, speed: 14, at: 4195 },
    { kind: 'scholar', y: 622, dir: -1, speed: 14, at: 5675 },
    { kind: 'child', y: 626, dir: -1, speed: 14, at: 7305 },
    { kind: 'scholar', y: 628, dir: -1, speed: 14, at: 9345 },
    { kind: 'bearer', y: 619, dir: -1, speed: 14, at: 10925 },
    { kind: 'scholar', y: 624, dir: -1, speed: 14, at: 11885 },

    /* —— 老弱妇孺 ——
       路上若只有青壮挑夫与书生，就少了「人家」的味道。
       这四位插在上面那些最大空档里（2165 / 3725 / 7595 / 11405），
       把原本 1020 的最大间隔压到 1010。
       速度仍**一律 14** —— 覆盖率那条数学保证（视口内恒 ≥2 人）靠的就是
       「速度齐一 ⇒ 间距刚性保持」，新人不能破这个规矩。
       老人走近道（靠观者）、妇人走远道，与原有分道一致。 */
    { kind: 'elder', y: 622, dir: -1, speed: 14, at: 2165 },
    { kind: 'woman', y: 608, dir: 1, speed: 14, at: 3725 },
    { kind: 'elder', y: 620, dir: -1, speed: 14, at: 7595 },
    { kind: 'woman', y: 606, dir: 1, speed: 14, at: 11405 },

    /* —— 第三轮：把老弱妇孺挪到**卷首**来 ——
       上一轮只顾着「把最大空档补匀」，结果这四位全落在 2000 之外；
       而开卷视口只有世界 x 0~1600，读者第一眼看到的仍然全是青壮。
       「视口内恒 ≥2 人」这条数学保证只管**人数**，不管**构成** ——
       所以要专门在卷首放一妇人、一童子、一老叟，占住 455/280/275 三个空档。
       速度仍一律 14（覆盖率那条保证靠的就是速度齐一 ⇒ 间距刚性）。 */
    { kind: 'woman', y: 608, dir: 1, speed: 14, at: 620 },
    { kind: 'child', y: 614, dir: 1, speed: 14, at: 900 },
    { kind: 'elder', y: 622, dir: -1, speed: 14, at: 1380 },
    /* —— 客栈 / 村舍边上再添几位，走过去时不是空房子 —— */
    { kind: 'elder', y: 622, dir: -1, speed: 14, at: 5200 },
    { kind: 'woman', y: 607, dir: 1, speed: 14, at: 6800 },
    { kind: 'woman', y: 610, dir: 1, speed: 14, at: 9825 }
  ];

  /*
   * 常住村民 —— 与 WALKERS 的区别是：这些人**不走**，就在自家门口。
   *
   * 为什么必须另起一份，而不是继续往 WALKERS 里塞人：
   * 行人的位置是 t 的函数，视口里出现谁全凭相位。想「让读者一定看得见
   * 妇人小孩」，靠加人是碰运气 —— 加得再多，也可能整批都转到了卷尾。
   * 而「村口有人」这件事不该由运气负责，它得由**构图**负责：
   * 客栈门口立着妇人、井台边站着老叟、篱下跳着童子。
   * 所以这一层是**定点**的：位置唯一由世界坐标定，与时间无关。
   *
   * amp = 0 的人是站定的（swing=0 ⇒ 不迈腿）；只有小孩给一点 amp ——
   * 原地蹦跳的孩子是活气，站着的大人若也摆腿就成了「原地踏步」，
   * 那比站着不动更假。
   */
  var VILLAGERS = [
    /* 卷首村口（井 x≈1290 / 客栈 x≈1430 / 茅舍 x≈1620） */
    { kind: 'woman', x: 1326, y: 620, dir: 1, amp: 0 },
    { kind: 'elder', x: 1500, y: 622, dir: -1, amp: 0 },
    { kind: 'child', x: 1560, y: 617, dir: 1, amp: 0.55 },
    { kind: 'woman', x: 712, y: 616, dir: 1, amp: 0 },
    /* 春 · 桃花源村（茅舍 1980 / 井 2120 / 桑 2260 / 犬 2400）——
       这一处是「屋舍俨然、鸡犬相闻」的正主，也是春季展示图的主体，
       原先只有房舍、鸡、犬，没有一个人，看着像废弃的村子。 */
    { kind: 'woman', x: 2060, y: 620, dir: 1, amp: 0 },
    { kind: 'elder', x: 2320, y: 622, dir: -1, amp: 0 },
    { kind: 'child', x: 2444, y: 616, dir: 1, amp: 0.55 },
    /* 夏 · 客栈 5560 */
    { kind: 'woman', x: 5486, y: 619, dir: -1, amp: 0 },
    { kind: 'child', x: 5624, y: 616, dir: 1, amp: 0.45 },
    /* 秋 · 村舍群 6820~7244 */
    { kind: 'elder', x: 6902, y: 621, dir: 1, amp: 0 },
    { kind: 'child', x: 7024, y: 614, dir: -1, amp: 0.60 },
    /* 秋 · 客栈 8140 */
    { kind: 'woman', x: 8266, y: 618, dir: 1, amp: 0 },
    { kind: 'elder', x: 8052, y: 623, dir: -1, amp: 0 },
    /* 冬 · 农舍 10700 */
    { kind: 'woman', x: 10430, y: 619, dir: 1, amp: 0 },
    { kind: 'elder', x: 10980, y: 622, dir: -1, amp: 0 }
  ];

  /*
   * 水的流动。行水线在世界坐标里匀速平移，再叠一层行进的光斑，
   * 于是「水在流」这件事同时有了位移与明暗两个线索。
   */
  var FLOW = {
    /* 世界单位 / 秒，向右。**全卷唯一的水流速度。**
       从前这里写 11，再让各层各乘一个系数（水线 ×1.5、暗流 ×1.85、
       长波 ×2.3、光斑 ×0.4），于是四层纹理各走各的：互相剪开的结果
       不是「更快的水」，而是「一片会闪的花纹」，眼睛不认这是流动。
       现在只留这一个 base，各层相位一律由它导出（见 alive._water）。
       34 世界px/秒 在默认视距（0.8）下约 27 屏幕px/秒 ——
       一眼就能看出水在走，又不至于像山洪。 */
    speed: 34,
    step: 26,           /* 行水线的生成间距（对齐全局网格，保证拖动时不抖） */
    shoreFoam: 0.55,    /* 沿岸浮沫浓度 */
    bobAmp: 1.9,        /* 舟的起伏幅度（世界单位） */
    bobSpeed: 0.62
  };

  /* 季节粒子配置：驱动动态层 */
  var SEASON_FX = {
    spring: { petals: 26, petalColor: '#F2B8BE', rain: 0, snow: 0, fogDensity: 0.55, birds: 3, birdsColor: '#4A5B52' },
    summer: { petals: 0, rain: 0, snow: 0, fogDensity: 0.95, birds: 2, birdsColor: '#3E5346' },
    autumn: { petals: 30, petalColor: '#E08A3C', rain: 0, snow: 0, fogDensity: 0.6, birds: 4, birdsColor: '#5A4630' },
    winter: { petals: 0, rain: 0, snow: 48, fogDensity: 0.5, birds: 1, birdsColor: '#5C6A72' }
  };

  /*
   * 时雨的强度倍率，按 x 插值。
   *
   * 江南的雨四季不是一个样子：夏雨最盛（这卷的夏季题跋正写着
   * 「山色空蒙雨亦奇」）、春雨细、秋雨疏、冬雨几乎落不下来
   * （落下来就是雪了，所以冬季反而要压到最低）。
   *
   * 用**锚点插值**而不是「按季节整段取值」：整段取值会在 3000 / 6000
   * 处雨量突然翻倍，慢慢拖过去能看见「一过界就变天」。
   */
  var RAIN_ANCHORS = [
    { x: 0, v: 0.50 },
    { x: 2400, v: 0.72 },
    { x: 3300, v: 1.40 },     /* 夏 */
    { x: 5700, v: 1.40 },
    { x: 6600, v: 0.72 },
    { x: 8800, v: 0.50 },
    { x: 9600, v: 0.26 },     /* 冬 */
    { x: WORLD_W, v: 0.22 }
  ];

  function rainMulAt(x) {
    var A = RAIN_ANCHORS;
    if (x <= A[0].x) return A[0].v;
    for (var i = 1; i < A.length; i++) {
      if (x <= A[i].x) {
        var t = (x - A[i - 1].x) / (A[i].x - A[i - 1].x);
        t = t * t * (3 - 2 * t);
        return A[i - 1].v + (A[i].v - A[i - 1].v) * t;
      }
    }
    return A[A.length - 1].v;
  }

  global.SceneData = {
    WORLD_W: WORLD_W,
    WORLD_H: WORLD_H,
    LAYOUT: LAYOUT,
    PALETTES: PALETTES,
    paletteAt: paletteAt,
    seasonAt: seasonAt,
    SEASON_BANDS: SEASON_BANDS,
    PEAKS: PEAKS,
    MOTIFS: MOTIFS,
    REED_ZONES: REED_ZONES,
    LOTUS_ZONES: LOTUS_ZONES,
    PEACH_ZONES: PEACH_ZONES,
    INSCRIPTIONS: INSCRIPTIONS,
    SEALS: SEALS,
    SEASON_FX: SEASON_FX,
    rainMulAt: rainMulAt,
    WALKERS: WALKERS,
    VILLAGERS: VILLAGERS,
    FLOW: FLOW
  };
})(typeof window !== 'undefined' ? window : globalThis);
