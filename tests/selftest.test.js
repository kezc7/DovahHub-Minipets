// DMP-11: the in-game self-test. The game side is src/main.cpp (RunSelfTest) with src/SelfTest.h; these
// check the page's answers to it, the catalogue it reads, and how the plugin starts and reports it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const i18n = require('../view/i18n.js');
const life = require('../view/pet-life.js');
const { loadPage } = require('./page-harness.js');

const ROOT = path.join(__dirname, '..');
const cpp = fs.readFileSync(path.join(ROOT, 'src', 'main.cpp'), 'utf8');
const header = fs.readFileSync(path.join(ROOT, 'src', 'SelfTest.h'), 'utf8');
const code = cpp.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');

const selfTestCode = cpp.slice(cpp.indexOf('// ---- the self-test (DMP-11)'), cpp.indexOf('void RegisterPreviewKeys()'));
const stepNames = [...header.slice(header.indexOf('kSteps{'), header.indexOf('enum class Result')).matchAll(/\{ "([^"]+)", "/g)].map(m => m[1]);
const lineKeys = [...header.slice(header.indexOf('kReactionLineKeys{'), header.indexOf('ReactionLineKeysJson')).matchAll(/"(react[A-Za-z]+)"/g)].map(m => m[1]);

function ask(xp, sandbox, question) {
  let answer = null;
  sandbox.selfTestAnswer = text => { answer = JSON.parse(text); };
  xp.selfTest(question);
  return answer;
}

test('every step in the list is reported by the run, and nothing else is', () => {
  assert.equal(stepNames.length, 14);
  const reported = new Set([...selfTestCode.matchAll(/SelfTestReport\(\*run, "([^"]+)"/g)].map(m => m[1]));
  const checked = new Set([...selfTestCode.matchAll(/SelfTestCheckOffer\(\*run, "([^"]+)"/g)].map(m => m[1]));
  for (const step of stepNames) assert.ok(reported.has(step) || checked.has(step), `${step} is reported`);
  for (const step of [...reported, ...checked]) assert.ok(stepNames.includes(step), `${step} is in SelfTest::kSteps`);
});

test('the run\'s game work goes through the pump, never SKSE\'s task queues', () => {
  assert.doesNotMatch(selfTestCode, /AddTask|AddUITask|GetTaskInterface/);
  assert.match(selfTestCode, /GameThread\(where\)->Queue\(/, 'SelfTestOnGame queues on the pump');
  // the waits are on the run's own thread, not the game thread
  assert.match(selfTestCode, /std::thread\(\[run, delaySeconds\]\(\)/);
  assert.match(selfTestCode, /DovahGameThread::IsGameThread\(\)/, 'each job checks it ran on the game thread');
});

test('the reaction steps call the handlers the game events call', () => {
  assert.match(selfTestCode, /OnHealthShare\(0\.2\)/);
  assert.match(code, /if \(!bleeding && maxHealth > 0\.0f\) \{\s*OnHealthShare\(health \/ maxHealth\);/, 'the 250 ms update uses the same handler');
  assert.match(selfTestCode, /g_sleepStartSink\.ProcessEvent\(&event, nullptr\)/);
  assert.match(selfTestCode, /g_deathSink\.ProcessEvent\(&death, nullptr\)/);
  assert.match(selfTestCode, /OfferBossKill\(run->giantId/);
  assert.match(code, /boss = OfferBossKill\(id, name\);/, 'DovahDamage\'s kills use the same handler');
  assert.match(selfTestCode, /OnDovahHubMessage\(&message\)/);
  assert.match(code, /static void OnRevert\(SKSE::SerializationInterface\*\)\s*\{\s*RevertSave\(\);\s*\}/, 'a new game and the self-test share the revert');
});

test('the test giant is spawned disabled and removed in the same job', () => {
  const boss = selfTestCode.slice(selfTestCode.indexOf('"self-test boss kill"'), selfTestCode.indexOf('SelfTestCheckOffer(*run, "react.boss"'));
  const placed = boss.indexOf('PlaceObjectAtMe');
  assert.ok(placed > 0);
  assert.ok(boss.indexOf('ref->Disable()') > placed && boss.indexOf('ref->Disable()') < boss.indexOf('OfferBossKill'), 'disabled before anything else');
  assert.ok(boss.indexOf('ref->SetDelete(true)') > boss.indexOf('OfferBossKill'), 'deleted after the check');
});

test('it starts only when asked: the INI switch once after the first load, Chronicle, or DovahHub', () => {
  const starts = [...code.matchAll(/StartSelfTest\(/g)].length;
  assert.equal(starts, 4, 'the definition, the INI switch, Chronicle and DovahHub');
  assert.match(cpp, /if \(!g_settings\.selfTest \|\| g_selfTestIniDone\.exchange\(true\)\)/);
  assert.match(cpp, /else if \(key == "self_test"\) \{\s*g_settings\.selfTest = ParseFlag\(value\);/);
  assert.match(cpp, /if \(g_settings\.selfTest\) \{\s*output << "self_test=1\\n";/, 'kept in the file only while it is on');
  assert.match(cpp, /bool selfTest = false;/, 'off by default');
  assert.match(cpp, /command\.prefix = "minipets";/);
  assert.match(cpp, /if \(DOVAHHUB_API::HasSelfTest\(g_hub\)\) \{\s*const auto selfTest = g_hub->RegisterSelfTest\(g_hubModule, &StartSelfTestFromHub, nullptr\);/);
});

test('DovahHub hears each step and the end only in its own run', () => {
  assert.match(selfTestCode, /if \(run\.info\.fromHub && g_hub && g_hubModule\) \{\s*const auto answer = g_hub->ReportSelfTestStep\(g_hubModule, SelfTest::StepJson\(step, result, detail\)\.c_str\(\)\);/);
  assert.match(selfTestCode, /if \(run->info\.fromHub && g_hub && g_hubModule\) \{\s*\(void\)g_hub->FinishSelfTest\(g_hubModule\);/);
  assert.match(selfTestCode, /logger::info\("\{\}", run\.report\.Line\(step, result, detail\)\);/, 'every line in MiniPets.log too');
  assert.match(selfTestCode, /logger::info\("\{\}", done\);/);
});

test('the clean-up runs whatever the steps did', () => {
  const cleanup = selfTestCode.slice(selfTestCode.indexOf('// 6. clean up'), selfTestCode.indexOf('const auto done = run->report.Done'));
  for (const part of ['SetCompanion(run->pet)', 'ApiSetRaisePet(run->raisePet)', 'g_playerDead = run->playerDead', 'g_reactionGate.Reset()', 'g_lowHealth.Rearm()', 'FinishLoad()', 'giant->SetDelete(true)']) {
    assert.ok(cleanup.includes(part), part);
  }
  assert.ok(selfTestCode.indexOf('// 6. clean up') > selfTestCode.lastIndexOf('if (!prepared || !run->ready)'));
});

test('the catalogue knows a line of its own language from an English fallback', () => {
  i18n.setLanguage('fr');
  assert.equal(i18n.has('reactCareful'), true);
  assert.equal(i18n.has('noSuchLine'), false);
  assert.equal(i18n.has('species.fox'), true, 'dotted keys');
  assert.equal(i18n.has('reactCareful', 'en'), true);
  i18n.setLanguage('en');
});

test('the lines the self-test checks are every reaction line in the catalogue', () => {
  const source = fs.readFileSync(path.join(ROOT, 'view', 'i18n.js'), 'utf8');
  const enBlock = source.slice(source.indexOf('    en: {'), source.indexOf('    fr: {'));
  const catalogue = [...new Set([...enBlock.matchAll(/^\s+(react[A-Z][A-Za-z]*):/gm)].map(m => m[1]))].filter(key => !/^reactToMods/.test(key));
  assert.deepEqual([...lineKeys].sort(), catalogue.sort());
  for (const language of i18n.languages) {
    i18n.setLanguage(language);
    for (const key of lineKeys) assert.ok(i18n.has(key), `${language} ${key}`);
  }
  i18n.setLanguage('en');
});

test('the card answers what it draws, its pose, the reaction playing and its session', () => {
  const { sandbox } = loadPage();
  const xp = sandbox.dragonbornXP;
  xp.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'chicken', raisePet: false, language: 'en' });
  let answer = ask(xp, sandbox, { id: 7 });
  assert.equal(answer.id, 7);
  assert.equal(answer.species, 'chicken');
  assert.equal(answer.raisePet, false);
  assert.equal(answer.reaction, '');
  assert.equal(answer.missing, '');

  xp.companionState({ state: 'flying' });
  xp.react({ source: 'minipets', mood: 'sleep', captionKey: 'reactSleeping', vars: {}, ms: 2500, priority: 1, hold: true });
  answer = ask(xp, sandbox, { id: 8 });
  assert.equal(answer.base, 'moving', 'the page calls flying moving');
  assert.equal(answer.reaction, 'sleep');
  xp.reactEnd({});
  assert.equal(ask(xp, sandbox, { id: 9 }).reaction, '');

  // raising a pet: the card draws the pet, and a new game's empty state in a new session clears it
  const fox = Object.assign(life.create('fox', 0), { stage: 'hatched', hatchedAt: 0, lastTick: 10 });
  xp.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'chicken', raisePet: true, language: 'en' });
  xp.petState({ state: life.serialize(fox), session: 5 });
  answer = ask(xp, sandbox, { id: 10 });
  assert.deepEqual([answer.species, answer.hasPet, answer.session], ['fox', true, 5]);
  xp.petState({ state: '', session: 6 });
  answer = ask(xp, sandbox, { id: 11 });
  assert.deepEqual([answer.species, answer.hasPet, answer.session], ['', false, 6]);
});

test('the card names the reaction lines its language lacks', () => {
  const { sandbox } = loadPage();
  const xp = sandbox.dragonbornXP;
  xp.applySettings({ x: -1, y: -1, hotkey: 'Shift+B', pet: 'fox', raisePet: false, language: 'de' });
  const answer = ask(xp, sandbox, { id: 1, keys: ['reactCareful', 'reactNotInAnyCatalogue', 'reactHop'] });
  assert.equal(answer.language, 'de');
  assert.equal(answer.missing, 'reactNotInAnyCatalogue');
});

test('without the plugin\'s answer function the card stays quiet', () => {
  const { sandbox, errors } = loadPage();
  delete sandbox.selfTestAnswer;
  sandbox.dragonbornXP.selfTest({ id: 1 });
  assert.deepEqual(errors, []);
});
