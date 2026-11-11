#pragma once

#include "Reactions.h"

#include <array>
#include <cstdint>
#include <string>
#include <string_view>

// The in-game self-test (DMP-11): the step list, the expected reactions and the shared line format.
// The game work lives in main.cpp; this part is standard library only, so tests/cpp checks it without
// the game. Lines go to MiniPets.log, and to DovahHub when its Diagnostics > Run self-test started it:
//   SELFTEST pets <step> PASS|FAIL|SKIP <detail>
//   SELFTEST pets DONE pass=N fail=N skip=N ms=N
// "pets" is MiniPets' DovahHub module id, so one search finds MiniPets' lines in both logs.
namespace SelfTest
{
    inline constexpr std::string_view kMod = "pets";
    inline constexpr std::size_t kMaxDetailBytes = 200;
    inline constexpr std::size_t kMaxStepBytes = 48;
    // the run's own limit, well inside DovahHub's 180 s
    inline constexpr int kRunBudgetSeconds = 150;

    struct Step
    {
        std::string_view name;
        std::string_view checks;  // what TESTING.md says it checks
    };

    // in the order they run
    inline constexpr std::array<Step, 14> kSteps{ {
        { "pet.summon", "a test companion is put on the card, and the page draws it" },
        { "pet.follow", "the card's pose follows the player's movement state" },
        { "pet.listed", "MiniPets' API state lists the test companion" },
        { "react.lowhealth", "the health handler under 25% offers cower, reactCareful" },
        { "react.sleep", "the sleep-start handler offers sleep, reactSleeping, held" },
        { "react.boss", "a boss kill (a spawned, disabled giant) offers hop, reactBossDown" },
        { "react.death", "the death handler for the player offers sad, reactFallen, held" },
        { "react.milestone", "DovahHub's story event Horse Master I offers fanfare, reactMilestone" },
        { "react.lines", "every reaction line is in the catalogue of the current language" },
        { "save.stale", "a pet state from another save, without a session or while loading is refused" },
        { "save.newgame", "a new game clears the pet and the page follows; the pet is put back" },
        { "pump", "which pump ran the work, and that every step ran on the game thread" },
        { "cleanup", "companion, raise-a-pet, poses and the test giant are put back or removed" },
        { "cleanup.page", "the card draws the player's own pet or companion again" },
    } };

    enum class Result
    {
        Pass,
        Fail,
        Skip,
    };

    inline const char* ResultWord(Result result)
    {
        switch (result) {
        case Result::Pass: return "PASS";
        case Result::Fail: return "FAIL";
        case Result::Skip: return "SKIP";
        }
        return "FAIL";
    }

    inline const char* ResultJson(Result result)
    {
        switch (result) {
        case Result::Pass: return "pass";
        case Result::Fail: return "fail";
        case Result::Skip: return "skip";
        }
        return "fail";
    }

    // DovahHub's rule: 1 to 48 letters, digits, '-', '_' or '.'
    inline bool IsStepName(std::string_view step)
    {
        if (step.empty() || step.size() > kMaxStepBytes) {
            return false;
        }
        for (const char c : step) {
            const bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.';
            if (!ok) {
                return false;
            }
        }
        return true;
    }

    // one line, at most 200 bytes (so at most 200 characters), never cut inside a UTF-8 sequence
    inline std::string OneLine(std::string_view detail)
    {
        std::string out;
        out.reserve(detail.size());
        bool space = false;
        for (const char c : detail) {
            const bool blank = c == '\r' || c == '\n' || c == '\t' || c == ' ';
            if (blank) {
                space = !out.empty();
                continue;
            }
            if (static_cast<unsigned char>(c) < 0x20) {
                continue;
            }
            if (space) {
                out += ' ';
                space = false;
            }
            out += c;
        }
        return Reactions::ClipUtf8(std::move(out), kMaxDetailBytes);
    }

    // ReportSelfTestStep's JSON: {"step":"...","result":"pass","detail":"..."}
    inline std::string StepJson(std::string_view step, Result result, std::string_view detail)
    {
        return "{\"step\":" + Reactions::JsonText(step) + ",\"result\":\"" + ResultJson(result) + "\",\"detail\":" +
               Reactions::JsonText(OneLine(detail)) + "}";
    }

    // counts the steps and words the lines
    class Report
    {
    public:
        // the log line for one step
        std::string Line(std::string_view step, Result result, std::string_view detail)
        {
            switch (result) {
            case Result::Pass: ++pass_; break;
            case Result::Fail: ++fail_; break;
            case Result::Skip: ++skip_; break;
            }
            const auto text = OneLine(detail);
            return "SELFTEST " + std::string(kMod) + " " + std::string(step) + " " + ResultWord(result) + (text.empty() ? "" : " " + text);
        }

        std::string Done(std::int64_t ms) const
        {
            return "SELFTEST " + std::string(kMod) + " DONE pass=" + std::to_string(pass_) + " fail=" + std::to_string(fail_) +
                   " skip=" + std::to_string(skip_) + " ms=" + std::to_string(ms < 0 ? 0 : ms);
        }

        int Passed() const { return pass_; }
        int Failed() const { return fail_; }
        int Skipped() const { return skip_; }

    private:
        int pass_ = 0;
        int fail_ = 0;
        int skip_ = 0;
    };

    // DovahHub's runJson: {"runId":"20261112-101500","lang":"en","host":"0.98.0","hubOpen":true}; other keys ignored
    struct Run
    {
        std::string runId;
        std::string lang;
        std::string host;
        bool hubOpen = false;
        bool fromHub = false;
    };

    inline Run ParseRunJson(std::string_view json)
    {
        Run run;
        run.fromHub = true;
        run.runId = Reactions::ClipUtf8(Reactions::ReadField(json, "runId").text, 64);
        run.lang = Reactions::ClipUtf8(Reactions::ReadField(json, "lang").text, 16);
        run.host = Reactions::ClipUtf8(Reactions::ReadField(json, "host").text, 32);
        run.hubOpen = Reactions::ReadField(json, "hubOpen").text == "true";
        return run;
    }

    // what each reaction step's handler must offer
    struct ExpectedReaction
    {
        std::string_view step;
        std::string_view source;
        std::string_view mood;
        std::string_view captionKey;
        bool hold;
    };

    inline constexpr std::array<ExpectedReaction, 5> kReactions{ {
        { "react.lowhealth", "minipets", "cower", "reactCareful", false },
        { "react.sleep", "minipets", "sleep", "reactSleeping", true },
        { "react.boss", "dovahdamage", "hop", "reactBossDown", false },
        { "react.death", "minipets", "sad", "reactFallen", true },
        { "react.milestone", "stable", "fanfare", "reactMilestone", false },
    } };

    // the story event react.milestone hands to the DovahHub message handler, as DovahStable's would arrive
    inline constexpr std::string_view kMilestoneEvent =
        R"({"key":"selftest.horse-master-1","kind":"milestone","category":"riding","subject":"","source":"stable","tier":1,"title":"Horse Master I"})";

    // every catalogue line a reaction can show (view/i18n.js); tests/selftest.test.js keeps it in step
    // with the catalogue's react* keys
    inline constexpr std::array<std::string_view, 22> kReactionLineKeys{ {
        "reactCheer", "reactWave", "reactSad", "reactCower", "reactSleep", "reactCurious", "reactHop", "reactFanfare",
        "reactBigHit", "reactBossDown", "reactBossDownSomeone", "reactCareful", "reactFallen", "reactGetUp",
        "reactJoined", "reactJoinedSomeone", "reactLost", "reactLostSomeone", "reactMilestone", "reactMilestoneSomething",
        "reactOutfit", "reactSleeping",
    } };

    inline std::string ReactionLineKeysJson()
    {
        std::string json = "[";
        for (std::size_t i = 0; i < kReactionLineKeys.size(); ++i) {
            json += (i ? "," : "") + Reactions::JsonText(kReactionLineKeys[i]);
        }
        return json + "]";
    }

    // the test companion: one that differs from the player's own, so the card visibly changes
    inline std::string_view TestCompanion(std::string_view current)
    {
        return current == "chicken" ? "fox" : "chicken";
    }

    // the page's base pose for the state the plugin last sent (view/animation-state.js normalizeState):
    // flying is "moving", and a landing settles into idle
    inline bool PoseFollows(std::string_view pluginState, std::string_view pageBase)
    {
        if (pluginState == "flying") {
            return pageBase == "moving";
        }
        if (pluginState == "combat") {
            return pageBase == "combat";
        }
        return pluginState == "idle" && pageBase == "idle";
    }
}
