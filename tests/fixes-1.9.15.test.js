// 1.9.15 (DMP-39 to DMP-43, approved by the player on 22 Nov): the settings page in headless Edge with real key
// presses, the page's side in the sandbox page, and the plugin's side pinned in its source. Each test names its card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startEdge, press, load, value, listOpen, lastSent, sleep } = require('./edge-harness.js');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

// scroll a control into place, let that scroll's event go (a list closes on a scroll), then focus it
async function focusOn(page, id) {
  await page.run(`(async () => {
    const el = document.getElementById(${JSON.stringify(id)});
    el.scrollIntoView({ block: 'center' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    el.focus({ preventScroll: true });
    return true; })()`);
}

// --- DMP-39 ---------------------------------------------------------------

test('DMP-39: Snap to corner moves the card to a corner, and reads Custom anywhere else', async () => {
  const page = await startEdge();
  try {
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await load(page, '?preview=settings');
    assert.equal(await page.run('document.getElementById("corner-choice").tagName'), 'BUTTON');
    assert.equal(await value(page, 'corner-choice'), 'tr', 'the default place is top right');

    // Top left is second in the list
    await focusOn(page, 'corner-choice');
    await press(page, 'Enter');
    assert.ok(await listOpen(page));
    await press(page, 'ArrowDown');
    await press(page, 'Enter');
    assert.equal(await value(page, 'corner-choice'), 'tl');
    await sleep(250);
    const sent = await lastSent(page);
    assert.equal(sent[0], '0', 'x is the left edge');
    assert.equal(await page.run('document.getElementById("position-x").value'), '0', 'the slider follows');

    // Bottom right, the third
    await focusOn(page, 'corner-choice');
    await press(page, 'Enter');
    // the list opens on the current choice: up to the top first
    await press(page, 'ArrowUp', 5);
    await press(page, 'ArrowDown', 2);
    await press(page, 'Enter');
    assert.equal(await value(page, 'corner-choice'), 'br');
    await sleep(250);
    // the number boxes: the sliders step by 20 (DMP-38), so they show the step nearest the edge
    const corner = await page.run('({ x: Number(document.getElementById("position-x-value").value), maxX: Number(document.getElementById("position-x-value").max), y: Number(document.getElementById("position-y-value").value), maxY: Number(document.getElementById("position-y-value").max) })');
    assert.equal(corner.x, corner.maxX);
    assert.equal(corner.y, corner.maxY);

    // a slider moved by hand: Custom
    await page.run('(() => { const s = document.getElementById("position-x"); s.value = "400"; s.dispatchEvent(new Event("input", { bubbles: true })); return true; })()');
    assert.equal(await value(page, 'corner-choice'), 'custom');

    // Top right again: the card's default place (-1, -1)
    await focusOn(page, 'corner-choice');
    await press(page, 'Enter');
    await press(page, 'ArrowUp', 5);
    await press(page, 'Enter');
    await sleep(250);
    const back = await lastSent(page);
    assert.deepEqual([back[0], back[1]], ['-1', '-1']);
    assert.equal(await value(page, 'corner-choice'), 'tr');
  } finally {
    await page.close();
  }
});

test('DMP-39: the row sits first in the Position group, worded from the catalogue', () => {
  const html = read('view/index.html');
  const position = html.slice(html.indexOf('data-i18n="position">Position</h2>'));
  assert.ok(position.indexOf('for="corner-choice"') < position.indexOf('for="position-x"'));
  assert.match(html, /<b data-i18n="snapToCorner">Snap to corner<\/b><small data-i18n="snapToCornerHint">or drag the card anywhere<\/small>/);
  const app = read('view/app.js');
  assert.match(app, /\[\['tr', 'cornerTopRight'\], \['tl', 'cornerTopLeft'\], \['br', 'cornerBottomRight'\], \['bl', 'cornerBottomLeft'\], \['custom', 'cornerCustom'\]\]/);
  assert.match(app, /if \(value === 'tr'\) resetPosition\(\);/, 'top right is the default place');
});

// --- DMP-40 ---------------------------------------------------------------

test('DMP-40: the Reactions group in the settings sends, reads back and cancels its four settings', async () => {
  const { click } = require('./edge-harness.js');
  const page = await startEdge();
  try {
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 2400, deviceScaleFactor: 1, mobile: false });
    await load(page, '?preview=settings');
    await page.run(`dragonbornXP.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'dovahmin', reactToMods: true, reactionCooldown: 8, careMoments: false, chronicleLines: false }); true`);
    await page.run(`dragonbornXP.openSettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'dovahmin', reactToMods: true, reactionCooldown: 8, careMoments: false, chronicleLines: false }); true`);
    assert.equal(await page.run('document.getElementById("react-to-mods").checked'), true);
    assert.equal(await page.run('document.getElementById("reaction-cooldown-value").value'), '8');

    await click(page, '#react-to-mods');
    await click(page, '#chronicle-lines');
    await page.run('(() => { const s = document.getElementById("reaction-cooldown"); s.value = "30"; s.dispatchEvent(new Event("input", { bubbles: true })); return true; })()');
    await sleep(250);
    const sent = await lastSent(page);
    assert.deepEqual(sent.slice(13, 17), ['0', '30', '0', '1'], 'fields 13 to 16: react to mods, cooldown, care moments, Chronicle');
    assert.equal(await page.run('document.getElementById("reaction-cooldown-value").value'), '30', 'the number box follows the slider');

    // the plugin's own values come back into the rows
    await page.run(`dragonbornXP.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'dovahmin', reactToMods: true, reactionCooldown: 12, careMoments: true, chronicleLines: false }); true`);
    assert.equal(await page.run('document.getElementById("care-moments").checked'), true);
    assert.equal(await page.run('document.getElementById("reaction-cooldown").value'), '12');
  } finally {
    await page.close();
  }
});

test('DMP-40: the plugin reads fields 13 to 16, logs and saves them, and sends them to the page', () => {
  const card = read('src/CardBridge.cpp');
  assert.match(card, /const bool reactToMods = parts\.size\(\) > 13 \? ParseFlag\(parts\[13\]\) : g_settings\.reactToMods;/);
  assert.match(card, /const int reactionCooldown = parts\.size\(\) > 14 \? std::clamp\(std::stoi\(parts\[14\]\), Reactions::kMinCooldownSeconds, Reactions::kMaxCooldownSeconds\)/);
  assert.match(card, /const bool careMoments = parts\.size\(\) > 15 \? ParseFlag\(parts\[15\]\)/);
  assert.match(card, /const bool chronicleLines = parts\.size\(\) > 16 \? ParseFlag\(parts\[16\]\)/);
  for (const name of ['react_to_mods', 'reaction_cooldown', 'care_moments', 'chronicle_lines']) assert.ok(card.includes(`noteChange("${name}"`), name);
  const main = read('src/main.cpp');
  for (const name of ['reactToMods', 'reactionCooldown', 'chronicleLines', 'careMoments']) assert.ok(main.includes(`",\\"${name}\\":"`), name);
  const html = read('view/index.html');
  assert.match(html, /<input id="reaction-cooldown" class="dv-slider" type="range" min="2" max="60" step="1">/);
});

// --- DMP-41 ---------------------------------------------------------------

const life = require('../view/pet-life.js');
const sprites = require('../view/pet-sprites.js');
const { loadPage } = require('./page-harness.js');

function cppPairs(source, name) {
  const block = source.slice(source.indexOf(name), source.indexOf('} };', source.indexOf(name)));
  return [...block.matchAll(/\{ "([^"]+)", "([^"]+)" \}/g)].map(m => [m[1], m[2]]);
}

test('DMP-41: every companion has a favourite, and the plugin keeps the same table as the page', () => {
  const card = read('src/CardBridge.cpp');
  const cpp = Object.fromEntries(cppPairs(card, 'kFavouriteFoods'));
  assert.deepEqual(cpp, { ...life.FAVOURITE_FOODS });
  assert.deepEqual(Object.keys(life.FAVOURITE_FOODS).sort(), Object.keys(sprites.names).sort(), 'all 20 companions');
});

test('DMP-41: the plugin names a food\'s group by its mesh, first match first', () => {
  const words = cppPairs(read('src/CardBridge.cpp'), 'kWords');
  const group = path => {
    const lower = path.toLowerCase();
    const hit = words.find(([word]) => lower.includes(word));
    return hit ? hit[1] : '';
  };
  assert.equal(group('Clutter\\Food\\SweetRoll01.nif'), 'sweets');
  assert.equal(group('Clutter\\Food\\Salmon01.nif'), 'fish');
  assert.equal(group('Clutter\\Food\\VenisonRaw01.nif'), 'meat');
  assert.equal(group('Clutter\\Food\\CheeseWheel01.nif'), 'cheese');
  assert.equal(group('Clutter\\Food\\BreadLoaf01.nif'), 'bread');
  assert.equal(group('Clutter\\Food\\Apple01.nif'), 'greens');
  assert.equal(group('Clutter\\Food\\SnowBerries01.nif'), 'sweets', 'berries are sweet, before fruit');
  assert.equal(group('Clutter\\Food\\PotatoSoup01.nif'), 'greens', 'greens before hot food');
  assert.equal(group('Clutter\\Food\\BeefStew01.nif'), 'hot', 'a stew is hot food before meat');
  assert.equal(group('Clutter\\Drink\\MeadBottle01.nif'), 'mead');
  assert.equal(group('Clutter\\Food\\MilkJug01.nif'), 'drinks');
  assert.equal(group('Clutter\\Ingredients\\Mushroom01.nif'), '');
  assert.equal(words.length, Number(read('src/CardBridge.cpp').match(/std::array<std::pair<std::string_view, std::string_view>, (\d+)> kWords/)[1]));
});

test('DMP-41: Feed prefers the cheapest favourite, still never a quest item', () => {
  const card = read('src/CardBridge.cpp');
  const food = card.slice(card.indexOf('RE::TESBoundObject* CheapestFood('), card.indexOf('void SetPetHidden('));
  assert.ok(food.indexOf('IsQuestObject()') < food.indexOf('FoodGroup(object) == preferGroup'), 'a quest item is skipped before anything else');
  assert.match(food, /return favourite \? favourite : cheapest;/);
  assert.match(card, /auto\* cheapest = CheapestFood\(nullptr, FavouriteFood\(species\)\);/);
  assert.match(card, /",\\"group\\":" \+ JsonString\(FoodGroup\(food\)\)/, 'every meal names its group to the page');
});

test('DMP-41: a favourite is a treat: more happiness, and the card says so', () => {
  const pet = Object.assign(life.create('fox', 0), { stage: 'hatched', hatchedAt: 0, lastTick: 100, hunger: 40, happiness: 40 });
  assert.equal(life.feed(pet, true).pet.happiness, 55);
  assert.equal(life.feed(pet, false).pet.happiness, 45);
  const p = loadPage();
  const results = [];
  p.sandbox.petActionResult = text => results.push(JSON.parse(text));
  p.sandbox.petStateChanged = () => {};
  const xp = p.sandbox.dragonbornXP;
  xp.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'dovahmin', raisePet: true });
  xp.petState({ state: life.serialize(pet), session: 1 });
  const title = p.element('#title');
  xp.petFed({ name: 'Sweet Roll', source: 'pack', group: 'sweets' });
  assert.equal(title.textContent, 'Ember\'s favourite!');
  xp.petFed({ name: 'Salmon', source: 'pack', group: 'fish' });
  assert.equal(title.textContent, 'Ember ate well');
});
