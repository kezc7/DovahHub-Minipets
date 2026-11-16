// THREADS, then PUMP (the suite's rules of 8 Nov 2026): no SKSE task queue reliably reaches the game's
// main thread, so MiniPets posts all its game and view work to DovahGameThread.h's pump (DovahHub's, or
// its own frame hook without DovahHub), bounds the work that repeats, and logs once wherever game work
// still finds itself off the frame's thread.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const { pluginSource, pluginFiles, pluginFile } = require('./plugin-source.js');
const cpp = pluginSource();
const ownSources = [...pluginFiles(), ...['Reactions.h', 'SettingsFile.h', 'HubText.h', 'SelfTest.h'].map(file => [file, fs.readFileSync(path.join(SRC, file), 'utf8')])];

test('no SKSE task queue for game work in MiniPets\' own sources', () => {
  for (const [file, text] of ownSources) {
    assert.doesNotMatch(text, /AddTask\(|AddUITask\(|GetTaskInterface\(\)/, file);
  }
});

test('the one place that queues posts to the pump, installed at kPostLoad', () => {
  // the core (main.cpp) posts; Plugin.h's GameTaskQueue is how every part asks
  const core = pluginFile('main.cpp');
  const queue = core.slice(core.indexOf('void QueueGameTask('), core.indexOf('GameTaskQueue GameThread('));
  assert.match(queue, /DovahGameThread::Post\(where, std::move\(task\)\);/);
  const plugin = pluginFile('Plugin.h');
  const struct = plugin.slice(plugin.indexOf('struct GameTaskQueue'), plugin.indexOf('GameTaskQueue GameThread('));
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

// The shared headers are copied from a DovahHub commit, never its working tree (the suite's rule): the
// current one is 025314d (the fallback never runs game work off the game thread). Pinned by the SHA-256 of each file with LF endings.
const HUB_COMMIT = '025314d';
const HUB_HEADERS = {
  'DovahGameThread.h': '46f138d65685ca4a6ea261d4d7317c0b1418a2a89a16b6259f300b48be6c342d',
  'DovahHub_API.h': 'c8c2d7c34078c5bfdeb9ade11798f40f9921992558c0ac736469371b566ce05f',
};

test(`DovahGameThread.h and DovahHub_API.h are DovahHub ${HUB_COMMIT}'s, unchanged`, () => {
  const crypto = require('node:crypto');
  for (const [file, sha] of Object.entries(HUB_HEADERS)) {
    const text = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(crypto.createHash('sha256').update(text).digest('hex'), sha, file);
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
