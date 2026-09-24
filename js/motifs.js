/*!
 * motifs.js —— 点景（树石亭桥舟雁）
 *
 * 每个点景以「着地点」为原点向上绘制，便于统一处理尺度与翻转。
 * 所有形状由 U.h1(x, seed) 驱动，保证同一位置永远画出同一棵树。
 */
(function (global) {
  'use strict';
  var U = global.U;
  var S = global.SceneData;

  /* 笔触工具：统一的墨线风格 */
  function stroke(ctx, color, alpha, w, cap) {
    ctx.strokeStyle = U.rgba(color, alpha);
    ctx.lineWidth = w;
    ctx.lineCap = cap || 'round';
    ctx.lineJoin = 'round';
  }

  /* ---------------------------------------------------------------
   * 风
   *
   * 由灵动层每帧写入 t；这里的函数只负责答「此刻这个位置风有多大」。
   * 摆幅不逐点计算，而是给整棵树加一个**剪切矩阵**
   *     ctx.transform(1, 0, -tilt, 1, 0, 0)      // x += -tilt * y
   * 树是向上画的（局部 y 为负），于是位移天然随离地高度线性增长，
   * 树根不动、树梢摆得最狠——正是真实的树。
   * 逐点算也能做到，但要改十几处坐标，且每帧多几千次运算。
   * ------------------------------------------------------------- */
  var WIND = { t: 0, amp: 1 };

  function setWind(t, amp) {
    WIND.t = t;
    if (amp !== undefined) WIND.amp = amp;
  }

  /** 某世界横坐标处的风相位，返回 [-1, 1]。
   *  两列不同波长、不同速度的正弦叠加：单频正弦会让整片林子
   *  像一块布一样「齐步走」，一眼假。 */
  function windVal(wx) {
    return Math.sin(WIND.t * 1.10 - wx * 0.0042) * 0.66
         + Math.sin(WIND.t * 0.57 - wx * 0.0016 + 1.7) * 0.34;
  }

  /** 该位置树的倾角（弧度）。0.055 rad ≈ 3.2°，再大就成被吹倒了。 */
  function windTilt(wx) { return windVal(wx) * WIND.amp * 0.055; }

  /* ---------------------------------------------------------------
   * 树
   * ------------------------------------------------------------- */

  /** 松：主干 + 数层伞状松针 */
  function pine(ctx, m, pal) {
    var sd = m.x | 0;
    var hgt = 96;
    var top = -hgt;
    var lean = (U.h1(sd, 201) - 0.5) * 16;

    /* 主干 */
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(lean * 0.4, top * 0.55, lean, top);
    stroke(ctx, pal.ink, 0.72, 3.4);
    ctx.stroke();

    /* 侧枝 + 松针层 */
    var layers = 4;
    for (var i = 0; i < layers; i++) {
      var t = 0.24 + i * 0.20;
      var y = top * (1 - t) + 4;
      var xx = lean * t;
      var dir = i % 2 === 0 ? 1 : -1;
      var reach = (30 + U.h1(sd + i * 31, 211) * 26) * (1 - t * 0.55);

      /* 该层松针：扇面排列的短弧 */
      ctx.beginPath();
      for (var b = 0; b < 9; b++) {
        var bt = b / 8;
        var ang = -Math.PI * 0.72 + bt * Math.PI * 0.44;   /* 向上张开的扇面 */
        var rr = reach * (0.55 + 0.45 * Math.sin(bt * Math.PI));
        var ex = xx + dir * (bt - 0.15) * reach * 1.5 + Math.cos(ang) * rr * 0.25;
        var ey = y + Math.sin(ang) * rr * 0.52 + (U.h1(sd + i * 17 + b, 217) - 0.5) * 7;
        ctx.moveTo(xx + dir * bt * reach * 1.35, y + 2);
        ctx.lineTo(ex, ey);
      }
      stroke(ctx, pal.ink, 0.40 + i * 0.045, 1.35);
      ctx.stroke();
    }
  }

  /** 柳：主干 + 下垂柳条 */
  function willow(ctx, m, pal) {
    var sd = m.x | 0;
    var hgt = 92;
    var top = -hgt;
    var lean = (U.h1(sd, 231) - 0.5) * 12;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(lean * 0.3, top * 0.6, lean, top);
    stroke(ctx, pal.ink, 0.70, 3.2);
    ctx.stroke();

    /* 柳条：自冠部向外抛出再垂落，越外圈越长 */
    var n = 18;
    for (var i = 0; i < n; i++) {
      var r = U.h1(sd + i * 13, 241);
      var spread = (i / (n - 1) - 0.5) * 2;            /* -1 … 1 */
      var ax = lean + spread * (32 + r * 34);
      var ay = top + 6 + U.h1(sd + i * 19, 243) * 26 + Math.abs(spread) * 14;
      var fall = 44 + U.h1(sd + i * 23, 247) * 62;
      var sway = spread * 12 + (U.h1(sd + i * 29, 251) - 0.5) * 20;

      ctx.beginPath();
      ctx.moveTo(lean * 0.9, top + 8);
      ctx.quadraticCurveTo(ax, ay - 6, ax + sway, ay + fall);
      stroke(ctx, pal.ink, 0.26 + r * 0.30, 1.05);
      ctx.stroke();

      /* 叶点：沿柳条中下段散布 */
      for (var k = 0; k < 3; k++) {
        var t = 0.38 + k * 0.22;
        var px = lean * 0.9 * (1 - t) * 2 + ax * t + sway * t * t;
        var py = (top + 8) + (ay + fall - top - 8) * t;
        ctx.beginPath();
        ctx.arc(px + (U.h1(sd + i * 31 + k * 7, 253) - 0.5) * 7,
          py + (U.h1(sd + i * 37 + k * 11, 257) - 0.5) * 7,
          1.3 + r * 1.4, 0, 6.2832);
        ctx.fillStyle = U.rgba(pal.mid, 0.26 + r * 0.26);
        ctx.fill();
      }
    }
  }

  /** 花树（桃 / 枫）：共用骨架，只换叶色 */
  function blossom(ctx, m, pal, leafColor, leafAlpha, leafSize) {
    var sd = m.x | 0;
    var hgt = 78;
    var top = -hgt;

    /* 主干与分叉 */
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-3, top * 0.55, 2, top * 0.78);
    stroke(ctx, pal.ink, 0.68, 3.0);
    ctx.stroke();

    var tips = [];
    var nb = 4;
    for (var i = 0; i < nb; i++) {
      var dir = i % 2 === 0 ? 1 : -1;
      var bx = dir * (18 + U.h1(sd + i * 37, 261) * 22);
      var by = top * (0.42 + U.h1(sd + i * 41, 263) * 0.36);
      ctx.beginPath();
      ctx.moveTo(2, top * 0.72);
      ctx.quadraticCurveTo(bx * 0.5, by * 0.9, bx, by);
      stroke(ctx, pal.ink, 0.56, 1.9);
      ctx.stroke();
      tips.push([bx, by]);
    }
    tips.push([2, top * 0.74]);

    /* 花/叶簇：以枝端为中心撒点 */
    for (var t = 0; t < tips.length; t++) {
      var tx = tips[t][0], ty = tips[t][1];
      var cnt = 16;
      for (var c = 0; c < cnt; c++) {
        var r1 = U.h1(sd + t * 101 + c * 7, 271);
        var r2 = U.h1(sd + t * 103 + c * 11, 277);
        var ang = r1 * 6.2832;
        var rad = Math.pow(r2, 0.6) * (12 + U.h1(sd + t * 107, 281) * 16);
        var px = tx + Math.cos(ang) * rad;
        var py = ty + Math.sin(ang) * rad * 0.72 - 4;
        ctx.beginPath();
        ctx.arc(px, py, leafSize * (0.6 + r1 * 0.7), 0, 6.2832);
        ctx.fillStyle = U.rgba(leafColor, leafAlpha * (0.55 + r2 * 0.45));
        ctx.fill();
      }
    }
  }

  /** 枯树：只余枝干 */
  function bare(ctx, m, pal) {
    var sd = m.x | 0;
    var hgt = 74, top = -hgt;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(5, top * 0.5, -2, top);
    stroke(ctx, pal.ink, 0.62, 2.6);
    ctx.stroke();
    for (var i = 0; i < 5; i++) {
      var dir = i % 2 ? 1 : -1;
      var y = top * (0.42 + i * 0.13);
      var ex = dir * (16 + U.h1(sd + i * 43, 291) * 26);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.quadraticCurveTo(ex * 0.55, y - 8, ex, y - 16 - U.h1(sd + i * 47, 293) * 16);
      stroke(ctx, pal.ink, 0.44, 1.4);
      ctx.stroke();
    }
  }

  /** 竹 */
  function bamboo(ctx, m, pal) {
    var sd = m.x | 0;
    for (var i = 0; i < 4; i++) {
      var bx = (i - 1.5) * 13 + (U.h1(sd + i * 53, 311) - 0.5) * 8;
      var bh = 74 + U.h1(sd + i * 59, 313) * 40;
      var leanx = (U.h1(sd + i * 61, 317) - 0.5) * 14;
      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.quadraticCurveTo(bx + leanx * 0.5, -bh * 0.5, bx + leanx, -bh);
      stroke(ctx, pal.ink, 0.62, 2.0);
      ctx.stroke();
      /* 竹叶 */
      ctx.beginPath();
      for (var l = 0; l < 5; l++) {
        var ly = -bh * (0.62 + l * 0.075);
        var dir = l % 2 ? 1 : -1;
        ctx.moveTo(bx + leanx * 0.6, ly);
        ctx.quadraticCurveTo(bx + leanx * 0.6 + dir * 12, ly - 7, bx + leanx * 0.6 + dir * 22, ly - 4);
      }
      stroke(ctx, pal.ink, 0.42, 1.25);
      ctx.stroke();
    }
  }

  /* ---------------------------------------------------------------
   * 建筑
   * ------------------------------------------------------------- */

  /** 茅舍 */
  function cottage(ctx, m, pal) {
    var w = 46, h = 26, roofH = 22;
    /* 屋顶 */
    ctx.beginPath();
    ctx.moveTo(-w, -h - roofH * 0.35);
    ctx.quadraticCurveTo(-w * 0.5, -h - roofH * 1.15, 0, -h - roofH);
    ctx.quadraticCurveTo(w * 0.5, -h - roofH * 1.15, w, -h - roofH * 0.35);
    stroke(ctx, pal.ink, 0.70, 2.3);
    ctx.stroke();
    /* 檐口 */
    ctx.beginPath();
    ctx.moveTo(-w - 5, -h - roofH * 0.32);
    ctx.lineTo(w + 5, -h - roofH * 0.32);
    stroke(ctx, pal.ink, 0.52, 1.6);
    ctx.stroke();
    /* 茅草纹 */
    ctx.beginPath();
    for (var i = 0; i < 7; i++) {
      var t = i / 6;
      var rx = -w * 0.86 + t * w * 1.72;
      ctx.moveTo(rx, -h - roofH * 0.3);
      ctx.lineTo(rx + (t - 0.5) * 12, -h - roofH * 0.86);
    }
    stroke(ctx, pal.ink, 0.26, 0.9);
    ctx.stroke();
    /* 墙身 */
    ctx.beginPath();
    ctx.moveTo(-w * 0.82, -h - roofH * 0.3);
    ctx.lineTo(-w * 0.82, 0);
    ctx.lineTo(w * 0.82, 0);
    ctx.lineTo(w * 0.82, -h - roofH * 0.3);
    stroke(ctx, pal.ink, 0.60, 1.9);
    ctx.stroke();
    /* 门 */
    ctx.beginPath();
    ctx.rect(-7, -h * 0.72, 13, h * 0.72);
    ctx.fillStyle = U.rgba(pal.ink, 0.22);
    ctx.fill();
    stroke(ctx, pal.ink, 0.5, 1.2);
    ctx.stroke();
  }

  /** 农舍：茅舍 + 篱落 + 柴堆。
   *  单画一间屋子只是「建筑」；加上篱与柴才读成「人家」。
   *  屋身直接复用 cottage 换个缩放 —— 屋顶的笔法才不会走样。 */
  function farmstead(ctx, m, pal) {
    ctx.save();
    ctx.scale(0.82, 0.82);
    cottage(ctx, m, pal);
    ctx.restore();

    /* 篱落：右手的几根细桩 + 两道横档 */
    ctx.beginPath();
    for (var f = 0; f < 5; f++) {
      var fx = 23 + f * 8;
      ctx.moveTo(fx, 0);
      ctx.lineTo(fx, -13 - (f % 2) * 2.5);
    }
    stroke(ctx, pal.ink, 0.36, 1.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(21, -10.5); ctx.lineTo(56, -10.5);
    ctx.moveTo(21, -5);    ctx.lineTo(56, -5);
    stroke(ctx, pal.ink, 0.26, 0.9);
    ctx.stroke();

    /* 柴堆：左手一垛斜柴，屋前有柴才像过日子 */
    ctx.beginPath();
    for (var c = 0; c < 4; c++) {
      ctx.moveTo(-30 - c * 2.2, 0);
      ctx.lineTo(-23 + c * 1.5, -11 - c * 2.6);
    }
    stroke(ctx, pal.ink, 0.42, 1.3);
    ctx.stroke();
  }

  /** 客栈：两层、挑出酒旗、门口一盏灯笼。
   *  长卷里的公共建筑，得让人一眼看出「能进去吃酒」——
   *  光把屋顶画大说明不了什么，要看那面**酒旗**挑出来没有。 */
  function inn(ctx, m, pal) {
    var w = 46, h1 = 26, h2 = 20, roofH = 24;
    var eave1 = -h1;              /* 一层檐口 */
    var eave2 = -h1 - h2;         /* 二层檐口 */

    /* 二层屋顶 */
    ctx.beginPath();
    ctx.moveTo(-w, eave2 - roofH * 0.32);
    ctx.quadraticCurveTo(-w * 0.5, eave2 - roofH * 1.10, 0, eave2 - roofH * 0.98);
    ctx.quadraticCurveTo(w * 0.5, eave2 - roofH * 1.10, w, eave2 - roofH * 0.32);
    stroke(ctx, pal.ink, 0.72, 2.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-w - 7, eave2 - roofH * 0.30);
    ctx.lineTo(w + 7, eave2 - roofH * 0.30);
    stroke(ctx, pal.ink, 0.54, 1.7);
    ctx.stroke();

    /* 二层墙身 + 两扇窗（有窗才是「楼」，不然只是个高盒子） */
    ctx.beginPath();
    ctx.moveTo(-w * 0.86, eave2 - roofH * 0.28);
    ctx.lineTo(-w * 0.86, eave1);
    ctx.moveTo(w * 0.86, eave2 - roofH * 0.28);
    ctx.lineTo(w * 0.86, eave1);
    stroke(ctx, pal.ink, 0.58, 1.8);
    ctx.stroke();
    for (var i = 0; i < 2; i++) {
      var wx = -w * 0.42 + i * w * 0.84;
      ctx.beginPath();
      ctx.rect(wx - 8, eave2 + 3, 16, 14);
      ctx.fillStyle = U.rgba(pal.ink, 0.20);
      ctx.fill();
      stroke(ctx, pal.ink, 0.5, 1.1);
      ctx.stroke();
    }
    /* 一层檐口：把上下两层分开 */
    ctx.beginPath();
    ctx.moveTo(-w - 8, eave1 - 2);
    ctx.lineTo(w + 8, eave1 - 2);
    stroke(ctx, pal.ink, 0.58, 1.9);
    ctx.stroke();

    /* 一层墙身 + 门 */
    ctx.beginPath();
    ctx.moveTo(-w * 0.90, eave1 - 2);
    ctx.lineTo(-w * 0.90, 0);
    ctx.lineTo(w * 0.90, 0);
    ctx.lineTo(w * 0.90, eave1 - 2);
    stroke(ctx, pal.ink, 0.62, 2.0);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(-10, eave1 + 1, 20, -eave1 - 1);
    ctx.fillStyle = U.rgba(pal.ink, 0.26);
    ctx.fill();
    stroke(ctx, pal.ink, 0.55, 1.3);
    ctx.stroke();

    /* 酒旗：右前方一根斜挑的杆 + 三角旗面。
       整卷几乎全是墨色，这面小旗是全幅少数几处暖点之一。 */
    ctx.beginPath();
    ctx.moveTo(w * 0.86, eave1 + 2);
    ctx.lineTo(w + 26, eave1 - 26);
    stroke(ctx, pal.ink, 0.60, 1.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w + 26, eave1 - 26);
    ctx.lineTo(w + 46, eave1 - 21);
    ctx.lineTo(w + 30, eave1 - 12);
    ctx.closePath();
    ctx.fillStyle = U.rgba(pal.accent, 0.62);
    ctx.fill();
    stroke(ctx, pal.ink, 0.5, 1.0);
    ctx.stroke();

    /* 门口灯笼 */
    ctx.beginPath();
    ctx.moveTo(-w * 0.90 - 4, eave1);
    ctx.lineTo(-w * 0.90 - 4, eave1 + 7);
    stroke(ctx, pal.ink, 0.45, 1.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-w * 0.90 - 4, eave1 + 11, 4.2, 5.2, 0, 0, 6.2832);
    ctx.fillStyle = U.rgba(pal.accent, 0.70);
    ctx.fill();
    stroke(ctx, pal.ink, 0.45, 1.0);
    ctx.stroke();
  }

  /** 井：井圈 + 井架 + 吊桶。村落的中心。
   *  有井才有人来打水，有人打水才有闲话 ——「人间烟火」多半从这儿起。 */
  function well(ctx, m, pal) {
    ctx.beginPath();
    ctx.ellipse(0, -4, 10, 4, 0, 0, 6.2832);
    stroke(ctx, pal.ink, 0.62, 1.7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-10, -4); ctx.lineTo(-10, 0);
    ctx.quadraticCurveTo(0, 3, 10, 0);
    ctx.lineTo(10, -4);
    stroke(ctx, pal.ink, 0.50, 1.4);
    ctx.stroke();
    /* 井架 */
    ctx.beginPath();
    ctx.moveTo(-8, -5);  ctx.lineTo(-6, -20);
    ctx.moveTo(8, -5);   ctx.lineTo(6, -20);
    ctx.moveTo(-8, -19); ctx.lineTo(8, -19);
    stroke(ctx, pal.ink, 0.56, 1.6);
    ctx.stroke();
    /* 绳与桶 */
    ctx.beginPath();
    ctx.moveTo(0, -19); ctx.lineTo(0, -11);
    stroke(ctx, pal.ink, 0.42, 1.0);
    ctx.stroke();
    ctx.beginPath();
    ctx.rect(-2.6, -11, 5.2, 4.6);
    ctx.fillStyle = U.rgba(pal.ink, 0.34);
    ctx.fill();
  }

  /** 桑树。陶渊明「鸡鸣桑树颠」——这棵树得留得出**树颠**给鸡站，
   *  所以冠的顶点定在局部 y ≈ -70。MOTIFS 里两只鸡的 y 就是照这个数
   *  算的（树锚点 y − 69），两边的数字必须对得上，不能各写各的。 */
  function mulberry(ctx, m, pal) {
    var sd = m.x | 0;
    /* 干与两处分叉 */
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-1.5, -14, -2, -30);
    ctx.moveTo(-2, -28); ctx.lineTo(-11, -40);
    ctx.moveTo(-2, -30); ctx.lineTo(7, -42);
    stroke(ctx, pal.ink, 0.62, 2.0);
    ctx.stroke();
    /* 冠：一簇卵形叶（桑叶宽厚，叶点比桃花大、比松针圆） */
    for (var i = 0; i < 16; i++) {
      var a = U.h1(sd + i * 211, 471) * 6.2832;
      var rr = 12 + U.h1(sd + i * 217, 473) * 20;
      var ex = Math.sin(a) * rr * 0.92;
      var ey = -50 + Math.cos(a) * rr * 0.45;
      var er = 4.2 + U.h1(sd + i * 223, 479) * 3.6;
      ctx.beginPath();
      ctx.ellipse(ex, ey, er, er * 0.68, a * 0.5, 0, 6.2832);
      ctx.fillStyle = U.rgba(pal.mid, 0.40);
      ctx.fill();
      stroke(ctx, pal.ink, 0.30, 0.8);
      ctx.stroke();
    }
  }

  /** 犬。取「仰头而吠」的一瞬 ——
   *  低头走路的狗只是狗，抬头张嘴的狗才是「狗吠深巷中」。 */
  function dog(ctx, m, pal) {
    /* 身躯：一条略拱的背线 */
    ctx.beginPath();
    ctx.moveTo(-13, -2);
    ctx.quadraticCurveTo(-6, -12, 4, -11);
    ctx.quadraticCurveTo(11, -10, 13, -6);
    stroke(ctx, pal.ink, 0.74, 2.1);
    ctx.stroke();
    /* 腿：前后各两笔短的，多了缩下来就是一团 */
    ctx.beginPath();
    ctx.moveTo(-11, -2); ctx.lineTo(-11, 0);
    ctx.moveTo(-6, -2);  ctx.lineTo(-6, 0);
    ctx.moveTo(9, -4);   ctx.lineTo(9, 0);
    ctx.moveTo(12, -5);  ctx.lineTo(12, 0);
    stroke(ctx, pal.ink, 0.60, 1.3);
    ctx.stroke();
    /* 颈与头，向上抬起 */
    ctx.beginPath();
    ctx.moveTo(12, -10);
    ctx.quadraticCurveTo(17, -17, 19, -21);
    stroke(ctx, pal.ink, 0.72, 1.9);
    ctx.stroke();
    /* 吻（张口的线） */
    ctx.beginPath();
    ctx.moveTo(18.4, -21.6); ctx.lineTo(23, -20.4);
    stroke(ctx, pal.ink, 0.60, 1.4);
    ctx.stroke();
    /* 立耳 */
    ctx.beginPath();
    ctx.moveTo(15.4, -15.4); ctx.lineTo(14.6, -20);
    ctx.moveTo(18, -16.4);   ctx.lineTo(18.8, -21);
    stroke(ctx, pal.ink, 0.58, 1.3);
    ctx.stroke();
    /* 翘尾 */
    ctx.beginPath();
    ctx.moveTo(-13, -3);
    ctx.quadraticCurveTo(-19, -9, -17, -15);
    stroke(ctx, pal.ink, 0.66, 1.7);
    ctx.stroke();
  }

  /** 鸡。画成「引颈而鸣」：颈伸长、头抬起、喙张开 ——
   *  「鸡鸣桑树颠」要的是那一声，不是一只蹲着的家禽。 */
  function hen(ctx, m, pal) {
    ctx.beginPath();
    ctx.ellipse(-1, -6, 8, 5.6, -0.16, 0, 6.2832);
    ctx.fillStyle = U.rgba(pal.ink, 0.55);
    ctx.fill();
    /* 引颈 */
    ctx.beginPath();
    ctx.moveTo(4, -9);
    ctx.quadraticCurveTo(8, -14, 8.4, -17);
    stroke(ctx, pal.ink, 0.66, 2.0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(9, -18.6, 3.0, 0, 6.2832);
    ctx.fillStyle = U.rgba(pal.ink, 0.62);
    ctx.fill();
    /* 冠：一点朱色，全卷难得的暖笔 */
    ctx.beginPath();
    ctx.arc(9.4, -21.6, 1.8, 0, 6.2832);
    ctx.fillStyle = U.rgba(pal.accent, 0.80);
    ctx.fill();
    /* 喙：张开（鸣的那一瞬） */
    ctx.beginPath();
    ctx.moveTo(12, -19.2); ctx.lineTo(15.6, -18.4);
    ctx.moveTo(12, -17.6); ctx.lineTo(15.2, -17.4);
    stroke(ctx, pal.ink, 0.60, 1.1);
    ctx.stroke();
    /* 尾羽 */
    ctx.beginPath();
    ctx.moveTo(-7, -8); ctx.lineTo(-14, -15);
    ctx.moveTo(-6, -7); ctx.lineTo(-13, -12);
    stroke(ctx, pal.ink, 0.56, 1.4);
    ctx.stroke();
    /* 腿 */
    ctx.beginPath();
    ctx.moveTo(-2, -1.5); ctx.lineTo(-2, 0);
    ctx.moveTo(1.5, -1.5); ctx.lineTo(1.5, 0);
    stroke(ctx, pal.ink, 0.62, 1.2);
    ctx.stroke();
  }

  /** 亭：四柱攒尖顶 */
  function pavilion(ctx, m, pal) {
    var w = 30, h = 34, roofH = 28;
    /* 攒尖顶 */
    ctx.beginPath();
    ctx.moveTo(-w - 8, -h - roofH * 0.30);
    ctx.quadraticCurveTo(-w * 0.62, -h - roofH * 1.05, 0, -h - roofH);
    ctx.quadraticCurveTo(w * 0.62, -h - roofH * 1.05, w + 8, -h - roofH * 0.30);
    stroke(ctx, pal.ink, 0.72, 2.2);
    ctx.stroke();
    /* 屋面瓦纹 */
    ctx.beginPath();
    for (var i = 1; i <= 4; i++) {
      var t = i / 5;
      ctx.moveTo(-(w + 8) * (1 - t), -h - roofH * (0.30 + t * 0.62));
      ctx.quadraticCurveTo(0, -h - roofH * (0.30 + t * 0.72 + 0.06), (w + 8) * (1 - t), -h - roofH * (0.30 + t * 0.62));
    }
    stroke(ctx, pal.ink, 0.24, 0.9);
    ctx.stroke();
    /* 宝顶 */
    ctx.beginPath();
    ctx.moveTo(0, -h - roofH); ctx.lineTo(0, -h - roofH - 7);
    stroke(ctx, pal.ink, 0.6, 1.6); ctx.stroke();
    /* 柱 */
    ctx.beginPath();
    ctx.moveTo(-w + 3, -h * 0.92); ctx.lineTo(-w + 3, 0);
    ctx.moveTo(w - 3, -h * 0.92); ctx.lineTo(w - 3, 0);
    ctx.moveTo(0, -h * 0.92); ctx.lineTo(0, 0);
    stroke(ctx, pal.ink, 0.62, 1.7); ctx.stroke();
    /* 台基 */
    ctx.beginPath();
    ctx.moveTo(-w - 6, 0); ctx.lineTo(w + 6, 0);
    stroke(ctx, pal.ink, 0.5, 2.0); ctx.stroke();
  }

  /** 石桥（拱） */
  function bridge(ctx, m, pal) {
    var w = 62, rise = 26;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.quadraticCurveTo(0, -rise * 2, w, 0);
    stroke(ctx, pal.ink, 0.68, 2.4);
    ctx.stroke();
    /* 桥面石板 */
    ctx.beginPath();
    for (var i = 1; i < 9; i++) {
      var t = i / 9;
      var bx = -w + t * w * 2;
      var by = -Math.sin(t * Math.PI) * rise * 1.28;
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, by - 7);
    }
    stroke(ctx, pal.ink, 0.34, 1.2);
    ctx.stroke();
    /* 拱洞 */
    ctx.beginPath();
    ctx.moveTo(-w * 0.42, 0);
    ctx.quadraticCurveTo(0, -rise * 0.72, w * 0.42, 0);
    stroke(ctx, pal.ink, 0.5, 1.5);
    ctx.stroke();
  }

  /** 坡石 */
  function rock(ctx, m, pal) {
    var sd = m.x | 0;
    var w = 40 + U.h1(sd, 331) * 26;
    var h = 20 + U.h1(sd, 337) * 16;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    var n = 7;
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var px = -w + t * w * 2;
      var py = -h * Math.sin(t * Math.PI) * (0.72 + U.h1(sd + i * 67, 341) * 0.5) + U.h1(sd + i * 71, 343) * 6 - 3;
      ctx.lineTo(px, py);
    }
    ctx.lineTo(w, 0);
    ctx.closePath();
    ctx.fillStyle = U.rgba(pal.rock, 0.42);
    ctx.fill();
    stroke(ctx, pal.ink, 0.48, 1.5);
    ctx.stroke();
    /* 皴 */
    ctx.beginPath();
    for (var k = 0; k < 6; k++) {
      var kx = -w * 0.6 + U.h1(sd + k * 73, 347) * w * 1.2;
      ctx.moveTo(kx, -2);
      ctx.quadraticCurveTo(kx + 4, -h * 0.45, kx + 9, -h * 0.75);
    }
    stroke(ctx, pal.ink, 0.22, 0.9);
    ctx.stroke();
  }

  /* ---------------------------------------------------------------
   * 水
   * ------------------------------------------------------------- */

  /** 小舟（可载渔翁） */
  function boat(ctx, m, pal) {
    var sd = m.x | 0;
    var w = 34;
    /* 船身：月牙 */
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.quadraticCurveTo(0, 11, w, -1);
    ctx.quadraticCurveTo(0, 5, -w, 0);
    ctx.closePath();
    ctx.fillStyle = U.rgba(pal.ink, 0.50);
    ctx.fill();
    stroke(ctx, pal.ink, 0.66, 1.4);
    ctx.stroke();
    /* 船篷 */
    ctx.beginPath();
    ctx.moveTo(-w * 0.34, 1);
    ctx.quadraticCurveTo(-w * 0.06, -13, w * 0.30, 0.5);
    stroke(ctx, pal.ink, 0.60, 1.5);
    ctx.stroke();
    /* 篷上竹纹 */
    ctx.beginPath();
    var n = 4;
    for (var i = 1; i < n; i++) {
      var t = i / n;
      var bx = -w * 0.34 + t * w * 0.64;
      var by = -Math.sin(t * Math.PI) * 9.5;
      ctx.moveTo(bx, by + 1.5);
      ctx.lineTo(bx + 1.5, by + 6);
    }
    stroke(ctx, pal.ink, 0.26, 0.85);
    ctx.stroke();

    /* 渔翁：斗笠 + 蓑衣 + 钓竿 */
    if (m.fisher) {
      var fx = -w * 0.52, fy = -2;
      ctx.beginPath();                      /* 斗笠 */
      ctx.moveTo(fx - 8, fy - 12);
      ctx.quadraticCurveTo(fx, -21, fx + 8, fy - 12);
      ctx.closePath();
      ctx.fillStyle = U.rgba(pal.ink, 0.62);
      ctx.fill();
      ctx.beginPath();                      /* 身 */
      ctx.moveTo(fx - 4.5, fy);
      ctx.lineTo(fx - 3, fy - 12);
      ctx.lineTo(fx + 3, fy - 12);
      ctx.lineTo(fx + 4.5, fy);
      ctx.closePath();
      ctx.fillStyle = U.rgba(pal.ink, 0.55);
      ctx.fill();
      ctx.beginPath();                      /* 竿 */
      ctx.moveTo(fx + 3, fy - 9);
      ctx.lineTo(fx + 30, fy - 20);
      stroke(ctx, pal.ink, 0.52, 1.0);
      ctx.stroke();
      ctx.beginPath();                      /* 垂纶 */
      ctx.moveTo(fx + 30, fy - 20);
      ctx.lineTo(fx + 32, fy + 8);
      stroke(ctx, pal.ink, 0.30, 0.7);
      ctx.stroke();
    }
  }

  /** 远帆 */
  function sail(ctx, m, pal) {
    var w = 26;
    ctx.beginPath();
    ctx.moveTo(-w, 0);
    ctx.quadraticCurveTo(0, 7, w, -1);
    ctx.quadraticCurveTo(0, 3.5, -w, 0);
    ctx.closePath();
    ctx.fillStyle = U.rgba(pal.ink, 0.42);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.lineTo(2, -34);
    stroke(ctx, pal.ink, 0.5, 1.1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(1, -32);
    ctx.quadraticCurveTo(18, -20, 3, -6);
    ctx.closePath();
    ctx.fillStyle = U.rgba(pal.silk, 0.85);
    ctx.fill();
    stroke(ctx, pal.ink, 0.5, 1.1);
    ctx.stroke();
  }

  /** 荷 */
  function lotus(ctx, m, pal) {
    var sd = m.x | 0;
    ctx.beginPath();
    ctx.ellipse(0, 0, 15 + U.h1(sd, 351) * 8, 5.5, U.h1(sd, 353) * 0.5 - 0.25, 0, 6.2832);
    ctx.fillStyle = U.rgba(pal.mid, 0.34);
    ctx.fill();
    stroke(ctx, pal.ink, 0.42, 1.1);
    ctx.stroke();
    ctx.beginPath();
    for (var i = 0; i < 5; i++) {
      var a = i / 5 * 6.2832;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 4.6);
    }
    stroke(ctx, pal.ink, 0.20, 0.7);
    ctx.stroke();
    if (U.h1(sd, 357) > 0.55) {          /* 有的荷叶旁开一朵 */
      ctx.beginPath();
      ctx.moveTo(6, -2);
      ctx.quadraticCurveTo(9, -13, 7, -17);
      stroke(ctx, pal.ink, 0.42, 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(7, -19, 3.2, 0, 6.2832);
      ctx.fillStyle = U.rgba(pal.accent, 0.72);
      ctx.fill();
    }
  }

  /** 芦苇：被风压斜的长茎，顶穗下坠，忌直立成丛 */
  function reeds(ctx, m, pal) {
    var sd = m.x | 0;
    var n = 3 + Math.round(U.h1(sd, 361) * 3);
    var wind = (U.h1(sd, 359) - 0.5) * 2;            /* 整丛的风向 */

    for (var i = 0; i < n; i++) {
      var bx = (i - (n - 1) / 2) * 7 + U.h1(sd + i * 79, 367) * 5;
      var hh = 26 + U.h1(sd + i * 83, 371) * 34;
      var bow = wind * (8 + U.h1(sd + i * 89, 373) * 16);

      ctx.beginPath();
      ctx.moveTo(bx, 0);
      ctx.quadraticCurveTo(bx + bow * 0.30, -hh * 0.62, bx + bow, -hh);
      stroke(ctx, pal.ink, 0.30 + U.h1(sd + i * 91, 377) * 0.22, 1.0);
      ctx.stroke();

      /* 叶：自茎中段斜出，短促 */
      ctx.beginPath();
      for (var l = 0; l < 2; l++) {
        var t = 0.34 + l * 0.28;
        var lx = bx + bow * t * t, ly = -hh * t;
        var dir = l ? -1 : 1;
        ctx.moveTo(lx, ly);
        ctx.quadraticCurveTo(lx + dir * 9 + bow * 0.3, ly - 5, lx + dir * 17 + bow * 0.5, ly - 1);
      }
      stroke(ctx, pal.ink, 0.24, 0.85);
      ctx.stroke();

      /* 穗：顶端偏坠的一段短线 */
      var tx = bx + bow, ty = -hh;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + wind * 5, ty - 7, tx + wind * 10, ty - 4);
      stroke(ctx, U.mix(pal.ink, pal.accent, 0.25), 0.34, 1.7);
      ctx.stroke();
    }
  }

  /** 飞瀑：自山脊倾泻而下。
   *  注意：调用时上下文已平移到着地点，故内部一律用局部坐标，
   *  但定位山脊必须回退到世界坐标（m.x / m.y 为世界坐标）。
   *
   *  要点：绝不能画成几根纯白直条——那是「柱子」不是水。
   *  要「上窄下宽、带弧度、越往下越淡」的细流，两侧压岩口的重墨，
   *  落水处点出飞沫，水才立得住。 */
  function waterfall(ctx, m, pal) {
    var lay = global.Painter.LAYERS[2];
    var wTop = global.Painter.ridgeY(m.x, lay) + 8;    /* 世界 y：瀑口 */
    var wBot = S.LAYOUT.ridgeBase - 4;                 /* 世界 y：落水处 */
    var sc = m.s || 1;
    if (wBot - wTop < 46) return;
    var sd = m.x | 0;
    var topY = (wTop - m.y) / sc;          /* → 局部坐标 */
    var botY = (wBot - m.y) / sc;
    var HH = botY - topY;

    ctx.lineCap = 'round';

    /* 岩口：瀑口两侧各压一道重墨，水才像是从石缝里挤出来的 */
    ctx.beginPath();
    ctx.moveTo(-15, topY + 6);
    ctx.quadraticCurveTo(-9, topY - 5, -3, topY + 1);
    ctx.moveTo(14, topY + 7);
    ctx.quadraticCurveTo(8, topY - 6, 2, topY + 1);
    ctx.strokeStyle = U.rgba(pal.ink, 0.62);
    ctx.lineWidth = 2.8;
    ctx.stroke();

    /* 飞瀑分「叠」——这是全幅最要紧的一处写意。
       真实的山瀑绝不是一条通到底的白带，而是被一道道岩坎截成几叠：
       每叠上宽下收、末梢没入下一道石后，总宽度自上而下渐次展开。
       逐叠画「锥形 + 弧度 + 纵向渐变」的细流填充体（不是等宽直线）。 */
    var nCasc = 3;
    for (var c = 0; c < nCasc; c++) {
      var c1 = (c + 1) / nCasc;
      var y0 = topY + HH * (c / nCasc) * 0.94;
      var y1 = topY + HH * Math.min(1, c1 * 0.94 + 0.16);   /* +0.16：与下一叠交叠，好做交叉淡入 */
      var k0 = 0.46 + c * 0.28;            /* 该叠口部宽度系数：起于石缝，细如一线 */
      var k1 = 0.46 + (c + 1) * 0.28;      /* 该叠底部宽度系数：逐叠展开 */
      var myy = (y0 + y1) / 2;
      for (var i = 0; i < 6; i++) {
        var t = (i + 0.5) / 6;
        var x0 = (t - 0.5) * 26 * k0;
        var x1 = (t - 0.5) * 26 * k1;
        var bow = (U.h1(sd + c * 13 + i * 91, 381) - 0.5) * 9;
        var wa = 0.7 + U.h1(sd + i * 97, 383) * 1.3;
        var wb = wa * (1 + c * 0.18);
        var a0 = (0.24 + U.h1(sd + c * 17 + i * 103, 391) * 0.20) * (1 - c * 0.13);
        /* 关键：两端的 stop 必须是 0。
           若首站直接给 52% 不透明度，叠口会横现一条硬边——整叠看着像贴上去的方块。 */
        var g = ctx.createLinearGradient(0, y0, 0, y1);
        g.addColorStop(0, 'rgba(253,251,244,' + (c === 0 ? a0 * 0.55 : 0).toFixed(3) + ')');
        g.addColorStop(c === 0 ? 0.14 : 0.16, 'rgba(253,251,244,' + a0.toFixed(3) + ')');
        g.addColorStop(0.78, 'rgba(253,251,244,' + (a0 * 0.82).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(253,251,244,0)');
        ctx.beginPath();
        ctx.moveTo(x0 - wa, y0);
        ctx.quadraticCurveTo((x0 + x1) / 2 + bow * 0.5 - wa * 1.5, myy, x1 + bow - wb, y1);
        ctx.lineTo(x1 + bow + wb, y1);
        ctx.quadraticCurveTo((x0 + x1) / 2 + bow * 0.5 + wa * 1.5, myy, x0 + wa, y0);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
      }

      /* 叠与叠之间：两侧各伸出石棱把水帘截断。
         缺了这一步，水就退化成一根柱子。
         三条试验过的错路：
           ① 左右对称、尖端都咬到中线 → 合成蝴蝶结；
           ② 描边勾整圈轮廓 → 变成贴上去的图形；
           ③ 用山体色填充整块 → 与山体的渐变对不上，露出一块淡矩形。
         正解是**不填充**：只用两三笔带锥度的墨石从两侧咬进来，
         再在叠口压一道横墨（岩坎的边）。水的白带自然被切断。 */
      if (c < nCasc - 1) {
        var ly = y1 - 1;
        var lwid = 13 * k1;                            /* 与末叠半宽相应 */
        /* 叠口横墨：岩坎的那道边 */
        ctx.beginPath();
        ctx.moveTo(-lwid, ly);
        ctx.quadraticCurveTo(0, ly + 2.2, lwid, ly);
        ctx.strokeStyle = U.rgba(pal.ink, 0.30);
        ctx.lineWidth = 1.6;
        ctx.stroke();
        /* 咬入的石棱：左右高低、深浅都不同，绝不对称 */
        for (var s2 = -1; s2 <= 1; s2 += 2) {
          var q = sd + c * 37 + (s2 > 0 ? 11 : 0);
          var reach = lwid * (0.55 + U.h1(q, 405) * 0.42);
          var drop2 = (U.h1(q, 411) - 0.5) * 7;
          ctx.beginPath();
          ctx.moveTo(s2 * (lwid + 9), ly - 2.6 + drop2 * 0.4);
          ctx.quadraticCurveTo(s2 * reach * 0.9, ly - 1.8 + drop2 * 0.7, s2 * reach * 0.42, ly + 1.0 + drop2);
          ctx.strokeStyle = U.rgba(pal.ink, 0.36);
          ctx.lineWidth = 1.8 + U.h1(q, 409) * 1.7;
          ctx.stroke();
          /* 石根：尖端一小点重墨，石才落地 */
          ctx.beginPath();
          ctx.arc(s2 * reach * 0.42, ly + 1.0 + drop2, 1.3 + U.h1(q, 413) * 1.4, 0, Math.PI * 2);
          ctx.fillStyle = U.rgba(pal.ink, 0.34);
          ctx.fill();
        }
      }
    }

    /* 落水水雾：末叠之下化开的一团，水潭由它托住。
       半径与浓淡都慢慢脉动 —— 一动不动的水雾读起来是一团贴纸。 */
    var pulse = 0.86 + 0.14 * Math.sin(WIND.t * 1.15 + sd * 0.01);
    var mr = 34 * pulse;
    var mist = ctx.createRadialGradient(0, botY - 3, 2, 0, botY - 3, mr);
    mist.addColorStop(0, 'rgba(253,251,244,' + (0.26 * pulse).toFixed(3) + ')');
    mist.addColorStop(0.55, 'rgba(253,251,244,' + (0.11 * pulse).toFixed(3) + ')');
    mist.addColorStop(1, 'rgba(253,251,244,0)');
    ctx.fillStyle = mist;
    ctx.beginPath();
    ctx.ellipse(0, botY - 3, mr, 12 * pulse, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 落水飞沫：底部散开的短点，水潭由此成立。
       加了轻微起伏 —— 死的水花像撒了一把米。 */
    ctx.beginPath();
    for (var k = 0; k < 34; k++) {
      var r1 = U.h1(sd + k * 107, 401), r2 = U.h1(sd + k * 109, 403);
      var fx = (r1 - 0.5) * 52;
      var fy = botY + r2 * 12 + Math.sin(WIND.t * 2.6 + k * 0.83 + sd * 0.01) * 1.4;
      ctx.moveTo(fx, fy);
      ctx.lineTo(fx + (r2 - 0.5) * 11, fy + 2.6);
    }
    ctx.strokeStyle = 'rgba(253,251,244,0.40)';
    ctx.lineWidth = 1.25;
    ctx.stroke();

    /* ---------------------------------------------------------------
     * 下落的水痕 —— 「瀑布是动的水」这句话全靠这一段
     *
     * 上面那些叠层只说明了「这里挂着一条水」，说明不了「水在往下走」。
     * 静态的白带挂在山上，看着更像一道结了冰的雪沟。
     * 所以沿瀑身撒一批细流，各自带不同相位往下行：快的追上前面的、
     * 慢的被后头赶上，一层层错开，眼睛才认账。
     *
     * 位置一律由 (世界坐标, t) 唯一给出，不用任何存下来的状态 ——
     * 否则拖动画卷、切季节、分片重建时水痕会跳。
     * ------------------------------------------------------------- */
    var nStreak = 24;
    for (var st = 0; st < nStreak; st++) {
      var q1 = U.h1(sd + st * 131, 425);      /* 速度 */
      var q2 = U.h1(sd + st * 137, 427);      /* 横向位置 */
      var q3 = U.h1(sd + st * 139, 429);      /* 长度 / 相位 */

      var prog = (WIND.t * (0.42 + q1 * 0.34) + q3 * 7.3) % 1;
      if (prog < 0) prog += 1;
      /* 只走瀑身的 0.02~0.96：入水第一印象和没入潭面那一下都不该有硬边 */
      var ly = topY + HH * (0.02 + prog * 0.94);
      /* 横向位置跟着叠层的宽度系数走，水痕才不会跑到岩壁上去 */
      var kk = 0.46 + 0.84 * ((ly - topY) / HH);
      var lx = (q2 - 0.5) * 26 * kk;
      var seg = HH * (0.042 + q3 * 0.058);
      var yA = ly, yB = Math.min(botY, ly + seg);
      if (yB - yA < 2) continue;

      /* 每三道里插一道「暗痕」。
         真实飞瀑不是一条均匀的白带，而是好几股白水夹着几道暗缝 ——
         只有亮没有暗，水痕就成了一排并排的竖条，看着还是在原地。
         明暗相间，眼睛才把它读成「东西在往下走」。 */
      var dark = (st % 3 === 0);
      var rgb = dark ? '34,48,42' : '253,251,244';
      var aa = (dark ? 0.055 + q1 * 0.075 : 0.13 + q1 * 0.19)
             * (1 - Math.abs(prog - 0.5) * 0.55);
      /* 首尾两端的 stop 必须是 0 不透明度，否则每一道水痕都是一小截硬棍 */
      var sg = ctx.createLinearGradient(0, yA, 0, yB);
      sg.addColorStop(0, 'rgba(' + rgb + ',0)');
      sg.addColorStop(0.32, 'rgba(' + rgb + ',' + aa.toFixed(3) + ')');
      sg.addColorStop(1, 'rgba(' + rgb + ',0)');
      ctx.beginPath();
      var hw = dark ? 0.9 : 1.3;
      ctx.moveTo(lx - hw - q2 * 0.9, yA);
      ctx.lineTo(lx + hw + q2 * 0.9, yB);
      ctx.strokeStyle = sg;
      ctx.lineWidth = (dark ? 1.1 : 1.6) + q1 * (dark ? 1.1 : 1.9);
      ctx.stroke();
    }
  }

  /* ---------------------------------------------------------------
   * 飞禽
   * ------------------------------------------------------------- */

  /** 燕：剪影 V 形 */
  function swallow(ctx, m, pal) {
    var sd = m.x | 0;
    var sz = 7 + U.h1(sd, 411) * 5;
    ctx.beginPath();
    ctx.moveTo(-sz, 0);
    ctx.quadraticCurveTo(-sz * 0.42, -sz * 0.86, 0, -sz * 0.16);
    ctx.quadraticCurveTo(sz * 0.42, -sz * 0.86, sz, 0);
    stroke(ctx, pal.ink, 0.62, 1.5);
    ctx.stroke();
  }

  /** 雁阵：一列渐远的「人」字 */
  function geese(ctx, m, pal) {
    var sd = m.x | 0;
    for (var i = 0; i < 7; i++) {
      var t = i / 6;
      var gx = m.x + t * 132 + (U.h1(sd + i * 113, 421) - 0.5) * 12;
      var gy = m.y - t * 34 + Math.abs(t - 0.5) * 22;
      var sz = 7.5 - t * 3.4;
      ctx.beginPath();
      ctx.moveTo(gx - sz, gy);
      ctx.quadraticCurveTo(gx - sz * 0.4, gy - sz * 0.8, gx, gy - sz * 0.14);
      ctx.quadraticCurveTo(gx + sz * 0.4, gy - sz * 0.8, gx + sz, gy);
      stroke(ctx, pal.ink, 0.46, 1.15);
      ctx.stroke();
    }
  }

  /* ---------------------------------------------------------------
   * 批量绘制
   * ------------------------------------------------------------- */

  var DRAW = {
    pine: pine, willow: willow, bare: bare, bamboo: bamboo,
    cottage: cottage, pavilion: pavilion, bridge: bridge, rock: rock,
    boat: boat, sail: sail, lotus: lotus, reeds: reeds,
    waterfall: waterfall, swallow: swallow, geese: geese,
    /* 人间烟火：屋舍井桑走**静态层**（烘焙进分片，零运行成本，
       房子本来也不该晃）；鸡犬走**灵动层**（要有一口气在） */
    farmstead: farmstead, inn: inn, well: well, mulberry: mulberry,
    dog: dog, hen: hen,
    peach: function (c, m, p) { blossom(c, m, p, p.accent, 0.62, 2.4); },
    maple: function (c, m, p) { blossom(c, m, p, p.accent, 0.66, 2.6); }
  };

  /* 由灵动层接管的类型。
     它们必须每帧重绘才谈得上「摆动」，所以静态层必须**跳过**——
     否则同一个物件会画两遍，叠出一层重影，比不动更难看。
     waterfall 也在内：静态的白带挂在山上更像一道结了冰的雪沟。
     dog / hen 进来是为了那口活气：狗在巷口仰头、鸡在桑颠引颈，
     都由 t 驱动（原地微动，不位移），仍满足「位置唯一由世界坐标定」。 */
  var ANIMATED = {
    willow: 1, peach: 1, maple: 1, pine: 1, bare: 1, bamboo: 1,
    lotus: 1, reeds: 1, boat: 1, sail: 1, waterfall: 1,
    dog: 1, hen: 1
  };

  /* 舟的单程巡航幅度（世界单位）与「峰值速度 / 水流速度」之比。
     280 × 0.9 的峰值 ≈ 30.6 世界px/秒，约合 FLOW.speed 的九成 ——
     舟比水慢一线，读作「被水推着走」，而不是「随水漂」。 */
  var NAV_A = 280;
  var NAV_SPD_RATIO = 0.9;

  /* 舟的行进量（世界坐标，+x 为下游）。
   *
   * 原先舟只有 boatBob 里那点 ±3.4 的横漂 —— 那是「拴着」，不是「在航」。
   * 现在补上真正的位移，但守两条纪律：
   *   ① 位置只由 t 与世界坐标决定，**不存任何状态**：拖动、切季节、
   *      重建分片都会算回同一处。这条是整卷的地基。
   *   ② **不许离开自己的泊位太远**。点景是按构图摆的（舟在柳下、在桥边、
   *      在苇丛外），若让它一路顺流漂到卷尾，构图就散了。
   *      所以走的是来回巡航：正弦，单程 ±280 世界单位 ——
   *      一艘小舟在自家河湾里摇出去、再摇回来。
   * 用正弦（而不是匀速三角波）是把折返处抹圆：船到端点自然减速掉头，
   * 不会出现「撞上岸」的一帧。
   * 相位由 m.x 的哈希错开，各舟不同步。 */
  function boatNav(m) {
    var F = S.FLOW || {};
    var w = (F.speed || 34) * NAV_SPD_RATIO / NAV_A;   /* 峰值速度 = A·w */
    var ph = WIND.t * w + U.h1(Math.round(m.x), 7701) * 6.283185307179586;
    return { x: Math.sin(ph) * NAV_A, v: Math.cos(ph) };
  }

  /* 舟的浮动 + 行进量。**画船与画船尾浪痕必须走同一份** ——
     两边各算一套，迟早会算出不一样的相位，船和它的浪痕就会错开，
     看着像浪痕在追别人家的船，比不动更刺眼。
     返回的 dx / dy 一律是**世界坐标**里的位移：
     船身绘制时要按自身 flip 反号（点景在镜像坐标系里画），
     浪痕在世界坐标里直接相加。 */
  function boatBob(m) {
    var ph = WIND.t * (S.FLOW ? S.FLOW.bobSpeed : 0.6) + m.x * 0.01;
    var nav = boatNav(m);
    return {
      dx: nav.x + Math.sin(ph * 0.31 + 0.7) * 3.4,   /* 行进 + 系泊横漂（船拴着，水在推它） */
      dy: Math.sin(ph) * 2.6,                        /* 随浪起伏 */
      roll: Math.sin(ph * 0.73 + 1.1) * 0.022,       /* 横摇：比起伏慢半拍，才不像在点头 */
      navDir: nav.v >= 0 ? 1 : -1,                   /* 此刻顺流还是回头，供浪痕换边 */
      navSpd: Math.abs(nav.v)                        /* 0..1，浪痕按速度收浓淡 */
    };
  }

  /**
   * 绘制世界坐标区间 [x0,x1] 内的点景。
   * @param layer 'static'（默认）跳过 ANIMATED 类型；'alive' 只画 ANIMATED 类型。
   *              两份合起来正好是全集，不会漏也不会重。
   */
  function paintAll(ctx, x0, x1, pal, layer) {
    var alive = layer === 'alive';
    var pad = 200;

    /* 岸边芦苇与水草：按区域批量生成 */
    if (alive) {
      for (var z = 0; z < S.REED_ZONES.length; z++) {
        var zn = S.REED_ZONES[z];
        if (zn.x1 < x0 - pad || zn.x0 > x1 + pad) continue;
        for (var i = 0; i < zn.n; i++) {
          var rx = zn.x0 + (zn.x1 - zn.x0) * ((i + 0.5) / zn.n) + (U.h1(i * 137 + z * 17, 431) - 0.5) * 26;
          if (rx < x0 - pad || rx > x1 + pad) continue;
          ctx.save();
          ctx.translate(rx, zn.y + (U.h1(i * 139 + z * 19, 433) - 0.5) * 12);
          var sc = 0.55 + U.h1(i * 149 + z * 23, 437) * 0.75;
          ctx.scale(sc, sc);
          /* 芦苇细软，摆得比树厉害 */
          ctx.transform(1, 0, -windTilt(rx) * 2.1, 1, 0, 0);
          reeds(ctx, { x: rx | 0 }, pal);
          ctx.restore();
        }
      }

      /* 荷叶：浮在水上，只随水轻轻打转，别用风吹的幅度 */
      for (var lz = 0; lz < S.LOTUS_ZONES.length; lz++) {
        var lzn = S.LOTUS_ZONES[lz];
        if (lzn.x1 < x0 - pad || lzn.x0 > x1 + pad) continue;
        for (var j = 0; j < lzn.n; j++) {
          var lx = lzn.x0 + (lzn.x1 - lzn.x0) * ((j + 0.5) / lzn.n) + (U.h1(j * 151 + lz * 29, 441) - 0.5) * 34;
          if (lx < x0 - pad || lx > x1 + pad) continue;
          ctx.save();
          ctx.translate(lx, lzn.y + (U.h1(j * 157 + lz * 31, 443) - 0.5) * 30);
          var ls = 0.5 + U.h1(j * 163 + lz * 37, 447) * 0.7;
          ctx.scale(ls, ls);
          /* 荷叶浮在水上：随水上下起伏 + 缓慢打转，再叠一点轻剪切。
             只给剪切的话，叶子像被钉在水面上原地晃；
             加上起伏（水在托它）与自转（水在推它），才真像浮着。
             相位里带 lx 项，一片片错开，不会整塘荷叶一起点头。 */
          var lph = WIND.t * 0.85 + lx * 0.021
                  + (U.h1(j * 167 + lz * 41, 449) - 0.5) * 3.1;
          ctx.translate(0, Math.sin(lph) * 1.9);
          ctx.rotate(Math.sin(lph * 0.47 + 1.2) * 0.11);
          ctx.transform(1, 0, -windTilt(lx) * 0.34, 1, 0, 0);
          lotus(ctx, { x: lx | 0 }, pal);
          ctx.restore();
        }
      }

      /* 桃花林：《桃花源记》「缘溪行……忽逢桃花林，夹岸数百步」。
         单棵两棵摆不出「林」的气势，所以成片铺开；位置、尺度、朝向
         都带确定性抖动，疏密才有参差，不像苗圃。
         走的是和自己摆的树同一份 windTilt —— 整片林子朝一个方向倾，
         才是「风过桃林」，各摆各的就成了七十棵独立的树。 */
      for (var pz = 0; pz < S.PEACH_ZONES.length; pz++) {
        var pzn = S.PEACH_ZONES[pz];
        if (pzn.x1 < x0 - pad || pzn.x0 > x1 + pad) continue;
        for (var pi = 0; pi < pzn.n; pi++) {
          var px = pzn.x0 + (pzn.x1 - pzn.x0) * ((pi + 0.5) / pzn.n)
                 + (U.h1(pi * 173 + pz * 43, 461) - 0.5) * 30;
          if (px < x0 - pad || px > x1 + pad) continue;
          ctx.save();
          ctx.translate(px, pzn.y + (U.h1(pi * 179 + pz * 47, 463) - 0.5) * 16);
          /* sz 是成片相对大小（村后那片压小，免得树冠盖过屋脊） */
          var ps = (pzn.sz || 1) * (0.72 + U.h1(pi * 181 + pz * 53, 467) * 0.46);
          ctx.scale(ps, ps);
          ctx.transform(1, 0, -windTilt(px) * (U.h1(pi * 191 + pz * 59, 469) > 0.5 ? -1 : 1), 1, 0, 0);
          blossom(ctx, { x: px | 0 }, pal, pal.accent, 0.60, 1.9);
          ctx.restore();
        }
      }
    }

    /* 显式点景 */
    for (var k = 0; k < S.MOTIFS.length; k++) {
      var m = S.MOTIFS[k];
      if (m.x < x0 - pad || m.x > x1 + pad) continue;
      var fn = DRAW[m.type];
      if (!fn) continue;
      if (!!ANIMATED[m.type] !== alive) continue;
      ctx.save();
      ctx.translate(m.x, m.y);
      if (m.flip) ctx.scale(-1, 1);
      var s = m.s || 1;
      ctx.scale(s, s);
      /* 让局部坐标的原点仍然是世界坐标（供 waterfall 等需要绝对位置的画法使用） */
      if (alive) {
        if (m.type === 'boat' || m.type === 'sail') {
          var bb = boatBob(m);
          /* dx / dy 是世界坐标里的位移，而此刻的坐标系可能已被 flip 镜像
             （上面那句 ctx.scale(-1, 1)）——镜像之后 +x 指向**画面左边**，
             照搬 translate(bb.dx, ...) 会让逆着画的舟「倒着走」，
             和同一片水上的其它舟方向相反。所以横向量随 flip 反号。
             dy 不受 x 镜像影响；roll 是剪切，同样要跟着镜像。 */
          ctx.translate(m.flip ? -bb.dx : bb.dx, bb.dy);
          ctx.transform(1, 0, m.flip ? -bb.roll : bb.roll, 1, 0, 0);
        } else if (m.type === 'dog' || m.type === 'hen') {
          /* 活物：一口原地活气 —— 不随风倾、也**不整体横移**。
             ① 风剪切是按树写的（x += -tilt·y，越高越歪），
                套到鸡身上，站在桑颠的鸡会被吹得飘离枝头。
             ② 整体 translate 也不行：狗的躯干横移 0.9 个单位，
                实际读出来是「在滑步」而不是「在吠」；量化上则是
                「声明竖直、却整体横移 2.2px」，会被自检判负。
                所以绕**身体重心**小幅俯仰（四肢与头一抬一压、质心钉住），
                鸡则绕**脚**做引颈的一伸一缩（脚钉在枝上）。 */
          var aph = WIND.t * (m.type === 'hen' ? 2.1 : 1.35) + m.x * 0.017;
          if (m.type === 'hen') {
            var kk = Math.max(0, Math.sin(aph));
            ctx.translate(Math.sin(aph * 0.5) * 0.35, 0);
            ctx.transform(1, 0, 0, 1 - kk * 0.075, 0, 0);
          } else {
            var dd = Math.sin(aph);
            ctx.translate(5, -9);          /* 身体重心（躯干在 x -13~23 / y -21~0） */
            ctx.rotate(dd * 0.065);
            ctx.translate(-5, 9);
          }
        } else if (m.type !== 'waterfall') {
          /* flip 过的树，局部 x 已经镜像，倾角要跟着镜像，否则逆风摆 */
          ctx.transform(1, 0, -windTilt(m.x) * (m.flip ? -1 : 1), 1, 0, 0);
        }
        /* 瀑布**不能**走这道的风剪切。
           它的局部 y 从 -234（瀑口）到 +10（落水处），剪切 x += -tilt*y
           会把瀑口横向推开十几个像素，周期约 5.7 秒地来回摆 ——
           整条瀑身在风里晃，读起来是「一匹白绸在飘」，而不是「水在落」。
           水是竖直向下的，瀑布的「动」只能来自水痕自身的下行。 */
      }
      fn(ctx, m, pal);
      ctx.restore();
    }
  }

  global.Motifs = {
    paintAll: paintAll,
    DRAW: DRAW,
    ANIMATED: ANIMATED,
    setWind: setWind,
    windVal: windVal,
    windTilt: windTilt,
    boatBob: boatBob,
    boatNav: boatNav
  };
})(typeof window !== 'undefined' ? window : globalThis);
