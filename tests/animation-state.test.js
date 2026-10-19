const test = require('node:test');
const assert = require('node:assert/strict');
const animationState = require('../view/animation-state.js');

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let dueId = null;
        let due = null;
        for (const [id, timer] of timers) {
          if (timer.at <= target && (!due || timer.at < due.at)) {
            dueId = id;
            due = timer;
          }
        }
        if (!due) break;
        timers.delete(dueId);
        now = due.at;
        due.fn();
      }
      now = target;
    }
  };
}

function setup() {
  const clock = fakeClock();
  const snapshots = [];
  const controller = animationState.createController({
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onChange: snapshot => snapshots.push(snapshot)
  });
  return { clock, controller, snapshots, last: () => snapshots[snapshots.length - 1] };
}

test('normalizes native and preview state names', () => {
  assert.equal(animationState.normalizeState('flying'), 'moving');
  assert.equal(animationState.normalizeState('landed'), 'landing');
  assert.equal(animationState.normalizeState('gain'), 'xp');
  assert.equal(animationState.normalizeState('celebrating'), 'celebrating');
  assert.equal(animationState.normalizeState('level-up'), 'level-up');
  assert.equal(animationState.normalizeState('unknown'), 'idle');
});

test('higher-priority states interrupt lower-priority one-shots', () => {
  assert.equal(animationState.canInterrupt('xp', 'combat'), false);
  assert.equal(animationState.canInterrupt('combat', 'level-up'), true);
  assert.equal(animationState.canInterrupt('moving', 'landing'), true);
});

test('repeated persistent states are ignored', () => {
  const { controller, snapshots } = setup();
  assert.equal(controller.setBase('combat'), true);
  assert.equal(controller.setBase('combat'), false);
  assert.equal(snapshots.length, 1);
});

test('XP during landing returns to idle instead of sticking in landing', () => {
  const { clock, controller, last } = setup();
  controller.setBase('moving');
  controller.setBase('landed');
  assert.equal(last().state, 'landing');
  controller.play('xp', { payload: { title: 'XP gained' } });
  assert.equal(last().state, 'xp');
  clock.advance(5000);
  assert.equal(last().state, 'idle');
  assert.equal(last().oneShot, null);
});

test('XP during a level-up is queued and then returns to the base state', () => {
  const { clock, controller, last } = setup();
  controller.setBase('moving');
  controller.play('level-up', { payload: { title: 'Level 42!' } });
  assert.equal(controller.play('xp', { payload: { title: 'XP gained' } }), false);
  assert.equal(last().state, 'level-up');
  assert.equal(last().payload.title, 'Level 42!');

  clock.advance(1150);
  assert.equal(last().state, 'xp');
  assert.equal(last().payload.title, 'XP gained');

  clock.advance(850);
  assert.equal(last().state, 'moving');
  assert.equal(last().payload, null);
});

test('base state changes during a toast are applied when the toast ends', () => {
  const { clock, controller, last } = setup();
  controller.play('xp');
  assert.equal(controller.setBase('combat'), false);
  assert.equal(last().state, 'xp');
  clock.advance(850);
  assert.equal(last().state, 'combat');
});

test('a repeated toast restarts with the newest payload', () => {
  const { clock, controller, last } = setup();
  controller.play('xp', { payload: { detail: 'One-handed' } });
  clock.advance(500);
  controller.play('xp', { payload: { detail: 'Archery' } });
  assert.equal(last().restarted, true);
  assert.equal(last().payload.detail, 'Archery');
  clock.advance(500);
  assert.equal(last().state, 'xp', 'restart should extend the toast');
  clock.advance(400);
  assert.equal(last().state, 'idle');
});

test('moving cancels a landing immediately', () => {
  const { controller, last } = setup();
  controller.setBase('combat');
  controller.setBase('landed');
  assert.equal(last().state, 'landing');
  controller.setBase('moving');
  assert.equal(last().state, 'moving');
  assert.equal(last().oneShot, null);
});

test('the toast queue is bounded', () => {
  const { clock, controller, last } = setup();
  controller.play('level-up');
  for (let index = 0; index < 10; index += 1) controller.play('xp', { payload: { index } });
  assert.equal(last().queued, 0, 'queue length is only reported on emitted snapshots');
  clock.advance(1150);
  assert.equal(last().payload.index, 7);
  assert.equal(last().queued, 2);
});

test('reset clears one-shots, queue and base', () => {
  const { clock, controller, last } = setup();
  controller.setBase('combat');
  controller.play('level-up');
  controller.play('xp');
  controller.reset();
  assert.equal(last().state, 'idle');
  clock.advance(5000);
  assert.equal(last().state, 'idle');
});
