const test = require('node:test');
const assert = require('node:assert/strict');
const i18n = require('../view/i18n.js');

const expectedLanguages = ['en', 'fr', 'de', 'it', 'es', 'pl', 'tr', 'zh-CN', 'ja', 'ko'];
const requiredKeys = ['settingsTitle', 'language', 'machineTranslationNote', 'save', 'clock', 'showClock', 'hotkeys', 'animationTitle'];

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

test('the settings page shows the machine translation note under Language', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'view', 'index.html'), 'utf8');
  assert.match(html, /data-i18n="machineTranslationNote"/);
  i18n.setLanguage('en');
  assert.equal(i18n.t('machineTranslationNote'), 'Translations other than English are machine translations; corrections welcome.');
});

test('no shipped text uses the old name Dragonborn XP', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dirs = [path.join(__dirname, '..', 'view'), path.join(__dirname, '..', 'hub', 'modules', 'pets')];
  const hits = [];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(dir)) {
      if (!/\.(js|html|css|json)$/.test(name)) continue;
      // the bridge names (dragonbornXP.*) and element ids stay; the words a player reads don't
      fs.readFileSync(path.join(dir, name), 'utf8').split(/\r?\n/).forEach((line, index) => {
        if (/dragonborn\s+xp/i.test(line)) hits.push(`${name}:${index + 1}`);
      });
    }
  }
  assert.deepEqual(hits, []);
  for (const language of i18n.languages) {
    i18n.setLanguage(language);
    assert.equal(i18n.t('settingsKicker'), 'MINIPETS', `${language} heading`);
  }
  i18n.setLanguage('en');
});
