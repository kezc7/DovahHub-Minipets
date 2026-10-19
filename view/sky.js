(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetSky = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // hours are fractional (20.5 = 8:30pm), x/alt are fractions of the sky box
  const SUNRISE = 5;
  const SUNSET = 20;
  const MOONRISE = 19.5;
  const NIGHT_LENGTH = 10;
  const SECUNDA_LAG = 0.12;

  function phaseFor(hours) {
    if (hours >= 5 && hours < 7) return 'dawn';
    if (hours >= 7 && hours < 18) return 'day';
    if (hours >= 18 && hours < 20) return 'sunset';
    return 'night';
  }

  function arc(progress, height) {
    const up = progress >= 0 && progress <= 1;
    return {
      up,
      x: 0.08 + 0.84 * Math.min(1, Math.max(0, progress)),
      alt: up ? Math.sin(Math.PI * progress) * height : 0
    };
  }

  function skyPositions(hours) {
    const time = ((Number(hours) % 24) + 24) % 24;
    const night = ((time - MOONRISE + 24) % 24) / NIGHT_LENGTH;
    return {
      sun: arc((time - SUNRISE) / (SUNSET - SUNRISE), 1),
      masser: arc(night, 0.9),
      secunda: arc(night - SECUNDA_LAG, 1)
    };
  }

  function seededRandom(seed) {
    let value = seed | 0;
    return () => {
      value = (value + 0x6d2b79f5) | 0;
      let mixed = Math.imul(value ^ (value >>> 15), 1 | value);
      mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Same seed = same layout (one per in-game day). Everything wraps at
  // `columns` so the layers tile when they scroll.
  function buildScenery(seed, columns = 80, region = 'skyrim') {
    const regions = region !== 'skyrim' ? regionsModule() : null;
    if (regions && regions.info[region]) {
      return regions.build(region, seed, columns, seededRandom(seed * 2654435761 + hashText(region)));
    }
    const random = seededRandom(seed * 2654435761);
    const between = (low, high) => low + random() * (high - low);
    const harmonic = (low, high) => (2 * Math.PI * Math.round(between(low, high))) / columns;
    const ridges = [
      { depth: 'far', base: between(6, 9), amp: between(3, 6), f1: harmonic(2, 4), f2: harmonic(5, 8), p1: between(0, 6.3), p2: between(0, 6.3) },
      { depth: 'near', base: between(2, 4), amp: between(2, 4), f1: harmonic(3, 5), f2: harmonic(7, 10), p1: between(0, 6.3), p2: between(0, 6.3) }
    ];

    const lake = random() < 0.45
      ? { x: Math.round(random() < 0.5 ? between(10, 22) : columns - between(10, 22)), width: Math.round(between(14, 22)) }
      : null;
    const clear = x => !lake || Math.abs(x - lake.x) > lake.width / 2 + 2;

    const props = [];
    const pines = Math.floor(between(1, 5));
    for (let attempt = 0; props.length < pines && attempt < 30; attempt += 1) {
      const x = Math.round(between(4, columns - 4));
      if (clear(x) && props.every(prop => Math.abs(prop.x - x) > 5)) {
        props.push({ type: 'pine', x, height: Math.round(between(7, 12)) });
      }
    }
    const rocks = Math.floor(between(0, 3));
    for (let index = 0; index < rocks; index += 1) {
      const x = Math.round(between(3, columns - 3));
      if (clear(x)) props.push({ type: 'rock', x, size: random() < 0.5 ? 2 : 3 });
    }
    props.sort((a, b) => a.x - b.x);

    // foreground bits, depth 0 = horizon, 1 = front
    const tufts = [];
    const tuftCount = Math.round(between(20, 30));
    for (let index = 0; index < tuftCount; index += 1) {
      const roll = random();
      tufts.push({
        x: Math.floor(between(0, columns)),
        depth: random(),
        kind: roll < 0.68 ? 'blade' : roll < 0.9 ? 'flower' : 'pebble',
        colour: Math.floor(random() * 3)
      });
    }
    return { columns, region: 'skyrim', ridges, lake, props, tufts };
  }

  // region art lives in regions.js
  function regionsModule() {
    if (typeof globalThis !== 'undefined' && globalThis.PetRegions) return globalThis.PetRegions;
    if (typeof require === 'function') return require('./regions.js');
    return null;
  }

  function hashText(text) {
    let hash = 7;
    for (let index = 0; index < text.length; index += 1) hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
    return hash;
  }

  // colour multipliers per time of day
  const LIGHT = {
    dawn: [1, 0.86, 0.8],
    day: [1, 1, 1],
    sunset: [0.95, 0.72, 0.7],
    night: [0.32, 0.4, 0.6]
  };

  function shade(rgb, phase, alpha = 1) {
    const light = LIGHT[phase] || LIGHT.day;
    const [r, g, b] = rgb.map((channel, index) => Math.round(channel * light[index]));
    return alpha === 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // draws one layer, `copies` tiles wide
  function drawScenery(context, layout, options) {
    if (layout.region && layout.region !== 'skyrim') {
      const regions = regionsModule();
      if (regions) regions.draw(context, layout, options, shade);
      return;
    }
    const { horizon, height, cell = 3, phase = 'day', weather = 'clear', layer, copies = 2 } = options;
    const columns = layout.columns;
    const span = columns * copies;
    const horizonRow = Math.round(horizon / cell);
    const fill = (column, row, colour) => {
      context.fillStyle = colour;
      context.fillRect(column * cell, row * cell, cell, cell);
    };
    // draw at each tile offset (+1 each side for things crossing the seam)
    const tiled = draw => {
      for (let copy = -1; copy <= copies; copy += 1) draw(copy * columns);
    };
    const snowy = weather === 'snow';
    const snowColour = shade([238, 244, 250], phase);

    layout.ridges.forEach(ridge => {
      if (ridge.depth !== layer) return;
      const far = ridge.depth === 'far';
      const rock = shade(far ? [118, 146, 170] : [74, 102, 98], phase, far ? 0.55 : 0.8);
      const snow = shade([240, 244, 250], phase, far ? 0.6 : 0.75);
      for (let column = 0; column < span; column += 1) {
        const wave = Math.sin(column * ridge.f1 + ridge.p1) * 0.6 + Math.sin(column * ridge.f2 + ridge.p2) * 0.4;
        const ridgeHeight = Math.max(1, Math.round(ridge.base + ridge.amp * wave));
        const capped = ridgeHeight > ridge.base + ridge.amp * 0.45;
        for (let row = horizonRow - ridgeHeight; row < horizonRow; row += 1) {
          fill(column, row, capped && row < horizonRow - ridgeHeight + 2 ? snow : rock);
        }
      }
    });

    if (layer === 'horizon' && layout.lake) {
      const water = shade([88, 148, 188], phase);
      const glint = shade([176, 218, 238], phase);
      const rx = layout.lake.width / 2;
      const ry = 2.6;
      const cy = horizonRow + 3;
      tiled(offset => {
        const cx = layout.lake.x + offset;
        for (let column = Math.floor(cx - rx); column <= Math.ceil(cx + rx); column += 1) {
          for (let row = Math.floor(cy - ry); row <= Math.ceil(cy + ry); row += 1) {
            const dx = (column - cx) / rx;
            const dy = (row - cy) / ry;
            if (dx * dx + dy * dy > 1) continue;
            const sparkle = row === Math.round(cy - 1) && (column + row) % 4 === 0;
            fill(column, row, sparkle ? glint : water);
          }
        }
      });
    }

    if (layer === 'horizon') {
      layout.props.forEach(prop => tiled(offset => {
        const x = prop.x + offset;
        if (prop.type === 'pine') {
          const dark = shade([38, 78, 54], phase);
          const light = shade([60, 110, 74], phase);
          const trunk = shade([78, 56, 40], phase);
          const base = horizonRow + 2;
          fill(x, base, trunk);
          fill(x, base - 1, trunk);
          const foliage = prop.height - 2;
          for (let level = 0; level < foliage; level += 1) {
            const row = base - 2 - (foliage - 1 - level);
            // tiered pine
            const half = Math.max(0, Math.floor(level * 0.42) - (level % 3 === 2 ? 1 : 0));
            for (let dx = -half; dx <= half; dx += 1) {
              const edge = Math.abs(dx) === half;
              fill(x + dx, row, snowy && edge && level % 3 === 0 ? snowColour : dx < 0 ? light : dark);
            }
          }
          if (snowy) fill(x, base - 1 - foliage, snowColour);
        } else if (prop.type === 'rock') {
          const stone = shade([122, 124, 128], phase);
          const top = shade([164, 166, 170], phase);
          const row = horizonRow + 3;
          for (let dx = 0; dx < prop.size; dx += 1) {
            fill(x + dx, row, stone);
            if (dx > 0) fill(x + dx - 1, row - 1, snowy ? snowColour : top);
          }
        }
      }));
    }

    if (layer === 'ground') {
      const firstRow = horizonRow + 5;
      const lastRow = Math.floor((height || horizon / 0.69) / cell) - 9;
      const blade = shade([46, 112, 58], phase);
      const bladeLight = shade([98, 162, 82], phase);
      const stem = shade([58, 120, 62], phase);
      const petals = [[244, 212, 84], [196, 146, 224], [246, 244, 236]].map(colour => shade(colour, phase));
      const pebble = shade([150, 146, 132], phase);
      layout.tufts.forEach(tuft => tiled(offset => {
        const x = tuft.x + offset;
        const row = Math.round(firstRow + tuft.depth * Math.max(0, lastRow - firstRow));
        if (tuft.kind === 'blade') {
          fill(x, row, blade);
          fill(x, row - 1, snowy ? snowColour : bladeLight);
          fill(x + 1, row, blade);
          if (tuft.colour > 0) fill(x - 1, row - 1, blade);
        } else if (tuft.kind === 'flower') {
          fill(x, row, stem);
          fill(x, row - 1, snowy ? snowColour : petals[tuft.colour]);
        } else {
          fill(x, row, snowy ? snowColour : pebble);
          fill(x + 1, row, pebble);
        }
      }));
    }
  }

  return Object.freeze({ phaseFor, skyPositions, buildScenery, drawScenery, shade });
});
