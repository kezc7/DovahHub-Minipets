// Translation coverage: every language has every entry, nothing reads as untranslated English,
// placeholders survive, and nothing the player sees skips the catalogue. tools/i18n-coverage.js
// prints the same audit with counts; run it with --details to see each finding.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { audit } = require('../tools/i18n-coverage.js');

const report = audit();

for (const [language, result] of Object.entries(report.languages)) {
  test(`${language}: every entry is translated`, () => {
    assert.deepEqual(result.missing, [], `${language} is missing:\n${result.missing.join('\n')}`);
    assert.deepEqual(result.sameAsEnglish, [], `${language} reads the same as English:\n${result.sameAsEnglish.join('\n')}`);
    assert.deepEqual(result.englishLeft, [], `${language} has English words left:\n${result.englishLeft.join('\n')}`);
    assert.deepEqual(result.placeholders, [], `${language} placeholders:\n${result.placeholders.join('\n')}`);
    assert.deepEqual(result.extra, [], `${language} has entries English lacks:\n${result.extra.join('\n')}`);
  });
}

test('all nine languages are audited', () => {
  assert.deepEqual(Object.keys(report.languages), ['fr', 'de', 'it', 'es', 'pl', 'tr', 'zh-CN', 'ja', 'ko']);
});

for (const [file, found] of Object.entries(report.bypass)) {
  test(`${file} shows no text outside the catalogue`, () => {
    assert.deepEqual(found, [], `hard-coded text:\n${found.join('\n')}`);
  });
}

test('the audit scans the HUD page, the DovahHub tab and the plugin', () => {
  assert.deepEqual(Object.keys(report.bypass), ['view/index.html', 'view/app.js', 'hub/modules/pets/index.html', 'hub/modules/pets/pets.js', 'src/main.cpp']);
});

test('src/HubText.h matches the catalogue', () => {
  const { render, HEADER } = require('../tools/gen-hub-text.js');
  const current = require('node:fs').readFileSync(HEADER, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(current, render(), 'run node tools/gen-hub-text.js');
  assert.doesNotThrow(() => execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'gen-hub-text.js'), '--check']));
});

test('src/HubText.h holds only ASCII, so the compiler code page cannot change it', () => {
  const bytes = require('node:fs').readFileSync(require('../tools/gen-hub-text.js').HEADER);
  assert.ok(bytes.every(byte => byte < 0x80), 'non-ASCII byte in HubText.h');
});

test('main.cpp builds DovahHub settings from HubText.h and sends them again when the language changes', () => {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'src', 'main.cpp'), 'utf8');
  assert.match(source, /#include "HubText.h"/);
  assert.match(source, /AddSettings\(g_hubModule, HubSettingsSchema\(\)\.c_str\(\)\)/);
  assert.doesNotMatch(source, /kHubSettingsSchema/);
  assert.match(source, /HubText::For\(g_settings\.language\)\.leftoverDll/);
  const apply = source.slice(source.indexOf('bool ApplyHubSetting('), source.indexOf('const char* OnHubRequest('));
  assert.match(apply, /RefreshHubSettings\(\);/);
});
