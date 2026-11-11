#!/usr/bin/env node
// Translation coverage for MiniPets. Checks every language in view/i18n.js against English, and
// every file that puts text in front of the player for words that skip the catalogue.
//
//   node tools/i18n-coverage.js            counts per language, then the hard-coded text
//   node tools/i18n-coverage.js --details  every finding
//
// tests/translation-coverage.test.js runs the same audit and fails on any finding.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// The catalogue's raw tables, read the way the page reads i18n.js.
function loadCatalogue() {
  const source = read('view/i18n.js').replace('return Object.freeze({', 'globalThis.__tables = { ui, baseSpecies };\n  return Object.freeze({');
  const sandbox = { module: { exports: {} } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'i18n.js' });
  return { ui: sandbox.__tables.ui, baseSpecies: sandbox.__tables.baseSpecies || {}, api: sandbox.module.exports };
}

// "captions.fox.moving.0" style keys for every string in a language table
function flatten(table, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(table || {})) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) value.forEach((item, index) => { out[`${name}.${index}`] = item; });
    else if (value && typeof value === 'object') flatten(value, name, out);
    else out[name] = value;
  }
  return out;
}

// Names and terms that are the same in every language: the companions' names, Skyrim's day
// names (kept as the game's own, by decision), product names and key names.
const NAMES = [
  'Dovahmin', 'Dovahpink', 'Clack', 'Nibbles', 'Ember', 'Stripes', 'Webber', 'Waddles', 'Grumble', 'Cinder', 'Shiver',
  'Moss', 'Tinker', 'Skitter', 'Bloop', 'Tusker', 'Masky', 'Glowbug', 'Gnasher', 'Pip',
  'Sundas', 'Morndas', 'Tirdas', 'Middas', 'Turdas', 'Fredas', 'Loredas',
  'MiniPets', 'DovahHub', 'DragonbornXP', 'Skyrim', 'SKSE', 'Plugins', 'PrismaUI', 'views', 'dll', 'Data',
  'HUD', 'XP', 'Shift', 'Shift+', 'Enter', 'Tab', 'Esc', 'F1', 'F12', 'Dwemer', 'MINIPETS',
  // the suite's other mods, named in the reaction settings (1.9.0)
  'DovahDamage', 'Chronicle',
  // each language's own name, shown in that language in the picker
  'English', 'Français', 'Deutsch', 'Italiano', 'Español', 'Polski', 'Türkçe'
];

// Entries allowed to read the same as English, and why.
const SAME_AS_ENGLISH = {
  '*': {
    htmlLang: 'a language code, checked separately',
    settingsKicker: 'the mod name',
    'weekdays.*': 'Skyrim day names stay as the game spells them',
  },
  fr: { position: 'French word', combat: 'French word', 'species.troll': 'official French name', 'species.spriggan': 'official French name', 'species.chaurus': 'official French name', 'species.netch': 'official French name', skyrim: 'name' },
  de: { position: 'German word', ateDetail: 'a sound, then the food', tabStageBaby: 'German word', factGrowsIn: 'German word, then the time', skyrim: 'name', 'species.skeever': 'official German name', 'species.horker': 'official German name', 'species.troll': 'official German name', 'species.spriggan': 'official German name', 'species.chaurus': 'official German name', 'species.netch': 'official German name' },
  it: { reactFallen: 'Oh no… is Italian too', skyrim: 'name', 'species.skeever': 'official Italian name', 'species.troll': 'official Italian name', 'species.spriggan': 'official Italian name', 'species.chaurus': 'official Italian name', 'species.netch': 'official Italian name', 'species.horker': 'official Italian name' },
  es: { skyrim: 'name', 'species.skeever': 'official Spanish name', 'species.horker': 'creature name kept in Spanish', 'species.troll': 'official Spanish name', 'species.spriggan': 'official Spanish name', 'species.chaurus': 'official Spanish name', 'species.netch': 'official Spanish name' },
  pl: { skyrim: 'name', 'species.troll': 'official Polish name', 'species.skeever': 'official Polish name', 'species.horker': 'official Polish name', 'species.spriggan': 'official Polish name', 'species.chaurus': 'official Polish name', 'species.netch': 'official Polish name' },
  tr: { skyrim: 'name', ateDetail: 'a sound, then the food', 'species.skeever': 'creature name, no official Turkish release', 'species.horker': 'creature name', 'species.spriggan': 'creature name', 'species.chaurus': 'creature name', 'species.netch': 'creature name' },
};

// English words that are also ordinary words in a language, so finding them is not a leftover.
const SHARED_WORDS = {
  // the creature names Skyrim keeps in every language, and the atronachs' official name
  '*': ['skeever', 'horker', 'troll', 'spriggan', 'chaurus', 'netch', 'atronach', 'mmm'],
  // "pixel art" is the usual term in French, Italian and Spanish
  // and the reaction lines' loanwords: mods, chat, boss, look, the French and German fanfare
  fr: ['menu', 'dragon', 'position', 'combat', 'date', 'style', 'corrections', 'gain', 'sabre', 'change', 'file', 'pixel', 'art', 'mods', 'moment', 'moments', 'chat', 'minute', 'attention', 'fanfare'],
  de: ['position', 'optional', 'warm', 'baby', 'in', 'frost', 'mods', 'moment', 'chat', 'minute', 'boss', 'look', 'fanfare'],
  it: ['file', 'menu', 'pixel', 'art', 'chat', 'boss', 'look'],
  es: ['pixel', 'art', 'mods', 'chat', 'look'], pl: ['menu', 'boss'], tr: [], 'zh-CN': [], ja: [], ko: [],
};

function matchesRule(rules, key) {
  return Object.keys(rules).some(rule => rule === key || (rule.endsWith('.*') && key.startsWith(rule.slice(0, -1))));
}

function words(text) {
  return String(text).replace(/\{[a-zA-Z0-9_]+\}/g, ' ').match(/\p{L}[\p{L}’']*/gu) || [];
}

function placeholders(text) {
  return [...String(text).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map(m => m[1]).sort().join(',');
}

function auditCatalogue() {
  const { ui, baseSpecies } = loadCatalogue();
  const english = flatten(ui.en);
  // species read from baseSpecies when a language leaves them out, so they count as English entries
  for (const [id, name] of Object.entries(baseSpecies)) english[`species.${id}`] = name;
  const englishWords = new Set();
  for (const value of Object.values(english)) for (const word of words(value)) englishWords.add(word.toLowerCase());
  const names = new Set(NAMES.map(name => name.toLowerCase()));
  const languages = {};
  for (const id of Object.keys(ui)) {
    if (id === 'en') continue;
    const table = flatten(ui[id]);
    const same = Object.assign({}, SAME_AS_ENGLISH['*'], SAME_AS_ENGLISH[id] || {});
    const shared = new Set([...SHARED_WORDS['*'], ...(SHARED_WORDS[id] || [])].map(word => word.toLowerCase()));
    const result = { missing: [], sameAsEnglish: [], englishLeft: [], placeholders: [], extra: [] };
    for (const [key, value] of Object.entries(english)) {
      if (!(key in table)) { result.missing.push(key); continue; }
      const translated = table[key];
      const lettersOnly = String(value).replace(/\{[a-zA-Z0-9_]+\}/g, '').replace(/[^\p{L}]/gu, '');
      if (translated === value && lettersOnly && !matchesRule(same, key) && !names.has(String(value).toLowerCase())) result.sameAsEnglish.push(key);
      if (placeholders(translated) !== placeholders(value)) result.placeholders.push(`${key}: ${placeholders(value) || 'none'} → ${placeholders(translated) || 'none'}`);
      if (key === 'htmlLang' || matchesRule(same, key)) continue;
      const left = words(translated).filter(word => {
        const lower = word.toLowerCase();
        return englishWords.has(lower) && !names.has(lower) && !shared.has(lower) && lower.length > 2;
      });
      if (left.length && translated !== value) result.englishLeft.push(`${key}: ${left.join(' ')} — "${translated}"`);
    }
    for (const key of Object.keys(table)) if (!(key in english)) result.extra.push(key);
    if (ui[id].htmlLang !== id) result.placeholders.push(`htmlLang: ${ui[id].htmlLang} should be ${id}`);
    languages[id] = result;
  }
  return { languages, englishCount: Object.keys(english).length };
}

// ---- text that skips the catalogue -----------------------------------------------------------

// A literal reads as words: a phrase, or a capitalised word. Ids, selectors, classes, event names
// and key names don't count.
function readsAsText(text) {
  const trimmed = String(text).trim();
  if (!trimmed || /^(Shift\+)?[A-Z0-9]{1,3}$/.test(trimmed) || /^[a-z][\w-]*$/.test(trimmed)) return false;
  if (NAMES.includes(trimmed)) return false;
  // "Ember — Fox": a name and a species
  if (/^\p{L}+ — \p{L}/u.test(trimmed)) return true;
  return /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(trimmed) || /^[A-Z][a-z]+/.test(trimmed);
}

function stripComments(source) {
  return source.split(/\r?\n/).map(line => (/^\s*\/\//.test(line) ? '' : line.replace(/\s\/\/\s.*$/, ''))).join('\n');
}

// string literals in a statement, with t('key') calls and template expressions left out
function literals(code) {
  const stripped = code.replace(/\bt\(\s*'[^']*'/g, 't(').replace(/\bt\(\s*\{[^}]*\}/g, 't(');
  const texts = [];
  for (const match of stripped.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) texts.push(match[1] ?? match[2]);
  for (const match of stripped.matchAll(/`((?:[^`\\]|\\.)*)`/g)) texts.push(...match[1].split(/\$\{(?:[^{}]|\{[^{}]*\})*\}/));
  return texts;
}

// Lines in a page script that put text on screen. app.js and pets.js write text through these.
const SHOWS_TEXT = /textContent\s*=|innerText\s*=|petNotice\(|showToast\(|showCaption\(|new Option\(|setAttribute\(\s*'(?:aria-label|title|placeholder)'|\bfact\(|\bel\(\s*'[a-z0-9]+'\s*,\s*'[^']*'\s*,|\breturn\s+['`"]|\?\s*['`"][A-Z]|:\s*['`"][A-Z][a-z]+ [a-z]|\|\|\s*['`"][A-Z][a-z]+ [a-z]|petCheer\(|title:\s*`|detail:\s*['`"]|\?\s*'[a-z]+ [a-z]+'\s*:/;
// literals in these that are not text: log lines and ids
// the page's report to MiniPets.log (viewLog), read by people fixing a bug, not by players
const NOT_TEXT = [/^use strict$/, /^DovahHub: /, /^catalogue loaded$/, /^i18n.js missing, English fallback$/];

function auditScript(file) {
  // app.js's English-only fallback table holds the catalogue's English, kept equal to it by a test
  const source = stripComments(read(file)).replace(/\n    const english = \{[\s\S]*?\n    \};/, m => m.replace(/[^\n]/g, ' '));
  const lines = source.split('\n');
  const found = [];
  lines.forEach((line, index) => {
    if (!SHOWS_TEXT.test(line)) return;
    let statement = line;
    for (let at = index; !/[;{,]\s*$/.test(lines[at]) && at + 1 < lines.length && at - index < 8;) statement += ' ' + lines[++at];
    for (const text of literals(statement.replace(/\bcase\s+'[^']*'\s*:/g, 'case:'))) {
      if (readsAsText(text) && !NOT_TEXT.some(rule => rule.test(text.trim()))) found.push(`${file}:${index + 1}: "${text.trim()}"`);
    }
  });
  return [...new Set(found)];
}

// Text in markup outside a data-i18n element, and labels outside data-i18n-attr.
function auditHtml(file) {
  const source = read(file).replace(/<script[\s\S]*?<\/script>/gi, m => m.replace(/[^\n]/g, ' ')).replace(/<style[\s\S]*?<\/style>/gi, m => m.replace(/[^\n]/g, ' ')).replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
  const found = [];
  const lineOf = offset => source.slice(0, offset).split('\n').length;
  for (const match of source.matchAll(/<([a-z0-9-]+)([^>]*)>([^<]*)/gi)) {
    const [, , attributes, text] = match;
    if (/^\/?(title)$/i.test(match[1])) continue;
    const covered = /\bdata-i18n="/.test(attributes);
    if (!covered && readsAsText(text.replace(/&nbsp;|&[a-z]+;/g, ' '))) found.push(`${file}:${lineOf(match.index)}: "${text.trim()}"`);
    const translatedAttributes = (attributes.match(/data-i18n-attr="([^"]*)"/) || [, ''])[1].split(',');
    for (const attr of attributes.matchAll(/\b(aria-label|title|placeholder|alt)="([^"]*)"/g)) {
      if (!translatedAttributes.includes(attr[1]) && readsAsText(attr[2])) found.push(`${file}:${lineOf(match.index)}: ${attr[1]}="${attr[2]}"`);
    }
  }
  return found;
}

// English in the plugin: DovahHub settings labels and notes, and message boxes.
function auditCpp(file) {
  const lines = read(file).split(/\r?\n/);
  const found = [];
  lines.forEach((line, index) => {
    if (/^\s*\/\//.test(line)) return;
    for (const match of line.matchAll(/\\?"(label|note|text|title)\\?"\s*:\s*\\?"([^"\\]+)\\?"/g)) {
      if (match[1] === 'title' && NAMES.includes(match[2])) continue;
      if (readsAsText(match[2]) && !isLanguageName(match[2])) found.push(`${file}:${index + 1}: ${match[1]} "${match[2]}"`);
    }
    if (/MessageBoxW|^\s*L"/.test(line)) {
      for (const match of line.matchAll(/L"((?:[^"\\]|\\.)*)"/g)) if (readsAsText(match[1]) && !NAMES.includes(match[1])) found.push(`${file}:${index + 1}: "${match[1]}"`);
    }
  });
  return found;
}

function isLanguageName(text) {
  return NAMES.includes(text);
}

function auditBypass() {
  const files = [
    ['view/index.html', auditHtml], ['view/app.js', auditScript],
    ['hub/modules/pets/index.html', auditHtml], ['hub/modules/pets/pets.js', auditScript],
    // the plugin: its core and the five parts (DMP-12), each where it exists
    ...['main.cpp', 'CardBridge.cpp', 'ReactionWiring.cpp', 'SaveLoad.cpp', 'HubAndApi.cpp', 'SelfTestRunner.cpp'].map(file => [`src/${file}`, auditCpp]),
  ];
  const result = {};
  for (const [file, audit] of files) if (fs.existsSync(path.join(ROOT, file))) result[file] = audit(file);
  return result;
}

function audit() {
  return Object.assign(auditCatalogue(), { bypass: auditBypass() });
}

module.exports = { audit, auditCatalogue, auditBypass, loadCatalogue, flatten };

if (require.main === module) {
  const details = process.argv.includes('--details');
  const report = audit();
  console.log(`English entries: ${report.englishCount}`);
  console.log('language  missing  same-as-English  English-left  placeholders  extra');
  for (const [id, r] of Object.entries(report.languages)) {
    console.log(`${id.padEnd(8)}  ${String(r.missing.length).padStart(7)}  ${String(r.sameAsEnglish.length).padStart(15)}  ${String(r.englishLeft.length).padStart(12)}  ${String(r.placeholders.length).padStart(12)}  ${String(r.extra.length).padStart(5)}`);
    if (details) for (const kind of ['missing', 'sameAsEnglish', 'englishLeft', 'placeholders', 'extra']) for (const item of r[kind]) console.log(`    ${kind}: ${item}`);
  }
  console.log('\nhard-coded text (shown in English whatever the language):');
  for (const [file, items] of Object.entries(report.bypass)) {
    console.log(`  ${file}: ${items.length}`);
    if (details) for (const item of items) console.log(`    ${item}`);
  }
}
