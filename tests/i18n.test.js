const test = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../view/i18n.js');

const expectedLanguages = ['en', 'fr', 'de', 'it', 'es', 'pl', 'tr', 'zh-CN', 'ja', 'ko'];
const requiredKeys = ['settingsTitle', 'language', 'save', 'clock', 'showClock', 'hotkeys', 'animationTitle'];

test('supports every requested language', () => {
  assert.deepEqual(i18n.languages, expectedLanguages);
  for (const language of expectedLanguages) {
    i18n.setLanguage(language);
    requiredKeys.forEach(key => assert.notEqual(i18n.t(key), key, `${language} is missing ${key}`));
  }
});

test('localizes companion species and Skyrim dates', () => {
  i18n.setLanguage('fr');
  assert.equal(i18n.species('fox'), 'Renard');
  assert.equal(i18n.formatDate({ weekday: 'Morndas', day: 17, month: 'Last Seed' }), 'Morndas 17 Dernières Semences');
  i18n.setLanguage('en');
  assert.equal(i18n.formatDate({ weekday: 'Morndas', day: 17, month: 'Last Seed' }), 'Morndas, 17th of Last Seed');
});
