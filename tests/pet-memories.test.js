// DMP-13: a raised pet's longer life. The rules (view/pet-life.js): two more stages and the moment of
// growing into one, memories of what it saw with you, and bringing one up now and then. The card
// (view/app.js): what it remembers, a first visit worded as one, and the self-test's made-up pet.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const life = require('../view/pet-life.js');
const { loadPage } = require('./page-harness.js');

const DAY = 24;
const hatched = (overrides = {}) => Object.assign(life.create('fox', 0), { stage: 'hatched', hatchedAt: 0, lastTick: 0, hunger: 100, happiness: 100 }, overrides);
const isSpecies = id => ['fox', 'chicken', 'mudcrab'].includes(id);

test('five stages: baby, young, adult, then seasoned at 20 days and elder at 60, all at full size from adult', () => {
  const pet = hatched();
  assert.deepEqual([1, 2.5, 6, 21, 61].map(days => life.growth(pet, days * DAY)), ['baby', 'young', 'adult', 'seasoned', 'elder']);
  assert.equal(life.growth(life.create('fox', 0), 999), 'egg');
  assert.deepEqual(life.STAGES, ['baby', 'young', 'adult', 'seasoned', 'elder']);
  for (const stage of ['adult', 'seasoned', 'elder']) assert.equal(life.GROWTH_SCALE[stage], 1, stage);
});

test('growing into a stage is one moment; a pet from before 1.9.7 takes its stage quietly', () => {
  // an older save's pet: no record of its stage
  const old = life.tick(hatched({ lastTick: 30 * DAY }), 30 * DAY + 1);
  assert.equal(old.pet.grown, 'seasoned');
  assert.ok(!old.events.some(e => e.startsWith('grow:')), 'no moment for a stage it already had');
  const baby = life.tick(hatched(), 1);
  assert.equal(baby.pet.grown, 'baby');
  const young = life.tick(baby.pet, 50);
  assert.deepEqual(young.events.filter(e => e.startsWith('grow:')), ['grow:young']);
  const again = life.tick(young.pet, 51);
  assert.ok(!again.events.some(e => e.startsWith('grow:')), 'once');
  // a long absence: one moment, for the stage it reached
  const later = life.tick(Object.assign({}, young.pet, { lastTick: 21 * DAY }), 21 * DAY + 1);
  assert.deepEqual(later.events.filter(e => e.startsWith('grow:')), ['grow:seasoned']);
});

test('hatching starts the record at baby', () => {
  let egg = life.create('fox', 0);
  egg = Object.assign(egg, { warmth: life.HATCH_WARMTH });
  const result = life.tick(egg, 3);
  assert.equal(result.pet.stage, 'hatched');
  assert.equal(result.pet.grown, 'baby');
});

test('the next stage and when it starts, for the tab', () => {
  assert.deepEqual(life.nextStage(hatched({ grown: 'adult' })), { stage: 'seasoned', days: 20 });
  assert.deepEqual(life.nextStage(hatched({ grown: 'seasoned' })), { stage: 'elder', days: 60 });
  assert.equal(life.nextStage(hatched({ grown: 'elder' })), null);
  assert.equal(life.nextStage(life.create('fox', 0)), null);
});

test('a memory is kept once, eggs keep none, and only the newest 24 stay', () => {
  const kept = life.remember(hatched(), { k: 'place', id: 'whiterun', s: 'Whiterun' }, 50);
  assert.ok(kept.ok);
  assert.deepEqual(kept.pet.memories, [{ k: 'place', id: 'whiterun', s: 'Whiterun', d: 2 }]);
  assert.ok(life.knows(kept.pet, 'place', 'whiterun'));
  assert.equal(life.remember(kept.pet, { k: 'place', id: 'whiterun', s: 'Whiterun' }, 90).reason, 'known');
  assert.equal(life.remember(life.create('fox', 0), { k: 'dragon', id: 'first' }, 1).reason, 'egg');
  assert.equal(life.remember(hatched(), { k: 'gossip', id: 'x' }, 1).reason, 'not a memory');
  assert.equal(life.remember(hatched(), { k: 'boss', id: '' }, 1).reason, 'not a memory');
  let pet = hatched();
  for (let n = 0; n < 30; n++) pet = life.remember(pet, { k: 'boss', id: `boss ${n}`, s: `Boss ${n}` }, n * DAY).pet;
  assert.equal(pet.memories.length, life.MAX_MEMORIES);
  assert.equal(pet.memories[0].id, 'boss 6');
  assert.equal(life.remember(hatched(), { k: 'boss', id: 'x', s: 'é'.repeat(80) }, 1).pet.memories[0].s.length, 60, 'words clipped by character');
});

test('brought up at most once a game day, only from an earlier day, each in turn', () => {
  let pet = hatched();
  pet = life.remember(pet, { k: 'dragon', id: 'first', s: '' }, 10).pet;
  pet = life.remember(pet, { k: 'place', id: 'riften', s: 'Riften' }, 30).pet;
  assert.equal(life.mention(pet, 20).memory, null, 'nothing from today');
  let said = life.mention(pet, 50);
  assert.equal(said.memory.k, 'dragon');
  assert.equal(life.mention(said.pet, 60).memory, null, 'once a day');
  said = life.mention(said.pet, 75);
  assert.equal(said.memory.id, 'riften', 'the next one in turn');
  said = life.mention(said.pet, 100);
  assert.equal(said.memory.k, 'dragon', 'and round again');
  assert.equal(life.mention(life.create('fox', 0), 100).memory, null);
});

test('memories, the stage and the turn survive a save; anything malformed is dropped', () => {
  let pet = hatched({ grown: 'young' });
  pet = life.remember(pet, { k: 'milestone', id: 'Horse Master I', s: 'Horse Master I' }, 30).pet;
  pet = life.mention(pet, 60).pet;
  const back = life.restore(life.serialize(pet), isSpecies);
  assert.equal(back.grown, 'young');
  assert.deepEqual(back.memories, pet.memories);
  assert.equal(back.lastMention, 60);
  assert.equal(back.mentions, 1);
  const messy = life.restore(JSON.stringify(Object.assign({}, pet, {
    grown: 'ancient', memories: [{ k: 'boss', id: 'Alduin', s: 'Alduin', d: 3 }, { k: 'nope', id: 'x', d: 1 }, { k: 'boss', id: '', d: 1 }, null, { k: 'place', id: 'x' }]
  })), isSpecies);
  assert.equal(messy.grown, undefined);
  assert.deepEqual(messy.memories, [{ k: 'boss', id: 'Alduin', s: 'Alduin', d: 3 }]);
  const egg = life.restore(JSON.stringify(Object.assign(life.create('fox', 0), { memories: [{ k: 'boss', id: 'A', s: 'A', d: 1 }] })), isSpecies);
  assert.equal(egg.memories, undefined, 'an egg has none');
});

function page(petState) {
  const p = loadPage();
  const saved = [];
  p.sandbox.petStateChanged = text => saved.push(text);
  const xp = p.sandbox.dragonbornXP;
  xp.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'fox', raisePet: true, language: 'en' });
  xp.petState({ state: life.serialize(petState), session: 3 });
  xp.setActive(true);
  xp.clock({ hour: 10, minute: 0, hours: petState.lastTick });
  const last = () => life.restore(saved.at(-1).slice(saved.at(-1).indexOf('|') + 1), isSpecies);
  return { p, xp, saved, last };
}

function ask(p, question) {
  let answer = null;
  p.sandbox.selfTestAnswer = text => { answer = JSON.parse(text); };
  p.sandbox.dragonbornXP.selfTest(question);
  return answer;
}

test('the card keeps what the plugin\'s reactions carry: a boss, a milestone, a first visit, a dragon, a tenth level', () => {
  const { xp, last } = page(hatched({ lastTick: 100, grown: 'young' }));
  xp.react({ source: 'dovahdamage', mood: 'hop', captionKey: 'reactBossDown', vars: { name: 'Mirmulnir' }, ms: 3000, priority: 2 });
  xp.reactEnd({});
  xp.react({ source: 'stable', mood: 'fanfare', captionKey: 'reactMilestone', vars: { title: 'Horse Master I' }, ms: 3000, priority: 2 });
  xp.reactEnd({});
  xp.react({ source: 'minipets', mood: 'hop', captionKey: 'placeCity', vars: { place: 'Whiterun', region: 'whiterun', memorable: true }, ms: 3000, priority: 2 });
  xp.reactEnd({});
  xp.react({ source: 'minipets', mood: 'cower', captionKey: 'placeDungeon', vars: { place: 'Bleak Falls Barrow', region: 'tomb', memorable: false }, ms: 3000, priority: 2 });
  xp.reactEnd({});
  xp.dragonSoul({ amount: 1 });
  xp.levelUp({ level: 20 });
  xp.levelUp({ level: 21 });
  const kinds = last().memories.map(m => `${m.k}:${m.id}`);
  assert.deepEqual(kinds, ['boss:Mirmulnir', 'milestone:Horse Master I', 'place:whiterun', 'dragon:first', 'level:20']);
});

test('a memorable place is worded as a first visit only the first time; a self-test\'s is never kept', () => {
  const { p, xp, last } = page(hatched({ lastTick: 100, grown: 'young' }));
  const playing = () => ask(p, { id: 1 }).reactionKey;
  const city = extra => ({ source: 'minipets', mood: 'hop', captionKey: 'placeCity', vars: Object.assign({ place: 'Whiterun', region: 'whiterun', memorable: true }, extra), ms: 3000, priority: 2 });
  xp.react(city({ test: true }));
  assert.equal(playing(), 'placeCityFirst', 'shown as the self-test asked');
  xp.reactEnd({});
  assert.equal((last().memories || []).length, 0, 'the self-test\'s visit is not a memory');
  xp.react(city());
  assert.equal(playing(), 'placeCityFirst');
  xp.reactEnd({});
  xp.react(city());
  assert.equal(playing(), 'placeCity', 'the second time is a return');
  assert.equal(last().memories.length, 1);
});

test('the first-visit and memory words come from the catalogue in every language', () => {
  const i18n = require('../view/i18n.js');
  for (const language of i18n.languages) {
    i18n.setLanguage(language);
    assert.match(i18n.t('placeCityFirst', { place: 'X' }), /X/, language);
    assert.match(i18n.t('memoryPlace', { place: 'X' }), /X/, language);
    assert.match(i18n.t('memoryBoss', { subject: 'Y' }), /Y/, language);
    assert.match(i18n.t('memoryLevel', { level: '30' }), /30/, language);
    assert.match(i18n.t('factNextStageIn', { stage: 'S', time: 'T' }), /S[\s\S]*T|T[\s\S]*S/, language);
  }
  i18n.setLanguage('en');
});

test('the pet brings a memory up on the clock, never over a reaction or a hidden card', () => {
  const pet = life.remember(hatched({ lastTick: 50, grown: 'young' }), { k: 'place', id: 'whiterun', s: 'Whiterun' }, 10).pet;
  const { p, xp, last } = page(pet);
  // the clock tick in page() at 50 h already brought it up
  assert.equal(last().mentions, 1);
  assert.equal(ask(p, { id: 1 }).reaction, 'curious');
  xp.reactEnd({});
  xp.clock({ hour: 12, minute: 0, hours: 60 });
  assert.equal(last().mentions, 1, 'once a day');
  xp.setHidden(true);
  xp.clock({ hour: 12, minute: 0, hours: 80 });
  assert.equal(last().mentions, 1, 'not while hidden');
  xp.setHidden(false);
  xp.react({ source: 'dovahdamage', mood: 'cheer', captionKey: 'reactBigHit', vars: { amount: 300 }, ms: 3000, priority: 2 });
  xp.clock({ hour: 13, minute: 0, hours: 81 });
  assert.equal(last().mentions, 1, 'not over a reaction');
  xp.reactEnd({});
  xp.clock({ hour: 14, minute: 0, hours: 82 });
  assert.equal(last().mentions, 2);
});

test('the self-test\'s made-up pet: grows once, keeps a first visit once, brings it up a day later', () => {
  const { p } = page(hatched({ lastTick: 100, grown: 'young' }));
  const answer = ask(p, { id: 4, sim: 'life' });
  assert.equal(answer.simStart, 'baby');
  assert.equal(answer.simStartGrew, false);
  assert.equal(answer.simGrown, 'young');
  assert.equal(answer.simGrowEvents, 'grow:young');
  assert.equal(answer.simKept, true);
  assert.equal(answer.simAgain, false);
  assert.equal(answer.simSaid, 'whiterun');
  assert.equal(answer.simQuiet, true);
  assert.equal(answer.simWords, 'Our first day in Whiterun');
  assert.equal(ask(p, { id: 5 }).simStart, undefined, 'only when asked');
});

test('the plugin: the card part notices a change of place, never the place a load starts in', () => {
  const { pluginPart } = require('./plugin-source.js');
  const card = pluginPart('Card');
  assert.match(card, /const bool first = g_lastPlace\.empty\(\);\s*g_lastPlace = place;\s*if \(!first\) \{\s*ReactionWiring::OnPlaceChanged\(region, home, name \? name : ""\);/);
  assert.match(card, /void ForgetLastSent\(\)[\s\S]{0,200}g_lastPlace\.clear\(\);/);
  assert.match(card, /HasKeywordString\("LocTypePlayerHouse"\)/);
  const wiring = pluginPart('ReactionWiring');
  assert.match(wiring, /if \(!PetSave::HasPet\(\) \|\| PetSave::PetIsEgg\(\)\) \{\s*return;/, 'a raised, hatched pet only');
  assert.match(wiring, /now - seen->second < kPlaceRepeatMs/, 'the same place again only after ten minutes');
  assert.match(wiring, /OfferReaction\(reaction, false\);/);
  assert.match(wiring, /void ResetReactions\(\)[\s\S]{0,600}g_placeSeenMs\.clear\(\);/, 'a load starts the places over');
});

test('the DovahHub tab shows the stage ahead and the newest memories', () => {
  const tab = fs.readFileSync(path.join(__dirname, '..', 'hub', 'modules', 'pets', 'pets.js'), 'utf8');
  assert.match(tab, /seasoned: 'tabStageSeasoned', elder: 'tabStageElder'/);
  assert.match(tab, /fact\(t\('factNextStage'\)/);
  assert.match(tab, /renderMemories\(pet\);/);
  assert.match(tab, /const MEMORIES_SHOWN = 5;/);
});
