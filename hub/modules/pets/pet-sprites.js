(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetSprites = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // Pets are small pixel grids (parts) so css can animate each bit separately.
  // at = position, pivot = rotation origin, shade darkens far limbs, flip mirrors.
  // fx-* parts don't count towards centering.
  const PIXEL = 6;
  const ROLES = Object.freeze([
    'static', 'body', 'head', 'eyes', 'glow-eye', 'tail', 'sway', 'ear', 'leg-a', 'leg-b',
    'arm-a', 'arm-b', 'wing-a', 'wing-b', 'claw-a', 'claw-b', 'fx-combat', 'fx-glow'
  ]);

  // layers are [radius, char, dx, dy], first match wins so put highlights first
  function disc(size, layers) {
    const rows = [];
    const centre = (size - 1) / 2;
    for (let y = 0; y < size; y += 1) {
      let row = '';
      for (let x = 0; x < size; x += 1) {
        const hit = layers.find(([radius, , dx = 0, dy = 0]) => Math.hypot(x - centre - dx, y - centre - dy) <= radius);
        row += hit ? hit[1] : '.';
      }
      rows.push(row);
    }
    return rows;
  }

  // sun halo rays
  function rays(size, inner, outer, glow) {
    const rows = [];
    const centre = (size - 1) / 2;
    for (let y = 0; y < size; y += 1) {
      let row = '';
      for (let x = 0; x < size; x += 1) {
        const distance = Math.hypot(x - centre, y - centre);
        const angle = Math.atan2(y - centre, x - centre);
        const offset = Math.abs(((angle / (Math.PI / 4)) % 1 + 1) % 1 - 0.5);
        if (distance >= inner && distance <= outer && offset > 0.38) row += 'r';
        else if (distance <= glow) row += 'a';
        else row += '.';
      }
      rows.push(row);
    }
    return rows;
  }

  const dragonParts = [
    { name: 'wing-far', role: 'wing-b', at: [7, 2], pivot: [9, 7], shade: 0.72, rows: [
      'kk.........',
      'khk....kk..',
      'kwwk..kwk..',
      'kwwwk.kwwk.',
      '.kwwwkwwwkk',
      '.kwwwwwwwgk',
      '..kwwwwwggk',
      '...kkwwgggk',
      '.....kkkkk.'
    ] },
    { name: 'tail', role: 'tail', at: [0, 15], pivot: [10, 3], rows: [
      'kk.........',
      'khkk.......',
      'kkhgkkkkk..',
      '.kkgglllllk',
      '...kGGggggk',
      '....kkkkkk.'
    ] },
    { name: 'leg-far-back', role: 'leg-b', at: [12, 18], pivot: [2, 0], shade: 0.7, rows: ['.kgk.', '.kGk.', 'kGGgk', 'khkhk'] },
    { name: 'leg-far-front', role: 'leg-a', at: [20, 18], pivot: [2, 0], shade: 0.7, rows: ['.kgk.', '.kGk.', 'kGGgk', 'khkhk'] },
    { name: 'body', role: 'body', at: [9, 12], rows: [
      '...kkkkkkk..',
      '.kkglllgggk.',
      'kgglllggggbk',
      'kggggggggbbk',
      'kGgggggggbBk',
      'kGGgggggbbBk',
      '.kGGggggbBk.',
      '..kkkkkkkk..'
    ] },
    { name: 'wing-near', role: 'wing-a', at: [10, 4], pivot: [9, 7], rows: [
      'kk.........',
      'khk....kk..',
      'kwwk..kwk..',
      'kwwwk.kwwk.',
      '.kwwwkwwwkk',
      '.kwwwwwwwgk',
      '..kwwwwwggk',
      '...kkwwgggk',
      '.....kkkkk.'
    ] },
    { name: 'leg-back', role: 'leg-a', at: [10, 18], pivot: [2, 0], rows: ['.kgk.', '.kGk.', 'kGGgk', 'khkhk'] },
    { name: 'leg-front', role: 'leg-b', at: [17, 18], pivot: [2, 0], rows: ['.kgk.', '.kGk.', 'kGGgk', 'khkhk'] },
    { name: 'head', role: 'head', at: [17, 5], pivot: [3, 8], rows: [
      '.kk...kk.....',
      'khhk.khhk....',
      '.khhkkhhk....',
      '..kgglllgk...',
      '.kgglllllgkk.',
      '.kgggggggglgk',
      '.kGgggggggggk',
      '.kGGgggkkkkkk',
      '..kGGbhbhbk..',
      '...kkkkkkk...'
    ], children: [
      { name: 'eyes', role: 'eyes', at: [6, 4], pivot: [1, 1], rows: ['se', 'ek'] }
    ] },
    { name: 'fire', role: 'fx-combat', at: [30, 10], pivot: [0, 2], rows: [
      '..rr.rr.',
      '.rffrffr',
      'rfyyyyfr',
      '.rfyyfr.',
      '..rrrr..'
    ] }
  ];

  const furLeg = ['kbk', 'kBk', 'kpk'];
  const spiderLegHigh = [
    '.....kkk.',
    '...kkbbbk',
    '.kkbbkkbk',
    'kbbkk.kbk',
    'kkk...kbk',
    '......kbk',
    '......kk.'
  ];
  const spiderLegLow = [
    'kkkk...',
    'kbbbkk.',
    '.kkkbbk',
    '....kbk',
    '....kk.'
  ];

  function spiderLegs() {
    return [
      { name: 'leg-left-1', role: 'leg-a', at: [0, 4], pivot: [9, 3], flip: true, rows: spiderLegHigh },
      { name: 'leg-left-2', role: 'leg-b', at: [0, 7], pivot: [9, 3], flip: true, shade: 0.8, rows: spiderLegHigh },
      { name: 'leg-left-3', role: 'leg-a', at: [2, 10], pivot: [7, 1], flip: true, rows: spiderLegLow },
      { name: 'leg-left-4', role: 'leg-b', at: [3, 12], pivot: [7, 1], flip: true, shade: 0.8, rows: spiderLegLow },
      { name: 'leg-right-1', role: 'leg-b', at: [21, 4], pivot: [0, 3], rows: spiderLegHigh },
      { name: 'leg-right-2', role: 'leg-a', at: [21, 7], pivot: [0, 3], shade: 0.8, rows: spiderLegHigh },
      { name: 'leg-right-3', role: 'leg-b', at: [21, 10], pivot: [0, 1], rows: spiderLegLow },
      { name: 'leg-right-4', role: 'leg-a', at: [20, 12], pivot: [0, 1], shade: 0.8, rows: spiderLegLow }
    ];
  }

  const pets = {
    dovahmin: {
      archetype: 'flyer',
      palette: { k: '#1b1a22', g: '#467552', G: '#2c4c37', l: '#79a86a', b: '#dcbc7e', B: '#b08d55', h: '#ece2c4', w: '#7fb7a8', s: '#ffffff', e: '#ffd45a', r: '#8d3826', f: '#f08a3a', y: '#ffd65c' },
      parts: dragonParts
    },
    dovahpink: {
      archetype: 'flyer',
      palette: { k: '#2a1624', g: '#d0679c', G: '#9c3f6f', l: '#f59cc4', b: '#ffe0ea', B: '#e8a9c0', h: '#fff4d6', w: '#f7bdd9', s: '#ffffff', e: '#7fe1ff', r: '#9c2f6a', f: '#ff8fc8', y: '#ffe3f2' },
      parts: dragonParts
    },
    mudcrab: {
      archetype: 'light',
      palette: { k: '#141518', r: '#5c5f64', R: '#3b3d42', l: '#8d9094', c: '#53565c', C: '#34363b', e: '#f3e6c4', s: '#ffffff', p: '#1c1412' },
      parts: [
        { name: 'leg-left-back', role: 'leg-a', at: [4, 13], pivot: [1, 0], rows: ['kRk', 'kRk', '.k.'] },
        { name: 'leg-left-front', role: 'leg-b', at: [7, 13], pivot: [1, 0], rows: ['kRk', 'kRk', '.k.'] },
        { name: 'leg-right-front', role: 'leg-a', at: [14, 13], pivot: [1, 0], rows: ['kRk', 'kRk', '.k.'] },
        { name: 'leg-right-back', role: 'leg-b', at: [17, 13], pivot: [1, 0], rows: ['kRk', 'kRk', '.k.'] },
        { name: 'eye-stalks', role: 'head', at: [7, 3], pivot: [5, 5], rows: [
          '.kk....kk.',
          'kesk..kesk',
          'kepk..kepk',
          '.kRk...kRk',
          '.kRk...kRk'
        ] },
        { name: 'shell', role: 'body', at: [3, 8], rows: [
          '.....kkkkkkkk.....',
          '...kkrllllrrrkk...',
          '.kkrrlllrrrrrrrkk.',
          'krrrrrrrrrrrrrrrrk',
          'kRrrrrrkkrrrrrrrRk',
          '.kRRRrrrrrrrrRRRk.',
          '..kkkkkkkkkkkkkk..'
        ] },
        { name: 'claw-left', role: 'claw-b', at: [-1, 4], pivot: [4, 7], flip: true, rows: [
          '.kk.kk.', 'kllkcck', 'kclkcCk', 'kcckcCk', 'kccccCk', '.kcccCk', '..kcCk.', '..kCk..'
        ] },
        { name: 'claw-right', role: 'claw-a', at: [18, 4], pivot: [3, 7], rows: [
          '.kk.kk.', 'kllkcck', 'kclkcCk', 'kcckcCk', 'kccccCk', '.kcccCk', '..kcCk.', '..kCk..'
        ] }
      ]
    },
    skeever: {
      archetype: 'light',
      palette: { k: '#241a17', b: '#7a5a45', B: '#563f31', l: '#a37e5f', p: '#e39a9a', P: '#b86e70', e: '#e04a3a', s: '#ffd6cf', t: '#f2ead2' },
      parts: [
        { name: 'tail', role: 'tail', at: [0, 10], pivot: [8, 4], rows: [
          'kk.......', 'kpk......', '.kpk.....', '..kpPkkkk', '...kkpppp', '.....kkkk'
        ] },
        { name: 'leg-far-back', role: 'leg-b', at: [10, 14], pivot: [1, 0], shade: 0.7, rows: furLeg },
        { name: 'leg-far-front', role: 'leg-a', at: [18, 14], pivot: [1, 0], shade: 0.7, rows: furLeg },
        { name: 'body', role: 'body', at: [6, 9], rows: [
          '...kkkkkkk....',
          '.kkbllllbbkk..',
          'kbbbllbbbbbbk.',
          'kBbbbbbbbbbbbk',
          'kBBbbbbbbbbbbk',
          '.kBBBbbbbbbBk.',
          '..kkkkkkkkkk..'
        ] },
        { name: 'leg-back', role: 'leg-a', at: [8, 14], pivot: [1, 0], rows: furLeg },
        { name: 'leg-front', role: 'leg-b', at: [16, 14], pivot: [1, 0], rows: furLeg },
        { name: 'head', role: 'head', at: [17, 4], pivot: [2, 6], rows: [
          '.kk.kk....',
          'kppkppk...',
          'kpPkpPk...',
          '.kbbbbbk..',
          '.kblbbbbkk',
          '.kbbbbbbbp',
          '..kBbbkkk.',
          '...kktk...'
        ], children: [
          { name: 'eyes', role: 'eyes', at: [5, 3], pivot: [1, 1], rows: ['se', 'ek'] }
        ] }
      ]
    },
    fox: {
      archetype: 'light',
      palette: { k: '#2b1b17', o: '#d8662c', O: '#a8461f', l: '#f08c45', w: '#f7e8cc', W: '#d9c4a2', b: '#3a2620', e: '#2b1b17', s: '#ffffff' },
      parts: [
        { name: 'tail', role: 'tail', at: [0, 5], pivot: [8, 7], rows: [
          '.kkk.....',
          'kwwwk....',
          'kwwwok...',
          '.kwoook..',
          '..kooook.',
          '..kOoolk.',
          '...kOoook',
          '....kOook',
          '.....kkk.'
        ] },
        { name: 'leg-far-back', role: 'leg-b', at: [11, 15], pivot: [1, 0], shade: 0.72, rows: ['kok', 'kbk', 'kbk'] },
        { name: 'leg-far-front', role: 'leg-a', at: [18, 15], pivot: [1, 0], shade: 0.72, rows: ['kok', 'kbk', 'kbk'] },
        { name: 'body', role: 'body', at: [7, 9], rows: [
          '...kkkkkkk....',
          '.kkollllookk..',
          'kooollooooook.',
          'kOooooooooowwk',
          'kOOoooooooowwk',
          '.kOOOooooowwk.',
          '..kkkkkkkkkk..'
        ] },
        { name: 'leg-back', role: 'leg-a', at: [9, 15], pivot: [1, 0], rows: ['kok', 'kbk', 'kbk'] },
        { name: 'leg-front', role: 'leg-b', at: [16, 15], pivot: [1, 0], rows: ['kok', 'kbk', 'kbk'] },
        { name: 'head', role: 'head', at: [17, 2], pivot: [3, 8], rows: [
          '.k....k......',
          'kbk..kbk.....',
          'kobk.kobk....',
          'koOkkkoOk....',
          '.kooooooook..',
          '.kolooooooook',
          '.kwwoooowwwbk',
          '..kwwwwwwwkk.',
          '...kkkkkkk...'
        ], children: [
          { name: 'eyes', role: 'eyes', at: [7, 4], pivot: [1, 1], rows: ['es', 'ee'] }
        ] }
      ]
    },
    sabrecat: {
      archetype: 'light',
      palette: { k: '#241b16', t: '#c8955a', T: '#96693d', l: '#e6bb7f', s: '#5a3a24', w: '#f3e3c3', f: '#f7f0dc', e: '#e9c13c', n: '#c4706a' },
      parts: [
        { name: 'tail', role: 'tail', at: [0, 6], pivot: [8, 6], rows: [
          'kk.......', 'ksk......', 'kTk......', 'kstk.....', '.ktsk....', '..kttskkk', '...kkttTt', '.....kkkk'
        ] },
        { name: 'leg-far-back', role: 'leg-b', at: [10, 13], pivot: [2, 0], shade: 0.72, rows: ['kttk', 'kttk', 'kTtk', 'kwwk'] },
        { name: 'leg-far-front', role: 'leg-a', at: [20, 13], pivot: [2, 0], shade: 0.72, rows: ['kttk', 'kttk', 'kTtk', 'kwwk'] },
        { name: 'body', role: 'body', at: [5, 8], rows: [
          '...kkkkkkkkk....',
          '.kktllstllstkk..',
          'kttsltsttsttttk.',
          'kTtstttsttsttwwk',
          'kTTstttsttttwwwk',
          '.kTTTttttttwwwk.',
          '..kkkkkkkkkkkk..'
        ] },
        { name: 'leg-back', role: 'leg-a', at: [7, 13], pivot: [2, 0], rows: ['kttk', 'kttk', 'kTtk', 'kwwk'] },
        { name: 'leg-front', role: 'leg-b', at: [17, 13], pivot: [2, 0], rows: ['kttk', 'kttk', 'kTtk', 'kwwk'] },
        { name: 'head', role: 'head', at: [17, 2], pivot: [3, 8], rows: [
          '.kk....kk...',
          'ktlk..ktlk..',
          'kttkkkkttk..',
          '.kttllltttk.',
          '.ktsttttttk.',
          '.kttttttwwwk',
          '.kTtttwwwwnk',
          '..kTTwwwwkk.',
          '...kkkfkfk..',
          '......f.f...'
        ], children: [
          { name: 'eyes', role: 'eyes', at: [6, 4], pivot: [1, 1], rows: ['ek', 'ek'] }
        ] }
      ]
    },
    'frostbite-spider': {
      archetype: 'light',
      palette: { k: '#1b1622', b: '#5a3f5e', B: '#3d2a42', l: '#8f6a93', w: '#d7e8ef', e: '#ff7aa8', f: '#e8e0d0' },
      parts: [
        ...spiderLegs(),
        { name: 'abdomen', role: 'body', at: [8, 3], rows: [
          '....kkkkkk....',
          '..kkbllllbkk..',
          '.kbblllbbbbbk.',
          'kbbbwbbbbwbbbk',
          'kbbwwwbbwwwbbk',
          'kBbbwbbbbwbbBk',
          'kBBbbbbbbbbBBk',
          '.kBBbbbbbbBBk.',
          '..kkBBBBBBkk..',
          '....kkkkkk....'
        ] },
        { name: 'head', role: 'head', at: [10, 10], pivot: [5, 5], rows: [
          '..kkkkkk..',
          '.kbbbbbbk.',
          'kbbbbbbbbk',
          'kbBbbbbBbk',
          '.kkfkkfkk.',
          '...f..f...'
        ], children: [
          { name: 'eyes', role: 'glow-eye', at: [2, 1], rows: ['e.ee.e', '.e..e.'] }
        ] }
      ]
    },
    horker: {
      archetype: 'heavy',
      palette: { k: '#22232a', g: '#7d7a80', G: '#57555c', l: '#a9a5a8', w: '#f2e7c6', W: '#c9bd9b', n: '#2e2e35', e: '#15151a', s: '#ffffff' },
      parts: [
        { name: 'tail-flipper', role: 'tail', at: [0, 13], pivot: [4, 1], rows: ['.kGk.', 'kGGGk', 'kkkkk'] },
        { name: 'body', role: 'body', at: [2, 6], rows: [
          '.....kkkkkkkk.....',
          '...kkglllllgggkk..',
          '..kgglllgggggggk..',
          '.kgggggggggggggggk',
          'kggggggggggggggggk',
          'kGgggggggggggggggk',
          'kGGgggggggggggggGk',
          '.kGGGggggggggggGk.',
          '..kkkkkkkkkkkkkk..'
        ] },
        { name: 'flipper', role: 'leg-a', at: [12, 13], pivot: [1, 0], rows: ['kGGk.', 'kGGGk', '.kkkk'] },
        { name: 'head', role: 'head', at: [15, 3], pivot: [3, 8], rows: [
          '..kkkkkk...',
          '.kglllggk..',
          'kgggggggggk',
          'kggggggggnk',
          'kgggggggggk',
          '.kgWWggWWk.',
          '..kwkkkwk..',
          '..kwk.kwk..',
          '...k...k...'
        ], children: [
          { name: 'eyes', role: 'eyes', at: [3, 2], pivot: [2, 1], rows: ['s...s', 'e...e'] }
        ] }
      ]
    },
    troll: {
      archetype: 'heavy',
      palette: { k: '#1f2219', f: '#7c8a6a', F: '#56624a', l: '#a5b38c', s: '#a99d84', S: '#776d5a', e: '#f2c94c', m: '#3a1f1a', t: '#efe6c8' },
      parts: [
        { name: 'leg-left', role: 'leg-a', at: [8, 16], pivot: [2, 0], rows: ['kFFk', 'kFFk', 'kkkk'] },
        { name: 'leg-right', role: 'leg-b', at: [14, 16], pivot: [2, 0], rows: ['kFFk', 'kFFk', 'kkkk'] },
        { name: 'arm-left', role: 'arm-b', at: [3, 10], pivot: [2, 0], flip: true, rows: [
          '.kk.', 'kffk', 'kfFk', 'kfFk', 'kfFk', 'kFFk', 'kssk', 'kSSk', '.kk.'
        ] },
        { name: 'torso', role: 'body', at: [6, 9], rows: [
          '...kkkkkkkk...',
          '.kkflllllffkk.',
          'kfffllffffffFk',
          'kffssssssssfFk',
          'kfFsssssssSfFk',
          'kfFSssssssSFFk',
          '.kFFSSSSSSFFk.',
          '..kkkkkkkkkk..'
        ] },
        { name: 'arm-right', role: 'arm-a', at: [17, 10], pivot: [1, 0], rows: [
          '.kk.', 'kffk', 'kfFk', 'kfFk', 'kfFk', 'kFFk', 'kssk', 'kSSk', '.kk.'
        ] },
        { name: 'head', role: 'head', at: [8, 2], pivot: [5, 8], rows: [
          '..kkkkkk..',
          '.kfllllfk.',
          'kffsssssfk',
          'kfssssssfk',
          'kfssssssfk',
          'kfsmmmmsfk',
          '.kstmmtsk.',
          '..kkkkkk..'
        ], children: [
          { name: 'eyes', role: 'eyes', at: [2, 2], pivot: [3, 1], rows: ['..ek..', 'ek..ek'] }
        ] }
      ]
    },
    'flame-atronach': {
      archetype: 'hover',
      palette: { k: '#4a1810', r: '#c4401f', o: '#f07a2e', y: '#ffcf4a', w: '#fff4c0', d: '#2a1a18', D: '#4a3028', e: '#fff7d0' },
      parts: [
        { name: 'flame-hair', role: 'fx-glow', at: [9, 0], pivot: [6, 7], rows: [
          '..k...k...k.',
          '.kok.kok.kok',
          '.koykkoykkoy',
          'kooyyooyyook',
          'koyyyyyyyyok',
          'kooyyyyyyook',
          '.kooooooook.'
        ] },
        { name: 'arm-left', role: 'arm-b', at: [7, 10], pivot: [3, 0], flip: true, rows: ['kk..', 'kok.', 'kyok', '.kyk', '..kk'] },
        { name: 'torso', role: 'body', at: [10, 9], rows: [
          '..kkkkkk..',
          '.kddDDddk.',
          'koddddddok',
          'kyoddddoyk',
          '.kyoddoyk.',
          '..kyooyk..',
          '..kyyyyk..',
          '...kyyk...',
          '....kk....'
        ] },
        { name: 'arm-right', role: 'arm-a', at: [19, 10], pivot: [0, 0], rows: ['kk..', 'kok.', 'kyok', '.kyk', '..kk'] },
        { name: 'head', role: 'head', at: [11, 4], pivot: [4, 6], rows: [
          '.kkkkkk.',
          'kdDDDDdk',
          'kddddddk',
          'kddddddk',
          '.kdDDdk.',
          '..kkkk..'
        ], children: [
          { name: 'eyes', role: 'glow-eye', at: [2, 2], rows: ['ee.ee'] }
        ] },
        { name: 'fireball', role: 'fx-combat', at: [22, 8], pivot: [2, 2], rows: ['.kkk.', 'kyyok', 'kywyk', 'koyyk', '.kkk.'] }
      ]
    },
    'frost-atronach': {
      archetype: 'heavy',
      palette: { k: '#1f3e57', i: '#8fd3e8', I: '#5aa3c4', w: '#e8fbff', d: '#3f7fa3', E: '#66e0ff' },
      parts: [
        { name: 'leg-left', role: 'leg-a', at: [8, 15], pivot: [2, 0], rows: ['kIIk', 'kIIk', 'kkkk'] },
        { name: 'leg-right', role: 'leg-b', at: [14, 15], pivot: [2, 0], rows: ['kIIk', 'kIIk', 'kkkk'] },
        { name: 'arm-left', role: 'arm-b', at: [1, 9], pivot: [3, 0], flip: true, rows: [
          '.kk..', 'kiik.', 'kiIk.', 'kiIk.', 'kiiIk', 'kwiIk', 'kiIIk', '.kkk.'
        ] },
        { name: 'torso', role: 'body', at: [5, 7], rows: [
          '.kk..........kk.',
          'kwik........kiwk',
          'kwiikkkkkkkkiiwk',
          'kiiiwwiiiiwwiiik',
          'kIiiiwiiiiwiiiIk',
          'kIIiiiiddiiiiIIk',
          '.kIIiiddddiiIIk.',
          '..kIIddddddIIk..',
          '...kkkkkkkkkk...'
        ] },
        { name: 'arm-right', role: 'arm-a', at: [19, 9], pivot: [1, 0], rows: [
          '.kk..', 'kiik.', 'kiIk.', 'kiIk.', 'kiiIk', 'kwiIk', 'kiIIk', '.kkk.'
        ] },
        { name: 'head', role: 'head', at: [9, 3], pivot: [4, 6], rows: [
          '..kkkk..',
          '.kwwiik.',
          'kwiiiiik',
          'kiiiiiIk',
          'kIiiiIIk',
          '.kkkkkk.'
        ], children: [
          { name: 'eyes', role: 'glow-eye', at: [2, 2], rows: ['E..E'] }
        ] },
        { name: 'frost', role: 'fx-combat', at: [22, 6], pivot: [0, 3], rows: ['..w..', '.wiw.', 'wiEiw', '.wiw.', '..w..'] }
      ]
    },
    spriggan: {
      archetype: 'light',
      palette: { k: '#2a2216', b: '#7a5a3a', B: '#54402a', l: '#a07a50', g: '#6fae4a', G: '#4a7d32', L: '#a6d56a', e: '#d9ff7a' },
      parts: [
        { name: 'leg-left', role: 'leg-a', at: [10, 14], pivot: [1, 0], rows: ['kbk', 'kbk', 'kBk', 'kBk', 'kkk'] },
        { name: 'leg-right', role: 'leg-b', at: [13, 14], pivot: [1, 0], rows: ['kbk', 'kbk', 'kBk', 'kBk', 'kkk'] },
        { name: 'arm-left', role: 'arm-b', at: [5, 9], pivot: [4, 0], flip: true, rows: ['kk...', 'kbk..', '.kbk.', '..kbk', '..kBk', '.kgGk', '..kk.'] },
        { name: 'torso', role: 'body', at: [9, 9], rows: [
          '.kkkkkk.',
          'kbbglbbk',
          'kbbbgbbk',
          'kBbbbbBk',
          '.kbbbbk.',
          '.kbBBbk.'
        ] },
        { name: 'arm-right', role: 'arm-a', at: [16, 9], pivot: [0, 0], rows: ['kk...', 'kbk..', '.kbk.', '..kbk', '..kBk', '.kgGk', '..kk.'] },
        { name: 'crown', role: 'sway', at: [6, 0], pivot: [7, 5], rows: [
          '..kk...kk..kk.',
          '.kLgk.kLgk.kgk',
          'kLgggkLgggkggk',
          'kggGggggGgggGk',
          '.kGGgggGGgggk.',
          '..kkkkkkkkkk..'
        ] },
        { name: 'head', role: 'head', at: [9, 4], pivot: [4, 6], rows: [
          '.kkkkkk.',
          'kblllbbk',
          'kbbbbbbk',
          'kBbbbbBk',
          '.kBbbBk.',
          '..kbbk..'
        ], children: [
          { name: 'eyes', role: 'glow-eye', at: [2, 2], rows: ['e..e', 'e..e'] }
        ] }
      ]
    },
    'dwarven-spider': {
      archetype: 'light',
      palette: { k: '#2a1d14', b: '#b8823f', B: '#82552a', l: '#e3b35e', e: '#6fe3ff', E: '#c9f6ff' },
      parts: [
        ...spiderLegs(),
        { name: 'dome', role: 'body', at: [8, 5], rows: [
          '....kkkkkk....',
          '..kklllllbkk..',
          '.kbllbbbbbbbk.',
          'kbbbbkkkkbbbbk',
          'kbbbkeEeekbbbk',
          'kbbbkeeeekbbbk',
          'kBbbbkkkkbbbBk',
          'kkkkkkkkkkkkkk',
          '.kBBBBBBBBBBk.',
          '..kkkkkkkkkk..'
        ], children: [
          { name: 'eye', role: 'glow-eye', at: [5, 4], rows: ['eEee', 'eeee'] }
        ] }
      ]
    },
    chaurus: {
      archetype: 'light',
      palette: { k: '#1d2416', c: '#7d8f3e', C: '#55652a', l: '#b5c766', u: '#c9b98a', e: '#f2df6d', m: '#e6d9b0' },
      parts: [
        { name: 'leg-far-1', role: 'leg-b', at: [6, 14], pivot: [1, 0], shade: 0.7, rows: ['.kk', 'kCk', 'k..'] },
        { name: 'leg-far-2', role: 'leg-a', at: [11, 14], pivot: [1, 0], shade: 0.7, rows: ['.kk', 'kCk', 'k..'] },
        { name: 'leg-far-3', role: 'leg-b', at: [16, 14], pivot: [1, 0], shade: 0.7, rows: ['.kk', 'kCk', 'k..'] },
        { name: 'shell', role: 'body', at: [2, 8], rows: [
          '....kkkkkkkkkk....',
          '..kkllllkllllkkk..',
          '.kcccccckcccckcck.',
          'kccccccckcccckccck',
          'kCcccccckCccckCcck',
          'kCCccccckCCcckCCck',
          '.kuuuuuuuuuuuuuuk.',
          '..kkkkkkkkkkkkkk..'
        ] },
        { name: 'leg-1', role: 'leg-a', at: [4, 14], pivot: [1, 0], rows: ['.kk', 'kCk', 'k..'] },
        { name: 'leg-2', role: 'leg-b', at: [9, 14], pivot: [1, 0], rows: ['.kk', 'kCk', 'k..'] },
        { name: 'leg-3', role: 'leg-a', at: [14, 14], pivot: [1, 0], rows: ['.kk', 'kCk', 'k..'] },
        { name: 'antennae', role: 'sway', at: [17, 2], pivot: [2, 4], rows: ['..kk..kk', '.k...k..', '.k...k..', '..k...k.'] },
        { name: 'head', role: 'head', at: [17, 6], pivot: [1, 4], rows: [
          '.kkkkk..',
          'kcllcck.',
          'kcccccck',
          'kCccccck',
          '.kCCcckm',
          '..kkkkmm',
          '.....km.'
        ], children: [
          { name: 'eyes', role: 'eyes', at: [4, 2], pivot: [1, 1], rows: ['ee', 'ek'] }
        ] }
      ]
    },
    netch: {
      archetype: 'hover',
      palette: { k: '#3b223b', p: '#a5629b', P: '#77446f', l: '#d9a0c9', w: '#f6dcef', t: '#8a527f', s: '#ffffff', e: '#2a1428' },
      parts: [
        { name: 'tentacle-1', role: 'leg-a', at: [6, 9], pivot: [1, 0], rows: ['kpk', 'ktk', 'ktk', '.kt', '.kt', 'kt.', 'kt.', 'k..'] },
        { name: 'tentacle-2', role: 'leg-b', at: [10, 9], pivot: [1, 0], rows: ['kpk', 'ktk', 'kt.', 'kt.', '.kt', '.kt', '..k'] },
        { name: 'tentacle-3', role: 'leg-a', at: [14, 9], pivot: [1, 0], rows: ['kpk', 'ktk', 'ktk', '.kt', '.kt', 'kt.', 'k..'] },
        { name: 'bladder', role: 'body', at: [4, 0], rows: [
          '....kkkkkkkk....',
          '..kkllllpppppkk.',
          '.kplwwllpppppppk',
          'kpplwllpppppppPk',
          'kppllppppppppPPk',
          'kpppppppppppPPPk',
          'kPpppppppppPPPPk',
          '.kPPpppppppPPPk.',
          '..kkPPPPPPPPkk..',
          '....kkkkkkkk....'
        ], children: [
          { name: 'eyes', role: 'eyes', at: [5, 4], pivot: [3, 1], rows: ['sk..sk', 'kk..kk'] }
        ] }
      ]
    },
    mammoth: {
      archetype: 'heavy',
      palette: { k: '#241d1c', b: '#8a6a4e', B: '#604836', l: '#b9946b', w: '#f2e7c6', W: '#c9bd9b', s: '#ffffff' },
      parts: [
        { name: 'leg-far-back', role: 'leg-b', at: [7, 13], pivot: [2, 0], shade: 0.72, rows: ['kbbk', 'kBbk', 'kBBk', 'kwwk'] },
        { name: 'leg-far-front', role: 'leg-a', at: [17, 13], pivot: [2, 0], shade: 0.72, rows: ['kbbk', 'kBbk', 'kBBk', 'kwwk'] },
        { name: 'tail', role: 'tail', at: [0, 7], pivot: [2, 0], rows: ['.kk', 'kbk', 'kBk', 'kkk'] },
        { name: 'body', role: 'body', at: [1, 5], rows: [
          '.....kkkkkkkkk......',
          '...kkbllllbbbbkk....',
          '..kbblllbbbbbbbbkk..',
          '.kbbbbbbbbbbbbbbbbk.',
          'kbbbbbbbbbbbbbbbbbbk',
          'kBbbbbbbbbbbbbbbbbbk',
          'kBBbbbbbbbbbbbbbbbBk',
          'kBBBbbbbbbbbbbbbbBBk',
          '.kBkBBbBbbbBbbBbBBk.',
          '..kkkkkkkkkkkkkkkk..'
        ] },
        { name: 'leg-back', role: 'leg-a', at: [4, 13], pivot: [2, 0], rows: ['kbbk', 'kBbk', 'kBBk', 'kwwk'] },
        { name: 'leg-front', role: 'leg-b', at: [14, 13], pivot: [2, 0], rows: ['kbbk', 'kBbk', 'kBBk', 'kwwk'] },
        { name: 'tusk', role: 'static', at: [19, 9], rows: ['.....k', 'kk..kw', 'kwwwwk', '.kkkk.'] },
        { name: 'head', role: 'head', at: [16, 2], pivot: [3, 9], rows: [
          '...kkkkk...',
          '..kbllllk..',
          '.kbbbbbbbk.',
          '.kbbbbbbbbk',
          '.kBbbbbbbbk',
          '..kBbbbbbbk',
          '...kBbbbbk.',
          '....kkkbbk.',
          '......kbbk.',
          '......kbk..',
          '......kbk..',
          '.......kbk.',
          '........kk.'
        ], children: [
          { name: 'ear', role: 'ear', at: [2, 2], pivot: [3, 0], rows: ['kkk.', 'kBBk', 'kBBk', 'kBk.', '.k..'] },
          { name: 'eyes', role: 'eyes', at: [7, 3], pivot: [1, 0], rows: ['sk'] }
        ] }
      ]
    },
    'dragon-priest': {
      archetype: 'hover',
      palette: { k: '#17151a', r: '#4a4560', R: '#322e44', l: '#6c6688', m: '#d6a84a', M: '#a07a2c', y: '#ffe08a', w: '#fff8d8', e: '#ff8a5c', s: '#7a5a3a', o: '#ff9a3a' },
      parts: [
        { name: 'staff', role: 'static', at: [21, 2], rows: [
          'kkk', 'kyk', 'kyk', 'kkk', 'ksk', 'ksk', 'ksk', 'ksk', 'ksk', 'ksk', 'ksk', 'ksk', 'ksk', 'ksk', 'ksk', 'ksk', '.k.'
        ] },
        { name: 'robe', role: 'body', at: [8, 9], rows: [
          '..kkkkkkkk..',
          '.krllllrrrk.',
          'krrlllrrrrRk',
          'krrrrrrrrrRk',
          'kRrrrrrrrRRk',
          'kRrrryyrrRRk',
          'kRrrrrrrrRRk',
          'kRRrrrrrRRRk',
          '.kRRrrrrRRk.',
          '.kRkRrrRkRk.',
          '..k.kRRk.k..',
          '.....kk.....'
        ] },
        { name: 'arm', role: 'arm-a', at: [18, 10], pivot: [0, 1], rows: ['kkk.', 'krRk', 'kRmk', '.kk.'] },
        { name: 'head', role: 'head', at: [9, 1], pivot: [5, 8], rows: [
          '...kkkk...',
          '..krrrrk..',
          '.krrmmrrk.',
          'krrmyymmrk',
          'krmmmmmmrk',
          'krmMmmMmrk',
          'krmmmmmmrk',
          '.krmMMmrk.',
          '..kkmmkk..'
        ], children: [
          { name: 'eyes', role: 'glow-eye', at: [3, 5], rows: ['e..e'] }
        ] },
        { name: 'orb', role: 'fx-combat', at: [19, 0], pivot: [3, 3], rows: [
          '..ooo..', '.oyyyo.', 'oyywyyo', 'oywwwyo', 'oyywyyo', '.oyyyo.', '..ooo..'
        ] }
      ]
    },
    wisp: {
      archetype: 'hover',
      palette: { k: '#2f6a86', b: '#9eeaff', y: '#fff6a8', w: '#ffffff', e: '#16354a', t: '#79d9ea', g: 'rgba(170, 240, 255, .38)', G: 'rgba(170, 240, 255, .18)' },
      parts: [
        { name: 'halo', role: 'fx-glow', at: [0, 0], pivot: [9, 9], rows: disc(19, [[9.4, 'G'], [7.4, 'g']]).map(row => row) },
        { name: 'trail-1', role: 'leg-a', at: [5, 14], pivot: [1, 0], rows: ['.t.', '.t.', 't..', 't..', '.t.'] },
        { name: 'trail-2', role: 'leg-b', at: [8, 15], pivot: [1, 0], rows: ['.t.', 't..', 't..', '.t.', '.t.', '..t'] },
        { name: 'trail-3', role: 'leg-a', at: [11, 14], pivot: [1, 0], rows: ['.t.', '..t', '..t', '.t.'] },
        { name: 'orb', role: 'body', at: [3, 3], rows: disc(13, [[1.5, 'w', -2, -2], [3.8, 'y'], [5.3, 'b'], [6.3, 'k']]), children: [
          { name: 'eyes', role: 'eyes', at: [4, 5], pivot: [2, 1], rows: ['e...e', 'e...e'] }
        ] }
      ]
    },
    'death-hound': {
      archetype: 'light',
      palette: { k: '#121417', d: '#3a4048', D: '#262a30', l: '#5d6872', r: '#ff5a42', R: '#9e2f22', t: '#efe6c8' },
      parts: [
        { name: 'tail', role: 'tail', at: [0, 6], pivot: [7, 4], rows: ['k.......', 'kdk.....', '.kdk....', '..kddkkk', '...kkddd'] },
        { name: 'leg-far-back', role: 'leg-b', at: [10, 13], pivot: [1, 0], shade: 0.7, rows: ['kdk', 'kDk', 'kDk', 'kkk'] },
        { name: 'leg-far-front', role: 'leg-a', at: [18, 13], pivot: [1, 0], shade: 0.7, rows: ['kdk', 'kDk', 'kDk', 'kkk'] },
        { name: 'spikes', role: 'static', at: [9, 7], rows: ['.k..k..k..', 'kDkkDkkDk.'] },
        { name: 'body', role: 'body', at: [6, 8], rows: [
          '...kkkkkkk....',
          '.kkdllldddkk..',
          'kdddlldddddddk',
          'kDdddddddddddk',
          'kDDddddddddddk',
          '.kDDDdddddddk.',
          '..kkkkkkkkkk..'
        ] },
        { name: 'leg-back', role: 'leg-a', at: [8, 13], pivot: [1, 0], rows: ['kdk', 'kDk', 'kDk', 'kkk'] },
        { name: 'leg-front', role: 'leg-b', at: [16, 13], pivot: [1, 0], rows: ['kdk', 'kDk', 'kDk', 'kkk'] },
        { name: 'head', role: 'head', at: [17, 3], pivot: [3, 7], rows: [
          '.k....k.....',
          'kDk..kDk....',
          'kdDk.kdDk...',
          'kddDkkddDk..',
          '.kddddddddk.',
          '.kdldddddddk',
          '.kDddkkkkkkk',
          '..kDDktktkt.',
          '...kkk......'
        ], children: [
          { name: 'eyes', role: 'glow-eye', at: [7, 4], rows: ['rR'] }
        ] }
      ]
    },
    chicken: {
      archetype: 'light',
      palette: { k: '#38312a', w: '#f7f3e8', W: '#d8d0bd', r: '#d84a32', R: '#a33424', y: '#f2b43c', Y: '#c98a22', e: '#1a1a1a' },
      parts: [
        { name: 'leg-left', role: 'leg-a', at: [7, 15], pivot: [1, 0], rows: ['.y.', '.y.', 'yYy'] },
        { name: 'leg-right', role: 'leg-b', at: [10, 15], pivot: [1, 0], rows: ['.y.', '.y.', 'yYy'] },
        { name: 'body', role: 'body', at: [3, 7], rows: [
          'kk..........',
          'kwk..kkkkk..',
          'kwwkkwwwwwk.',
          'kwwwwwwwwwwk',
          'kWwwwwwwwwwk',
          'kWWwwwwwwwwk',
          '.kWWWwwwwWk.',
          '..kWWWWWWk..',
          '...kkkkkk...'
        ] },
        { name: 'wing', role: 'wing-a', at: [6, 10], pivot: [5, 0], rows: ['kkkkk.', 'kWWWWk', '.kWWWk', '..kkk.'] },
        { name: 'head', role: 'head', at: [11, 1], pivot: [3, 8], rows: [
          '..kkk....',
          '.krrrk...',
          '.kkRkkk..',
          '.kwwwwk..',
          'kwwwwwwk.',
          'kwwwwwkyy',
          'kwwwwwrkk',
          '.kWwwwrk.',
          '..kkkkk..'
        ], children: [
          { name: 'eyes', role: 'eyes', at: [5, 4], pivot: [0, 0], rows: ['e'] }
        ] }
      ]
    }
  };

  function parseColour(value) {
    const hex = /^#([0-9a-f]{6})$/i.exec(value);
    if (!hex) return null;
    const number = parseInt(hex[1], 16);
    return [(number >> 16) & 255, (number >> 8) & 255, number & 255];
  }

  function shadeColour(value, factor) {
    const rgb = parseColour(value);
    if (!rgb || factor === 1) return value;
    return `rgb(${rgb.map(channel => Math.round(channel * factor)).join(', ')})`;
  }

  function partSize(part) {
    return [Math.max(...part.rows.map(row => row.length)), part.rows.length];
  }

  function bounds(pet) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    pet.parts.forEach(part => {
      if (part.role && part.role.startsWith('fx-')) return;
      const [width, height] = partSize(part);
      minX = Math.min(minX, part.at[0]);
      minY = Math.min(minY, part.at[1]);
      maxX = Math.max(maxX, part.at[0] + width);
      maxY = Math.max(maxY, part.at[1] + height);
    });
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  function drawPart(doc, part, palette, originX, originY, pixel) {
    const [width, height] = partSize(part);
    const element = doc.createElement('div');
    element.className = `pet-part part-${part.name} role-${part.role || 'static'}`;
    element.style.left = `${(part.at[0] - originX) * pixel}px`;
    element.style.top = `${(part.at[1] - originY) * pixel}px`;
    element.style.width = `${width * pixel}px`;
    element.style.height = `${height * pixel}px`;
    const pivot = part.pivot || [width / 2, height];
    const pivotX = part.flip ? width - pivot[0] : pivot[0];
    element.style.transformOrigin = `${pivotX * pixel}px ${pivot[1] * pixel}px`;

    const canvas = doc.createElement('canvas');
    canvas.width = width * pixel;
    canvas.height = height * pixel;
    const context = canvas.getContext && canvas.getContext('2d');
    if (context) {
      part.rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x += 1) {
          const colour = palette[row[x]];
          if (!colour) continue;
          context.fillStyle = shadeColour(colour, part.shade || 1);
          const drawX = part.flip ? width - 1 - x : x;
          context.fillRect(drawX * pixel, y * pixel, pixel, pixel);
        }
      });
    }
    element.append(canvas);
    (part.children || []).forEach(child => element.append(drawPart(doc, child, palette, 0, 0, pixel)));
    return element;
  }

  function render(container, petId, options = {}) {
    return renderDef(container, pets[petId] || pets.dovahmin, options);
  }

  function renderDef(container, pet, options = {}) {
    const doc = container.ownerDocument;
    const pixel = options.pixel || PIXEL;
    const box = bounds(pet);
    container.textContent = '';
    container.style.width = `${box.width * pixel}px`;
    container.style.height = `${box.height * pixel}px`;
    pet.parts.forEach(part => container.append(drawPart(doc, part, pet.palette, box.x, box.y, pixel)));
    return { archetype: pet.archetype, width: box.width * pixel, height: box.height * pixel };
  }

  // egg shell and spot colours per companion
  const eggColours = {
    dovahmin: ['#467552', '#dcbc7e'], dovahpink: ['#d0679c', '#ffe0ea'], mudcrab: ['#5c5f64', '#8d9094'],
    skeever: ['#7a5a45', '#e39a9a'], fox: ['#d8662c', '#f7e8cc'], sabrecat: ['#c8955a', '#5a3a24'],
    'frostbite-spider': ['#5a3f5e', '#d7e8ef'], horker: ['#7d7a80', '#f2e7c6'], troll: ['#7c8a6a', '#a99d84'],
    'flame-atronach': ['#f07a2e', '#ffcf4a'], 'frost-atronach': ['#8fd3e8', '#e8fbff'], spriggan: ['#7a5a3a', '#6fae4a'],
    'dwarven-spider': ['#b8823f', '#6fe3ff'], chaurus: ['#7d8f3e', '#c9b98a'], netch: ['#a5629b', '#f6dcef'],
    mammoth: ['#8a6a4e', '#f2e7c6'], 'dragon-priest': ['#4a4560', '#d6a84a'], wisp: ['#9eeaff', '#fff6a8'],
    'death-hound': ['#3a4048', '#ff5a42'], chicken: ['#f7f3e8', '#d84a32']
  };
  const MYSTERY_EGG = ['#b9b3a3', '#77725f'];

  // 13x16 egg: fuller at the bottom, light top-left, a few spots
  function eggRows() {
    const width = 13;
    const height = 16;
    const spots = ['4,5', '8,4', '6,9', '9,10', '3,11', '7,13'];
    const rows = [];
    for (let y = 0; y < height; y += 1) {
      let row = '';
      for (let x = 0; x < width; x += 1) {
        const dx = (x - 6) / 6.2;
        const dy = y < 9 ? (y - 9) / 9 : (y - 9) / 6.8;
        const inside = dx * dx + dy * dy <= 1;
        const edge = inside && ((x - 6) / 5.2) ** 2 + (y < 9 ? (y - 9) / 8 : (y - 9) / 5.8) ** 2 > 1;
        if (!inside) row += '.';
        else if (edge) row += 'k';
        else if (x < 5 && y < 6 && x + y > 4) row += 'l';
        else if (spots.includes(`${x},${y}`)) row += 's';
        else if (x > 8 && y > 9) row += 'd';
        else row += 'e';
      }
      rows.push(row);
    }
    return rows;
  }

  const crackRows = [
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '.............',
    '..c..c...c...',
    '.c.cc.c.c.c..',
    '.......c...c.',
    '.............'
  ];

  function shadeHex(hex, factor) {
    const value = parseInt(hex.slice(1), 16);
    const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map(channel => Math.min(255, Math.round(channel * factor)));
    return `rgb(${channels.join(', ')})`;
  }

  // Draws a companion's egg (or the grey mystery egg when `petId` is null).
  function renderEgg(container, petId, options = {}) {
    const [shell, spot] = eggColours[petId] || MYSTERY_EGG;
    const egg = {
      archetype: 'egg',
      palette: { k: '#2a2622', e: shell, d: shadeHex(shell, 0.78), l: shadeHex(shell, 1.25), s: spot, c: '#2a2622' },
      parts: [
        { name: 'egg', role: 'body', at: [0, 0], rows: eggRows() },
        { name: 'cracks', role: 'static', at: [0, 2], rows: crackRows }
      ]
    };
    return renderDef(container, egg, options);
  }

  // frame ornaments, the corner is top-left and gets mirrored
  const ornaments = {
    pixel: 3,
    palette: {
      k: '#14130f', l: '#f1ede1', g: '#b9b3a3', G: '#77725f',
      // moons
      M: '#f0bfa6', m: '#d0866e', n: '#9d5a4c', h: 'rgba(255, 196, 170, .16)',
      S: '#f4f6fa', s: '#c9d0da', t: '#9aa4b2', H: 'rgba(225, 235, 255, .16)',
      // sun
      W: '#ffffff', Y: '#fff6c8', y: '#ffd860', o: '#f5a93a', r: 'rgba(255, 236, 160, .6)', a: 'rgba(255, 244, 196, .2)',
      // dawn/dusk suns (dusk kept away from fire colours)
      D: '#fff4d6', E: '#ffd27a', F: '#f6a04d', I: 'rgba(255, 214, 150, .28)',
      J: '#ffd2c0', K: '#f2626a', L: '#b8364f', N: 'rgba(240, 96, 110, .28)',
      // mood icons
      p: '#c9703f', P: '#8e4a2b', q: '#f2ead2', R: '#d8485a'
    },
    corner: [
      'kkkkkkkkkkkkkkk.',
      'klllllllllllllgk',
      'klgggggggggggGk.',
      'klgkkkkkkkkkkk..',
      'klgk....k.......',
      'klgk...kgk......',
      'klgk..kglgk.....',
      'klgk.kglklgk....',
      'klgk..kglgk.....',
      'klgk...kgk......',
      'klgk....k.......',
      'klgk............',
      'klgk............',
      'klgk............',
      'kgGk............',
      '.kk.............'
    ],
    emblem: [
      '........k........',
      '.......kgk.......',
      '......kglgk......',
      'kkkkkkglklgkkkkkk',
      'kllllkgkGkgkllllk',
      'kkkkkkglklgkkkkkk',
      '......kglgk......',
      '.......kgk.......',
      '........k........'
    ],
    // craters first so they win, fill is offset up-left for a shaded edge
    masser: disc(17, [[1.4, 'n', -2, -1.5], [1.1, 'n', 2, 1.5], [0.9, 'n', 0.5, -3], [1.0, 'n', -1.5, 3], [5.6, 'M', -0.8, -0.8], [6.4, 'm'], [8.3, 'h']]),
    sun: disc(13, [[1.4, 'W', -1.5, -1.5], [3.4, 'Y', -0.6, -0.6], [4.8, 'y'], [5.7, 'o']]),
    sunHalo: rays(25, 8, 11.6, 8.6),
    iconFood: ['.....kk.', '....kqqk', '...kPkqk', '..kpPPk.', '.kppPPk.', 'kppppk..', 'kpppk...', '.kkk....'],
    iconHeart: ['.kk..kk.', 'kRRkkRRk', 'kRRRkRRk', 'kRRkRRRk', '.kRRkRk.', '..kRRk..', '...kk...'],
    sunDawn: disc(19, [[2.2, 'D', -1, -1], [5.4, 'E'], [6.6, 'F'], [9.3, 'I']]),
    sunDusk: disc(19, [[2.2, 'J', -1, -1], [5.4, 'K'], [6.6, 'L'], [9.3, 'N']]),
    secunda: disc(11, [[0.8, 't', 1, -1], [0.7, 't', -1, 1.5], [3.2, 'S', -0.6, -0.6], [3.9, 's'], [5.4, 'H']])
  };

  function renderOrnament(doc, name, options = {}) {
    const rows = ornaments[name];
    const pixel = ornaments.pixel;
    const width = rows[0].length;
    const height = rows.length;
    const canvas = doc.createElement('canvas');
    canvas.width = width * pixel;
    canvas.height = height * pixel;
    const context = canvas.getContext && canvas.getContext('2d');
    if (context) {
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x += 1) {
          const colour = ornaments.palette[row[x]];
          if (!colour) continue;
          context.fillStyle = colour;
          const drawX = options.flipX ? width - 1 - x : x;
          const drawY = options.flipY ? height - 1 - y : y;
          context.fillRect(drawX * pixel, drawY * pixel, pixel, pixel);
        }
      });
    }
    return canvas;
  }

  // display names, and the species for everyone who isn't a dragon
  const names = {
    dovahmin: 'Dovahmin', dovahpink: 'Dovahpink', mudcrab: 'Clack', skeever: 'Nibbles',
    fox: 'Ember', sabrecat: 'Stripes', 'frostbite-spider': 'Webber', horker: 'Waddles',
    troll: 'Grumble', 'flame-atronach': 'Cinder', 'frost-atronach': 'Shiver',
    spriggan: 'Moss', 'dwarven-spider': 'Tinker', chaurus: 'Skitter', netch: 'Bloop',
    mammoth: 'Tusker', 'dragon-priest': 'Masky', wisp: 'Glowbug', 'death-hound': 'Gnasher',
    chicken: 'Pip'
  };
  const species = {
    mudcrab: 'Mudcrab', skeever: 'Skeever', fox: 'Fox', sabrecat: 'Sabre Cat',
    'frostbite-spider': 'Frostbite Spider', horker: 'Horker', troll: 'Troll',
    'flame-atronach': 'Flame Atronach', 'frost-atronach': 'Frost Atronach', spriggan: 'Spriggan',
    'dwarven-spider': 'Dwarven Spider', chaurus: 'Chaurus', netch: 'Netch', mammoth: 'Mammoth',
    'dragon-priest': 'Dragon Priest', wisp: 'Wisp', 'death-hound': 'Death Hound', chicken: 'Chicken'
  };

  return Object.freeze({ PIXEL, ROLES, pets, names, species, ornaments, bounds, render, renderEgg, eggColours, renderOrnament });
});
