// DMP-19 (the suite's rule): only MiniPets' own files ship. tools/zip-allowlist.py checks every entry of the finished
// zip against tools/zip-allowlist.txt, and xmake.lua deletes a zip with one stray entry.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const tool = path.join(ROOT, 'tools', 'zip-allowlist.py');
const list = path.join(ROOT, 'tools', 'zip-allowlist.txt');

// Python's zipfile turns "\" into "/" on Windows when it names an entry, so a name with a backslash is written with
// "|" in its place, and those bytes are patched afterwards (the name is in no checksum)
function zip(file, names) {
  const script = [
    'import sys, json, zipfile',
    'names = json.loads(sys.argv[2])',
    'z = zipfile.ZipFile(sys.argv[1], "w")',
    'for n in names:',
    '    z.writestr(n.replace("\\\\", "|"), b"" if n.endswith("/") else b"x")',
    'z.close()',
    'data = open(sys.argv[1], "rb").read()',
    'for n in names:',
    '    if "\\\\" in n:',
    '        data = data.replace(n.replace("\\\\", "|").encode(), n.encode())',
    'open(sys.argv[1], "wb").write(data)',
  ].join('\n');
  const made = spawnSync('python', ['-I', '-c', script, file, JSON.stringify(names)], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stderr);
  return file;
}
const check = (file, allowlist = list) => spawnSync('python', ['-I', tool, allowlist, file], { encoding: 'utf8' });

// the layout 1.9.9-beta shipped
const shipped = [
  'PrismaUI/', 'PrismaUI/views/', 'PrismaUI/views/DovahHub/', 'PrismaUI/views/DovahHub/modules/', 'PrismaUI/views/DovahHub/modules/pets/',
  'PrismaUI/views/DovahHub/modules/pets/index.html', 'PrismaUI/views/DovahHub/modules/pets/pets.js', 'PrismaUI/views/DovahHub/modules/pets/pets.css',
  'PrismaUI/views/MiniPets/', 'PrismaUI/views/MiniPets/app.js', 'PrismaUI/views/MiniPets/index.html', 'PrismaUI/views/MiniPets/dovahmenu.json',
  'PrismaUI/views/MiniPets/styles.css', 'PrismaUI/views/MiniPets/theme/', 'PrismaUI/views/MiniPets/theme/fonts/',
  'PrismaUI/views/MiniPets/theme/fonts/BarlowCondensed-Medium.ttf', 'PrismaUI/views/MiniPets/theme/fonts/OFL-BarlowCondensed.txt',
  'SKSE/', 'SKSE/plugins/', 'SKSE/plugins/MiniPets-licenses/', 'SKSE/plugins/MiniPets-licenses/LICENSE.txt',
  'SKSE/plugins/MiniPets-licenses/THIRD-PARTY-NOTICES.md', 'SKSE/plugins/MiniPets.dll',
];

test('a zip with one stray entry is refused, naming it; the shipped layout passes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minipets-allowlist-'));
  try {
    let result = check(zip(path.join(dir, 'ok.zip'), shipped));
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, new RegExp(`${shipped.length} of ${shipped.length} entries allowed`));

    for (const stray of ['docs/CONCERNS.md', 'docs/', 'CONCERNS.md', 'PrismaUI/views/MiniPets/NOTES.md', 'PrismaUI/views/MiniPets/notes.txt',
      'SKSE/plugins/MiniPets.ini', 'SKSE/plugins/MiniPets.log', 'SKSE/plugins/MiniPets-licenses/extra.txt', 'SKSE/plugins/Other.dll',
      'PrismaUI/views/DovahHub/index.html', 'PrismaUI/views/MiniPets/.git/config', '.vs/x.json', 'SKSE\\plugins\\MiniPets.dll',
      'PrismaUI/views/MiniPets/../x.js', 'tests/pet-life.test.js', 'build/windows/x64/release/MiniPets.dll']) {
      result = check(zip(path.join(dir, 'bad.zip'), [...shipped, stray]));
      assert.equal(result.status, 1, `${stray} is refused`);
      assert.ok(result.stdout.includes(`not allowed: ${stray} (`), `${stray} is named`);
      assert.match(result.stdout, new RegExp(`${shipped.length} of ${shipped.length + 1} entries allowed`));
    }
    // not knowing is a failure too
    assert.equal(check(zip(path.join(dir, 'empty.zip'), [])).status, 2, 'an empty zip');
    assert.equal(check(path.join(dir, 'missing.zip')).status, 2, 'a missing zip');
    assert.equal(check(path.join(dir, 'ok.zip'), path.join(dir, 'no-list.txt')).status, 2, 'a missing allowlist');
    assert.equal(spawnSync('python', ['-I', tool], { encoding: 'utf8' }).status, 2, 'no arguments');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('xmake.lua checks the finished zip against the allowlist and deletes it on a stray entry', () => {
  const xmake = fs.readFileSync(path.join(ROOT, 'xmake.lua'), 'utf8').replace(/\r\n/g, '\n');
  const afterBuild = xmake.slice(xmake.indexOf('after_build(function (target)'));
  const packed = afterBuild.indexOf('archive.archive(zipfile');
  const checked = afterBuild.indexOf('"tools", "zip-allowlist.py")');
  assert.ok(packed > 0 && checked > packed, 'after packing');
  assert.match(afterBuild, /local own = try \{[^\n]*"zip-allowlist\.txt"\), zipfile\}\) return true end \}\s+if not own then\s+os\.tryrm\(zipfile\)\s+raise\(/);
  // the release script checks the zip it reports once more, before printing its SHA-256
  const script = fs.readFileSync(path.join(ROOT, 'tools', 'build-release.ps1'), 'utf8');
  const again = script.indexOf("& python -I (Join-Path $root 'tools\\zip-allowlist.py') (Join-Path $root 'tools\\zip-allowlist.txt') $zip");
  assert.ok(again > 0 && again < script.indexOf('Package complete'), 'the release script checks before it reports');
  assert.match(script.slice(again), /^[^\n]*\r?\nif \(\$LASTEXITCODE -ne 0\) \{ throw /);
});
