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

test('DMP-31: a second Feed before the plugin answers asks for no second food', () => {
  const { xp, fed, results } = page({ raisePet: true });
  xp.petState({ state: life.serialize(hatched('fox', 70)), session: 1 });
  xp.petAction({ action: 'feed' });
  xp.petAction({ action: 'feed' });
  assert.equal(fed.length, 1, 'one food asked for');
  assert.deepEqual(results, [], 'the second press reports nothing of its own');
  xp.petFed({ name: 'Apple', source: 'pack' });
  assert.equal(results.at(-1).ok, true);
  // fed to 100: the next press is "full", and asks for nothing
  xp.petAction({ action: 'feed' });
  assert.equal(fed.length, 1);
  assert.equal(results.at(-1).reason, 'full');
});

test('DMP-31: the answer, or a load, ends the wait', () => {
  const { xp, fed } = page({ raisePet: true });
  xp.petState({ state: life.serialize(hatched('fox', 20)), session: 1 });
  xp.petAction({ action: 'feed' });
  xp.petFed({ name: 'Apple', source: 'pack' });
  xp.petAction({ action: 'feed' });
  assert.equal(fed.length, 2, 'answered: the next one goes');
  xp.petState({ state: life.serialize(hatched('fox', 20)), session: 2 });
  xp.petAction({ action: 'feed' });
  assert.equal(fed.length, 3, 'a load: the next one goes');
});

test('DMP-33: Play with no egg says "No egg yet", as Feed does', () => {
  const { p, xp, results } = page({ raisePet: true });
  xp.petState({ state: '', session: 1 });
  p.element('#title').textContent = '';
  xp.petAction({ action: 'play' });
  assert.deepEqual(results.at(-1), { action: 'play', ok: false, reason: 'no pet' });
  assert.equal(p.element('#title').textContent, 'No egg yet');
});

test('DMP-33: the English fallback has the switch words and the four choice labels, as i18n.js words them', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const app = fs.readFileSync(path.join(__dirname, '..', 'view', 'app.js'), 'utf8');
  const start = app.indexOf('function englishOnlyI18n()');
  const fallback = app.slice(start, app.indexOf('const fill', start));
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'view', 'i18n.js'), 'utf8');
  for (const key of ['toggleOn', 'toggleOff', 'square', 'wide', 'plate', 'ribbon']) {
    // the first one in i18n.js is English's
    const english = i18n.match(new RegExp(`\\b${key}: "([^"]*)"`));
    assert.ok(english, `${key} in i18n.js`);
    assert.ok(fallback.includes(`${key}: "${english[1]}"`), key);
  }
  assert.doesNotThrow(() => page({}, { skip: ['i18n.js'] }), 'the page still starts without i18n.js');
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

test('DMP-29: a Shift release the game missed doesn\'t stick', () => {
  const card = pluginPart('Card');
  assert.doesNotMatch(card, /g_shiftDown\.load\(\) \|\|/);
  const held = card.slice(card.indexOf('bool ShiftHeld()'), card.indexOf('bool ShiftHeld()') + 500);
  assert.match(held, /if \(\(GetAsyncKeyState\(VK_SHIFT\) & 0x8000\) != 0\) \{\s*return true;/);
  assert.match(held, /g_shiftDown\.load\(\) && SteadyMs\(\) - g_shiftDownAtMs\.load\(\) < kShiftBatchMs/);
  assert.match(held, /g_shiftDown\.store\(false\);\s*return false;/);
  assert.match(card, /constexpr std::int64_t kShiftBatchMs = 500;/);
  assert.match(card, /const bool shiftDown = ShiftHeld\(\);/);
  assert.equal((card.match(/g_shiftDownAtMs\.store\(SteadyMs\(\)\);\s*g_shiftDown\.store\(true\);/g) || []).length, 2, 'both Shift keys');
});

test('DMP-32: a failed load isn\'t a game: no g_gameLoaded, no INI self-test', () => {
  const handler = cpp.slice(cpp.indexOf('static void SKSEMessageHandler('));
  const post = handler.slice(handler.indexOf('case SKSE::MessagingInterface::kPostLoadGame:'), handler.indexOf('default:'));
  const failed = post.indexOf('if (!message->data) {');
  assert.ok(failed > 0);
  assert.ok(failed < post.indexOf('g_gameLoaded.store(true);'));
  assert.match(post, /if \(!message->data\) \{\s*logger::warn\("MiniPets: the save didn't load"\);\s*PetSave::FinishLoad\(\);\s*break;\s*\}\s*\[\[fallthrough\]\];\s*case SKSE::MessagingInterface::kNewGame:/);
});

test('DMP-33: a boss on the hit that set a record gets the one reaction', () => {
  const wiring = pluginPart('ReactionWiring');
  const poll = wiring.slice(wiring.indexOf('void PollDovahDamage()'), wiring.indexOf('class DeathSink'));
  assert.ok(poll.indexOf('boss = OfferBossKill(id, name);') < poll.indexOf('IsNewRecord(totals.biggestHit, g_bestHit)'), 'the boss first');
  assert.match(poll, /g_bestHit = totals\.biggestHit;\s*if \(!boss\) \{\s*OwnReaction\("dovahdamage", "cheer", "reactBigHit"/, 'the record is kept, the cheer only without a boss');
});

test('DMP-33: the co-save is read with its byte count checked, and the record is a finite number of 0 or more', () => {
  const save = pluginPart('PetSave');
  assert.match(save, /constexpr std::uint32_t kMaxPetRecord = 64 \* 1024;/);
  assert.match(save, /if \(length > kMaxPetRecord\) \{[\s\S]{0,160}continue;/);
  assert.match(save, /if \(serialization->ReadRecordData\(state\.data\(\), length\) != length\) \{[\s\S]{0,120}continue;/);
  assert.match(save, /ReadRecordData\(&bestHit, sizeof\(bestHit\)\) != sizeof\(bestHit\) \|\| !std::isfinite\(bestHit\) \|\| bestHit < 0\.0f/);
});

test('DMP-33: the self-test reports pet.memory as skipped when pet.stage ran out of time', () => {
  const run = pluginFile('SelfTestRunner.cpp');
  const stage = run.slice(run.indexOf('if (!outOfTime("pet.stage")) {'), run.indexOf('// 2. each reaction'));
  assert.match(stage, /else \{\s*\/\/[^\n]*\n\s*SelfTestReport\(\*run, "pet\.memory", Result::Skip, "out of time \("/);
});
