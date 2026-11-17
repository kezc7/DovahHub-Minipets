/* controller.js: controller support under PrismaUI.

   The page was written against a small controller interface, window.MeridianInput v1:
   getState(), onStateChange(), attachNavigation({ root, initialFocus, onBack, onAction })
   and action events of { control, action, phase, x, y, value, dt }. PrismaUI exposes the
   controller as a standard browser gamepad, so this implements that interface on top of it
   and the page's controller code runs unchanged.

   Actions: D-pad / left stick = up, down, left, right (held: repeat); A = accept,
   B = cancel, LB / RB = previousTab / nextTab, X = secondary, Y = tertiary, right stick
   click = toggleCursor. Every button also arrives by control name (including the triggers).
   The right stick sends { control: 'rightStick', phase: 'change', x, y, dt } (up positive).

   Default handling when onAction doesn't return true: move the highlight
   (data-meridian-focused; explicit neighbours via data-meridian-up/-down/-left/-right),
   click on accept (A on a select opens its list, dropdowns.js; a text field or range is edited), onBack on
   cancel, next/previous
   [role=tab] on LB / RB, and scroll with the right stick. */
(function (global) {
  'use strict';
  if (global.MeridianInput) return;  // a host that provides it (Meridian UI)

  // A host whose pages have no working gamepad (Magelight; its engine has the API but never a pad):
  // the plugin sends the pad state and this presents it as a standard gamepad, so everything below
  // runs unchanged. Until anything is sent, the browser's own pads are used (PrismaUI).
  {
    var fed = null;
    var ownPads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads.bind(navigator) : null;
    var ORDER = [0x1000, 0x2000, 0x4000, 0x8000, 0x0100, 0x0200, 0, 0, 0x0020, 0x0010, 0x0040, 0x0080, 0x0001, 0x0002, 0x0004, 0x0008, 0];
    global.__dovahhubPad = function (mask, lt, rt, lx, ly, rx, ry) {
      var first = !fed;
      if (first) fed = { id: 'DovahHub (fed by the game)', index: 0, connected: true, mapping: 'standard', timestamp: 0, buttons: [], axes: [0, 0, 0, 0] };
      for (var i = 0; i < ORDER.length; i++) {
        var value = i === 6 ? lt : i === 7 ? rt : (mask & ORDER[i]) ? 1 : 0;
        fed.buttons[i] = { pressed: value > 0.5, touched: value > 0, value: value };
      }
      fed.axes = [lx, -ly, rx, -ry];  // the game's sticks point up; the gamepad API points down
      fed.timestamp = performance.now();
    };
    navigator.getGamepads = function () { return fed ? [fed] : ownPads ? ownPads() : []; };
  }

  var ACTIONS = { dpadUp: 'up', dpadDown: 'down', dpadLeft: 'left', dpadRight: 'right', south: 'accept', east: 'cancel',
    leftShoulder: 'previousTab', rightShoulder: 'nextTab', west: 'secondary', north: 'tertiary', rightThumb: 'toggleCursor' };
  // Standard-mapping button index -> control name (16, the guide button, stays the game's).
  var BUTTONS = ['south', 'east', 'west', 'north', 'leftShoulder', 'rightShoulder', 'leftTrigger', 'rightTrigger',
    'back', 'start', 'leftThumb', 'rightThumb', 'dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight'];
  var BINDINGS = Object.freeze({ up: 'dpadUp', down: 'dpadDown', left: 'dpadLeft', right: 'dpadRight', accept: 'south', cancel: 'east',
    previousTab: 'leftShoulder', nextTab: 'rightShoulder', secondary: 'west', tertiary: 'north', toggleCursor: 'rightThumb' });
  var REPEAT_DELAY = 380, REPEAT_RATE = 90, STICK_ON = 0.5, STICK_OFF = 0.35, SCROLL_DEAD = 0.15;
  var TEXT_SKIP = ['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'image', 'hidden', 'range', 'color'];

  var state = Object.freeze({ enabled: true, active: false, connected: false, mode: 'navigation', device: 'keyboardMouse',
    glyphFamily: 'xbox', bindings: BINDINGS });
  var actionHandlers = [];
  var stateHandlers = [];
  var scopes = [];
  var editing = null;
  var sequence = 0;

  // ---------- state ----------

  function setState(changes) {
    var changed = false;
    Object.keys(changes).forEach(function (k) { if (state[k] !== changes[k]) changed = true; });
    if (!changed) return;
    var next = {};
    Object.keys(state).forEach(function (k) { next[k] = state[k]; });
    Object.keys(changes).forEach(function (k) { next[k] = changes[k]; });
    state = Object.freeze(next);
    document.documentElement.dataset.meridianInput = state.device === 'gamepad' ? 'gamepad' : 'keyboardMouse';
    stateHandlers.slice().forEach(function (fn) { try { fn(state); } catch (e) { console.error('controller state handler', e); } });
  }

  // ---------- the highlight ----------

  function isText(el) {
    return !!el && (el.isContentEditable || el.tagName === 'TEXTAREA' ||
      (el.tagName === 'INPUT' && TEXT_SKIP.indexOf((el.type || 'text').toLowerCase()) < 0));
  }
  function identity(el) { return el ? ((el.dataset && el.dataset.meridianId) || el.id || '') : ''; }
  function top() { return scopes[scopes.length - 1]; }

  function visible(el) {
    if (!el || !el.isConnected || el.tabIndex < 0 || el.matches(':disabled,[aria-disabled=true]') ||
        el.closest('[hidden],[inert],[aria-hidden=true]')) return false;
    var cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.visibility !== 'collapse' && el.getClientRects().length > 0;
  }

  var FOCUSABLE = 'button,input,select,textarea,a[href],[tabindex],[data-meridian-focusable]';

  function candidates(scope) {
    if (!scope || !scope.root.isConnected) return [];
    var nodes = scope.getCandidates ? scope.getCandidates() : scope.root.querySelectorAll(FOCUSABLE);
    return Array.prototype.filter.call(nodes, function (el) { return scope.root.contains(el) && visible(el); });
  }

  function mark(scope, el) {
    scope.root.querySelectorAll('[data-meridian-focused]').forEach(function (e) { if (e !== el) e.removeAttribute('data-meridian-focused'); });
    if (el) el.setAttribute('data-meridian-focused', '');
  }

  function focus(scope, el) {
    if (!el || !visible(el)) return;
    if (editing && editing !== el) editing = null;
    mark(scope, el);
    scope.selected = el;
    scope.selectedId = identity(el);
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function initialOf(scope, items) {
    var initial = scope.initialFocus;
    if (typeof initial === 'function') { try { initial = initial(); } catch (e) { initial = null; } }
    else if (typeof initial === 'string') { var id = initial; initial = items.filter(function (e) { return identity(e) === id; })[0]; }
    return items.indexOf(initial) >= 0 ? initial : null;
  }

  // The highlight stays on the same element (or the one with its id after a
  // rebuild); if that's gone, the scope's initial focus, else the first.
  function recover(scope) {
    if (!scope || scope !== top()) return;
    // Usually the highlight is still there; checking every control on each change made the
    // controller lag on long lists.
    if (scope.selected && scope.root.contains(scope.selected) && visible(scope.selected)) return;
    var items = candidates(scope);
    var same = scope.selectedId ? items.filter(function (e) { return identity(e) === scope.selectedId; })[0] : null;
    focus(scope, same || initialOf(scope, items) || items[0]);
  }

  function navigate(scope, direction) {
    recover(scope);
    var items = candidates(scope), current = scope.selected;
    if (!current || !items.length) return;
    var explicit = current.getAttribute('data-meridian-' + direction);
    if (explicit) {
      var neighbour = items.filter(function (e) { return identity(e) === explicit; })[0];
      if (neighbour) focus(scope, neighbour);
      return;
    }
    var r = current.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var horizontal = direction === 'left' || direction === 'right';
    var positive = direction === 'right' || direction === 'down';
    var best = null;
    items.forEach(function (el, index) {
      if (el === current) return;
      var b = el.getBoundingClientRect();
      var dx = b.left + b.width / 2 - cx, dy = b.top + b.height / 2 - cy;
      var along = (horizontal ? dx : dy) * (positive ? 1 : -1);
      if (along <= 1) return;
      var score = along + Math.abs(horizontal ? dy : dx) * 2;
      if (!best || score < best.score || (score === best.score && index < best.index)) best = { el: el, score: score, index: index };
    });
    if (best) focus(scope, best.el);
    else if (scope.wrap) focus(scope, positive ? items[0] : items[items.length - 1]);
  }

  // A number changed with the D-pad is sent once, when it's left (A, B or moving on), as a typed one
  // is: each step would otherwise reach the game (the Settings port restarts the web server).
  var stepping = typeof WeakMap === 'function' ? new WeakMap() : null;
  function commitOnLeave(el) {
    if (!stepping) return false;
    if (stepping.has(el)) return true;
    stepping.set(el, el.value);
    el.addEventListener('blur', function done() {
      el.removeEventListener('blur', done);
      var start = stepping.get(el);
      stepping.delete(el);
      if (el.value !== start) el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    return true;
  }

  function adjust(el, direction) {
    var sign = direction === 'left' || direction === 'down' ? -1 : 1;
    if (el.matches('input[type=range],input[type=number]')) {
      // A number with no min or max has no end that way.
      var number = el.type === 'number';
      var min = el.min !== '' ? Number(el.min) : number ? -Infinity : 0;
      var max = el.max !== '' ? Number(el.max) : number ? Infinity : 100;
      var step = Number(el.step || 1);
      var value = Math.min(max, Math.max(min, Number(el.value) + sign * (isFinite(step) ? step : 1)));
      if (value !== Number(el.value)) {
        var later = number && commitOnLeave(el);
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        if (!later) el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    if (el.matches('select')) {
      var dir = direction === 'up' || direction === 'left' ? -1 : 1;
      var next = el.selectedIndex + dir;
      while (next >= 0 && next < el.options.length && el.options[next].disabled) next += dir;
      if (next >= 0 && next < el.options.length) {
        el.selectedIndex = next;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  // Each direction moves the nearest panel that really scrolls that way. A panel with its sideways
  // overflow hidden can still be pushed sideways from script, which slid the view off screen.
  function scroller(scope, horizontal) {
    for (var el = scope.selected || scope.root; el; el = el === scope.root ? null : el.parentElement) {
      var cs = getComputedStyle(el);
      var overflow = horizontal ? cs.overflowX : cs.overflowY;
      if (/(auto|scroll)/.test(overflow) &&
          (horizontal ? el.scrollWidth > el.clientWidth : el.scrollHeight > el.clientHeight)) return el;
    }
    return null;
  }

  function scroll(scope, event) {
    var down = event.y && scroller(scope, false);
    if (down) down.scrollTop -= event.y * 600 * event.dt;
    var across = event.x && scroller(scope, true);
    if (across) across.scrollLeft += event.x * 600 * event.dt;
  }

  function call(fn, arg) {
    try { return fn(arg) === true; } catch (e) { console.error('controller handler', e); return true; }
  }

  function defaultAction(event) {
    var scope = top();
    if (!scope) return;
    recover(scope);
    if (scope.onAction && call(scope.onAction, event)) return;
    if (event.control === 'rightStick' && event.phase === 'change') { scroll(scope, event); return; }
    var action = event.action;
    if (event.phase !== 'press' && event.phase !== 'repeat') return;
    if ((action === 'previousTab' || action === 'nextTab') && event.phase === 'press') {
      var tabs = candidates(scope).filter(function (e) { return e.getAttribute('role') === 'tab'; });
      var at = -1;
      tabs.forEach(function (t, i) { if (t.getAttribute('aria-selected') === 'true') at = i; });
      var next = tabs[Math.max(0, Math.min(tabs.length - 1, (at < 0 ? 0 : at) + (action === 'nextTab' ? 1 : -1)))];
      if (next) { focus(scope, next); next.click(); }
      return;
    }
    if (action === 'cancel') {
      if (event.phase !== 'press') return;
      if (editing) { if (editing.blur) editing.blur(); editing = null; return; }
      if (scope.onBack) call(scope.onBack, event);
      return;
    }
    if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
      // A number steps like a slider (DHUB-113: the Settings port); other text waits for the keyboard.
      if (editing) { if (!isText(editing) || editing.matches('input[type=number]')) adjust(editing, action); return; }
      navigate(scope, action);
      return;
    }
    if (action === 'accept' && event.phase === 'press' && state.mode === 'navigation') {
      var selected = scope.selected;
      if (!selected || !visible(selected)) return;
      // DHUB-134: A on a dropdown opens its list (dropdowns.js), run by the pad: Up / Down in it, A chooses, B closes.
      // It is never edited with the D-pad, so it never changes a step at a time and never holds the highlight.
      if (selected.matches('select') && global.DovahHubChoices && global.DovahHubChoices.openSelect(selected)) return;
      if (isText(selected) || selected.matches('input[type=range],select')) {
        if (editing === selected) { editing = null; selected.blur(); } else { editing = selected; selected.focus(); }
      } else {
        selected.click();
      }
    }
  }

  function dispatch(event) {
    var e = Object.freeze(event);
    var handled = false;
    actionHandlers.slice().forEach(function (fn) { if (call(fn, e)) handled = true; });
    if (!handled) defaultAction(e);
  }

  function makeEvent(control, action, phase, extra) {
    sequence += 1;
    var event = { control: control, action: action || 'none', phase: phase, generation: 0, sequence: sequence, x: 0, y: 0, value: 0, dt: 0 };
    if (extra) Object.keys(extra).forEach(function (k) { event[k] = extra[k]; });
    return event;
  }

  // ---------- the gamepad ----------

  var held = null;          // control -> pressed, from the last poll; null = take as-is
  var repeatTimers = {};    // control -> timer
  var stickDir = null;      // the left stick's current direction
  var lastTime = 0;
  var rightWasActive = false;
  var sawFocus = false;

  function listening() {
    if (document.hidden) return false;
    if (typeof document.hasFocus !== 'function') return true;
    if (document.hasFocus()) { sawFocus = true; return true; }
    return !sawFocus;
  }

  function startRepeat(control, action) {
    stopRepeat(control);
    repeatTimers[control] = setTimeout(function tick() {
      dispatch(makeEvent(control, action, 'repeat'));
      repeatTimers[control] = setTimeout(tick, REPEAT_RATE);
    }, REPEAT_DELAY);
  }
  function stopRepeat(control) {
    if (repeatTimers[control]) { clearTimeout(repeatTimers[control]); delete repeatTimers[control]; }
  }

  function press(control, value) {
    var action = ACTIONS[control] || 'none';
    setState({ device: 'gamepad', active: true, connected: true });
    dispatch(makeEvent(control, action, 'press', { value: value || 1 }));
    if (action === 'up' || action === 'down' || action === 'left' || action === 'right') startRepeat(control, action);
  }
  function release(control) {
    stopRepeat(control);
    dispatch(makeEvent(control, ACTIONS[control] || 'none', 'release'));
  }

  function cancelAll() {
    Object.keys(repeatTimers).forEach(stopRepeat);
    if (held) dispatch(makeEvent('none', 'none', 'cancel'));
    held = null;
    stickDir = null;
    rightWasActive = false;
  }

  function firstPad() {
    var pads = navigator.getGamepads() || [];
    for (var i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected !== false) return pads[i];
    return null;
  }

  // The page stays loaded all game, so polling stops while the menu is closed
  // (native calls dovahhubClosed / dovahhubOpening).
  var polling = false;
  var paused = false;
  function startPolling() {
    if (polling || paused || typeof navigator.getGamepads !== 'function') return;
    polling = true;
    lastTime = 0;
    requestAnimationFrame(poll);
  }
  // For a moment after opening, whatever is held is taken as held, not pressed: the pad's first
  // reading can be from before the close, so the open chord (RB + A) read as a fresh RB, and the
  // tab moved one to the right.
  var SETTLE_MS = 300;
  var settleUntil = 0;
  global.dovahhubInputPaused = function (on) {
    paused = !!on;
    if (!paused) {
      settleUntil = (global.performance ? global.performance.now() : Date.now()) + SETTLE_MS;
      startPolling();
    }
  };

  function poll(now) {
    if (paused) {
      polling = false;
      if (held) cancelAll();
      return;
    }
    requestAnimationFrame(poll);
    var dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
    lastTime = now;
    var pad = firstPad();
    if (!!pad !== state.connected) setState({ connected: !!pad });
    // In a web browser the pad is the game's too: only listen while this window is the active one.
    var elsewhere = document.documentElement.classList.contains('is-web') && !document.hasFocus();
    if (!pad || !listening() || elsewhere) { if (held) cancelAll(); return; }
    var buttons = pad.buttons || [], axes = pad.axes || [];
    var current = {};
    BUTTONS.forEach(function (name, i) {
      var b = buttons[i];
      // Triggers are analogue: on past half, off below a third.
      if (name === 'leftTrigger' || name === 'rightTrigger') {
        var v = b ? b.value : 0;
        current[name] = held && held[name] ? v > 0.3 : v > 0.5;
      } else {
        current[name] = !!(b && b.pressed);
      }
    });
    if (!held || now < settleUntil) { held = current; return; }  // what's held at open or refocus doesn't fire
    BUTTONS.forEach(function (name) {
      if (current[name] && !held[name]) press(name, name.indexOf('Trigger') > 0 ? buttons[BUTTONS.indexOf(name)].value : 1);
      else if (!current[name] && held[name]) release(name);
    });
    held = current;

    // Left stick: a D-pad (its main direction past the dead zone).
    var lx = axes[0] || 0, ly = -(axes[1] || 0);
    var mag = Math.max(Math.abs(lx), Math.abs(ly));
    var dir = null;
    if (mag >= STICK_ON) dir = Math.abs(lx) > Math.abs(ly) ? (lx > 0 ? 'right' : 'left') : (ly > 0 ? 'up' : 'down');
    else if (stickDir && mag >= STICK_OFF) dir = stickDir;
    if (dir !== stickDir) {
      if (stickDir) { stopRepeat('leftStick'); dispatch(makeEvent('leftStick', stickDir, 'release')); }
      stickDir = dir;
      if (dir) {
        setState({ device: 'gamepad', active: true });
        dispatch(makeEvent('leftStick', dir, 'press'));
        startRepeat('leftStick', dir);
      }
    }

    // Right stick: continuous (scrolls, or turns a 3D preview).
    var rx = axes[2] || 0, ry = -(axes[3] || 0);
    var rightActive = Math.abs(rx) > SCROLL_DEAD || Math.abs(ry) > SCROLL_DEAD;
    if (rightActive || rightWasActive) {
      if (rightActive) setState({ device: 'gamepad', active: true });
      dispatch(makeEvent('rightStick', 'none', 'change', {
        x: rightActive ? rx : 0, y: rightActive ? ry : 0, value: Math.max(Math.abs(rx), Math.abs(ry)), dt: dt }));
    }
    rightWasActive = rightActive;
  }

  // ---------- mouse and keyboard take over ----------

  var mouseX = -1, mouseY = -1;
  document.addEventListener('mousemove', function (e) {
    if (mouseX >= 0 && (Math.abs(e.clientX - mouseX) > 2 || Math.abs(e.clientY - mouseY) > 2)) setState({ device: 'keyboardMouse' });
    mouseX = e.clientX; mouseY = e.clientY;
  }, true);
  document.addEventListener('mousedown', function (e) {
    setState({ device: 'keyboardMouse' });
    editing = isText(e.target) ? e.target : null;
  }, true);
  document.addEventListener('keydown', function () {
    if (isText(document.activeElement)) editing = document.activeElement;
  }, true);
  document.addEventListener('focusin', function (e) {
    var scope = top();
    var el = e.target;
    if (scope && el instanceof Element && scope.root.contains(el) &&
        (scope.getCandidates ? candidates(scope).indexOf(el) >= 0 : el.matches(FOCUSABLE) && visible(el))) {
      mark(scope, e.target);
      scope.selected = e.target;
      scope.selectedId = identity(e.target);
      if (editing && editing !== e.target) editing = null;
    }
  });
  global.addEventListener('blur', function () { editing = null; });

  // ---------- the interface ----------

  function attachNavigation(options) {
    if (!options || !options.root || !options.root.querySelectorAll) throw new TypeError('A navigation root is required');
    var scope = {};
    Object.keys(options).forEach(function (k) { scope[k] = options[k]; });
    scope.selected = null;
    scope.selectedId = '';
    scopes.push(scope);
    recover(scope);
    var observer = new MutationObserver(function () { recover(scope); });
    observer.observe(scope.root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['disabled', 'hidden', 'inert', 'aria-disabled', 'class', 'style', 'tabindex'] });
    var disposed = false;
    return function dispose() {
      if (disposed) return;
      disposed = true;
      observer.disconnect();
      var wasTop = top() === scope;
      var i = scopes.indexOf(scope);
      if (i >= 0) scopes.splice(i, 1);
      scope.root.querySelectorAll('[data-meridian-focused]').forEach(function (e) { e.removeAttribute('data-meridian-focused'); });
      if (editing && scope.root.contains(editing)) editing = null;
      if (wasTop) {
        var parent = top();
        if (parent) { var selected = parent.selected; parent.selected = null; parent.initialFocus = selected; recover(parent); }
      }
    };
  }

  function subscribe(list, handler) {
    if (typeof handler !== 'function') throw new TypeError('Handler required');
    list.push(handler);
    return function () { var i = list.indexOf(handler); if (i >= 0) list.splice(i, 1); };
  }

  var LABELS = {
    xbox: { south: 'A', east: 'B', west: 'X', north: 'Y', leftShoulder: 'LB', rightShoulder: 'RB', leftTrigger: 'LT', rightTrigger: 'RT',
      leftThumb: 'LS', rightThumb: 'RS', start: 'Menu', back: 'View' }
  };
  var DPAD = { dpadUp: 'D-pad Up', dpadDown: 'D-pad Down', dpadLeft: 'D-pad Left', dpadRight: 'D-pad Right', none: '' };
  // Button names in the page's language (Menu, View and the D-pad have names; letters stay).
  function shown(label) {
    return global.DovahHubI18n && /^(?:Menu|View|D-pad (?:Up|Down|Left|Right))$/.test(label) ? String(global.DovahHubI18n.phrase(label)) : label;
  }

  Object.defineProperty(global, 'MeridianInput', { configurable: true, value: Object.freeze({
    version: 1,
    getState: function () { return state; },
    onAction: function (h) { return subscribe(actionHandlers, h); },
    onStateChange: function (h) { return subscribe(stateHandlers, h); },
    setMode: function () {},  // cursor mode isn't offered under PrismaUI (it has its own mouse cursor)
    getPrompt: function (action) {
      var control = BINDINGS[action] || 'none';
      return Object.freeze({ action: action, control: control, family: state.glyphFamily,
        label: control === 'none' ? '' : shown(LABELS.xbox[control] || DPAD[control] || control) });
    },
    attachNavigation: attachNavigation
  }) });

  document.documentElement.dataset.meridianInput = 'keyboardMouse';
  startPolling();
})(window);
