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
  assert.equal(i18n.formatDate({ weekday: 'Morndas', day: 17, month: 'Last Seed' }), 'Morndas 17 Vifazur');
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

// DMP-9: Kev's French clock read "Morndas 1 Heartfire". The game's English month is "Heartfire",
// which the catalogue spelled "Hearthfire", and a game in another language sends its own names; the
// plugin now sends the month and weekday by number too.
test('the clock words the month in the chosen language, by number and by the game\'s English name', () => {
  i18n.setLanguage('fr');
  assert.equal(i18n.formatDate({ weekday: 'Morndas', weekdayIndex: 1, day: 1, month: 'Heartfire', monthIndex: 8 }), 'Morndas 1 Atrefeu');
  assert.equal(i18n.formatDate({ weekday: 'Morndas', day: 1, month: 'Heartfire' }), 'Morndas 1 Atrefeu');
  assert.equal(i18n.formatDate({ weekday: 'Morndas', day: 1, month: 'Hearthfire' }), 'Morndas 1 Atrefeu');
  assert.equal(i18n.formatDate({ weekday: 'Morndas', day: 3, month: 'Mid Year' }), 'Morndas 3 Mi-l’An');
  // a German game sends German names; the numbers still give French
  assert.equal(i18n.formatDate({ weekday: 'Morndas', weekdayIndex: 1, day: 1, month: 'Herzfeuer', monthIndex: 8 }), 'Morndas 1 Atrefeu');
  i18n.setLanguage('ja');
  assert.equal(i18n.formatDate({ weekday: 'Morndas', weekdayIndex: 1, day: 1, month: 'Heartfire', monthIndex: 8 }), '薪木の月1日（月）');
  i18n.setLanguage('zh-CN');
  assert.equal(i18n.formatDate({ weekday: 'Sundas', weekdayIndex: 0, day: 2, month: 'Last Seed', monthIndex: 7 }), '末种月2日 周日');
  i18n.setLanguage('en');
  assert.equal(i18n.formatDate({ weekday: 'Morndas', weekdayIndex: 1, day: 1, month: 'Heartfire', monthIndex: 8 }), 'Morndas, 1st of Heartfire');
});

test('every language names all twelve months and seven days', () => {
  for (const language of expectedLanguages) {
    i18n.setLanguage(language);
    for (let month = 0; month < 12; month++) {
      const text = i18n.formatDate({ day: 1, monthIndex: month, month: 'x' });
      assert.doesNotMatch(text, /\bx\b|undefined/, `${language} month ${month}: ${text}`);
    }
    for (let day = 0; day < 7; day++) assert.doesNotMatch(i18n.formatDate({ day: 1, weekdayIndex: day, weekday: 'x' }), /\bx\b|undefined/, `${language} day ${day}`);
  }
  i18n.setLanguage('en');
});

test('the plugin sends the month and weekday by number', () => {
  const source = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'main.cpp'), 'utf8');
  assert.match(source, /"weekdayIndex\\":" \+ std::to_string\(calendar->GetDayOfWeek\(\)\)/);
  assert.match(source, /"monthIndex\\":" \+ std::to_string\(month\)/);
});

// DMP-9: French egg buttons ("Nourrir (après l'éclosion)", "Câliner (Shift+K)") wrapped onto two
// cramped lines; the buttons now keep one line each and wrap as whole buttons
test('long button labels wrap as whole buttons, and the clock plate wraps a long date', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const css = fs.readFileSync(path.join(__dirname, '..', 'view', 'styles.css'), 'utf8');
  assert.match(css, /\.pet-life-actions \{[^}]*flex-wrap: wrap/);
  assert.match(css, /\.pet-life-actions button \{[^}]*white-space: nowrap/);
  assert.match(css, /\.clock-plate \.clock-date \{[^}]*white-space: normal/);
  const tab = fs.readFileSync(path.join(__dirname, '..', 'hub', 'modules', 'pets', 'pets.css'), 'utf8');
  assert.match(tab, /\.pets-actions \{[^}]*flex-wrap: wrap/);
  assert.match(tab, /\.pets-actions \.hearth-proof-button \{[^}]*white-space: nowrap/);
});
