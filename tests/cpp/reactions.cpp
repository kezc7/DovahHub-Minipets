// Checks src/Reactions.h: React()'s JSON, the global cooldown, priorities, held poses, the low-health
// margin and the biggest-hit record. Run from settings_migration.cpp's main.
#include "Reactions.h"

#include <iostream>

namespace
{
    int failures = 0;

    void Check(bool ok, const char* what)
    {
        std::cout << (ok ? "ok   " : "FAIL ") << what << '\n';
        if (!ok) {
            ++failures;
        }
    }

    Reactions::Reaction Make(const char* mood, int priority, int ms = 2500, bool hold = false)
    {
        Reactions::Reaction reaction;
        reaction.source = "test";
        reaction.mood = mood;
        reaction.priority = priority;
        reaction.ms = ms;
        reaction.hold = hold;
        return reaction;
    }
}

int RunReactionTests()
{
    using Reactions::Verdict;
    {
        Reactions::Reaction r;
        const auto error = Reactions::Parse(R"({"source":"dovahstable","mood":"cheer","caption":"Ember was born!","ms":2500,"priority":2})", r);
        Check(error == Reactions::ParseError::None, "parse: the header's example is accepted");
        Check(r.source == "dovahstable" && r.mood == "cheer" && r.caption == "Ember was born!" && r.ms == 2500 && r.priority == 2, "parse: every field read");
    }
    {
        Reactions::Reaction r;
        Check(Reactions::Parse(R"({"source":"x","mood":"cheer"})", r) == Reactions::ParseError::None && r.ms == 2500 && r.priority == 1 && r.caption.empty(), "parse: defaults are 2500 ms, priority 1, no caption");
        Check(Reactions::Parse(R"({"source":"x","mood":"cheer","ms":99999,"priority":7})", r) == Reactions::ParseError::None && r.ms == 6000 && r.priority == 2, "parse: ms and priority are clamped");
        Check(Reactions::Parse(R"({"source":"x","mood":"cheer","ms":10,"priority":-3})", r) == Reactions::ParseError::None && r.ms == 800 && r.priority == 0, "parse: low ms and priority are clamped");
        Check(Reactions::Parse(R"({"source":"x","mood":"dance"})", r) == Reactions::ParseError::Mood, "parse: an unknown mood is refused");
        Check(Reactions::Parse(R"({"source":"x","mood":"hop"})", r) == Reactions::ParseError::Mood, "parse: MiniPets' own moods are not open to React");
        Check(Reactions::Parse(R"({"mood":"cheer"})", r) == Reactions::ParseError::Source, "parse: a missing source is refused");
        Check(Reactions::Parse(R"({"source":"Dovah Stable","mood":"cheer"})", r) == Reactions::ParseError::Source, "parse: a source that is not a slug is refused");
        Check(Reactions::Parse("cheer", r) == Reactions::ParseError::NotJson, "parse: not JSON is refused");
        Check(Reactions::Parse(R"({"source":"x","mood":"wave","caption":"Fréd \"le\" bon\nami 🐴"})", r) == Reactions::ParseError::None &&
                  r.caption == "Fr\xc3\xa9" "d \"le\" bon ami \xf0\x9f\x90\xb4",
              "parse: caption escapes decoded, a newline becomes a space");
        Check(Reactions::Parse(R"({"source":"x","nested":{"mood":"sad"},"mood":"wave"})", r) == Reactions::ParseError::None && r.mood == "wave", "parse: only top-level keys count");
        Check(Reactions::Parse(R"({"source":"x","caption":"mood","mood":"curious"})", r) == Reactions::ParseError::None && r.mood == "curious", "parse: a value equal to a key name is not taken as the key");
        std::string longCaption = R"({"source":"x","mood":"cheer","caption":")";
        for (int i = 0; i < 70; ++i) {
            longCaption += "\xc3\xa9";  // 2 bytes each, 140 in all
        }
        longCaption += "\"}";
        Check(Reactions::Parse(longCaption, r) == Reactions::ParseError::None && r.caption.size() == 120, "parse: a long caption is cut to 120 bytes on a character boundary");
    }
    {
        Reactions::Gate gate;
        Check(gate.Offer(Make("cheer", 1), 0, true, true, true) == Verdict::Show, "gate: the first reaction shows");
        Check(gate.Offer(Make("wave", 1), 1000, true, true, true) == Verdict::Busy, "gate: priority 1 does not interrupt one that is showing");
        Check(gate.Offer(Make("wave", 0), 1000, true, true, true) == Verdict::Busy, "gate: priority 0 is dropped while one is showing");
        Check(gate.Offer(Make("wave", 1), 4000, true, true, true) == Verdict::Cooldown, "gate: within 8 s of the last one is the cooldown");
        Check(gate.Offer(Make("wave", 1), 8000, true, true, true) == Verdict::Show, "gate: after 8 s it shows");
        Check(gate.Offer(Make("sad", 2), 9000, true, true, true) == Verdict::Show, "gate: priority 2 interrupts");
        Check(gate.Offer(Make("cheer", 2), 12000, true, true, true) == Verdict::Show, "gate: priority 2 ignores the cooldown");
        Check(gate.Offer(Make("cheer", 1), 30000, true, false, true) == Verdict::Off, "gate: another mod's reaction is off with the switch off");
        Check(gate.Offer(Make("cheer", 1), 30000, true, false, false) == Verdict::Show, "gate: MiniPets' own reaction shows with the switch off");
        Check(gate.Offer(Make("cheer", 2), 60000, false, true, true) == Verdict::Hidden, "gate: nothing shows on a hidden card");
        gate.SetCooldownSeconds(1);
        Check(gate.CooldownMs() == 2000, "gate: the cooldown is at least 2 s");
        gate.SetCooldownSeconds(500);
        Check(gate.CooldownMs() == 60000, "gate: the cooldown is at most 60 s");
    }
    {
        Reactions::Gate gate;
        Check(gate.Offer(Make("sad", 2, 2500, true), 0, true, true, false) == Verdict::Show && gate.Held(), "hold: the death pose is held");
        Check(gate.Offer(Make("cheer", 2), 60000, true, true, true) == Verdict::Busy, "hold: a held priority-2 pose is not interrupted, even by priority 2");
        Check(gate.Offer(Make("cheer", 1), 60000, true, true, true) == Verdict::Busy, "hold: nothing else shows while held");
        Check(!gate.Release("sleep"), "hold: releasing another mood does nothing");
        Check(gate.Release("sad") && !gate.Held(), "hold: release ends it");
        Check(gate.Offer(Make("cheer", 1), 60001, true, true, true) == Verdict::Show, "hold: after release reactions show again");
        gate.Reset();
        Check(gate.Offer(Make("cheer", 1), 60002, true, true, true) == Verdict::Show, "reset: a load clears the cooldown");
    }
    {
        Reactions::Gate gate;
        Check(gate.Offer(Make("sleep", 1, 2500, true), 0, false, true, false) == Verdict::Show, "hold: the sleep pose goes on even while the sleep fade hides the card");
        Check(gate.Offer(Make("sad", 2, 2500, true), 1000, true, true, false) == Verdict::Show && gate.HeldMood() == "sad", "hold: a held priority-1 pose gives way to a priority-2 one");
    }
    {
        Reactions::Threshold low(0.25, 0.40);
        Check(!low.Update(0.9), "low health: full health does nothing");
        Check(low.Update(0.2), "low health: under 25% fires");
        Check(!low.Update(0.1), "low health: it fires once per dip");
        Check(!low.Update(0.3), "low health: 30% does not re-arm it");
        Check(!low.Update(0.2), "low health: so 20% again stays quiet");
        Check(!low.Update(0.5), "low health: back over 40% re-arms it");
        Check(low.Update(0.24), "low health: and the next dip fires");
        Reactions::Threshold fresh(0.25, 0.40);
        Check(!fresh.Update(0.0), "low health: 0 is never low health");
    }
    {
        Check(Reactions::IsNewRecord(120, 0), "record: the first hit of a save is a record");
        Check(!Reactions::IsNewRecord(120.5, 120), "record: half a point more is not");
        Check(Reactions::IsNewRecord(150, 120), "record: a bigger hit is");
        Check(!Reactions::IsNewRecord(80, 120), "record: a smaller one is not");
        Check(!Reactions::IsNewRecord(0.4, 0), "record: under 1 point is never one");
    }
    {
        Reactions::Reaction r;
        Check(Reactions::FromStoryEvent(R"({"key":"horse:x","kind":"joined","category":"life","subject":"Frost","source":"stable"})", r) &&
                  r.mood == "wave" && r.captionKey == "reactJoined" && r.vars == R"({"name":"Frost"})" && r.source == "stable" && r.care,
              "story: joined waves with the name");
        Check(Reactions::FromStoryEvent(R"({"key":"k","kind":"lost","subject":"Shadowmere","source":"stable"})", r) && r.mood == "sad" && r.priority == 2,
              "story: lost is a sad pose that interrupts");
        Check(Reactions::FromStoryEvent(R"({"key":"k","kind":"milestone","tier":2,"title":"Master Smith","source":"dovahhub"})", r) &&
                  r.mood == "fanfare" && r.vars == R"({"title":"Master Smith"})",
              "story: a milestone tier is a fanfare");
        Check(Reactions::FromStoryEvent(R"({"key":"k","kind":"achieved","tier":1,"title":"Thane","source":"dovahhub"})", r) && r.mood == "fanfare",
              "story: any event with a tier is a fanfare");
        Check(Reactions::FromStoryEvent(R"({"id":417,"kind":"companion","category":"life","source":"dovahhub","module":"","subject":"Lydia","days":12.5,"text":"Lydia joined me."})", r) &&
                  r.mood == "wave" && r.vars == R"({"name":"Lydia"})" && r.source == "dovahhub",
              "story: DovahHub's own follower event (kind companion) waves too");
        Check(!Reactions::FromStoryEvent(R"({"key":"k","kind":"found","subject":"a cog","source":"dovahhub"})", r), "story: other kinds are ignored");
        Check(!Reactions::FromStoryEvent(R"({"key":"k","kind":"joined","subject":"Pip","source":"pets"})", r), "story: MiniPets' own moments are ignored");
        Check(Reactions::FromStoryEvent(R"({"key":"k","kind":"joined","source":"dfc"})", r) && r.captionKey == "reactJoinedSomeone", "story: no subject uses the nameless line");
        Check(Reactions::FromStoryEvent(R"({"key":"k","kind":"joined","subject":"\"Lyd\"","source":"dfc"})", r) && r.vars == R"({"name":"\"Lyd\""})", "story: the name is escaped again for the page");
    }
    {
        Reactions::Reaction r;
        Check(Reactions::FromOutfitChange(R"({"actor":"player","outfit":3,"situation":"town","reason":"wardrobe"})", 100, 1e9, r) && r.mood == "curious" && r.priority == 0,
              "outfit: the player changing looks curious");
        Check(!Reactions::FromOutfitChange(R"({"actor":"Skyrim.esm|0xA2C94","outfit":3})", 100, 1e9, r), "outfit: a follower's change is ignored");
        Check(!Reactions::FromOutfitChange(R"({"actor":"player","outfit":3,"reason":"load"})", 100, 1e9, r), "outfit: a load is ignored");
        Check(!Reactions::FromOutfitChange(R"({"actor":"player","outfit":3})", 10, 1e9, r), "outfit: not in the first 30 s after a load");
        Check(!Reactions::FromOutfitChange(R"({"actor":"player","outfit":3})", 1000, 300, r), "outfit: at most once in 10 minutes");
    }
    // DMP-13: places
    {
        Reactions::Reaction r;
        Check(Reactions::FromPlace("whiterun", false, "Whiterun", r) && r.mood == "hop" && r.captionKey == "placeCity" && r.priority == 0 && !r.hold &&
                  r.vars == R"({"place":"Whiterun","region":"whiterun","memorable":true})",
              "place: a city hops, memorable, at the lowest priority");
        Check(Reactions::FromPlace("sovngarde", false, "Sovngarde", r) && r.mood == "curious" && r.captionKey == "placeRealm", "place: a realm is a wonder");
        Check(Reactions::FromPlace("tomb", false, "Bleak Falls Barrow", r) && r.mood == "cower" && r.captionKey == "placeDungeon" &&
                  r.vars.find(R"("memorable":false)") != std::string::npos,
              "place: a dungeon makes it stay close, and is not a memory");
        Check(Reactions::FromPlace("house", true, "Breezehome", r) && r.mood == "wave" && r.captionKey == "placeHome" && r.vars.find(R"("region":"home")") != std::string::npos,
              "place: the player's own house is home");
        Check(!Reactions::FromPlace("house", false, "Belethor's", r), "place: someone else's house says nothing");
        Check(!Reactions::FromPlace("skyrim", false, "Skyrim", r), "place: the wilds say nothing");
        Check(Reactions::FromPlace("inn", false, "The Bannered Mare", r) && r.captionKey == "placeInn" && Reactions::FromPlace("temple", false, "Temple of Kynareth", r) &&
                  r.captionKey == "placeTemple",
              "place: inns and temples");
        Check(Reactions::FromPlace("riften", false, "Riften \"Ratway\"", r, true) && r.vars.find(R"("test":true)") != std::string::npos &&
                  r.vars.find(R"(Riften \"Ratway\")") != std::string::npos,
              "place: a self-test's is marked, and the name is escaped");
        Check(Reactions::FromPlace("markarth", false, std::string(100, 'x'), r) && r.vars.find(std::string(61, 'x')) == std::string::npos, "place: a long name is clipped");
    }
    {
        int count = 0;
        std::string names;
        Reactions::ForEachObject(R"([{"formId":"0x00000014","name":"Prisoner {x}","killed":false},{"formId":"0x0001A2B3","name":"Alduin","killed":true}])",
            [&](std::string_view object) {
                ++count;
                names += Reactions::ReadField(object, "name").text + "|" + Reactions::ReadField(object, "killed").text + ";";
            });
        Check(count == 2 && names == "Prisoner {x}|false;Alduin|true;", "actors: every object read, braces inside names skipped");
    }
    return failures;
}
