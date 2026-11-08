# In-game checks

The node tests (`node --test "tests/*.test.js"`) and the settings test (`xmake build MiniPets_tests && xmake run MiniPets_tests`) cover the page logic and the INI migration. These checks need the game, because they depend on Prisma UI's browser and the fonts on the player's PC.

`MiniPets.log` is in `Documents\My Games\Skyrim Special Edition\SKSE\`.

## Playthrough: reactions (1.9.0)

Play these in order on one character. Each step names the card's caption and the `MiniPets.log` line. Reactions never show over a menu or a loading screen, and the default gap between two of them is 8 seconds, so leave a few seconds between steps.

1. Load a save. The log has `MiniPets reactions: DovahDamage <version>, Chronicle <version>` (or `not found` for a mod you don't have).
2. **Low health.** Fight until your health is under a quarter. The companion shrinks back, trembles and covers its eyes, with blue drops over its head: "Careful! / Ember covers its eyes." Log: `MiniPets reaction: cower from minipets`. Dropping lower again does nothing. Heal past 40%, drop under a quarter again, and it shows again.
3. **Sleep.** Sleep an hour in a bed. After the fade the companion is curled up with closed eyes and a moon over it, "Sweet dreams / Ember curls up and sleeps.", for about four seconds, then it gets up. Log: `MiniPets reaction: sleep from minipets (held)`.
4. **DovahDamage, a new record** (needs DovahDamage). In a new save, the first hit you land cheers: the companion bounces with a star over it, "<number> damage! / Ember cheers." Log: `MiniPets reaction: cheer from dovahdamage`. Smaller hits do nothing; a bigger one cheers again. Save, load, and land a smaller hit than your best: nothing, because the record is kept in the save.
5. **A boss** (needs DovahDamage). Kill a dragon, a giant or a dungeon's boss with your own hit. The companion does a victory hop with a crown: "<name> is down! / Ember hops for joy." Log: `MiniPets reaction: hop from dovahdamage`. An ordinary bandit does nothing.
6. **DovahHub's story** (needs DovahHub 0.96.4-beta or later, with Your Story recording). Ask a follower to join you: a wave and a hand over the companion, "Hello, Lydia! / Ember waves hello." Reach a milestone tier: a fanfare with a note, "Wanderer II! / Ember sounds a little fanfare." Log: `MiniPets reaction: wave from dovahhub`, then `fanfare`.
7. **Outfit** (DovahHub). More than 30 seconds after a load, change the player's outfit in the Wardrobe tab, then close DovahHub: "New look? / Ember tilts its head, curious." Change it again at once: nothing, because it shows at most once in 10 minutes.
8. **Death.** Die (or `player.kill` in the console). The companion slumps with a tear and stays like that, "Oh no… / Ember looks sad.", until you load. After the load it is back to normal. Log: `MiniPets reaction: sad from minipets (held)`. With a mod that makes you bleed out instead, it reads "Get up!" and ends when you get up.
9. **Settings, in DovahHub's Settings tab under MiniPets.** Turn off React to other mods. A new record (step 4) and a follower joining (step 6) do nothing; the log says `not shown: off`. Low health (step 2) still shows. Turn it back on, and set Time between reactions to 30: two record hits within 30 seconds show once; the log says `not shown: cooldown` for the second.
10. **Shared moments count as care** (off by default). With raise-a-pet on and a hatched pet, turn it on. Each of the first three big moments of a game day (a record, a boss, a follower, a milestone) raises Happiness a little in the Shift+B panel; the fourth that day doesn't.
11. **Chronicle** (off by default, needs Chronicle). Turn on Your companion speaks in Chronicle. After a reaction, Chronicle's System tab shows a line from Ember: "Ember cheers." At most one line a minute, however many reactions there are.
12. **French.** Set the language to Français and repeat step 2: "Attention ! / Ember se cache les yeux." In DovahHub's Settings: Réagir aux autres mods, Délai entre les réactions.

Pass: each reaction appears once, reads in the chosen language, never covers a menu, and the death pose lasts only until the load. Fail: note the step, the caption, and the `MiniPets reaction` lines around it.

## Game thread (1.9.2)

Nothing to do but play; check `MiniPets.log` afterwards.

1. After the first load the log has `MiniPets: game thread <n>, first update ran on <n>`, both numbers the same.
2. Search the log for `ran off the game thread`. Pass: no such line. Fail: send the lines; each names the place (for example `250 ms update` or `view Invoke`) and the two threads.

## Save to save (1.9.1)

Nothing about one playthrough should show up in another. Settings (companion, card, clock, language, hotkeys, Shift+V hidden, raise-a-pet on or off) are the player's and apply to every save.

1. Save A: raise a pet (for example a fox) and play until it has hatched. Make a save.
2. Save B: a character that never had a pet, or a new game. Load it straight from A, without quitting to the menu. With raise-a-pet on, B shows the egg picker, not A's fox. `MiniPets.log` may show `MiniPets: pet state from an earlier save ignored (session …)` once or twice around the load; that line is the fix doing its job.
3. Load A again. The fox is back with the bars it had when you saved.
4. Quit to the main menu from A and start a new game. After the intro, the new character has no pet.
5. In A, die (the sad pose), then load B. B's companion is not sad. In A, change the player's outfit with DovahHub's Wardrobe, load B and, after 30 seconds, change B's outfit: the curious look shows (the 10-minute gap was A's).

Pass: B and the new game never show A's pet, its bars or a pose from A. Fail: note which save showed what, and the `MiniPets` lines around the load.

## Chinese, Japanese and Korean text

MiniPets ships no font. The page uses Georgia, so Chinese, Japanese and Korean characters come from whatever font Prisma UI falls back to. If none covers them, they show as empty boxes.

1. Load a save. Press Shift+B, set Language to 简体中文 and press Save.
2. `MiniPets.log` has `MiniPets page: language zh-CN, catalogue loaded`.
3. With settings open, check the headings: the title reads 伙伴设置.
4. Close settings and walk, then draw a weapon. The card shows 正在赶路, then 准备战斗.
5. Turn on the clock in settings. The date reads like 末种月17日 周一: month and day as the Chinese release of the game writes them.
6. Turn on Raise a pet and look at the pet panel. An egg reads like Ember的蛋.
7. Repeat steps 1 to 6 with 日本語 (仲間の設定, 移動中, 戦闘準備完了, Emberの卵) and 한국어 (동료 설정, 이동 중, 전투 준비 완료, Ember의 알).

Pass: every character is drawn, in any font. Fail: boxes or blank gaps in place of characters. Note which language and which spot (settings, card, clock, pet panel). A failure means MiniPets needs its own subset font, like DovahHub's.

## No English left in a translated language

Run this in French and in Japanese; each check names what English would look like if something were missed. Names (Ember, Clack, Dovahmin) and key names (Shift+B) stay as they are in every language. Day names follow the game: the French, German, Italian, Spanish and Polish releases keep Morndas and the rest; Japanese and Chinese translate them.

1. Set Language to Français in the card's settings (Shift+B) and press Save. `MiniPets.log` has `MiniPets page: language fr, catalogue loaded`.
2. Settings panel: with Raise a pet on and an egg picked, the bars read Chaleur (egg), then Nourriture and Bonheur once hatched. No Warmth, Food or Happiness.
3. Card: walk with the fox (Ember), then draw a weapon. It reads "En avant ! / Ember trotte à vos côtés." then "Hop, à l’attaque ! / Ember bondit dans la mêlée.". Switch to the mudcrab (Clack): "Trotte, trotte !" and "Clac clac !". Two companions, two different lines.
4. Clock on: the date reads like `Morndas 17 Vifazur` (French month names). On the 1st of Heartfire it reads `Morndas 1 Atrefeu`, not `Morndas 1 Heartfire`. With the Plate style and Italian, a long date (`Middas, 28 di Stella del Mattino`) wraps onto two lines inside the plate.
5. Raising a hatched pet: feed it (Shift+N), then play (Shift+K). The card reads "Ember a bien mangé / Miam, …" and "Ember adore jouer ! / Le bonheur augmente.".
6. DovahHub, MiniPets tab: Votre compagnon, À propos, Compagnons, Nourrir and Jouer; the About facts (Éclos, Il y a … jours, Nourriture dans le sac, Touches). Click a companion: "… s’affichera sur votre ATH quand l’élevage sera désactivé."
7. DovahHub, Settings, MiniPets: Élever un compagnon, Afficher l’horloge, Taille de la carte, Forme de la carte, Masquer la carte, Langue. Change Language there to 日本語 and reopen Settings: the labels follow (仲間を育てる, 時計を表示, カードの大きさ). `MiniPets.log` has `MiniPets: DovahHub settings sent again in ja`.
8. Repeat steps 2 to 6 in 日本語: ぬくもり, 食べ物, 幸せ; "さあ行こう！" for the fox and "カサカサ！" for the mudcrab; the date like `収穫の月17日（月）`; the tab reads あなたの仲間, 情報, 仲間.

Pass: no English words on any of those screens apart from names and keys, and no button label broken over two lines (in French with an egg: "Nourrir (après l’éclosion)", "Câliner (Shift+K)" and "Recommencer" each on one line; a button that does not fit moves to the next row whole). Check German too: "Füttern (nach dem Schlüpfen)", "Kuscheln (Shift+K)", "Neu beginnen". Fail: note the language, the screen and the English words.

## DovahMenu entry

Needs DovahMenu 0.3.5-beta or later.

1. Open DovahMenu (Home) with its language set to Français. The MiniPets row reads "Compagnon en pixel art sur l’ATH qui fête votre XP et vos niveaux ; élevez un compagnon, nourrissez-le et jouez avec lui".
2. Switch DovahMenu to 日本語 without rescanning: the row changes to "XPとレベルアップを祝ってくれるドット絵のHUD仲間。仲間を育て、餌をあげて一緒に遊べます".

Pass: the description follows DovahMenu’s language. The name stays MiniPets.
