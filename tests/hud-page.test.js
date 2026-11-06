// Loads the HUD page scripts the way index.html does, in a sandbox with a stand-in DOM where
// every element accepts any property and any call. Enough to run app.js start to finish and
// read back what it wrote, without a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const VIEW_DIR = path.join(__dirname, '..', 'view');
const PAGE_SCRIPTS = ['animation-state.js', 'i18n.js', 'pet-sprites.js', 'clock.js', 'pet-life.js', 'regions.js', 'sky.js', 'app.js'];

function makeElements() {
  const elements = new Map();
  function element(name) {
    if (elements.has(name)) return elements.get(name);
    const store = { dataset: {}, textContent: '', value: '' };
    const listeners = {};
    const self = new Proxy(function () {}, {
      get(target, prop) {
        if (prop in store) return store[prop];
        if (prop === 'addEventListener') return (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
        // test helper: run the listeners app.js added
        if (prop === 'fire') return type => (listeners[type] || []).forEach(fn => fn({ preventDefault() {}, stopPropagation() {}, target: self }));
        if (prop === Symbol.iterator) return function* () {};
        if (prop === Symbol.toPrimitive) return () => '';
        if (prop === 'then') return undefined;
        if (prop === 'length' || prop === 'childElementCount' || prop === 'offsetWidth' || prop === 'offsetHeight') return 0;
        if (prop === 'options' || prop === 'children') return [];
        if (prop === 'querySelector' || prop === 'getElementById') return selector => element(String(selector));
        if (typeof prop === 'symbol') return undefined;
        return element(`${name}.${String(prop)}`);
      },
      set(target, prop, value) { store[prop] = value; return true; },
      apply() { return element(`${name}()`); },
      construct() { return element(`new ${name}`); }
    });
    elements.set(name, self);
    return self;
  }
  return element;
}

function loadPage({ skip = [] } = {}) {
  const element = makeElements();
  const document = element('document');
  const errors = [];
  const logged = [];
  const sandbox = {
    document,
    console: { log() {}, warn() {}, info() {}, error: (...args) => errors.push(args.join(' ')) },
    location: { search: '', href: 'http://localhost/index.html' },
    navigator: { userAgent: 'node' },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    performance: { now: () => 0 },
    Option: function Option(text, value) { return { text, value, textContent: text }; },
    URLSearchParams, Math, Date, JSON, Object, Array, String, Number, Boolean, Map, Set, Promise, Symbol, Error
  };
  sandbox.viewLog = line => logged.push(line);
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.getComputedStyle = () => element('computed');
  vm.createContext(sandbox);
  for (const file of PAGE_SCRIPTS) {
    if (skip.includes(file)) continue;
    vm.runInContext(fs.readFileSync(path.join(VIEW_DIR, file), 'utf8'), sandbox, { filename: file });
  }
  return { sandbox, element, errors, logged };
}

test('the HUD page starts with every script present', () => {
  assert.doesNotThrow(() => loadPage());
});

test('the HUD page still starts, in English, when i18n.js did not load', () => {
  let page;
  assert.doesNotThrow(() => { page = loadPage({ skip: ['i18n.js'] }); });
  assert.equal(page.sandbox.PetI18n, undefined, 'the catalogue really was left out');
  assert.equal(typeof page.sandbox.dragonbornXP, 'object', 'app.js reached the end and registered its bridge');
});

test('without i18n.js the popups use the English fallback text', () => {
  const page = loadPage({ skip: ['i18n.js'] });
  assert.doesNotThrow(() => page.sandbox.dragonbornXP.dragonSoul({ amount: 2 }));
  assert.equal(page.element('#title').textContent, 'Dragon soul absorbed');
  assert.equal(page.element('#detail').textContent, '+2 souls.');
});

function eggPage(language) {
  const page = loadPage();
  const life = require('../view/pet-life.js');
  page.sandbox.dragonbornXP.initialize({ language, raisePet: true, x: -1, y: -1 });
  page.sandbox.dragonbornXP.petState({ state: life.serialize(life.create('fox', 0)) });
  page.sandbox.dragonbornXP.openSettings({ language, raisePet: true, x: -1, y: -1 });
  return page;
}

test('the egg label comes from the catalogue in every language', () => {
  const i18n = require('../view/i18n.js');
  for (const language of i18n.languages) {
    i18n.setLanguage(language);
    const label = i18n.t('eggName', { name: 'Ember' });
    assert.notEqual(label, 'eggName', `${language} has an eggName entry`);
    assert.ok(label.includes('Ember'), `${language} eggName places {name}: ${label}`);
    if (language !== 'en') assert.ok(!label.includes("'s"), `${language} eggName has no English possessive: ${label}`);
  }
  i18n.setLanguage('en');
});

test('the card and the settings panel name the egg in the chosen language', () => {
  const page = eggPage('de');
  assert.equal(page.element('#pet-life-name').textContent, 'Ei von Ember (Fuchs)');
  const english = eggPage('en');
  assert.equal(english.element('#pet-life-name').textContent, "Ember's egg (Fox)");
});

test('the page reports its language and catalogue to MiniPets.log', () => {
  const page = loadPage();
  page.sandbox.dragonbornXP.initialize({ language: 'de', x: -1, y: -1 });
  assert.equal(page.logged.at(-1), 'language de, catalogue loaded');
  const bare = loadPage({ skip: ['i18n.js'] });
  bare.sandbox.dragonbornXP.initialize({ language: 'de', x: -1, y: -1 });
  assert.equal(bare.logged.at(-1), 'language en, i18n.js missing, English fallback');
});

// The English the card showed in 1.8.0, before the language work; English must not change.
function card(page) {
  return `${page.element('#title').textContent} | ${page.element('#detail').textContent}`;
}

function freshPage(settings = {}) {
  const page = loadPage();
  page.sandbox.dragonbornXP.initialize(Object.assign({ language: 'en', x: -1, y: -1, pet: 'fox' }, settings));
  return page;
}

test('English popups read as they did in 1.8.0', () => {
  let page = freshPage();
  page.sandbox.dragonbornXP.skillGain({ skill: 'Smithing' });
  assert.equal(card(page), 'XP gained | Smithing grows stronger.');
  page = freshPage();
  page.sandbox.dragonbornXP.levelUp({ level: 3 });
  assert.equal(card(page), 'Level 3! | The Dragonborn grows mighty.');
  page = freshPage();
  page.sandbox.dragonbornXP.companionState({ state: 'flying' });
  assert.equal(card(page), 'Off you run! | Ember trots beside you.');
  page.sandbox.dragonbornXP.companionState({ state: 'combat' });
  assert.equal(card(page), 'Pounce! | Ember leaps into the fray.');
  page = freshPage({ pet: 'mudcrab' });
  page.sandbox.dragonbornXP.companionState({ state: 'combat' });
  assert.equal(card(page), 'Snap snap! | Clack raises both claws.');
});

test('English egg texts read as they did in 1.8.0', () => {
  const page = eggPage('en');
  assert.equal(page.element('#pet-feed').textContent, 'Feed (after hatching)');
  assert.equal(page.element('#pet-reset').textContent, 'Start over');
  page.element('#pet-reset').fire('click');
  assert.equal(page.element('#pet-reset').textContent, 'Click again to start over');
  page.sandbox.dragonbornXP.levelUp({ level: 4 });
  assert.equal(card(page), 'Level 4! | The egg glows with warmth!');
});

test('in French and Japanese two companions say their own lines while moving and in combat', () => {
  for (const language of ['fr', 'ja']) {
    const lines = {};
    for (const pet of ['fox', 'mudcrab']) {
      const page = freshPage({ language, pet });
      page.sandbox.dragonbornXP.companionState({ state: 'flying' });
      const moving = card(page);
      page.sandbox.dragonbornXP.companionState({ state: 'combat' });
      lines[pet] = { moving, combat: card(page) };
    }
    assert.notEqual(lines.fox.moving, lines.mudcrab.moving, `${language} moving lines differ`);
    assert.notEqual(lines.fox.combat, lines.mudcrab.combat, `${language} combat lines differ`);
    for (const line of Object.values(lines).flatMap(pair => Object.values(pair))) {
      assert.doesNotMatch(line.replace(/Ember|Clack/g, ''), /\b(the|you|joins|fight|along|beside)\b/i, `${language}: ${line}`);
    }
  }
  const fr = freshPage({ language: 'fr', pet: 'mudcrab' });
  fr.sandbox.dragonbornXP.companionState({ state: 'combat' });
  assert.equal(card(fr), 'Clac clac ! | Clack lève ses deux pinces.');
  const ja = freshPage({ language: 'ja', pet: 'fox' });
  ja.sandbox.dragonbornXP.companionState({ state: 'flying' });
  assert.equal(card(ja), 'さあ行こう！ | Emberがあなたの横を駆けていきます。');
});

test('every companion has its own lines in every language', () => {
  const i18n = require('../view/i18n.js');
  const english = (i18n.setLanguage('en'), Object.keys(i18n.value('captions')));
  for (const language of i18n.languages) {
    i18n.setLanguage(language);
    for (const pet of english) {
      for (const state of ['moving', 'combat']) {
        const pair = i18n.caption(pet, state);
        assert.ok(Array.isArray(pair) && pair.length === 2, `${language} ${pet} ${state}`);
        if (pet !== 'egg') assert.ok(pair[1].includes('{name}'), `${language} ${pet} ${state} names the companion: ${pair[1]}`);
      }
    }
  }
  i18n.setLanguage('en');
});

test('feeding, playing and hatching celebrate in the chosen language', () => {
  const life = require('../view/pet-life.js');
  const page = loadPage();
  page.sandbox.dragonbornXP.initialize({ language: 'de', raisePet: true, x: -1, y: -1 });
  const hatched = life.create('fox', 0);
  hatched.stage = 'hatched';
  hatched.hatchedAt = 0;
  hatched.hunger = 20;
  hatched.happiness = 20;
  page.sandbox.dragonbornXP.petState({ state: life.serialize(hatched) });
  page.sandbox.dragonbornXP.petFed({ name: 'Süßbrötchen' });
  assert.equal(card(page), 'Ember hat gut gegessen | Mmm, Süßbrötchen!');
  page.sandbox.dragonbornXP.petAction({ action: 'play' });
  assert.equal(card(page), 'Ember spielt so gern! | Die Freude steigt.');
  const english = freshPage({ raisePet: true });
  english.sandbox.dragonbornXP.petState({ state: life.serialize(hatched) });
  english.sandbox.dragonbornXP.petFed({ name: 'Sweet Roll', source: 'ate' });
  assert.equal(card(english), 'Ember ate with you | Mmm, Sweet Roll!');
});

test('the card starts on the companion name, with no English line waiting in the markup', () => {
  const html = fs.readFileSync(path.join(VIEW_DIR, 'index.html'), 'utf8');
  assert.match(html, /<p id="title"><\/p>/);
  assert.match(html, /<p id="detail"><\/p>/);
  const page = loadPage();
  page.sandbox.dragonbornXP.initialize({ language: 'fr', x: -1, y: -1, pet: 'fox' });
  assert.equal(card(page), 'Ember | ');
});

test('a skill gain without a skill name still reads in the chosen language', () => {
  const page = freshPage({ language: 'de' });
  page.sandbox.dragonbornXP.skillGain({});
  assert.equal(card(page), 'EP erhalten | Fertigkeit wird stärker.');
});

test('with no egg yet the card title is in the chosen language', () => {
  const page = loadPage();
  page.sandbox.dragonbornXP.initialize({ language: 'es', raisePet: true, x: -1, y: -1 });
  assert.equal(page.element('#title').textContent, 'Aún no hay huevo');
});

test('the English fallback in app.js matches the catalogue for every entry app.js uses', () => {
  const i18n = require('../view/i18n.js');
  i18n.setLanguage('en');
  const source = fs.readFileSync(path.join(VIEW_DIR, 'app.js'), 'utf8').replace(/\r\n/g, '\n');
  const start = source.indexOf('    const english = {');
  const end = source.indexOf('\n    };\n', start);
  const english = vm.runInNewContext(`(${source.slice(start + '    const english = '.length, end + 6)})`);
  const rest = source.slice(0, start) + source.slice(end);
  // keys passed to t() directly, through a t({ ... }[...]) table, or through hotkeyActions
  const keys = new Set([...rest.matchAll(/\bt\(\s*'(\w+)'/g)].map(m => m[1]).filter(Boolean));
  const tables = [...rest.matchAll(/\bt\(\s*\{([^}]*)\}/g), ...rest.matchAll(/hotkeyActions = \{([^}]*)\}/g)];
  for (const table of tables) for (const m of table[1].matchAll(/:\s*'(\w+)'/g)) keys.add(m[1]);
  assert.ok(keys.size > 50, `found ${keys.size} keys`);
  for (const key of keys) {
    const value = i18n.value(key);
    assert.equal(typeof value === 'string' && value !== key, true, `${key} is in the catalogue`);
    assert.equal(english[key], value, `fallback for ${key}`);
  }
  for (const [key, value] of Object.entries(english)) assert.equal(value, i18n.value(key), `fallback ${key} matches i18n.js`);
});
