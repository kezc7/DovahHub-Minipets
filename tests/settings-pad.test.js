// DMP-21 (the suite's pad rule, 17 Nov): every control on MiniPets' settings page works on a pad. The page uses
// DovahHub's controller layer (view/theme/controller.js, copied unchanged), which reads Prisma UI's standard gamepad.
// Here the pad is fed the way DovahHub's own browser checks feed it (window.__dovahhubPad), in headless Edge. The walk
// reaches every control on the page with the D-pad, opens and closes each list without changing anything, changes a
// switch, a slider and a choice with the pad, saves with A, and reads the settings back after a reload. B ends a hotkey
// capture, then cancels the settings, and the pad does nothing while they are closed.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { startEdge, load, value, listOpen, lastSent, payloadFrom, sleep } = require('./edge-harness.js');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
const BUTTON = { up: 0x0001, down: 0x0002, left: 0x0004, right: 0x0008, a: 0x1000, b: 0x2000 };

test('the controller layer is DovahHub\'s, unchanged, and loads before the list and the page', () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'view', 'theme', 'controller.js'))).digest('hex');
  assert.equal(sha, '87d00a2bf0dff1938d7ec2c36ce71ab5b9f110220e7f6554fa97e98e16087790');
  assert.match(read('third_party/dovah-api/SOURCE'), /view\/theme\/controller\.js\s+DovahHub 8c5d9fe/);
  assert.match(read('.gitattributes'), /view\/theme\/controller\.js -text/);
  const html = read('view/index.html');
  const at = name => html.indexOf(`src="${name}`);
  assert.ok(at('theme/controller.js') > 0 && at('theme/controller.js') < at('theme/dropdowns.js') && at('theme/dropdowns.js') < at('app.js'));
  // the pad is read only while the settings are open
  const app = read('view/app.js');
  assert.match(app, /settingsMenu\.classList\.remove\('hidden'\);\s+syncSettingsFields\(\);\s+startPad\(\);/);
  assert.match(app, /settingsOpen = false;\s+stopPad\(\);/);
  assert.match(app, /setupChoices\(\);\s+\/\/[^\n]*\n\s+if \(typeof window\.dovahhubInputPaused === 'function'\) window\.dovahhubInputPaused\(true\);/);
});

async function frames(page, n) {
  await page.run(`new Promise(resolve => { let c = 0; (function tick() { if (++c > ${n}) resolve(); else requestAnimationFrame(tick); })(); })`);
}
async function pad(page, name) {
  await page.run(`window.__dovahhubPad(${BUTTON[name]}, 0, 0, 0, 0, 0, 0); true`);
  await frames(page, 3);
  await page.run('window.__dovahhubPad(0, 0, 0, 0, 0, 0, 0); true');
  await frames(page, 4);
}
// the highlighted control: in an open list, its option; else the page's
const FOCUSED = '((document.querySelector(".wf-select-menu") && document.querySelector(".wf-select-menu [data-meridian-focused]")) || document.querySelector("#settings-menu [data-meridian-focused]"))';
// a control's name: its id, or its class and place among its kind (the egg buttons have no ids)
const NAME = `(el => !el ? '' : el.id || el.className + '#' + Array.from(document.getElementsByClassName(el.className)).indexOf(el))`;
const focusedId = page => page.run(`${NAME}(${FOCUSED})`);
// every control the pad should reach: what the controller layer counts as one, shown, inside the settings card
const CONTROLS = `Array.from(document.querySelectorAll('#settings-menu .settings-card button, #settings-menu .settings-card input, #settings-menu .settings-card [tabindex]'))
  .filter(el => el.tabIndex >= 0 && !el.disabled && !el.closest('[hidden]') && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0)`;

// move the highlight to a control with the D-pad alone, by where it is on screen
async function padTo(page, id) {
  for (let steps = 0; steps < 60; steps++) {
    const where = await page.run(`(() => {
      const a = ${FOCUSED}, b = document.getElementById(${JSON.stringify(id)});
      if (!a || !b) return 'lost';
      if (a === b) return 'here';
      const r = a.getBoundingClientRect(), s = b.getBoundingClientRect();
      const dy = (s.top + s.height / 2) - (r.top + r.height / 2), dx = (s.left + s.width / 2) - (r.left + r.width / 2);
      return Math.abs(dy) > 4 ? (dy > 0 ? 'down' : 'up') : (dx > 0 ? 'right' : 'left');
    })()`);
    if (where === 'here') return;
    assert.notEqual(where, 'lost', `the highlight is lost on the way to ${id}`);
    await pad(page, where);
  }
  assert.fail(`the D-pad never reached ${id}`);
}

// the walk: down row by row, and right along each row, until nothing moves; then back up the left edge
async function walk(page) {
  const expected = await page.run(`${CONTROLS}.map(${NAME})`);
  const seen = new Set();
  let lastRowStart = null;
  for (let rows = 0; rows < 80; rows++) {
    let id = await focusedId(page);
    seen.add(id);
    // to the start of the line first (in the egg grid, Down lands under the last egg), then across
    for (let back = 0; back < 8; back++) {
      await pad(page, 'left');
      const next = await focusedId(page);
      if (next === id) break;
      id = next;
      seen.add(id);
    }
    for (let across = 0; across < 8; across++) {
      await pad(page, 'right');
      const next = await focusedId(page);
      if (next === id) break;
      id = next;
      seen.add(id);
    }
    const rowStart = id;
    await pad(page, 'down');
    const below = await focusedId(page);
    if (below === rowStart || below === lastRowStart) break;
    lastRowStart = rowStart;
  }
  for (let rows = 0; rows < 80; rows++) {
    const id = await focusedId(page);
    seen.add(id);
    await pad(page, 'left');
    seen.add(await focusedId(page));
    await pad(page, 'up');
    if ((await focusedId(page)) === id) break;
  }
  return { expected, missed: expected.filter(id => !seen.has(id)) };
}

async function openSettingsWithPad(page) {
  await load(page, '?preview=settings');
  await page.run('window.__dovahhubPad(0, 0, 0, 0, 0, 0, 0); true');
  await sleep(450);  // the controller layer's settle time after the settings open
  await pad(page, 'down');
  await pad(page, 'up');
}

test('the pad reaches every control on the settings page, runs each list, and saves what it changed', async () => {
  const page = await startEdge();
  try {
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await openSettingsWithPad(page);
    assert.equal(await page.run('document.documentElement.dataset.meridianInput'), 'gamepad', 'the page knows the pad is in use');
    assert.ok(await focusedId(page), 'a control is highlighted once the pad is used');

    // the walk from the top, with raise-a-pet off
    await padTo(page, 'settings-close');
    let result = await walk(page);
    assert.ok(result.expected.length >= 15, `the settings have their controls (${result.expected.length})`);
    assert.deepEqual(result.missed, [], 'the D-pad reaches every control');

    // raise-a-pet on, by A on its switch: the egg grid and the pet's hotkeys join the page, and the walk reaches them too
    await padTo(page, 'raise-pet');
    await pad(page, 'a');
    assert.ok(await page.run('document.getElementById("raise-pet").checked'), 'A flips raise-a-pet on');
    await padTo(page, 'settings-close');
    result = await walk(page);
    assert.equal(result.expected.filter(id => id.startsWith('egg-choice#')).length, 20, 'the twenty eggs are shown');
    assert.ok(result.expected.includes('feed-hotkey') && result.expected.includes('play-hotkey'), 'and the pet keys');
    assert.deepEqual(result.missed, [], 'the D-pad reaches every control with raise-a-pet on');
    // in the egg grid, Down moves within it before it leaves it
    await padTo(page, 'raise-pet');
    await pad(page, 'down');
    assert.equal(await page.run(`(${FOCUSED} || {}).className`), 'egg-choice', 'Down from raise-a-pet enters the egg grid');
    const firstEgg = await page.run(`${FOCUSED}.getBoundingClientRect().top`);
    await pad(page, 'down');
    const nextRow = await page.run(`(${FOCUSED}).className === 'egg-choice' ? ${FOCUSED}.getBoundingClientRect().top : -1`);
    assert.ok(nextRow > firstEgg, 'Down moves to the next row of eggs');
    await padTo(page, 'raise-pet');
    await pad(page, 'a');
    assert.ok(!(await page.run('document.getElementById("raise-pet").checked')), 'and off again');

    // past each list: A opens it, Down moves in it without choosing, B closes it with nothing changed
    for (const id of ['pet-choice', 'card-shape', 'language-choice']) {
      await padTo(page, id);
      const before = await value(page, id);
      await pad(page, 'a');
      assert.ok(await listOpen(page), `A opens the ${id} list`);
      await pad(page, 'down');
      assert.equal(await value(page, id), before, `moving in the ${id} list changes nothing`);
      await pad(page, 'b');
      assert.ok(!(await listOpen(page)), `B closes the ${id} list`);
      assert.equal(await value(page, id), before, `closing the ${id} list changes nothing`);
      assert.equal(await focusedId(page), id, `the highlight is back on ${id}`);
      assert.ok(await page.run('!document.getElementById("settings-menu").classList.contains("hidden")'), 'the settings stay open');
    }

    // a switch: A flips the clock on, which lets its style be chosen; that list too
    await padTo(page, 'clock-enabled');
    await pad(page, 'a');
    assert.ok(await page.run('document.getElementById("clock-enabled").checked'), 'A flips the switch');
    await padTo(page, 'clock-style');
    await pad(page, 'a');
    assert.ok(await listOpen(page), 'A opens the clock style list');
    await pad(page, 'down');
    await pad(page, 'a');
    assert.ok(!(await listOpen(page)), 'A chooses and closes the list');
    assert.equal(await value(page, 'clock-style'), 'ribbon');

    // a choice by pad: the card shape, Wide
    await padTo(page, 'card-shape');
    await pad(page, 'a');
    await pad(page, 'down');
    await pad(page, 'a');
    assert.equal(await value(page, 'card-shape'), 'wide');

    // a slider: A starts changing it, Right twice, A ends it
    await padTo(page, 'size-range');
    await pad(page, 'a');
    await pad(page, 'right');
    await pad(page, 'right');
    await pad(page, 'a');
    assert.equal(await page.run('document.getElementById("size-range").value'), '110', 'Right steps the size by 5, twice');

    // a hotkey: A starts capturing a key, B ends the capture and leaves the settings open
    await padTo(page, 'settings-hotkey');
    await pad(page, 'a');
    assert.ok(await page.run('document.getElementById("settings-hotkey").classList.contains("capturing")'), 'A starts a capture');
    await pad(page, 'b');
    assert.ok(!(await page.run('document.getElementById("settings-hotkey").classList.contains("capturing")')), 'B ends it');
    assert.ok(await page.run('!document.getElementById("settings-menu").classList.contains("hidden")'), 'the settings stay open');

    // Save with A: the plugin is sent all of it
    await padTo(page, 'settings-save');
    await pad(page, 'a');
    assert.ok(await page.run('document.getElementById("settings-menu").classList.contains("hidden")'), 'A on Save closes the settings');
    const sent = await lastSent(page);
    assert.deepEqual([sent[4], sent[5], sent[6], sent[10]], ['1', 'ribbon', '110', 'wide'], 'clock, clock style, size and shape are sent');

    // with the settings closed, the pad is the game's: nothing on the page moves or changes
    const sentBefore = await page.run('window.__sent.length');
    await pad(page, 'down');
    await pad(page, 'a');
    await pad(page, 'b');
    await sleep(250);
    assert.equal(await page.run('window.__sent.length'), sentBefore, 'nothing more is sent');
    assert.ok(await page.run('document.getElementById("settings-menu").classList.contains("hidden")'));
    assert.equal(await page.run('document.querySelectorAll("[data-meridian-focused]").length'), 0, 'no highlight while closed');

    // read back after a reload, from what the plugin sends at load
    const saved = payloadFrom(sent);
    await load(page, '');
    await page.run(`dragonbornXP.initialize({}); dragonbornXP.applySettings(${JSON.stringify(saved)}); dragonbornXP.openSettings(${JSON.stringify(saved)}); true`);
    assert.equal(await value(page, 'card-shape'), 'wide');
    assert.equal(await value(page, 'clock-style'), 'ribbon');
    assert.ok(await page.run('document.getElementById("clock-enabled").checked'));
    assert.equal(await page.run('document.getElementById("size-range").value'), '110');

    // B with nothing open cancels the settings, as Esc does: a change made since opening goes back
    await page.run('window.__dovahhubPad(0, 0, 0, 0, 0, 0, 0); true');
    await sleep(450);
    await pad(page, 'down');
    await padTo(page, 'card-shape');
    await pad(page, 'a');
    await pad(page, 'up');
    await pad(page, 'a');
    assert.equal(await value(page, 'card-shape'), 'square');
    await pad(page, 'b');
    assert.ok(await page.run('document.getElementById("settings-menu").classList.contains("hidden")'), 'B closes the settings');
    await page.run(`dragonbornXP.openSettings(${JSON.stringify(saved)}); true`);
    assert.equal(await value(page, 'card-shape'), 'wide', 'B cancelled the change');
  } finally {
    await page.close();
  }
});
