// MiniPets' tab in DovahHub. The HUD page owns the pet: this asks the plugin for the state
// through DovahHub's relay, shows it (ticked with PetLife for display only, never saved), and sends
// Feed, Play and the companion choice back the same way. pet-life.js and pet-sprites.js here are
// copies of view/, refreshed by the build.
(function () {
  'use strict';
  const mod = window.dovahhubModule && window.dovahhubModule('pets');
  if (!mod || !mod.root) return;
  const life = window.PetLife;
  const sprites = window.PetSprites;
  const root = mod.root;
  const doc = root.ownerDocument;
  const slot = name => root.querySelector('[data-pets="' + name + '"]');
  const els = {
    pet: slot('pet'), sprite: slot('sprite'), name: slot('name'), stage: slot('stage'), needs: slot('needs'),
    needWarmth: slot('need-warmth'), needFood: slot('need-food'), needHappiness: slot('need-happiness'),
    barWarmth: slot('bar-warmth'), barFood: slot('bar-food'), barHappiness: slot('bar-happiness'),
    numWarmth: slot('num-warmth'), numFood: slot('num-food'), numHappiness: slot('num-happiness'),
    feed: slot('feed'), play: slot('play'), result: slot('result'), facts: slot('facts'),
    picker: slot('picker'), pickerNote: slot('picker-note'), pickerToggle: slot('picker-toggle'),
    pickerCurrent: slot('picker-current')
  };
  const MOODS = { happy: 'very happy', content: 'doing fine', hungry: 'hungry', sad: 'lonely', miserable: 'needs food and attention' };
  const STAGES = { baby: 'Baby', young: 'Young', adult: 'All grown up' };
  const ADULT_DAYS = 5;
  // pets.css animates by these, as the HUD card does
  const ARCHETYPES = ['light', 'heavy', 'hover', 'flyer', 'egg'];
  let state = null;
  // the companion buttons are built once, then only re-marked
  let pickerFor = '';
  // while raising a pet the grid sits behind "Change HUD companion", so Feed and Play lead
  let pickerOpen = false;

  function el(tag, className, text) {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function nameOf(id) {
    const found = state && Array.isArray(state.companions) ? state.companions.find(entry => entry.id === id) : null;
    return found ? found.name : sprites.names[id] || id || 'Dovahmin';
  }

  // "Ember the Fox", or just "Dovahmin"
  function fullName(id) {
    const kind = sprites.species[id];
    return kind ? nameOf(id) + ' the ' + kind : nameOf(id);
  }

  // the saved pet moved on to now, for display
  function shownPet() {
    if (!state || !state.raisePet || !state.pet) return null;
    const hours = Number.isFinite(state.hours) ? state.hours : state.pet.lastTick;
    return life.tick(state.pet, hours).pet;
  }

  function hours() {
    return state && Number.isFinite(state.hours) ? state.hours : 0;
  }

  function markArchetype(node, archetype) {
    ARCHETYPES.forEach(name => node.classList.remove('archetype-' + name));
    node.classList.add('archetype-' + (ARCHETYPES.includes(archetype) ? archetype : 'light'));
  }

  function renderSprite(pet) {
    els.sprite.style.transform = '';
    els.pet.classList.remove('is-sad');
    if (!state.raisePet) {
      markArchetype(els.pet, sprites.render(els.sprite, state.companion).archetype);
      return;
    }
    if (!pet || pet.stage === 'egg') {
      sprites.renderEgg(els.sprite, pet ? pet.species : null);
      markArchetype(els.pet, 'egg');
      return;
    }
    markArchetype(els.pet, sprites.render(els.sprite, pet.species).archetype);
    const growth = life.GROWTH_SCALE[life.growth(pet, hours())] || 1;
    if (growth !== 1) els.sprite.style.transform = 'scale(' + growth + ')';
    if (['hungry', 'sad', 'miserable'].includes(life.mood(pet))) els.pet.classList.add('is-sad');
  }

  // the number sits next to the bar, so an empty bar reads as 0
  function bar(node, number, value) {
    const shown = Math.round(Math.min(100, Math.max(0, value)));
    node.style.width = shown + '%';
    number.textContent = String(shown);
    node.classList.toggle('is-low', value < 30);
    number.classList.toggle('is-low', value < 30);
  }

  function renderNeeds(pet) {
    const egg = pet && pet.stage === 'egg';
    els.needs.hidden = !pet;
    els.needWarmth.hidden = !egg;
    els.needFood.hidden = egg;
    els.needHappiness.hidden = egg;
    if (!pet) return;
    if (egg) bar(els.barWarmth, els.numWarmth, life.eggProgress(pet) * 100);
    else {
      bar(els.barFood, els.numFood, pet.hunger);
      bar(els.barHappiness, els.numHappiness, pet.happiness);
    }
  }

  function renderButtons(pet) {
    const egg = pet && pet.stage === 'egg';
    els.feed.disabled = !pet || egg;
    els.play.disabled = !pet;
    els.feed.textContent = egg ? 'Feed (after hatching)' : 'Feed';
    els.play.textContent = egg ? 'Cuddle' : 'Play';
  }

  function daysText(days) {
    const whole = Math.max(1, Math.round(days));
    return whole + (whole === 1 ? ' day' : ' days');
  }

  function fact(term, detail) {
    const row = el('div');
    row.append(el('dt', '', term), el('dd', '', detail));
    els.facts.append(row);
  }

  function renderFacts(pet) {
    els.facts.textContent = '';
    if (!state.raisePet) {
      fact('Companion', fullName(state.companion));
      fact('Raise a pet', 'Off. Turn it on in Settings to hatch an egg.');
    } else if (!pet) {
      fact('Egg', 'None yet. Pick one on the HUD card (' + (state.hotkeys ? state.hotkeys.settings : 'Shift+B') + ').');
    } else if (pet.stage === 'egg') {
      fact('Warmth', Math.round(life.eggProgress(pet) * 100) + '% of the way to hatching');
      fact('Hatches', 'With XP, level-ups and time');
    } else {
      const age = (hours() - pet.hatchedAt) / 24;
      fact('Hatched', age < 1 ? 'Today' : daysText(age) + ' ago');
      fact('Grows up', life.growth(pet, hours()) === 'adult' ? 'All grown up' : 'In ' + daysText(ADULT_DAYS - age));
    }
    fact('Food in pack', String(Number.isFinite(state.food) ? state.food : 0));
    if (state.hotkeys) {
      fact('Keys', 'Feed ' + state.hotkeys.feed + ', play ' + state.hotkeys.play + ', hide ' + state.hotkeys.hide);
    }
  }

  function renderPicker() {
    const ids = Array.isArray(state.companions) ? state.companions.map(entry => entry.id) : Object.keys(sprites.names);
    const key = ids.join('|');
    if (key !== pickerFor) {
      pickerFor = key;
      els.picker.textContent = '';
      ids.forEach(id => {
        const button = el('button');
        button.type = 'button';
        button.dataset.companion = id;
        const thumb = el('div', 'pets-thumb');
        const motion = el('div', 'pet-motion');
        const body = el('div', 'pet-body');
        const art = el('div', 'pet-sprite');
        body.append(art);
        motion.append(body);
        thumb.append(motion);
        button.append(thumb, el('span', '', nameOf(id)));
        markArchetype(thumb, sprites.render(art, id, { pixel: 2 }).archetype);
        button.addEventListener('click', () => choose(id));
        els.picker.append(button);
      });
    }
    Array.from(els.picker.children).forEach(button => {
      button.setAttribute('aria-pressed', button.dataset.companion === state.companion ? 'true' : 'false');
    });
    els.pickerNote.textContent = state.raisePet
      ? 'The card shows the pet you are raising.'
      : 'Pick who sits on your HUD.';
    els.pickerToggle.hidden = !state.raisePet;
    els.pickerToggle.textContent = pickerOpen ? 'Hide companions' : 'Change HUD companion (' + nameOf(state.companion) + ')';
    els.picker.hidden = Boolean(state.raisePet) && !pickerOpen;
    els.pickerCurrent.textContent = '';
    els.pickerCurrent.append(
      el('span', '', state.raisePet ? 'On your HUD when raise-a-pet is off: ' : 'On your HUD: '),
      el('b', '', fullName(state.companion))
    );
  }

  function render() {
    if (!state) return;
    const pet = shownPet();
    renderSprite(pet);
    if (!state.raisePet) {
      els.name.textContent = fullName(state.companion);
      els.stage.textContent = 'Your HUD companion';
    } else if (!pet) {
      els.name.textContent = 'No egg yet';
      els.stage.textContent = 'Pick an egg on the HUD card to start raising a pet';
    } else if (pet.stage === 'egg') {
      els.name.textContent = nameOf(pet.species) + '’s egg';
      els.stage.textContent = 'Egg, ' + Math.round(life.eggProgress(pet) * 100) + '% warm';
    } else {
      els.name.textContent = fullName(pet.species);
      els.stage.textContent = STAGES[life.growth(pet, hours())] + ', ' + MOODS[life.mood(pet)];
    }
    renderNeeds(pet);
    renderButtons(pet);
    renderFacts(pet);
    renderPicker();
  }

  // worded like the HUD card's notices
  function resultText(result) {
    const pet = state && state.pet;
    const name = pet ? nameOf(pet.species) : 'Your pet';
    const egg = pet && pet.stage === 'egg';
    if (result.ok) {
      if (result.action === 'feed') return name + ' ate well. Mmm, ' + (result.food || 'a snack') + '!';
      return result.reason === 'egg' ? 'You cuddle the egg. It feels a little warmer.' : name + ' loves playing! Happiness is up.';
    }
    switch (result.reason) {
      case 'full': return name + ' is full. Try again later.';
      case 'egg': return 'Eggs don’t eat. Keep it warm with XP instead.';
      case 'tired': return egg ? 'The egg is cosy. Give it a little while.' : name + ' is tired. Let them rest for a bit.';
      case 'no food': return 'No food in your pack. Pick up something to eat first.';
      case 'no pet': return 'No egg yet. Pick one on the HUD card.';
      default: return result.reason ? String(result.reason) : 'Nothing happened.';
    }
  }

  function showResult(result) {
    if (!result || typeof result !== 'object') return;
    els.result.textContent = resultText(result);
  }

  function act(action) {
    els.result.textContent = '…';
    mod.call(action, {}).then(reply => {
      if (!reply) return;
      if (reply.error) els.result.textContent = 'DovahHub could not reach MiniPets (' + reply.error + ').';
      else if (reply.ok === false) showResult(Object.assign({ action }, reply));
      // {"queued":true}: the outcome arrives as a push
    });
  }

  function choose(id) {
    if (!state || id === state.companion) return;
    mod.call('companion', { pet: id }).then(reply => {
      if (reply && reply.error) {
        els.result.textContent = 'DovahHub could not reach MiniPets (' + reply.error + ').';
        return;
      }
      if (!reply || reply.ok === false) {
        els.result.textContent = 'MiniPets does not know that companion.';
        return;
      }
      // the plugin pushes the new state too; show the change straight away
      state = Object.assign({}, state, { companion: id });
      renderPicker();
      els.result.textContent = state.raisePet
        ? nameOf(id) + ' will sit on your HUD when raise-a-pet is off.'
        : nameOf(id) + ' is on your HUD now.';
    });
  }

  function refresh() {
    mod.call('state', {}).then(reply => {
      if (!reply || reply.error) {
        els.name.textContent = 'MiniPets is not answering';
        els.stage.textContent = reply && reply.error ? String(reply.error) : '';
        return;
      }
      state = reply;
      render();
    });
  }

  els.feed.addEventListener('click', () => act('feed'));
  els.pickerToggle.addEventListener('click', () => {
    pickerOpen = !pickerOpen;
    if (state) renderPicker();
  });
  els.play.addEventListener('click', () => act('play'));
  mod.onEvent(name => { if (name === 'tabShown') refresh(); });
  mod.onPush(json => {
    let data = json;
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch (error) { return; }
    }
    if (!data || typeof data !== 'object') return;
    if (data.state && typeof data.state === 'object') {
      state = data.state;
      render();
    }
    if (data.result) showResult(data.result);
  });
})();
