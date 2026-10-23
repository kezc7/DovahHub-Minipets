# Changelog

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
