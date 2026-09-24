/*!
 * tools/fig-sheet.js —— 把行人单独画在一张白底上（调形用）
 *
 * 在真实画面里调人物形准是徒劳的：背景有树干、竹叶、花瓣，
 * 8 倍放大后根本分不清哪一笔是人、哪一笔是树。
 * 这里把 _figure 拎出来，在空白画布上按大比例逐帧画出来，
 * 一眼就能看出腿的摆幅、袍身的比例、扁担的长短对不对。
 *
 * 用的是页面里真正的 _figure，不是另写一份，
 * 所以「看着对」就等于「画的对」。
 *
 * 用法: node tools/fig-sheet.js [url] [输出png]
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
  const out = process.argv[3] || 'shots/_diag/fig-sheet.png';
  const SC = Number(process.argv[4] || 4.2);
  const only = process.argv[5] || '';       /* 只画某几种，逗号分隔：bearer,scholar,child,elder,woman */
  const W = 1280, H = 720;

  const userDir = path.join(os.tmpdir(), 'kk-fig-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--remote-debugging-port=' + PORT, '--user-data-dir=' + userDir,
    '--window-size=' + W + ',' + H, '--force-device-scale-factor=1',
    '--hide-scrollbars', '--disable-extensions', 'about:blank'
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
  let msgId = 0; const pending = new Map(); const errors = [];
  ws.addEventListener('message', (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
  });
  const send = (m, p) => new Promise((res) => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p || {} })); });

  await new Promise(r => ws.addEventListener('open', r));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });

  /* 等页面脚本真正就位。写死 sleep 会在机器忙时扑空，
     报出来的是「Cannot read properties of undefined」这种与真因无关的错。 */
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const r = await send('Runtime.evaluate', {
      expression: '!!(window.KV && window.KV.fx() && window.SceneData && window.SceneData.WALKERS)',
      returnByValue: true
    });
    if (r.result && r.result.result && r.result.result.value) { ready = true; break; }
    await sleep(250);
  }
  if (!ready) console.error('警告：页面脚本 15s 内没就绪，仍然继续尝试');
  await sleep(600);

  /* 停掉主循环（否则下一帧就把我们的白底覆盖了），再把三种人各画 6 个步态 */
  const expr = `(function(){
    var kv = window.KV, f = kv.fx(), S = window.SceneData;
    var cv = document.createElement('canvas');
    cv.width = ${W}; cv.height = ${H};
    cv.style.cssText = 'position:fixed;left:0;top:0;z-index:99999';
    document.body.appendChild(cv);
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#E8E2D2'; ctx.fillRect(0, 0, ${W}, ${H});
    /* 停掉主循环，免得它把 fx canvas 重画回来（我们画在新 canvas 上，互不干扰，
       但停掉更省心，也保证截图时不会有人刚好飘过） */
    window.requestAnimationFrame = function(){ return 0; };
    var pal = S.paletteAt(0);
    var kinds = ${JSON.stringify((only ? only.split(',') : ['bearer', 'scholar', 'child']).map(s => s.trim()).filter(Boolean))};
    var SC = ${SC};                     /* 放大倍数：调到人高 × SC 就是你看到的像素高 */
    var COLS = 6, CW = 190;
    /* 行高按行数自适应：定死 195 时，5 种人（老叟、妇人加进来就 5 行）会溢出画布，
       最后一行整行看不见，看起来像「_figure 没画出来」。 */
    var BASE = 170;
    var CH = Math.min(195, Math.floor((${H} - BASE - 12) / Math.max(1, kinds.length)));
    for (var r = 0; r < kinds.length; r++) {
      /* 地面参考线：脚到底有没有悬空，用眼睛量是量不准的，有线才看得清 */
      ctx.save();
      ctx.strokeStyle = 'rgba(190,120,60,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(40, BASE + r * CH + 0.5);
      ctx.lineTo(1260, BASE + r * CH + 0.5);
      ctx.stroke();
      ctx.restore();
      for (var k = 0; k < COLS; k++) {
        var ph = k / COLS * Math.PI * 2;
        ctx.save();
        ctx.translate(120 + k * CW, BASE + r * CH);
        ctx.scale(SC, SC);
        f.alive._figure(ctx, 0, 0, kinds[r], ph, 1, pal, 2);
        ctx.restore();
      }
      ctx.save();
      ctx.translate(120 + COLS * CW, BASE + r * CH);
      ctx.scale(SC, SC);
      f.alive._figure(ctx, 0, 0, kinds[r], 0.8, -1, pal, 2);
      ctx.restore();
    }
    return kinds.length + ' 行 × ' + (COLS + 1) + ' 帧，放大 ' + SC + ' 倍';
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.result && r.result.result.value) console.log('EVAL →', r.result.result.value);
  else console.error('求值失败:', JSON.stringify(r).slice(0, 500));

  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('已保存 →', out);
  }
  if (errors.length) { console.log('=== 页面错误 ==='); errors.slice(0, 8).forEach(e => console.log('  ✗ ' + String(e).slice(0, 300))); }

  ws.close(); chrome.kill();
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
