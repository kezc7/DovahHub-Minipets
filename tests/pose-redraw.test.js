// DMP-15: the 14 Nov self-test's pet.follow found the card idle while the player fought. The plugin sends the
// player's pose only when it changes, and the card reset its pose whenever it drew a new sprite (another
// companion, raise-a-pet on or off, hatching, a new stage), so a pet redrawn mid-fight stood idle until the
// fight ended. The card now keeps the pose across a redraw, and the plugin sends it again to a new page.
const test = require('node:test');
const assert = require('node:assert/strict');
const life = require('../view/pet-life.js');
const { loadPage } = require('./page-harness.js');
const { pluginPart } = require('./plugin-source.js');

function card() {
  const p = loadPage();
  p.sandbox.petStateChanged = () => {};
  const xp = p.sandbox.dragonbornXP;
  const pose = () => {
    let answer = null;
    p.sandbox.selfTestAnswer = text => { answer = JSON.parse(text); };
    xp.selfTest({ id: 1 });
    return answer.base;
  };
  xp.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'fox', raisePet: false, language: 'en' });
  return { xp, pose };
}

test('another companion mid-fight keeps fighting', () => {
  const { xp, pose } = card();
  xp.companionState({ state: 'combat' });
  assert.equal(pose(), 'combat');
  xp.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'chicken', raisePet: false, language: 'en' });
  assert.equal(pose(), 'combat', 'the self-test\'s summon, or the player picking another companion');
});

test('raise-a-pet switched on, a hatch or a new stage keeps the pose too', () => {
  const { xp, pose } = card();
  xp.companionState({ state: 'flying' });
  assert.equal(pose(), 'moving');
  xp.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'fox', raisePet: true, language: 'en' });
  const pet = Object.assign(life.create('fox', 0), { stage: 'hatched', hatchedAt: 0, lastTick: 10, grown: 'baby' });
  xp.petState({ state: life.serialize(pet), session: 2 });
  assert.equal(pose(), 'moving');
  xp.companionState({ state: 'combat' });
  xp.petState({ state: life.serialize(Object.assign({}, pet, { hatchedAt: -200, grown: 'adult' })), session: 2 });
  assert.equal(pose(), 'combat');
});

test('idle stays idle, and the next pose the plugin sends still lands', () => {
  const { xp, pose } = card();
  xp.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'mudcrab', raisePet: false, language: 'en' });
  assert.equal(pose(), 'idle');
  xp.companionState({ state: 'combat' });
  xp.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'troll', raisePet: false, language: 'en' });
  xp.companionState({ state: 'landed' });
  assert.equal(pose(), 'idle', 'the fight ending after a redraw still brings it back to idle');
});

test('a new page is sent the player\'s pose again, and the self-test words the state', () => {
  const card = pluginPart('Card');
  assert.match(card, /\/\/ new page, resend everything, the player's pose included\s*g_lastWorldMood\.clear\(\);\s*g_lastClockMinute = -1;\s*g_lastCompanionState\.clear\(\);/);
  const run = pluginPart('SelfTestRunner');
  assert.match(run, /state == "combat" \? "in combat" : state == "flying" \? "moving" : state == "idle" \? "standing still"/);
  assert.doesNotMatch(run, /"the player is " \+ run->companionState/);
});
