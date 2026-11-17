// DMP-21 (the suite's pad rule, 17 Nov): no native <select> on MiniPets' page. The companion, card shape, clock style
// and language are buttons that open DovahHub's list (view/theme/dropdowns.js, copied unchanged). This test runs the
// real page in headless Edge with real key and mouse input: each setting is chosen from its list, sent to the plugin in
// the field CardBridge's ApplySettings reads, and read back after a reload from the settings the plugin sends at load.
// The plugin's own side (its fields, its INI keys, its load payload) is checked against the source at the end.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const VIEW = path.join(ROOT, 'view');
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

const { startEdge, press, click, load, value, listOpen, lastSent, payloadFrom, sleep } = require('./edge-harness.js');

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
