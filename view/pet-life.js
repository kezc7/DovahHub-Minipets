(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetLife = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // Raise-a-pet rules. All times are in-game hours (Calendar hours passed).
  const HATCH_WARMTH = 12;
  const EGG_HOURS_PER_WARMTH = 4;
  const MIN_EGG_HOURS = 2;
  const HUNGER_PER_HOUR = 3;
  const HAPPINESS_PER_HOUR = 2;
  const PLAY_COOLDOWN = 2;
  // don't punish people for a long sleep or wait
  const MAX_CATCH_UP = 72;

  const clamp = value => Math.min(100, Math.max(0, value));

  function create(species, hours) {
    return { species, stage: 'egg', laidAt: hours, warmth: 0, hatchedAt: null, hunger: 100, happiness: 80, lastTick: hours, lastPlay: null };
  }

  function tick(pet, hours) {
    const next = Object.assign({}, pet);
    const elapsed = Math.min(MAX_CATCH_UP, Math.max(0, hours - pet.lastTick));
    next.lastTick = Math.max(pet.lastTick, hours);
    const events = [];
    if (next.stage === 'egg') {
      next.warmth = Math.min(HATCH_WARMTH, next.warmth + elapsed / EGG_HOURS_PER_WARMTH);
      if (next.warmth >= HATCH_WARMTH && hours - next.laidAt >= MIN_EGG_HOURS) {
        next.stage = 'hatched';
        next.hatchedAt = hours;
        next.hunger = 70;
        next.happiness = 90;
        events.push('hatched');
      }
      return { pet: next, events };
    }
    const wasMood = mood(pet);
    next.hunger = clamp(next.hunger - HUNGER_PER_HOUR * elapsed);
    // hungry pets get grumpy faster
    const extra = next.hunger < 30 ? 1 : 0;
    next.happiness = clamp(next.happiness - (HAPPINESS_PER_HOUR + extra) * elapsed);
    const nowMood = mood(next);
    if (nowMood !== wasMood) events.push(`mood:${nowMood}`);
    return { pet: next, events };
  }

  function feed(pet) {
    if (pet.stage === 'egg') return { pet, ok: false, reason: 'egg' };
    if (pet.hunger >= 98) return { pet, ok: false, reason: 'full' };
    return { pet: Object.assign({}, pet, { hunger: clamp(pet.hunger + 35), happiness: clamp(pet.happiness + 5) }), ok: true };
  }

  function play(pet, hours) {
    if (pet.stage === 'egg') {
      // a cuddle warms the egg a little
      return { pet: Object.assign({}, pet, { warmth: Math.min(HATCH_WARMTH, pet.warmth + 0.5) }), ok: true, reason: 'egg' };
    }
    if (pet.lastPlay !== null && hours - pet.lastPlay < PLAY_COOLDOWN) return { pet, ok: false, reason: 'tired' };
    return { pet: Object.assign({}, pet, { happiness: clamp(pet.happiness + 25), lastPlay: hours }), ok: true };
  }

  function xp(pet, amount = 1) {
    if (pet.stage === 'egg') return Object.assign({}, pet, { warmth: Math.min(HATCH_WARMTH, pet.warmth + amount) });
    return Object.assign({}, pet, { happiness: clamp(pet.happiness + 2 * amount) });
  }

  function levelUp(pet) {
    if (pet.stage === 'egg') return Object.assign({}, pet, { warmth: Math.min(HATCH_WARMTH, pet.warmth + 3) });
    return Object.assign({}, pet, { happiness: clamp(pet.happiness + 15) });
  }

  // egg, baby (first 2 in-game days), young (up to 5), adult
  function growth(pet, hours) {
    if (pet.stage === 'egg') return 'egg';
    const days = (hours - pet.hatchedAt) / 24;
    return days < 2 ? 'baby' : days < 5 ? 'young' : 'adult';
  }

  const GROWTH_SCALE = { baby: 0.62, young: 0.8, adult: 1 };

  function mood(pet) {
    if (pet.stage === 'egg') return 'egg';
    if (pet.hunger < 15 && pet.happiness < 15) return 'miserable';
    if (pet.hunger < 30) return 'hungry';
    if (pet.happiness < 30) return 'sad';
    if (pet.hunger > 50 && pet.happiness > 75) return 'happy';
    return 'content';
  }

  function eggProgress(pet) {
    return pet.stage === 'egg' ? pet.warmth / HATCH_WARMTH : 1;
  }

  function serialize(pet) {
    return JSON.stringify(pet);
  }

  // Returns null for anything that isn't a valid saved pet.
  function restore(text, isSpecies) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      return null;
    }
    if (!data || typeof data !== 'object' || !isSpecies(data.species)) return null;
    const number = (value, fallback) => (Number.isFinite(value) ? value : fallback);
    const hatched = data.stage === 'hatched';
    return {
      species: data.species,
      stage: hatched ? 'hatched' : 'egg',
      laidAt: number(data.laidAt, 0),
      warmth: Math.min(HATCH_WARMTH, Math.max(0, number(data.warmth, 0))),
      hatchedAt: hatched ? number(data.hatchedAt, number(data.laidAt, 0)) : null,
      hunger: clamp(number(data.hunger, 100)),
      happiness: clamp(number(data.happiness, 80)),
      lastTick: number(data.lastTick, number(data.laidAt, 0)),
      lastPlay: Number.isFinite(data.lastPlay) ? data.lastPlay : null
    };
  }

  return Object.freeze({ HATCH_WARMTH, GROWTH_SCALE, create, tick, feed, play, xp, levelUp, growth, mood, eggProgress, serialize, restore });
});
