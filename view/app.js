(function () {
  const root = document.querySelector('#dragonborn-xp');
  const shell = document.querySelector('.toast-shell');
  const spriteHost = document.querySelector('#pet-sprite');
  const title = document.querySelector('#title');
  const detail = document.querySelector('#detail');
  const bar = document.querySelector('.xp-bar span');
  const settingsMenu = document.querySelector('#settings-menu');
  const positionXRange = document.querySelector('#position-x');
  const positionXValue = document.querySelector('#position-x-value');
  const positionYRange = document.querySelector('#position-y');
  const positionYValue = document.querySelector('#position-y-value');
  const sizeRange = document.querySelector('#size-range');
  const sizeValue = document.querySelector('#size-value');
  const cardScaler = document.querySelector('.card-scale');
  const settingsHotkeyButton = document.querySelector('#settings-hotkey');
  const hotkeyHint = document.querySelector('#hotkey-hint');
  const petSelect = document.querySelector('#pet-select');
  const petSelectRow = document.querySelector('#pet-select-row');
  const raisePetInput = document.querySelector('#raise-pet');
  const petLifePanel = document.querySelector('#pet-life');
  const petLifeName = document.querySelector('#pet-life-name');
  const petLifeEggs = document.querySelector('#pet-life-eggs');
  const petLifeNeeds = document.querySelector('#pet-life-needs');
  const petLifeHint = document.querySelector('#pet-life-hint');
  const petBubble = document.querySelector('.pet-bubble');
  const petEmote = document.querySelector('.pet-emote');
  const petLifeRules = window.PetLife;
  const clockEnabledInput = document.querySelector('#clock-enabled');
  const clockStyleSelect = document.querySelector('#clock-style');
  const clockTime = document.querySelector('#clock-time');
  const clockDate = document.querySelector('#clock-date');
  const petClock = window.PetClock;
  // i18n.js can be missing (a hand-copied install that kept an older view folder); the card then
  // stays in English instead of stopping on the first missing call
  const petI18n = window.PetI18n || englishOnlyI18n();
  const languageSelect = document.querySelector('#language-select');
  const petSky = window.PetSky;
  const petRegions = window.PetRegions;
  // room the clock needs above the card and the pet bars need below it, for clamping
  const CLOCK_HEIGHT = { plate: 84, ribbon: 46 };
  const NEEDS_HEIGHT = 66;
  const animationStates = window.PetAnimationState;
  // reactions.js can be missing in a hand-copied install that kept an older view folder: no reactions then
  const petReactions = window.PetReactions || null;
  const petSprites = window.PetSprites;
  // square card, or a wider one that shows more scenery
  const CARD_SHAPES = { square: [256, 256], wide: [384, 224] };
  let cardShape = 'square';
  const cardWidth = () => CARD_SHAPES[cardShape][0];
  const cardHeight = () => CARD_SHAPES[cardShape][1];

  const petNames = petSprites.names;
  const petSpecies = petSprites.species;
  // idle = one-shot idle classes from styles.css, {name} becomes the pet name
  const profiles = {
    dovahmin: { idle: ['look', 'flap'], idleDelay: 3400, idleDuration: 1000 },
    dovahpink: { idle: ['look', 'flap'], idleDelay: 3200, idleDuration: 1000 },
    mudcrab: { idle: ['snap', 'hop'], idleDelay: 2600, idleDuration: 760 },
    skeever: { idle: ['look', 'hop'], idleDelay: 2200, idleDuration: 900 },
    fox: { idle: ['wag', 'look'], idleDelay: 3000, idleDuration: 920 },
    sabrecat: { idle: ['stretch', 'wag'], idleDelay: 3700, idleDuration: 1000 },
    'frostbite-spider': { idle: ['hop', 'look'], idleDelay: 2800, idleDuration: 900 },
    horker: { idle: ['look', 'stretch'], idleDelay: 4200, idleDuration: 1000 },
    troll: { idle: ['stretch', 'look'], idleDelay: 4300, idleDuration: 1000 },
    'flame-atronach': { idle: ['flare', 'look'], idleDelay: 1800, idleDuration: 800 },
    'frost-atronach': { idle: ['stretch', 'look'], idleDelay: 3900, idleDuration: 1000 },
    spriggan: { idle: ['sway', 'look'], idleDelay: 3200, idleDuration: 1200 },
    'dwarven-spider': { idle: ['look', 'hop'], idleDelay: 2300, idleDuration: 900 },
    chaurus: { idle: ['look', 'sway'], idleDelay: 2500, idleDuration: 1200 },
    netch: { idle: ['flare', 'sway'], idleDelay: 3000, idleDuration: 800 },
    mammoth: { idle: ['look', 'ear'], idleDelay: 4700, idleDuration: 1000 },
    'dragon-priest': { idle: ['look', 'flare'], idleDelay: 3800, idleDuration: 900 },
    wisp: { idle: ['flare', 'hop'], idleDelay: 1700, idleDuration: 800 },
    'death-hound': { idle: ['look', 'wag'], idleDelay: 2800, idleDuration: 920 },
    chicken: { idle: ['peck', 'hop'], idleDelay: 2100, idleDuration: 720 }
  };

  const previewMode = new URLSearchParams(window.location.search).get('preview');
  const animationLabActive = previewMode === 'lab';
  // hidden in-game until the plugin calls setActive (no plugin in browser previews)
  const browserPreview = Boolean(previewMode) || /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  let overlayActive = browserPreview;
  let pet = 'dovahmin';
  let archetype = 'flyer';
  let timeOfDay = 'day';
  let weather = 'clear';
  let language = 'en';
  // set by the plugin, see regions.js
  let region = 'skyrim';

  function regionInfo() {
    return (petRegions && petRegions.info[region]) || { sky: 'open', lit: true };
  }
  let positionX = null;
  let positionY = null;
  let settingsHotkey = 'Shift+B';
  // card size in percent
  let cardScale = 100;
  // raise-a-pet: on/off is a setting, the pet itself lives in the save
  let raisePet = false;
  let feedHotkey = 'Shift+N';
  let playHotkey = 'Shift+K';
  let hideHotkey = 'Shift+V';
  // toggled with the hide hotkey, settings still show the card
  let petHidden = false;
  let petLife = null;
  // SAVE-LEAK: which load the pet belongs to (src/main.cpp g_petSession); sent back with every save
  let petSession = 0;
  let gameHours = null;
  let lastClockData = null;
  let shownPetKey = '';
  let resetArmed = false;
  const eggProfile = { idle: ['hop'], idleDelay: 4200, idleDuration: 700 };
  let showClock = false;
  // the reaction showing now (view/reactions.js), and whether big moments count as care (a setting)
  let reaction = null;
  let careMoments = false;
  // in-game hour (fractional) and the per-day scenery seed
  let skyHours = 12.5;
  let scenerySeed = 1;
  let sceneryKey = '';
  const skyBodies = {};
  let skyBox = null;
  let sceneryBox = null;
  const SCENERY_LAYERS = ['landmark', 'far', 'near', 'horizon', 'ground'];
  let volcanoPlume = null;
  const sceneryCanvases = {};
  let clockStyle = 'plate';
  let settingsSnapshot = null;
  let settingsOpen = false;
  let capturingHotkey = false;
  let settingsWriteTimer = 0;
  let idleVariationTimer = 0;
  let idleVariant = null;
  let idleVariationIndex = 0;
  let labTimer = 0;
  let labSpeed = 1;
  let drag = null;
  let current = { state: 'idle', base: 'idle', oneShot: null, payload: null, restarted: false };
  let captionFull = false;
  let captionTimer = 0;
  let announcedBase = 'idle';
  const CAPTION_HOLD_MS = 3500;

  const controller = animationStates.createController({ onChange: render });
  const reactionPlayer = petReactions ? petReactions.createPlayer({ onChange: applyReaction }) : null;

  // the species on the card: the picked companion, or the one being raised
  function shownSpecies() {
    return raisePet ? (petLife ? petLife.species : null) : pet;
  }

  function isEgg() {
    return raisePet && (!petLife || petLife.stage === 'egg');
  }

  function englishOnlyI18n() {
    const english = {
      actionFeed: "feeding",
      actionHide: "hiding the pet",
      actionPlay: "playing",
      actionSettings: "opening this menu",
      ateDetail: "Mmm, {food}!",
      ateWellTitle: "{name} ate well",
      ateWithYouTitle: "{name} ate with you",
      celebrating: "Celebrating!",
      celebratingDetail: "{name} is delighted.",
      chooseEgg: "Choose an egg",
      chooseEggHint: "Pick the companion you want to raise.",
      combatDetail: "{name} joins the fight.",
      combatTitle: "Ready for battle",
      cuddle: "Cuddle",
      cuddleDetail: "It feels a little warmer.",
      cuddleEgg: "Cuddle your egg",
      cuddleTitle: "You cuddle the egg",
      dragonSoulMany: "+{amount} souls.",
      dragonSoulOne: "+1 soul.",
      dragonSoulTitle: "Dragon soul absorbed",
      dragonbornMighty: "The Dragonborn grows mighty.",
      eggCosyDetail: "Give it a little while.",
      eggCosyTitle: "The egg is cosy",
      eggGlows: "The egg glows with warmth!",
      eggHint: "XP, level-ups and time keep the egg warm.",
      eggName: "{name}'s egg",
      eggNoFoodDetail: "Keep it warm with XP instead.",
      eggNoFoodTitle: "Eggs don’t eat",
      eggPickedDetail: "Earn XP to help it hatch.",
      eggWarm: "The egg feels warmer.",
      feed: "Feed",
      feedAfterHatching: "Feed (after hatching)",
      food: "Food",
      fullDetail: "Try again later.",
      fullTitle: "{name} is full",
      hatchedDetail: "Feed ({feed}) and play ({play}) with them.",
      hatchedTitle: "{name} hatched!",
      hintContent: "{name} is doing fine.",
      hintHappy: "{name} is very happy!",
      hintHungry: "{name} is hungry.",
      hintMiserable: "{name} needs food and attention.",
      hintSad: "{name} feels lonely.",
      hotkeyAllowed: "Press a letter, number, Enter, Space, Tab, or F1–F12 with optional Shift.",
      hotkeyAlreadyUsed: "{key} is already used for {action}.",
      levelDetail: "A mighty little celebration.",
      levelNumber: "Level {level}!",
      levelTitle: "Level up!",
      movingDetail: "{name} is travelling with you.",
      movingTitle: "On the move",
      noEggDetail: "Pick one in settings.",
      noEggTitle: "No egg yet",
      noFoodDetail: "Pick up something to eat first.",
      noFoodTitle: "No food in your pack",
      noticeHungryDetail: "Eat something, or press {key}.",
      noticeHungryTitle: "{name} is hungry",
      noticeLonelyDetail: "Press {key} to play.",
      noticeLonelyTitle: "{name} feels lonely",
      noticeMiserableDetail: "They need food and some attention.",
      noticeMiserableTitle: "{name} is miserable",
      petStage: "{name}, {stage}",
      play: "Play",
      playPet: "Play with your pet",
      playedDetail: "Happiness is up.",
      playedTitle: "{name} loves playing!",
      pressKey: "Press a key",
      resultSnack: "a snack",
      saveHotkeyHint: "Press Save settings to keep this key.",
      skillGrows: "{skill} grows stronger.",
      skillUnknown: "Skill",
      skyrim: "Skyrim",
      stageAdult: "all grown up",
      stageBaby: "baby",
      stageYoung: "young",
      startOver: "Start over",
      startOverConfirm: "Click again to start over",
      tiredDetail: "Let them rest for a bit.",
      tiredTitle: "{name} is tired",
      warmth: "Warmth",
      xpDetail: "{name} is celebrating.",
      xpTitle: "XP gained"
    };
    const fill = (template, vars = {}) => String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name) => vars[name] === undefined ? match : vars[name]);
    return {
      current: 'en',
      setLanguage: () => 'en',
      // index.html is written in English already
      apply() {},
      t: (key, vars) => fill(english[key] === undefined ? key : english[key], vars),
      // the companions' own lines live in i18n.js; without it every companion uses the shared line
      caption: () => null,
      petName: id => (petSprites.names || {})[id] || id,
      species: id => (petSprites.species || {})[id] || ''
    };
  }

  function petName() {
    if (raisePet && !petLife) return t('noEggTitle');
    const name = petI18n.petName(shownSpecies()) || 'Dovahmin';
    return isEgg() ? t('eggName', { name }) : name;
  }

  function t(key, vars) {
    return petI18n.t(key, vars);
  }

  function localizedSpecies(id) {
    return petI18n.species(id) || petSpecies[id] || '';
  }

  function profile() {
    return isEgg() ? eggProfile : profiles[shownSpecies()] || profiles.dovahmin;
  }

  function petMood() {
    return raisePet && petLife ? petLifeRules.mood(petLife) : null;
  }

  function fillName(text) {
    return text.replace('{name}', petName());
  }

  // --- Position -----------------------------------------------------------

  function hasCustomPosition() {
    return Number.isFinite(positionX) && Number.isFinite(positionY) && positionX >= 0 && positionY >= 0;
  }

  function minY() {
    return Math.round((showClock ? CLOCK_HEIGHT[clockStyle] : 0) * scaleFactor());
  }

  function maxPosition() {
    const below = raisePet && petLife ? NEEDS_HEIGHT : 0;
    return {
      x: Math.max(0, Math.round(window.innerWidth - cardWidth() * scaleFactor())),
      y: Math.max(minY(), Math.round(window.innerHeight - (cardHeight() + below) * scaleFactor()))
    };
  }

  function clamp(value, max, min = 0) {
    return Math.min(max, Math.max(min, Math.round(Number(value) || 0)));
  }

  function shownPosition() {
    if (hasCustomPosition()) {
      const max = maxPosition();
      return { x: clamp(positionX, max.x), y: clamp(positionY, max.y, minY()) };
    }
    const bounds = shell.getBoundingClientRect();
    return { x: Math.round(bounds.left), y: Math.round(bounds.top) };
  }

  function scaleFactor() {
    return cardScale / 100;
  }

  function clampScale(value) {
    return Math.min(200, Math.max(50, Math.round(Number(value) || 100)));
  }

  // Prisma ignores `inset`, so set each side
  function applyPosition() {
    cardScaler.style.transform = cardScale === 100 ? '' : `scale(${scaleFactor()})`;
    const style = root.style;
    if (hasCustomPosition()) {
      const shown = shownPosition();
      style.left = `${shown.x}px`;
      style.top = `${shown.y}px`;
      style.right = 'auto';
      style.bottom = 'auto';
      style.padding = '0';
      style.width = `${cardWidth()}px`;
      style.height = `${cardHeight()}px`;
      style.display = 'block';
    } else {
      ['left', 'top', 'right', 'bottom', 'padding', 'width', 'height', 'display'].forEach(property => { style[property] = ''; });
    }
  }

  function syncPositionFields() {
    const max = maxPosition();
    const shown = shownPosition();
    positionXRange.max = positionXValue.max = String(max.x);
    positionYRange.max = positionYValue.max = String(max.y);
    positionXRange.value = positionXValue.value = String(shown.x);
    positionYRange.value = positionYValue.value = String(shown.y);
    sizeRange.value = sizeValue.value = String(cardScale);
    document.querySelector('#card-shape').value = cardShape;
    syncSliders();
  }

  // the suite theme's slider fills to --dv-value (a percentage of the range)
  function syncSliders() {
    document.querySelectorAll('#settings-menu .dv-slider').forEach(slider => {
      const min = Number(slider.min) || 0;
      const max = Number(slider.max) || 100;
      const share = max > min ? ((Number(slider.value) - min) / (max - min)) * 100 : 0;
      slider.style.setProperty('--dv-value', `${Math.max(0, Math.min(100, share))}%`);
    });
  }

  // the suite theme's square switch shows the checkbox inside it: on, off, and the word for it
  function syncToggles() {
    document.querySelectorAll('#settings-menu .dv-toggle').forEach(toggle => {
      const input = toggle.querySelector('input');
      const word = toggle.querySelector('.toggle-state');
      if (!input) return;
      toggle.classList.toggle('is-on', input.checked);
      if (word) {
        word.dataset.i18n = input.checked ? 'toggleOn' : 'toggleOff';
        word.textContent = t(word.dataset.i18n);
      }
    });
  }

  function setPosition(x, y) {
    const max = maxPosition();
    positionX = clamp(x, max.x);
    positionY = clamp(y, max.y, minY());
    applySceneClasses();
    syncPositionFields();
    queueNativeSettingsChanged();
  }

  // keep the other axis where it is (it might still be the default spot)
  function setAxis(axis, rawValue) {
    const shown = shownPosition();
    if (axis === 'x') setPosition(rawValue, shown.y);
    else setPosition(shown.x, rawValue);
  }

  function resetPosition() {
    positionX = null;
    positionY = null;
    applySceneClasses();
    syncPositionFields();
    queueNativeSettingsChanged();
  }

  // --- Rendering ----------------------------------------------------------

  function sceneClassName(includeTransient) {
    const flying = current.state === 'moving' && archetype === 'flyer';
    const toast = current.payload && current.payload.kind;
    return [
      'persistent',
      overlayActive ? '' : 'inactive',
      petHidden && !settingsOpen ? 'user-hidden' : '',
      animationLabActive ? 'animation-lab' : '',
      document.hidden ? 'animation-paused' : '',
      hasCustomPosition() ? 'custom-position' : '',
      `pet-${pet}`,
      `archetype-${archetype}`,
      includeTransient ? `state-${current.state}` : '',
      includeTransient && flying ? 'state-flying' : '',
      // keep scrolling through toasts
      current.base === 'moving' ? 'travelling' : '',
      `time-${timeOfDay}`,
      `weather-${weather}`,
      `region-${region}`,
      `shape-${cardShape}`,
      regionInfo().sky === 'hidden' ? 'sky-hidden' : '',
      regionInfo().light ? `light-${regionInfo().light}` : '',
      showClock ? `clock-on clock-${clockStyle}` : '',
      includeTransient && toast ? `show ${toast}` : '',
      includeTransient && idleVariant ? `idle-${idleVariant}` : '',
      captionFull ? 'caption-full' : 'caption-name',
      isEgg() ? `is-egg egg-warm-${petLife ? Math.min(3, Math.floor(petLifeRules.eggProgress(petLife) * 4)) : 0}` : '',
      petMood() && petMood() !== 'egg' ? `mood-${petMood()}` : '',
      raisePet && petLife ? 'raising' : '',
      reaction ? `reacting react-${reaction.mood}` : ''
    ].filter(Boolean).join(' ');
  }

  function applySceneClasses(restart = false) {
    const next = sceneClassName(true);
    if (restart) {
      // drop state classes for a frame so a repeated toast animates again
      root.className = sceneClassName(false);
      void root.offsetWidth;
    }
    if (root.className !== next) root.className = next;
    applyPosition();
  }

  // a long line (a follower's name, a long language) drops the side rules and steps down a size,
  // then a second; a detail that still doesn't fit wraps onto two lines
  function fitCaption() {
    const copy = title.parentElement;
    copy.classList.remove('fit-1', 'fit-2', 'fit-wrap');
    const tooWide = element => element.scrollWidth > element.clientWidth + 1;
    if (!tooWide(title) && !tooWide(detail)) return;
    copy.classList.add('fit-1');
    if (tooWide(title) || tooWide(detail)) {
      copy.classList.remove('fit-1');
      copy.classList.add('fit-2');
    }
    if (tooWide(detail)) copy.classList.add('fit-wrap');
  }

  // full caption for events, otherwise just the name
  function showCaption(copy, holdMs) {
    window.clearTimeout(captionTimer);
    captionTimer = holdMs ? window.setTimeout(collapseCaption, holdMs) : 0;
    captionFull = true;
    title.textContent = copy[0];
    detail.textContent = copy[1];
    bar.style.width = `${copy[2]}%`;
    fitCaption();
  }

  function collapseCaption() {
    window.clearTimeout(captionTimer);
    captionTimer = 0;
    if (reaction) {
      showReactionCaption(0);
      applySceneClasses();
      return;
    }
    captionFull = false;
    title.textContent = petName();
    detail.textContent = '';
    title.parentElement.classList.remove('fit-1', 'fit-2', 'fit-wrap');
    applySceneClasses();
  }

  function updateCopy() {
    const { payload, state } = current;
    if (payload) {
      showCaption([payload.title, payload.detail, payload.fill], 0);
    } else if (state === 'celebrating') {
      showCaption([t('celebrating'), t('celebratingDetail', { name: petName() }), 76], 0);
    } else if ((state === 'moving' || state === 'combat') && state !== announcedBase) {
      // only announce a state change once
      announcedBase = state;
      // the companion's own line where the language has one, else the shared line
      const own = petI18n.caption(isEgg() ? 'egg' : shownSpecies(), state);
      const fill = state === 'combat' ? 92 : 42;
      const copy = own
        ? [fillName(own[0]), fillName(own[1]), fill]
        : state === 'combat'
          ? [t('combatTitle'), t('combatDetail', { name: petName() }), fill]
          : [t('movingTitle'), t('movingDetail', { name: petName() }), fill];
      showCaption(copy, CAPTION_HOLD_MS);
    } else if (state === 'idle' || state === 'landing') {
      announcedBase = 'idle';
      collapseCaption();
    } else if (!captionTimer) {
      collapseCaption();
    }
  }

  function render(snapshot) {
    current = snapshot;
    stopIdleVariation();
    updateCopy();
    applySceneClasses(snapshot.restarted);
    if (snapshot.state === 'idle') scheduleIdleVariation();
    applyLabSpeed();
  }

  function renderSprite() {
    if (isEgg()) {
      petSprites.renderEgg(spriteHost, petLife ? petLife.species : null);
      archetype = 'light';
      spriteHost.style.transform = '';
    } else {
      archetype = petSprites.render(spriteHost, shownSpecies()).archetype;
      const stage = raisePet && petLife ? petLifeRules.growth(petLife, gameHours ?? petLife.hatchedAt) : 'adult';
      const growth = petLifeRules.GROWTH_SCALE[stage] || 1;
      spriteHost.style.transformOrigin = '50% 100%';
      spriteHost.style.transform = growth === 1 ? '' : `scale(${growth})`;
    }
    shownPetKey = petVisualKey();
  }

  function petVisualKey() {
    if (!raisePet) return `pick|${pet}`;
    if (!petLife) return 'none';
    return `${petLife.species}|${petLife.stage}|${petLifeRules.growth(petLife, gameHours ?? petLife.laidAt)}`;
  }

  // far to near, seconds = time to cross the scene
  const weatherLayers = {
    rain: [
      { kind: 'drop', count: 26, seconds: 1.1, length: 3, colour: 'rgba(206, 226, 248, .45)' },
      { kind: 'drop', count: 18, seconds: .65, length: 5, colour: 'rgba(228, 240, 255, .8)' }
    ],
    storm: [
      { kind: 'drop', count: 42, seconds: .9, length: 4, colour: 'rgba(206, 226, 248, .5)' },
      { kind: 'drop', count: 30, seconds: .48, length: 6, colour: 'rgba(232, 242, 255, .85)' }
    ],
    snow: [
      { kind: 'flake', count: 34, seconds: 12, size: 1, colour: 'rgba(255, 255, 255, .65)' },
      { kind: 'flake', count: 18, seconds: 7, size: 2, colour: 'rgba(255, 255, 255, .95)' }
    ],
    ash: [
      { kind: 'flake', count: 26, seconds: 16, size: 1, colour: 'rgba(110, 100, 92, .55)' },
      { kind: 'flake', count: 12, seconds: 10, size: 1, colour: 'rgba(150, 138, 126, .7)' }
    ],
    // region particles, rise = float upwards
    flurry: [{ kind: 'flake', count: 16, seconds: 9, size: 1, colour: 'rgba(255, 255, 255, .7)' }],
    leaves: [{ kind: 'flake', count: 8, seconds: 9, size: 1, colour: 'rgba(214, 130, 50, .85)' }],
    drips: [{ kind: 'drop', count: 6, seconds: 1.4, length: 2, colour: 'rgba(170, 200, 220, .6)' }],
    spores: [{ kind: 'flake', count: 18, seconds: 14, size: 1, colour: 'rgba(140, 210, 255, .7)', rise: true }],
    pages: [{ kind: 'flake', count: 10, seconds: 12, size: 1, colour: 'rgba(214, 222, 176, .7)' }],
    wisps: [{ kind: 'flake', count: 14, seconds: 13, size: 1, colour: 'rgba(230, 210, 255, .75)', rise: true }],
    motes: [{ kind: 'flake', count: 16, seconds: 15, size: 1, colour: 'rgba(255, 236, 170, .8)', rise: true }]
  };
  const WEATHER_PIXEL = 2;
  let renderedWeather = null;

  // two stacked copies so it loops when shifted by one tile
  function weatherCanvas(layer, width, height, seed) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height * 2;
    const context = canvas.getContext && canvas.getContext('2d');
    if (!context) return canvas;
    context.fillStyle = layer.colour;
    const random = petSky.seededRandom(seed);
    const cell = WEATHER_PIXEL;
    for (let index = 0; index < layer.count; index += 1) {
      const x = Math.floor(random() * width / cell) * cell;
      const y = Math.floor(random() * height / cell) * cell;
      [y, y + height, y - height].forEach(top => {
        if (layer.kind === 'drop') {
          // slanted streak
          for (let step = 0; step < layer.length; step += 1) {
            context.fillRect(x - Math.floor(step / 2) * cell, top + step * cell, cell, cell);
          }
        } else {
          context.fillRect(x, top, layer.size * cell, layer.size * cell);
        }
      });
    }
    return canvas;
  }

  function renderWeather() {
    const weatherKey = `${weather}|${region}|${cardShape}`;
    if (renderedWeather === weatherKey) return;
    renderedWeather = weatherKey;
    const scene = shell.querySelector('.scene');
    scene.querySelectorAll('.weather-sway, .weather-flash').forEach(element => element.remove());
    // no weather where the sky is hidden, only region particles
    const skyOpen = regionInfo().sky !== 'hidden';
    const regional = (regionInfo().particles || []).flatMap(name => weatherLayers[name] || []);
    const layers = [...(skyOpen ? weatherLayers[weather] || [] : []), ...regional];
    if (!layers.length) return;
    const width = scene.clientWidth || 242;
    const height = scene.clientHeight || 242;
    const sway = document.createElement('div');
    sway.className = 'weather-sway';
    if (weather !== 'snow' && !regional.some(layer => layer.kind === 'flake')) sway.style.animation = 'none';
    layers.forEach((layer, index) => {
      const element = document.createElement('div');
      element.className = layer.rise ? 'weather-layer weather-rise' : 'weather-layer';
      element.style.height = `${height * 2}px`;
      element.style.animationDuration = `${layer.seconds}s`;
      element.append(weatherCanvas(layer, width, height, 1337 + index * 7919));
      sway.append(element);
    });
    scene.append(sway);
    if (weather === 'storm' && skyOpen) {
      const flash = document.createElement('div');
      flash.className = 'weather-flash';
      scene.append(flash);
    }
  }

  function updateSky() {
    if (!skyBox) return;
    const width = skyBox.clientWidth || 242;
    const height = skyBox.clientHeight || 167;
    const positions = petSky.skyPositions(skyHours);
    Object.entries(skyBodies).forEach(([name, element]) => {
      const position = positions[name];
      const size = element.offsetWidth || (name === 'sun' ? 75 : name === 'masser' ? 51 : 33);
      element.classList.toggle('down', !position.up);
      const x = position.x * width - size / 2;
      const y = height - position.alt * (height - 34) - size / 2;
      element.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    });
  }

  // only redraw when the day/time/weather/region changes.
  // layers are 2 tiles wide and css moves them by 1
  function renderScenery() {
    if (!sceneryBox) return;
    const scene = sceneryBox.parentElement;
    const width = scene.clientWidth || 242;
    const height = scene.clientHeight || 242;
    const key = `${scenerySeed}|${timeOfDay}|${weather}|${region}|${width}x${height}`;
    if (key === sceneryKey) return;
    sceneryKey = key;
    const cell = 3;
    const layout = petSky.buildScenery(scenerySeed, Math.ceil(width / cell), region);
    const tileWidth = layout.columns * cell;
    SCENERY_LAYERS.forEach(layer => {
      // landmark doesn't scroll
      const copies = layer === 'landmark' ? 1 : 2;
      const canvas = sceneryCanvases[layer];
      canvas.width = tileWidth * copies;
      canvas.height = height;
      canvas.style.width = `${tileWidth * copies}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext && canvas.getContext('2d');
      if (!context) return;
      context.clearRect(0, 0, canvas.width, canvas.height);
      petSky.drawScenery(context, layout, { horizon: height * 0.69, height, cell, phase: timeOfDay, weather, layer, copies });
    });
    if (layout.volcano && volcanoPlume) {
      const horizonRow = Math.round((height * 0.69) / cell);
      volcanoPlume.style.left = `${layout.volcano.x * cell}px`;
      volcanoPlume.style.top = `${(horizonRow - layout.volcano.height) * cell}px`;
    }
  }

  function renderFrame() {
    [['top-left', false, false], ['top-right', true, false], ['bottom-left', false, true], ['bottom-right', true, true]].forEach(([corner, flipX, flipY]) => {
      const element = petSprites.renderOrnament(document, 'corner', { flipX, flipY });
      element.className = `frame-corner frame-${corner}`;
      element.setAttribute('aria-hidden', 'true');
      shell.append(element);
    });
    // back to front: sky, scenery, then the clouds/grass from the markup
    const scene = shell.querySelector('.scene');
    sceneryBox = document.createElement('div');
    sceneryBox.className = 'scenery';
    sceneryBox.setAttribute('aria-hidden', 'true');
    const ground = document.createElement('div');
    ground.className = 'region-ground';
    sceneryBox.append(ground);
    SCENERY_LAYERS.forEach(layer => {
      const canvas = document.createElement('canvas');
      canvas.className = `scenery-layer scenery-${layer}`;
      sceneryBox.append(canvas);
      sceneryCanvases[layer] = canvas;
    });
    // red mountain smoke, positioned in renderScenery
    volcanoPlume = document.createElement('div');
    volcanoPlume.className = 'volcano-plume';
    for (let index = 0; index < 4; index += 1) {
      const puff = document.createElement('span');
      puff.className = `plume-puff plume-puff-${index}`;
      volcanoPlume.append(puff);
    }
    sceneryBox.insertBefore(volcanoPlume, sceneryCanvases.far);
    scene.prepend(sceneryBox);
    skyBox = document.createElement('div');
    skyBox.className = 'sky';
    skyBox.setAttribute('aria-hidden', 'true');
    const body = (name, parts) => {
      const element = document.createElement('div');
      element.className = `sky-body sky-${name}`;
      parts.forEach(([ornament, className]) => {
        const canvas = petSprites.renderOrnament(document, ornament);
        canvas.className = className;
        element.append(canvas);
      });
      skyBox.append(element);
      skyBodies[name] = element;
    };
    body('masser', [['masser', 'moon-masser']]);
    body('secunda', [['secunda', 'moon-secunda']]);
    body('sun', [['sunHalo', 'sun-halo'], ['sun', 'sun-noon'], ['sunDawn', 'sun-dawn'], ['sunDusk', 'sun-dusk']]);
    scene.prepend(skyBox);
    const emblem = petSprites.renderOrnament(document, 'emblem');
    emblem.className = 'frame-emblem';
    emblem.setAttribute('aria-hidden', 'true');
    shell.append(emblem);
  }

  function setPet(nextPet) {
    const resolved = nextPet === 'pinky' ? 'dovahpink' : petNames[nextPet] ? nextPet : 'dovahmin';
    if (resolved === pet && spriteHost.childElementCount) return false;
    pet = resolved;
    idleVariationIndex = 0;
    renderSprite();
    controller.reset();
    return true;
  }

  function stopIdleVariation() {
    window.clearTimeout(idleVariationTimer);
    idleVariationTimer = 0;
    idleVariant = null;
  }

  function scheduleIdleVariation() {
    window.clearTimeout(idleVariationTimer);
    const petProfile = profile();
    const delay = petProfile.idleDelay + ((idleVariationIndex * 137) % 1100);
    idleVariationTimer = window.setTimeout(() => {
      if (current.state !== 'idle') return;
      if (reaction) {
        scheduleIdleVariation();
        return;
      }
      // unhappy pets don't fidget
      if (['hungry', 'sad', 'miserable'].includes(petMood())) {
        scheduleIdleVariation();
        return;
      }
      idleVariant = petProfile.idle[idleVariationIndex++ % petProfile.idle.length];
      applySceneClasses();
      idleVariationTimer = window.setTimeout(() => {
        idleVariant = null;
        applySceneClasses();
        scheduleIdleVariation();
      }, petProfile.idleDuration);
    }, delay);
  }

  function applyLabSpeed() {
    if (!animationLabActive || typeof document.getAnimations !== 'function') return;
    window.requestAnimationFrame(() => document.getAnimations().forEach(animation => { animation.playbackRate = labSpeed; }));
  }

  // --- Reactions (1.9.0) ---------------------------------------------------

  function reactionCaption() {
    return petReactions.captionFor(reaction, t, petName());
  }

  function showReactionCaption(holdMs) {
    window.clearTimeout(captionTimer);
    captionTimer = holdMs ? window.setTimeout(collapseCaption, holdMs) : 0;
    const copy = reactionCaption();
    captionFull = true;
    title.textContent = copy[0];
    detail.textContent = copy[1];
    bar.style.width = `${copy[2]}%`;
    fitCaption();
  }

  function renderEmote() {
    if (!petEmote) return;
    petEmote.textContent = '';
    const name = reaction && petReactions.EMOTES[reaction.mood];
    if (name && petSprites.ornaments[name]) petEmote.append(petSprites.renderOrnament(document, name));
  }

  function applyReaction(next) {
    reaction = next;
    renderEmote();
    if (reaction) {
      stopIdleVariation();
      showReactionCaption(reaction.hold ? 0 : reaction.ms);
      applySceneClasses(true);
    } else {
      collapseCaption();
      if (current.state === 'idle') scheduleIdleVariation();
    }
  }

  function react(data) {
    if (!reactionPlayer || !reactionPlayer.show(data)) return;
    // a big moment counts as a little care, when the player turned that on
    if (reaction.care && careMoments && raisePet && petLife) {
      const result = petLifeRules.shareMoment(petLife, gameHours);
      if (result.ok) {
        petLife = result.pet;
        savePet();
        refreshPet();
      }
    }
    // the plugin rate-limits the Chronicle line; the page words it in the player's language
    if (reaction.say && typeof window.petSays === 'function') {
      window.petSays(JSON.stringify({ speaker: petName(), text: reactionCaption()[1] }));
    }
  }

  function showToast(kind, nextTitle, nextDetail, fill) {
    controller.play(kind === 'level-up' ? 'level-up' : 'xp', {
      payload: { kind, title: nextTitle, detail: nextDetail, fill }
    });
  }

  // --- Settings -----------------------------------------------------------

  function nativeSettingsChanged() {
    if (typeof window.settingsChanged !== 'function') return;
    const x = hasCustomPosition() ? positionX : -1;
    const y = hasCustomPosition() ? positionY : -1;
    window.settingsChanged(`${x}|${y}|${settingsHotkey}|${pet}|${showClock ? 1 : 0}|${clockStyle}|${cardScale}|${raisePet ? 1 : 0}|${feedHotkey}|${playHotkey}|${cardShape}|${hideHotkey}|${language}`);
  }

  function queueNativeSettingsChanged() {
    if (typeof window.settingsChanged !== 'function') return;
    window.clearTimeout(settingsWriteTimer);
    settingsWriteTimer = window.setTimeout(() => {
      settingsWriteTimer = 0;
      nativeSettingsChanged();
    }, 120);
  }

  function flushNativeSettingsChanged() {
    window.clearTimeout(settingsWriteTimer);
    settingsWriteTimer = 0;
    nativeSettingsChanged();
  }

  function nativeSettingsClosed() {
    if (typeof window.settingsClosed === 'function') window.settingsClosed('');
  }

  function companionOptionLabel(id) {
    const name = petI18n.petName(id);
    const species = localizedSpecies(id);
    return species ? `${name} — ${species}` : name;
  }

  function localizeCompanionOptions() {
    if (petSelect) {
      Array.from(petSelect.options).forEach(option => { option.textContent = companionOptionLabel(option.value); });
    }
    const labPet = document.querySelector('#animation-lab-pet');
    if (labPet && labPet.options.length) {
      Array.from(labPet.options).forEach(option => { option.textContent = companionOptionLabel(option.value); });
    }
    document.querySelectorAll('[data-pet-label]').forEach(label => {
      label.textContent = companionOptionLabel(label.dataset.petLabel);
    });
  }

  function setLanguage(next, persist = true) {
    language = petI18n.setLanguage(next);
    petI18n.apply(document);
    localizeCompanionOptions();
    if (languageSelect) languageSelect.value = language;
    renderPetPanel();
    if (lastClockData) {
      clockTime.textContent = petClock.formatTime(lastClockData.hour, lastClockData.minute);
      clockDate.textContent = petClock.formatDate(lastClockData);
    }
    if (captionFull) updateCopy();
    else title.textContent = petName();
    if (persist) queueNativeSettingsChanged();
    reportLanguage();
  }

  // to MiniPets.log, once per change, so a log shows which language and catalogue the page used
  let reportedLanguage = '';
  function reportLanguage() {
    if (typeof window.viewLog !== 'function') return;
    const line = `language ${language}, ${window.PetI18n ? 'catalogue loaded' : 'i18n.js missing, English fallback'}`;
    if (line === reportedLanguage) return;
    reportedLanguage = line;
    window.viewLog(line);
  }

  function syncSettingsFields() {
    syncPositionFields();
    settingsHotkeyButton.textContent = settingsHotkey;
    petSelect.value = pet;
    languageSelect.value = language;
    document.querySelector('#feed-hotkey').textContent = feedHotkey;
    document.querySelector('#play-hotkey').textContent = playHotkey;
    document.querySelector('#hide-hotkey').textContent = hideHotkey;
    clockEnabledInput.checked = showClock;
    clockStyleSelect.value = clockStyle;
    clockStyleSelect.disabled = !showClock;
    raisePetInput.checked = raisePet;
    syncToggles();
    document.querySelector('#settings-footer-key').textContent = settingsHotkey;
    renderPetPanel();
  }

  function closeSettings(save) {
    if (!settingsOpen) return;
    endDrag();
    stopCapture();
    if (!save && settingsSnapshot) {
      positionX = settingsSnapshot.x;
      positionY = settingsSnapshot.y;
      settingsHotkey = settingsSnapshot.hotkey;
      setLanguage(settingsSnapshot.language, false);
      cardScale = settingsSnapshot.cardScale;
      raisePet = settingsSnapshot.raisePet;
      feedHotkey = settingsSnapshot.feedHotkey;
      applyShape(settingsSnapshot.cardShape);
      playHotkey = settingsSnapshot.playHotkey;
      hideHotkey = settingsSnapshot.hideHotkey;
      refreshPet();
      showClock = settingsSnapshot.showClock;
      clockStyle = settingsSnapshot.clockStyle;
      setPet(settingsSnapshot.pet);
      applySceneClasses();
    }
    flushNativeSettingsChanged();
    settingsOpen = false;
    applySceneClasses();
    document.body.classList.remove('settings-open');
    settingsMenu.classList.add('hidden');
    nativeSettingsClosed();
    settingsSnapshot = null;
  }

  function openSettings(data) {
    if (data) applyNativeSettings(data);
    settingsSnapshot = { x: positionX, y: positionY, hotkey: settingsHotkey, pet, showClock, clockStyle, cardScale, raisePet, feedHotkey, playHotkey, hideHotkey, cardShape, language };
    settingsOpen = true;
    applySceneClasses();
    document.body.classList.add('settings-open');
    settingsMenu.classList.remove('hidden');
    syncSettingsFields();
  }

  function applyNativeSettings(data) {
    if (!data) return;
    positionX = Number.isFinite(data.x) && data.x >= 0 ? Math.round(data.x) : null;
    positionY = Number.isFinite(data.y) && data.y >= 0 ? Math.round(data.y) : null;
    if (typeof data.hotkey === 'string' && data.hotkey) settingsHotkey = data.hotkey;
    if (typeof data.feedHotkey === 'string' && data.feedHotkey) feedHotkey = data.feedHotkey;
    if (typeof data.playHotkey === 'string' && data.playHotkey) playHotkey = data.playHotkey;
    if (typeof data.hideHotkey === 'string' && data.hideHotkey) hideHotkey = data.hideHotkey;
    if (typeof data.language === 'string') setLanguage(data.language, false);
    if (typeof data.hidden === 'boolean') petHidden = data.hidden;
    if (typeof data.careMoments === 'boolean') careMoments = data.careMoments;
    if (typeof data.clock === 'boolean') showClock = data.clock;
    if (data.clockStyle === 'plate' || data.clockStyle === 'ribbon') clockStyle = data.clockStyle;
    if (Number.isFinite(data.scale)) cardScale = clampScale(data.scale);
    if (CARD_SHAPES[data.cardShape]) applyShape(data.cardShape);
    if (typeof data.raisePet === 'boolean' && data.raisePet !== raisePet) {
      raisePet = data.raisePet;
      refreshPet();
    }
    if (!setPet(data.pet || pet)) {
      applySceneClasses();
      updateCopy();
    }
    if (settingsOpen) syncSettingsFields();
  }

  // Prisma's engine doesn't always fill in event.code or shiftKey, so fall back to
  // keyCode and our own record of whether Shift is held.
  let shiftHeld = false;
  const isShift = event => event.key === 'Shift' || event.keyCode === 16 || /^Shift/.test(event.code || '');
  const isEscape = event => event.code === 'Escape' || event.key === 'Escape' || event.keyCode === 27;

  function displayKey(event) {
    const code = event.code || '';
    const names = { Enter: 'Enter', Space: 'Space', Tab: 'Tab', Backspace: 'Backspace' };
    let key = names[code] || null;
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
    if (/^F(?:[1-9]|1[0-2])$/.test(code)) key = code;
    if (!key) {
      const keyCode = event.keyCode || event.which || 0;
      const codes = { 13: 'Enter', 32: 'Space', 9: 'Tab', 8: 'Backspace' };
      if ((keyCode >= 65 && keyCode <= 90) || (keyCode >= 48 && keyCode <= 57)) key = String.fromCharCode(keyCode);
      else if (keyCode >= 112 && keyCode <= 123) key = `F${keyCode - 111}`;
      else key = codes[keyCode] || null;
    }
    if (!key && /^[a-z0-9]$/i.test(event.key || '')) key = event.key.toUpperCase();
    if (!key) return null;
    return event.shiftKey || shiftHeld ? `Shift+${key}` : key;
  }

  function startDrag(event) {
    if (!settingsOpen || event.button !== 0) return;
    event.preventDefault();
    const shown = shownPosition();
    drag = { mouseX: event.clientX, mouseY: event.clientY, x: shown.x, y: shown.y };
    document.body.classList.add('dragging-pet');
  }

  function moveDrag(event) {
    if (!drag) return;
    event.preventDefault();
    setPosition(drag.x + event.clientX - drag.mouseX, drag.y + event.clientY - drag.mouseY);
  }

  function endDrag() {
    if (!drag) return;
    drag = null;
    document.body.classList.remove('dragging-pet');
  }

  // --- Raise a pet --------------------------------------------------------

  function savePet() {
    if (typeof window.petStateChanged === 'function') window.petStateChanged(`${petSession}|${petLife ? petLifeRules.serialize(petLife) : ''}`);
  }

  function updateNeedBars() {
    if (!petLife) return;
    const bars = { warmth: petLifeRules.eggProgress(petLife) * 100, food: petLife.hunger, happiness: petLife.happiness };
    Object.entries(bars).forEach(([name, value]) => {
      const bar = document.querySelector(`#card-need-${name}`);
      bar.style.width = `${Math.round(value)}%`;
      bar.classList.toggle('low', name !== 'warmth' && value < 30);
    });
  }

  // re-render only when the egg/species/growth stage actually changed
  function refreshPet(force = false) {
    updateNeedBars();
    if (force || petVisualKey() !== shownPetKey) {
      idleVariationIndex = 0;
      renderSprite();
      controller.reset();
    } else {
      // leave any caption that's showing alone, just keep the name plate current
      applySceneClasses();
      if (!captionFull) title.textContent = petName();
    }
    if (settingsOpen) renderPetPanel();
  }

  function petNotice(title, detail) {
    showCaption([title, detail, 60], 4500);
    applySceneClasses();
  }

  // the plugin passes these on to DovahHub's Pets tab
  function reportPetAction(action, ok, reason, food) {
    if (typeof window.petActionResult !== 'function') return;
    const result = { action, ok };
    if (reason) result.reason = reason;
    if (food) result.food = food;
    window.petActionResult(JSON.stringify(result));
  }

  function petCheer(title, detail) {
    controller.play('xp', { payload: { kind: 'gain', title, detail, fill: 80 } });
  }

  function tickPet() {
    if (!raisePet || !petLife || gameHours === null) return;
    const result = petLifeRules.tick(petLife, gameHours);
    petLife = result.pet;
    refreshPet();
    const name = petNames[petLife.species];
    result.events.forEach(event => {
      if (event === 'hatched') {
        controller.play('celebrating', { payload: { kind: 'level-up', title: t('hatchedTitle', { name }), detail: t('hatchedDetail', { feed: feedHotkey, play: playHotkey }), fill: 100 } });
      } else if (event === 'mood:hungry') petNotice(t('noticeHungryTitle', { name }), t('noticeHungryDetail', { key: feedHotkey }));
      else if (event === 'mood:sad') petNotice(t('noticeLonelyTitle', { name }), t('noticeLonelyDetail', { key: playHotkey }));
      else if (event === 'mood:miserable') petNotice(t('noticeMiserableTitle', { name }), t('noticeMiserableDetail'));
    });
    savePet();
  }

  function petXp(amount) {
    if (!raisePet || !petLife) return;
    petLife = amount === 'level' ? petLifeRules.levelUp(petLife) : petLifeRules.xp(petLife, amount);
    savePet();
    refreshPet();
  }

  function pickEgg(species) {
    petLife = petLifeRules.create(species, gameHours ?? 0);
    savePet();
    refreshPet(true);
    petNotice(t('eggName', { name: petI18n.petName(species) }), t('eggPickedDetail'));
  }

  function startOver() {
    petLife = null;
    resetArmed = false;
    savePet();
    refreshPet(true);
  }

  function feedPet() {
    if (!petLife) {
      reportPetAction('feed', false, 'no pet');
      return petNotice(t('noEggTitle'), t('noEggDetail'));
    }
    if (petLife.stage === 'egg') {
      reportPetAction('feed', false, 'egg');
      return petNotice(t('eggNoFoodTitle'), t('eggNoFoodDetail'));
    }
    if (petLife.hunger >= 98) {
      reportPetAction('feed', false, 'full');
      return petNotice(t('fullTitle', { name: petNames[petLife.species] }), t('fullDetail'));
    }
    if (typeof window.feedPet === 'function') window.feedPet('');
    else window.dragonbornXP.petFed({ name: 'Sweetroll', source: 'pack' });
  }

  function playWithPet() {
    if (!petLife) return reportPetAction('play', false, 'no pet');
    const result = petLifeRules.play(petLife, gameHours ?? 0);
    const name = petNames[petLife.species];
    reportPetAction('play', result.ok, result.reason);
    if (result.reason === 'tired') return petLife.stage === 'egg' ? petNotice(t('eggCosyTitle'), t('eggCosyDetail')) : petNotice(t('tiredTitle', { name }), t('tiredDetail'));
    petLife = result.pet;
    savePet();
    refreshPet();
    if (result.reason === 'egg') petNotice(t('cuddleTitle'), t('cuddleDetail'));
    else controller.play('celebrating', { payload: { kind: 'gain', title: t('playedTitle', { name }), detail: t('playedDetail'), fill: 90 } });
  }

  function renderPetPanel() {
    petSelectRow.classList.toggle('hidden', raisePet);
    petLifePanel.classList.toggle('hidden', !raisePet);
    document.querySelectorAll('.pet-hotkey').forEach(row => row.classList.toggle('hidden', !raisePet));
    if (!raisePet) return;
    const egg = !petLife || petLife.stage === 'egg';
    petLifeEggs.classList.toggle('hidden', Boolean(petLife));
    petLifeNeeds.classList.toggle('hidden', !petLife);
    petLifePanel.classList.toggle('is-egg', egg);
    // same key either way, cuddling is what play does for an egg
    document.querySelector('#play-hotkey-label').textContent = petLife && egg ? t('cuddleEgg') : t('playPet');
    document.querySelector('#pet-play').textContent = `${egg ? t('cuddle') : t('play')} (${playHotkey})`;
    if (!petLife) {
      petLifeName.textContent = t('chooseEgg');
      petLifeHint.textContent = t('chooseEggHint');
      if (!petLifeEggs.childElementCount) {
        Object.entries(petNames).forEach(([id, name]) => {
          const button = document.createElement('button');
          const art = document.createElement('div');
          const label = document.createElement('span');
          button.type = 'button';
          button.className = 'egg-choice';
          art.className = 'pet-sprite';
          label.dataset.petLabel = id;
          label.textContent = companionOptionLabel(id);
          button.append(art, label);
          button.addEventListener('click', () => pickEgg(id));
          petLifeEggs.append(button);
          petSprites.renderEgg(art, id, { pixel: 2 });
        });
      }
      return;
    }
    const name = petNames[petLife.species];
    const species = localizedSpecies(petLife.species);
    const stage = petLifeRules.growth(petLife, gameHours ?? petLife.laidAt);
    petLifeName.textContent = egg ? `${t('eggName', { name })}${species ? ` (${species})` : ''}` : t('petStage', { name, stage: t({ baby: 'stageBaby', young: 'stageYoung', adult: 'stageAdult' }[stage]) });
    const needs = { warmth: petLifeRules.eggProgress(petLife) * 100, food: petLife.hunger, happiness: petLife.happiness };
    Object.entries(needs).forEach(([name, value]) => {
      const shown = Math.round(Math.max(0, Math.min(100, value)));
      document.querySelector(`#need-${name}`).style.width = `${shown}%`;
      document.querySelector(`#need-${name}-value`).textContent = `${shown}%`;
    });
    document.querySelector('#pet-feed').disabled = egg;
    // eggs can't eat, say so rather than looking like the key is taken
    document.querySelector('#pet-feed').textContent = egg ? t('feedAfterHatching') : `${t('feed')} (${feedHotkey})`;
    document.querySelector('#pet-reset').textContent = resetArmed ? t('startOverConfirm') : t('startOver');
    petLifeHint.textContent = egg
      ? t('eggHint')
      : t({ hungry: 'hintHungry', sad: 'hintSad', miserable: 'hintMiserable', happy: 'hintHappy', content: 'hintContent' }[petLifeRules.mood(petLife)], { name });
  }

  // --- Native bridge ------------------------------------------------------

  window.dragonbornXP = {
    initialize(data) {
      applyNativeSettings(data);
      reportLanguage();
    },
    skillGain(data) {
      const skill = data && data.skill ? data.skill : t('skillUnknown');
      showToast('gain', t('xpTitle'), isEgg() && petLife ? t('eggWarm') : t('skillGrows', { skill }), 68);
      petXp(1);
    },
    levelUp(data) {
      const level = data && data.level ? data.level : '?';
      showToast('level-up', t('levelNumber', { level }), isEgg() && petLife ? t('eggGlows') : t('dragonbornMighty'), 100);
      petXp('level');
    },
    dragonSoul(data) {
      const amount = Math.max(1, Math.round(Number(data && data.amount) || 1));
      showToast('gain', t('dragonSoulTitle'), amount === 1 ? t('dragonSoulOne') : t('dragonSoulMany', { amount }), 82);
      petXp(2);
    },
    // saved pet from the co-save ('' = none yet)
    petState(data) {
      const text = data && typeof data.state === 'string' ? data.state : '';
      const session = data && Number.isFinite(data.session) ? data.session : petSession;
      if (session !== petSession) {
        // another save: nothing of the last one's clock, reset prompt or reaction carries over
        petSession = session;
        gameHours = null;
        resetArmed = false;
        if (reactionPlayer) reactionPlayer.end();
      }
      petLife = text ? petLifeRules.restore(text, id => Boolean(petNames[id])) : null;
      refreshPet(true);
    },
    petAction(data) {
      if (!raisePet) return;
      if (data && data.action === 'feed') feedPet();
      else if (data && data.action === 'play') playWithPet();
    },
    petFed(data) {
      if (data && data.none) {
        reportPetAction('feed', false, 'no food');
        return petNotice(t('noFoodTitle'), t('noFoodDetail'));
      }
      if (!raisePet || !petLife) return;
      const result = petLifeRules.feed(petLife);
      const food = data && data.name ? data.name : t('resultSnack');
      if (!result.ok) return reportPetAction('feed', false, result.reason);
      reportPetAction('feed', true, null, food);
      petLife = result.pet;
      savePet();
      refreshPet();
      petCheer(t(data && data.source === 'ate' ? 'ateWithYouTitle' : 'ateWellTitle', { name: petNames[petLife.species] }), t('ateDetail', { food }));
    },
    companionState(data) {
      controller.setBase(data && data.state ? data.state : 'idle');
    },
    // src/main.cpp OfferReaction: {"source","mood","caption","captionKey","vars","ms","priority","hold","care","say"}
    react(data) {
      react(data);
    },
    // a held reaction ends (waking up, getting up), or every reaction on a load ({})
    reactEnd(data) {
      if (reactionPlayer) reactionPlayer.end(data && data.mood);
    },
    clock(data) {
      lastClockData = data || {};
      clockTime.textContent = petClock.formatTime(data && data.hour, data && data.minute);
      clockDate.textContent = petClock.formatDate(data);
      skyHours = (Number(data && data.hour) || 0) + (Number(data && data.minute) || 0) / 60;
      gameHours = Number.isFinite(data && data.hours) ? data.hours : (Number(data && data.day) || 0) * 24 + skyHours;
      tickPet();
      scenerySeed = petSky.hashText(`${data && data.year}-${data && data.month}-${data && data.day}`);
      updateSky();
      renderScenery();
    },
    setHidden(hidden) {
      petHidden = Boolean(hidden);
      applySceneClasses();
    },
    setActive(active) {
      overlayActive = Boolean(active);
      applySceneClasses();
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
      region = data && petRegions && petRegions.info[data.region] ? data.region : 'skyrim';
      applySceneClasses();
      renderWeather();
      renderScenery();
      updateSky();
    }
  };

  // browser preview helpers (in-game these come from the plugin)
  window.previewXP = () => window.dragonbornXP.skillGain({ skill: 'Destruction' });
  window.previewLevel = () => window.dragonbornXP.levelUp({ level: 42 });
  window.previewFlight = () => window.dragonbornXP.companionState({ state: 'flying' });
  window.previewCombat = () => window.dragonbornXP.companionState({ state: 'combat' });
  window.previewLand = () => window.dragonbornXP.companionState({ state: 'landed' });
  // ?preview=react-cheer (or any mood), ?preview=react to go through all of them
  const sampleReactions = {
    cheer: { captionKey: 'reactBigHit', vars: { amount: 412 } }, wave: { captionKey: 'reactJoined', vars: { name: 'Lydia' } },
    sad: { captionKey: 'reactLost', vars: { name: 'Frost' } }, cower: { captionKey: 'reactCareful' },
    sleep: { captionKey: 'reactSleeping' }, curious: { captionKey: 'reactOutfit' },
    hop: { captionKey: 'reactBossDown', vars: { name: 'Mirmulnir' } }, fanfare: { captionKey: 'reactMilestone', vars: { title: 'Master Smith' } }
  };
  window.previewReact = (mood, extra) => window.dragonbornXP.react(Object.assign({ source: 'preview', mood, ms: 3000, priority: 2 }, sampleReactions[mood], extra));
  window.previewReactions = () => {
    const moods = petReactions ? petReactions.MOODS : [];
    let index = 0;
    const next = () => window.previewReact(moods[index++ % moods.length], { ms: 3200 });
    next();
    window.setInterval(next, 3600);
  };
  const sampleDate = { weekday: 'Morndas', day: 17, month: 'Last Seed', year: 201 };
  window.previewTime = (hours, nextWeather = 'clear', date = sampleDate) => {
    window.dragonbornXP.clock(Object.assign({}, date, { hour: Math.floor(hours), minute: Math.round((hours % 1) * 60) }));
    window.dragonbornXP.worldMood({ time: petSky.phaseFor(hours), weather: nextWeather, region });
  };
  window.previewDawn = () => window.previewTime(6);
  window.previewSunset = () => window.previewTime(19);
  window.previewNight = () => window.previewTime(23.5);
  window.previewRain = () => window.previewTime(12, 'rain');
  window.previewSnow = () => window.previewTime(23.5, 'snow');
  // about 20s per in-game day
  window.previewTimelapse = () => {
    document.body.classList.add('timelapse');
    let hours = 4;
    let day = 17;
    window.setInterval(() => {
      hours += 0.1;
      if (hours >= 24) {
        hours -= 24;
        day += 1;
      }
      window.previewTime(hours, 'clear', Object.assign({}, sampleDate, { day }));
    }, 80);
  };
  window.previewRegion = place => window.dragonbornXP.worldMood({ time: timeOfDay, weather, region: place });
  window.previewPlaces = () => {
    const places = ['skyrim', ...petRegions.names];
    let index = 0;
    const next = () => {
      window.previewRegion(places[index % places.length]);
      title.textContent = places[index % places.length] === 'skyrim' ? t('skyrim') : petRegions.info[places[index % places.length]].label;
      index += 1;
    };
    next();
    window.setInterval(next, 3000);
  };
  window.previewScenery = seed => {
    scenerySeed = seed;
    renderScenery();
  };
  window.previewSettings = () => window.dragonbornXP.openSettings({ x: positionX, y: positionY, hotkey: settingsHotkey, pet, clock: showClock, clockStyle, scale: cardScale });
  window.previewClock = style => window.dragonbornXP.applySettings({ x: positionX, y: positionY, hotkey: settingsHotkey, pet, clock: true, clockStyle: style === 'ribbon' ? 'ribbon' : 'plate' });
  window.previewPet = name => window.dragonbornXP.applySettings({ x: positionX, y: positionY, hotkey: settingsHotkey, pet: petNames[name] ? name : 'dovahmin' });

  function playLabState(rawState) {
    const state = animationStates.normalizeState(rawState);
    if (state === 'xp') showToast('gain', t('xpTitle'), t('xpDetail', { name: petName() }), 68);
    else if (state === 'level-up') showToast('level-up', t('levelTitle'), t('levelDetail'), 100);
    else if (state === 'landing') controller.setBase('landed');
    else if (state === 'celebrating') controller.play('celebrating');
    else controller.setBase(state);
  }

  function setupAnimationLab() {
    if (!animationLabActive) return;
    const lab = document.querySelector('#animation-lab');
    const labPet = document.querySelector('#animation-lab-pet');
    const labState = document.querySelector('#animation-lab-state');
    const labSpeedInput = document.querySelector('#animation-lab-speed');
    const labSpeedValue = document.querySelector('#animation-lab-speed-value');
    if (!lab || !labPet || !labState || !labSpeedInput || !labSpeedValue) return;

    lab.classList.remove('hidden');
    Object.keys(petNames).forEach(id => labPet.append(new Option(companionOptionLabel(id), id)));
    labPet.value = pet;
    const labRegion = document.querySelector('#animation-lab-region');
    if (labRegion && petRegions) {
      labRegion.append(new Option(t('skyrim'), 'skyrim'));
      petRegions.names.forEach(name => labRegion.append(new Option(petRegions.info[name].label, name)));
      labRegion.addEventListener('change', event => window.previewRegion(event.target.value));
    }
    labPet.addEventListener('change', event => setPet(event.target.value));
    labState.addEventListener('change', event => playLabState(event.target.value));
    labSpeedInput.addEventListener('input', event => {
      labSpeed = Number(event.target.value) || 1;
      labSpeedValue.textContent = `${labSpeed.toFixed(1).replace(/\.0$/, '')}×`;
      applyLabSpeed();
    });
    document.querySelector('#animation-lab-play').addEventListener('click', () => playLabState(labState.value));
    document.querySelector('#animation-lab-transition').addEventListener('click', () => {
      window.clearTimeout(labTimer);
      controller.setBase('moving');
      labTimer = window.setTimeout(() => {
        controller.setBase('combat');
        labTimer = window.setTimeout(() => controller.setBase('landed'), 1400);
      }, 1400);
    });
    document.querySelector('#animation-lab-close').addEventListener('click', () => lab.classList.add('hidden'));
  }

  function setupPetSheet() {
    const sheet = document.querySelector('#pet-sheet');
    if (previewMode !== 'sheet' || !sheet) return;
    sheet.classList.remove('hidden');
    Object.entries(petNames).forEach(([id, name]) => {
      const cell = document.createElement('div');
      const sprite = document.createElement('div');
      const label = document.createElement('p');
      cell.className = 'sheet-cell';
      sprite.className = 'pet-sprite';
      label.dataset.petLabel = id;
      label.textContent = companionOptionLabel(id);
      cell.append(sprite, label);
      sheet.append(cell);
      petSprites.render(sprite, id);
    });
  }

  // --- Wiring -------------------------------------------------------------

  // some engines only fire change on range inputs
  [['x', positionXRange], ['x', positionXValue], ['y', positionYRange], ['y', positionYValue]].forEach(([axis, input]) => {
    input.addEventListener('input', event => setAxis(axis, event.target.value));
    input.addEventListener('change', event => setAxis(axis, event.target.value));
  });
  shell.addEventListener('mousedown', startDrag);
  document.addEventListener('mousemove', moveDrag);
  document.addEventListener('mouseup', endDrag);
  window.addEventListener('blur', endDrag);
  window.addEventListener('resize', () => {
    applyPosition();
    if (settingsOpen) {
      syncPositionFields();
      }
  });
  function setClock(enabled, style) {
    showClock = enabled;
    clockStyle = style === 'ribbon' ? 'ribbon' : 'plate';
    clockStyleSelect.disabled = !showClock;
    // banner changes the height, so re-clamp
    if (hasCustomPosition()) setPosition(positionX, positionY);
    else {
      applySceneClasses();
      queueNativeSettingsChanged();
    }
  }
  clockEnabledInput.addEventListener('change', event => setClock(event.target.checked, clockStyle));
  languageSelect.addEventListener('change', event => setLanguage(event.target.value));

  // resize the card, then redraw everything that's drawn to its size
  function applyShape(shape) {
    if (!CARD_SHAPES[shape] || shape === cardShape) return;
    cardShape = shape;
    applySceneClasses();
    window.requestAnimationFrame(() => {
      renderWeather();
      renderScenery();
      updateSky();
    });
  }
  document.querySelector('#card-shape').addEventListener('change', event => {
    applyShape(event.target.value);
    if (hasCustomPosition()) setPosition(positionX, positionY);
    else {
      syncPositionFields();
      queueNativeSettingsChanged();
    }
  });

  function setScale(value) {
    cardScale = clampScale(value);
    sizeRange.value = sizeValue.value = String(cardScale);
    // bigger card might not fit where it is any more
    if (hasCustomPosition()) setPosition(positionX, positionY);
    else {
      applySceneClasses();
      syncPositionFields();
      queueNativeSettingsChanged();
    }
  }
  sizeRange.addEventListener('input', event => setScale(event.target.value));
  document.querySelectorAll('#settings-menu .dv-slider').forEach(slider => slider.addEventListener('input', syncSliders));
  [raisePetInput, clockEnabledInput].forEach(input => input.addEventListener('change', syncToggles));
  sizeRange.addEventListener('change', event => setScale(event.target.value));
  sizeValue.addEventListener('change', event => setScale(event.target.value));
  clockStyleSelect.addEventListener('change', event => setClock(showClock, event.target.value));
  raisePetInput.addEventListener('change', event => {
    raisePet = event.target.checked;
    refreshPet(true);
    renderPetPanel();
    queueNativeSettingsChanged();
  });
  document.querySelector('#pet-feed').addEventListener('click', feedPet);
  document.querySelector('#pet-play').addEventListener('click', playWithPet);
  document.querySelector('#pet-reset').addEventListener('click', () => {
    if (resetArmed) return startOver();
    resetArmed = true;
    renderPetPanel();
  });
  petSelect.addEventListener('change', event => {
    if (setPet(event.target.value)) queueNativeSettingsChanged();
  });
  document.querySelector('#reset-position').addEventListener('click', resetPosition);
  document.querySelector('#settings-save').addEventListener('click', () => closeSettings(true));
  document.querySelector('#settings-cancel').addEventListener('click', () => closeSettings(false));
  document.querySelector('#settings-close').addEventListener('click', () => closeSettings(true));
  // catalogue keys for the action each hotkey does, read when a clash is shown
  const hotkeyActions = { settings: 'actionSettings', feed: 'actionFeed', play: 'actionPlay', hide: 'actionHide' };
  const getHotkey = which => ({ settings: settingsHotkey, feed: feedHotkey, play: playHotkey, hide: hideHotkey })[which];
  function setHotkey(which, label) {
    if (which === 'settings') settingsHotkey = label;
    else if (which === 'feed') feedHotkey = label;
    else if (which === 'hide') hideHotkey = label;
    else playHotkey = label;
  }
  // One page-wide listener: in game, clicking a button doesn't always give it focus.
  let captureButton = null;
  function stopCapture() {
    if (!captureButton) return;
    captureButton.classList.remove('capturing');
    captureButton.textContent = getHotkey(captureButton.dataset.hotkey);
    document.querySelector('#settings-footer-key').textContent = settingsHotkey;
    captureButton = null;
    capturingHotkey = false;
  }
  document.querySelectorAll('.hotkey-capture').forEach(button => {
    button.addEventListener('click', () => {
      stopCapture();
      captureButton = button;
      capturingHotkey = true;
      button.classList.add('capturing');
      button.textContent = t('pressKey');
      hotkeyHint.textContent = t('hotkeyAllowed');
    });
  });
  document.addEventListener('keyup', event => { if (isShift(event)) shiftHeld = false; }, true);
  window.addEventListener('blur', () => { shiftHeld = false; });
  document.addEventListener('keydown', event => {
    if (isShift(event)) {
      shiftHeld = true;
      return;
    }
    if (!captureButton) return;
    event.preventDefault();
    event.stopPropagation();
    if (isEscape(event)) return stopCapture();
    const label = displayKey(event);
    if (!label) return;
    const which = captureButton.dataset.hotkey;
    const clash = Object.keys(hotkeyActions).find(other => other !== which && getHotkey(other).toUpperCase() === label.toUpperCase());
    if (clash) {
      hotkeyHint.textContent = t('hotkeyAlreadyUsed', { key: label, action: t(hotkeyActions[clash]) });
      return;
    }
    setHotkey(which, label);
    stopCapture();
    hotkeyHint.textContent = t('saveHotkeyHint');
    renderPetPanel();
    queueNativeSettingsChanged();
  }, true);
  document.addEventListener('keydown', event => {
    if (settingsOpen && isEscape(event) && !capturingHotkey) {
      event.preventDefault();
      closeSettings(false);
    }
  });

  document.addEventListener('visibilitychange', () => applySceneClasses());

  setLanguage(language, false);
  renderFrame();
  ['iconFood', 'iconHeart'].forEach(name => {
    const icon = petSprites.renderOrnament(document, name);
    icon.className = `bubble-icon bubble-${name === 'iconFood' ? 'food' : 'heart'}`;
    petBubble.append(icon);
    document.querySelector(`.need-icon-${name === 'iconFood' ? 'food' : 'heart'}`).append(petSprites.renderOrnament(document, name));
  });
  renderWeather();
  renderSprite();
  render(controller.snapshot());
  setupAnimationLab();
  setupPetSheet();

  const previews = {
    xp: window.previewXP, level: window.previewLevel, fly: window.previewFlight, combat: window.previewCombat,
    land: window.previewLand, dawn: window.previewDawn, sunset: window.previewSunset, night: window.previewNight,
    rain: window.previewRain, snow: window.previewSnow, settings: window.previewSettings,
    clock: () => window.previewClock('plate'), ribbon: () => window.previewClock('ribbon'),
    timelapse: () => window.previewTimelapse(),
    raise: () => {
      window.dragonbornXP.applySettings({ x: positionX, y: positionY, hotkey: settingsHotkey, pet, raisePet: true });
      window.previewSettings();
    },
    places: () => window.previewPlaces(),
    react: () => window.previewReactions()
  };
  // sample time for the preview
  if (browserPreview) window.previewTime(12.7);
  if (previews[previewMode]) previews[previewMode]();
  if (petNames[previewMode]) window.previewPet(previewMode);
  if (petRegions && petRegions.info[previewMode]) window.previewRegion(previewMode);
  if (/^react-/.test(previewMode || '')) window.previewReact(previewMode.slice(6), { hold: true });
})();
