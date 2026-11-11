// THEME (DHUB-70): the suite's look comes from DovahHub's kit, copied unchanged into view/theme/ and pinned
// here, so a copy that drifts fails the build. The companion settings wear the kit's gold; the DovahHub tab
// loads into DovahHub's page, where the kit's --dv-* tokens follow DovahHub's theme, so MiniPets' CSS uses
// the kit's classes and tokens only: it never sets a token and has no colours of its own (the pet's art aside).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
// DovahHub 61ddbbd, web/theme/dovah-theme.css (LF line endings)
const KIT_SHA256 = 'ad38a0c64e9c32eb7e128f921fc71a327e9db5a96ce2169daf47ba2f37717814';

test('the kit is DovahHub\'s, byte for byte, with its fonts and their licence', () => {
  const bytes = fs.readFileSync(path.join(ROOT, 'view', 'theme', 'dovah-theme.css'));
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), KIT_SHA256);
  for (const font of ['BarlowCondensed-Regular.ttf', 'BarlowCondensed-Medium.ttf', 'BarlowCondensed-SemiBold.ttf', 'OFL-BarlowCondensed.txt']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'view', 'theme', 'fonts', font)), font);
  }
  assert.match(read('.gitattributes'), /view\/theme\/dovah-theme\.css -text/, 'git keeps its bytes');
});

test('the HUD page links the kit before its own styles, with DovahHub\'s sizing', () => {
  const html = read('view/index.html');
  assert.match(html, /<html lang="en" class="dv-scale">/);
  const kit = html.indexOf('theme/dovah-theme.css');
  assert.ok(kit > 0 && kit < html.indexOf('href="styles.css'), 'kit first');
});

test('the companion settings use the kit\'s parts, and the old look is gone', () => {
  const html = read('view/index.html');
  const settings = html.slice(html.indexOf('<section id="settings-menu"'), html.indexOf('<section id="animation-lab"'));
  for (const part of ['dv-panel', 'dv-heading', 'dv-kicker', 'dv-setting-row', 'dv-toggle', 'dv-select', 'dv-slider', 'dv-stat', 'dv-button', 'dv-button--primary', 'dv-prompts', 'dv-keycap']) {
    assert.ok(settings.includes(part), part);
  }
  assert.doesNotMatch(settings, /settings-secondary|settings-primary/);
  const css = read('view/styles.css');
  assert.doesNotMatch(css, /\.settings-secondary|\.settings-primary|\.settings-toggle \{/);
});

// a token with an alpha, rgba(var(--dv-accent-rgb), .2), is the kit's own way and follows the theme
function colourLines(css) {
  return css.replace(/\r\n/g, '\n').split('\n').filter(line => /#[0-9a-fA-F]{3,8}\b|rgba?\((?!var\()/.test(line));
}

test('no --dv-* token is set in MiniPets\' CSS: DovahHub\'s theme sets them', () => {
  for (const file of ['view/styles.css', 'hub/modules/pets/pets.css']) {
    assert.doesNotMatch(read(file), /--dv-[a-z-]+\s*:/, file);
  }
});

test('the DovahHub tab has no colours of its own outside the pet\'s scene', () => {
  const stray = colourLines(read('hub/modules/pets/pets.css')).filter(line => !/^\.pets-scene/.test(line.trim()));
  assert.deepEqual(stray, []);
  const html = read('hub/modules/pets/index.html');
  for (const part of ['dv-kicker', 'dv-heading', 'dv-stat', 'dv-button']) assert.ok(html.includes(part), part);
  assert.doesNotMatch(html, /hearth-proof-button|hearth-detail-kicker/);
});

test('the settings\' own rules use the kit\'s tokens, not colours', () => {
  const css = read('view/styles.css');
  const block = css.slice(css.indexOf('/* Companion settings (Shift+B)'), css.indexOf('@media (max-width: 800px)'));
  assert.ok(block.length > 500);
  assert.deepEqual(colourLines(block), []);
});
