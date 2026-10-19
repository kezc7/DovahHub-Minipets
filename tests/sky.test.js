const test = require('node:test');
const assert = require('node:assert/strict');
const sky = require('../view/sky.js');
const regions = require('../view/regions.js');

test('phases match the plugin time-of-day bands', () => {
  assert.equal(sky.phaseFor(6), 'dawn');
  assert.equal(sky.phaseFor(12), 'day');
  assert.equal(sky.phaseFor(19), 'sunset');
  assert.equal(sky.phaseFor(23), 'night');
  assert.equal(sky.phaseFor(3), 'night');
});

test('the sun rises on the left, peaks at midday and sets on the right', () => {
  const rise = sky.skyPositions(5).sun;
  const noon = sky.skyPositions(12.5).sun;
  const set = sky.skyPositions(20).sun;
  assert.ok(rise.up && rise.x < 0.1 && rise.alt < 0.01);
  assert.ok(noon.up && Math.abs(noon.x - 0.5) < 0.01 && noon.alt > 0.99);
  assert.ok(set.up && set.x > 0.9 && set.alt < 0.01);
  assert.equal(sky.skyPositions(23).sun.up, false);
});

test('the moons cross the night sky with Secunda trailing', () => {
  const midnight = sky.skyPositions(0.5);
  assert.ok(midnight.masser.up && midnight.secunda.up);
  assert.ok(midnight.secunda.x < midnight.masser.x);
  assert.equal(sky.skyPositions(12).masser.up, false);
  assert.equal(sky.skyPositions(12).secunda.up, false);
});

test('scenery layouts are deterministic and varied', () => {
  assert.deepEqual(sky.buildScenery(42), sky.buildScenery(42));
  const layouts = Array.from({ length: 30 }, (_, seed) => sky.buildScenery(seed));
  assert.ok(layouts.some(layout => layout.lake) && layouts.some(layout => !layout.lake), 'lakes come and go');
  assert.ok(new Set(layouts.map(layout => layout.props.length)).size > 2, 'prop counts vary');
});

test('scenery keeps props out of the lake and inside the card', () => {
  for (let seed = 0; seed < 200; seed += 1) {
    const layout = sky.buildScenery(seed, 80);
    layout.props.forEach(prop => {
      assert.ok(prop.x >= 3 && prop.x <= 77, `seed ${seed} prop at ${prop.x}`);
      if (layout.lake) assert.ok(Math.abs(prop.x - layout.lake.x) > layout.lake.width / 2, `seed ${seed} prop in lake`);
    });
  }
});

test('every scenery layer tiles seamlessly', () => {
  const columns = 80;
  const cell = 3;
  const cases = [[1, 'skyrim'], [7, 'skyrim'], [42, 'skyrim'], [99, 'skyrim']];
  regions.names.forEach((region, index) => cases.push([index + 3, region], [index * 7 + 11, region]));
  for (const [seed, region] of cases) {
    const layout = sky.buildScenery(seed, columns, region);
    for (const layer of ['far', 'near', 'horizon', 'ground']) {
      const pixels = new Map();
      const context = {
        fillStyle: '',
        fillRect(x, y) { pixels.set(`${x / cell},${y / cell}`, this.fillStyle); }
      };
      sky.drawScenery(context, layout, { horizon: 167, height: 242, cell, layer, weather: 'snow', copies: 2 });
      for (const [key, colour] of pixels) {
        const [x, y] = key.split(',').map(Number);
        if (x < 0 || x >= columns) continue;
        assert.equal(pixels.get(`${x + columns},${y}`), colour, `${region} seed ${seed} ${layer} differs at column ${x}, row ${y}`);
      }
    }
  }
});

test('regions get their own deterministic layouts', () => {
  for (const region of regions.names) {
    const layout = sky.buildScenery(4, 80, region);
    assert.equal(layout.region, region);
    assert.deepEqual(sky.buildScenery(4, 80, region), layout);
    assert.ok(layout.tufts.length > 0 && layout.props.length > 0, `${region} has props and foreground detail`);
  }
  assert.equal(sky.buildScenery(4, 80, 'unknown-place').region, 'skyrim');
  const volcano = sky.buildScenery(4, 80, 'solstheim').volcano;
  assert.ok(volcano.x < 30 && volcano.height >= 33, 'Red Mountain sits left of centre and towers over the companion');
});

test('every region has drawing info the view relies on', () => {
  assert.equal(regions.names.length, 19);
  for (const region of regions.names) {
    const meta = regions.info[region];
    assert.ok(['open', 'hidden'].includes(meta.sky), `${region} sky`);
    assert.equal(typeof meta.lit, 'boolean', `${region} lit`);
    assert.ok(meta.label, `${region} label`);
    const layout = sky.buildScenery(1, 81, region);
    assert.equal(layout.columns, 81, `${region} keeps its tile width`);
    let pixels = 0;
    for (const layer of ['landmark', 'far', 'near', 'horizon', 'ground']) {
      const context = { fillStyle: '', fillRect() { pixels += 1; } };
      sky.drawScenery(context, layout, { horizon: 167, height: 242, layer, phase: 'night', weather: 'snow', copies: layer === 'landmark' ? 1 : 2 });
    }
    assert.ok(pixels > 400, `${region} draws a scene (${pixels} pixels)`);
  }
});
