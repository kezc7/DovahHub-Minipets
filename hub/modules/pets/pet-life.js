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
        next.grown = 'baby';
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
    // DMP-13: growing into a new stage is a moment, once; a pet from before 1.9.7 takes its stage quietly
    const grown = growth(next, next.lastTick);
    if (!STAGES.includes(next.grown)) next.grown = grown;
    else if (STAGES.indexOf(grown) > STAGES.indexOf(next.grown)) {
      next.grown = grown;
      events.push(`grow:${grown}`);
    }
    return { pet: next, events };
  }

  function feed(pet) {
    if (pet.stage === 'egg') return { pet, ok: false, reason: 'egg' };
    if (pet.hunger >= 98) return { pet, ok: false, reason: 'full' };
    return { pet: Object.assign({}, pet, { hunger: clamp(pet.hunger + 35), happiness: clamp(pet.happiness + 5) }), ok: true };
  }

  function play(pet, hours) {
    if (pet.lastPlay !== null && hours - pet.lastPlay < PLAY_COOLDOWN) return { pet, ok: false, reason: 'tired' };
    if (pet.stage === 'egg') {
      // a cuddle warms the egg a little
      return { pet: Object.assign({}, pet, { warmth: Math.min(HATCH_WARMTH, pet.warmth + 0.5), lastPlay: hours }), ok: true, reason: 'egg' };
    }
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

  // egg, baby (first 2 in-game days), young (up to 5), adult (up to 20), seasoned (up to 60), elder.
  // DMP-13 added the last two: a longer life, at full size
  const STAGES = ['baby', 'young', 'adult', 'seasoned', 'elder'];
  const STAGE_DAYS = { young: 2, adult: 5, seasoned: 20, elder: 60 };
  function growth(pet, hours) {
    if (pet.stage === 'egg') return 'egg';
    const days = (hours - pet.hatchedAt) / 24;
    return days < STAGE_DAYS.young ? 'baby' : days < STAGE_DAYS.adult ? 'young' : days < STAGE_DAYS.seasoned ? 'adult' : days < STAGE_DAYS.elder ? 'seasoned' : 'elder';
  }

  // the stage after this one and the in-game day it starts, or null for an elder
  function nextStage(pet) {
    if (!pet || pet.stage === 'egg') return null;
    const at = STAGES.indexOf(STAGES.includes(pet.grown) ? pet.grown : 'baby');
    const next = STAGES[at + 1];
    return next ? { stage: next, days: STAGE_DAYS[next] } : null;
  }

  const GROWTH_SCALE = { baby: 0.62, young: 0.8, adult: 1, seasoned: 1, elder: 1 };

  // DMP-13: what a hatched pet saw with you, kept with the pet in its save. Each memory is
  // {k: kind, id: what makes it one of a kind, s: the words shown, d: the game day}. Only the first of
  // each is kept: the first dragon, each boss once, a place's first visit.
  const MEMORY_KINDS = ['dragon', 'boss', 'place', 'milestone', 'level'];
  const MAX_MEMORIES = 24;
  const MEMORY_GAP_HOURS = 24;

  function clip(value, max) {
    return Array.from(String(value === undefined || value === null ? '' : value)).slice(0, max).join('');
  }

  function knows(pet, kind, id) {
    return Boolean(pet && Array.isArray(pet.memories) && pet.memories.some(m => m.k === kind && m.id === clip(id, 64)));
  }

  function remember(pet, memory, hours) {
    if (!pet || pet.stage === 'egg') return { pet, ok: false, reason: pet ? 'egg' : 'no pet' };
    if (!memory || !MEMORY_KINDS.includes(memory.k) || !Number.isFinite(hours)) return { pet, ok: false, reason: 'not a memory' };
    const id = clip(memory.id, 64);
    if (!id) return { pet, ok: false, reason: 'not a memory' };
    if (knows(pet, memory.k, id)) return { pet, ok: false, reason: 'known' };
    const list = (Array.isArray(pet.memories) ? pet.memories : []).concat([{ k: memory.k, id, s: clip(memory.s, 60), d: Math.floor(hours / 24) }]);
    return { pet: Object.assign({}, pet, { memories: list.slice(-MAX_MEMORIES) }), ok: true };
  }

  // now and then the pet brings one up: at most once a game day, one from an earlier day, each in turn
  function mention(pet, hours) {
    if (!pet || pet.stage === 'egg' || !Array.isArray(pet.memories) || !Number.isFinite(hours)) return { pet, memory: null };
    if (Number.isFinite(pet.lastMention) && hours - pet.lastMention < MEMORY_GAP_HOURS) return { pet, memory: null };
    const today = Math.floor(hours / 24);
    const older = pet.memories.filter(m => m.d < today);
    if (!older.length) return { pet, memory: null };
    const turn = Number.isFinite(pet.mentions) ? pet.mentions : 0;
    return { pet: Object.assign({}, pet, { lastMention: hours, mentions: turn + 1 }), memory: older[turn % older.length] };
  }

  function mood(pet) {
    if (pet.stage === 'egg') return 'egg';
    if (pet.hunger < 15 && pet.happiness < 15) return 'miserable';
    if (pet.hunger < 30) return 'hungry';
    if (pet.happiness < 30) return 'sad';
    if (pet.hunger > 50 && pet.happiness > 75) return 'happy';
    return 'content';
  }

  // 1.9.0, optional and off by default: a big moment the companion saw with you (a record hit, a boss,
  // a new follower) counts as a little care, at most CARE_PER_DAY times a game day, so it never
  // replaces Feed and Play. Eggs are left alone.
  const CARE_PER_DAY = 3;
  const CARE_HAPPINESS = 4;
  function shareMoment(pet, hours) {
    if (!pet || pet.stage === 'egg' || !Number.isFinite(hours)) return { pet, ok: false, reason: pet ? 'egg' : 'no pet' };
    const day = Math.floor(hours / 24);
    const count = pet.careDay === day ? pet.careCount || 0 : 0;
    if (count >= CARE_PER_DAY) return { pet, ok: false, reason: 'enough today' };
    return { pet: Object.assign({}, pet, { happiness: clamp(pet.happiness + CARE_HAPPINESS), careDay: day, careCount: count + 1 }), ok: true };
  }

  function eggProgress(pet) {
    return pet.stage === 'egg' ? pet.warmth / HATCH_WARMTH : 1;
  }

  function serialize(pet) {
    return JSON.stringify(pet);
  }

  function restoreMemories(list) {
    return list
      .filter(m => m && MEMORY_KINDS.includes(m.k) && clip(m.id, 64) && Number.isFinite(m.d))
      .map(m => ({ k: m.k, id: clip(m.id, 64), s: clip(m.s, 60), d: Math.floor(m.d) }))
      .slice(-MAX_MEMORIES);
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
      lastPlay: Number.isFinite(data.lastPlay) ? data.lastPlay : null,
      ...(Number.isFinite(data.careDay) ? { careDay: data.careDay, careCount: Math.max(0, Math.min(CARE_PER_DAY, number(data.careCount, 0))) } : {}),
      ...(hatched && STAGES.includes(data.grown) ? { grown: data.grown } : {}),
      ...(hatched && Array.isArray(data.memories) ? { memories: restoreMemories(data.memories) } : {}),
      ...(Number.isFinite(data.lastMention) ? { lastMention: data.lastMention } : {}),
      ...(Number.isFinite(data.mentions) ? { mentions: Math.max(0, Math.floor(data.mentions)) } : {})
    };
  }

  return Object.freeze({ HATCH_WARMTH, GROWTH_SCALE, STAGES, STAGE_DAYS, MEMORY_KINDS, MAX_MEMORIES, create, tick, feed, play, xp, levelUp, growth, nextStage, mood, eggProgress,
    shareMoment, CARE_PER_DAY, remember, knows, mention, serialize, restore });
});
