// MiniPets' page in headless Edge, driven through the DevTools protocol with Node 22's WebSocket (no packages).
// Used by tests/settings-choices.test.js and tests/settings-pad.test.js (DMP-21).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const VIEW = path.join(ROOT, 'view');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.ttf': 'font/ttf' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// the ids of the Edge processes running with this profile folder (the folder's name is random, made by mkdtemp)
function edgeUsing(profile) {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | `
    + `Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | ForEach-Object { $_.ProcessId }`], { encoding: 'utf8' });
  return out.split(/\s+/).filter(Boolean).map(Number);
}

// ---- a small DevTools-protocol client: Node 22's WebSocket, no packages ----
async function startEdge() {
  if (!fs.existsSync(EDGE)) throw new Error(`Microsoft Edge is needed for this test and was not found at ${EDGE}`);
  const server = http.createServer((req, res) => {
    const file = path.join(VIEW, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!file.startsWith(VIEW)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (error, data) => {
      if (error) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'minipets-edge-'));
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run',
    '--no-default-browser-check', '--disable-extensions', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  // The process started here may hand over to a new browser process and exit 0 at once (Edge does since 20 Nov),
  // so the endpoint is read from the DevToolsActivePort file the browser writes in its profile, not from its
  // output. No pipes either: a browser that outlives the process started here would hold them, and the test with them.
  let launchFailed = null;
  edge.on('exit', code => { if (code) launchFailed = new Error(`Edge exited (${code})`); });
  edge.on('error', error => { launchFailed = error; });
  let devtools = null;
  for (let tries = 0; tries < 300 && !devtools; tries++) {
    if (launchFailed) throw launchFailed;
    const lines = fs.existsSync(path.join(profile, 'DevToolsActivePort'))
      ? fs.readFileSync(path.join(profile, 'DevToolsActivePort'), 'utf8').split(/\r?\n/) : [];
    if (/^\d+$/.test(lines[0] || '') && (lines[1] || '').startsWith('/devtools/browser/')) devtools = `ws://127.0.0.1:${lines[0]}${lines[1]}`;
    else await sleep(100);
  }
  if (!devtools) throw new Error('Edge did not start its DevTools endpoint');
  const debugPort = new URL(devtools).port;
  let page = null;
  for (let tries = 0; tries < 50 && !page; tries++) {
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json()).catch(() => []);
    page = targets.find(target => target.type === 'page');
    if (!page) await sleep(100);
  }
  if (!page) throw new Error('Edge opened no page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const waiting = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && waiting.has(message.id)) {
      const { resolve, reject } = waiting.get(message.id);
      waiting.delete(message.id);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, { resolve, reject });
    socket.send(JSON.stringify({ id: n, method, params }));
  });
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(`page: ${result.exceptionDetails.exception ? result.exceptionDetails.exception.description : result.exceptionDetails.text}`);
    return result.result.value;
  };
  const close = async () => {
    try { socket.close(); } catch {}
    // Ask Edge to quit, then wait until no Edge process uses this test's profile. The browser may not be the
    // process started here, its DevTools port closes before it has finished writing the profile, and its
    // helper processes outlive a kill of the main one: deleting the profile any earlier fails with EBUSY.
    try {
      const browser = new WebSocket(devtools);
      await new Promise((resolve, reject) => { browser.onopen = resolve; browser.onerror = reject; });
      browser.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    } catch {}
    let left = edgeUsing(profile);
    for (let tries = 0; tries < 30 && left.length; tries++) {
      await sleep(500);
      left = edgeUsing(profile);
    }
    if (left.length) {
      // it did not quit in 15 seconds: stop the Edge processes using this test's own profile, and nothing else
      for (const pid of left) try { process.kill(pid); } catch {}
      for (let tries = 0; tries < 10 && left.length; tries++) {
        await sleep(500);
        left = edgeUsing(profile);
      }
    }
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  return { port, send, run, close };
}

// real key presses, as the game's would be: a synthetic keydown never presses a button
const KEYS = { Enter: [13, '\r'], ArrowDown: [40], ArrowUp: [38], Escape: [27], ' ': [32, ' '] };
async function press(page, key, times = 1) {
  const [code, text] = KEYS[key];
  for (let i = 0; i < times; i++) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code, text });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: code });
  }
  await sleep(60);
}
async function click(page, selector) {
  const box = await page.run(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
    await page.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  await sleep(60);
}
async function load(page, query) {
  await page.send('Page.navigate', { url: `http://127.0.0.1:${page.port}/index.html${query}` });
  for (let tries = 0; tries < 100; tries++) {
    await sleep(100);
    const ready = await page.run('document.readyState === "complete" && !!window.dragonbornXP && !!document.getElementById("pet-choice")').catch(() => false);
    if (ready) break;
  }
  await page.run('window.__sent = []; window.settingsChanged = text => window.__sent.push(text); window.settingsClosed = () => {}; true');
}
const value = (page, id) => page.run(`document.getElementById(${JSON.stringify(id)}).dataset.value`);
const listOpen = page => page.run('!!document.querySelector(".wf-select-menu")');
// what the page last sent, split the way CardBridge's ApplySettings splits it
const lastSent = async page => (await page.run('window.__sent[window.__sent.length - 1] || ""')).split('|');

// The plugin's answer at load, built from the saved fields the way main.cpp's SettingsPayload builds it from the INI.
function payloadFrom(parts) {
  return { x: Number(parts[0]), y: Number(parts[1]), hotkey: parts[2], pet: parts[3], clock: parts[4] === '1', clockStyle: parts[5],
    scale: Number(parts[6]), raisePet: parts[7] === '1', feedHotkey: parts[8], playHotkey: parts[9], cardShape: parts[10],
    hideHotkey: parts[11], language: parts[12], hidden: false, careMoments: false };
}

module.exports = { startEdge, press, click, load, value, listOpen, lastSent, payloadFrom, sleep };
