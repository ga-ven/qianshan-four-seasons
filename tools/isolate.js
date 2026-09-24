/*!
 * tools/isolate.js —— 把某一个动画物体从灵动层里「隔离」出来，取四帧做对照
 *
 * 起因：整幅画里树冠摆动、水面长波都在动，直接拿两帧做像素差异，
 * 差异会被这些横向连续的背景元素填满（实测差异遍布整幅宽度），
 * 于是「瀑布在落」和「船在摇」就给不出各自的证据。
 *
 * 办法：同一时刻画两遍 —— 一遍含该物体，一遍把它从数据里摘掉。
 * 两者的差集就是**该物体占据的像素**，位置和面积都由此得到；
 * 再对 t 取两个时刻，就能把「物体自身的变化」与「背景的变化」分开：
 *
 *   A_full = 背景(tA) + 物体(tA)      A_off = 背景(tA)
 *   B_full = 背景(tB) + 物体(tB)      B_off = 背景(tB)
 *
 *   物体占据区   = diff(A_full, A_off)          → 屏幕 bbox
 *   全图变化量   = diff(A_full, B_full)
 *   背景变化量   = diff(A_off , B_off)
 *   在物体区域内：物体自身变化 = diff(A_full,B_full) - diff(A_off,B_off)
 *
 * 屏蔽方式只改页面内存里的数据（SceneData.MOTIFS / LOTUS_ZONES）或
 * 实例方法（f.alive._water），**不动源文件**，所以不会污染正式代码路径。
 *
 * 用法:
 *   node tools/isolate.js <url> <target> <outPrefix> [tA] [tB] [setupJs] [w] [h]
 *   target: waterfall | boat | sail | lotus | water | reeds
 * 产出: <outPrefix>-Afull.png / -Aoff.png / -Bfull.png / -Boff.png
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

/* 屏蔽某个 target：只改内存数据 */
function maskOn(target) {
  return `
  window.__iso = window.__iso || {};
  var S = window.SceneData, io = window.__iso;
  if ('${target}' === 'lotus') {
    io.LZ = io.LZ || S.LOTUS_ZONES; S.LOTUS_ZONES = [];
  } else if ('${target}' === 'water') {
    var al = window.KV.fx().alive;
    io.W = io.W || al._water; al._water = function(){};
  } else {
    io.M = io.M || S.MOTIFS;
    var keep = [];
    for (var i = 0; i < io.M.length; i++) if (io.M[i].type !== '${target}') keep.push(io.M[i]);
    S.MOTIFS = keep;
  }`;
}
function maskOff() {
  return `
  var S = window.SceneData, io = window.__iso || {};
  if (io.M) S.MOTIFS = io.M;
  if (io.LZ) S.LOTUS_ZONES = io.LZ;
  if (io.W) window.KV.fx().alive._water = io.W;`;
}

async function main() {
  const url = process.argv[2] || 'http://127.0.0.1:8788/';
  const target = process.argv[3] || 'waterfall';
  const prefix = process.argv[4] || 'shots/_diag/iso';
  const tA = Number(process.argv[5] || 1.0);
  const tB = Number(process.argv[6] || 2.6);
  const setup = process.argv[7] || '';
  const W = Number(process.argv[8] || 1280);
  const H = Number(process.argv[9] || 720);

  const userDir = path.join(os.tmpdir(), 'kk-iso-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir,
    '--window-size=' + W + ',' + H, '--force-device-scale-factor=1',
    '--hide-scrollbars', '--disable-extensions', 'about:blank'
  ], { stdio: 'ignore' });

  let target_ = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      const p = list.find(t => t.type === 'page' && t.url === 'about:blank');
      if (p) { target_ = p; break; }
    } catch (e) {}
    await sleep(250);
  }
  if (!target_) { console.error('无法连接 Chrome'); try { chrome.kill(); } catch (e) {} process.exit(1); }

  const ws = new WebSocket(target_.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
  });
  const send = (method, params) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) errors.push(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shoot = async (file) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    if (s.result && s.result.data) {
      fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
      console.log('  →', file);
    }
  };
  const redraw = (t) => evalJs(`(function(){ var e=window.__iso.e, f=window.__iso.f; f.alive.t=${t}; f.draw(e); return 1; })()`);

  await new Promise(r => ws.addEventListener('open', r));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(4000);

  const info = await evalJs(`(function(){
    var kv = window.KV, e = kv.engine(), f = kv.fx();
    var I = document.getElementById('intro');
    if (I) { I.classList.add('gone'); I.style.display = 'none'; }
    function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
    window.__iso = { e: e, f: f };
    return (async function(){
      ${setup}
      e.vel.x = 0; e.vel.y = 0; e.focusAnim = null; e.scaleAnim = null;
      for (var i = 0; i < 150 && e.queue && e.queue.length; i++) await sleep(70);
      /* 纯画布模式：屏蔽 DOM 覆盖层的 CSS 动画，否则差异里混着与 t 无关的东西。
         详见 tools/freeze-check.js */
      document.querySelectorAll('body *').forEach(function(el){
        if (el.tagName === 'CANVAS' || el.querySelector('canvas')) return;
        el.style.visibility = 'hidden';
      });
      window.requestAnimationFrame = function(){ return 0; };
      await sleep(300);
      f.alive.t = ${tA}; f.update = function(){}; f.draw(e);
      return { view:{scale:e.view.scale,x:e.view.x,y:e.view.y}, visW:Math.round(e.visibleW()),
               aliveOn:f.alive.on, q:f.alive.qUsed };
    })();
  })()`);
  console.log('target=' + target + ' 视口 →', JSON.stringify(info));

  console.log('A 时刻 (t=' + tA + ') 含物体：'); await shoot(prefix + '-Afull.png');
  /* 屏蔽之后**必须重绘** —— 否则画布内容没变，两帧自然一模一样，
     会得出「该物体没被画出来」的错误结论（这个坑踩过）。 */
  await evalJs('(function(){' + maskOn(target) + ' return 1; })()');
  await redraw(tA);
  console.log('A 时刻 屏蔽物体：');       await shoot(prefix + '-Aoff.png');

  await evalJs('(function(){' + maskOff() + ' return 1; })()');
  await redraw(tB);
  console.log('B 时刻 (t=' + tB + ') 含物体：'); await shoot(prefix + '-Bfull.png');
  await evalJs('(function(){' + maskOn(target) + ' return 1; })()');
  await redraw(tB);
  console.log('B 时刻 屏蔽物体：');       await shoot(prefix + '-Boff.png');

  if (errors.length) {
    console.log('\n=== 页面错误 ===');
    errors.slice(0, 8).forEach(e => console.log('  ✗ ' + String(e).slice(0, 300)));
  }
  ws.close(); chrome.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
