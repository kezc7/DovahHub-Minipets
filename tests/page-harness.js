// The HUD page in a sandbox with a stand-in DOM, enough to run app.js start to finish without a
// browser. Used by tests/save-leak.test.js.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const VIEW_DIR = path.join(__dirname, '..', 'view');
const PAGE_SCRIPTS = ['animation-state.js', 'pet-sprites.js', 'clock.js', 'pet-life.js', 'regions.js', 'sky.js', 'app.js'];

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

module.exports = { loadPage };
