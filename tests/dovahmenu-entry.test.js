// DMP-14 (DovahMenu's DMN-31 suite rule): MiniPets registers an entry with DovahMenu, so picking MiniPets in
// DovahMenu opens its settings directly instead of DovahMenu pressing Shift+B. The callback runs as DovahMenu
// closes, when a closing menu may still hide the overlay for a few frames: the request waits up to 2 s.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pluginPart, pluginFile } = require('./plugin-source.js');

const SRC = path.join(__dirname, '..', 'src');

test('DovahMenu_API.h is DovahMenu 8f585b8\'s, unchanged', () => {
  const text = fs.readFileSync(path.join(SRC, 'DovahMenu_API.h'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(crypto.createHash('sha256').update(text).digest('hex'), 'ebc1a6b849421eb4ef43df6ff15d71142d20377bdb947ec34061f3b2555db200');
  assert.match(text, /The Dovah suite rule \(DMN-31\)/);
});

test('MiniPets registers with the id DovahMenu\'s scan finds, its name and its key, and keeps the key current', () => {
  const hub = pluginPart('Hub');
  assert.match(pluginFile('HubAndApi.cpp'), /#include "DovahMenu_API\.h"/);
  assert.match(hub, /desc\.id = "MiniPets";/, 'the PrismaUI view folder, so it replaces the scanned entry');
  assert.match(hub, /desc\.hotkey = g_settings\.settingsHotkeyName\.c_str\(\);/);
  assert.match(hub, /desc\.onOpen = &OpenFromDovahMenu;/);
  assert.match(hub, /void OpenFromDovahMenu\(void\*\)[^{]*\{\s*Card::OpenSettingsFromDovahMenu\(\);/);
  assert.match(hub, /DovahMenu not found, no DovahMenu entry/, 'MiniPets works without DovahMenu');
  assert.match(hub, /g_menu->SetHotkey\(g_menuEntry, g_settings\.settingsHotkeyName\.c_str\(\)\)/);
  assert.match(pluginPart('Card'), /g_settingsHotkeyRequiresShift\.store\(requiresShift\);\s*Hub::UpdateDovahMenuHotkey\(\);/, 'a rebound key is passed on');
  // registered only once there is a view to open
  assert.match(pluginFile('main.cpp'), /if \(!Card::CreateView\(\)\) \{\s*return;\s*\}\s*\/\/[^\n]*\n\s*Hub::RegisterWithDovahMenu\(\);/);
  // the scanned entry's file stays, for its name and key
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'view', 'dovahmenu.json'), 'utf8'));
  assert.equal(manifest.name, 'MiniPets');
});

test('opened from DovahMenu: now, or once a closing menu has gone, within 2 s', () => {
  const card = pluginPart('Card');
  assert.match(card, /void OpenSettingsFromDovahMenu\(\)\s*\{\s*if \(!g_overlayHiddenForMenus\.load\(\)\) \{[\s\S]{0,120}OpenSettings\(\);\s*return;\s*\}\s*g_openSettingsWhenShownUntil\.store\(SteadyMs\(\) \+ kDovahMenuWaitMs\);/);
  assert.match(card, /constexpr std::int64_t kDovahMenuWaitMs = 2000;/);
  const update = card.slice(card.indexOf('void UpdateOverlayMenuVisibility()'), card.indexOf('void OpenSettingsFromDovahMenu()'));
  // after the view is shown again, the waiting request is taken once: opened in time, or dropped and logged
  assert.ok(update.indexOf('g_prismaUI->Show(g_view);') < update.indexOf('g_openSettingsWhenShownUntil.exchange(0)'));
  assert.match(update, /if \(changed && !shouldHide\) \{\s*if \(const auto until = g_openSettingsWhenShownUntil\.exchange\(0\); until != 0\) \{\s*if \(SteadyMs\(\) <= until\) \{[\s\S]{0,140}OpenSettings\(\);/);
  assert.match(update, /were dropped: the overlay stayed hidden over 2 s/);
});

test('MiniPets\' own settings key is unchanged', () => {
  const card = pluginPart('Card');
  assert.match(card, /if \(scanCode == g_settingsHotkey\.load\(\) && shiftDown == g_settingsHotkeyRequiresShift\.load\(\)\) \{[\s\S]{0,160}OpenSettings\(\);/);
});
