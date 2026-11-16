// DMP-19 (the suite's rule): the notices name CommonLibSSE-NG's licence at the commit MiniPets builds against.
// lib/commonlibsse-ng matches upstream c542446 (7.5.4), which is GPL-3.0-or-later with the Modding Exception and the
// GPL-3.0 Linking Exception (upstream relicensed at 12f8518; before it, MIT). The texts shipped beside the DLL are
// upstream's own, unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

test('the notice names the CommonLibSSE-NG commit and the licence it carries', () => {
  const notice = read('THIRD-PARTY-NOTICES.md');
  assert.match(notice, /\[CommonLibSSE-NG\]\([^)]+\) 7\.5\.4, commit c542446 \| GPL-3\.0-or-later WITH Modding Exception AND GPL-3\.0 Linking Exception/);
  assert.match(notice, /`licenses\/CommonLibSSE-NG-COPYING\.txt`, `licenses\/CommonLibSSE-NG-EXCEPTIONS\.md`/);
  assert.match(notice, /CommonLibSSE \(original code by Ryan-rsm-McKenzie\)[^|]*\| MIT \| `licenses\/CommonLibSSE-original-MIT\.txt`/);
  assert.match(notice, /matches upstream commit c542446/);
  // the copy built against says the same: GPL from its own README, with the MIT text kept for the original code
  const readme = read('lib/commonlibsse-ng/README.md');
  assert.match(readme, /\[GPL-3\.0-or-later\]\(COPYING\.txt\) WITH \[Modding Exception AND GPL-3\.0 Linking Exception/);
});

test('the licence texts shipped are upstream\'s own, unchanged, and every one ships', () => {
  const pairs = {
    'licenses/CommonLibSSE-NG-COPYING.txt': 'lib/commonlibsse-ng/COPYING.txt',
    'licenses/CommonLibSSE-NG-EXCEPTIONS.md': 'lib/commonlibsse-ng/EXCEPTIONS.md',
    'licenses/CommonLibSSE-original-MIT.txt': 'lib/commonlibsse-ng/licenses/LICENSE-MIT.txt',
  };
  for (const [shipped, upstream] of Object.entries(pairs)) assert.equal(read(shipped), read(upstream), `${shipped} is ${upstream}`);
  assert.match(read('licenses/CommonLibSSE-NG-COPYING.txt'), /^ +GNU GENERAL PUBLIC LICENSE\n +Version 3, 29 June 2007\n/);
  assert.match(read('licenses/CommonLibSSE-original-MIT.txt'), /^MIT License\n\nCopyright \(c\) 2018 Ryan-rsm-McKenzie\n/);
  // xmake.lua copies licenses/* beside the DLL; the allowlist must name each one, or the build refuses the zip
  const allowlist = read('tools/zip-allowlist.txt');
  for (const file of fs.readdirSync(path.join(ROOT, 'licenses'))) {
    assert.ok(allowlist.includes(`\nSKSE/plugins/MiniPets-licenses/${file}\n`), `${file} is in the allowlist`);
  }
});
