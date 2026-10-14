(function () {
  const root = document.querySelector('#dragonborn-xp');
  const title = document.querySelector('#title');
  const detail = document.querySelector('#detail');
  const bar = document.querySelector('.xp-bar span');
  const settingsMenu = document.querySelector('#settings-menu');
  const positionXRange = document.querySelector('#position-x');
  const positionXValue = document.querySelector('#position-x-value');
  const positionYRange = document.querySelector('#position-y');
  const positionYValue = document.querySelector('#position-y-value');
  const settingsHotkeyButton = document.querySelector('#settings-hotkey');
  const hotkeyHint = document.querySelector('#hotkey-hint');
  const petSelect = document.querySelector('#pet-select');
  const petNames = {
    dovahmin: 'Dovahmin', dovahpink: 'Dovahpink', mudcrab: 'Clack', skeever: 'Nibbles',
    fox: 'Ember', sabrecat: 'Stripes', 'frostbite-spider': 'Webber', horker: 'Waddles',
    troll: 'Grumble', 'flame-atronach': 'Cinder', 'frost-atronach': 'Shiver',
    spriggan: 'Moss', 'dwarven-spider': 'Tinker', chaurus: 'Skitter', netch: 'Bloop',
    mammoth: 'Tusker', 'dragon-priest': 'Masky', wisp: 'Glowbug', 'death-hound': 'Gnasher',
    chicken: 'Pip'
  };
  const petSpecies = {
    mudcrab: 'Mudcrab', skeever: 'Skeever', fox: 'Fox', sabrecat: 'Sabre Cat',
    'frostbite-spider': 'Frostbite Spider', horker: 'Horker', troll: 'Troll',
    'flame-atronach': 'Flame Atronach', 'frost-atronach': 'Frost Atronach', spriggan: 'Spriggan',
    'dwarven-spider': 'Dwarven Spider', chaurus: 'Chaurus', netch: 'Netch', mammoth: 'Mammoth',
    'dragon-priest': 'Dragon Priest', wisp: 'Wisp', 'death-hound': 'Death Hound', chicken: 'Chicken'
  };
  const isPreview = new URLSearchParams(window.location.search).has('preview');
  let timer;
  let companion = 'idle';
  let timeOfDay = 'day';
  let weather = 'clear';
  let positionX = null;
  let positionY = null;
  let settingsHotkey = 'Shift+B';
  let pet = 'dovahmin';
  let settingsSnapshot = null;
  let settingsOpen = false;
  let capturingHotkey = false;
  let settingsWriteTimer = 0;

  function hasCustomPosition() {
    return Number.isFinite(positionX) && Number.isFinite(positionY) && positionX >= 0 && positionY >= 0;
  }

  function applyPosition() {
    if (hasCustomPosition()) {
      root.style.inset = 'auto';
      root.style.left = `${positionX}px`;
      root.style.top = `${positionY}px`;
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      root.style.padding = '0';
      root.style.width = '256px';
      root.style.height = '256px';
      root.style.display = 'block';
    } else {
      root.style.inset = '';
      root.style.left = '';
      root.style.top = '';
      root.style.right = '';
      root.style.bottom = '';
      root.style.padding = '';
      root.style.width = '';
      root.style.height = '';
      root.style.display = '';
    }
  }

  function applySceneClasses(extra = '') {
    root.className = ['persistent', hasCustomPosition() ? 'custom-position' : '', `pet-${pet}`, `state-${companion}`, `time-${timeOfDay}`, `weather-${weather}`, extra]
      .filter(Boolean)
      .join(' ');
    applyPosition();
  }

  function updateIdleDetail() {
    if (companion === 'idle') {
      const companionName = petNames[pet] || 'Dovahmin';
      const species = petSpecies[pet];
      detail.textContent = `${companionName}${species ? ` the ${species}` : ''} is watching your progress.`;
    }
  }

  function returnToIdle() {
    companion = 'idle';
    applySceneClasses();
    title.textContent = 'Ready for adventure';
    updateIdleDetail();
    bar.style.width = '22%';
  }

  function companionState(state) {
    companion = state === 'flying' || state === 'combat' || state === 'landed' ? state : 'idle';
    if (state === 'flying') {
      applySceneClasses();
      title.textContent = 'Off you go!';
      detail.textContent = 'The little dragon takes to the sky.';
      bar.style.width = '42%';
    } else if (state === 'combat') {
      applySceneClasses();
      title.textContent = 'Breathing fire!';
      detail.textContent = 'Your dragon has joined the fight.';
      bar.style.width = '92%';
    } else if (state === 'landed') {
      applySceneClasses();
      title.textContent = 'Back on the ground';
      detail.textContent = 'Settling in for a moment.';
      bar.style.width = '22%';
      window.setTimeout(returnToIdle, 900);
    } else {
      returnToIdle();
    }
  }

  function nativeSettingsChanged() {
    if (typeof window.settingsChanged !== 'function') return;
    const x = hasCustomPosition() ? positionX : -1;
    const y = hasCustomPosition() ? positionY : -1;
    window.settingsChanged(`${x}|${y}|${settingsHotkey}|${pet}`);
  }

  function queueNativeSettingsChanged() {
    if (typeof window.settingsChanged !== 'function') return;
    window.clearTimeout(settingsWriteTimer);
    settingsWriteTimer = window.setTimeout(() => {
      settingsWriteTimer = 0;
      nativeSettingsChanged();
    }, 90);
  }

  function flushNativeSettingsChanged() {
    window.clearTimeout(settingsWriteTimer);
    settingsWriteTimer = 0;
    nativeSettingsChanged();
  }

  function nativeSettingsClosed() {
    if (typeof window.settingsClosed === 'function') window.settingsClosed('');
  }

  function syncSettingsFields() {
    const shell = document.querySelector('.toast-shell');
    const bounds = shell.getBoundingClientRect();
    const shownX = hasCustomPosition() ? positionX : Math.round(bounds.left);
    const shownY = hasCustomPosition() ? positionY : Math.round(bounds.top);
    positionXRange.value = shownX;
    positionXValue.value = shownX;
    positionYRange.value = shownY;
    positionYValue.value = shownY;
    settingsHotkeyButton.textContent = settingsHotkey;
    petSelect.value = pet;
  }

  function setPosition(axis, rawValue) {
    const value = Math.max(0, Math.round(Number(rawValue) || 0));
    if (axis === 'x') {
      positionX = value;
      positionXRange.value = value;
      positionXValue.value = value;
    } else {
      positionY = value;
      positionYRange.value = value;
      positionYValue.value = value;
    }
    applySceneClasses();
    queueNativeSettingsChanged();
  }

  function resetPosition() {
    positionX = null;
    positionY = null;
    applySceneClasses();
    syncSettingsFields();
    queueNativeSettingsChanged();
  }

  function closeSettings(save) {
    if (!settingsOpen) return;
    capturingHotkey = false;
    settingsHotkeyButton.classList.remove('capturing');
    if (!save && settingsSnapshot) {
      positionX = settingsSnapshot.x;
      positionY = settingsSnapshot.y;
      settingsHotkey = settingsSnapshot.hotkey;
      pet = settingsSnapshot.pet;
      applySceneClasses();
    }
    flushNativeSettingsChanged();
    settingsOpen = false;
    settingsMenu.classList.add('hidden');
    nativeSettingsClosed();
    settingsSnapshot = null;
  }

  function openSettings(data) {
    if (data) applyNativeSettings(data);
    settingsSnapshot = { x: positionX, y: positionY, hotkey: settingsHotkey, pet };
    settingsOpen = true;
    settingsMenu.classList.remove('hidden');
    syncSettingsFields();
  }

  function applyNativeSettings(data) {
    if (!data) return;
    positionX = Number.isFinite(data.x) && data.x >= 0 ? Math.round(data.x) : null;
    positionY = Number.isFinite(data.y) && data.y >= 0 ? Math.round(data.y) : null;
    if (typeof data.hotkey === 'string' && data.hotkey) settingsHotkey = data.hotkey;
    if (data.pet === 'pinky') pet = 'dovahpink';
    else if (petNames[data.pet]) pet = data.pet;
    applySceneClasses();
    updateIdleDetail();
    if (settingsOpen) syncSettingsFields();
  }

  function displayKey(event) {
    const code = event.code || '';
    const names = { Enter: 'Enter', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace' };
    let key = names[code] || null;
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
    if (/^F(?:[1-9]|1[0-2])$/.test(code)) key = code;
    if (!key) return null;
    const modifiers = [];
    if (event.shiftKey) modifiers.push('Shift');
    return modifiers.length ? `${modifiers.join('+')}+${key}` : key;
  }

  function show(kind, nextTitle, nextDetail, fill) {
    window.clearTimeout(timer);
    applySceneClasses(`show ${kind}`);
    title.textContent = nextTitle;
    detail.textContent = nextDetail;
    bar.style.width = `${fill}%`;
    if (!isPreview) timer = window.setTimeout(returnToIdle, 5400);
  }

  window.dragonbornXP = {
    initialize(data) {
      applyNativeSettings(data);
    },
    skillGain(data) {
      const skill = data && data.skill ? data.skill : 'Skill';
      show('gain', 'XP gained', `${skill} grows stronger.`, 68);
    },
    levelUp(data) {
      const level = data && data.level ? data.level : '?';
      show('level-up', `Level ${level}!`, 'The Dragonborn grows mighty.', 100);
    },
    dragonSoul(data) {
      const amount = data && data.amount ? data.amount : 1;
      show('gain', 'Dragon soul absorbed', `+${amount} soul${amount === 1 ? '' : 's'}.`, 82);
    },
    companionState(data) {
      companionState(data && data.state ? data.state : 'idle');
    },
    applySettings(data) {
      applyNativeSettings(data);
    },
    openSettings(data) {
      openSettings(data);
    },
    closeSettings() {
      closeSettings(false);
    },
    settingsSaved() {},
    worldMood(data) {
      timeOfDay = data && data.time ? data.time : 'day';
      weather = data && data.weather ? data.weather : 'clear';
      applySceneClasses();
    }
  };

  // Browser-only preview helpers. In-game these calls originate from C++.
  window.previewXP = () => window.dragonbornXP.skillGain({ skill: 'Destruction' });
  window.previewLevel = () => window.dragonbornXP.levelUp({ level: 42 });
  window.previewFlight = () => window.dragonbornXP.companionState({ state: 'flying' });
  window.previewCombat = () => window.dragonbornXP.companionState({ state: 'combat' });
  window.previewLand = () => window.dragonbornXP.companionState({ state: 'landed' });
  window.previewDawn = () => window.dragonbornXP.worldMood({ time: 'dawn', weather: 'clear' });
  window.previewSunset = () => window.dragonbornXP.worldMood({ time: 'sunset', weather: 'clear' });
  window.previewNight = () => window.dragonbornXP.worldMood({ time: 'night', weather: 'clear' });
  window.previewRain = () => window.dragonbornXP.worldMood({ time: 'day', weather: 'rain' });
  window.previewSnow = () => window.dragonbornXP.worldMood({ time: 'night', weather: 'snow' });
  window.previewSettings = () => window.dragonbornXP.openSettings({ x: null, y: null, hotkey: settingsHotkey, pet });
  window.previewPet = name => window.dragonbornXP.applySettings({ x: null, y: null, hotkey: settingsHotkey, pet: petNames[name] ? name : 'dovahmin' });

  positionXRange.addEventListener('input', event => setPosition('x', event.target.value));
  positionXValue.addEventListener('change', event => setPosition('x', event.target.value));
  positionYRange.addEventListener('input', event => setPosition('y', event.target.value));
  positionYValue.addEventListener('change', event => setPosition('y', event.target.value));
  petSelect.addEventListener('change', event => {
    pet = petNames[event.target.value] ? event.target.value : 'dovahmin';
    applySceneClasses();
    updateIdleDetail();
    queueNativeSettingsChanged();
  });
  document.querySelector('#reset-position').addEventListener('click', resetPosition);
  document.querySelector('#settings-save').addEventListener('click', () => closeSettings(true));
  document.querySelector('#settings-cancel').addEventListener('click', () => closeSettings(false));
  document.querySelector('#settings-close').addEventListener('click', () => closeSettings(true));
  settingsHotkeyButton.addEventListener('click', () => {
    capturingHotkey = true;
    settingsHotkeyButton.classList.add('capturing');
    settingsHotkeyButton.textContent = 'Press a key';
    hotkeyHint.textContent = 'Press a letter, number, Enter, Space, Tab, or F1–F12 with optional Shift.';
  });
  settingsHotkeyButton.addEventListener('keydown', event => {
    if (!capturingHotkey) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.code === 'Escape') {
      capturingHotkey = false;
      settingsHotkeyButton.classList.remove('capturing');
      settingsHotkeyButton.textContent = settingsHotkey;
      return;
    }
    const label = displayKey(event);
    if (!label) return;
    settingsHotkey = label;
    capturingHotkey = false;
    settingsHotkeyButton.classList.remove('capturing');
    settingsHotkeyButton.textContent = settingsHotkey;
    hotkeyHint.textContent = 'Press Save settings to keep this key.';
    queueNativeSettingsChanged();
  });
  document.addEventListener('keydown', event => {
    if (settingsOpen && event.code === 'Escape' && !capturingHotkey) {
      event.preventDefault();
      closeSettings(false);
    }
  });

  returnToIdle();

  const preview = new URLSearchParams(window.location.search).get('preview');
  if (preview === 'xp') window.previewXP();
  if (preview === 'level') window.previewLevel();
  if (preview === 'fly') window.previewFlight();
  if (preview === 'combat') window.previewCombat();
  if (preview === 'land') window.previewLand();
  if (preview === 'dawn') window.previewDawn();
  if (preview === 'sunset') window.previewSunset();
  if (preview === 'night') window.previewNight();
  if (preview === 'rain') window.previewRain();
  if (preview === 'snow') window.previewSnow();
  if (preview === 'settings') window.previewSettings();
  if (petNames[preview]) window.previewPet(preview);
})();
