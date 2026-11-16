// DMP-16 (the suite's build rules): the release build runs every test file in the repo before it zips, and
// checks the zip for compiled Papyrus scripts that name the compiling PC (MiniPets ships none).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const xmake = fs.readFileSync(path.join(ROOT, 'xmake.lua'), 'utf8').replace(/\r\n/g, '\n');
const afterBuild = xmake.slice(xmake.indexOf('after_build(function (target)'));

test('every node, C++ and Python test file runs before the zip is made', () => {
  const zip = afterBuild.indexOf('archive.archive(zipfile');
  for (const step of ['os.files(path.join(os.projectdir(), "tests", "*.test.js"))', 'os.execv("node", nodeargs)',
    'os.execv(project.target("MiniPets_tests"):targetfile())', 'os.files(path.join(os.projectdir(), "tools", "test-*.py"))', 'os.execv("python", {file})']) {
    const at = afterBuild.indexOf(step);
    assert.ok(at > 0 && at < zip, step);
  }
  assert.match(xmake, /target\(PLUGIN_NAME\)\s*add_deps\("commonlibsse-ng"\)[\s\S]{0,200}add_deps\("MiniPets_tests"\)/, 'the C++ tests are built first');
  // the C++ test binary is every tests/cpp file
  const cppFiles = fs.readdirSync(path.join(ROOT, 'tests', 'cpp')).filter(name => name.endsWith('.cpp')).sort();
  const inTarget = [...xmake.slice(xmake.indexOf('target("MiniPets_tests")')).matchAll(/"tests\/cpp\/([^"]+\.cpp)"/g)].map(m => m[1]).sort();
  assert.deepEqual(inTarget, cppFiles);
});

test('the zip is checked for Papyrus headers with DovahFollowerControl\'s tool, unchanged', () => {
  assert.match(afterBuild, /archive\.archive\(zipfile[^\n]*\n[^\n]*\n\s*os\.execv\("python", \{path\.join\(os\.projectdir\(\), "tools", "pex-header\.py"\), "check", "--allow-none", zipfile\}\)/);
  const sha = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'tools', file))).digest('hex');
  assert.equal(sha('pex-header.py'), 'f63013642cc2ca3935503dffec6a38dfb803a78370dcd5aab583c81dce79c27f');
  assert.equal(sha('test-pex-header.py'), '67a79d99a7bc0e3c568980a37379df5e325e77a6c4ff8c084feb27e433e251c9');
  assert.match(fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8'), /tools\/pex-header\.py -text/);
  assert.match(fs.readFileSync(path.join(ROOT, 'third_party', 'dovah-api', 'SOURCE'), 'utf8'), /tools\/pex-header\.py\s+DovahFollowerControl 61986ee/);
});

test('the zip is named dovahhub-minipets-<version>.zip, by the build and by the release script alike', () => {
  assert.match(xmake, /local PACKAGE_NAME = "dovahhub-minipets"/);
  assert.match(afterBuild, /local zipname = PACKAGE_NAME \.\. "-" \.\. PLUGIN_VERSION \.\. "\.zip"/);
  const script = fs.readFileSync(path.join(ROOT, 'tools', 'build-release.ps1'), 'utf8');
  assert.match(script, /\$zip = Join-Path \$root "dovahhub-minipets-\$version\.zip"/);
});

test('the release script builds only a committed tree, never deletes a worktree, and keeps the lock as committed', () => {
  const script = fs.readFileSync(path.join(ROOT, 'tools', 'build-release.ps1'), 'utf8').replace(/\r\n/g, '\n');
  const configured = script.indexOf('& xmake f ');
  const built = script.indexOf('& xmake build ');
  // nothing uncommitted: a zip must be rebuildable from its tag
  const dirty = script.indexOf('& git -C $root diff --ignore-cr-at-eol --quiet HEAD --\n');
  const untracked = script.indexOf('& git -C $root ls-files --others --exclude-standard');
  assert.ok(dirty > 0 && untracked > 0 && dirty < configured && untracked < configured, 'checked before xmake runs');
  // every worktree is checked against both folders before either is deleted
  const guard = script.indexOf('(& git -C $root worktree list --porcelain)');
  const removed = script.indexOf('Remove-Item -LiteralPath $path -Recurse -Force');
  assert.ok(guard > 0 && guard < removed, 'the worktree guard comes before anything is deleted');
  assert.match(script, /if \(\$tree\.StartsWith\(\$inside, \[StringComparison\]::OrdinalIgnoreCase\)\) \{\s+throw "A git worktree lies inside/);
  assert.doesNotMatch(script, /worktree prune/);
  // configure must not re-pin package recipes; checked after configure and after the build
  const lock = [...script.matchAll(/& git -C \$root diff --ignore-cr-at-eol --quiet HEAD -- xmake-requires\.lock\nif \(\$LASTEXITCODE -ne 0\) \{ throw /g)].map(m => m.index);
  assert.equal(lock.length, 2);
  assert.ok(lock[0] > configured && lock[0] < built && lock[1] > built);
});

// a made-up DLL: a DOS header, a Rich header holding the given [build, product, count] entries, and a PE header
function fakeDll(linker, entries) {
  const key = 0x5ca1ab1e;
  const words = [0x536e6144, 0, 0, 0];
  for (const [build, product, count] of entries) words.push(((product << 16) | build) >>> 0, count);
  const rich = Buffer.alloc(words.length * 4 + 8);
  words.forEach((word, i) => rich.writeUInt32LE((word ^ key) >>> 0, i * 4));
  rich.write('Rich', words.length * 4, 'latin1');
  rich.writeUInt32LE(key, words.length * 4 + 4);
  const pe = 0x80 + rich.length;
  const dll = Buffer.alloc(pe + 64);
  dll.write('MZ', 0, 'latin1');
  dll.writeUInt32LE(pe, 0x3c);
  rich.copy(dll, 0x80);
  dll.write('PE\0\0', pe, 'latin1');
  dll[pe + 26] = linker[0];
  dll[pe + 27] = linker[1];
  return dll;
}

test('a release is built by Visual Studio 2022 throughout, checked before the zip', () => {
  const { spawnSync } = require('node:child_process');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minipets-toolset-'));
  const check = (name, dll) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, dll);
    return spawnSync('python', ['-I', path.join(ROOT, 'tools', 'dll-toolset.py'), file, '--linker', '14.4', '--below', '35700'], { encoding: 'utf8' });
  };
  try {
    // 14.44 with the Windows SDK's older entries: fine
    let result = check('fine.dll', fakeDll([14, 44], [[35222, 0x105, 40], [35207, 0x104, 12], [33145, 0x103, 9], [30729, 0x93, 20], [0, 1, 300]]));
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /linker 14\.44; 5 Rich entries, highest build 35222/);
    // linked by 14.44 but carrying a package another Visual Studio compiled: the linker check alone misses it
    result = check('mixed.dll', fakeDll([14, 44], [[35222, 0x105, 40], [36263, 0x105, 4]]));
    assert.equal(result.status, 1);
    assert.match(result.stdout, /4 object\(s\) from build\(s\) 36263/);
    assert.equal(check('edge.dll', fakeDll([14, 44], [[35700, 0x105, 1]])).status, 1, '35700 itself is too new');
    assert.equal(check('edge2.dll', fakeDll([14, 44], [[35699, 0x105, 1]])).status, 0);
    result = check('newer.dll', fakeDll([14, 51], [[35222, 0x105, 40]]));
    assert.equal(result.status, 1);
    assert.match(result.stdout, /linked by 14\.51, not 14\.4x/);
    // not knowing is a failure too
    assert.equal(check('text.dll', Buffer.from('not a DLL at all, just some text that is long enough to read a header from, padded out................')).status, 2);
    const bare = fakeDll([14, 44], [[35222, 0x105, 1]]);
    bare.write('Xich', bare.indexOf('Rich'), 'latin1');
    assert.equal(check('norich.dll', bare).status, 2, 'no Rich header: not a pass');
    assert.equal(spawnSync('python', ['-I', path.join(ROOT, 'tools', 'dll-toolset.py')], { encoding: 'utf8' }).status, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const script = fs.readFileSync(path.join(ROOT, 'tools', 'build-release.ps1'), 'utf8');
  assert.match(script, /\$env:MINIPETS_LINKER = '14\.4'\r?\n\$env:MINIPETS_BUILD_BELOW = '35700'\r?\n[^\n]*\r?\n& xmake f -P \$root -y -m release --vs=2022\r?\n/);
  // --vs=2022 alone: --toolchain=msvc makes xmake build DirectXTK from source
  assert.doesNotMatch(script, /--toolchain/);
  // MiniPets' own package folder, not one shared with other builds
  assert.match(script, /Join-Path \(\[IO\.Path\]::GetPathRoot\(\$root\)\) 'xmake-global\\MiniPets'/);
  const checked = afterBuild.indexOf('"tools", "dll-toolset.py"), target:targetfile()');
  assert.ok(checked > 0 && checked < afterBuild.indexOf('archive.archive(zipfile'), 'before anything is zipped');
  assert.match(afterBuild, /local wanted = os\.getenv\("MINIPETS_LINKER"\)\s+if wanted and wanted ~= "" then\s+os\.execv\("python", \{"-I", path\.join\(os\.projectdir\(\), "tools", "dll-toolset\.py"\)/);
});
