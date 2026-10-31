# DovahHub Minipets

On Nexus: https://www.nexusmods.com/skyrimspecialedition/mods/195362

A little pixel-art companion that sits on your HUD in Skyrim SE/AE and cheers you on. It reacts to skill XP, dragon souls and level-ups, follows you around, and its little scene changes with the time, weather and wherever you happen to be.

Needs SKSE64, Address Library and Prisma UI.

## Features

- XP, dragon soul and level-up popups as a small caption under your companion.
- 20 companions: Dovahmin, Dovahpink, Clack the Mudcrab, Nibbles the Skeever, Ember the Fox, Stripes the Sabre Cat, Webber the Frostbite Spider, Waddles the Horker, Grumble the Troll, Cinder the Flame Atronach, Shiver the Frost Atronach, Moss the Spriggan, Tinker the Dwarven Spider, Skitter the Chaurus, Bloop the Netch, Tusker the Mammoth, Masky the Dragon Priest, Glowbug the Wisp, Gnasher the Death Hound and Pip the Chicken.
- They walk, fly or float when you move, get stuck in when you fight, and fidget when idle.
- Day/night cycle with the sun and both moons following the in-game clock, plus rain, snow and storms.
- A scrolling landscape behind them that changes every in-game day.
- Backdrops for Solstheim, the five major cities, Blackreach, Apocrypha, the Soul Cairn and Sovngarde, and for caves, homes, inns, mines, temples, Dwemer ruins, Nordic tombs, vampire lairs and Falmer hives.
- Optional raise-a-pet mode: pick an egg, hatch it with XP, then feed it and play with it. Saved per character.
- Optional in-game clock above the card.
- Hides itself on loading screens, in menus and when other Prisma UI menus are open.
- With [DovahHub](https://github.com/kezc7/DovahHub) 0.92.1 or later installed, a MiniPets tab under Integrations shows your companion or pet with Feed and Play, and MiniPets' options appear on DovahHub's Settings tab.

## Settings

Press **Shift+B** in game. You can pick your companion, drag the card wherever you like (or use the sliders), make it bigger or smaller or switch it to a wide card, switch on raise-a-pet mode and look after your pet (Shift+N to feed, Shift+K to play), hide or show the pet with Shift+V, turn the clock on and pick its style, and change any of the hotkeys. Settings are saved to `Data/SKSE/Plugins/MiniPets.ini`.

Setting `debug_preview_keys=1` in the INI turns on two test keys: F6 for an XP popup and F7 for a level-up.

## Installing

Install `dovahhub-minipets<version>.zip` with your mod manager, or copy its `SKSE` and `PrismaUI` folders into Skyrim's `Data` folder. It contains `SKSE/Plugins/MiniPets.dll`, `PrismaUI/views/MiniPets/` and the DovahHub tab under `PrismaUI/views/DovahHub/modules/pets/`.

### Upgrading from 1.7.x

1.8.0 renamed the files from DragonbornXP to MiniPets. Let your mod manager replace the mod and nothing else is needed: your pet is kept in the save, the settings are copied from `DragonbornXP.ini` to `MiniPets.ini` on the first load, and the hotkeys stay as they were. If you copied the files by hand, delete `SKSE/Plugins/DragonbornXP.dll` and the `PrismaUI/views/DragonbornXP` folder first; the game shows a reminder if the old DLL is still there.

## For other mods

`src/MiniPets_API.h` is a header-only API: `MINIPETS_API::RequestApi()` finds the DLL at runtime, so including it doesn't make MiniPets a hard requirement. It gives the pet state as JSON, Feed and Play, the companion, card and clock settings, and events (hatched, fed, played, level-up, companion, visible).

The DovahHub tab is `hub/modules/pets/`, shipped inside DovahHub's view folder as `PrismaUI/views/DovahHub/modules/pets/`. `pet-life.js` and `pet-sprites.js` there are copies of `view/`, refreshed by the build.

## Building

You'll need XMake 3+ and MSVC with C++23 support. CommonLibSSE-NG is in `lib/commonlibsse-ng`.

```powershell
xmake f -m release
xmake build
```

The build puts the files in `dist/MiniPets_<version>/` and makes the MO2 zip in the repo root.

Tests:

```powershell
node --test "tests/*.test.js"
```

## Previewing in a browser

The UI is plain HTML/CSS/JS in `view/`, so you can work on it without starting the game:

```powershell
python -m http.server 8765 --directory view
```

Then open `http://localhost:8765/?preview=lab`. Other useful previews: `sheet` (all companions), `places` (every backdrop), `timelapse` (a full day), `settings`, `clock`, or a place name like `?preview=whiterun`.

The in-game browser is WebKit based and doesn't support some newer CSS (like `inset` or the separate `translate`/`rotate`/`scale` properties), so animations stick to `transform` and `opacity`.

## Releases

The version is `PLUGIN_VERSION` in `xmake.lua`. Bump it, add a line to `CHANGELOG.md`, build, and tag the commit (`v0.10.0` and so on). Zips aren't committed, so build from a tag if you need an old one.

## License

GPL-3.0, see `LICENSE`. The plugin is built with CommonLibSSE-NG (GPL-3.0-or-later with modding exceptions) and a few MIT/BSD libraries; see `THIRD-PARTY-NOTICES.md`.
