(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetAnimationState = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const priorities = Object.freeze({ idle: 0, moving: 1, landing: 1, combat: 2, xp: 3, celebrating: 4, 'level-up': 5 });
  const persistentStates = Object.freeze(['idle', 'moving', 'combat']);
  const defaultDurations = Object.freeze({ landing: 900, xp: 850, celebrating: 1150, 'level-up': 1150 });
  const maxQueuedOneShots = 3;

  function normalizeState(state) {
    if (state === 'flying' || state === 'moving') return 'moving';
    if (state === 'landed' || state === 'landing') return 'landing';
    if (state === 'combat') return 'combat';
    if (state === 'xp' || state === 'gain' || state === 'xp-gain') return 'xp';
    if (state === 'celebrating') return 'celebrating';
    if (state === 'level-up') return 'level-up';
    return 'idle';
  }

  function isPersistent(state) {
    return persistentStates.includes(normalizeState(state));
  }

  function canInterrupt(activeState, nextState) {
    return priorities[normalizeState(nextState)] >= priorities[normalizeState(activeState)];
  }

  // Game states (idle/moving/combat) are the base. One-shots (landing, xp,
  // level up) play over it and always go back to the base when done.
  function createController(options = {}) {
    const setTimer = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimeout || (id => clearTimeout(id));
    const onChange = options.onChange || (() => {});
    const durations = Object.assign({}, defaultDurations, options.durations);

    let base = 'idle';
    let state = 'idle';
    let oneShot = null;
    let timer = 0;
    const queue = [];

    function snapshot(restarted) {
      return {
        state,
        base,
        oneShot: oneShot ? oneShot.state : null,
        payload: oneShot ? oneShot.payload : null,
        restarted: Boolean(restarted),
        queued: queue.length
      };
    }

    function emit(restarted) {
      onChange(snapshot(restarted));
    }

    function stopTimer() {
      if (timer) clearTimer(timer);
      timer = 0;
    }

    function startOneShot(next, payload, duration) {
      stopTimer();
      const restarted = Boolean(oneShot && oneShot.state === next);
      oneShot = { state: next, payload: payload || null };
      state = next;
      timer = setTimer(finishOneShot, duration ?? durations[next] ?? 900);
      emit(restarted);
    }

    function finishOneShot() {
      timer = 0;
      oneShot = null;
      const next = queue.shift();
      if (next) {
        startOneShot(next.state, next.payload, next.duration);
        return;
      }
      state = base;
      emit(false);
    }

    function play(rawState, playOptions = {}) {
      const next = normalizeState(rawState);
      if (isPersistent(next)) return setBase(next);
      if (oneShot && oneShot.state !== next && !canInterrupt(oneShot.state, next)) {
        // don't queue landings
        if (next !== 'landing') {
          queue.push({ state: next, payload: playOptions.payload, duration: playOptions.duration });
          if (queue.length > maxQueuedOneShots) queue.shift();
        }
        return false;
      }
      startOneShot(next, playOptions.payload, playOptions.duration);
      return true;
    }

    function setBase(rawState) {
      const next = normalizeState(rawState);
      if (next === 'landing') {
        base = 'idle';
        return play('landing');
      }
      if (!isPersistent(next)) return play(next);

      const changed = next !== base;
      base = next;
      if (oneShot) {
        // moving/combat cuts a landing short
        if (oneShot.state === 'landing' && next !== 'idle') {
          stopTimer();
          oneShot = null;
          state = base;
          emit(false);
          return true;
        }
        return false;
      }
      if (!changed && state === next) return false;
      state = next;
      emit(false);
      return true;
    }

    function reset() {
      stopTimer();
      queue.length = 0;
      oneShot = null;
      base = 'idle';
      state = 'idle';
      emit(false);
    }

    function dispose() {
      stopTimer();
      queue.length = 0;
    }

    return Object.freeze({
      play,
      setBase,
      reset,
      dispose,
      snapshot: () => snapshot(false)
    });
  }

  return Object.freeze({ priorities, normalizeState, isPersistent, canInterrupt, createController });
});
