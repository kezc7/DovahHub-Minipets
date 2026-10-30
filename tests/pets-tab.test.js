const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The Pets tab for DovahHub, run against a small fake DOM and a fake window.dovahhubModule.
const MODULE_DIR = path.join(__dirname, '..', 'hub', 'modules', 'pets');
const VIEW_DIR = path.join(__dirname, '..', 'view');

class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...names) { names.forEach(name => this.set.add(name)); }
  remove(...names) { names.forEach(name => this.set.delete(name)); }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : Boolean(force);
    if (on) this.set.add(name); else this.set.delete(name);
    return on;
  }
  contains(name) { return this.set.has(name); }
}

class FakeElement {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.style = {};
    this.classList = new FakeClassList();
    this.listeners = {};
    this.disabled = false;
    this.hidden = false;
    this._text = '';
  }
  get className() { return [...this.classList.set].join(' '); }
  set className(value) { this.classList.set = new Set(String(value).split(/\s+/).filter(Boolean)); }
  get textContent() { return this.children.length ? this.children.map(child => child.textContent).join('') : this._text; }
  set textContent(value) { this.children = []; this._text = String(value); }
  get childElementCount() { return this.children.length; }
  append(...nodes) { nodes.forEach(node => { node.parentNode = this; this.children.push(node); }); }
  appendChild(node) { this.append(node); return node; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] === undefined ? null : this.attributes[name]; }
  addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); }
  click() { if (this.disabled) return; (this.listeners.click || []).forEach(fn => fn({ target: this })); }
  getContext() { return null; }
  *walk() { for (const child of this.children) { yield child; yield* child.walk(); } }
  querySelector(selector) {
    const match = /^\[data-pets="([^"]+)"\]$/.exec(selector);
    assert.ok(match, `fake DOM only knows [data-pets] selectors, got ${selector}`);
    for (const node of this.walk()) if (node.dataset.pets === match[1]) return node;
    return null;
  }
}

// index.html, enough of it: tags with class and data-pets attributes, nested
function parseHtml(doc, html) {
  const root = new FakeElement(doc, 'div');
  const stack = [root];
  const tokens = html.match(/<\/?[a-z0-9]+[^>]*>|[^<]+/gi) || [];
  tokens.forEach(token => {
    if (token[0] !== '<') {
      const text = token.replace(/&nbsp;/g, ' ').trim();
      if (text) stack[stack.length - 1]._text += text;
      return;
    }
    if (token[1] === '/') { stack.pop(); return; }
    const tag = /^<([a-z0-9]+)/i.exec(token)[1];
    const element = new FakeElement(doc, tag);
    for (const attr of token.matchAll(/([a-z-]+)="([^"]*)"/gi)) {
      if (attr[1] === 'class') element.className = attr[2];
      else if (attr[1].startsWith('data-')) element.dataset[attr[1].slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = attr[2];
      else element.setAttribute(attr[1], attr[2]);
    }
    stack[stack.length - 1].append(element);
    if (!/\/>$/.test(token) && !['br', 'img'].includes(tag)) stack.push(element);
  });
  return root;
}

function loadTab() {
  const doc = { createElement: tag => new FakeElement(doc, tag) };
  const root = parseHtml(doc, fs.readFileSync(path.join(MODULE_DIR, 'index.html'), 'utf8'));
  const calls = [];
  let pushHandler = null;
  let eventHandler = null;
  let answer = () => ({ error: 'no reply' });
  const mod = {
    root,
    call(request, payload) { calls.push({ request, payload }); return Promise.resolve(answer(request, payload)); },
    onPush(fn) { pushHandler = fn; },
    onEvent(fn) { eventHandler = fn; }
  };
  const sandbox = { console, setTimeout, clearTimeout, JSON, Math, Number, Array, Object, Boolean, String };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.dovahhubModule = id => (id === 'pets' ? mod : null);
  vm.createContext(sandbox);
  // the same order DovahHub loads them in
  for (const file of ['pet-life.js', 'pet-sprites.js', 'pets.js']) {
    vm.runInContext(fs.readFileSync(path.join(MODULE_DIR, file), 'utf8'), sandbox, { filename: file });
  }
  const text = name => root.querySelector(`[data-pets="${name}"]`).textContent;
  const tick = () => new Promise(resolve => setImmediate(resolve));
  return {
    root, calls, text, tick,
    setAnswer(fn) { answer = fn; },
    push(json) { pushHandler(json); },
    event(name) { eventHandler(name); },
    slot: name => root.querySelector(`[data-pets="${name}"]`)
  };
}

const companions = Object.entries(require('../view/pet-sprites.js').names).map(([id, name]) => ({ id, name }));
const hotkeys = { settings: 'Shift+B', feed: 'Shift+N', play: 'Shift+K', hide: 'Shift+V' };
const baseState = { companion: 'fox', companions, raisePet: false, pet: null, hours: 200, food: 3,
  card: { x: -1, y: -1, scale: 100, shape: 'square', hidden: false }, clock: { enabled: false, style: 'plate' }, hotkeys };
const hatchedPet = { species: 'fox', stage: 'hatched', laidAt: 100, warmth: 12, hatchedAt: 110, hunger: 80, happiness: 90, lastTick: 200, lastPlay: null };
const eggPet = { species: 'mudcrab', stage: 'egg', laidAt: 190, warmth: 6, hatchedAt: null, hunger: 100, happiness: 80, lastTick: 200, lastPlay: null };

test('tabShown asks for the state and shows the companion when raise-a-pet is off', async () => {
  const tab = loadTab();
  tab.setAnswer(() => baseState);
  tab.event('tabShown');
  await tab.tick();
  assert.deepEqual(tab.calls.map(call => call.request), ['state']);
  assert.equal(tab.text('name'), 'Ember the Fox');
  assert.ok(tab.slot('sprite').childElementCount > 0, 'a sprite is drawn');
  assert.equal(tab.slot('needs').hidden, true);
  assert.equal(tab.slot('feed').disabled, true);
  assert.equal(tab.slot('play').disabled, true);
  const buttons = tab.slot('picker').children;
  assert.equal(buttons.length, 20);
  assert.equal(buttons.find(button => button.dataset.companion === 'fox').getAttribute('aria-pressed'), 'true');
  assert.ok(buttons.every(button => !button.disabled), 'the picker is live');
});

test('a hatched pet shows its stage, mood and bars, ticked for display', async () => {
  const tab = loadTab();
  // 10 hours since the last tick: hunger 80 -> 50, happiness 90 -> 70
  tab.setAnswer(() => Object.assign({}, baseState, { raisePet: true, pet: hatchedPet, hours: 210 }));
  tab.event('tabShown');
  await tab.tick();
  assert.equal(tab.text('name'), 'Ember the Fox');
  assert.equal(tab.text('stage'), 'Young, doing fine');
  assert.equal(tab.slot('bar-food').style.width, '50%');
  assert.equal(tab.slot('bar-happiness').style.width, '70%');
  assert.equal(tab.slot('need-warmth').hidden, true);
  assert.equal(tab.slot('feed').disabled, false);
  assert.equal(tab.text('feed'), 'Feed');
  assert.equal(tab.text('play'), 'Play');
  assert.ok(tab.text('facts').includes('4 days ago'), 'hatched 100 hours ago');
  assert.ok(tab.text('facts').includes('Food in pack3'));
  assert.ok(tab.slot('picker').children.every(button => button.disabled), 'the picker is off while raising');
});

test('an egg shows warmth and offers a cuddle', async () => {
  const tab = loadTab();
  tab.setAnswer(() => Object.assign({}, baseState, { raisePet: true, pet: eggPet }));
  tab.event('tabShown');
  await tab.tick();
  assert.equal(tab.text('name'), 'Clack’s egg');
  assert.equal(tab.text('stage'), 'Egg, 50% warm');
  assert.equal(tab.slot('need-warmth').hidden, false);
  assert.equal(tab.slot('bar-warmth').style.width, '50%');
  assert.equal(tab.slot('feed').disabled, true);
  assert.equal(tab.text('play'), 'Cuddle');
});

test('Feed and Play send their calls and show the pushed result', async () => {
  const tab = loadTab();
  tab.setAnswer(request => (request === 'state' ? Object.assign({}, baseState, { raisePet: true, pet: hatchedPet }) : { queued: true }));
  tab.event('tabShown');
  await tab.tick();
  tab.slot('feed').click();
  tab.slot('play').click();
  await tab.tick();
  assert.deepEqual(tab.calls.map(call => call.request), ['state', 'feed', 'play']);
  tab.push({ result: { action: 'feed', ok: true, food: 'Sweet Roll' } });
  assert.equal(tab.text('result'), 'Ember ate well. Mmm, Sweet Roll!');
  tab.push(JSON.stringify({ result: { action: 'play', ok: false, reason: 'tired' } }));
  assert.equal(tab.text('result'), 'Ember is tired. Let them rest for a bit.');
});

test('an immediate refusal shows without waiting for a push', async () => {
  const tab = loadTab();
  tab.setAnswer(request => (request === 'state' ? Object.assign({}, baseState, { raisePet: true, pet: hatchedPet, food: 0 }) : { ok: false, reason: 'no food' }));
  tab.event('tabShown');
  await tab.tick();
  tab.slot('feed').click();
  await tab.tick();
  assert.equal(tab.text('result'), 'No food in your pack. Pick up something to eat first.');
});

test('a pushed state re-renders, and the picker sends the companion', async () => {
  const tab = loadTab();
  tab.setAnswer(() => baseState);
  tab.event('tabShown');
  await tab.tick();
  tab.slot('picker').children.find(button => button.dataset.companion === 'chicken').click();
  await tab.tick();
  // objects made inside the vm have another realm's prototypes, so compare the text
  assert.equal(JSON.stringify(tab.calls[1]), JSON.stringify({ request: 'companion', payload: { pet: 'chicken' } }));
  tab.push({ state: Object.assign({}, baseState, { companion: 'chicken' }) });
  assert.equal(tab.text('name'), 'Pip the Chicken');
  assert.equal(tab.slot('picker').children.find(button => button.dataset.companion === 'chicken').getAttribute('aria-pressed'), 'true');
});

test('the module ships the same pet-life.js and pet-sprites.js as the HUD page', () => {
  for (const file of ['pet-life.js', 'pet-sprites.js']) {
    assert.equal(fs.readFileSync(path.join(MODULE_DIR, file), 'utf8'), fs.readFileSync(path.join(VIEW_DIR, file), 'utf8'), `${file} matches view/`);
  }
});

test('the plugin\'s companion table matches pet-sprites.js', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cpp'), 'utf8');
  const table = source.slice(source.indexOf('kCompanions{'), source.indexOf('} };', source.indexOf('kCompanions{')));
  const native = [...table.matchAll(/\{ "([a-z-]+)", "([A-Za-z]+)" \}/g)].map(match => ({ id: match[1], name: match[2] }));
  assert.deepEqual(native, companions);
});
