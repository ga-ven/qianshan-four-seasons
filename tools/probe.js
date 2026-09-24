/*!
 * tools/probe.js —— 向页面索取运行时状态，并同时存下那一帧（自检用）
 *
 * shot.js 负责「看」，probe.js 负责「问」。
 * 两者配合：先 probe 问出行人的屏幕坐标，再决定裁哪一块去看，
 * 免得靠肉眼猜坐标裁出一张只有树的图。
 *
 * 关键点：probe 会**冻表**（f.update 置空 + 固定 f.alive.t），
 * 于是「问到的坐标」与「截下的那一帧」是同一时刻的，
 * 不会出现「坐标对得上、图上却没人」这种自欺欺人的情况。
 *
 * 用法: node tools/probe.js <url> <等待ms> <冻结秒> <输出png|-> [宽] [高]
 * 输出: JSON —— 视口信息 + 每个行人的世界/屏幕坐标
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
  const wait = Number(process.argv[3] || 4000);
  const T = Number(process.argv[4] || 1.0);
  const out = process.argv[5] || '-';
  const W = Number(process.argv[6] || 1280);
  const H = Number(process.argv[7] || 720);

  const userDir = path.join(os.tmpdir(), 'kk-probe-' + Date.now());
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
  await sleep(wait);

  const expr = `(function(){
    var kv = window.KV, e = kv.engine(), f = kv.fx();
    var intro = document.getElementById('intro');
    if (intro && intro.style.display !== 'none') {
      var b = document.getElementById('intro-go'); if (b) b.click();
    }
    function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
    return (async function(){
      /* ① 等镜头动画落定 */
      await sleep(${Math.max(0, wait - 1600)});
      e.vel.x = 0; e.vel.y = 0; e.focusAnim = null;

      /* ② 等分片队列排空。不等的话，两块基准帧之间背景还在细化，
            像素差异里会混进「山在变」，把「树在摆」的证据淹掉。 */
      for (var i = 0; i < 120 && e.queue && e.queue.length; i++) await sleep(80);

      /* ③ 停掉主循环：此刻起两块 canvas 的内容只由我们控制 */
      window.requestAnimationFrame = function(){ return 0; };
      await sleep(260);

      /* ④ 冻表 + 重绘动态层。位置由 t 唯一给出，所以帧可复现 */
      f.alive.t = ${T};
      f.update = function(){};
      f.draw(e);

      var vp = { scale: e.view.scale, x: e.view.x, y: e.view.y };
      return {
        view: vp,
        visW: Math.round(e.visibleW()),
        visH: Math.round(e.visibleH()),
        vw: f.vw, vh: f.vh,
        dockH: (document.getElementById('dock') || {}).offsetHeight || 0,
        aliveOn: f.alive.on,
        q: f.alive.qUsed,
        ms: f.alive.ms,
        drawnWalkers: f.alive.walkers,
        walkers: f.alive.probe(e)
      };
    })();
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.result && r.result.result.value) {
    console.log(JSON.stringify(r.result.result.value, null, 1));
  } else {
    console.error('求值失败:', JSON.stringify(r).slice(0, 600));
  }

  /* 冻表之后画面不再变，此时截图与上面的坐标是同一时刻 */
  if (out && out !== '-') {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) {
      fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
      console.log('已保存冻结帧 →', out);
    } else {
      console.error('截图失败');
    }
  }

  if (errors.length) {
    console.log('\n=== 页面错误 ===');
    errors.slice(0, 10).forEach(e => console.log('  ✗ ' + String(e).slice(0, 400)));
  }

  ws.close(); chrome.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
