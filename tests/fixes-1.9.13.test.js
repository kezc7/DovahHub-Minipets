// The fixes that went into 1.9.13 (DMP-23 to DMP-33): the page's side run in the sandbox page, the plugin's
// side pinned in its source. Each test names its card.
const test = require('node:test');
const assert = require('node:assert/strict');
const life = require('../view/pet-life.js');
const { loadPage } = require('./page-harness.js');
const { pluginPart, pluginFile, pluginSource } = require('./plugin-source.js');

const cpp = pluginSource();

function hatched(species, hunger = 80) {
  const pet = life.create(species, 0);
  return Object.assign(pet, { stage: 'hatched', hatchedAt: 0, lastTick: 100, hunger, happiness: 80 });
}

function page(settings = {}, options = {}) {
  const p = loadPage(options);
  const fed = [];
  const results = [];
  p.sandbox.feedPet = () => fed.push(Date.now());
  p.sandbox.petActionResult = text => results.push(JSON.parse(text));
  p.sandbox.petStateChanged = () => {};
  p.sandbox.dragonbornXP.applySettings(Object.assign({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'dovahmin' }, settings));
  return { p, xp: p.sandbox.dragonbornXP, fed, results, root: p.element('#dragonborn-xp'), title: p.element('#title') };
}

// --- the page ---------------------------------------------------------------

// --- the plugin ---------------------------------------------------------------

test('DMP-23: feeding from the pack never takes a quest item', () => {
  const card = pluginPart('Card');
  const food = card.slice(card.indexOf('RE::TESBoundObject* CheapestFood('), card.indexOf('void SetPetHidden('));
  const quest = food.indexOf('if (entry.second && entry.second->IsQuestObject()) {\n                continue;');
  assert.ok(quest > 0, 'quest items are skipped');
  assert.ok(quest < food.indexOf('*count += entry.first;'), 'and not counted as food');
  assert.ok(quest < food.indexOf('cheapest = object;'));
});
