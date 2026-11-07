(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PetReactions = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  // What the card does with a reaction the plugin sent (src/Reactions.h decided it may show).
  // The body language is shared by every companion (styles.css, .reacting.react-<mood>); the emote is a
  // pixel glyph over the pet's head (pet-sprites.js ornaments), never text.
  const MOODS = Object.freeze(['cheer', 'wave', 'sad', 'cower', 'sleep', 'curious', 'hop', 'fanfare']);
  const EMOTES = Object.freeze({
    cheer: 'emoteStar', wave: 'emoteWave', sad: 'emoteTear', cower: 'emoteSweat',
    sleep: 'emoteMoon', curious: 'emoteSpark', hop: 'emoteCrown', fanfare: 'emoteNote'
  });
  // the caption bar's fill for each mood, as the toasts use it
  const FILL = Object.freeze({ cheer: 88, wave: 60, sad: 22, cower: 30, sleep: 40, curious: 54, hop: 96, fanfare: 100 });
  const DEFAULT_MS = 2500;

  function normalize(data) {
    if (!data || !MOODS.includes(data.mood)) return null;
    const ms = Number(data.ms);
    const priority = Number(data.priority);
    return {
      source: typeof data.source === 'string' ? data.source : '',
      mood: data.mood,
      caption: typeof data.caption === 'string' ? data.caption : '',
      captionKey: typeof data.captionKey === 'string' ? data.captionKey : '',
      vars: data.vars && typeof data.vars === 'object' ? data.vars : {},
      ms: Number.isFinite(ms) ? Math.min(6000, Math.max(800, ms)) : DEFAULT_MS,
      priority: Number.isFinite(priority) ? Math.min(2, Math.max(0, Math.round(priority))) : 1,
      hold: Boolean(data.hold),
      care: Boolean(data.care),
      say: Boolean(data.say)
    };
  }

  // [title, detail, fill]: the title is the other mod's caption, or MiniPets' own line from the catalogue,
  // or the pet's name; the detail says what the pet does ("Pip covers its eyes.")
  function captionFor(reaction, t, petName) {
    const line = 'react' + reaction.mood.charAt(0).toUpperCase() + reaction.mood.slice(1);
    const title = reaction.caption || (reaction.captionKey ? t(reaction.captionKey, reaction.vars) : petName);
    return [title, t(line, { name: petName }), FILL[reaction.mood]];
  }

  // One reaction at a time. The plugin already applied the cooldown and priorities; the player keeps the
  // card from being stuck if two arrive close together: a timed one ends after its ms, a held one when the
  // plugin ends it (a load, waking up, getting up from bleed-out).
  function createPlayer(options = {}) {
    const setTimer = options.setTimeout || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimeout || (id => clearTimeout(id));
    const onChange = options.onChange || (() => {});
    let current = null;
    let timer = 0;

    function stop() {
      if (timer) clearTimer(timer);
      timer = 0;
    }

    function show(data) {
      const next = normalize(data);
      if (!next) return false;
      // a held pose gives way only to something as weighty
      if (current && current.hold && !next.hold && next.priority < 2) return false;
      stop();
      current = next;
      if (!next.hold) {
        timer = setTimer(() => {
          timer = 0;
          current = null;
          onChange(null);
        }, next.ms);
      }
      onChange(current);
      return true;
    }

    // mood '' or undefined ends whatever is showing
    function end(mood) {
      if (!current || (mood && current.mood !== mood)) return false;
      stop();
      current = null;
      onChange(null);
      return true;
    }

    return Object.freeze({ show, end, current: () => current });
  }

  return Object.freeze({ MOODS, EMOTES, FILL, normalize, captionFor, createPlayer });
});
