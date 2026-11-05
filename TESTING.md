# In-game checks

The node tests (`node --test "tests/*.test.js"`) and the settings test (`xmake build MiniPets_tests && xmake run MiniPets_tests`) cover the page logic and the INI migration. These checks need the game, because they depend on Prisma UI's browser and the fonts on the player's PC.

`MiniPets.log` is in `Documents\My Games\Skyrim Special Edition\SKSE\`.

## Chinese, Japanese and Korean text

MiniPets ships no font. The page uses Georgia, so Chinese, Japanese and Korean characters come from whatever font Prisma UI falls back to. If none covers them, they show as empty boxes.

1. Load a save. Press Shift+B, set Language to 简体中文 and press Save.
2. `MiniPets.log` has `MiniPets page: language zh-CN, catalogue loaded`.
3. With settings open, check the headings: the title reads 伙伴设置.
4. Close settings and walk, then draw a weapon. The card shows 正在赶路, then 准备战斗.
5. Turn on the clock in settings. The date reads like 末种月17日 Morndas. Skyrim's day names stay as they are.
6. Turn on Raise a pet and look at the pet panel. An egg reads like Ember的蛋.
7. Repeat steps 1 to 6 with 日本語 (仲間の設定, 移動中, 戦闘準備完了, Emberのたまご) and 한국어 (동료 설정, 이동 중, 전투 준비 완료, Ember의 알).

Pass: every character is drawn, in any font. Fail: boxes or blank gaps in place of characters. Note which language and which spot (settings, card, clock, pet panel). A failure means MiniPets needs its own subset font, like DovahHub's.
