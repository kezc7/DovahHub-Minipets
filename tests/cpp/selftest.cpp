// Checks src/SelfTest.h: the step list, the shared line format, DovahHub's step JSON, the run JSON and
// the reactions the steps expect. Run from settings_migration.cpp's main.
#include "SelfTest.h"

#include <iostream>
#include <set>

namespace
{
    int failures = 0;

    void Check(bool ok, const std::string& what)
    {
        std::cout << (ok ? "ok   " : "FAIL ") << what << '\n';
        if (!ok) {
            ++failures;
        }
    }
}

int RunSelfTestTests()
{
    using SelfTest::Result;

    // the step list
    {
        std::set<std::string_view> names;
        bool valid = true;
        for (const auto& step : SelfTest::kSteps) {
            valid = valid && SelfTest::IsStepName(step.name) && !step.checks.empty();
            names.insert(step.name);
        }
        Check(valid, "steps: every name is 1 to 48 of [A-Za-z0-9._-] and says what it checks");
        Check(names.size() == SelfTest::kSteps.size(), "steps: no name twice");
        Check(SelfTest::kSteps.front().name == "pet.summon" && SelfTest::kSteps.back().name == "cleanup.page", "steps: summon first, the clean-up last");
        for (const auto& reaction : SelfTest::kReactions) {
            Check(names.count(reaction.step) == 1, "steps: " + std::string(reaction.step) + " is in the list");
        }
        for (const auto* card : { "pet.summon", "react.lowhealth", "react.sleep", "react.boss", "react.death", "react.milestone", "react.lines", "save.stale", "save.newgame", "pump", "cleanup" }) {
            Check(names.count(card) == 1, std::string("steps: the card's check ") + card + " is there");
        }
    }

    // DovahHub's step-name rule
    {
        Check(SelfTest::IsStepName("react.boss") && SelfTest::IsStepName("A-z_0.9"), "name: letters, digits, '.', '-', '_'");
        Check(!SelfTest::IsStepName("") && !SelfTest::IsStepName("react boss") && !SelfTest::IsStepName("react/boss") && !SelfTest::IsStepName("é"),
              "name: empty, spaces, slashes and other letters refused");
        Check(SelfTest::IsStepName(std::string(48, 'a')) && !SelfTest::IsStepName(std::string(49, 'a')), "name: 48 characters at most");
    }

    // the detail: one line, 200 bytes at most, never cut inside a character
    {
        Check(SelfTest::OneLine("  shown\r\n sleep\t(held)  ") == "shown sleep (held)", "detail: line breaks and tabs become single spaces");
        Check(SelfTest::OneLine(std::string(300, 'x')).size() == 200, "detail: cut to 200");
        std::string japanese;
        for (int i = 0; i < 80; ++i) {
            japanese += "\xE7\x8C\xAB";  // 猫, three bytes
        }
        const auto cut = SelfTest::OneLine(japanese);
        Check(cut.size() == 198 && cut.size() % 3 == 0, "detail: cut at a character boundary (66 of 80 three-byte characters)");
        Check(SelfTest::OneLine("a\x01" "b") == "ab", "detail: control characters dropped");
    }

    // the log lines
    {
        SelfTest::Report report;
        Check(report.Line("react.sleep", Result::Pass, "shown sleep reactSleeping (held)") == "SELFTEST pets react.sleep PASS shown sleep reactSleeping (held)",
              "line: SELFTEST pets <step> PASS <detail>");
        Check(report.Line("react.boss", Result::Skip, "no giant") == "SELFTEST pets react.boss SKIP no giant", "line: SKIP");
        Check(report.Line("save.stale", Result::Fail, "") == "SELFTEST pets save.stale FAIL", "line: no trailing space without a detail");
        report.Line("pump", Result::Pass, "x\ny");
        Check(report.Passed() == 2 && report.Failed() == 1 && report.Skipped() == 1, "report: counts each result");
        Check(report.Done(4321) == "SELFTEST pets DONE pass=2 fail=1 skip=1 ms=4321", "line: SELFTEST pets DONE pass=N fail=N skip=N ms=N");
        Check(report.Done(-5) == "SELFTEST pets DONE pass=2 fail=1 skip=1 ms=0", "line: no negative time");
    }

    // ReportSelfTestStep's JSON
    {
        Check(SelfTest::StepJson("react.lines", Result::Fail, "fr lacks \"reactHop\"\n") == R"({"step":"react.lines","result":"fail","detail":"fr lacks \"reactHop\""})",
              "step JSON: escaped, one line, lower-case result");
        Check(SelfTest::StepJson("pump", Result::Skip, "") == R"({"step":"pump","result":"skip","detail":""})", "step JSON: skip");
        Check(SelfTest::StepJson("x", Result::Pass, std::string(250, 'y')).size() == std::string(R"({"step":"x","result":"pass","detail":""})").size() + 200,
              "step JSON: the detail cut to 200");
    }

    // DovahHub's run JSON, unknown keys ignored
    {
        const auto run = SelfTest::ParseRunJson(R"({"runId":"20261112-101500","lang":"de","host":"0.98.0","hubOpen":true,"later":{"x":1}})");
        Check(run.fromHub && run.runId == "20261112-101500" && run.lang == "de" && run.host == "0.98.0" && run.hubOpen, "run: every known key read");
        const auto bare = SelfTest::ParseRunJson("{}");
        Check(bare.fromHub && bare.runId.empty() && !bare.hubOpen, "run: missing keys are empty");
        Check(!SelfTest::Run{}.fromHub, "run: a run of MiniPets' own is not DovahHub's");
    }

    // what the steps expect agrees with the handlers
    {
        Reactions::Reaction milestone;
        Check(Reactions::FromStoryEvent(SelfTest::kMilestoneEvent, milestone), "milestone: the test story event makes a reaction");
        const auto& want = SelfTest::kReactions[4];
        Check(want.step == "react.milestone" && milestone.mood == want.mood && milestone.captionKey == want.captionKey && milestone.source == want.source &&
                  milestone.hold == want.hold && milestone.vars == R"({"title":"Horse Master I"})",
              "milestone: fanfare, reactMilestone from stable, titled Horse Master I");
        bool moods = true;
        for (const auto& reaction : SelfTest::kReactions) {
            moods = moods && Reactions::IsMood(reaction.mood, false);
        }
        Check(moods, "reactions: every expected mood is one the page draws");
        bool keys = true;
        for (const auto& reaction : SelfTest::kReactions) {
            bool listed = false;
            for (const auto key : SelfTest::kReactionLineKeys) {
                listed = listed || key == reaction.captionKey;
            }
            keys = keys && listed;
        }
        Check(keys, "reactions: every expected line is among the lines react.lines checks");
        Check(SelfTest::ReactionLineKeysJson().rfind(R"(["reactCheer","reactWave",)", 0) == 0 && SelfTest::ReactionLineKeysJson().back() == ']', "lines: sent to the page as a JSON array");
    }

    // the test companion and the pose
    {
        Check(SelfTest::TestCompanion("dovahmin") == "chicken" && SelfTest::TestCompanion("chicken") == "fox", "companion: always one other than the player's");
        Check(SelfTest::PoseFollows("idle", "idle") && SelfTest::PoseFollows("flying", "moving") && SelfTest::PoseFollows("combat", "combat"),
              "pose: the card's base follows the player's state (flying is the page's moving)");
        Check(!SelfTest::PoseFollows("flying", "idle") && !SelfTest::PoseFollows("combat", "moving") && !SelfTest::PoseFollows("idle", "") &&
                  !SelfTest::PoseFollows("landed", "idle"),
              "pose: a mismatch fails");
    }
    return failures;
}
