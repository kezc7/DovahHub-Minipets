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
    const self = new Proxy(function () {}, {
      get(target, prop) {
        if (prop in store) return store[prop];
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
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.addEventListener = () => {};
  sandbox.getComputedStyle = () => element('computed');
  vm.createContext(sandbox);
  for (const file of PAGE_SCRIPTS) {
    if (skip.includes(file)) continue;
    vm.runInContext(fs.readFileSync(path.join(VIEW_DIR, file), 'utf8'), sandbox, { filename: file });
  }
  return { sandbox, element, errors };
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
