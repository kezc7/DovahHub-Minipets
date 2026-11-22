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

test('DMP-26: a raised pet gets its own species class, whatever the companion setting', () => {
  const { xp, root } = page({ raisePet: true });
  xp.petState({ state: life.serialize(hatched('fox')), session: 1 });
  assert.match(root.className, /(^| )pet-fox( |$)/);
  assert.doesNotMatch(root.className, /(^| )pet-dovahmin( |$)/, 'not the companion left in the setting');
  xp.petState({ state: life.serialize(hatched('dovahpink')), session: 2 });
  assert.match(root.className, /(^| )pet-dovahpink( |$)/, 'a raised Dovahpink gets its pink');
});

test('DMP-26: an egg has no species class; the companion still has its own', () => {
  const egg = page({ raisePet: true });
  egg.xp.petState({ state: life.serialize(life.create('mudcrab', 0)), session: 1 });
  assert.doesNotMatch(egg.root.className, /(^| )pet-[a-z-]+( |$)/);
  const companion = page({ pet: 'chicken' });
  assert.match(companion.root.className, /(^| )pet-chicken( |$)/);
});

test('DMP-27: walking or a fight during a reaction leaves the reaction\'s words', () => {
  const { xp, title } = page({ pet: 'fox' });
  xp.react({ source: 'minipets', mood: 'cheer', captionKey: 'reactBigHit', vars: { amount: 120 }, ms: 3000, priority: 1 });
  const words = title.textContent;
  assert.ok(words, 'the reaction has a caption');
  xp.companionState({ state: 'moving' });
  assert.equal(title.textContent, words, 'not the moving line');
  xp.companionState({ state: 'combat' });
  assert.equal(title.textContent, words, 'not the combat line');
  xp.reactEnd({});
  xp.companionState({ state: 'idle' });
  xp.companionState({ state: 'moving' });
  assert.notEqual(title.textContent, words, 'with no reaction the moving line shows again');
});

test('DMP-27: a language picked during a reaction words the reaction again', () => {
  const { xp, title } = page({ pet: 'fox' });
  xp.companionState({ state: 'moving' });
  xp.react({ source: 'minipets', mood: 'cheer', captionKey: 'reactBigHit', vars: { amount: 120 }, ms: 3000, priority: 1 });
  const english = title.textContent;
  assert.match(english, /120/);
  xp.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'fox', language: 'fr' });
  assert.notEqual(title.textContent, english, 'the caption follows the new language');
  assert.match(title.textContent, /120/, 'and is still the reaction\'s, not the moving line');
});

// --- the plugin ---------------------------------------------------------------

test('DMP-23: feeding from the pack never takes a quest item', () => {
  const card = pluginPart('Card');
  const food = card.slice(card.indexOf('RE::TESBoundObject* CheapestFood('), card.indexOf('void SetPetHidden('));
  const quest = food.indexOf('if (entry.second && entry.second->IsQuestObject()) {\n                continue;');
  assert.ok(quest > 0, 'quest items are skipped');
  assert.ok(quest < food.indexOf('*count += entry.first;'), 'and not counted as food');
  assert.ok(quest < food.indexOf('cheapest = object;'));
});

test('DMP-24: DovahHub\'s rows are worded again once the INI is read', () => {
  const core = pluginFile('main.cpp');
  assert.match(core, /void OnDataLoaded\(\)\s*\{\s*LoadSettings\(\);\s*\/\/[^\n]*\n\s*Hub::RefreshHubSettings\(\);/);
  const hub = pluginPart('Hub');
  assert.match(hub, /void RefreshHubSettings\(\)[\s\S]{0,400}g_hubSettingsLanguage == g_settings\.language && g_hubSettingsHideKey == g_settings\.hideHotkeyName/,
    'only when they differ from what was sent at kPostPostLoad');
});

test('DMP-28: the outfit\'s ten minutes start only when shown, and a hidden card makes it wait', () => {
  const wiring = pluginPart('ReactionWiring');
  assert.match(wiring, /Reactions::Verdict OfferReaction\(const Reactions::Reaction& reaction, bool fromOtherMod\)/);
  const outfit = wiring.slice(wiring.indexOf('void OfferOutfit('), wiring.indexOf('void OwnReaction('));
  assert.match(outfit, /if \(verdict == Reactions::Verdict::Show\) \{\s*g_lastOutfitMs = now;/);
  assert.match(outfit, /verdict == Reactions::Verdict::Hidden && mayWait && Card::IsHidden\(\)/, 'only a card hidden for a menu, never the player\'s own hide');
  assert.equal((wiring.match(/g_lastOutfitMs = now;/g) || []).length, 1);
  assert.match(wiring, /OfferOutfit\(reaction, now, true\);/);
  assert.match(wiring, /if \(g_pendingOutfit && !Card::IsHidden\(\)\) \{[\s\S]{0,300}OfferOutfit\(reaction, NowMs\(\), false\);/, 'offered again once, without waiting again');
  assert.match(wiring, /void ResetReactions\(\)[\s\S]{0,700}g_pendingOutfit\.reset\(\);/, 'a load drops it');
});
