# Changelog

## 1.9.3-beta
- MiniPets' work with the game and the card now runs from the game's own frame update, the one place that is always the game's main thread. With DovahHub 0.97.4-beta or later it shares DovahHub's; without DovahHub, MiniPets hooks the frame update itself, so it works on its own as before
- 1.9.2's queue turned out to run on other threads in some load orders too, so it is no longer used
- The log names the game's thread correctly (1.9.2 printed a number that wasn't one)
- Upgrading from 1.9.2-beta: install over it in your mod manager; nothing else changes

## 1.9.2-beta
- Everything MiniPets does with the game and the card now runs on the game's own thread. In some load orders the way it queued that work could run it alongside the game instead, a crash risk
- The update that runs every quarter second, and the check when a menu opens or closes, are queued once at a time, so a busy moment can't pile them up and run a backlog in one go
- The log names the game thread once, and warns (once per place) if any of MiniPets' game work still finds itself elsewhere
- Upgrading from 1.9.1-beta: install over it in your mod manager; nothing else changes

## 1.9.1-beta
- Nothing about one save carries into another any more. While a save loaded, the card could still tick the last save's raised pet and hand it to the new one, so a character with no pet (or a new game) could end up with the previous character's pet. The card now forgets the pet as soon as a load starts, and the plugin keeps only a pet the card sends for the save being played
- A load also starts the reactions afresh: the outfit look's 10-minute gap, the Chronicle line's one-a-minute limit and any reaction still waiting no longer carry over from the last save, and the clock and scenery are sent again for the new one
- Upgrading from 1.9.0-beta: install over it in your mod manager; nothing else changes

## 1.9.0-beta
- Your companion reacts to what happens. Low health: it shrinks back and covers its eyes ("Careful!"). Sleeping: it curls up and sleeps on the card. Dying: it stays sad until you load
- With DovahDamage: a new biggest hit gets a cheer with the number, and killing a dragon, a giant or a dungeon boss gets a victory hop. The record is kept in your save
- With DovahHub 0.96.4-beta or later: it waves at a new follower or a horse, looks sad when someone is lost, sounds a fanfare for a milestone tier and gives a new outfit a curious look
- Every companion has the new poses (cheer, wave, sad, cower, sleep, curious, a victory hop, a fanfare), with a small pixel emote over its head; several add their own touch: the mudcrab clacks, the wisp and the flame atronach dim, glowing eyes go dark, the netch sinks, the dragons spread their wings
- New settings on DovahHub's Settings tab: React to other mods, Time between reactions (8 seconds), and two that are off by default: Shared moments count as care (three times a game day at most) and Your companion speaks in Chronicle (one line a minute at most)
- For other mods: MiniPets_API.h version 2 adds React, so any mod can make the companion react; version 1 keeps working
- Long captions (a long follower name, the longer languages) now fit the card instead of being cut off
- Upgrading from 1.8.x: install over it in your mod manager; nothing else changes

## 1.8.5-beta
- The clock's month follows the chosen language again: French read "Morndas 1 Heartfire" because the game spells the month Heartfire. The plugin now sends the month and day by number, so the date is right whatever language the game itself is in
- Month, day and creature names are taken from the game's own localised strings (French, German, Italian, Spanish, Polish, Japanese, Chinese). Several change, for example Vasard (French mudcrab), Zweigling (German spriggan), Ślizgacz (Polish skeever) and 薪木の月 with 月 for Morndas in Japanese
- Egg and pet buttons in the settings no longer squeeze their labels onto two lines in French and German; a button that does not fit moves to the next row. The same in the DovahHub tab. A long date wraps inside the clock plate instead of running past it
- French says ATH for the HUD, as the French game does
- Upgrading from 1.8.4-beta: install over it in your mod manager; nothing else changes

## 1.8.4-beta
- DovahMenu (0.3.5-beta or later) shows the MiniPets description in its own language
- Upgrading from 1.8.3-beta: install over it in your mod manager; nothing else changes

## 1.8.3-beta
- Every language other than English is translated in full: each companion's own moving and fighting lines, Skyrim's month names, every species, and the feeding, playing and hatching celebrations. These are machine translations, using the game's own terms where known; corrections welcome
- The MiniPets tab in DovahHub follows MiniPets' Language setting: headings, bars, buttons, the About facts, the companion picker and every result line
- MiniPets' options on DovahHub's Settings tab, and the warning about a leftover DragonbornXP.dll, are in the chosen language too
- The card's Warmth label and the settings panel's Warmth, Food and Happiness labels were always English; they follow the language now
- Fixes in the existing translations: the hotkey hint in French, Italian and Spanish said "click a key" where it means "click a key box"; German "Der Drachenblut" is "Das Drachenblut"; Japanese and Korean left "Space" in English; Italian dates used the Spanish "de"
- Upgrading from 1.8.2-beta: install over it in your mod manager; nothing else changes

## 1.8.2-beta
- English reads as it did in 1.8.0 again: each companion's own moving and fighting lines, "Smithing grows stronger.", "Level 3!", the egg's level-up line, "Feed (after hatching)" and "Click again to start over". Other languages use a shared line for moving and fighting until the companions' own lines are translated
- The rest of the card is translated too: growth stages, mood hints, egg hints, the hungry, lonely, full, tired and no-food notices, and the hotkey names in the settings hint
- The settings heading reads MINIPETS instead of the old name
- Upgrading from 1.8.1-beta: install over it in your mod manager; nothing else changes

## 1.8.1-beta
- A Language setting with ten languages. Translations other than English are machine translations, and the setting says so; corrections welcome
- The egg is named in the chosen language ("Ei von Ember" rather than "Ember's egg")
- If `i18n.js` is missing from the view folder the card stays in English instead of stopping; `MiniPets.log` says which language and catalogue the page used
- Upgrading from 1.8.0-beta: install over it in your mod manager; nothing else changes

## 1.8.0-beta
- Upgrading from 1.7.3: install this zip over the old one in your mod manager and let it replace the files, then start the game. Your pet, settings and hotkeys are kept. A clean install needs nothing extra. Do not keep 1.7.3 enabled next to it
- The files are named after the mod: `MiniPets.dll`, `MiniPets.log`, `MiniPets.ini` and `PrismaUI/views/MiniPets`. Mod managers replace them on upgrade; hand-copied installs should delete `SKSE/Plugins/DragonbornXP.dll` and `PrismaUI/views/DragonbornXP` first (the game shows a reminder if the old DLL is still loaded)
- Pets carry over: the save record is unchanged, and `DragonbornXP.ini` is copied to `MiniPets.ini` on the first load
- `dovahmenu.json` ships with the view, so DovahMenu lists the mod as MiniPets with its Shift+B key

## 1.7.3
- A MiniPets tab in DovahHub (0.92.1 or later, under Integrations): your companion or the pet you're raising, its bars, Feed and Play, the companion picker, and MiniPets' options on DovahHub's Settings tab. Nothing changes without DovahHub
- An API for other SKSE plugins (`MiniPets_API.h`): state, feed, play, companion, card and clock settings, and events
- Card size goes up to 200%
- In the DovahHub tab the pet and the companion thumbnails idle like the HUD card, the companion grid stays in colour while raising a pet (behind a "Change HUD companion" button, with a line saying who sits on the HUD when raise-a-pet is off), and the bars show their numbers

## 1.6.1
- Feed and play hotkeys are ignored while the pet is hidden, so food doesn't vanish off screen
- Cuddling an egg has the same cooldown as playing, so it can't be hatched by mashing the key
- Fixed a key box staying in "press a key" mode if a game menu closed the settings while rebinding
- Feeding with no egg picked says so instead of "Eggs don't eat"
- The play hotkey row stops saying "Cuddle your egg" after Start over
- Hotkey clashes are spotted whatever the capitalisation, and the SKSE log warns if two actions share a key
- The log names the mod menu that hid the pet

## 1.6.0
- Hotkey to hide or show the pet (Shift+V, rebindable). It stays hidden until you press it again, and still shows while the settings menu is open

## 1.5.2
- Hides while other mods' menus are open, like SKSE Menu Framework and Swiftly Order Squad

## 1.5.1
- The play hotkey says "Cuddle your egg" in settings while your pet is an egg, so it's clear which key cuddles

## 1.5.0
- Card shape setting: square, or wide to see more of the scenery (`card_shape` in the INI)

## 1.4.1
- Fixed rebinding hotkeys in game (Shift+key combinations weren't picked up)
- The Feed button says "after hatching" while your pet is still an egg, instead of just being greyed out
- Fixed the clock setting description (the clock is above the card now)

## 1.4.0
- Your pet's food and happiness bars (or the egg's warmth) now sit under the card, and turn red when low
- The clock moved above the card
- Positioning keeps the clock and bars on screen

## 1.3.0
- Hotkeys to feed (Shift+N) and play with (Shift+K) your pet without opening the menu, both rebindable in settings
- Settings won't let two actions share the same key

## 1.2.0
- Raise a pet (optional, Settings > Pet): pick an egg, keep it warm with XP until it hatches, then watch it grow from baby to adult
- Feed it by eating food yourself, or with the Feed button (uses the cheapest food in your pack)
- Play with it to keep it happy. A neglected pet gets hungry or sad but never dies
- Your pet is saved with each character

## 1.1.0
- Size setting (50-150%) with a slider and a box to type the value, saved as `scale` in the INI
- Fixed dragon fire (and other effects) spilling outside the frame

## 1.0.0
- First public release
- Licence notices for the bundled libraries are included with the download

## 0.10.0
- New backdrops: Whiterun, Windhelm, Solitude, Riften, Markarth, Blackreach, Apocrypha, Soul Cairn, Sovngarde, caves, homes, inns, mines, temples, vampire lairs and Falmer hives
- Home and inn windows show the time of day and weather outside
- Ambient particles per place (drips, spores, leaves, pages, souls...)
- Place picker in the animation lab, `?preview=places`

## 0.9.0
- Location backdrops: Solstheim (with Red Mountain), Dwemer ruins and Nordic tombs
- No sky or weather indoors

## 0.8.0
- Parallax scrolling while you travel

## 0.7.0
- Sun and moons move with the in-game clock
- Pixel landscape behind the pet, changes every in-game day
- Sunset sun is redder so it doesn't look like fire breath
- `?preview=timelapse`

## 0.6.0
- Low sun at dawn and sunset

## 0.5.0
- Sun on clear days

## 0.4.0
- Masser and Secunda at night

## 0.3.0
- Optional clock under the card (plate or ribbon style)
- Settings menu scrolls on small screens

## 0.2.2
- Fixed the pet showing on the launch splash/loading screens
- Show/hide is logged to the SKSE log

## 0.2.1
- Clack is grey now, like an actual mudcrab

## 0.2.0
- Pixel art for all 20 companions with proper animations
- Skyrim-style frame and caption
- Drag the card to move it, sliders update live
- Rain, snow and storm effects
- F6/F7 test keys are off unless `debug_preview_keys=1`
- Release zip renamed to `dovhub-minipets<version>.zip`
- Settings menu is centred
- Draws under other Prisma UI menus and hides while they're open
- Fixed: showing on the title screen, hotkey opening over game menus, sliders only moving one axis, pet getting stuck after toasts, dragon soul counts, unescaped strings

## 0.1.0
- First version
