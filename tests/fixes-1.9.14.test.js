// 1.9.14 (DMP-34 to DMP-38, from the player's list of 22 Nov): the page's side run in the sandbox page, the
// plugin's side pinned in its source. Each test names its card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const life = require('../view/pet-life.js');
const { loadPage } = require('./page-harness.js');
const { pluginPart, pluginFile } = require('./plugin-source.js');

function page(settings = {}) {
  const p = loadPage();
  const saved = [];
  const sent = [];
  p.sandbox.petStateChanged = text => saved.push(text);
  p.sandbox.settingsChanged = text => sent.push(text);
  p.sandbox.dragonbornXP.applySettings(Object.assign({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'fox', raisePet: true }, settings));
  return { p, xp: p.sandbox.dragonbornXP, saved, sent };
}

function hatchedFox() {
  return Object.assign(life.create('fox', 0), { stage: 'hatched', hatchedAt: 0, lastTick: 100, hunger: 80, happiness: 80 });
}

function memories(saved) {
  const last = saved.at(-1);
  return last ? JSON.parse(last.slice(last.indexOf('|') + 1)).memories || [] : [];
}

// --- DMP-34 ---------------------------------------------------------------

test('DMP-34: a boss, a milestone and a first visit the gate turned down are still remembered, once each', () => {
  const { xp, saved } = page();
  xp.petState({ state: life.serialize(hatchedFox()), session: 1 });
  xp.clock({ hour: 10, minute: 0, hours: 100 });
  xp.remember({ source: 'dovahdamage', captionKey: 'reactBossDown', vars: { name: 'Alduin' } });
  xp.remember({ source: 'dovahhub', captionKey: 'reactMilestone', vars: { title: 'Wanderer II' } });
  xp.remember({ source: 'minipets', captionKey: 'placeCity', vars: { region: 'whiterun', place: 'Whiterun', memorable: true } });
  xp.remember({ source: 'dovahdamage', captionKey: 'reactBossDown', vars: { name: 'Alduin' } });
  const kept = memories(saved).map(m => `${m.k}:${m.id}`);
  assert.deepEqual(kept, ['boss:Alduin', 'milestone:Wanderer II', 'place:whiterun']);
});

test('DMP-34: nothing is kept from a self-test, an ordinary reaction, or an egg', () => {
  const { xp, saved } = page();
  xp.petState({ state: life.serialize(hatchedFox()), session: 1 });
  xp.clock({ hour: 10, minute: 0, hours: 100 });
  xp.remember({ source: 'minipets', captionKey: 'placeCity', vars: { region: 'whiterun', memorable: true, test: true } });
  xp.remember({ source: 'minipets', captionKey: 'reactSleep', vars: {} });
  assert.deepEqual(memories(saved), []);
  const egg = page();
  egg.xp.petState({ state: life.serialize(life.create('fox', 0)), session: 1 });
  egg.xp.clock({ hour: 0, minute: 0, hours: 0 });
  egg.xp.remember({ source: 'dovahdamage', captionKey: 'reactBossDown', vars: { name: 'Alduin' } });
  assert.ok(!egg.saved.some(text => text.includes('Alduin')));
});

test('DMP-34: the plugin sends every turned-down reaction to be remembered, never a self-test\'s', () => {
  const wiring = pluginPart('ReactionWiring');
  const offer = wiring.slice(wiring.indexOf('Reactions::Verdict OfferReaction('), wiring.indexOf('// one Chronicle line a minute'));
  assert.match(offer, /if \(SelfTestRunner::Running\(\)\) \{\s*return verdict;\s*\}/);
  assert.ok(offer.indexOf('SelfTestRunner::Running()') < offer.indexOf('SendRemember(reaction);'), 'the self-test check comes first');
  assert.match(offer, /SendRemember\(reaction\);\s*return verdict;\s*\}/);
  assert.match(wiring, /Card::Invoke\("dragonbornXP\.remember", "\{\\"source\\":" \+ JsonString\(reaction\.source\) \+ ",\\"captionKey\\":"/);
  assert.match(pluginFile('SelfTestRunner.cpp'), /bool Running\(\)\s*\{\s*return g_selfTestRunning\.load\(\);/);
});

// --- DMP-35 ---------------------------------------------------------------

test('DMP-35: a reaction turned down while the card is hidden for a menu waits for it', () => {
  const wiring = pluginPart('ReactionWiring');
  assert.match(wiring, /constexpr double kGraceMs = 5\.0 \* 1000\.0;/);
  assert.match(wiring, /constexpr double kOutfitGraceMs = 60\.0 \* 1000\.0;/);
  assert.match(wiring, /Reactions::Verdict OfferReaction\(const Reactions::Reaction& reaction, bool fromOtherMod, double waitMs = kGraceMs, bool outfit = false\)/);
  const offer = wiring.slice(wiring.indexOf('Reactions::Verdict OfferReaction('), wiring.indexOf('// one Chronicle line a minute'));
  assert.match(offer, /verdict == Reactions::Verdict::Hidden && waitMs > 0\.0 && Card::IsHidden\(\) && !g_settings\.petHidden/,
    'only hidden for a menu, never the player\'s own hide');
  assert.match(offer, /if \(!g_pending \|\| reaction\.priority >= g_pending->reaction\.priority\) \{\s*if \(g_pending\) \{\s*SendRemember\(g_pending->reaction\);/,
    'the higher priority keeps the place, a tie goes to the newer, and the one it replaces is still remembered');
  const drain = wiring.slice(wiring.indexOf('void UpdateReactions()'));
  assert.match(drain, /if \(now >= g_pending->untilMs\) \{[\s\S]{0,200}SendRemember\(g_pending->reaction\);\s*g_pending\.reset\(\);/, 'out of time: only its moment');
  assert.match(drain, /else if \(!Card::IsHidden\(\)\) \{[\s\S]{0,200}OfferReaction\(waiting\.reaction, waiting\.fromOtherMod, 0\.0\)/, 'once the card is back, one try, no second wait');
  assert.match(wiring, /void ResetReactions\(\)[\s\S]{0,700}g_pending\.reset\(\);/);
});

// --- DMP-36 ---------------------------------------------------------------

test('DMP-36: the page says which suite mod already uses a key just picked', () => {
  const { p, xp } = page({ hotkey: 'Shift+B' });
  const hint = p.element('#hotkey-hint');
  hint.textContent = '';
  xp.keyOwner({ chord: 'Shift+B', owner: 'DovahWheel' });
  assert.equal(hint.textContent, 'Shift+B is already used by DovahWheel.');
  hint.textContent = '';
  xp.keyOwner({ chord: 'F9', owner: 'DovahWheel' });
  assert.equal(hint.textContent, '', 'not one of MiniPets\' keys now');
  xp.keyOwner({ chord: 'Shift+B', owner: '' });
  assert.equal(hint.textContent, '', 'nobody owns it');
});

test('DMP-36: the plugin asks DovahMenu 0.2.3+ on the game thread; MiniPets\' own entry is nobody', () => {
  const hub = pluginPart('Hub');
  const owner = hub.slice(hub.indexOf('std::string KeyOwner('), hub.indexOf('std::string KeyOwner(') + 700);
  assert.match(owner, /if \(!g_menu \|\| g_menu->hostVersionNumber < 203 \|\| !g_menu->FindKeyOwner\) \{\s*return \{\};/);
  assert.match(owner, /return lower == "minipets" \? std::string\(\) : name;/);
  const card = pluginPart('Card');
  assert.match(card, /RegisterJSListener\(view, "keyOwner", \[\]\(const char\* payload\) \{[\s\S]{0,400}GameThread\("key owner"\)[\s\S]{0,300}Invoke\("dragonbornXP\.keyOwner"/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'view', 'app.js'), 'utf8'), /if \(typeof window\.keyOwner === 'function'\) window\.keyOwner\(label\);/);
});

// --- DMP-37 ---------------------------------------------------------------

test('DMP-37: following DovahHub words the page in its language, and sends "hub" back', () => {
  const { p, xp, sent } = page({ languageSetting: 'hub', language: 'fr', hubLanguage: 'fr' });
  assert.equal(p.sandbox.PetI18n.current, 'fr', 'DovahHub\'s language');
  // only the settings write (queueNativeSettingsChanged's 120 ms) runs at once; the idle animation's timers would loop
  p.sandbox.setTimeout = (fn, ms) => { if (ms === 120) fn(); return 1; };
  // a setting changed in the page: the language goes back as chosen
  xp.openSettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'fox', raisePet: true, languageSetting: 'hub', language: 'fr', hubLanguage: 'fr' });
  p.element('#clock-enabled').checked = true;
  p.element('#clock-enabled').fire('change');
  const fields = (sent.at(-1) || '').split('|');
  assert.equal(fields[12], 'hub');
  // DovahHub's language changes: the plugin sends it again
  xp.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'fox', raisePet: true, languageSetting: 'hub', language: 'de', hubLanguage: 'de' });
  assert.equal(p.sandbox.PetI18n.current, 'de');
});

test('DMP-37: without DovahHub, "hub" reads English and the choice stays hidden', () => {
  const { p } = page({ languageSetting: 'hub', language: 'en', hubLanguage: '' });
  assert.equal(p.sandbox.PetI18n.current, 'en');
});

test('DMP-37: the plugin keeps language=hub, follows DovahHub on the 250 ms pass, and offers the choice to DovahHub', () => {
  const core = pluginFile('main.cpp');
  assert.match(core, /return g_settings\.followHubLanguage \? std::string\("hub"\) : g_settings\.language;/);
  assert.match(core, /if \(value == "hub"\) \{\s*g_settings\.followHubLanguage = true;\s*const auto hub = Hub::HubLanguage\(\);\s*g_settings\.language = hub\.empty\(\) \? "en" : hub;/);
  assert.match(core, /<< "language=" << LanguageSetting\(\)/);
  assert.match(core, /Card::UpdateCompanionState\(\);\s*Hub::FollowHubLanguage\(\);/);
  assert.match(core, /",\\"languageSetting\\":" \+ JsonString\(LanguageSetting\(\)\) \+\s*",\\"hubLanguage\\":" \+ JsonString\(Hub::HubLanguage\(\)\)/);
  const hub = pluginPart('Hub');
  assert.match(hub, /if \(g_hub && DOVAHHUB_API::HasLanguage\(g_hub\)\) \{\s*languages \+= "," \+ choice\("hub", text\.languageFollowHub\);/);
  const follow = hub.slice(hub.indexOf('void FollowHubLanguage()'), hub.indexOf('void FollowHubLanguage()') + 800);
  assert.match(follow, /if \(!g_settings\.followHubLanguage\) \{\s*return;/);
  assert.match(follow, /Card::Invoke\("dragonbornXP\.applySettings", SettingsPayload\(\)\);\s*RefreshHubSettings\(\);/);
  assert.doesNotMatch(follow, /SaveSettings\(\)/, 'nothing saved: the INI keeps hub');
});

// --- DMP-38 ---------------------------------------------------------------

test('DMP-38: the position sliders step by 20 for the pad; the number boxes keep 1', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'view', 'index.html'), 'utf8');
  assert.match(html, /<input id="position-x" class="dv-slider" type="range" min="0" max="3000" step="20">/);
  assert.match(html, /<input id="position-y" class="dv-slider" type="range" min="0" max="2000" step="20">/);
  assert.match(html, /<input id="position-x-value" class="dv-setting-row__value" type="number" min="0" max="3000" step="1">/);
  assert.match(html, /<input id="position-y-value" class="dv-setting-row__value" type="number" min="0" max="2000" step="1">/);
});
