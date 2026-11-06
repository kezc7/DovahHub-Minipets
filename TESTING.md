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
7. Repeat steps 1 to 6 with 日本語 (仲間の設定, 移動中, 戦闘準備完了, Emberの卵) and 한국어 (동료 설정, 이동 중, 전투 준비 완료, Ember의 알).

Pass: every character is drawn, in any font. Fail: boxes or blank gaps in place of characters. Note which language and which spot (settings, card, clock, pet panel). A failure means MiniPets needs its own subset font, like DovahHub's.

## No English left in a translated language

Run this in French and in Japanese; each check names what English would look like if something were missed. Names (Ember, Clack, Dovahmin), Skyrim's day names (Morndas) and key names (Shift+B) stay as they are in every language.

1. Set Language to Français in the card's settings (Shift+B) and press Save. `MiniPets.log` has `MiniPets page: language fr, catalogue loaded`.
2. Settings panel: with Raise a pet on and an egg picked, the bars read Chaleur (egg), then Nourriture and Bonheur once hatched. No Warmth, Food or Happiness.
3. Card: walk with the fox (Ember), then draw a weapon. It reads "En avant ! / Ember trotte à vos côtés." then "Hop, à l’attaque ! / Ember bondit dans la mêlée.". Switch to the mudcrab (Clack): "Trotte, trotte !" and "Clac clac !". Two companions, two different lines.
4. Clock on: the date reads like `Morndas 17 Vifazur` (French month names).
5. Raising a hatched pet: feed it (Shift+N), then play (Shift+K). The card reads "Ember a bien mangé / Miam, …" and "Ember adore jouer ! / Le bonheur augmente.".
6. DovahHub, MiniPets tab: Votre compagnon, À propos, Compagnons, Nourrir and Jouer; the About facts (Éclos, Il y a … jours, Nourriture dans le sac, Touches). Click a companion: "… s’affichera sur votre HUD quand l’élevage sera désactivé."
7. DovahHub, Settings, MiniPets: Élever un compagnon, Afficher l’horloge, Taille de la carte, Forme de la carte, Masquer la carte, Langue. Change Language there to 日本語 and reopen Settings: the labels follow (仲間を育てる, 時計を表示, カードの大きさ). `MiniPets.log` has `MiniPets: DovahHub settings sent again in ja`.
8. Repeat steps 2 to 6 in 日本語: ぬくもり, 食べ物, 幸せ; "さあ行こう！" for the fox and "カサカサ！" for the mudcrab; the date like `収穫の月17日（Morndas）`; the tab reads あなたの仲間, 情報, 仲間.

Pass: no English words on any of those screens apart from names, day names and keys. Fail: note the language, the screen and the English words.

## DovahMenu entry

Needs DovahMenu 0.3.5-beta or later.

1. Open DovahMenu (Home) with its language set to Français. The MiniPets row reads "Compagnon en pixel art sur le HUD qui fête votre XP et vos niveaux ; élevez un compagnon, nourrissez-le et jouez avec lui".
2. Switch DovahMenu to 日本語 without rescanning: the row changes to "XPとレベルアップを祝ってくれるドット絵のHUD仲間。仲間を育て、餌をあげて一緒に遊べます".

Pass: the description follows DovahMenu’s language. The name stays MiniPets.
