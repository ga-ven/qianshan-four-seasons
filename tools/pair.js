/*!
 * tools/pair.js —— 在同一个页面会话里冻出两个时刻，各截一帧（量化动画用）
 *
 * 为什么必须「同一会话」：灵动层的位置是 f(世界坐标, t)。跨会话重开会重掷
 * 首屏与分片，两次截图之间会混进「背景不一样」的噪声。同一会话里只改 t，
 * 差异就只剩「该动画自己」——这样像素差异才算证据。
 *
 * 用法:
 *   node tools/pair.js <url> <outA> <outB> <tA> <tB> [setupJs] [w] [h]
 *   setupJs: 在页面上执行的「摆视角」代码（可用 e / f 变量），如
 *            "e.focusOn(4100,470,0.95,0);"
 * 输出: JSON —— 两帧共用的视口信息 + 灵动层状态
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
  const outA = process.argv[3] || 'pair-a.png';
  const outB = process.argv[4] || 'pair-b.png';
  const tA = Number(process.argv[5] || 1.0);
  const tB = Number(process.argv[6] || 3.0);
  const setup = process.argv[7] || '';
  const W = Number(process.argv[8] || 1280);
  const H = Number(process.argv[9] || 720);

  const userDir = path.join(os.tmpdir(), 'kk-pair-' + Date.now());
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
  await sleep(4000);

  /* 第一次求值：摆视角 + 等落定 + 冻表到 tA */
  const first = `(function(){
    var kv = window.KV, e = kv.engine(), f = kv.fx();
    var I = document.getElementById('intro');
    if (I) { I.classList.add('gone'); I.style.display = 'none'; }
    function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
    window.__pair = { e: e, f: f };
    return (async function(){
      ${setup}
      e.vel.x = 0; e.vel.y = 0; e.focusAnim = null; e.scaleAnim = null;
      for (var i = 0; i < 150 && e.queue && e.queue.length; i++) await sleep(70);
      /* 纯画布模式：DOM 覆盖层（#intro 的 riseIn/sealPulse 等 CSS 动画）与 t 无关，
         却会一直往像素差异里掺东西 —— 实测会把「一块 CSS 动画」误判成
         「瀑布在动」。只留 canvas 可见，差异才全归画布。详见 tools/freeze-check.js */
      document.querySelectorAll('body *').forEach(function(el){
        if (el.tagName === 'CANVAS' || el.querySelector('canvas')) return;
        el.style.visibility = 'hidden';
      });
      /* 停主循环：此后两块画布只由我们控制 */
      window.requestAnimationFrame = function(){ return 0; };
      await sleep(300);
      f.alive.t = ${tA};
      f.update = function(){};
      f.draw(e);
      return { view:{ scale:e.view.scale, x:e.view.x, y:e.view.y }, visW:Math.round(e.visibleW()),
               visH:Math.round(e.visibleH()), aliveOn:f.alive.on, q:f.alive.qUsed,
               walkers:f.alive.walkers };
    })();
  })()`;
  let r = await send('Runtime.evaluate', { expression: first, awaitPromise: true, returnByValue: true });
  const info = (r.result && r.result.result && r.result.result.value) || null;
  if (info) console.log('两帧共用视口 →', JSON.stringify(info));

  let shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(outA, Buffer.from(shot.result.data, 'base64'));
    console.log('帧 A (t=' + tA + ') →', outA);
  }

  /* 第二次求值：只改 t，重绘动态层 */
  const second = `(function(){
    var e = window.__pair.e, f = window.__pair.f;
    f.alive.t = ${tB};
    f.draw(e);
    return { t: f.alive.t };
  })()`;
  r = await send('Runtime.evaluate', { expression: second, awaitPromise: true, returnByValue: true });
  await sleep(200);
  shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(outB, Buffer.from(shot.result.data, 'base64'));
    console.log('帧 B (t=' + tB + ') →', outB);
  }

  if (errors.length) {
    console.log('\n=== 页面错误 ===');
    errors.slice(0, 8).forEach(e => console.log('  ✗ ' + String(e).slice(0, 400)));
  }
  ws.close(); chrome.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
