(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetRegions = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // Location backdrops. sky 'open' shows the sun/moons/weather, 'hidden' doesn't.
  // lit = shade by time of day. Scrolling layers have to tile at `columns`, so use
  // spaced/each/harmonic for anything that repeats.
  const info = {
    solstheim: { label: 'Solstheim', sky: 'open', lit: true, particles: ['ash'] },
    whiterun: { label: 'Whiterun', sky: 'open', lit: true },
    windhelm: { label: 'Windhelm', sky: 'open', lit: true, particles: ['flurry'] },
    solitude: { label: 'Solitude', sky: 'open', lit: true },
    riften: { label: 'Riften', sky: 'open', lit: true, particles: ['leaves'] },
    markarth: { label: 'Markarth', sky: 'open', lit: true },
    blackreach: { label: 'Blackreach', sky: 'hidden', lit: false, light: 'cool', particles: ['spores'] },
    apocrypha: { label: 'Apocrypha', sky: 'hidden', lit: false, light: 'eldritch', particles: ['pages'] },
    soulcairn: { label: 'Soul Cairn', sky: 'hidden', lit: false, light: 'violet', particles: ['wisps'] },
    sovngarde: { label: 'Sovngarde', sky: 'hidden', lit: false, light: 'gold', particles: ['motes'] },
    dwemer: { label: 'Dwemer ruin', sky: 'hidden', lit: false, indoor: true, light: 'warm' },
    tomb: { label: 'Nordic tomb', sky: 'hidden', lit: false, indoor: true, light: 'flicker' },
    cave: { label: 'Cave', sky: 'hidden', lit: false, indoor: true, light: 'dim', particles: ['drips'] },
    house: { label: 'Home', sky: 'hidden', lit: false, indoor: true, light: 'hearth' },
    inn: { label: 'Inn', sky: 'hidden', lit: false, indoor: true, light: 'hearth' },
    mine: { label: 'Mine', sky: 'hidden', lit: false, indoor: true, light: 'dim' },
    temple: { label: 'Temple', sky: 'hidden', lit: false, indoor: true, light: 'holy' },
    vampire: { label: 'Vampire lair', sky: 'hidden', lit: false, indoor: true, light: 'blood' },
    falmer: { label: 'Falmer hive', sky: 'hidden', lit: false, indoor: true, light: 'cool', particles: ['spores'] }
  };

  // --- Layout helpers ------------------------------------------------------

  function spread(random, columns, count, gap, make) {
    const items = [];
    for (let attempt = 0; items.length < count && attempt < count * 12; attempt += 1) {
      const x = Math.round(3 + random() * (columns - 6));
      if (items.every(item => Math.abs(item.x - x) >= gap)) items.push(make(x));
    }
    return items.sort((a, b) => a.x - b.x);
  }

  function foreground(random, columns, kinds, count) {
    return Array.from({ length: count || Math.round(18 + random() * 12) }, () => ({
      x: Math.floor(random() * columns),
      depth: random(),
      kind: kinds[Math.floor(random() * kinds.length)],
      colour: Math.floor(random() * 3)
    }));
  }

  function tools(random, columns) {
    const between = (low, high) => low + random() * (high - low);
    const whole = (low, high) => Math.round(between(low, high));
    const harmonic = (low, high) => (2 * Math.PI * Math.round(between(low, high))) / columns;
    const ridge = (base, amp, k1, k2) => ({
      base: between(base[0], base[1]), amp: between(amp[0], amp[1]),
      f1: harmonic(k1[0], k1[1]), f2: harmonic(k2[0], k2[1]), p1: between(0, 6.3), p2: between(0, 6.3)
    });
    const pick = list => list[Math.floor(random() * list.length)];
    return { between, whole, ridge, pick, spread: (count, gap, make) => spread(random, columns, count, gap, make), foreground: (kinds, count) => foreground(random, columns, kinds, count) };
  }

  // --- Layout builders -------------------------------------------------------

  const builders = {
    solstheim(t, columns) {
      return {
        // left side so the pet doesn't hide it
        volcano: { x: Math.round(columns * t.between(0.24, 0.32)), height: t.whole(33, 37), width: t.whole(62, 72) },
        far: t.ridge([3, 5], [2, 3], [2, 4], [6, 9]),
        near: t.ridge([2, 3], [1, 3], [3, 5], [8, 11]),
        props: t.spread(t.whole(2, 5), 6, x => {
          const kind = t.pick(['spire', 'spire', 'deadtree', 'deadtree', 'mushroom']);
          return { kind, x, height: kind === 'mushroom' ? t.whole(8, 11) : t.whole(5, 10) };
        }),
        tufts: t.foreground(['ash', 'ash', 'drygrass', 'pebble'])
      };
    },
    whiterun(t, columns) {
      return {
        hall: { x: Math.round(columns * t.between(0.22, 0.3)) },
        far: t.ridge([5, 8], [3, 5], [2, 4], [5, 8]),
        towers: t.whole(2, 3),
        props: t.spread(t.whole(3, 4), 12, x => ({ kind: t.pick(['house', 'house', 'tree']), x, width: t.whole(7, 10) })),
        tufts: t.foreground(['cobble', 'cobble', 'blade', 'flower'])
      };
    },
    windhelm(t, columns) {
      return {
        palace: { x: Math.round(columns * t.between(0.2, 0.3)) },
        far: t.ridge([7, 10], [3, 6], [2, 4], [5, 8]),
        towers: t.whole(2, 3),
        props: t.spread(t.whole(3, 4), 13, x => ({ kind: 'house', x, width: t.whole(8, 11) })),
        tufts: t.foreground(['drift', 'drift', 'cobble'])
      };
    },
    solitude(t, columns) {
      return {
        arch: { x: Math.round(columns * t.between(0.18, 0.26)) },
        far: t.ridge([2, 3], [1, 2], [2, 3], [4, 6]),
        towers: t.whole(2, 3),
        props: t.spread(t.whole(3, 4), 12, x => ({ kind: 'house', x, width: t.whole(7, 10) })),
        tufts: t.foreground(['cobble', 'cobble', 'flower'])
      };
    },
    riften(t, columns) {
      return {
        keep: { x: Math.round(columns * t.between(0.2, 0.28)) },
        trees: t.spread(t.whole(7, 10), 6, x => ({ x, size: t.whole(3, 5), colour: t.whole(0, 2) })),
        props: t.spread(t.whole(3, 4), 12, x => ({ kind: 'house', x, width: t.whole(7, 10) })),
        tufts: t.foreground(['plank', 'plank', 'leaf'])
      };
    },
    markarth(t, columns) {
      return {
        cliff: { x: Math.round(columns * t.between(0.2, 0.3)) },
        far: t.ridge([9, 12], [3, 5], [2, 4], [5, 8]),
        props: t.spread(t.whole(3, 4), 12, x => ({ kind: 'house', x, width: t.whole(7, 10) })),
        tufts: t.foreground(['slab', 'slab', 'pebble'])
      };
    },
    blackreach(t, columns) {
      return {
        sunstone: { x: Math.round(columns * t.between(0.62, 0.72)) },
        pillars: t.spread(4, 16, x => ({ x, width: t.whole(3, 6) })),
        mushrooms: t.spread(t.whole(3, 4), 16, x => ({ x, height: t.whole(16, 24), cap: t.whole(5, 8), colour: t.whole(0, 1) })),
        props: t.spread(t.whole(4, 6), 8, x => ({ kind: 'shroom', x, height: t.whole(3, 6), colour: t.whole(0, 2) })),
        tufts: t.foreground(['glow', 'glow', 'glow', 'pebble'])
      };
    },
    apocrypha(t, columns) {
      return {
        stacks: t.spread(t.whole(5, 7), 9, x => ({ x, height: t.whole(14, 30), seed: t.whole(0, 999) })),
        tentacles: t.spread(t.whole(2, 3), 22, x => ({ x, height: t.whole(18, 26), lean: t.pick([-1, 1]) })),
        props: t.spread(t.whole(3, 5), 12, x => ({ kind: 'book', x, lift: t.whole(4, 10) })),
        tufts: t.foreground(['ink', 'page', 'page'])
      };
    },
    soulcairn(t, columns) {
      return {
        islands: t.spread(t.whole(4, 5), 14, x => ({ x, row: t.whole(6, 24), width: t.whole(8, 14) })),
        props: t.spread(t.whole(3, 5), 10, x => ({ kind: t.pick(['deadtree', 'pillar', 'pillar']), x, height: t.whole(7, 12) })),
        tufts: t.foreground(['bone', 'wisp', 'pebble'])
      };
    },
    sovngarde(t, columns) {
      return {
        hall: { x: Math.round(columns * t.between(0.2, 0.28)) },
        far: t.ridge([6, 9], [3, 6], [2, 4], [5, 8]),
        props: t.spread(t.whole(3, 5), 10, x => ({ kind: t.pick(['stone', 'cairn']), x, height: t.whole(4, 9) })),
        tufts: t.foreground(['goldgrass', 'goldgrass', 'flower'])
      };
    },
    dwemer(t, columns) {
      return {
        pipes: [t.whole(4, 8), t.whole(13, 19)],
        gears: t.spread(3, 18, x => ({ x, row: t.whole(6, 20), size: t.whole(3, 6) })),
        pillars: t.spread(3, 22, x => ({ x })),
        props: t.spread(3, 14, x => ({ kind: t.pick(['lamp', 'lamp', 'crate']), x })),
        tufts: t.foreground(['rivet', 'rivet', 'cog'])
      };
    },
    tomb(t, columns) {
      return {
        arches: t.whole(3, 5),
        pillars: t.spread(3, 22, x => ({ x })),
        props: t.spread(4, 10, x => ({ kind: t.pick(['urn', 'urn', 'torch', 'sarcophagus']), x })),
        tufts: t.foreground(['bone', 'bone', 'skull', 'rubble'])
      };
    },
    cave(t, columns) {
      return {
        drips: t.spread(t.whole(8, 12), 5, x => ({ x, length: t.whole(2, 6) })),
        pillars: t.spread(t.whole(2, 3), 24, x => ({ x, width: t.whole(3, 5) })),
        props: t.spread(t.whole(3, 5), 9, x => ({ kind: t.pick(['crystal', 'boulder', 'boulder']), x })),
        tufts: t.foreground(['pebble', 'pebble', 'puddle'])
      };
    },
    house(t, columns) {
      return {
        windows: t.whole(2, 3),
        posts: t.whole(3, 4),
        props: t.spread(t.whole(3, 4), 14, x => ({ kind: t.pick(['hearth', 'table', 'barrel', 'shelf']), x })),
        tufts: t.foreground(['rug', 'board', 'board'], 14)
      };
    },
    inn(t, columns) {
      return {
        windows: 2,
        posts: t.whole(3, 4),
        lanterns: t.whole(3, 4),
        props: t.spread(t.whole(4, 5), 11, x => ({ kind: t.pick(['bar', 'barrel', 'barrel', 'hearth', 'table']), x })),
        tufts: t.foreground(['board', 'board', 'mug'], 14)
      };
    },
    mine(t, columns) {
      return {
        veins: t.spread(t.whole(6, 9), 6, x => ({ x, row: t.whole(4, 22), colour: t.whole(0, 2) })),
        frames: t.whole(3, 4),
        props: t.spread(t.whole(3, 4), 14, x => ({ kind: t.pick(['cart', 'lantern', 'ore']), x })),
        tufts: t.foreground(['ore', 'pebble', 'pebble'])
      };
    },
    temple(t, columns) {
      return {
        windows: t.whole(3, 4),
        pillars: t.whole(3, 4),
        props: t.spread(t.whole(3, 5), 11, x => ({ kind: t.pick(['candles', 'candles', 'altar', 'brazier']), x })),
        tufts: t.foreground(['tile'], 12)
      };
    },
    vampire(t, columns) {
      return {
        banners: t.whole(3, 4),
        pillars: t.spread(3, 22, x => ({ x })),
        props: t.spread(t.whole(3, 4), 12, x => ({ kind: t.pick(['coffin', 'coffin', 'candelabra']), x })),
        tufts: t.foreground(['bone', 'blood', 'blood'])
      };
    },
    falmer(t, columns) {
      return {
        drips: t.spread(t.whole(7, 10), 6, x => ({ x, length: t.whole(3, 7) })),
        glows: t.spread(t.whole(10, 14), 4, x => ({ x, row: t.whole(3, 22) })),
        props: t.spread(t.whole(3, 5), 10, x => ({ kind: t.pick(['eggs', 'eggs', 'tent']), x })),
        tufts: t.foreground(['glowshroom', 'pebble', 'glowshroom'])
      };
    }
  };

  function build(region, seed, columns, random) {
    const builder = builders[region];
    return Object.assign({ columns, region }, builder(tools(random, columns), columns));
  }

  // --- Drawing ---------------------------------------------------------------

  function canvasTools(context, layout, options, shade) {
    const { horizon, height, cell = 3, layer, copies = 2 } = options;
    const regionInfo = info[layout.region];
    const phase = regionInfo.lit ? options.phase || 'day' : 'day';
    const columns = layout.columns;
    const span = columns * copies;
    const horizonRow = Math.round(horizon / cell);
    const bottomRow = Math.floor((height || horizon / 0.69) / cell);
    const fill = (column, row, colour) => {
      context.fillStyle = colour;
      context.fillRect(column * cell, row * cell, cell, cell);
    };
    const rect = (column, row, width, rows, colour) => {
      for (let dx = 0; dx < width; dx += 1) for (let dy = 0; dy < rows; dy += 1) fill(column + dx, row + dy, colour);
    };
    // draw at each tile offset
    const tiled = draw => {
      for (let copy = -1; copy <= copies; copy += 1) draw(copy * columns);
    };
    const each = (items, draw) => items.forEach(item => tiled(offset => draw(item, item.x + offset)));
    const spaced = (count, draw) => {
      for (let index = 0; index < count; index += 1) tiled(offset => draw(Math.round((index * columns) / count) + offset, index));
    };
    // lit = shaded by time of day, raw = fixed colour
    const lit = (rgb, alpha) => shade(rgb, phase, alpha === undefined ? 1 : alpha);
    const raw = (rgb, alpha) => (alpha === undefined ? `rgb(${rgb.join(', ')})` : `rgba(${rgb.join(', ')}, ${alpha})`);
    const colour = regionInfo.lit ? lit : raw;
    const ridge = (r, paint, cap) => {
      for (let column = 0; column < span; column += 1) {
        const wave = Math.sin(column * r.f1 + r.p1) * 0.6 + Math.sin(column * r.f2 + r.p2) * 0.4;
        const ridgeHeight = Math.max(1, Math.round(r.base + r.amp * wave));
        const capped = cap && ridgeHeight > r.base + r.amp * 0.45;
        for (let row = horizonRow - ridgeHeight; row < horizonRow; row += 1) {
          fill(column, row, capped && row < horizonRow - ridgeHeight + 2 ? cap : paint);
        }
      }
    };
    const disc = (cx, cy, radius, paint) => {
      for (let dy = -Math.ceil(radius); dy <= Math.ceil(radius); dy += 1) {
        for (let dx = -Math.ceil(radius); dx <= Math.ceil(radius); dx += 1) {
          if (dx * dx + dy * dy <= radius * radius) fill(cx + dx, cy + dy, paint);
        }
      }
    };
    // stalactite, or stalagmite with a negative length
    const spike = (x, row, length, paint) => {
      const down = length > 0;
      for (let step = 0; step < Math.abs(length); step += 1) {
        const half = Math.max(0, Math.floor((Math.abs(length) - step) / 3));
        rect(x - half, down ? row + step : row - step, half * 2 + 1, 1, paint);
      }
    };
    const groundRow = depth => {
      const first = horizonRow + 4;
      const last = bottomRow - 9;
      return Math.round(first + depth * Math.max(0, last - first));
    };
    const roof = (x, base, width, rows, paint) => {
      for (let step = 0; step < rows; step += 1) {
        const half = Math.max(0, Math.round((width / 2) * (1 - step / rows)));
        rect(x - half, base - step, half * 2 + 1, 1, paint);
      }
    };
    return { layer, columns, span, horizonRow, bottomRow, fill, rect, tiled, each, spaced, lit, raw, colour, ridge, disc, spike, groundRow, roof };
  }

  function cityWall(d, paint, top, merlonGap = 3, height = 5) {
    const row = d.horizonRow - height;
    d.rect(0, row, d.span, height, paint);
    // per tile so it loops
    const merlons = Math.max(1, Math.round(d.columns / (merlonGap * 2)));
    d.spaced(merlons, column => d.rect(column, row - 1, merlonGap, 1, paint));
    if (top) d.rect(0, row, d.span, 1, top);
  }

  function cityHouse(d, x, width, walls, roofPaint, extra) {
    const base = d.horizonRow + 2;
    d.rect(x - Math.floor(width / 2), base - 5, width, 6, walls);
    d.roof(x, base - 6, width + 2, Math.ceil(width / 2), roofPaint);
    d.rect(x - 1, base - 2, 2, 3, d.colour([60, 44, 32]));
    d.fill(x + Math.floor(width / 2) - 2, base - 4, d.raw([255, 214, 140], 0.85));
    if (extra) extra(base);
  }

  function lightsAt(d, x, row, paint) {
    d.fill(x, row, paint);
  }

  const drawers = {
    solstheim(d, layout) {
      if (d.layer === 'landmark') {
        // red mountain, lava uses raw colours so it glows at night
        const { x, height: peak, width } = layout.volcano;
        const rock = d.lit([74, 56, 52]);
        const shadow = d.lit([52, 40, 38]);
        const lava = d.raw([236, 96, 42]);
        const crater = d.raw([255, 168, 72]);
        for (let row = 0; row < peak; row += 1) {
          const half = Math.round((width / 2) * ((row + 3) / (peak + 3)));
          const y = d.horizonRow - peak + row;
          for (let dx = -half; dx <= half; dx += 1) d.fill(x + dx, y, dx > half * 0.25 ? shadow : rock);
        }
        d.rect(x - 2, d.horizonRow - peak, 5, 1, crater);
        [[-1, 0.55], [1, 0.4]].forEach(([direction, length]) => {
          for (let row = 1; row < peak * length; row += 1) {
            d.fill(x + direction * Math.round(row * 0.45), d.horizonRow - peak + row, row % 3 === 0 ? crater : lava);
          }
        });
      } else if (d.layer === 'far') d.ridge(layout.far, d.lit([128, 116, 106], 0.75));
      else if (d.layer === 'near') d.ridge(layout.near, d.lit([96, 86, 78], 0.92));
      else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const base = d.horizonRow + 2;
          if (prop.kind === 'spire') {
            for (let level = 0; level < prop.height; level += 1) {
              const wide = level > prop.height * 0.6 ? 2 : level > prop.height * 0.25 ? 1 : 0;
              for (let dx = -wide; dx <= wide; dx += 1) d.fill(x + dx, base - level, dx < 0 ? d.lit([122, 110, 100]) : d.lit([88, 78, 72]));
            }
          } else if (prop.kind === 'deadtree') {
            const bark = d.lit([70, 56, 46]);
            d.rect(x, base - prop.height + 1, 1, prop.height, bark);
            [[-1, 3], [1, 4], [-2, 5], [2, 6], [-1, 6]].forEach(([dx, up]) => { if (up < prop.height) d.fill(x + dx, base - up, bark); });
          } else {
            d.rect(x, base - prop.height + 3, 1, prop.height - 2, d.lit([200, 190, 160]));
            d.rect(x - 3, base - prop.height + 2, 7, 1, d.lit([118, 150, 132]));
            d.rect(x - 2, base - prop.height + 1, 5, 1, d.lit([160, 190, 168]));
          }
        });
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => {
          const row = d.groundRow(tuft.depth);
          if (tuft.kind === 'ash') d.rect(x, row, 2, 1, d.lit([150, 140, 128]));
          else if (tuft.kind === 'drygrass') { d.fill(x, row, d.lit([128, 128, 90])); d.fill(x + 1, row - 1, d.lit([128, 128, 90])); }
          else d.rect(x, row, 2, 1, d.lit([90, 82, 76]));
        });
      }
    },

    whiterun(d, layout) {
      if (d.layer === 'landmark') {
        // dragonsreach
        const x = layout.hall.x;
        const hill = d.lit([96, 118, 74]);
        for (let row = 0; row < 12; row += 1) d.rect(x - 9 - row * 2, d.horizonRow - 12 + row, 19 + row * 4, 1, hill);
        const wall = d.lit([140, 116, 86]);
        const roofPaint = d.lit([86, 64, 46]);
        d.rect(x - 8, d.horizonRow - 20, 17, 8, wall);
        d.roof(x, d.horizonRow - 21, 19, 10, roofPaint);
        d.fill(x - 1, d.horizonRow - 31, roofPaint);
        d.fill(x + 1, d.horizonRow - 31, roofPaint);
        d.fill(x - 2, d.horizonRow - 32, roofPaint);
        d.fill(x + 2, d.horizonRow - 32, roofPaint);
        [-5, 0, 5].forEach(dx => d.rect(x + dx, d.horizonRow - 17, 1, 2, d.raw([255, 212, 130], 0.9)));
      } else if (d.layer === 'far') d.ridge(layout.far, d.lit([128, 150, 160], 0.6), d.lit([238, 242, 248], 0.7));
      else if (d.layer === 'near') {
        cityWall(d, d.lit([150, 140, 120]), d.lit([176, 166, 146]));
        d.spaced(layout.towers, x => {
          d.rect(x - 2, d.horizonRow - 9, 5, 9, d.lit([138, 128, 110]));
          d.roof(x, d.horizonRow - 10, 7, 3, d.lit([96, 70, 50]));
        });
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          if (prop.kind === 'tree') {
            d.rect(x, d.horizonRow - 2, 1, 4, d.lit([86, 62, 42]));
            d.disc(x, d.horizonRow - 5, 3, d.lit([76, 126, 64]));
          } else cityHouse(d, x, prop.width, d.lit([170, 146, 110]), d.lit([156, 128, 70]));
        });
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => {
          const row = d.groundRow(tuft.depth);
          if (tuft.kind === 'cobble') d.rect(x, row, 2, 1, d.lit([132, 128, 118]));
          else if (tuft.kind === 'flower') { d.fill(x, row, d.lit([58, 120, 62])); d.fill(x, row - 1, d.lit([244, 212, 84])); }
          else { d.fill(x, row, d.lit([46, 112, 58])); d.fill(x, row - 1, d.lit([98, 162, 82])); }
        });
      }
    },

    windhelm(d, layout) {
      const snow = d.lit([236, 242, 248]);
      if (d.layer === 'landmark') {
        // palace of the kings
        const x = layout.palace.x;
        const stone = d.lit([86, 92, 104]);
        const dark = d.lit([64, 70, 82]);
        d.rect(x - 9, d.horizonRow - 18, 19, 18, stone);
        d.rect(x + 4, d.horizonRow - 18, 6, 18, dark);
        [-7, 0, 7].forEach((dx, index) => {
          const tall = index === 1 ? 30 : 24;
          d.rect(x + dx - 1, d.horizonRow - tall, 3, tall - 18, stone);
          d.roof(x + dx, d.horizonRow - tall - 1, 4, 4, dark);
          d.fill(x + dx, d.horizonRow - tall - 4, snow);
        });
        d.rect(x - 9, d.horizonRow - 19, 19, 1, snow);
        [-4, 3].forEach(dx => d.rect(x + dx, d.horizonRow - 12, 1, 2, d.raw([255, 206, 130], 0.85)));
      } else if (d.layer === 'far') d.ridge(layout.far, d.lit([150, 166, 182], 0.65), d.lit([244, 248, 252], 0.85));
      else if (d.layer === 'near') {
        cityWall(d, d.lit([96, 102, 112]), snow, 2, 6);
        d.spaced(layout.towers, x => {
          d.rect(x - 2, d.horizonRow - 10, 5, 10, d.lit([86, 92, 102]));
          d.rect(x - 2, d.horizonRow - 11, 5, 1, snow);
        });
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => cityHouse(d, x, prop.width, d.lit([112, 116, 124]), d.lit([92, 80, 72]), base => {
          d.roof(x, base - 6, prop.width + 2, 2, snow);
        }));
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => {
          const row = d.groundRow(tuft.depth);
          if (tuft.kind === 'drift') d.rect(x, row, 3, 1, snow);
          else d.rect(x, row, 2, 1, d.lit([120, 124, 132]));
        });
      }
    },

    solitude(d, layout) {
      if (d.layer === 'landmark') {
        // the arch and blue palace
        const x = layout.arch.x;
        const rock = d.lit([112, 104, 96]);
        const rockDark = d.lit([86, 80, 74]);
        d.rect(x - 14, d.horizonRow - 26, 6, 26, rock);
        d.rect(x + 14, d.horizonRow - 20, 6, 20, rockDark);
        for (let dx = -10; dx <= 16; dx += 1) {
          const lift = Math.round(Math.sqrt(Math.max(0, 196 - (dx - 3) * (dx - 3))) * 0.5);
          d.rect(x + dx, d.horizonRow - 22 - lift, 1, 4, dx > 8 ? rockDark : rock);
        }
        d.rect(x - 15, d.horizonRow - 34, 9, 7, d.lit([210, 214, 220]));
        d.roof(x - 11, d.horizonRow - 35, 11, 4, d.lit([64, 100, 160]));
        d.rect(x - 12, d.horizonRow - 31, 2, 2, d.raw([255, 216, 140], 0.9));
      } else if (d.layer === 'far') {
        // sea
        d.ridge(layout.far, d.lit([120, 138, 150], 0.55));
        d.rect(0, d.horizonRow - 3, d.span, 3, d.lit([82, 124, 156], 0.85));
        d.spaced(12, x => d.rect(x, d.horizonRow - 2, 2, 1, d.lit([180, 214, 236], 0.8)));
      } else if (d.layer === 'near') {
        cityWall(d, d.lit([196, 192, 182]), d.lit([222, 218, 208]));
        d.spaced(layout.towers, x => {
          d.rect(x - 2, d.horizonRow - 10, 5, 10, d.lit([186, 182, 172]));
          d.roof(x, d.horizonRow - 11, 7, 4, d.lit([110, 72, 54]));
        });
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => cityHouse(d, x, prop.width, d.lit([226, 220, 206]), d.lit([118, 74, 56]), base => {
          const beam = d.lit([86, 60, 44]);
          d.rect(x - Math.floor(prop.width / 2), base - 5, prop.width, 1, beam);
          d.rect(x - Math.floor(prop.width / 2), base - 5, 1, 6, beam);
          d.rect(x + Math.ceil(prop.width / 2) - 1, base - 5, 1, 6, beam);
        }));
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => {
          const row = d.groundRow(tuft.depth);
          if (tuft.kind === 'flower') { d.fill(x, row, d.lit([58, 120, 62])); d.fill(x, row - 1, d.lit([196, 146, 224])); }
          else d.rect(x, row, 2, 1, d.lit([150, 146, 136]));
        });
      }
    },

    riften(d, layout) {
      const autumn = [[214, 120, 46], [232, 176, 64], [186, 70, 46]];
      if (d.layer === 'landmark') {
        // mistveil keep
        const x = layout.keep.x;
        const stone = d.lit([112, 104, 92]);
        d.rect(x - 7, d.horizonRow - 20, 15, 20, stone);
        d.rect(x - 3, d.horizonRow - 27, 7, 7, d.lit([100, 92, 82]));
        d.roof(x, d.horizonRow - 28, 9, 4, d.lit([72, 54, 44]));
        [-4, 4].forEach(dx => d.rect(x + dx, d.horizonRow - 14, 1, 2, d.raw([255, 210, 130], 0.85)));
      } else if (d.layer === 'far') {
        // forest
        d.rect(0, d.horizonRow - 4, d.span, 4, d.lit([150, 96, 52], 0.7));
        d.each(layout.trees, (tree, x) => d.disc(x, d.horizonRow - 4 - tree.size, tree.size + 1, d.lit(autumn[tree.colour], 0.85)));
      } else if (d.layer === 'near') {
        // palisade
        const timber = d.lit([110, 80, 54]);
        for (let column = 0; column < d.span; column += 1) {
          const odd = (column % d.columns) % 2;
          const top = d.horizonRow - 7 - odd;
          d.rect(column, top, 1, d.horizonRow - top, odd ? timber : d.lit([128, 94, 62]));
        }
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => cityHouse(d, x, prop.width, d.lit([136, 100, 68]), d.lit([70, 52, 40]), base => {
          d.rect(x - Math.floor(prop.width / 2), base + 1, 1, 2, d.lit([86, 62, 42]));
          d.rect(x + Math.ceil(prop.width / 2) - 1, base + 1, 1, 2, d.lit([86, 62, 42]));
        }));
      } else if (d.layer === 'ground') {
        // canal and boardwalk
        const canalRow = d.horizonRow + 6;
        d.rect(0, canalRow, d.span, 4, d.lit([70, 104, 112]));
        d.spaced(10, x => d.rect(x, canalRow + 1, 2, 1, d.lit([140, 180, 186])));
        d.each(layout.tufts, (tuft, x) => {
          const row = canalRow + 5 + Math.round(tuft.depth * 6);
          if (tuft.kind === 'leaf') d.fill(x, row, d.lit(autumn[tuft.colour]));
          else d.rect(x, row, 3, 1, d.lit([126, 92, 60]));
        });
      }
    },

    markarth(d, layout) {
      if (d.layer === 'landmark') {
        // cliff city
        const x = layout.cliff.x;
        const rock = d.lit([150, 112, 86]);
        const carved = d.lit([176, 140, 108]);
        const brass = d.lit([190, 146, 76]);
        for (let row = 0; row < 32; row += 1) d.rect(x - 16 + Math.floor(row / 3), d.horizonRow - 32 + row, 30 - Math.floor(row / 3), 1, rock);
        [[-6, 10], [2, 16], [-2, 24]].forEach(([dx, up]) => {
          d.rect(x + dx - 3, d.horizonRow - up, 8, 5, carved);
          d.rect(x + dx - 3, d.horizonRow - up, 8, 1, brass);
          d.rect(x + dx, d.horizonRow - up + 2, 2, 2, d.raw([255, 210, 130], 0.85));
        });
        // waterfall
        d.rect(x + 8, d.horizonRow - 26, 2, 26, d.lit([150, 196, 220], 0.85));
      } else if (d.layer === 'far') d.ridge(layout.far, d.lit([160, 118, 92], 0.7));
      else if (d.layer === 'near') {
        const stone = d.lit([168, 132, 100]);
        for (let column = 0; column < d.span; column += 1) {
          const step = 4 + ((Math.floor((column % d.columns) / 5) % 2) * 2);
          d.rect(column, d.horizonRow - step, 1, step, stone);
        }
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const base = d.horizonRow + 2;
          d.rect(x - Math.floor(prop.width / 2), base - 5, prop.width, 6, d.lit([184, 148, 112]));
          d.rect(x - Math.floor(prop.width / 2), base - 6, prop.width, 1, d.lit([190, 146, 76]));
          d.rect(x - 1, base - 2, 2, 3, d.lit([90, 66, 50]));
          d.fill(x + 2, base - 4, d.raw([255, 214, 140], 0.85));
        });
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => d.rect(x, d.groundRow(tuft.depth), tuft.kind === 'slab' ? 3 : 1, 1, d.lit([150, 120, 96])));
      }
    },

    blackreach(d, layout) {
      const caps = [[120, 150, 255], [196, 120, 240]];
      if (d.layer === 'landmark') {
        // sunstone
        const x = layout.sunstone.x;
        d.rect(x - 1, 0, 3, d.horizonRow - 26, d.raw([255, 214, 120], 0.12));
        d.rect(x - 3, d.horizonRow - 22, 7, 22, d.raw([42, 40, 58]));
        d.rect(x - 2, d.horizonRow - 24, 5, 2, d.raw([96, 76, 46]));
        d.disc(x, d.horizonRow - 27, 2.6, d.raw([255, 214, 120]));
        d.disc(x, d.horizonRow - 27, 1.2, d.raw([255, 246, 210]));
      } else if (d.layer === 'far') {
        d.each(layout.pillars, (column, x) => {
          d.rect(x - Math.floor(column.width / 2), 0, column.width, d.horizonRow, d.raw([34, 38, 64]));
          d.fill(x, Math.round(d.horizonRow * 0.6), d.raw([150, 180, 255], 0.7));
        });
      } else if (d.layer === 'near') {
        d.each(layout.mushrooms, (mushroom, x) => {
          const top = d.horizonRow - mushroom.height;
          d.rect(x, top, 2, mushroom.height + 2, d.raw([70, 80, 110]));
          for (let row = 0; row < 3; row += 1) d.rect(x - mushroom.cap + row, top - row, (mushroom.cap - row) * 2 + 2, 1, d.raw(caps[mushroom.colour]));
          d.fill(x - 2, top - 1, d.raw([236, 240, 255]));
          d.fill(x + 3, top, d.raw([236, 240, 255]));
        });
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const base = d.horizonRow + 2;
          d.rect(x, base - prop.height + 1, 1, prop.height, d.raw([80, 90, 120]));
          d.rect(x - 1, base - prop.height, 3, 1, d.raw([[120, 210, 255], [196, 140, 255], [140, 255, 200]][prop.colour]));
        });
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => d.fill(x, d.groundRow(tuft.depth), tuft.kind === 'glow' ? d.raw([140, 200, 255], 0.8) : d.raw([60, 60, 80])));
      }
    },

    apocrypha(d, layout) {
      const spines = [[70, 120, 84], [120, 98, 60], [60, 108, 116], [140, 116, 70]];
      if (d.layer === 'far') {
        // book stacks
        d.each(layout.stacks, (stack, x) => {
          for (let row = 0; row < stack.height; row += 1) {
            const width = 4 + ((row * 7 + stack.seed) % 3);
            const shift = ((row * 5 + stack.seed) % 3) - 1;
            d.rect(x - 2 + shift, d.horizonRow - 1 - row, width, 1, d.raw(spines[(row + stack.seed) % spines.length]));
          }
        });
      } else if (d.layer === 'near') {
        // tentacles
        d.each(layout.tentacles, (tentacle, x) => {
          for (let row = 0; row < tentacle.height; row += 1) {
            const sway = Math.round(Math.sin(row / 4) * 2 * tentacle.lean);
            const width = row > tentacle.height - 6 ? 1 : row > tentacle.height / 2 ? 2 : 3;
            d.rect(x + sway, d.horizonRow - row, width, 1, d.raw([24, 44, 28]));
            if (row % 3 === 0 && width > 1) d.fill(x + sway + 1, d.horizonRow - row, d.raw([150, 220, 120]));
          }
        });
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const row = d.horizonRow - prop.lift;
          d.rect(x - 3, row, 3, 1, d.raw([214, 222, 176]));
          d.rect(x + 1, row, 3, 1, d.raw([214, 222, 176]));
          d.rect(x - 3, row + 1, 7, 1, d.raw([60, 90, 60]));
        });
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => {
          const row = d.groundRow(tuft.depth);
          if (tuft.kind === 'ink') d.rect(x, row, 4, 1, d.raw([16, 30, 22]));
          else d.rect(x, row, 2, 1, d.raw([200, 210, 170], 0.85));
        });
      }
    },

    soulcairn(d, layout) {
      if (d.layer === 'far') {
        // floating islands
        d.each(layout.islands, (island, x) => {
          for (let row = 0; row < 5; row += 1) {
            const half = Math.max(1, Math.round((island.width / 2) * (1 - row / 5)));
            d.rect(x - half, island.row + row, half * 2 + 1, 1, d.raw([42, 28, 60]));
          }
          d.rect(x - Math.round(island.width / 2), island.row - 1, island.width, 1, d.raw([150, 124, 190]));
          d.fill(x, island.row + 5, d.raw([42, 28, 60]));
        });
      } else if (d.layer === 'near') {
        d.rect(0, d.horizonRow - 3, d.span, 3, d.raw([60, 46, 76], 0.9));
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const base = d.horizonRow + 2;
          if (prop.kind === 'deadtree') {
            const bark = d.raw([30, 24, 36]);
            d.rect(x, base - prop.height + 1, 1, prop.height, bark);
            [[-1, 4], [1, 5], [-2, 6], [2, 7]].forEach(([dx, up]) => { if (up < prop.height) d.fill(x + dx, base - up, bark); });
          } else {
            d.rect(x - 1, base - prop.height + 1, 3, prop.height, d.raw([110, 100, 120]));
            d.rect(x - 2, base - prop.height, 5, 1, d.raw([140, 128, 152]));
          }
        });
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => {
          const row = d.groundRow(tuft.depth);
          if (tuft.kind === 'wisp') d.fill(x, row, d.raw([220, 200, 255], 0.75));
          else if (tuft.kind === 'bone') d.rect(x, row, 3, 1, d.raw([200, 190, 200]));
          else d.rect(x, row, 2, 1, d.raw([90, 76, 104]));
        });
      }
    },

    sovngarde(d, layout) {
      if (d.layer === 'landmark') {
        // hall of valor and bridge
        const x = layout.hall.x;
        const hall = d.raw([150, 120, 70]);
        d.rect(x - 10, d.horizonRow - 18, 21, 18, d.raw([120, 96, 60]));
        d.roof(x, d.horizonRow - 19, 25, 11, hall);
        d.rect(x - 1, d.horizonRow - 30, 3, 2, d.raw([236, 206, 120]));
        [-6, 0, 6].forEach(dx => d.rect(x + dx, d.horizonRow - 12, 1, 3, d.raw([255, 226, 150])));
        for (let dx = 12; dx < 30; dx += 1) {
          const lift = Math.round(Math.sin(((dx - 12) / 18) * Math.PI) * 4);
          d.fill(x + dx, d.horizonRow - 4 - lift, d.raw([236, 228, 206]));
        }
      } else if (d.layer === 'far') d.ridge(layout.far, d.raw([200, 176, 120], 0.45), d.raw([255, 244, 214], 0.55));
      else if (d.layer === 'near') d.rect(0, d.horizonRow - 2, d.span, 2, d.raw([170, 150, 100], 0.6));
      else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const base = d.horizonRow + 2;
          if (prop.kind === 'stone') {
            d.rect(x - 1, base - prop.height + 1, 3, prop.height, d.raw([140, 132, 118]));
            d.fill(x, base - prop.height + 2, d.raw([236, 206, 120]));
          } else {
            for (let row = 0; row < 4; row += 1) d.rect(x - 3 + row, base - row, 7 - row * 2, 1, d.raw([150, 140, 122]));
          }
        });
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => {
          const row = d.groundRow(tuft.depth);
          if (tuft.kind === 'flower') { d.fill(x, row, d.raw([150, 140, 70])); d.fill(x, row - 1, d.raw([255, 244, 200])); }
          else { d.fill(x, row, d.raw([190, 160, 70])); d.fill(x, row - 1, d.raw([236, 206, 110])); }
        });
      }
    },

    dwemer(d, layout) {
      const brass = d.raw([178, 130, 64]);
      const brassDark = d.raw([120, 86, 44]);
      if (d.layer === 'far') {
        const pipe = d.raw([112, 84, 52], 0.75);
        layout.pipes.forEach(row => {
          d.rect(0, row, d.span, 2, pipe);
          d.rect(0, row, d.span, 1, d.raw([150, 112, 66], 0.75));
        });
        d.each(layout.gears, (gear, cx) => {
          for (let dy = -gear.size; dy <= gear.size; dy += 1) {
            for (let dx = -gear.size; dx <= gear.size; dx += 1) {
              const distance = Math.hypot(dx, dy);
              const tooth = distance > gear.size - 0.6 && Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 2 === 0;
              if (distance <= gear.size - 1 || tooth) d.fill(cx + dx, gear.row + dy, distance < 1.2 ? d.raw([60, 46, 30], 0.8) : pipe);
            }
          }
        });
      } else if (d.layer === 'near') {
        d.each(layout.pillars, (pillar, x) => {
          d.rect(x - 3, 0, 7, d.horizonRow, d.raw([96, 84, 72]));
          d.rect(x + 2, 0, 1, d.horizonRow, d.raw([70, 60, 52]));
          [6, Math.round(d.horizonRow * 0.55), d.horizonRow - 3].forEach(row => {
            d.rect(x - 4, row, 9, 2, brass);
            d.rect(x - 4, row + 1, 9, 1, brassDark);
          });
        });
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const base = d.horizonRow + 2;
          if (prop.kind === 'lamp') {
            d.rect(x, base - 5, 1, 6, brassDark);
            d.rect(x - 1, base - 7, 3, 2, d.raw([255, 228, 156]));
            d.fill(x, base - 8, d.raw([255, 244, 210]));
            d.rect(x - 2, base - 7, 1, 2, d.raw([255, 214, 130], 0.4));
            d.rect(x + 2, base - 7, 1, 2, d.raw([255, 214, 130], 0.4));
          } else {
            d.rect(x - 2, base - 3, 5, 4, brassDark);
            d.rect(x - 2, base - 3, 5, 1, brass);
          }
        });
      } else if (d.layer === 'ground') {
        d.spaced(Math.max(1, Math.round(d.columns / 6)), x => d.rect(x, d.horizonRow + 1, 1, d.bottomRow - d.horizonRow, d.raw([60, 50, 40], 0.7)));
        d.each(layout.tufts, (tuft, x) => {
          const row = d.groundRow(tuft.depth);
          if (tuft.kind === 'rivet') d.fill(x, row, d.raw([196, 150, 80]));
          else { d.rect(x, row, 2, 2, brassDark); d.fill(x, row, d.raw([196, 150, 80])); }
        });
      }
    },

    tomb(d, layout) {
      const stone = d.raw([84, 80, 84]);
      const stoneLit = d.raw([108, 104, 106]);
      const stoneDark = d.raw([58, 55, 60]);
      if (d.layer === 'far') {
        const arch = d.raw([66, 63, 70], 0.85);
        const half = Math.round((d.columns / layout.arches) * 0.32);
        const top = Math.round(d.horizonRow * 0.28);
        d.spaced(layout.arches, cx => {
          for (let row = top; row < d.horizonRow; row += 1) {
            const curve = row < top + half ? Math.round(Math.sqrt(Math.max(0, half * half - (top + half - row) ** 2))) : half;
            for (let dx = -half; dx <= half; dx += 1) if (Math.abs(dx) > curve) d.fill(cx + dx, row, arch);
            d.fill(cx - half - 1, row, arch);
            d.fill(cx + half + 1, row, arch);
          }
          d.rect(cx - half - 1, 0, half * 2 + 3, top, arch);
        });
      } else if (d.layer === 'near') {
        d.each(layout.pillars, (pillar, x) => {
          d.rect(x - 3, 0, 7, d.horizonRow, stone);
          d.rect(x - 3, 0, 1, d.horizonRow, stoneLit);
          d.rect(x + 3, 0, 1, d.horizonRow, stoneDark);
          const band = Math.round(d.horizonRow * 0.45);
          for (let dx = -3; dx <= 3; dx += 1) d.fill(x + dx, band + ((dx + 3) % 2), stoneLit);
          d.rect(x - 3, band + 2, 7, 1, stoneDark);
        });
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const base = d.horizonRow + 2;
          if (prop.kind === 'urn') {
            d.rect(x - 1, base - 3, 3, 4, d.raw([142, 102, 72]));
            d.rect(x - 2, base - 2, 5, 2, d.raw([142, 102, 72]));
            d.fill(x, base - 4, d.raw([110, 78, 56]));
          } else if (prop.kind === 'torch') {
            d.rect(x, base - 9, 1, 5, d.raw([86, 62, 44]));
            d.fill(x, base - 10, d.raw([255, 196, 92]));
            d.rect(x - 1, base - 11, 3, 1, d.raw([246, 128, 48]));
            d.fill(x, base - 12, d.raw([255, 228, 150]));
          } else {
            d.rect(x - 4, base - 3, 9, 4, stone);
            d.rect(x - 4, base - 3, 9, 1, stoneLit);
            d.rect(x - 2, base - 2, 5, 1, stoneDark);
          }
        });
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => {
          const row = d.groundRow(tuft.depth);
          if (tuft.kind === 'bone') { d.rect(x, row, 3, 1, d.raw([214, 204, 180])); d.fill(x - 1, row - 1, d.raw([214, 204, 180])); }
          else if (tuft.kind === 'skull') { d.rect(x, row - 1, 2, 2, d.raw([214, 204, 180])); d.fill(x, row, d.raw([60, 54, 50])); }
          else d.rect(x, row, 2, 1, d.raw([96, 92, 94]));
        });
      }
    },

    cave(d, layout) {
      const rock = d.raw([96, 88, 80]);
      const rockLit = d.raw([128, 118, 106]);
      if (d.layer === 'far') {
        // stalactites
        d.rect(0, 0, d.span, 2, d.raw([70, 64, 58]));
        d.each(layout.drips, (drip, x) => d.spike(x, 2, drip.length + 2, d.raw([84, 77, 70])));
      } else if (d.layer === 'near') {
        d.each(layout.pillars, (pillar, x) => {
          d.spike(x, 0, Math.round(d.horizonRow * 0.45), rock);
          d.spike(x, d.horizonRow + 1, -Math.round(d.horizonRow * 0.4), rockLit);
        });
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const base = d.horizonRow + 2;
          if (prop.kind === 'crystal') {
            [[-1, 4], [0, 6], [1, 3]].forEach(([dx, tall]) => d.spike(x + dx, base, -tall, d.raw([120, 220, 236], 0.9)));
            d.fill(x, base - 4, d.raw([220, 250, 255]));
          } else d.disc(x, base - 1, 2, rockLit);
        });
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => {
          const row = d.groundRow(tuft.depth);
          if (tuft.kind === 'puddle') { d.rect(x, row, 4, 1, d.raw([60, 80, 96])); d.fill(x + 1, row, d.raw([150, 190, 210])); }
          else d.rect(x, row, 2, 1, d.raw([110, 102, 94]));
        });
      }
    },

    // homes and inns share timberRoom
    house(d, layout, options) {
      timberRoom(d, layout, options, false);
    },
    inn(d, layout, options) {
      timberRoom(d, layout, options, true);
    },

    mine(d, layout) {
      if (d.layer === 'far') {
        d.each(layout.veins, (vein, x) => {
          const ore = d.raw([[214, 150, 70], [190, 196, 210], [170, 110, 80]][vein.colour]);
          d.fill(x, vein.row, ore);
          d.fill(x + 1, vein.row + 1, ore);
          d.fill(x - 1, vein.row + 1, d.raw([110, 100, 90]));
        });
      } else if (d.layer === 'near') {
        const timber = d.raw([112, 82, 54]);
        const timberDark = d.raw([84, 60, 40]);
        d.spaced(layout.frames, x => {
          d.rect(x - 6, 2, 2, d.horizonRow, timber);
          d.rect(x + 5, 2, 2, d.horizonRow, timber);
          d.rect(x - 7, 2, 15, 2, timberDark);
        });
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const base = d.horizonRow + 2;
          if (prop.kind === 'cart') {
            d.rect(x - 3, base - 3, 7, 3, d.raw([90, 76, 66]));
            d.rect(x - 3, base - 4, 7, 1, d.raw([150, 120, 80]));
            d.fill(x - 2, base, d.raw([40, 36, 34]));
            d.fill(x + 2, base, d.raw([40, 36, 34]));
          } else if (prop.kind === 'lantern') {
            d.rect(x, base - 8, 1, 9, d.raw([90, 66, 44]));
            d.rect(x - 1, base - 8, 3, 1, d.raw([90, 66, 44]));
            d.fill(x + 1, base - 7, d.raw([255, 210, 120]));
          } else for (let row = 0; row < 3; row += 1) d.rect(x - 2 + row, base - row, 5 - row * 2, 1, d.raw([150, 120, 90]));
        });
      } else if (d.layer === 'ground') {
        // rails
        const railRow = d.horizonRow + 7;
        d.rect(0, railRow, d.span, 1, d.raw([120, 120, 126]));
        d.rect(0, railRow + 3, d.span, 1, d.raw([120, 120, 126]));
        d.spaced(Math.max(1, Math.round(d.columns / 5)), x => d.rect(x, railRow - 1, 2, 6, d.raw([92, 70, 50])));
        d.each(layout.tufts, (tuft, x) => {
          const row = railRow + 6 + Math.round(tuft.depth * 6);
          d.rect(x, row, 2, 1, tuft.kind === 'ore' ? d.raw([200, 150, 80]) : d.raw([104, 96, 88]));
        });
      }
    },

    temple(d, layout) {
      const stone = d.raw([170, 164, 150]);
      const gold = d.raw([214, 178, 90]);
      if (d.layer === 'far') {
        d.spaced(layout.windows, x => {
          d.rect(x - 2, 6, 5, d.horizonRow - 14, d.raw([255, 226, 150], 0.55));
          d.disc(x, 6, 2.5, d.raw([255, 226, 150], 0.55));
          d.rect(x, 6, 1, d.horizonRow - 14, d.raw([150, 120, 70], 0.6));
        });
      } else if (d.layer === 'near') {
        d.spaced(layout.pillars, x => {
          d.rect(x - 2, 0, 5, d.horizonRow, stone);
          d.rect(x - 2, 0, 1, d.horizonRow, d.raw([196, 190, 176]));
          d.rect(x - 3, 3, 7, 2, gold);
          d.rect(x - 3, d.horizonRow - 2, 7, 2, gold);
        });
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const base = d.horizonRow + 2;
          if (prop.kind === 'candles') {
            [[-2, 3], [0, 4], [2, 2]].forEach(([dx, tall]) => {
              d.rect(x + dx, base - tall + 1, 1, tall, d.raw([240, 232, 210]));
              d.fill(x + dx, base - tall, d.raw([255, 200, 90]));
            });
          } else if (prop.kind === 'altar') {
            d.rect(x - 4, base - 3, 9, 4, stone);
            d.rect(x - 4, base - 3, 9, 1, gold);
            d.rect(x - 1, base - 5, 3, 2, gold);
          } else {
            d.rect(x - 1, base - 4, 3, 5, d.raw([120, 100, 70]));
            d.rect(x - 2, base - 6, 5, 2, d.raw([255, 170, 70]));
            d.fill(x, base - 7, d.raw([255, 230, 160]));
          }
        });
      } else if (d.layer === 'ground') {
        d.spaced(Math.max(1, Math.round(d.columns / 4)), x => d.rect(x, d.horizonRow + 1, 1, d.bottomRow - d.horizonRow, d.raw([140, 134, 120], 0.6)));
      }
    },

    vampire(d, layout) {
      if (d.layer === 'far') {
        d.spaced(layout.banners, x => {
          d.rect(x - 2, 4, 5, 16, d.raw([120, 20, 30]));
          d.fill(x - 2, 20, d.raw([120, 20, 30]));
          d.fill(x + 2, 20, d.raw([120, 20, 30]));
          d.rect(x - 3, 3, 7, 1, d.raw([150, 120, 70]));
        });
      } else if (d.layer === 'near') {
        d.each(layout.pillars, (pillar, x) => {
          d.rect(x - 3, 0, 7, d.horizonRow, d.raw([52, 44, 50]));
          d.rect(x - 3, 0, 1, d.horizonRow, d.raw([76, 62, 70]));
        });
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const base = d.horizonRow + 2;
          if (prop.kind === 'coffin') {
            d.rect(x - 4, base - 2, 9, 3, d.raw([70, 40, 36]));
            d.rect(x - 3, base - 3, 7, 1, d.raw([96, 56, 48]));
            d.rect(x - 1, base - 2, 1, 2, d.raw([150, 120, 70]));
          } else {
            d.rect(x, base - 6, 1, 7, d.raw([110, 96, 80]));
            d.rect(x - 2, base - 6, 5, 1, d.raw([110, 96, 80]));
            [-2, 0, 2].forEach(dx => d.fill(x + dx, base - 7, d.raw([255, 110, 90])));
          }
        });
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => {
          const row = d.groundRow(tuft.depth);
          if (tuft.kind === 'blood') d.rect(x, row, 3, 1, d.raw([110, 16, 24]));
          else d.rect(x, row, 3, 1, d.raw([206, 196, 176]));
        });
      }
    },

    falmer(d, layout) {
      if (d.layer === 'far') {
        d.rect(0, 0, d.span, 2, d.raw([30, 40, 52]));
        d.each(layout.drips, (drip, x) => d.spike(x, 2, drip.length + 2, d.raw([42, 56, 70])));
        d.each(layout.glows, (glow, x) => d.fill(x, glow.row, d.raw([110, 200, 255], 0.75)));
      } else if (d.layer === 'near') {
        d.spaced(3, x => d.spike(x, 0, Math.round(d.horizonRow * 0.4), d.raw([46, 60, 74])));
      } else if (d.layer === 'horizon') {
        d.each(layout.props, (prop, x) => {
          const base = d.horizonRow + 2;
          if (prop.kind === 'eggs') {
            [[-2, 0], [0, -1], [2, 0], [1, 1], [-1, 1]].forEach(([dx, dy]) => d.disc(x + dx, base + dy - 1, 1.2, d.raw([196, 214, 110], 0.9)));
          } else {
            for (let row = 0; row < 5; row += 1) d.rect(x - 4 + row, base - row, 9 - row * 2, 1, d.raw([110, 96, 80]));
            d.fill(x, base - 1, d.raw([30, 26, 24]));
          }
        });
      } else if (d.layer === 'ground') {
        d.each(layout.tufts, (tuft, x) => {
          const row = d.groundRow(tuft.depth);
          if (tuft.kind === 'glowshroom') { d.fill(x, row, d.raw([70, 80, 100])); d.fill(x, row - 1, d.raw([110, 210, 255])); }
          else d.rect(x, row, 2, 1, d.raw([60, 70, 84]));
        });
      }
    }
  };

  // windows, posts, hearth and furniture. inns add a bar and lanterns
  function timberRoom(d, layout, options, inn) {
    const plank = d.raw([118, 84, 56]);
    const plankDark = d.raw([92, 64, 42]);
    if (d.layer === 'far') {
      d.spaced(Math.max(1, Math.round(d.columns / 4)), x => d.rect(x, 0, 1, d.horizonRow, plankDark));
      // panes use the outside sky colour
      const skyColours = { dawn: [240, 176, 140], day: [130, 200, 236], sunset: [210, 120, 110], night: [30, 44, 86] };
      const pane = d.raw(skyColours[options.phase] || skyColours.day);
      d.spaced(layout.windows, x => {
        d.rect(x - 4, 6, 9, 9, d.raw([70, 50, 34]));
        d.rect(x - 3, 7, 7, 7, pane);
        d.rect(x, 7, 1, 7, d.raw([70, 50, 34]));
        d.rect(x - 3, 10, 7, 1, d.raw([70, 50, 34]));
        if (options.phase === 'night') d.fill(x - 2, 8, d.raw([240, 220, 200]));
        if (options.weather === 'snow') [[-2, 12], [2, 9]].forEach(([dx, row]) => d.fill(x + dx, row, d.raw([255, 255, 255])));
        if (options.weather === 'rain' || options.weather === 'storm') [[-1, 8], [2, 11]].forEach(([dx, row]) => d.fill(x + dx, row, d.raw([200, 220, 240])));
      });
      if (inn) {
        d.spaced(layout.lanterns, x => {
          d.rect(x, 2, 1, 3, d.raw([60, 44, 30]));
          d.rect(x - 1, 5, 3, 2, d.raw([255, 206, 120]));
        });
      }
    } else if (d.layer === 'near') {
      d.rect(0, 1, d.span, 2, plankDark);
      d.spaced(layout.posts, x => {
        d.rect(x - 1, 0, 3, d.horizonRow, plank);
        d.rect(x - 1, 0, 1, d.horizonRow, d.raw([140, 104, 70]));
      });
    } else if (d.layer === 'horizon') {
      d.each(layout.props, (prop, x) => {
        const base = d.horizonRow + 2;
        if (prop.kind === 'hearth') {
          d.rect(x - 4, base - 7, 9, 8, d.raw([110, 104, 98]));
          d.rect(x - 2, base - 4, 5, 4, d.raw([40, 30, 26]));
          d.rect(x - 1, base - 2, 3, 2, d.raw([246, 128, 48]));
          d.fill(x, base - 3, d.raw([255, 214, 120]));
        } else if (prop.kind === 'table') {
          d.rect(x - 4, base - 3, 9, 1, plank);
          d.rect(x - 3, base - 2, 1, 3, plankDark);
          d.rect(x + 3, base - 2, 1, 3, plankDark);
          d.fill(x, base - 4, d.raw([210, 200, 180]));
        } else if (prop.kind === 'barrel') {
          d.rect(x - 2, base - 4, 5, 5, d.raw([126, 88, 56]));
          d.rect(x - 2, base - 3, 5, 1, d.raw([80, 80, 86]));
          d.rect(x - 2, base - 1, 5, 1, d.raw([80, 80, 86]));
        } else if (prop.kind === 'bar') {
          d.rect(x - 6, base - 4, 13, 5, plankDark);
          d.rect(x - 6, base - 4, 13, 1, plank);
          [-4, -1, 3].forEach(dx => d.rect(x + dx, base - 6, 1, 2, d.raw([200, 180, 120])));
        } else {
          d.rect(x - 3, base - 8, 7, 1, plank);
          d.rect(x - 3, base - 5, 7, 1, plank);
          [-2, 0, 2].forEach(dx => d.fill(x + dx, base - 9, d.raw([[200, 80, 60], [80, 120, 180], [210, 190, 120]][(dx + 2) / 2])));
        }
      });
    } else if (d.layer === 'ground') {
      d.spaced(Math.max(1, Math.round(d.columns / 5)), x => d.rect(x, d.horizonRow + 1, 1, d.bottomRow - d.horizonRow, d.raw([86, 60, 40], 0.7)));
      d.each(layout.tufts, (tuft, x) => {
        const row = d.groundRow(tuft.depth);
        if (tuft.kind === 'rug') d.rect(x, row, 6, 2, d.raw([140, 50, 40]));
        else if (tuft.kind === 'mug') d.rect(x, row - 1, 1, 2, d.raw([170, 150, 110]));
        else d.rect(x, row, 3, 1, d.raw([100, 70, 46]));
      });
    }
  }

  function draw(context, layout, options, shade) {
    const drawer = drawers[layout.region];
    if (!drawer) return;
    drawer(canvasTools(context, layout, options, shade), layout, options);
  }

  return Object.freeze({ info, names: Object.keys(info), build, draw });
});
