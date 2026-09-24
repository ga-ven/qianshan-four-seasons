/*!
 * tools/weather-check.js —— 天气层的「尺寸 / 覆盖」定量体检
 *
 * 为什么需要它：
 *   雨丝与雪粒的「大小」是**屏幕像素**，而它们锚定在**世界坐标**里。
 *   一旦绘制时漏乘视距 s，错的地方在默认视距（s≈0.8）几乎看不出来，
 *   却在概览（s≈0.094）被放大十倍 —— 雨丝拖成横贯画卷的长条、
 *   雪粒缩成亚像素而整体消失。这类 bug 靠肉眼在默认视距下永远抓不到，
 *   必须**跨视距量同一件事**。
 *
 * 量什么（三层隔离，互不污染）：
 *   fog / snow / rain 各自单独绘制到 fx-canvas，然后真读 alpha 通道：
 *     · cover8 / cover40 —— 覆盖率
 *     · meanA            —— 全屏平均不透明度 = 「白纱有多厚」
 *     · 连通块尺寸        —— 雪粒直径、雨丝长度（**屏幕上真实看到的**）
 *     · runV / runH      —— 最长竖向 / 横向连通段
 *   另外从粒子数组直接算世界尺寸，再除以「画卷在屏幕上的高度」得到
 *   **归一化尺寸** —— 这个比值与视距无关才是对的（世界锚定物就该如此）。
 *
 * 用法: node tools/weather-check.js [url]
 * 前置: 项目根目录跑 `python -m http.server 8788 --bind 127.0.0.1`
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* 无头 Chrome 的可执行文件。装在其他位置时用环境变量覆盖，例如 macOS：
   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" */
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.SHOT_PORT) || (9411 + Math.floor(Math.random() * 500));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const url = process.argv[2] || 'http://127.0.0.1:8788/';
  const W = 1280, H = 720;

  const userDir = path.join(os.tmpdir(), 'kk-weather-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir,
    '--window-size=' + W + ',' + H,
    '--force-device-scale-factor=1',
    '--hide-scrollbars', '--disable-extensions',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page' && t.url === 'about:blank');
      if (page) { target = page; break; }
    } catch (e) {}
    await sleep(250);
  }
  if (!target) { console.error('无法连接 Chrome'); try { chrome.kill(); } catch (e) {} process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const errors = [];

  ws.addEventListener('message', (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
  });

  const send = (method, params) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  await new Promise(r => ws.addEventListener('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(3600);

  const expr = `(function(){
    var kv = window.KV, e = kv.engine(), f = kv.fx(), S = window.SceneData;
    var I = document.getElementById('intro'); if (I) { I.classList.add('gone'); I.style.display='none'; }
    function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }

    /* ---------- 像素统计：真读 fx-canvas 的 alpha 通道 ---------- */
    function metrics(){
      var cv = f.canvas, c = f.ctx;
      var W = cv.width, H = cv.height, n = W * H;
      var d = c.getImageData(0, 0, W, H).data;
      var al = new Uint8Array(n);
      var a8 = 0, a40 = 0, sum = 0, mx = 0;
      for (var i = 0; i < n; i++) {
        var a = d[i * 4 + 3]; al[i] = a;
        if (a >= 8) a8++;
        if (a >= 40) a40++;
        sum += a; if (a > mx) mx = a;
      }
      var bestV = 0, bestH = 0;
      for (var x = 0; x < W; x++) {
        var run = 0;
        for (var y = 0; y < H; y++) {
          if (al[y * W + x] >= 40) { run++; if (run > bestV) bestV = run; } else run = 0;
        }
      }
      for (var yy = 0; yy < H; yy++) {
        var r2 = 0;
        for (var xx = 0; xx < W; xx++) {
          if (al[yy * W + xx] >= 40) { r2++; if (r2 > bestH) bestH = r2; } else r2 = 0;
        }
      }
      /* 连通块：雪粒 / 花瓣是圆点、雨丝是细长条，块尺寸就是「肉眼看到的大小」 */
      var seen = new Uint8Array(n), st = [], areas = [], wmax = 0, hmax = 0, big = 0;
      for (var q = 0; q < n; q++) {
        if (seen[q] || al[q] < 40) continue;
        st.length = 0; st.push(q); seen[q] = 1;
        var cnt = 0, mnx = 1e9, mxx = -1, mny = 1e9, mxy = -1;
        while (st.length) {
          var p = st.pop(); cnt++;
          var px = p % W, py = (p / W) | 0;
          if (px < mnx) mnx = px; if (px > mxx) mxx = px;
          if (py < mny) mny = py; if (py > mxy) mxy = py;
          if (px > 0     && !seen[p-1] && al[p-1] >= 40) { seen[p-1] = 1; st.push(p-1); }
          if (px < W - 1 && !seen[p+1] && al[p+1] >= 40) { seen[p+1] = 1; st.push(p+1); }
          if (py > 0     && !seen[p-W] && al[p-W] >= 40) { seen[p-W] = 1; st.push(p-W); }
          if (py < H - 1 && !seen[p+W] && al[p+W] >= 40) { seen[p+W] = 1; st.push(p+W); }
        }
        var bw = mxx - mnx + 1, bh = mxy - mny + 1;
        if (bw > wmax) wmax = bw; if (bh > hmax) hmax = bh;
        /* 「点状」块才用来估直径：细长条是雨丝，归 runV 管 */
        if (bw <= bh * 2 && bh <= bw * 2) { areas.push(Math.sqrt(cnt / Math.PI) * 2); big++; }
      }
      areas.sort(function (a, b) { return a - b; });
      var med = areas.length ? areas[areas.length >> 1] : 0;
      return {
        cover8: +(a8 / n).toFixed(4),
        cover40: +(a40 / n).toFixed(4),
        meanA: +(sum / n / 255).toFixed(4),
        maxA: +(mx / 255).toFixed(3),
        runV: bestV, runH: bestH,
        blobs: big, wmax: wmax,
        blobDia: areas.length ? { min: +areas[0].toFixed(1), med: +med.toFixed(1), max: +areas[areas.length - 1].toFixed(1) } : null
      };
    }

    /* ---------- 分季带取色：天气层到底把各季的「颜色」盖下去多少 ----------
       直接比较「静态层原色」与「叠加天气层之后的颜色」，
       得出每一季带上的平均饱和度损失。这是「冬天的颜色被盖住」的硬指标。 */
    function bandStats(){
      var sc = document.getElementById('scroll-canvas');
      var W = sc.width, H = sc.height, dpr = W / f.vw;
      var base = sc.getContext('2d').getImageData(0, 0, W, H).data;
      var ov = f.ctx.getImageData(0, 0, W, H).data;
      var s = e.view.scale, vx = e.view.x;
      var y0 = Math.round(H * 0.12), y1 = Math.round(H * 0.72);
      var out = [];
      for (var i = 0; i < S.SEASON_BANDS.length; i++) {
        var b = S.SEASON_BANDS[i];
        var xa = Math.max(0, Math.round((b.x0 - vx) * s * dpr));
        var xb = Math.min(W, Math.round((b.x1 - vx) * s * dpr));
        if (xb - xa < 8) { out.push({ key: b.key, px: Math.max(0, xb - xa) }); continue; }
        var n = 0, satB = 0, satM = 0, lumB = 0, lumM = 0;
        for (var y = y0; y < y1; y += 2) {
          for (var x = xa; x < xb; x += 2) {
            var p = (y * W + x) * 4;
            var R = base[p], G = base[p + 1], B = base[p + 2];
            var a = ov[p + 3] / 255;
            var R2 = R * (1 - a) + ov[p] * a,
                G2 = G * (1 - a) + ov[p + 1] * a,
                B2 = B * (1 - a) + ov[p + 2] * a;
            var mx = Math.max(R, G, B), mn = Math.min(R, G, B);
            satB += mx ? (mx - mn) / mx : 0; lumB += (R + G + B) / 3;
            var mx2 = Math.max(R2, G2, B2), mn2 = Math.min(R2, G2, B2);
            satM += mx2 ? (mx2 - mn2) / mx2 : 0; lumM += (R2 + G2 + B2) / 3;
            n++;
          }
        }
        out.push({
          key: b.key, px: xb - xa,
          satBase: +(satB / n).toFixed(3), satMix: +(satM / n).toFixed(3),
          lumBase: Math.round(lumB / n), lumMix: Math.round(lumM / n),
          satLoss: +((satB - satM) / (satB || 1) * 100).toFixed(1)
        });
      }
      return out;
    }

    /* ---------- 单颗粒子：屏幕上到底多大 ----------
       雨密的时候相邻雨丝会连成一片，runV / 连通块都被「连起来的一串」
       污染，量不到「一滴雨有多长」。所以干脆只留一颗粒子在画面上，
       它自己的包围盒就是它的屏幕尺寸 —— 与绘制实现无关，最硬的口径。
       取点时专挑画面下半部：雨天的灰纱覆盖层在上 40% 会压过阈值 40，
       雨丝一旦落在那里就会和灰纱连成一块，量出来的就不是雨丝了。 */
    function compBoxes(){
      var cv = f.canvas, c = f.ctx, W = cv.width, H = cv.height, n = W * H;
      var d = c.getImageData(0, 0, W, H).data;
      var al = new Uint8Array(n);
      for (var i = 0; i < n; i++) al[i] = d[i * 4 + 3];
      var seen = new Uint8Array(n), st = [], out = [];
      for (var q = 0; q < n; q++) {
        if (seen[q] || al[q] < 40) continue;
        st.length = 0; st.push(q); seen[q] = 1;
        var cnt = 0, mnx = 1e9, mxx = -1, mny = 1e9, mxy = -1;
        while (st.length) {
          var p = st.pop(); cnt++;
          var x = p % W, y = (p / W) | 0;
          if (x < mnx) mnx = x; if (x > mxx) mxx = x;
          if (y < mny) mny = y; if (y > mxy) mxy = y;
          if (x > 0     && !seen[p-1] && al[p-1] >= 40) { seen[p-1] = 1; st.push(p-1); }
          if (x < W - 1 && !seen[p+1] && al[p+1] >= 40) { seen[p+1] = 1; st.push(p+1); }
          if (y > 0     && !seen[p-W] && al[p-W] >= 40) { seen[p-W] = 1; st.push(p-W); }
          if (y < H - 1 && !seen[p+W] && al[p+W] >= 40) { seen[p+W] = 1; st.push(p+W); }
        }
        out.push({ w: mxx - mnx + 1, h: mxy - mny + 1, px: cnt, y0: mny, y1: mxy });
      }
      return out;
    }
    var pickWorld = { snow: null, rain: null };
    function oneOf(which){
      var arr0 = f[which], s2 = e.view.scale, vx = e.view.x, vy = e.view.y;
      var n = f.vw * f.vh;
      var lo = (which === 'rain') ? f.vh * 0.55 : 6;
      /* 雨丝是往下画的：脚下要留够位置，否则雨脚被画布下缘截断，
         量出来的包围盒只有半截（实测踩过：预期 28.9px、实测 8px）。 */
      var hi = (which === 'rain') ? f.vh - 46 : f.vh - 6;
      var cands = [];
      for (var i = 0; i < arr0.length; i++) {
        var o = arr0[i];
        var px = (o.x - vx) * s2, py = (o.y - vy) * s2;
        if (px > 6 && px < f.vw - 6 && py > lo && py < hi) cands.push(o);
      }
      if (!cands.length) return null;
      /* 取「世界里尺寸居中」的那一颗，而不是随手第一颗：
         同一视距下每次跑出来的数才可比，跨视距才看得出一致性。 */
      cands.sort(function (a, b) { return ((a.len || a.sz) || 0) - ((b.len || b.sz) || 0); });
      var pick = cands[cands.length >> 1];
      /* 量尺寸前先把这一颗画到最亮：单颗雪粒只有 1~2px，而它的 alpha 随相位
         在 0.14~0.42 之间摆，相位低时整颗粒子会低于检出阈值 40。
         改的是「亮度」不是「几何」，不影响要量的东西。 */
      if (which === 'snow') pick.ph = 1.5708; else pick.a = 1;
      var keep = [pick];
      pickWorld[which] = pick.len || pick.sz;
      var s0 = f.snow, r0 = f.rain, p0 = f.petals, b0 = f.birds, g0 = f.fog, al0 = f.alive.on, ra0 = f.rainActive;
      f.snow = []; f.rain = []; f.petals = []; f.birds = []; f.fog = []; f.alive.on = false;
      f[which] = keep;
      if (which !== 'rain') f.rainActive = 0;
      f.draw(e);
      var cs = compBoxes().filter(function (c) { return c.px < n * 0.05; });
      cs.sort(function (a, b) { return b.px - a.px; });
      var bb = cs.length ? cs[0] : null;
      f.snow = s0; f.rain = r0; f.petals = p0; f.birds = b0; f.fog = g0;
      f.alive.on = al0; f.rainActive = ra0;
      return bb;
    }

    /* ---------- 隔离绘制：只留目标层 ---------- */
    function snap(which){
      var s0 = f.snow, r0 = f.rain, p0 = f.petals, b0 = f.birds, g0 = f.fog,
          al0 = f.alive.on, ra0 = f.rainActive;
      f.snow = (which === 'snow') ? s0 : [];
      f.rain = (which === 'rain') ? r0 : [];
      f.petals = (which === 'petal') ? p0 : [];
      f.birds = [];
      f.fog = (which === 'fog') ? g0 : [];
      /* 雨天的灰纱覆盖层挂在 rainActive 上，会把其它层的读数全都污染成
         「整屏 100% 覆盖」；只要不是量雨，就先把 rainActive 摘掉。 */
      f.rainActive = (which === 'rain') ? ra0 : 0;
      f.alive.on = false;
      f.draw(e);
      var m = metrics();
      f.snow = s0; f.rain = r0; f.petals = p0; f.birds = b0; f.fog = g0;
      f.rainActive = ra0; f.alive.on = al0;
      return m;
    }

    function stat(arr, pick) {
      if (!arr.length) return null;
      var mn = Infinity, mx = -Infinity, sum = 0;
      for (var i = 0; i < arr.length; i++) {
        var v = pick(arr[i]);
        if (v < mn) mn = v; if (v > mx) mx = v; sum += v;
      }
      return { n: arr.length, min: mn, max: mx, mean: sum / arr.length };
    }
    function snapshot(arr) { var o = []; for (var i = 0; i < arr.length; i++) o.push(arr[i]); return o; }

    var rainState = false;
    async function setRain(want) {
      var btn = document.getElementById('btn-rain');
      if (rainState !== want) { btn.click(); rainState = want; }
      if (want) { for (var i = 0; i < 60 && f.rainActive < 0.985; i++) await sleep(120); }
      else      { for (var j = 0; j < 60 && f.rainActive > 0.015; j++) await sleep(120); }
    }

    async function shot(label, wx, scale, rainOn) {
      await setRain(!!rainOn);
      e.vel.x = e.vel.y = 0;
      e.focusOn(wx, 470, scale, 0);
      for (var i = 0; i < 200 && (e.focusAnim || e.scaleAnim); i++) await sleep(60);
      e.focusAnim = null; e.scaleAnim = null;
      for (var j = 0; j < 200 && e.queue && e.queue.length; j++) await sleep(60);
      await sleep(600);

      var s = e.view.scale, scrollH = S.WORLD_H * s;
      var cx = e.view.x + e.visibleW() / 2;

      var snowSz = stat(snapshot(f.snow), function (o) { return o.sz; });
      var rainLn = stat(snapshot(f.rain), function (o) { return o.len; });

      var fogM = snap('fog'), snowM = snap('snow'), rainM = snap('rain'), petM = snap('petal');
      var oneSnow = oneOf('snow'), oneRain = oneOf('rain');
      f.draw(e);                       /* 恢复真实状态，再量各季带被盖了多少色 */
      var bands = bandStats();

      return {
        case: label,
        scale: +s.toFixed(4),
        centerWorldX: Math.round(cx),
        centerSeason: S.seasonAt(cx).key,
        scrollHpx: Math.round(scrollH),
        visW: Math.round(e.visibleW()),
        rainActive: Math.round(f.rainActive * 100) / 100,
        nSnow: f.snow.length, nRain: f.rain.length, nPetal: f.petals.length,
        snowWorldDia: snowSz ? { min: +(snowSz.min * 2).toFixed(1), max: +(snowSz.max * 2).toFixed(1) } : null,
        snowDiaFrac: snowSz ? +((snowSz.max * 2) / S.WORLD_H).toFixed(5) : null,
        rainLenPx: rainLn ? { min: +rainLn.min.toFixed(1), max: +rainLn.max.toFixed(1) } : null,
        rainLenFrac: rainLn ? +(rainLn.max / S.WORLD_H).toFixed(4) : null,
        oneSnowPx: oneSnow ? oneSnow.h : null,
        oneRainPx: oneRain ? oneRain.h : null,
        oneSnowWorld: pickWorld.snow ? +pickWorld.snow.toFixed(1) : null,
        oneRainWorld: pickWorld.rain ? +pickWorld.rain.toFixed(1) : null,
        oneRainFrac: oneRain ? +(oneRain.h / (S.WORLD_H * s)).toFixed(4) : null,
        bands: bands,
        m: { fog: fogM, snow: snowM, rain: rainM, petal: petM }
      };
    }

    return (async function () {
      var out = [];
      var fit = e.fitHeightScale, ov = e.overviewScale;
      out.push(await shot('冬 @ 观察', 10400, fit, false));
      out.push(await shot('冬 @ 中间', 10400, fit * 0.45, false));
      out.push(await shot('冬 @ 概览', 10400, ov, false));
      out.push(await shot('夏 @ 观察', 4500, fit, false));
      out.push(await shot('夏 @ 观察 · 雨', 4500, fit, true));
      out.push(await shot('夏 @ 概览 · 雨', 4500, ov, true));
      return {
        vw: f.vw, vh: f.vh, dpr: f.dpr, worldH: S.WORLD_H,
        fitHeightScale: +fit.toFixed(4), overviewScale: +ov.toFixed(4),
        cases: out
      };
    })();
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  const val = r.result && r.result.result && r.result.result.value;
  if (!val) {
    console.error('求值失败:', JSON.stringify(r).slice(0, 900));
    ws.close(); chrome.kill(); process.exit(1);
  }

  console.log(`视口 ${val.vw}×${val.vh}  dpr=${val.dpr}  画卷世界高 ${val.worldH}`);
  console.log(`fitHeightScale=${val.fitHeightScale}  overviewScale=${val.overviewScale}\n`);

  for (const c of val.cases) {
    console.log(`── ${c.case}   s=${c.scale}  视口中心世界x=${c.centerWorldX}（${c.centerSeason}）  画高=${c.scrollHpx}px`);
    console.log(`   粒子：雪 ${c.nSnow} · 雨 ${c.nRain} · 花瓣 ${c.nPetal}   rainActive=${c.rainActive}`);
    if (c.snowWorldDia) console.log(`   雪：世界直径 ${c.snowWorldDia.min}~${c.snowWorldDia.max} 单位  →  画高占比 ${c.snowDiaFrac}`);
    console.log(`   屏幕实测: 雾 cover=${c.m.fog.cover8} a̅=${c.m.fog.meanA}` +
      ` | 雪 cover=${c.m.snow.cover8} a̅=${c.m.snow.meanA} 块=${c.m.snow.blobs}` +
      (c.m.snow.blobDia ? ` 直径${c.m.snow.blobDia.min}/${c.m.snow.blobDia.med}/${c.m.snow.blobDia.max}px` : '') +
      ` | 雨 cover=${c.m.rain.cover8} a̅=${c.m.rain.meanA} runV=${c.m.rain.runV}px 最长横段=${c.m.rain.runH}px` +
      ` | 花瓣 cover=${c.m.petal.cover8}`);
    if (c.rainLenPx) console.log(`   雨：世界长 ${c.rainLenPx.min}~${c.rainLenPx.max} 单位 → 画高占比 ${c.rainLenFrac}`);
    /* 单颗粒子：实测包围盒 vs 「世界尺寸 × s」的预期值。
       两者对得上（差 ~1px 抗锯齿），就证明绘制确实乘了视距；
       跨视距都对得上，就证明没有漏乘。 */
    const expS = c.oneSnowPx !== null && c.oneSnowWorld !== null
      ? `预期 ${(c.oneSnowWorld * c.scale).toFixed(2)}px` : '-';
    const expR = c.oneRainPx !== null && c.oneRainWorld !== null
      ? `预期 ${(c.oneRainWorld * c.scale).toFixed(2)}px（世界长 ${c.oneRainWorld}）` : '-';
    console.log(`   单颗粒子：雪 实测 ${c.oneSnowPx === null ? '-' : c.oneSnowPx + 'px'}，${expS}` +
      ` | 雨丝 实测 ${c.oneRainPx === null ? '-' : c.oneRainPx + 'px'}，${expR}`);
    const bs = (c.bands || []).filter(b => b.px >= 8);
    if (bs.length > 1) {
      console.log('   各季带「被天气层盖掉多少色」：' +
        bs.map(b => `${b.key} 饱和 ${b.satBase}→${b.satMix}(−${b.satLoss}%) 亮度 ${b.lumBase}→${b.lumMix}`).join(' | '));
    }
    console.log('');
  }

  console.log('★ 归一化尺寸（世界锚定 = 与视距无关；跨视距一比就知道有没有漏乘 s）：');
  for (const c of val.cases) {
    const parts = [];
    if (c.snowDiaFrac !== null) parts.push(`雪世界直径/画高=${c.snowDiaFrac}`);
    if (c.oneRainPx !== null && c.oneRainWorld) {
      parts.push(`雨丝单颗 实测${c.oneRainPx}px / 画高${c.scrollHpx}px = ${(c.oneRainPx / c.scrollHpx).toFixed(4)}` +
        `（预期 ${(c.oneRainWorld * c.scale / c.scrollHpx).toFixed(4)} = 世界长/世界高 ${(c.oneRainWorld / val.worldH).toFixed(4)}）`);
    }
    if (c.m.snow.blobDia) parts.push(`雪屏幕直径中位=${c.m.snow.blobDia.med}px`);
    parts.push(`雾白纱厚=${c.m.fog.meanA}`);
    console.log(`  ${c.case.padEnd(14)} ${parts.join('  ')}`);
  }

  /* ---- 判定：三条不变式 ---- */
  const find = (n) => val.cases.find(c => c.case.startsWith(n));
  const dryOvW = find('冬 @ 概览');
  const rainOv = find('夏 @ 概览 · 雨');
  const rainFit = find('夏 @ 观察 · 雨');
  const frostFit = find('冬 @ 观察');
  const checks = [];
  const push = (name, ok, detail) => checks.push({ name, ok, detail });

  push('雪不随缩小而消失（概览下冬季仍有雪粒）',
    dryOvW && dryOvW.nSnow >= 20, dryOvW ? `nSnow=${dryOvW.nSnow}` : 'n/a');

  /* 尺寸不变式：屏幕上的尺寸必须等于「世界尺寸 × 视距」。
     判据用绝对误差而不是比例 —— 包围盒会比几何长度多出一截：
     圆头端帽各伸出半个线宽（约 1.4px）再加约 1px 抗锯齿，合计 ~2.5px。
     这个常数在概览视距下（雨丝几何长仅 4.4px）会盖过比例误差，所以比例判据失效。
     改动前雨丝写死屏幕像素：概览下实测 41px 而预期只有 4.4px，误差 36px。 */
  const AA_TOL = 2.8;
  const sizeErr = (c, key) => {
    if (!c) return null;
    const m = key === 'rain' ? c.oneRainPx : c.oneSnowPx;
    const w = key === 'rain' ? c.oneRainWorld : c.oneSnowWorld;
    if (m === null || w === null || w === undefined) return null;
    return Math.abs(m - w * c.scale);
  };
  const fmtSize = (c, key) => {
    const m = key === 'rain' ? c.oneRainPx : c.oneSnowPx;
    const w = key === 'rain' ? c.oneRainWorld : c.oneSnowWorld;
    return `s=${c.scale}: 实测${m}px / 预期${(w * c.scale).toFixed(1)}px`;
  };
  const rFitErr = sizeErr(rainFit, 'rain'), rOvErr = sizeErr(rainOv, 'rain');
  push(`雨丝尺寸 = 世界长 × 视距（两档视距实测与预期之差 ≤ ${AA_TOL}px）`,
    rFitErr !== null && rOvErr !== null && rFitErr <= AA_TOL && rOvErr <= AA_TOL,
    [rainFit && fmtSize(rainFit, 'rain'), rainOv && fmtSize(rainOv, 'rain')].filter(Boolean).join('；'));

  push('概览下雾不再罩住冬景（冬带白纱厚 ≤ 0.004）',
    dryOvW && dryOvW.m.fog.meanA <= 0.004, dryOvW ? `a̅=${dryOvW.m.fog.meanA}（原 0.0087）` : 'n/a');

  const wBand = (dryOvW && dryOvW.bands || []).find(b => b.key === 'winter');
  push('干燥天气下冬带的颜色基本不被盖（饱和度损失 ≤ 2%）',
    !!wBand && wBand.satLoss !== undefined && wBand.satLoss <= 2,
    wBand && wBand.satLoss !== undefined ? `损失 ${wBand.satLoss}%  亮度 ${wBand.lumBase}→${wBand.lumMix}` : 'n/a');

  const sW = frostFit && frostFit.m.snow.blobDia;
  push('雪粒不过大（观察视距下直径中位 ≤ 3px 且最大 ≤ 4px）',
    !!sW && sW.med <= 3 && sW.max <= 4, sW ? `中位 ${sW.med}px 最大 ${sW.max}px（原 3.2 / 4.5）` : 'n/a');

  console.log('\n★ 判定：');
  let bad = 0;
  for (const c of checks) {
    if (!c.ok) bad++;
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name}   [${c.detail}]`);
  }
  console.log(bad ? `\n✗ ${bad} 条未通过` : '\n✓ 全部通过');

  if (errors.length) {
    console.log('\n=== 页面错误 (' + errors.length + ') ===');
    errors.slice(0, 10).forEach(e => console.log('  ✗ ' + String(e).slice(0, 400)));
  } else {
    console.log('\n无页面错误');
  }

  ws.close(); chrome.kill();
  await sleep(300);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
