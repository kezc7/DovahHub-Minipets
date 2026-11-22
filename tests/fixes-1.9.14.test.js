// 1.9.14 (DMP-34 to DMP-38, from the player's list of 22 Nov): the page's side run in the sandbox page, the
// plugin's side pinned in its source. Each test names its card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const life = require('../view/pet-life.js');
const { loadPage } = require('./page-harness.js');
const { pluginPart, pluginFile } = require('./plugin-source.js');

function page(settings = {}) {
  const p = loadPage();
  const saved = [];
  const sent = [];
  p.sandbox.petStateChanged = text => saved.push(text);
  p.sandbox.settingsChanged = text => sent.push(text);
  p.sandbox.dragonbornXP.applySettings(Object.assign({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'fox', raisePet: true }, settings));
  return { p, xp: p.sandbox.dragonbornXP, saved, sent };
}

function hatchedFox() {
  return Object.assign(life.create('fox', 0), { stage: 'hatched', hatchedAt: 0, lastTick: 100, hunger: 80, happiness: 80 });
}

function memories(saved) {
  const last = saved.at(-1);
  return last ? JSON.parse(last.slice(last.indexOf('|') + 1)).memories || [] : [];
}

// --- DMP-34 ---------------------------------------------------------------

test('DMP-34: a boss, a milestone and a first visit the gate turned down are still remembered, once each', () => {
  const { xp, saved } = page();
  xp.petState({ state: life.serialize(hatchedFox()), session: 1 });
  xp.clock({ hour: 10, minute: 0, hours: 100 });
  xp.remember({ source: 'dovahdamage', captionKey: 'reactBossDown', vars: { name: 'Alduin' } });
  xp.remember({ source: 'dovahhub', captionKey: 'reactMilestone', vars: { title: 'Wanderer II' } });
  xp.remember({ source: 'minipets', captionKey: 'placeCity', vars: { region: 'whiterun', place: 'Whiterun', memorable: true } });
  xp.remember({ source: 'dovahdamage', captionKey: 'reactBossDown', vars: { name: 'Alduin' } });
  const kept = memories(saved).map(m => `${m.k}:${m.id}`);
  assert.deepEqual(kept, ['boss:Alduin', 'milestone:Wanderer II', 'place:whiterun']);
});

test('DMP-34: nothing is kept from a self-test, an ordinary reaction, or an egg', () => {
  const { xp, saved } = page();
  xp.petState({ state: life.serialize(hatchedFox()), session: 1 });
  xp.clock({ hour: 10, minute: 0, hours: 100 });
  xp.remember({ source: 'minipets', captionKey: 'placeCity', vars: { region: 'whiterun', memorable: true, test: true } });
  xp.remember({ source: 'minipets', captionKey: 'reactSleep', vars: {} });
  assert.deepEqual(memories(saved), []);
  const egg = page();
  egg.xp.petState({ state: life.serialize(life.create('fox', 0)), session: 1 });
  egg.xp.clock({ hour: 0, minute: 0, hours: 0 });
  egg.xp.remember({ source: 'dovahdamage', captionKey: 'reactBossDown', vars: { name: 'Alduin' } });
  assert.ok(!egg.saved.some(text => text.includes('Alduin')));
});

test('DMP-34: the plugin sends every turned-down reaction to be remembered, never a self-test\'s', () => {
  const wiring = pluginPart('ReactionWiring');
  const offer = wiring.slice(wiring.indexOf('Reactions::Verdict OfferReaction('), wiring.indexOf('// one Chronicle line a minute'));
  assert.match(offer, /if \(SelfTestRunner::Running\(\)\) \{\s*return verdict;\s*\}/);
  assert.ok(offer.indexOf('SelfTestRunner::Running()') < offer.indexOf('SendRemember(reaction);'), 'the self-test check comes first');
  assert.match(offer, /SendRemember\(reaction\);\s*return verdict;\s*\}/);
  assert.match(wiring, /Card::Invoke\("dragonbornXP\.remember", "\{\\"source\\":" \+ JsonString\(reaction\.source\) \+ ",\\"captionKey\\":"/);
  assert.match(pluginFile('SelfTestRunner.cpp'), /bool Running\(\)\s*\{\s*return g_selfTestRunning\.load\(\);/);
});

// --- DMP-35 ---------------------------------------------------------------

test('DMP-35: a reaction turned down while the card is hidden for a menu waits for it', () => {
  const wiring = pluginPart('ReactionWiring');
  assert.match(wiring, /constexpr double kGraceMs = 5\.0 \* 1000\.0;/);
  assert.match(wiring, /constexpr double kOutfitGraceMs = 60\.0 \* 1000\.0;/);
  assert.match(wiring, /Reactions::Verdict OfferReaction\(const Reactions::Reaction& reaction, bool fromOtherMod, double waitMs = kGraceMs, bool outfit = false\)/);
  const offer = wiring.slice(wiring.indexOf('Reactions::Verdict OfferReaction('), wiring.indexOf('// one Chronicle line a minute'));
  assert.match(offer, /verdict == Reactions::Verdict::Hidden && waitMs > 0\.0 && Card::IsHidden\(\) && !g_settings\.petHidden/,
    'only hidden for a menu, never the player\'s own hide');
  assert.match(offer, /if \(!g_pending \|\| reaction\.priority >= g_pending->reaction\.priority\) \{\s*if \(g_pending\) \{\s*SendRemember\(g_pending->reaction\);/,
    'the higher priority keeps the place, a tie goes to the newer, and the one it replaces is still remembered');
  const drain = wiring.slice(wiring.indexOf('void UpdateReactions()'));
  assert.match(drain, /if \(now >= g_pending->untilMs\) \{[\s\S]{0,200}SendRemember\(g_pending->reaction\);\s*g_pending\.reset\(\);/, 'out of time: only its moment');
  assert.match(drain, /else if \(!Card::IsHidden\(\)\) \{[\s\S]{0,200}OfferReaction\(waiting\.reaction, waiting\.fromOtherMod, 0\.0\)/, 'once the card is back, one try, no second wait');
  assert.match(wiring, /void ResetReactions\(\)[\s\S]{0,700}g_pending\.reset\(\);/);
});
