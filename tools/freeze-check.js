/*!
 * tools/freeze-check.js —— 校验「冻表」是不是真的冻住了
 *
 * 这是所有像素证据的前提：如果冻结没生效，主循环还在跑，
 * 那么「两帧之间的差异」里就混着树在摆、水在流，
 * 后面任何「某物体在动」的结论都不成立（实测就被这个坑过：
 * 以为测到了瀑布，结果差异全在树冠带）。
 *
 * 做法：冻结之后连截 N 张（中间不做任何修改），逐字节比较。
 * 全同 ⇒ 冻结有效；一旦不同 ⇒ 冻结失效，先修冻结再谈证据。
 *
 * 用法: node tools/freeze-check.js <url> [setupJs] [n] [w] [h]
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
  const setup = process.argv[3] || '';
  const N = Number(process.argv[4] || 4);
  const W = Number(process.argv[5] || 1280);
  const H = Number(process.argv[6] || 720);
  const outDir = 'shots/_diag';

  const userDir = path.join(os.tmpdir(), 'kk-freeze-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir,
    '--window-size=' + W + ',' + H, '--force-device-scale-factor=1',
    '--hide-scrollbars', '--disable-extensions', 'about:blank'
  ], { stdio: 'ignore' });

  let page = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const l = await r.json();
      const p = l.find(t => t.type === 'page' && t.url === 'about:blank');
      if (p) { page = p; break; }
    } catch (e) {}
    await sleep(250);
  }
  if (!page) { console.error('无法连接 Chrome'); try { chrome.kill(); } catch (e) {} process.exit(1); }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const send = (method, params) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });
  const evalJs = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const cap = async (f) => {
    const s = await send('Page.captureScreenshot', { format: 'png' });
    const buf = Buffer.from(s.result.data, 'base64');
    if (f) fs.writeFileSync(f, buf);
    return buf;
  };

  await new Promise(r => ws.addEventListener('open', r));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(4000);

  const st = await evalJs(`(function(){
    var kv = window.KV, e = kv.engine(), f = kv.fx();
    var I = document.getElementById('intro');
    if (I) { I.classList.add('gone'); I.style.display = 'none'; }
    function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
    window.__fc = { e: e, f: f, ticks: 0 };
    return (async function(){
      ${setup}
      e.vel.x = 0; e.vel.y = 0; e.focusAnim = null; e.scaleAnim = null;
      for (var i = 0; i < 150 && e.queue && e.queue.length; i++) await sleep(70);
      /* 纯画布模式：DOM 覆盖层（#intro 的 riseIn/sealPulse 等 CSS 动画、
         按钮 hover、指示器）与 alive.t 无关，却会一直往像素差异里掺东西。
         实测就吃过这个亏：以为是瀑布在动，其实是 #intro 的 CSS 动画。
         只留 canvas 可见，剩下的差异才能全归给画布。 */
      var kept = 0;
      document.querySelectorAll('body *').forEach(function(el){
        if (el.tagName === 'CANVAS' || el.querySelector('canvas')) { kept++; return; }
        el.style.visibility = 'hidden';
      });
      window.__fc.keptContainers = kept;
      window.requestAnimationFrame = function(){ return 0; };
      window.__fc.rafPatched = true;
      await sleep(300);
      f.alive.t = 2.0;
      f.update = function(){};
      var realDraw = f.draw;
      window.__fc.draws = 0;
      f.draw = function(eng){ window.__fc.draws++; return realDraw.call(f, eng); };
      f.draw(e);
      return { patchedRaf: String(window.requestAnimationFrame).slice(0, 40),
               aliveT: f.alive.t, q: f.alive.qUsed, on: f.alive.on, kept: kept,
               canvases: document.querySelectorAll('canvas').length };
    })();
  })()`);
  console.log('冻结状态 →', JSON.stringify(st));

  const bufs = [];
  for (let i = 0; i < N; i++) {
    bufs.push(await cap(outDir + '/freeze-' + i + '.png'));
    await sleep(600);
  }
  const t2 = await evalJs('(function(){ return { aliveT: window.__fc.f.alive.t, draws: window.__fc.draws }; })()');
  console.log('采样后 →', JSON.stringify(t2));

  let allSame = true;
  for (let i = 1; i < bufs.length; i++) {
    const same = bufs[0].equals(bufs[i]);
    if (!same) allSame = false;
    console.log(`  帧0 vs 帧${i}: ${same ? '相同' : '不同'}  (${bufs[i].length} B)`);
  }
  if (allSame && t2 && t2.draws !== undefined && t2.draws <= 1) {
    console.log('✓ 冻结有效：无修改的情况下连续截图逐字节相同');
  } else if (allSame) {
    console.log('△ 连续截图相同，但 fx.draw 被额外调用了 ' + (t2 && t2.draws) + ' 次 —— 注意 t 是否被别处推进');
  } else {
    console.log('✗ 冻结失效：画面仍在变化，像素差异不能用作证据');
  }

  ws.close(); chrome.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(allSame ? 0 : 2);
}

main().catch(e => { console.error(e); process.exit(1); });
