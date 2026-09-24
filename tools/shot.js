/*!
 * tools/shot.js —— 用无头 Chrome + CDP 给页面截图并回收控制台信息
 *
 * 用法: node tools/shot.js <url> <输出png> <等待ms> [执行JS] [宽] [高]
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

/* 无头 Chrome 的可执行文件。装在其他位置时用环境变量覆盖，例如 macOS：
   CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" */
const CHROME = process.env.CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
/* 用随机端口，避免撞上环境里已有的调试实例（实测 9333 常被占用，
   那样会把别人浏览器的页面当成我们的页面截图）。 */
const PORT = Number(process.env.SHOT_PORT) || (9411 + Math.floor(Math.random() * 500));

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const url = process.argv[2] || 'http://127.0.0.1:8788/';
  const out = process.argv[3] || 'shot.png';
  const wait = Number(process.argv[4] || 3000);
  const script = process.argv[5] || '';
  const W = Number(process.argv[6] || 1600);
  const H = Number(process.argv[7] || 900);

  const userDir = path.join(os.tmpdir(), 'kk-chrome-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + userDir,
    '--window-size=' + W + ',' + H,
    '--force-device-scale-factor=1',
    '--hide-scrollbars',
    '--disable-extensions',
    'about:blank'
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      /* 只认自己刚起的这个实例：它此时应当停在 about:blank */
      const page = list.find(t => t.type === 'page' && t.url === 'about:blank')
                || list.find(t => t.type === 'page' && /^http:\/\/127\.0\.0\.1:/.test(t.url));
      if (page) { target = page; break; }
    } catch (e) { /* 还没起来 */ }
    await sleep(250);
  }
  if (!target) {
    console.error('无法连接 Chrome（端口 ' + PORT + '）');
    try { chrome.kill(); } catch (e) {}
    process.exit(1);
  }
  console.log('调试端口 ' + PORT + '，目标 ' + target.url);

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  const logs = [];
  const errors = [];

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled') {
      const txt = (msg.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' ');
      logs.push(msg.params.type + ': ' + txt);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      if (e.level === 'error') errors.push(e.text + ' @ ' + (e.url || ''));
      else logs.push(e.level + ': ' + e.text);
    }
  });

  const send = (method, params) => new Promise((res) => {
    const id = ++msgId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params: params || {} }));
  });

  await new Promise(r => ws.addEventListener('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });

  await send('Page.navigate', { url });
  await sleep(wait);

  if (script) {
    const r = await send('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.result && r.result.result.value !== undefined) {
      console.log('EVAL →', JSON.stringify(r.result.result.value));
    }
  }

  await sleep(1200);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result && shot.result.data) {
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log('已保存截图 →', out, '(' + Math.round(Buffer.from(shot.result.data, 'base64').length / 1024) + ' KB)');
  } else {
    console.error('截图失败', JSON.stringify(shot).slice(0, 400));
  }

  if (errors.length) {
    console.log('\n=== 页面错误 (' + errors.length + ') ===');
    errors.slice(0, 20).forEach(e => console.log('  ✗ ' + String(e).slice(0, 500)));
  } else {
    console.log('\n无页面错误');
  }
  if (logs.length) {
    console.log('\n=== 控制台 ===');
    logs.slice(0, 25).forEach(l => console.log('  ' + String(l).slice(0, 300)));
  }

  ws.close();
  chrome.kill();
  await sleep(300);
  try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(errors.length ? 2 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
