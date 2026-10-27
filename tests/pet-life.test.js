const test = require('node:test');
const assert = require('node:assert/strict');
const life = require('../view/pet-life.js');

const isSpecies = name => ['fox', 'chicken'].includes(name);

test('a new egg starts cold and full', () => {
  const pet = life.create('fox', 100);
  assert.equal(pet.stage, 'egg');
  assert.equal(life.mood(pet), 'egg');
  assert.equal(life.eggProgress(pet), 0);
});

test('time and xp warm the egg until it hatches', () => {
  let pet = life.create('fox', 0);
  pet = life.tick(pet, 8).pet;
  assert.equal(life.eggProgress(pet), 2 / 12);
  for (let index = 0; index < 7; index += 1) pet = life.xp(pet);
  pet = life.levelUp(pet);
  assert.equal(pet.warmth, 12);
  const result = life.tick(pet, 9);
  assert.equal(result.pet.stage, 'hatched');
  assert.deepEqual(result.events, ['hatched']);
});

test('an egg needs at least two hours before hatching', () => {
  let pet = life.create('fox', 0);
  for (let index = 0; index < 12; index += 1) pet = life.xp(pet);
  assert.equal(life.tick(pet, 1).pet.stage, 'egg');
  assert.equal(life.tick(pet, 2).pet.stage, 'hatched');
});

function hatched(hours = 0) {
  let pet = life.create('fox', hours - 10);
  for (let index = 0; index < 12; index += 1) pet = life.xp(pet);
  return life.tick(pet, hours).pet;
}

test('needs drop over time and moods follow', () => {
  let pet = hatched();
  assert.equal(life.mood(pet), 'happy');
  const later = life.tick(pet, 20);
  assert.equal(later.pet.hunger, 10);
  assert.equal(life.mood(later.pet), 'hungry');
  assert.ok(later.events.includes('mood:hungry'));
  pet = life.tick(later.pet, 40).pet;
  assert.equal(life.mood(pet), 'miserable');
});

test('a pet never dies and bounces back with care', () => {
  let pet = life.tick(hatched(), 500).pet;
  pet = life.tick(pet, 1000).pet;
  assert.equal(pet.hunger, 0);
  assert.equal(pet.happiness, 0);
  pet = life.feed(pet).pet;
  pet = life.feed(pet).pet;
  pet = life.play(pet, 1000).pet;
  assert.equal(pet.hunger, 70);
  assert.equal(life.mood(pet), 'content');
});

test('long waits only count up to three days', () => {
  const pet = hatched();
  assert.equal(life.tick(pet, 72).pet.hunger, life.tick(pet, 1000).pet.hunger);
});

test('eggs cannot eat, full pets refuse food, play has a cooldown', () => {
  assert.equal(life.feed(life.create('fox', 0)).reason, 'egg');
  assert.equal(life.feed(life.feed(hatched()).pet).reason, 'full');
  const played = life.play(hatched(), 0);
  assert.ok(played.ok);
  assert.equal(life.play(played.pet, 1).reason, 'tired');
  assert.ok(life.play(played.pet, 2).ok);
  assert.equal(life.play(life.create('fox', 0), 0).pet.warmth, 0.5);
  // cuddles share the cooldown, so an egg can't be hatched by mashing the key
  const cuddled = life.play(life.create('fox', 0), 0).pet;
  assert.equal(life.play(cuddled, 1).reason, 'tired');
  assert.equal(life.play(cuddled, 2).pet.warmth, 1);
});

test('pets grow from baby to adult over in-game days', () => {
  const pet = hatched(0);
  assert.equal(life.growth(pet, 10), 'baby');
  assert.equal(life.growth(pet, 60), 'young');
  assert.equal(life.growth(pet, 200), 'adult');
});

test('saved pets round-trip and junk is rejected', () => {
  const pet = life.play(hatched(5), 6).pet;
  assert.deepEqual(life.restore(life.serialize(pet), isSpecies), pet);
  assert.equal(life.restore('not json', isSpecies), null);
  assert.equal(life.restore('{"species":"dragon-of-doom"}', isSpecies), null);
  const patched = life.restore('{"species":"chicken","hunger":900,"warmth":-5}', isSpecies);
  assert.equal(patched.hunger, 100);
  assert.equal(patched.warmth, 0);
  assert.equal(patched.stage, 'egg');
});
