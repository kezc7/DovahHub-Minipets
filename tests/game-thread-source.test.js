// THREADS, then PUMP (the suite's rules of 8 Nov 2026): no SKSE task queue reliably reaches the game's
// main thread, so MiniPets posts all its game and view work to DovahGameThread.h's pump (DovahHub's, or
// its own frame hook without DovahHub), bounds the work that repeats, and logs once wherever game work
// still finds itself off the frame's thread.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const cpp = fs.readFileSync(path.join(SRC, 'main.cpp'), 'utf8');
const ownSources = ['main.cpp', 'Reactions.h', 'SettingsFile.h', 'HubText.h'].map(file => [file, fs.readFileSync(path.join(SRC, file), 'utf8')]);

test('no SKSE task queue for game work in MiniPets\' own sources', () => {
  for (const [file, text] of ownSources) {
    assert.doesNotMatch(text, /AddTask\(|AddUITask\(|GetTaskInterface\(\)/, file);
  }
});

test('the one place that queues posts to the pump, installed at kPostLoad', () => {
  const queue = cpp.slice(cpp.indexOf('void QueueGameTask('), cpp.indexOf('struct GameTaskQueue'));
  assert.match(queue, /DovahGameThread::Post\(where, std::move\(task\)\);/);
  const struct = cpp.slice(cpp.indexOf('struct GameTaskQueue'), cpp.indexOf('GameTaskQueue GameThread('));
  assert.match(struct, /WarnIfOffGameThread\(where\);\s*task\(\);/, 'each job notes where it ran');
  assert.match(cpp, /void WarnIfOffGameThread\(const char\* where\)\s*\{\s*DovahGameThread::Note\(where\);/);
  assert.match(cpp, /case SKSE::MessagingInterface::kPostLoad:\s*\/\/[^\n]*\n\s*DovahGameThread::Install\("MiniPets"\);/);
  assert.match(cpp, /#include "DovahGameThread\.h"/);
});

test('the game thread is the pump\'s, not RE::Main\'s threadID', () => {
  const code = cpp.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /threadID/);
  assert.match(cpp, /std::uint32_t GameThreadId\(\)\s*\{\s*return DovahGameThread::Id\(\);/);
  assert.match(cpp, /logger::info\("MiniPets: game thread \{\} \(the pump's/, 'logged once at load');
});

test('DovahGameThread.h and DovahHub_API.h are DovahHub\'s, unchanged', () => {
  const hub = path.join(__dirname, '..', '..', 'DovahHub', 'src', 'api');
  for (const file of ['DovahGameThread.h', 'DovahHub_API.h']) {
    const theirs = path.join(hub, file);
    if (!fs.existsSync(theirs)) continue;  // DovahHub's checkout isn't beside this one
    assert.equal(fs.readFileSync(path.join(SRC, file), 'utf8'), fs.readFileSync(theirs, 'utf8'), file);
  }
});

test('every queued site has its own name for the warning', () => {
  const code = cpp.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  const names = [...code.matchAll(/(?<![A-Za-z])GameThread\("([^"]+)"\)/g)].map(m => m[1]);
  assert.ok(names.length >= 14, `${names.length} sites`);
  assert.equal(new Set(names).size, names.length, `a name used twice: ${names}`);
  for (const name of names) assert.ok(name.trim().length > 3, name);
});

test('the 250 ms update is queued only once the last pass has run', () => {
  const poller = cpp.slice(cpp.indexOf('void StartCompanionStatePoller()'), cpp.indexOf('class SkillIncreaseSink'));
  assert.match(poller, /if \(g_pollQueued\.exchange\(true\)\) \{\s*continue;/);
  assert.match(poller, /UpdateReactions\(\);\s*g_pollQueued\.store\(false\);/);
  assert.match(poller, /else \{\s*g_pollQueued\.store\(false\);/, 'cleared when nothing could be queued');
});

test('menu events queue one check at a time', () => {
  const sink = cpp.slice(cpp.indexOf('class MenuStateSink'), cpp.indexOf('void SendPetFed('));
  assert.match(sink, /if \(g_menuCheckQueued\.exchange\(true\)\)/);
  assert.match(sink, /GameThread\("menu check"\)->Queue\(\[\]\(\) \{\s*g_menuCheckQueued\.store\(false\);\s*UpdateOverlayMenuVisibility\(\);/);
});

test('game work called directly warns when it finds itself off the game thread', () => {
  for (const [fn, place] of [['void Invoke(', 'view Invoke'], ['void UpdateReactions()', 'reaction drain'], ['void PollDovahDamage()', 'DovahDamage poll'],
    ['const char* OnHubRequest(', 'DovahHub request'], ['const std::string& StateJson()', 'pet state for DovahHub or the API'], ['MINIPETS_API::Result ApiPetAction(', 'API Feed or Play']]) {
    const body = cpp.slice(cpp.indexOf(fn), cpp.indexOf(fn) + 300);
    assert.ok(body.includes(`WarnIfOffGameThread("${place}")`), fn);
  }
});
