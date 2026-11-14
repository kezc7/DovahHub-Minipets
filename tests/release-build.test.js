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
