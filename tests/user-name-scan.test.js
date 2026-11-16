// Nothing shipped may name the person who built it. tools/zip-user-scan.py (DovahCamp's, unchanged) reads every
// entry of a zip, binaries included, for a Windows user-folder path and for the build user's name, taken from the
// environment when it runs and never written down. tools/build-release.ps1 keeps xmake's packages and every
// temporary file outside the user folder, and xmake.lua scans the finished zip and deletes it on a hit.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const tool = path.join(ROOT, 'tools', 'zip-user-scan.py');
// a made-up name, so this file holds no real one; the path is built from pieces so this file would pass the scan too
const name = 'Zq' + 'Tester' + 'Xj';
const folder = ['C:', 'Users', ''].join('\\');
const noise = Buffer.from('00ff10204d5a9000', 'hex');

function zip(file, entries) {
  const script = 'import sys, zipfile, base64, json\nz = zipfile.ZipFile(sys.argv[1], "w")\nfor n, d in json.loads(sys.argv[2]).items(): z.writestr(n, base64.b64decode(d))\nz.close()';
  const packed = Object.fromEntries(Object.entries(entries).map(([entry, data]) => [entry, Buffer.from(data).toString('base64')]));
  const made = spawnSync('python', ['-I', '-c', script, file, JSON.stringify(packed)], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return file;
}
const scan = (file, user = name) => spawnSync('python', ['-I', tool, file], { encoding: 'utf8', env: { ...process.env, USERNAME: user } });

test('the scan catches a user folder or the build user\'s name in any entry, and never prints the name', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minipets-scan-'));
  try {
    const clean = zip(path.join(dir, 'clean.zip'), { 'SKSE/plugins/a.dll': noise, 'readme.txt': 'K:\\xmake-global\\packages\\s\\spdlog and the player' });
    let result = scan(clean);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /2 of 2 entries clean/);

    const cases = {
      'a plain path in a binary': Buffer.concat([noise, Buffer.from(folder + 'x\\AppData\\Local\\.xmake'), noise]),
      'a path as UTF-16': Buffer.concat([noise, Buffer.from(folder + 'x', 'utf16le')]),
      'a path with forward slashes and other case': Buffer.from('c:/USERS/x/file.h'),
      'a path on another drive': Buffer.from('D:\\Users\\x'),
      'the name alone': Buffer.concat([noise, Buffer.from(name.toUpperCase()), noise]),
      'the name as UTF-16': Buffer.from(name, 'utf16le'),
    };
    for (const [what, data] of Object.entries(cases)) {
      result = scan(zip(path.join(dir, 'bad.zip'), { 'SKSE/plugins/a.dll': data, 'ok.txt': 'fine' }));
      assert.equal(result.status, 1, `${what} fails the scan`);
      assert.match(result.stdout, /SKSE\/plugins\/a\.dll holds[\s\S]*1 of 2 entries clean/, `${what}: the entry is named`);
      assert.doesNotMatch(result.stdout + result.stderr, new RegExp(name, 'i'), `${what}: the name is never printed`);
    }
    assert.equal(scan(zip(path.join(dir, 'named.zip'), { [`docs/${name}/notes.txt`]: 'fine' })).status, 1, 'a name in an entry\'s path fails');
    // with no user name to look for the scan would be half blind, so it fails rather than pass
    assert.equal(scan(clean, '').status, 2, 'no USERNAME: not a pass');
    assert.equal(spawnSync('python', ['-I', tool], { encoding: 'utf8' }).status, 2, 'no zip: not a pass');
    assert.equal(scan(path.join(dir, 'missing.zip')).status, 2, 'a missing zip: not a pass');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the scan tool is DovahCamp\'s, unchanged', () => {
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(tool)).digest('hex'), '069bb912ac449c85045de3d4b0639eeea0be09f92a92e3e90b76711dfdbddafd');
  assert.match(fs.readFileSync(path.join(ROOT, '.gitattributes'), 'utf8'), /tools\/zip-user-scan\.py -text/);
  assert.match(fs.readFileSync(path.join(ROOT, 'third_party', 'dovah-api', 'SOURCE'), 'utf8'), /tools\/zip-user-scan\.py\s+DovahCamp d665e39/);
});

test('the release script keeps xmake\'s six folders outside the user folder before xmake runs', () => {
  const build = fs.readFileSync(path.join(ROOT, 'tools', 'build-release.ps1'), 'utf8');
  const guarded = build.indexOf("must not run from, or keep xmake's packages in, the user's own folder");
  const globalSet = build.indexOf('$env:XMAKE_GLOBALDIR = $globalDir');
  const configured = build.indexOf('& xmake f ');
  assert.ok(guarded > 0 && globalSet > guarded && configured > globalSet, 'the global folder is checked, then set, before xmake runs');
  for (const variable of ['XMAKE_PKG_INSTALLDIR', 'XMAKE_PKG_CACHEDIR', 'XMAKE_TMPDIR', 'TMP', 'TEMP']) {
    const at = build.indexOf('$env:' + variable + ' = ');
    assert.ok(at > guarded && at < configured, variable + ' is set under the global folder before xmake runs');
  }
  assert.match(build, /\$env:XMAKE_TMPDIR = \$buildTemp\s+\$env:TMP = \$buildTemp\s+\$env:TEMP = \$buildTemp/);
  // a clean build is offered, and the packed DLL is checked to be this build's
  assert.match(build, /if \(\$Clean\) \{\s+foreach \(\$folder in 'build', '\.xmake'\)/);
  assert.match(build, /LastWriteTime -lt \$started[\s\S]*\$dllVersion -ne \$fileVersion[\s\S]*is not the one just built/);
  // the name comes from the environment at build time: no script spells out a user folder or reads the name
  for (const file of ['tools/build-release.ps1', 'tools/zip-user-scan.py', 'xmake.lua']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), 'utf8'), /[A-Za-z]:\\Users\\[A-Za-z0-9]/, `${file} spells out a user folder`);
  }
  assert.match(fs.readFileSync(tool, 'utf8'), /os\.environ\.get\('USERNAME'/);
  assert.doesNotMatch(build, /\$env:USERNAME/);
});

test('every build scans its zip after it is written, and deletes it on a hit', () => {
  const xmake = fs.readFileSync(path.join(ROOT, 'xmake.lua'), 'utf8').replace(/\r\n/g, '\n');
  const zipped = xmake.indexOf('archive.archive(zipfile');
  const scanned = xmake.indexOf('os.execv("python", {"-I", scan, zipfile})');
  const done = xmake.indexOf('created MO2 package');
  assert.ok(zipped > 0 && scanned > zipped && done > scanned);
  assert.match(xmake, /local scan = path\.join\(os\.projectdir\(\), "tools", "zip-user-scan\.py"\)/);
  assert.match(xmake, /if not clean then\s+os\.tryrm\(zipfile\)\s+raise\(/);
});
