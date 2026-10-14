# DragonbornXP

DragonbornXP is a small Skyrim Special Edition / Anniversary Edition SKSE plugin that uses Prisma UI for a transparent HUD toast. A chunky little pixel dragon celebrates skill XP, absorbed dragon souls, and player level-ups.

## What is implemented

- `SkillIncrease` events show `XP gained` with the affected skill.
- `DragonSoulsGained` events show the number of souls absorbed.
- `LevelIncrease` events trigger the larger level-up celebration.
- While the player is moving, the dragon flies; while the player is in combat, it breathes fire; after movement/combat stops, it lands before returning to idle.
- The overlay automatically hides during Skyrim loading screens and menus, then returns when gameplay resumes.
- The scene changes with Skyrim's time of day and weather: dawn, day, sunset, night, clear, cloudy, rain, snow, and storm.
- The settings menu opens with Shift+B by default and lets you rebind that hotkey plus set the dragon's exact X/Y screen position; choices persist in `Data/SKSE/Plugins/DragonbornXP.ini`.
- The settings menu can switch between named companions: Dovahmin, Dovahpink, Clack the Mudcrab, Nibbles the Skeever, Ember the Fox, Stripes the Sabre Cat, Webber the Frostbite Spider, Waddles the Horker, Grumble the Troll, Cinder the Flame Atronach, Shiver the Frost Atronach, Moss the Spriggan, Tinker the Dwarven Spider, Skitter the Chaurus, Bloop the Netch, Tusker the Mammoth, Masky the Dragon Priest, Glowbug the Wisp, Gnasher the Death Hound, and Pip the Chicken; the selected pet is persisted with the position and hotkey settings.
- F6 previews a Destruction XP toast; F7 previews level 42.
- Browser previews also support `?preview=fly`, `?preview=combat`, `?preview=land`, `?preview=dawn`, `?preview=sunset`, `?preview=night`, `?preview=rain`, and `?preview=snow`.
- The visual is a larger 256x256 local HTML/CSS/JavaScript companion card under `Data/PrismaUI/views/DragonbornXP/`; it has no network dependency.

## Build

Requirements are the ones from the official Prisma UI example: XMake 3+, a C++23 MSVC/Clang-CL toolchain, Skyrim SE/AE, SKSE64, Address Library, and Prisma UI. The `lib/commonlibsse-ng` folder is the CommonLib-NG dependency used by the template.

```powershell
xmake f -m release
xmake build
```

The post-build package is written to `dist/DragonbornXP_0.1.0/`. Install that folder into MO2 as a mod, or copy its `SKSE` and `PrismaUI` folders into the Skyrim `Data` directory.

## Notes

The dragon is code-native pixel art so the UI stays self-contained and easy to iterate. It includes horns, swept wings, back spikes, a muzzle with nostrils and teeth, claws, and a pointed tail; a later art pass can replace it with a sprite sheet without changing the event bridge.
