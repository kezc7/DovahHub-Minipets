// DMP-21 (the suite's pad rule, 17 Nov): no native <select> on MiniPets' page. The companion, card shape, clock style
// and language are buttons that open DovahHub's list (view/theme/dropdowns.js, copied unchanged). This test runs the
// real page in headless Edge with real key and mouse input: each setting is chosen from its list, sent to the plugin in
// the field CardBridge's ApplySettings reads, and read back after a reload from the settings the plugin sends at load.
// The plugin's own side (its fields, its INI keys, its load payload) is checked against the source at the end.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const VIEW = path.join(ROOT, 'view');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.ttf': 'font/ttf' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

test('no page in view/ has a native select, and the list is DovahHub\'s, unchanged', () => {
  // markup in a page, or a select made or written by a script (comments may still name the thing they replace)
  for (const file of fs.readdirSync(VIEW).filter(name => name.endsWith('.html'))) {
    assert.doesNotMatch(read(`view/${file}`), /<select\b/i, file);
  }
  for (const file of fs.readdirSync(VIEW).filter(name => name.endsWith('.js'))) {
    assert.doesNotMatch(read(`view/${file}`), /createElement\(\s*['"]select['"]\s*\)|['"`]<select\b|new Option\(/i, file);
  }
  const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(VIEW, 'theme', file))).digest('hex');
  assert.equal(sha('dropdowns.js'), 'fc6808025309ab2dfa72e893305aae719d1182a768cdf055f5fe50114ac32653');
  assert.equal(sha('dropdowns.css'), 'a8c7e1d0cf3ba62753b511def846d561c5604c371582ad525bacb9db3e42795d');
  assert.match(read('third_party/dovah-api/SOURCE'), /view\/theme\/dropdowns\.js\s+DovahHub 8c5d9fe/);
  assert.match(read('third_party/dovah-api/SOURCE'), /view\/theme\/dropdowns\.css\s+DovahHub 8c5d9fe/);
  assert.match(read('.gitattributes'), /view\/theme\/dropdowns\.js -text/);
  const html = read('view/index.html');
  assert.ok(html.indexOf('theme/dropdowns.js') > 0 && html.indexOf('theme/dropdowns.js') < html.indexOf('src="app.js'), 'the list loads before app.js');
});

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
    '--no-default-browser-check', '--disable-extensions', '--window-size=1280,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const devtools = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => reject(new Error('Edge did not start its DevTools endpoint')), 30000);
    edge.stderr.on('data', chunk => {
      text += chunk;
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    edge.on('exit', code => { clearTimeout(timer); reject(new Error(`Edge exited (${code})`)); });
  });
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
    edge.kill();
    await new Promise(resolve => server.close(resolve));
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
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

test('each setting is chosen from DovahHub\'s list by keyboard and mouse, sent to the plugin, and read back after a reload', async () => {
  const page = await startEdge();
  try {
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await load(page, '?preview=settings');
    assert.equal(await page.run('document.querySelectorAll("select").length'), 0, 'no native select on the page');
    assert.equal(await page.run('window.DovahHubChoices && window.DovahHubChoices.version'), 2);
    for (const id of ['pet-choice', 'card-shape', 'clock-style', 'language-choice']) {
      assert.equal(await page.run(`document.getElementById("${id}").tagName`), 'BUTTON', id);
    }
    assert.equal(await value(page, 'pet-choice'), 'dovahmin');

    // the companion: Enter opens the list, Down moves without choosing, Enter chooses (Ember the fox is fifth)
    await page.run('document.getElementById("pet-choice").focus(); true');
    await press(page, 'Enter');
    assert.ok(await listOpen(page), 'Enter opens the companion list');
    await press(page, 'ArrowDown', 4);
    assert.equal(await value(page, 'pet-choice'), 'dovahmin', 'moving in the list changes nothing');
    await press(page, 'Enter');
    assert.ok(!(await listOpen(page)), 'choosing closes the list');
    assert.equal(await value(page, 'pet-choice'), 'fox');
    assert.equal(await page.run('document.activeElement.id'), 'pet-choice', 'the highlight goes back to the button');
    await sleep(250);
    assert.equal((await lastSent(page))[3], 'fox', 'the plugin is sent the companion (field 3)');

    // Escape closes a list with nothing changed, and leaves the settings open
    await page.run('document.getElementById("card-shape").focus(); true');
    await press(page, 'Enter');
    await press(page, 'ArrowDown');
    await press(page, 'Escape');
    assert.ok(!(await listOpen(page)), 'Escape closes the list');
    assert.equal(await value(page, 'card-shape'), 'square', 'Escape changes nothing');
    assert.ok(await page.run('!document.getElementById("settings-menu").classList.contains("hidden")'), 'the settings stay open');

    // the card shape, by mouse: press the button, press the option
    await click(page, '#card-shape');
    assert.ok(await listOpen(page), 'a click opens the shape list');
    await click(page, '.wf-select-option[data-value="wide"]');
    assert.equal(await value(page, 'card-shape'), 'wide');
    await sleep(250);
    assert.equal((await lastSent(page))[10], 'wide', 'the plugin is sent the shape (field 10)');

    // the clock style is off while the clock is; with it on, Space opens the list
    assert.ok(await page.run('document.getElementById("clock-style").disabled'), 'no clock, no clock style');
    await page.run('document.getElementById("clock-enabled").click(); true');
    assert.ok(!(await page.run('document.getElementById("clock-style").disabled')));
    await page.run('document.getElementById("clock-style").focus(); true');
    await press(page, ' ');
    assert.ok(await listOpen(page), 'Space opens the clock style list');
    await press(page, 'ArrowDown');
    await press(page, 'Enter');
    assert.equal(await value(page, 'clock-style'), 'ribbon');
    await sleep(250);
    let sent = await lastSent(page);
    assert.equal(sent[4], '1', 'the clock is on (field 4)');
    assert.equal(sent[5], 'ribbon', 'the plugin is sent the clock style (field 5)');

    // the language: the other choices relabel in it at once
    const wideInEnglish = await page.run('document.getElementById("card-shape").textContent');
    await page.run('document.getElementById("language-choice").focus(); true');
    await press(page, 'Enter');
    await press(page, 'ArrowDown', 2);
    await press(page, 'Enter');
    assert.equal(await value(page, 'language-choice'), 'de');
    assert.notEqual(await page.run('document.getElementById("card-shape").textContent'), wideInEnglish, 'the shape reads in German at once');
    assert.equal(await page.run('document.documentElement.lang'), 'de');

    // Save: the plugin is sent all four
    await page.run('document.getElementById("settings-save").click(); true');
    sent = await lastSent(page);
    assert.deepEqual([sent[3], sent[5], sent[10], sent[12]], ['fox', 'ribbon', 'wide', 'de']);

    // a new page, as at the next load: initialize, then the settings the plugin read back from its INI
    const saved = payloadFrom(sent);
    await load(page, '');
    assert.equal(await value(page, 'pet-choice'), 'dovahmin', 'a fresh page starts on the defaults');
    await page.run(`dragonbornXP.initialize({}); dragonbornXP.applySettings(${JSON.stringify(saved)}); dragonbornXP.openSettings(${JSON.stringify(saved)}); true`);
    assert.equal(await value(page, 'pet-choice'), 'fox');
    assert.equal(await value(page, 'card-shape'), 'wide');
    assert.equal(await value(page, 'clock-style'), 'ribbon');
    assert.equal(await value(page, 'language-choice'), 'de');
    assert.ok(!(await page.run('document.getElementById("clock-style").disabled')), 'the clock is on again, so its style can be chosen');
    assert.match(await page.run('document.getElementById("pet-choice").textContent'), /^Ember/);

    // Cancel puts a choice back: choose French, cancel, and the page is German again
    await page.run('document.getElementById("language-choice").focus(); true');
    await press(page, 'Enter');
    await press(page, 'ArrowUp', 1);
    await press(page, 'Enter');
    assert.equal(await value(page, 'language-choice'), 'fr');
    await page.run('document.getElementById("settings-cancel").click(); true');
    await page.run(`dragonbornXP.openSettings(${JSON.stringify(saved)}); true`);
    assert.equal(await value(page, 'language-choice'), 'de', 'Cancel put the language back');
  } finally {
    await page.close();
  }
});

test('the plugin reads, writes and sends back each of the four in the same places', () => {
  const card = read('src/CardBridge.cpp');
  const main = read('src/main.cpp');
  // ApplySettings: the fields the page sends
  assert.match(card, /const auto& pet = parts\[3\];/);
  assert.match(card, /const auto clockStyle = parts\.size\(\) > 5 && IsSupportedClockStyle\(parts\[5\]\)/);
  assert.match(card, /const auto cardShape = parts\.size\(\) > 10 && IsSupportedCardShape\(parts\[10\]\)/);
  assert.match(card, /const auto language = parts\.size\(\) > 12 && IsSupportedLanguage\(parts\[12\]\)/);
  // the page sends them in that order
  assert.match(read('view/app.js'), /window\.settingsChanged\(`\$\{x\}\|\$\{y\}\|\$\{settingsHotkey\}\|\$\{pet\}\|\$\{showClock \? 1 : 0\}\|\$\{clockStyle\}\|\$\{cardScale\}\|\$\{raisePet \? 1 : 0\}\|\$\{feedHotkey\}\|\$\{playHotkey\}\|\$\{cardShape\}\|\$\{hideHotkey\}\|\$\{language\}`\)/);
  // the INI: written by SaveSettings, read by LoadSettings, under the same keys
  for (const key of ['pet', 'clock_style', 'card_shape', 'language']) {
    assert.match(main, new RegExp(`<< "${key}=" << g_settings\\.`), `${key} is written`);
    assert.match(main, new RegExp(`key == "${key}"`), `${key} is read`);
  }
  // and sent back to the page at load under the names the page reads
  for (const name of ['pet', 'clockStyle', 'cardShape', 'language']) {
    assert.match(main, new RegExp(`\\\\"${name}\\\\":`), `${name} is in SettingsPayload`);
  }
  assert.match(card, /Invoke\("dragonbornXP\.initialize", "\{\}"\);\s+Invoke\("dragonbornXP\.applySettings", SettingsPayload\(\)\);/);
});

test('the plugin logs each setting that changes once as it saves, old and new, before it saves', () => {
  const card = read('src/CardBridge.cpp');
  const apply = card.slice(card.indexOf('void ApplySettings(std::string_view payload)'));
  assert.match(apply, /if \(before != after\) \{\s+logger::info\("MiniPets setting \{\}: \{\} -> \{\}", name, before, after\);/);
  for (const key of ['position_x', 'position_y', 'settings_hotkey', 'pet', 'show_clock', 'clock_style', 'scale', 'raise_pet',
    'feed_hotkey', 'play_hotkey', 'card_shape', 'hide_hotkey', 'language']) {
    assert.match(apply, new RegExp(`noteChange\\("${key}", `), key);
  }
  // noted against the old values, before they are replaced and saved
  assert.ok(apply.indexOf('noteChange("language"') < apply.indexOf('g_settings.positionX = x;'));
  assert.ok(apply.indexOf('g_settings.positionX = x;') < apply.indexOf('SaveSettings();'));
});
