// THREADS (the suite's rule of 8 Nov 2026): in some load orders SKSE's AddTask runs on a worker,
// racing the game. MiniPets queues all its game and view work with AddUITask through GameThread(...),
// bounds the work that repeats, and logs once wherever game work still finds itself off the thread.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const cpp = fs.readFileSync(path.join(SRC, 'main.cpp'), 'utf8');
const ownSources = ['main.cpp', 'Reactions.h', 'SettingsFile.h', 'HubText.h'].map(file => [file, fs.readFileSync(path.join(SRC, file), 'utf8')]);

test('no game work is queued with AddTask', () => {
  for (const [file, text] of ownSources) {
    assert.doesNotMatch(text, /->AddTask\(|\.AddTask\(/, file);
  }
  assert.doesNotMatch(cpp, /SKSE::GetTaskInterface\(\)\)\s*\{\s*\w+->AddTask/);
});

test('the one place that queues uses AddUITask and warns off the game thread', () => {
  const queue = cpp.slice(cpp.indexOf('void QueueGameTask('), cpp.indexOf('struct GameTaskQueue'));
  assert.match(queue, /tasks->AddUITask\(/);
  assert.match(queue, /WarnIfOffGameThread\(where\)/);
  assert.match(cpp, /return main \? main->threadID : 0;/, 'the game thread is RE::Main\'s threadID');
  assert.match(cpp, /logger::info\("MiniPets: game thread \{\}, first update ran on \{\}"/, 'logged once at load');
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
  assert.match(sink, /g_menuCheckQueued\.store\(false\);\s*UpdateOverlayMenuVisibility\(\);/);
});

test('game work called directly warns when it finds itself off the game thread', () => {
  for (const [fn, place] of [['void Invoke(', 'view Invoke'], ['void UpdateReactions()', 'reaction drain'], ['void PollDovahDamage()', 'DovahDamage poll'],
    ['const char* OnHubRequest(', 'DovahHub request'], ['const std::string& StateJson()', 'pet state for DovahHub or the API'], ['MINIPETS_API::Result ApiPetAction(', 'API Feed or Play']]) {
    const body = cpp.slice(cpp.indexOf(fn), cpp.indexOf(fn) + 300);
    assert.ok(body.includes(`WarnIfOffGameThread("${place}")`), fn);
  }
});
