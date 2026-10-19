const test = require('node:test');
const assert = require('node:assert/strict');
const sprites = require('../view/pet-sprites.js');

const expectedPets = [
  'dovahmin', 'dovahpink', 'mudcrab', 'skeever', 'fox', 'sabrecat', 'frostbite-spider', 'horker',
  'troll', 'flame-atronach', 'frost-atronach', 'spriggan', 'dwarven-spider', 'chaurus', 'netch',
  'mammoth', 'dragon-priest', 'wisp', 'death-hound', 'chicken'
];

function eachPart(parts, visit, path = []) {
  parts.forEach(part => {
    visit(part, [...path, part.name]);
    if (part.children) eachPart(part.children, visit, [...path, part.name]);
  });
}

test('every selectable pet has a sprite', () => {
  assert.deepEqual(Object.keys(sprites.pets).sort(), [...expectedPets].sort());
});

for (const [id, pet] of Object.entries(sprites.pets)) {
  test(`${id} sprite data is well formed`, () => {
    assert.ok(['flyer', 'hover', 'light', 'heavy'].includes(pet.archetype), 'known archetype');
    const names = new Set();
    eachPart(pet.parts, (part, path) => {
      const label = path.join('/');
      assert.ok(!names.has(label), `${label} is unique`);
      names.add(label);
      assert.ok(sprites.ROLES.includes(part.role), `${label} has a known role (${part.role})`);
      assert.ok(Array.isArray(part.at) && part.at.length === 2, `${label} has a position`);
      assert.ok(part.rows.length > 0, `${label} has pixels`);
      const width = part.rows[0].length;
      part.rows.forEach((row, index) => {
        assert.equal(row.length, width, `${label} row ${index} is ${row.length} wide, expected ${width}`);
        for (const char of row) {
          if (char !== '.') assert.ok(pet.palette[char], `${label} uses '${char}' which is missing from the palette`);
        }
      });
    });
    const box = sprites.bounds(pet);
    assert.ok(box.width * sprites.PIXEL <= 226, `${id} fits the card width`);
    assert.ok(box.height * sprites.PIXEL + (pet.archetype === "hover" ? 16 : 0) <= 168, `${id} fits the stage height`);
  });
}
