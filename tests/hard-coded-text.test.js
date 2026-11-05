// Every word the HUD page shows comes from the catalogue (view/i18n.js), so a translated card
// never mixes in English. This scans the statements in app.js that put text on screen and fails
// on any string literal that reads as words.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = fs.readFileSync(path.join(__dirname, '..', 'view', 'app.js'), 'utf8').split(/\r?\n/);
// statements that write text the player reads
const SHOWS_TEXT = /textContent\s*=|petNotice\(|showToast\(|showCaption\(|new Option\(|hotkeyNames\s*=/;

// the statement starting at a line, up to the line that ends it
function statementAt(index) {
  const lines = [APP[index]];
  let at = index;
  while (!/[;{]\s*$/.test(APP[at]) && at + 1 < APP.length && lines.length < 12) lines.push(APP[++at]);
  return lines.join(' ');
}

// words in a literal: a phrase, or a capitalised word. Ids, selectors, classes, event names and
// the toast kinds are lower-case tokens and don't count.
function readsAsText(text) {
  const trimmed = text.trim();
  return /[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(trimmed) || /^[A-Z][a-z]+/.test(trimmed);
}

// quoted literals anywhere in the statement (inside template expressions too), plus the
// fixed parts of template literals
function literals(statement) {
  const stripped = statement.replace(/\bt\(\s*'[^']*'/g, 't(');
  const texts = [];
  for (const match of stripped.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) texts.push(match[1] ?? match[2]);
  for (const match of stripped.matchAll(/`((?:[^`\\]|\\.)*)`/g)) {
    texts.push(...match[1].split(/\$\{(?:[^{}]|\{[^{}]*\})*\}/));
  }
  return texts.filter(readsAsText).map(text => text.trim());
}

test('app.js puts no hard-coded English on screen', () => {
  const offenders = [];
  APP.forEach((line, index) => {
    if (line.trim().startsWith('//') || !SHOWS_TEXT.test(line)) return;
    for (const text of literals(statementAt(index))) offenders.push(`app.js:${index + 1}: "${text}"`);
  });
  assert.deepEqual(offenders, [], `hard-coded text:\n${offenders.join('\n')}`);
});
