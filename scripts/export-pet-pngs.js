const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const PetSprites = require('../view/pet-sprites.js');
const PetSky = require('../view/sky.js');

const WIDTH = 1024;
const HEIGHT = 1024;
const OUTPUT_DIR = path.join(__dirname, '..', 'output', 'pet-pngs');

const companions = [
  ['dovahmin', 'Dovahmin', 6, 'clear'],
  ['dovahpink', 'Dovahpink', 19, 'clear'],
  ['mudcrab', 'Clack', 12.5, 'rain'],
  ['skeever', 'Nibbles', 23.5, 'snow'],
  ['fox', 'Ember', 6, 'rain'],
  ['sabrecat', 'Stripes', 19, 'storm'],
  ['frostbite-spider', 'Webber', 23, 'storm'],
  ['horker', 'Waddles', 12.5, 'snow'],
  ['troll', 'Grumble', 18.5, 'clear'],
  ['flame-atronach', 'Cinder', 23, 'clear'],
  ['frost-atronach', 'Shiver', 6.5, 'snow'],
  ['spriggan', 'Moss', 12.5, 'rain'],
  ['dwarven-spider', 'Tinker', 19.5, 'rain'],
  ['chaurus', 'Skitter', 1, 'clear'],
  ['netch', 'Bloop', 6.5, 'clear'],
  ['mammoth', 'Tusker', 13.5, 'snow'],
  ['dragon-priest', 'Masky', 23.5, 'storm'],
  ['wisp', 'Glowbug', 18.5, 'rain'],
  ['death-hound', 'Gnasher', 1.5, 'snow'],
  ['chicken', 'Pip', 11, 'clear']
];

const PHASE_LABELS = { dawn: 'DAWN', day: 'DAY', sunset: 'SUNSET', night: 'NIGHT' };
const WEATHER_LABELS = { clear: 'CLEAR', rain: 'RAIN', snow: 'SNOW', storm: 'STORM' };

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function parseColour(value) {
  if (typeof value !== 'string') return [0, 0, 0, 255];
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [parseInt(hex[1].slice(0, 2), 16), parseInt(hex[1].slice(2, 4), 16), parseInt(hex[1].slice(4, 6), 16), 255];
  const rgba = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map(Number);
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0, parts.length > 3 ? Math.round((parts[3] || 0) * 255) : 255];
  }
  return [0, 0, 0, 255];
}

function shadeColour(value, factor) {
  const [r, g, b, a] = parseColour(value);
  return `rgba(${Math.round(r * factor)}, ${Math.round(g * factor)}, ${Math.round(b * factor)}, ${a / 255})`;
}

class PixelCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = Buffer.alloc(width * height * 4);
    this.fillStyle = '#000000';
  }

  colour(value = this.fillStyle) {
    return parseColour(value);
  }

  pixel(x, y, colour = this.fillStyle) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const [r, g, b, a] = this.colour(colour);
    const index = (y * this.width + x) * 4;
    if (a === 255) {
      this.data[index] = r;
      this.data[index + 1] = g;
      this.data[index + 2] = b;
      this.data[index + 3] = 255;
      return;
    }
    const alpha = a / 255;
    const inverse = 1 - alpha;
    this.data[index] = Math.round(r * alpha + this.data[index] * inverse);
    this.data[index + 1] = Math.round(g * alpha + this.data[index + 1] * inverse);
    this.data[index + 2] = Math.round(b * alpha + this.data[index + 2] * inverse);
    this.data[index + 3] = 255;
  }

  fillRect(x, y, width, height) {
    const left = Math.floor(x);
    const top = Math.floor(y);
    const right = Math.ceil(x + width);
    const bottom = Math.ceil(y + height);
    for (let row = Math.max(0, top); row < Math.min(this.height, bottom); row += 1) {
      for (let column = Math.max(0, left); column < Math.min(this.width, right); column += 1) this.pixel(column, row);
    }
  }

  line(x1, y1, x2, y2, colour = this.fillStyle, thickness = 2) {
    const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
    for (let index = 0; index <= steps; index += 1) {
      const t = steps ? index / steps : 0;
      this.fillStyle = colour;
      this.fillRect(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, thickness, thickness);
    }
  }
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

function blendColour(a, b, amount) {
  return a.map((channel, index) => Math.round(channel + (b[index] - channel) * amount));
}

function drawBackground(canvas, phase, weather, seed) {
  const colours = {
    dawn: [[52, 68, 132], [225, 139, 110]],
    day: [[64, 145, 211], [175, 220, 226]],
    sunset: [[66, 45, 101], [231, 119, 92]],
    night: [[9, 17, 43], [30, 47, 82]]
  }[phase];
  for (let y = 0; y < HEIGHT; y += 1) {
    const amount = y / (HEIGHT * 0.76);
    const colour = blendColour(colours[0], colours[1], clamp(amount, 0, 1));
    canvas.fillStyle = `rgb(${colour[0]}, ${colour[1]}, ${colour[2]})`;
    canvas.fillRect(0, y, WIDTH, 1);
  }

  const random = seededRandom(seed * 17 + 3);
  if (phase === 'night') {
    for (let index = 0; index < 90; index += 1) {
      const x = Math.floor(random() * WIDTH);
      const y = Math.floor(random() * 510);
      const glow = index % 5 === 0 ? '#d9e7ff' : '#8ca4d0';
      canvas.fillStyle = glow;
      canvas.fillRect(x, y, index % 3 === 0 ? 3 : 2, index % 3 === 0 ? 3 : 2);
    }
    drawMoon(canvas, 785, 205, 42, '#d4dced', '#7885a8');
    drawMoon(canvas, 905, 320, 25, '#c59f9c', '#765f70');
  } else {
    const x = phase === 'sunset' ? 790 : phase === 'dawn' ? 230 : 790;
    const y = phase === 'day' ? 175 : 525;
    const outer = phase === 'sunset' ? '#f2626a' : phase === 'dawn' ? '#f6a04d' : '#ffd860';
    const inner = phase === 'sunset' ? '#ffd2c0' : phase === 'dawn' ? '#fff4d6' : '#fff6c8';
    for (let ray = 0; ray < 8; ray += 1) {
      const angle = ray * Math.PI / 4;
      canvas.line(x + Math.cos(angle) * 62, y + Math.sin(angle) * 62, x + Math.cos(angle) * 86, y + Math.sin(angle) * 86, `${outer}88`, 6);
    }
    drawCircle(canvas, x, y, 53, outer);
    drawCircle(canvas, x - 8, y - 8, 32, inner);
  }

  if (weather === 'rain' || weather === 'storm') {
    canvas.fillStyle = phase === 'night' ? 'rgba(14, 24, 54, .2)' : 'rgba(51, 86, 121, .16)';
    canvas.fillRect(0, 0, WIDTH, 680);
    for (let index = 0; index < 42; index += 1) {
      const x = Math.floor(random() * WIDTH);
      const y = Math.floor(random() * 650);
      canvas.line(x, y, x - 16, y + 46, 'rgba(220, 236, 255, .48)', 3);
    }
  } else if (weather === 'snow') {
    canvas.fillStyle = 'rgba(210, 224, 241, .16)';
    canvas.fillRect(0, 0, WIDTH, 680);
    for (let index = 0; index < 54; index += 1) {
      const x = Math.floor(random() * WIDTH);
      const y = Math.floor(random() * 700);
      canvas.fillStyle = index % 4 === 0 ? '#fff4d5' : '#f5f8ff';
      canvas.fillRect(x, y, index % 3 === 0 ? 7 : 4, index % 3 === 0 ? 7 : 4);
    }
  }

  if (weather === 'storm') {
    canvas.fillStyle = 'rgba(14, 17, 42, .18)';
    canvas.fillRect(0, 0, WIDTH, HEIGHT);
    const lightningX = 660 + Math.floor(random() * 170);
    canvas.line(lightningX, 115, lightningX - 28, 240, 'rgba(255, 248, 193, .88)', 8);
    canvas.line(lightningX - 28, 240, lightningX + 8, 226, 'rgba(255, 248, 193, .88)', 8);
    canvas.line(lightningX + 8, 226, lightningX - 10, 360, 'rgba(255, 248, 193, .88)', 8);
  }
}

function drawCircle(canvas, centreX, centreY, radius, colour) {
  canvas.fillStyle = colour;
  for (let y = -radius; y <= radius; y += 4) {
    for (let x = -radius; x <= radius; x += 4) {
      if (x * x + y * y <= radius * radius) canvas.fillRect(centreX + x, centreY + y, 6, 6);
    }
  }
}

function drawMoon(canvas, x, y, radius, fill, crater) {
  drawCircle(canvas, x, y, radius, fill);
  canvas.fillStyle = crater;
  canvas.fillRect(x - radius / 3, y - radius / 5, radius / 4, radius / 5);
  canvas.fillRect(x + radius / 5, y + radius / 3, radius / 5, radius / 6);
}

function drawPet(canvas, petId, phase, weather) {
  const pet = PetSprites.pets[petId];
  const box = PetSprites.bounds(pet);
  const scale = Math.max(12, Math.min(22, Math.floor(520 / Math.max(box.width, box.height))));
  const petWidth = box.width * scale;
  const petHeight = box.height * scale;
  const originX = Math.round((WIDTH - petWidth) / 2);
  const originY = Math.round(635 - petHeight);

  canvas.fillStyle = phase === 'night' ? 'rgba(0, 0, 0, .34)' : 'rgba(20, 18, 24, .26)';
  canvas.fillRect(originX + petWidth * 0.12, 842, petWidth * 0.76, 20);

  if (pet.archetype === 'hover' || pet.archetype === 'flyer') {
    canvas.fillStyle = phase === 'night' ? 'rgba(140, 168, 226, .18)' : 'rgba(255, 236, 170, .14)';
    canvas.fillRect(originX + petWidth * 0.22, originY + petHeight * 0.28, petWidth * 0.56, petHeight * 0.38);
  }

  function drawPart(part, parentX, parentY) {
    if (part.role && part.role === 'fx-combat') return;
    const width = Math.max(...part.rows.map(row => row.length));
    const partX = parentX + part.at[0] * scale;
    const partY = parentY + part.at[1] * scale;
    part.rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        const value = pet.palette[row[x]];
        if (!value) continue;
        const drawX = part.flip ? width - 1 - x : x;
        canvas.fillStyle = shadeColour(value, part.shade || 1);
        canvas.fillRect(partX + drawX * scale, partY + y * scale, scale, scale);
      }
    });
    (part.children || []).forEach(child => drawPart(child, partX, partY));
  }

  pet.parts.forEach(part => drawPart(part, originX - box.x * scale, originY - box.y * scale));

  if (weather === 'snow') {
    canvas.fillStyle = 'rgba(255, 250, 240, .65)';
    canvas.fillRect(originX + petWidth * 0.23, originY + petHeight * 0.18, petWidth * 0.12, scale);
  }
}

const FONT = {
  '0': ['111', '101', '101', '101', '101', '101', '111'],
  '1': ['110', '010', '010', '010', '010', '010', '111'],
  '2': ['111', '001', '001', '111', '100', '100', '111'],
  '3': ['111', '001', '001', '111', '001', '001', '111'],
  '4': ['101', '101', '101', '111', '001', '001', '001'],
  '5': ['111', '100', '100', '111', '001', '001', '111'],
  '6': ['111', '100', '100', '111', '101', '101', '111'],
  '7': ['111', '001', '001', '010', '010', '010', '010'],
  '8': ['111', '101', '101', '111', '101', '101', '111'],
  '9': ['111', '101', '101', '111', '001', '001', '111'],
  ':': ['000', '010', '010', '000', '010', '010', '000'],
  'C': ['111', '100', '100', '100', '100', '100', '111'],
  'D': ['1110', '1001', '1001', '1001', '1001', '1001', '1110'],
  'E': ['111', '100', '100', '111', '100', '100', '111'],
  'F': ['111', '100', '100', '111', '100', '100', '100'],
  'H': ['1001', '1001', '1001', '1111', '1001', '1001', '1001'],
  'K': ['1001', '1010', '1100', '1100', '1010', '1010', '1001'],
  'L': ['100', '100', '100', '100', '100', '100', '111'],
  'A': ['010', '101', '101', '111', '101', '101', '101'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['1001', '1101', '1101', '1011', '1011', '1001', '1001'],
  'O': ['111', '101', '101', '101', '101', '101', '111'],
  'P': ['1111', '1001', '1001', '1111', '1000', '1000', '1000'],
  'R': ['1111', '1001', '1001', '1111', '1010', '1001', '1001'],
  'S': ['111', '100', '100', '111', '001', '001', '111'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  ',': ['000', '000', '000', '000', '000', '010', '100'],
  ' ': ['000', '000', '000', '000', '000', '000', '000']
};

function drawText(canvas, text, x, y, scale, colour) {
  let cursor = x;
  for (const character of text) {
    const glyph = FONT[character] || FONT[' '];
    const width = glyph[0].length;
    glyph.forEach((row, rowIndex) => {
      for (let column = 0; column < width; column += 1) {
        if (row[column] === '1') {
          canvas.fillStyle = colour;
          canvas.fillRect(cursor + column * scale, y + rowIndex * scale, scale, scale);
        }
      }
    });
    cursor += (width + 1) * scale;
  }
}

function drawClock(canvas, hour) {
  const displayHour = hour % 12 || 12;
  const minutes = Math.round((hour % 1) * 60) % 60;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const time = `${displayHour}:${String(minutes).padStart(2, '0')} ${suffix}`;
  const date = 'MORNDAS, 17TH OF LAST SEED';
  const width = 390;
  const height = 148;
  const x = Math.round((WIDTH - width) / 2);
  const y = 724;
  canvas.fillStyle = 'rgba(20, 19, 24, .82)';
  canvas.fillRect(x, y, width, height);
  canvas.fillStyle = '#c6a66a';
  canvas.fillRect(x, y, width, 6);
  canvas.fillRect(x, y + height - 6, width, 6);
  canvas.fillRect(x, y, 6, height);
  canvas.fillRect(x + width - 6, y, 6, height);
  canvas.fillStyle = '#c6a66a';
  canvas.fillRect(Math.round(WIDTH / 2) - 2, y - 14, 4, 10);
  drawText(canvas, time, x + 72, y + 22, 7, '#fff4d1');
  drawText(canvas, date, x + 31, y + 108, 2, '#d9d3c3');
}

function renderPet(petId, hour, weather, seed) {
  const phase = PetSky.phaseFor(hour);
  const canvas = new PixelCanvas(WIDTH, HEIGHT);
  drawBackground(canvas, phase, weather, seed);
  canvas.fillStyle = PetSky.shade([32, 58, 43], phase);
  canvas.fillRect(0, 680, WIDTH, HEIGHT - 680);
  const layout = PetSky.buildScenery(seed, 128, 'skyrim');
  for (const layer of ['far', 'near', 'horizon', 'ground']) {
    PetSky.drawScenery(canvas, layout, { horizon: 690, height: HEIGHT, cell: 8, phase, weather, layer, copies: 2 });
  }
  drawPet(canvas, petId, phase, weather);
  return { canvas, phase };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const body = Buffer.concat([typeBuffer, data]);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0);
  typeBuffer.copy(result, 4);
  data.copy(result, 8);
  result.writeUInt32BE(crc32(body), 8 + data.length);
  return result;
}

function encodePng(canvas) {
  const rows = [];
  for (let y = 0; y < canvas.height; y += 1) rows.push(Buffer.concat([Buffer.from([0]), canvas.data.subarray(y * canvas.width * 4, (y + 1) * canvas.width * 4)]));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function drawContactSheet(images) {
  const sheet = new PixelCanvas(1280, 1600);
  for (let y = 0; y < sheet.height; y += 1) {
    sheet.fillStyle = `rgb(${Math.round(20 + y / 80)}, ${Math.round(24 + y / 90)}, ${Math.round(39 + y / 70)})`;
    sheet.fillRect(0, y, sheet.width, 1);
  }
  images.forEach(({ canvas }, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    const x = column * 320;
    const y = row * 320;
    for (let sy = 0; sy < 256; sy += 1) {
      for (let sx = 0; sx < 256; sx += 1) {
        const sourceX = Math.floor(sx * WIDTH / 256);
        const sourceY = Math.floor(sy * HEIGHT / 256);
        const sourceIndex = (sourceY * WIDTH + sourceX) * 4;
        const colour = `rgba(${canvas.data[sourceIndex]}, ${canvas.data[sourceIndex + 1]}, ${canvas.data[sourceIndex + 2]}, ${canvas.data[sourceIndex + 3] / 255})`;
        sheet.fillStyle = colour;
        sheet.fillRect(x + sx, y + sy, 1, 1);
      }
    }
  });
  return sheet;
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const rendered = [];
for (let index = 0; index < companions.length; index += 1) {
  const [id, name, hour, weather] = companions[index];
  const result = renderPet(id, hour, weather, 101 + index * 19);
  const filename = `${String(index + 1).padStart(2, '0')}-${id}.png`;
  fs.writeFileSync(path.join(OUTPUT_DIR, filename), encodePng(result.canvas));
  rendered.push({ ...result, id, name, hour, weather, filename });
  console.log(`${filename} — ${name} — ${PHASE_LABELS[result.phase]} / ${WEATHER_LABELS[weather]}`);
}

const clockedHour = 21.5;
const clocked = renderPet('wisp', clockedHour, 'clear', 777);
drawClock(clocked.canvas, clockedHour);
fs.writeFileSync(path.join(OUTPUT_DIR, '21-glowbug-mod-clock.png'), encodePng(clocked.canvas));

const sheet = drawContactSheet(rendered);
fs.writeFileSync(path.join(OUTPUT_DIR, 'contact-sheet.png'), encodePng(sheet));
fs.writeFileSync(path.join(OUTPUT_DIR, 'manifest.json'), JSON.stringify(rendered.map(({ id, name, hour, weather, phase, filename }) => ({ id, name, hour, phase, weather, filename })), null, 2));
console.log(`Wrote ${rendered.length} companion PNGs plus contact-sheet.png to ${OUTPUT_DIR}`);
