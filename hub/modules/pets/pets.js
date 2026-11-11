// MiniPets' tab in DovahHub. The HUD page owns the pet: this asks the plugin for the state
// through DovahHub's relay, shows it (ticked with PetLife for display only, never saved), and sends
// Feed, Play and the companion choice back the same way. i18n.js, pet-life.js and pet-sprites.js
// here are copies of view/, refreshed by the build. Text follows MiniPets' own Language setting.
(function () {
  'use strict';
  const mod = window.dovahhubModule && window.dovahhubModule('pets');
  if (!mod || !mod.root) return;
  const life = window.PetLife;
  const sprites = window.PetSprites;
  // the HUD page's catalogue; without it (a broken install) the keys show, and the tab still works
  const i18n = window.PetI18n || { t: key => key, plural: key => key, setLanguage() {}, apply() {}, species: id => sprites.species[id] || '' };
  const t = (key, vars) => i18n.t(key, vars);
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
  // catalogue keys for the mood and growth stage shown under the name
  const MOODS = { happy: 'moodHappy', content: 'moodContent', hungry: 'moodHungry', sad: 'moodSad', miserable: 'moodMiserable' };
  const STAGES = { baby: 'tabStageBaby', young: 'tabStageYoung', adult: 'tabStageAdult', seasoned: 'tabStageSeasoned', elder: 'tabStageElder' };
  // the newest few of what the pet remembers (DMP-13)
  const MEMORIES_SHOWN = 5;
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
    const kind = sprites.species[id] ? i18n.species(id) : '';
    return kind ? t('tabNameSpecies', { name: nameOf(id), species: kind }) : nameOf(id);
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
    els.feed.textContent = egg ? t('feedAfterHatching') : t('feed');
    els.play.textContent = egg ? t('cuddle') : t('play');
  }

  function daysText(days) {
    const whole = Math.max(1, Math.round(days));
    return i18n.plural('days', whole);
  }

  // the same words the HUD card uses when the pet brings a memory up
  function memoryWords(memory) {
    if (memory.k === 'dragon') return t('memoryDragon');
    if (memory.k === 'boss') return t('memoryBoss', { subject: memory.s });
    if (memory.k === 'place') return memory.id === 'home' ? t('memoryHome') : t('memoryPlace', { place: memory.s });
    if (memory.k === 'milestone') return t('memoryMilestone', { subject: memory.s });
    return t('memoryLevel', { level: memory.s });
  }

  function renderMemories(pet) {
    const memories = Array.isArray(pet.memories) ? pet.memories.slice(-MEMORIES_SHOWN).reverse() : [];
    fact(t('tabMemories'), memories.length ? '' : t('tabNoMemories'));
    const today = Math.floor(hours() / 24);
    memories.forEach(memory => {
      const days = today - memory.d;
      fact(memoryWords(memory), days < 1 ? t('factToday') : t('factAgo', { time: daysText(days) }));
    });
  }

  function fact(term, detail) {
    const row = el('div');
    row.append(el('dt', '', term), el('dd', '', detail));
    els.facts.append(row);
  }

  function renderFacts(pet) {
    els.facts.textContent = '';
    if (!state.raisePet) {
      fact(t('factCompanion'), fullName(state.companion));
      fact(t('raisePet'), t('factRaisePetOff'));
    } else if (!pet) {
      fact(t('factEgg'), t('factEggNone', { key: state.hotkeys ? state.hotkeys.settings : 'Shift+B' }));
    } else if (pet.stage === 'egg') {
      fact(t('warmth'), t('factWarmthDetail', { percent: Math.round(life.eggProgress(pet) * 100) }));
      fact(t('factHatches'), t('factHatchesDetail'));
    } else {
      const age = (hours() - pet.hatchedAt) / 24;
      fact(t('factHatched'), age < 1 ? t('factToday') : t('factAgo', { time: daysText(age) }));
      const stage = life.growth(pet, hours());
      if (stage === 'baby' || stage === 'young') fact(t('factGrowsUp'), t('factGrowsIn', { time: daysText(ADULT_DAYS - age) }));
      else {
        // DMP-13: a grown pet still has seasoned and elder ahead of it
        const next = { adult: 'seasoned', seasoned: 'elder' }[stage];
        fact(t('factNextStage'), next ? t('factNextStageIn', { stage: t(STAGES[next]), time: daysText(life.STAGE_DAYS[next] - age) }) : t('tabStageElder'));
      }
      renderMemories(pet);
    }
    fact(t('factFoodInPack'), String(Number.isFinite(state.food) ? state.food : 0));
    if (state.hotkeys) {
      fact(t('factKeys'), t('factKeysDetail', { feed: state.hotkeys.feed, play: state.hotkeys.play, hide: state.hotkeys.hide }));
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
    els.pickerNote.textContent = state.raisePet ? t('tabPickerRaising') : t('tabPickerPick');
    els.pickerToggle.hidden = !state.raisePet;
    els.pickerToggle.textContent = pickerOpen ? t('tabHideCompanions') : t('tabChangeCompanionNamed', { name: nameOf(state.companion) });
    els.picker.hidden = Boolean(state.raisePet) && !pickerOpen;
    els.pickerCurrent.textContent = '';
    els.pickerCurrent.append(
      el('span', '', (state.raisePet ? t('tabOnHudWhenOff') : t('tabOnHud')) + ' '),
      el('b', '', fullName(state.companion))
    );
  }

  function render() {
    if (!state) return;
    i18n.setLanguage(state.language);
    i18n.apply(root);
    const pet = shownPet();
    renderSprite(pet);
    if (!state.raisePet) {
      els.name.textContent = fullName(state.companion);
      els.stage.textContent = t('tabHudCompanion');
    } else if (!pet) {
      els.name.textContent = t('noEggTitle');
      els.stage.textContent = t('tabPickEgg');
    } else if (pet.stage === 'egg') {
      els.name.textContent = t('eggName', { name: nameOf(pet.species) });
      els.stage.textContent = t('tabEggWarm', { percent: Math.round(life.eggProgress(pet) * 100) });
    } else {
      els.name.textContent = fullName(pet.species);
      els.stage.textContent = t('tabStageMood', { stage: t(STAGES[life.growth(pet, hours())]), mood: t(MOODS[life.mood(pet)]) });
    }
    renderNeeds(pet);
    renderButtons(pet);
    renderFacts(pet);
    renderPicker();
  }

  // worded like the HUD card's notices
  function resultText(result) {
    const pet = state && state.pet;
    const name = pet ? nameOf(pet.species) : t('tabYourPet');
    const egg = pet && pet.stage === 'egg';
    if (result.ok) {
      if (result.action === 'feed') return t('resultAte', { name, food: result.food || t('resultSnack') });
      return result.reason === 'egg' ? t('resultCuddle') : t('resultPlayed', { name });
    }
    switch (result.reason) {
      case 'full': return t('resultFull', { name });
      case 'egg': return t('resultEggFood');
      case 'tired': return egg ? t('resultEggCosy') : t('resultTired', { name });
      case 'no food': return t('resultNoFood');
      case 'no pet': return t('resultNoPet');
      default: return t('resultNothing');
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
      if (reply.error) els.result.textContent = t('tabNoReach', { error: reply.error });
      else if (reply.ok === false) showResult(Object.assign({ action }, reply));
      // {"queued":true}: the outcome arrives as a push
    });
  }

  function choose(id) {
    if (!state || id === state.companion) return;
    mod.call('companion', { pet: id }).then(reply => {
      if (reply && reply.error) {
        els.result.textContent = t('tabNoReach', { error: reply.error });
        return;
      }
      if (!reply || reply.ok === false) {
        els.result.textContent = t('tabUnknownCompanion');
        return;
      }
      // the plugin pushes the new state too; show the change straight away
      state = Object.assign({}, state, { companion: id });
      renderPicker();
      els.result.textContent = state.raisePet ? t('tabWillSit', { name: nameOf(id) }) : t('tabOnHudNow', { name: nameOf(id) });
    });
  }

  function refresh() {
    mod.call('state', {}).then(reply => {
      if (!reply || reply.error) {
        els.name.textContent = t('tabNotAnswering');
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
