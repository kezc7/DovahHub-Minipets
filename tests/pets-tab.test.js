const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The MiniPets tab for DovahHub, run against a small fake DOM and a fake window.dovahhubModule.
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
  assert.equal(tab.text('num-food'), '50');
  assert.equal(tab.text('num-happiness'), '70');
  assert.ok(tab.slot('picker').children.every(button => !button.disabled), 'the picker stays live while raising');
  // while raising the grid waits behind a button, and the line under it says what a click does
  assert.equal(tab.slot('picker').hidden, true);
  assert.equal(tab.slot('picker-toggle').hidden, false);
  assert.equal(tab.text('picker-toggle'), 'Change HUD companion (Ember)');
  assert.equal(tab.text('picker-current'), 'On your HUD when raise-a-pet is off: Ember the Fox');
  tab.slot('picker-toggle').click();
  assert.equal(tab.slot('picker').hidden, false);
  assert.equal(tab.text('picker-toggle'), 'Hide companions');
});

test('empty bars read as 0 and are marked low', async () => {
  const tab = loadTab();
  const starving = Object.assign({}, hatchedPet, { hunger: 0, happiness: 3 });
  tab.setAnswer(() => Object.assign({}, baseState, { raisePet: true, pet: starving, hours: 200 }));
  tab.event('tabShown');
  await tab.tick();
  assert.equal(tab.text('stage'), 'Young, needs food and attention');
  assert.equal(tab.slot('bar-food').style.width, '0%');
  assert.equal(tab.text('num-food'), '0');
  assert.equal(tab.text('num-happiness'), '3');
  assert.ok(tab.slot('num-food').classList.contains('is-low'));
  assert.ok(tab.slot('pet').classList.contains('is-sad'));
});

test('while raising, a companion click sets the HUD companion and says so', async () => {
  const tab = loadTab();
  tab.setAnswer(request => (request === 'state' ? Object.assign({}, baseState, { raisePet: true, pet: hatchedPet }) : { ok: true }));
  tab.event('tabShown');
  await tab.tick();
  tab.slot('picker-toggle').click();
  tab.slot('picker').children.find(button => button.dataset.companion === 'mudcrab').click();
  await tab.tick();
  assert.equal(JSON.stringify(tab.calls[1]), JSON.stringify({ request: 'companion', payload: { pet: 'mudcrab' } }));
  assert.equal(tab.text('result'), 'Clack will sit on your HUD when raise-a-pet is off.');
  assert.equal(tab.text('picker-current'), 'On your HUD when raise-a-pet is off: Clack the Mudcrab');
  assert.equal(tab.slot('picker').children.find(button => button.dataset.companion === 'mudcrab').getAttribute('aria-pressed'), 'true');
  // the grid stays open until it is closed again, and the button then names the new choice
  assert.equal(tab.slot('picker').hidden, false);
  tab.slot('picker-toggle').click();
  assert.equal(tab.slot('picker').hidden, true);
  assert.equal(tab.text('picker-toggle'), 'Change HUD companion (Clack)');
});

test('with raise-a-pet off the grid is open and a click says the HUD changed', async () => {
  const tab = loadTab();
  tab.setAnswer(request => (request === 'state' ? baseState : { ok: true }));
  tab.event('tabShown');
  await tab.tick();
  assert.equal(tab.slot('picker').hidden, false);
  assert.equal(tab.slot('picker-toggle').hidden, true);
  assert.equal(tab.text('picker-current'), 'On your HUD: Ember the Fox');
  tab.slot('picker').children.find(button => button.dataset.companion === 'chicken').click();
  await tab.tick();
  assert.equal(tab.text('result'), 'Pip is on your HUD now.');
  assert.equal(tab.text('picker-current'), 'On your HUD: Pip the Chicken');
});

// the HUD card's layering: .pet-motion > .pet-body > .pet-sprite, with the archetype on the outside
function motionWrapper(node) {
  const motion = node.children.find(child => child.classList.contains('pet-motion'));
  const body = motion && motion.children.find(child => child.classList.contains('pet-body'));
  const sprite = body && body.children.find(child => child.classList.contains('pet-sprite'));
  return { motion, body, sprite };
}

test('the sprite and the thumbnails are wrapped for the idle animation, by archetype', async () => {
  const tab = loadTab();
  tab.setAnswer(() => Object.assign({}, baseState, { raisePet: true, pet: hatchedPet, hours: 210 }));
  tab.event('tabShown');
  await tab.tick();
  const sprites = require('../view/pet-sprites.js');
  const pet = tab.slot('pet');
  const wrapped = motionWrapper(pet);
  assert.ok(wrapped.sprite, 'pet-motion > pet-body > pet-sprite');
  assert.equal(wrapped.sprite, tab.slot('sprite'));
  assert.ok(pet.classList.contains('archetype-' + sprites.pets.fox.archetype));
  assert.ok([...wrapped.sprite.walk()].some(part => part.classList.contains('role-eyes')), 'the parts keep their role classes');
  // the growth scale sits on the sprite, not on the positioned wrapper
  assert.equal(wrapped.sprite.style.transform, 'scale(' + require('../view/pet-life.js').GROWTH_SCALE.young + ')');
  tab.slot('picker').children.forEach(button => {
    const thumb = button.children.find(child => child.classList.contains('pets-thumb'));
    assert.ok(motionWrapper(thumb).sprite, 'thumb ' + button.dataset.companion + ' is wrapped');
    assert.ok(thumb.classList.contains('archetype-' + sprites.pets[button.dataset.companion].archetype));
  });
  // an egg wobbles instead
  tab.push({ state: Object.assign({}, baseState, { raisePet: true, pet: eggPet }) });
  assert.ok(pet.classList.contains('archetype-egg'));
  assert.ok(!pet.classList.contains('archetype-light'));
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

test('the module ships the same pet-life.js, pet-sprites.js and pet-motion.css as the HUD page', () => {
  for (const file of ['pet-life.js', 'pet-sprites.js', 'pet-motion.css']) {
    assert.equal(fs.readFileSync(path.join(MODULE_DIR, file), 'utf8'), fs.readFileSync(path.join(VIEW_DIR, file), 'utf8'), `${file} matches view/`);
  }
});

test('the idle keyframes live in pet-motion.css only, and both pages use them', () => {
  const motion = fs.readFileSync(path.join(VIEW_DIR, 'pet-motion.css'), 'utf8');
  const hud = fs.readFileSync(path.join(VIEW_DIR, 'styles.css'), 'utf8');
  const tabCss = fs.readFileSync(path.join(MODULE_DIR, 'pets.css'), 'utf8');
  const defined = [...motion.matchAll(/@keyframes ([a-z-]+)/g)].map(match => match[1]);
  for (const name of ['pet-breathe', 'pet-float', 'pet-blink', 'pet-wag', 'pet-sway', 'pet-ear', 'pet-nod', 'pet-arm-rest', 'pet-wing-rest', 'pet-glow', 'pet-flare', 'egg-wobble', 'pet-droop']) {
    assert.ok(defined.includes(name), `${name} is in pet-motion.css`);
    assert.ok(!hud.includes(`@keyframes ${name} `), `${name} is not also in styles.css`);
    assert.ok(new RegExp(`animation(-name)?: ${name}[ ;]`).test(tabCss), `the tab animates with ${name}`);
  }
  const used = [...tabCss.matchAll(/animation: ([a-z-]+) /g)].map(match => match[1]);
  used.forEach(name => assert.ok(defined.includes(name), `${name} used by the tab is defined`));
  assert.match(fs.readFileSync(path.join(VIEW_DIR, 'index.html'), 'utf8'), /href="pet-motion\.css\?v=\d+"/);
});

test('the plugin\'s companion table matches pet-sprites.js', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.cpp'), 'utf8');
  const table = source.slice(source.indexOf('kCompanions{'), source.indexOf('} };', source.indexOf('kCompanions{')));
  const native = [...table.matchAll(/\{ "([a-z-]+)", "([A-Za-z]+)" \}/g)].map(match => ({ id: match[1], name: match[2] }));
  assert.deepEqual(native, companions);
});
