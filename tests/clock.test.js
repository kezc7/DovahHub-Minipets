const test = require('node:test');
const assert = require('node:assert/strict');
const clock = require('../view/clock.js');

test('formats a 12-hour time with AM/PM', () => {
  assert.equal(clock.formatTime(20, 42), '8:42 PM');
  assert.equal(clock.formatTime(0, 5), '12:05 AM');
  assert.equal(clock.formatTime(12, 0), '12:00 PM');
  assert.equal(clock.formatTime(9, 7), '9:07 AM');
});

test('clamps bad time input', () => {
  assert.equal(clock.formatTime(24, 75), '12:59 AM');
  assert.equal(clock.formatTime('x', undefined), '12:00 AM');
});

test('uses English ordinals like the game', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(clock.ordinal),
    ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '31st']);
});

test('formats the Skyrim date', () => {
  assert.equal(clock.formatDate({ weekday: 'Morndas', day: 17, month: 'Last Seed' }), 'Morndas, 17th of Last Seed');
  assert.equal(clock.formatDate({ day: 1, month: 'Morning Star' }), '1st of Morning Star');
});
