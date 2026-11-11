// DMP-10: the pet reacts to the game and the suite. The decisions (cooldown, priority, holds, story
// events) are tested in tests/cpp/reactions.cpp; this covers the page side and the wiring.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const reactions = require('../view/reactions.js');
const sprites = require('../view/pet-sprites.js');
const life = require('../view/pet-life.js');
const i18n = require('../view/i18n.js');

function fakeTimers() {
  const timers = [];
  return {
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].fn = null; },
    fire: () => { const t = timers.filter(x => x.fn); t.forEach(x => { const fn = x.fn; x.fn = null; fn(); }); },
    pending: () => timers.filter(x => x.fn).length
  };
}

test('a reaction shows, then ends after its ms', () => {
  const timers = fakeTimers();
  const seen = [];
  const player = reactions.createPlayer({ setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, onChange: r => seen.push(r && r.mood) });
  assert.ok(player.show({ mood: 'cheer', ms: 2000 }));
  assert.strictEqual(player.current().mood, 'cheer');
  timers.fire();
  assert.strictEqual(player.current(), null);
  assert.deepStrictEqual(seen, ['cheer', null]);
});

test('a held pose stays until ended, and only weighty reactions replace it', () => {
  const timers = fakeTimers();
  const player = reactions.createPlayer({ setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
  player.show({ mood: 'sad', hold: true, priority: 2 });
  assert.strictEqual(timers.pending(), 0, 'no timer on a held pose');
  assert.ok(!player.show({ mood: 'cheer', priority: 1 }), 'priority 1 waits');
  assert.ok(!player.end('sleep'), 'ending another mood does nothing');
  assert.strictEqual(player.current().mood, 'sad');
  assert.ok(player.show({ mood: 'wave', priority: 2 }), 'priority 2 replaces it');
  assert.ok(player.end(), 'a load ends anything');
  assert.strictEqual(player.current(), null);
});

test('unknown moods are ignored and numbers are clamped', () => {
  assert.strictEqual(reactions.normalize({ mood: 'dance' }), null);
  const r = reactions.normalize({ mood: 'wave', ms: 99999, priority: 9 });
  assert.strictEqual(r.ms, 6000);
  assert.strictEqual(r.priority, 2);
  assert.strictEqual(reactions.normalize({ mood: 'wave', ms: 'x' }).ms, 2500);
});

test('the caption is the other mod\'s, or MiniPets\' own line, or the name; the detail says what the pet does', () => {
  i18n.setLanguage('en');
  const t = (key, vars) => i18n.t(key, vars);
  assert.deepStrictEqual(reactions.captionFor(reactions.normalize({ mood: 'wave', caption: 'Frost is home.' }), t, 'Pip').slice(0, 2), ['Frost is home.', 'Pip waves hello.']);
  assert.deepStrictEqual(reactions.captionFor(reactions.normalize({ mood: 'cheer', captionKey: 'reactBigHit', vars: { amount: 412 } }), t, 'Pip').slice(0, 2), ['412 damage!', 'Pip cheers.']);
  assert.deepStrictEqual(reactions.captionFor(reactions.normalize({ mood: 'curious' }), t, 'Pip').slice(0, 2), ['Pip', 'Pip tilts its head, curious.']);
  i18n.setLanguage('de');
  assert.deepStrictEqual(reactions.captionFor(reactions.normalize({ mood: 'cower', captionKey: 'reactCareful' }), t, 'Pip').slice(0, 2), ['Vorsicht!', 'Pip hält sich die Augen zu.']);
  i18n.setLanguage('ja');
  assert.strictEqual(reactions.captionFor(reactions.normalize({ mood: 'wave', captionKey: 'reactJoined', vars: { name: 'Lydia' } }), t, 'Pip')[0], 'こんにちは、Lydia！');
  i18n.setLanguage('en');
});

test('every caption key the plugin and the story mapping send is in every language', () => {
  const cpp = require('./plugin-source.js').pluginSource() + read('src/Reactions.h');
  const keys = [...new Set([...cpp.matchAll(/"(react[A-Z][A-Za-z]+)"/g)].map(m => m[1]))].filter(key => key !== 'reactToMods');
  assert.ok(keys.length >= 14, `found ${keys.length} caption keys`);
  const moodLines = reactions.MOODS.map(mood => 'react' + mood[0].toUpperCase() + mood.slice(1));
  for (const id of Object.keys(i18n.languageNames)) {
    i18n.setLanguage(id);
    for (const key of [...keys, ...moodLines]) {
      const text = i18n.t(key, { name: 'N', amount: 1, title: 'T' });
      assert.ok(text && text !== key, `${id}: ${key}`);
    }
  }
  i18n.setLanguage('en');
});

test('every mood has an emote, drawn as pixels, never as a letter', () => {
  for (const mood of reactions.MOODS) {
    const name = reactions.EMOTES[mood];
    const rows = sprites.ornaments[name];
    assert.ok(Array.isArray(rows) && rows.length >= 5, `${mood}: ${name}`);
    for (const row of rows) for (const cell of row) assert.ok(cell === '.' || sprites.ornaments.palette[cell], `${name}: colour ${cell}`);
  }
});

test('every mood has shared body language, and every keyframe it uses exists', () => {
  const css = read('view/styles.css') + read('view/pet-motion.css');
  for (const mood of reactions.MOODS) {
    assert.ok(css.includes(`#dragonborn-xp.reacting.react-${mood} .pet-motion`), `${mood}: .pet-motion rule`);
  }
  const block = css.slice(css.indexOf('/* Reactions (1.9.0)'));
  const used = new Set([...block.matchAll(/animation: ([a-z-]+) /g)].map(m => m[1]).filter(name => name !== 'none'));
  for (const name of used) assert.ok(css.includes(`@keyframes ${name} `), `keyframes ${name}`);
});

test('species touches: the mudcrab clacks and the wisp dims, as the brief asks', () => {
  const css = read('view/styles.css');
  assert.match(css, /pet-mudcrab\.reacting\.react-cheer \.role-claw-a/);
  assert.match(css, /pet-wisp\.reacting\.react-sad \.pet-sprite[^{]*\{[^}]*opacity/);
});

test('shared moments count as care three times a game day at most, and eggs are left alone', () => {
  let pet = Object.assign(life.create('fox', 0), { stage: 'hatched', hatchedAt: 1, happiness: 50 });
  assert.strictEqual(life.shareMoment(life.create('fox', 0), 10).ok, false, 'an egg');
  for (let i = 0; i < 3; i += 1) {
    const result = life.shareMoment(pet, 30);
    assert.ok(result.ok);
    pet = result.pet;
  }
  assert.strictEqual(pet.happiness, 62);
  assert.strictEqual(life.shareMoment(pet, 40).reason, 'enough today');
  assert.ok(life.shareMoment(pet, 50).ok, 'the next game day');
  const restored = life.restore(life.serialize(pet), () => true);
  assert.strictEqual(restored.careCount, 3);
  assert.strictEqual(life.restore(JSON.stringify({ species: 'fox', careDay: 1, careCount: 99 }), () => true).careCount, life.CARE_PER_DAY);
});

test('the page loads reactions.js before app.js and has the emote spot', () => {
  const html = read('view/index.html');
  assert.ok(html.indexOf('reactions.js') > 0 && html.indexOf('reactions.js') < html.indexOf('app.js'));
  assert.match(html, /class="pet-emote"/);
  const app = read('view/app.js');
  assert.match(app, /react\(data\) \{/);
  assert.match(app, /reactEnd\(data\) \{/);
  assert.match(app, /window\.petSays\(/);
});

test('the plugin: React in API version 2, DovahDamage polled on the game-thread task, DovahHub broadcasts heard', () => {
  const api = read('src/MiniPets_API.h');
  assert.match(api, /struct MiniPetsApi2 : MiniPetsApi1/);
  assert.match(api, /Result \(\*React\)\(const char\* reactionJson\);/);
  assert.match(api, /inline const MiniPetsApi2\* RequestApi2\(\)/);
  const cpp = require('./plugin-source.js').pluginSource();
  assert.match(cpp, /version == MINIPETS_API::kApiVersion1 \|\| version == MINIPETS_API::kApiVersion2/);
  assert.strictEqual(cpp.split('GetTotals(').length - 1, 1, 'GetTotals is read in one place');
  const poll = cpp.slice(cpp.indexOf('void StartCompanionStatePoller()'));
  assert.match(poll.slice(0, 1400), /GameThread\("250 ms update"\)\) \{\s*taskInterface->Queue\(\[\]\(\) \{[\s\S]*ReactionWiring::UpdateReactions\(\);/);
  assert.match(cpp.slice(cpp.indexOf('void UpdateReactions()'), cpp.indexOf('void OnDovahHubMessage')), /PollDovahDamage\(\);/);
  assert.match(cpp, /RegisterListener\("DovahHub", ReactionWiring::OnDovahHubMessage\)/);
  assert.match(cpp, /std::lock_guard lock\(g_reactQueueLock\);\s*g_reactQueue\.emplace_back/);
  assert.match(cpp, /SetUniqueID\('DBXP'\)/, 'the co-save id never changes');
});

test('the DovahHub settings: one switch, the cooldown, and the two extras off by default', () => {
  const cpp = require('./plugin-source.js').pluginSource();
  const schema = cpp.slice(cpp.indexOf('std::string HubSettingsSchema()'), cpp.indexOf('std::string CompanionsJson()'));
  assert.match(schema, /\\"react_to_mods\\"[^\n]*\\"value\\":true/);
  assert.match(schema, /\\"reaction_cooldown\\"[^\n]*\\"type\\":\\"range\\"/);
  assert.match(schema, /\\"care_moments\\"[^\n]*\\"value\\":false/);
  assert.match(schema, /\\"chronicle_lines\\"[^\n]*\\"value\\":false/);
  for (const key of ['react_to_mods', 'reaction_cooldown', 'care_moments', 'chronicle_lines']) {
    assert.ok(cpp.includes(`key == "${key}"`), `${key} read from the INI and the hub`);
  }
  const header = read('src/HubText.h');
  for (const field of ['reactToMods', 'reactToModsNote', 'reactionCooldown', 'careMoments', 'careMomentsNote', 'chronicleLines', 'chronicleLinesNote']) {
    assert.ok(header.includes(`const char* ${field};`), field);
  }
});
