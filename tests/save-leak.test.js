// SAVE-LEAK: nothing about one playthrough may reach another save or a new game. The co-save is
// cleared by Revert; these check the page side (which outlives a load) and the plugin's load wiring.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const life = require('../view/pet-life.js');
const { loadPage } = require('./page-harness.js');

const cpp = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cpp'), 'utf8');

function hatchedFox(hours) {
  const pet = life.create('fox', 0);
  return Object.assign(pet, { stage: 'hatched', hatchedAt: 0, lastTick: hours, hunger: 80, happiness: 80 });
}

function page() {
  const p = loadPage();
  const saved = [];
  p.sandbox.petStateChanged = text => saved.push(text);
  p.sandbox.dragonbornXP.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'fox', raisePet: true });
  return { p, saved, xp: p.sandbox.dragonbornXP };
}

test('the page sends each pet state back with the session it was loaded in', () => {
  const { saved, xp } = page();
  xp.petState({ state: life.serialize(hatchedFox(100)), session: 3 });
  xp.clock({ hour: 10, minute: 0, hours: 101 });
  assert.ok(saved.length > 0, 'the clock tick saved the pet');
  assert.match(saved.at(-1), /^3\|\{"species":"fox"/);
});

test('loading another save drops the last pet at once: no tick or level-up saves it into the new one', () => {
  const { saved, xp } = page();
  xp.petState({ state: life.serialize(hatchedFox(100)), session: 3 });
  xp.clock({ hour: 10, minute: 0, hours: 101 });
  // the plugin starts the next load (Revert, kPreLoadGame): an empty pet in a new session
  xp.petState({ state: '', session: 4 });
  const before = saved.length;
  // what used to reach the plugin while the next save loaded: the old save's clock ticking on
  xp.clock({ hour: 11, minute: 0, hours: 150 });
  xp.levelUp({ level: 5 });
  xp.skillGain({ skill: 'Destruction' });
  assert.deepEqual(saved.slice(before), [], 'nothing saved while the new save has no pet');
  assert.ok(!saved.some(text => text.startsWith('4|{')), 'the fox never went out under the new session');
});

test('the new save\'s pet ticks on the new save\'s clock, not the last one\'s hours', () => {
  const { saved, xp } = page();
  xp.petState({ state: life.serialize(hatchedFox(900)), session: 1 });
  xp.clock({ hour: 10, minute: 0, hours: 900 });
  const eggB = life.create('mudcrab', 20);
  xp.petState({ state: life.serialize(eggB), session: 2 });
  // before the new save's clock arrives the page knows no hours (the last save's 900 are gone)
  xp.levelUp({ level: 2 });
  const sent = saved.filter(text => text.startsWith('2|')).map(text => JSON.parse(text.slice(2)));
  assert.ok(sent.every(pet => pet.species === 'mudcrab' && pet.lastTick === 20), JSON.stringify(sent));
  xp.clock({ hour: 12, minute: 0, hours: 24 });
  const last = JSON.parse(saved.at(-1).slice(2));
  assert.equal(last.species, 'mudcrab');
  assert.equal(last.lastTick, 24);
});

test('a held reaction from the last save ends with the load', () => {
  const { p, xp } = page();
  xp.petState({ state: '', session: 1 });
  xp.react({ source: 'minipets', mood: 'sad', hold: true, priority: 2, captionKey: 'reactFallen' });
  const root = p.element('#dragonborn-xp');
  assert.match(root.className, /react-sad/);
  xp.petState({ state: '', session: 2 });
  assert.doesNotMatch(root.className, /reacting/);
});

test('the plugin: Revert and kPreLoadGame start a new session; loading clears every per-playthrough value', () => {
  const revert = cpp.slice(cpp.indexOf('static void OnRevert('), cpp.indexOf('static void SKSEMessageHandler('));
  assert.match(revert, /g_petState\.clear\(\);/);
  assert.match(revert, /g_bestHit = 0\.0f;/);
  assert.match(revert, /BeginLoad\(\);/);
  const handler = cpp.slice(cpp.indexOf('static void SKSEMessageHandler('));
  assert.match(handler, /kPreLoadGame:\s*BeginLoad\(\);/);
  assert.match(handler, /kNewGame:[\s\S]*?FinishLoad\(\);/);
  const begin = cpp.slice(cpp.indexOf('void BeginLoad()'), cpp.indexOf('void FinishLoad()'));
  assert.match(begin, /g_loadingSave\.store\(true\)/);
  assert.match(begin, /g_petSession\.fetch_add\(1\)/);
  assert.match(begin, /ResetReactions\(\);/);
  assert.match(begin, /SendPetState\(\);/);
  const finish = cpp.slice(cpp.indexOf('void FinishLoad()'), cpp.indexOf('void FinishLoad()') + 600);
  for (const line of ['g_loadingSave.store(false)', 'g_lastClockMinute = -1', 'g_lastWorldMood.clear()', 'g_lastCompanionState.clear()', 'ResetReactions()', 'SendPetState()']) {
    assert.ok(finish.includes(line), line);
  }
  const reset = cpp.slice(cpp.indexOf('void ResetReactions()'), cpp.indexOf('void ResetReactions()') + 900);
  for (const line of ['g_reactionGate.Reset()', 'g_lowHealth.Rearm()', 'g_playerDead = false', 'g_bleedingOut = false', 'g_sleepReleaseAtMs = 0.0',
    'g_damageBaselined = false', 'g_killsSeen.clear()', 'g_lastOutfitMs = -1e18', 'g_lastChronicleMs = -1e18', 'g_reactQueue.clear()', 'dragonbornXP.reactEnd']) {
    assert.ok(reset.includes(line), line);
  }
});

test('the plugin keeps a pet state only from the current session, checked when the task runs', () => {
  assert.match(cpp, /AddTask\(\[copy\]\(\) \{\s*std::string state;\s*if \(AcceptPetState\(copy, state\)\)/);
  const accept = cpp.slice(cpp.indexOf('bool AcceptPetState('), cpp.indexOf('void BeginLoad()'));
  assert.match(accept, /g_loadingSave\.load\(\) \|\| session != g_petSession\.load\(\)/);
  assert.match(cpp, /"\{\\"state\\":" \+ JsonString\(g_petState\) \+ ",\\"session\\":"/);
  const update = cpp.slice(cpp.indexOf('void UpdateReactions()'), cpp.indexOf('void UpdateReactions()') + 300);
  assert.match(update, /g_loadingSave\.load\(\)/, 'no DovahDamage record or React drained while a save loads');
});
