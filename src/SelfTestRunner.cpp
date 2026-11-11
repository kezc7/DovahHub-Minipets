// The self-test runner (DMP-11, moved here by DMP-12): starts the run (MiniPets.ini, Chronicle or DovahHub),
// walks SelfTest.h's steps through the pump, asks the card what it draws, and reports each line.
#include "Plugin.h"

namespace MiniPets::SelfTestRunner
{
    namespace
    {
        // ---- the self-test (DMP-11): src/SelfTest.h has the steps and the line format, TESTING.md the how-to ----
        // Started by self_test=1 in MiniPets.ini (once, ten seconds after the first game loads), by Chronicle's
        // "/minipets selftest", or by DovahHub's Settings > Diagnostics > Run self-test. Never otherwise. The run
        // is a thread of its own that waits; every piece of game work in it goes through the pump, and calls
        // the handlers the game's events call. It changes the save it runs on (a new game is simulated and the
        // pet put back), so it is for a save that can be thrown away.

        std::atomic_bool g_selfTestRunning = false;
        std::atomic_bool g_selfTestIniDone = false;
        std::atomic_uint32_t g_selfTestJobs = 0;
        std::atomic_uint32_t g_selfTestOffThread = 0;
        std::mutex g_selfTestAnswerLock;
        std::condition_variable g_selfTestAnswerReady;
        std::uint32_t g_selfTestAskId = 0;
        std::string g_selfTestAnswer;  // the page's last answer to dragonbornXP.selfTest (JSON with its "id")

        struct SelfTestState
        {
            SelfTest::Run info;
            SelfTest::Report report;  // runner thread only
            bool fromChronicle = false;
            // written on the game thread, read by the runner after the job has run
            bool ready = false;
            std::string pet;
            bool raisePet = false;
            bool playerDead = false;
            std::string testPet;
            std::string companionState;
            std::string stateJson;
            ReactionWiring::OfferSeen offer;
            std::string note;
            bool checks[6]{};
            std::uint32_t oldSession = 0;
            std::uint32_t newSession = 0;
            std::string savedPet;
            float savedHit = 0.0f;
            RE::TESNPC* giant = nullptr;
            std::uint32_t giantId = 0;
            std::string ownSpecies;
            std::string language;
        };
        using SelfTestPtr = std::shared_ptr<SelfTestState>;

        // runs work on the game thread through the pump and waits for it; false when it hasn't run in time.
        // The work holds the run's state by shared pointer, so a job that runs late still writes somewhere valid.
        bool SelfTestOnGame(const char* where, std::function<void()> work, int timeoutMs = 5000)
        {
            auto done = std::make_shared<std::promise<void>>();
            auto future = done->get_future();
            GameThread(where)->Queue([work = std::move(work), done]() {
                g_selfTestJobs.fetch_add(1);
                if (!DovahGameThread::IsGameThread()) {
                    g_selfTestOffThread.fetch_add(1);
                }
                try {
                    work();
                } catch (const std::exception& error) {
                    logger::error("MiniPets: self-test work failed: {}", error.what());
                } catch (...) {
                    logger::error("MiniPets: self-test work failed");
                }
                done->set_value();
            });
            return future.wait_for(std::chrono::milliseconds(timeoutMs)) == std::future_status::ready;
        }

        // asks the HUD page (dragonbornXP.selfTest) what it draws; empty when it didn't answer
        std::string SelfTestAskPage(const std::string& extra = {}, int timeoutMs = 3000)
        {
            std::uint32_t id = 0;
            {
                std::lock_guard lock(g_selfTestAnswerLock);
                id = ++g_selfTestAskId;
                g_selfTestAnswer.clear();
            }
            const std::string question = "{\"id\":" + std::to_string(id) + extra + "}";
            if (!SelfTestOnGame("self-test question to the card", [question]() { Card::Invoke("dragonbornXP.selfTest", question); })) {
                return {};
            }
            const auto wanted = std::to_string(id);
            std::unique_lock lock(g_selfTestAnswerLock);
            if (!g_selfTestAnswerReady.wait_for(lock, std::chrono::milliseconds(timeoutMs),
                    [&]() { return Reactions::ReadField(g_selfTestAnswer, "id").text == wanted; })) {
                return {};
            }
            return g_selfTestAnswer;
        }

        // asks until the answer's field has the value wanted (the page applies settings as they arrive)
        std::string SelfTestAskUntil(std::string_view field, std::string_view wanted, int tries = 4)
        {
            std::string answer;
            for (int i = 0; i < tries; ++i) {
                answer = SelfTestAskPage();
                if (!answer.empty() && Reactions::ReadField(answer, field).text == wanted) {
                    return answer;
                }
                std::this_thread::sleep_for(std::chrono::milliseconds(400));
            }
            return answer;
        }

        std::string PageField(const std::string& answer, std::string_view field)
        {
            return Reactions::ReadField(answer, field).text;
        }

        void SelfTestReport(SelfTestState& run, std::string_view step, SelfTest::Result result, const std::string& detail)
        {
            logger::info("{}", run.report.Line(step, result, detail));
            if (run.info.fromHub && Hub::Present()) {
                const auto answer = Hub::ReportSelfTestStep(SelfTest::StepJson(step, result, detail).c_str());
                if (answer != DOVAHHUB_API::Result::Ok) {
                    logger::info("MiniPets: DovahHub did not take self-test step {} ({})", step, static_cast<int>(answer));
                }
            }
        }

        const char* kNoAnswer = "the HUD card did not answer (is the Prisma UI view loaded?)";

        std::string VerdictWords(Reactions::Verdict verdict)
        {
            switch (verdict) {
            case Reactions::Verdict::Hidden: return "the card is hidden (a menu or DovahHub is open, or Shift+V)";
            case Reactions::Verdict::Off: return "react to other mods is off";
            case Reactions::Verdict::Cooldown: return "within the cooldown";
            case Reactions::Verdict::Busy: return "another reaction is showing";
            default: return Reactions::VerdictName(verdict);
            }
        }

        // a reaction step: the handler must have offered what SelfTest::kReactions expects. When the gate showed
        // it, the card must be playing it; when the gate held it back (the card hidden, a setting), that's the
        // setting working and the detail says so.
        void SelfTestCheckOffer(SelfTestState& run, std::string_view step, bool ran)
        {
            const auto* want = &SelfTest::kReactions[0];
            for (const auto& expected : SelfTest::kReactions) {
                if (expected.step == step) {
                    want = &expected;
                }
            }
            const auto& got = run.offer;
            if (!ran) {
                SelfTestReport(run, step, SelfTest::Result::Fail, "the pump did not run the handler within 5 s");
                return;
            }
            if (!got.seen) {
                SelfTestReport(run, step, SelfTest::Result::Fail, "the handler offered no reaction" + (run.note.empty() ? std::string() : " (" + run.note + ")"));
                return;
            }
            if (got.mood != want->mood || got.captionKey != want->captionKey || got.source != want->source || got.hold != want->hold) {
                SelfTestReport(run, step, SelfTest::Result::Fail,
                    "offered " + got.mood + " " + got.captionKey + " from " + got.source + (got.hold ? " held" : "") + ", expected " +
                        std::string(want->mood) + " " + std::string(want->captionKey) + " from " + std::string(want->source));
                return;
            }
            const std::string what = got.mood + " " + got.captionKey + (got.hold ? " (held)" : "");
            if (got.verdict != Reactions::Verdict::Show) {
                SelfTestReport(run, step, SelfTest::Result::Pass, "offered " + what + "; not shown: " + VerdictWords(got.verdict) + run.note);
                return;
            }
            const auto answer = SelfTestAskPage();
            if (answer.empty()) {
                SelfTestReport(run, step, SelfTest::Result::Fail, "shown " + what + ", but " + kNoAnswer);
                return;
            }
            const auto playing = PageField(answer, "reaction");
            if (playing != got.mood) {
                SelfTestReport(run, step, SelfTest::Result::Fail, "shown " + what + ", but the card plays '" + playing + "'");
                return;
            }
            SelfTestReport(run, step, SelfTest::Result::Pass, "shown " + what + "; the card plays it" + run.note);
        }

        // a reaction step's job: a clean gate, the handler, what it offered; then the pose is ended
        bool SelfTestFire(const SelfTestPtr& run, const char* where, std::function<void()> fire)
        {
            return SelfTestOnGame(where, [run, fire = std::move(fire)]() {
                ReactionWiring::ResetGate();
                ReactionWiring::ClearLastOffer();
                run->note.clear();
                fire();
                run->offer = ReactionWiring::LastOffer();
            });
        }

        void SelfTestEndPose(const char* mood)
        {
            const std::string held = mood;
            (void)SelfTestOnGame("self-test pose end", [held]() {
                ReactionWiring::ReleaseReaction(held);
                ReactionWiring::ResetGate();
                Card::Invoke("dragonbornXP.reactEnd", "{}");
            });
        }

        // the first giant in the load order (Skyrim.esm's come first): a boss to IsBossActor by its keyword
        RE::TESNPC* FindTestGiant()
        {
            auto* data = RE::TESDataHandler::GetSingleton();
            if (!data) {
                return nullptr;
            }
            for (auto* npc : data->GetFormArray<RE::TESNPC>()) {
                if (npc && !npc->IsDeleted() && npc->race && npc->race->HasKeywordString("ActorTypeGiant")) {
                    return npc;
                }
            }
            return nullptr;
        }

        const char* PumpName()
        {
            const auto& pump = DovahGameThread::detail::S();
            switch (pump.mode.load()) {
            case DovahGameThread::detail::kHub: return "DovahHub's pump";
            case DovahGameThread::detail::kHook: return "MiniPets' own frame hook (no DovahHub pump)";
            case DovahGameThread::detail::kFallback: return "SKSE's UI tasks (no pump installed)";
            default: return "no pump yet";
            }
        }

        void RunSelfTest(SelfTestPtr run)
        {
            using SelfTest::Result;
            const auto started = std::chrono::steady_clock::now();
            const auto elapsed = [&]() {
                return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count();
            };
            g_selfTestJobs.store(0);
            g_selfTestOffThread.store(0);
            logger::info("MiniPets: self-test started ({}{}{})", run->info.fromHub ? "DovahHub run " + run->info.runId : run->fromChronicle ? std::string("Chronicle") : std::string("MiniPets.ini self_test=1"),
                         run->info.lang.empty() ? "" : ", DovahHub in " + run->info.lang, run->info.hubOpen ? ", DovahHub open" : "");

            const bool prepared = SelfTestOnGame("self-test start", [run]() {
                run->ready = g_gameLoaded.load() && !PetSave::Loading() && RE::PlayerCharacter::GetSingleton();
                run->pet = g_settings.pet;
                run->raisePet = g_settings.raisePet;
                run->playerDead = ReactionWiring::PlayerDead();
                run->testPet = std::string(SelfTest::TestCompanion(g_settings.pet));
            });
            if (!prepared || !run->ready) {
                const std::string why = prepared ? "no game is loaded" : "the pump did not run MiniPets' work within 5 s";
                for (const auto& step : SelfTest::kSteps) {
                    SelfTestReport(*run, step.name, Result::Skip, why);
                }
            }
            else {
                const auto outOfTime = [&](std::string_view step) {
                    if (elapsed() < SelfTest::kRunBudgetSeconds * 1000LL) {
                        return false;
                    }
                    SelfTestReport(*run, step, Result::Skip, "out of time (" + std::to_string(SelfTest::kRunBudgetSeconds) + " s)");
                    return true;
                };

                // 1. a test companion on the card (raise-a-pet paused, so the card draws it)
                if (!outOfTime("pet.summon")) {
                    (void)SelfTestOnGame("self-test summon", [run]() {
                        if (g_settings.raisePet) {
                            (void)Hub::ApiSetRaisePet(false);
                        }
                        (void)Hub::SetCompanion(run->testPet);
                    });
                    const auto answer = SelfTestAskUntil("species", run->testPet);
                    const auto drawn = PageField(answer, "species");
                    const std::string paused = run->raisePet ? " (raise-a-pet paused for the test)" : "";
                    if (answer.empty()) {
                        SelfTestReport(*run, "pet.summon", Result::Fail, kNoAnswer);
                    }
                    else if (drawn == run->testPet) {
                        SelfTestReport(*run, "pet.summon", Result::Pass, "the card draws " + run->testPet + paused);
                    }
                    else {
                        SelfTestReport(*run, "pet.summon", Result::Fail, "asked for " + run->testPet + ", the card draws '" + drawn + "'" + paused);
                    }
                }
                if (!outOfTime("pet.follow")) {
                    (void)SelfTestOnGame("self-test follow", [run]() {
                        Card::UpdateCompanionState();
                        run->companionState = Card::LastCompanionState();
                    });
                    const auto answer = SelfTestAskPage();
                    const auto base = PageField(answer, "base");
                    if (answer.empty()) {
                        SelfTestReport(*run, "pet.follow", Result::Fail, kNoAnswer);
                    }
                    else if (SelfTest::PoseFollows(run->companionState, base)) {
                        SelfTestReport(*run, "pet.follow", Result::Pass, "the player is " + run->companionState + ", the card's pose is " + base);
                    }
                    else {
                        SelfTestReport(*run, "pet.follow", Result::Fail, "the player is " + run->companionState + ", but the card's pose is '" + base + "'");
                    }
                }
                if (!outOfTime("pet.listed")) {
                    (void)SelfTestOnGame("self-test listed", [run]() {
                        run->stateJson = Hub::StateJson();
                        Hub::PushPetsState();
                    });
                    const auto listed = Reactions::ReadField(run->stateJson, "companion").text;
                    if (listed == run->testPet && run->stateJson.find("\"id\":\"" + run->testPet + "\"") != std::string::npos) {
                        SelfTestReport(*run, "pet.listed", Result::Pass, "the API state names " + listed + " as the companion");
                    }
                    else {
                        SelfTestReport(*run, "pet.listed", Result::Fail, "the API state names '" + listed + "', expected " + run->testPet);
                    }
                }

                // DMP-13: the card's growth and memory rules, run on a made-up pet the card builds for the question
            if (!outOfTime("pet.stage")) {
                const auto answer = SelfTestAskPage(",\"sim\":\"life\"");
                if (answer.empty()) {
                    SelfTestReport(*run, "pet.stage", Result::Fail, kNoAnswer);
                    SelfTestReport(*run, "pet.memory", Result::Fail, kNoAnswer);
                }
                else {
                    const auto start = PageField(answer, "simStart");
                    const auto grown = PageField(answer, "simGrown");
                    const auto events = PageField(answer, "simGrowEvents");
                    if (start == "baby" && PageField(answer, "simStartGrew") == "false" && grown == "young" && events == "grow:young") {
                        SelfTestReport(*run, "pet.stage", Result::Pass, "a test pet hatched 50 in-game hours ago grew from baby to young with one moment; yours is untouched");
                    }
                    else {
                        SelfTestReport(*run, "pet.stage", Result::Fail, "test pet: started '" + start + "', grew to '" + grown + "', moments '" + events + "'");
                    }
                    const auto said = PageField(answer, "simSaid");
                    const auto words = PageField(answer, "simWords");
                    if (PageField(answer, "simKept") == "true" && PageField(answer, "simAgain") == "false" && said == "whiterun" &&
                        PageField(answer, "simQuiet") == "true" && !words.empty()) {
                        SelfTestReport(*run, "pet.memory", Result::Pass, "a first visit kept once, brought up a day later ('" + words + "'), then quiet that day");
                    }
                    else {
                        SelfTestReport(*run, "pet.memory", Result::Fail, "kept " + PageField(answer, "simKept") + ", kept again " + PageField(answer, "simAgain") +
                                                                            ", brought up '" + said + "', quiet after " + PageField(answer, "simQuiet"));
                    }
                }
            }

            // 2. each reaction through the handler the game event calls
                if (!outOfTime("react.lowhealth")) {
                    const bool ran = SelfTestFire(run, "self-test low health", []() {
                        ReactionWiring::OnHealthShare(1.0);  // armed
                        ReactionWiring::OnHealthShare(0.2);
                    });
                    SelfTestCheckOffer(*run, "react.lowhealth", ran);
                    (void)SelfTestOnGame("self-test health re-arm", []() { ReactionWiring::OnHealthShare(1.0); });
                    SelfTestEndPose("cower");
                }
                if (!outOfTime("react.sleep")) {
                    const bool ran = SelfTestFire(run, "self-test sleep", []() {
                        ReactionWiring::FireSleepStart();
                    });
                    SelfTestCheckOffer(*run, "react.sleep", ran);
                    (void)SelfTestOnGame("self-test wake", []() { ReactionWiring::CancelSleepRelease(); });
                    SelfTestEndPose("sleep");
                }
                if (!outOfTime("react.boss")) {
                    (void)SelfTestOnGame("self-test find a giant", [run]() { run->giant = FindTestGiant(); }, 8000);
                    if (!run->giant) {
                        SelfTestReport(*run, "react.boss", Result::Skip, "no giant in the load order to stand in for a boss");
                    }
                    else {
                        const bool ran = SelfTestFire(run, "self-test boss kill", [run]() {
                            auto* giant = run->giant;
                            auto* player = RE::PlayerCharacter::GetSingleton();
                            auto ref = player ? player->PlaceObjectAtMe(giant, false) : RE::NiPointer<RE::TESObjectREFR>();
                            if (!ref) {
                                run->note = "the test giant could not be placed";
                                return;
                            }
                            // disabled in the frame it is placed, so it never stands in the world
                            ref->Disable();
                            run->giantId = ref->GetFormID();
                            const char* name = giant->GetName();
                            (void)ReactionWiring::OfferBossKill(run->giantId, name ? name : "");
                            ref->SetDelete(true);
                        });
                        if (!ReactionWiring::HasDovahDamage()) {
                            run->note += "; in play, boss kills come from DovahDamage, which is not installed";
                        }
                        SelfTestCheckOffer(*run, "react.boss", ran);
                        SelfTestEndPose("hop");
                    }
                }
                if (!outOfTime("react.death")) {
                    const bool ran = SelfTestFire(run, "self-test death", []() {
                        ReactionWiring::SetPlayerDead(false);
                        ReactionWiring::FirePlayerDeath();
                    });
                    SelfTestCheckOffer(*run, "react.death", ran);
                    (void)SelfTestOnGame("self-test get up", [run]() { ReactionWiring::SetPlayerDead(run->playerDead); });
                    SelfTestEndPose("sad");
                }
                if (!outOfTime("react.milestone")) {
                    bool ran = SelfTestOnGame("self-test milestone", []() {
                        ReactionWiring::ResetGate();
                        ReactionWiring::ClearLastOffer();
                        const std::string event(SelfTest::kMilestoneEvent);
                        SKSE::MessagingInterface::Message message{};
                        message.sender = "DovahHub";
                        message.type = DOVAHHUB_API::kMsgStoryEvent;
                        message.dataLen = static_cast<std::uint32_t>(event.size() + 1);
                        message.data = const_cast<char*>(event.c_str());
                        ReactionWiring::OnDovahHubMessage(&message);  // copies it and queues the reaction, as DovahHub's broadcast does
                    });
                    // the handler queued its work behind this job; the next job sees what it offered
                    ran = ran && SelfTestOnGame("self-test milestone read", [run]() {
                        run->note.clear();
                        run->offer = ReactionWiring::LastOffer();
                    });
                    SelfTestCheckOffer(*run, "react.milestone", ran);
                    SelfTestEndPose("fanfare");
                }

                // DMP-13: the place handler, as the card part calls it on a change of place
            if (!outOfTime("react.place")) {
                const bool ran = SelfTestFire(run, "self-test place", [run]() {
                    // places are a raised pet's: as the player had raise-a-pet, for this one call
                    const bool raise = g_settings.raisePet;
                    g_settings.raisePet = run->raisePet;
                    run->checks[5] = PetSave::HasPet() && !PetSave::PetIsEgg();
                    if (run->checks[5]) {
                        ReactionWiring::ForgetPlaces();
                        ReactionWiring::OnPlaceChanged("whiterun", false, "Whiterun", true);
                        // a real visit to Whiterun right after the run still gets its reaction
                        ReactionWiring::ForgetPlaces();
                    }
                    g_settings.raisePet = raise;
                });
                if (ran && !run->checks[5]) {
                    SelfTestReport(*run, "react.place", Result::Skip, "no hatched pet is raised in this save: places are a raised pet's");
                }
                else {
                    SelfTestCheckOffer(*run, "react.place", ran);
                    SelfTestEndPose("hop");
                }
            }

            // 3. the reaction lines in the current language
                if (!outOfTime("react.lines")) {
                    (void)SelfTestOnGame("self-test language", [run]() { run->language = g_settings.language; });
                    const auto answer = SelfTestAskPage(",\"keys\":" + SelfTest::ReactionLineKeysJson());
                    const auto language = PageField(answer, "language");
                    const auto missing = PageField(answer, "missing");
                    const auto count = std::to_string(SelfTest::kReactionLineKeys.size());
                    const std::string hub = !run->info.lang.empty() && run->info.lang != language ? " (DovahHub is in " + run->info.lang + ")" : "";
                    if (answer.empty()) {
                        SelfTestReport(*run, "react.lines", Result::Fail, kNoAnswer);
                    }
                    else if (language != run->language) {
                        SelfTestReport(*run, "react.lines", Result::Fail, "MiniPets is set to " + run->language + ", the card uses '" + language + "'");
                    }
                    else if (missing.empty()) {
                        SelfTestReport(*run, "react.lines", Result::Pass, language + ": all " + count + " reaction lines are in its own catalogue" + hub);
                    }
                    else {
                        SelfTestReport(*run, "react.lines", Result::Fail, language + " lacks (English shown instead): " + missing + hub);
                    }
                }

                // 4. save to save (the 1.9.1 checks)
                if (!outOfTime("save.stale")) {
                    const bool ran = SelfTestOnGame("self-test stale pet state", [run]() {
                        const auto session = PetSave::Session();
                        const std::string pet = "|{\"species\":\"fox\",\"stage\":\"egg\"}";
                        std::string out;
                        run->checks[0] = PetSave::AcceptPetState(std::to_string(session) + pet, out);
                        run->checks[1] = !PetSave::AcceptPetState(std::to_string(session - 1) + pet, out);
                        run->checks[2] = !PetSave::AcceptPetState(pet.substr(1), out);
                        const bool loading = PetSave::SetLoading(true);
                        run->checks[3] = !PetSave::AcceptPetState(std::to_string(session) + pet, out);
                        PetSave::SetLoading(loading);
                    });
                    const auto* c = run->checks;
                    if (ran && c[0] && c[1] && c[2] && c[3]) {
                        SelfTestReport(*run, "save.stale", Result::Pass, "this save's state taken; another save's, one without a session and one during a load refused");
                    }
                    else {
                        SelfTestReport(*run, "save.stale", Result::Fail, !ran ? std::string("the pump did not run it within 5 s") :
                            std::string("this save's ") + (c[0] ? "taken" : "REFUSED") + ", another save's " + (c[1] ? "refused" : "TAKEN") +
                            ", no session " + (c[2] ? "refused" : "TAKEN") + ", during a load " + (c[3] ? "refused" : "TAKEN"));
                    }
                }
                if (!outOfTime("save.newgame")) {
                    // the revert a new game or a load starts with, then the pet put back as a load would
                    const bool reverted = SelfTestOnGame("self-test new game", [run]() {
                        run->savedPet = PetSave::State();
                        run->savedHit = ReactionWiring::BestHit();
                        run->oldSession = PetSave::Session();
                        PetSave::RevertSave();
                        run->newSession = PetSave::Session();
                        run->checks[0] = PetSave::State().empty() && ReactionWiring::BestHit() == 0.0f;
                        run->checks[1] = PetSave::Loading() && run->newSession != run->oldSession;
                        std::string out;
                        run->checks[2] = !PetSave::AcceptPetState(std::to_string(run->oldSession) + "|" + (run->savedPet.empty() ? "{}" : run->savedPet), out);
                    });
                    const auto during = reverted ? SelfTestAskUntil("session", std::to_string(run->newSession)) : std::string();
                    const bool pageCleared = PageField(during, "session") == std::to_string(run->newSession) && PageField(during, "hasPet") == "false";
                    const bool restored = SelfTestOnGame("self-test pet put back", [run]() {
                        if (PetSave::Loading()) {
                            PetSave::SetState(run->savedPet);
                            ReactionWiring::SetBestHit(run->savedHit);
                            PetSave::FinishLoad();
                            Hub::PushPetsState();
                        }
                        run->checks[3] = PetSave::State() == run->savedPet && !PetSave::Loading();
                    }, 8000);
                    const auto after = SelfTestAskPage();
                    const bool pageBack = PageField(after, "hasPet") == (run->savedPet.empty() ? "false" : "true");
                    const auto* c = run->checks;
                    const std::string sessions = " (session " + std::to_string(run->oldSession) + " to " + std::to_string(run->newSession) + ")";
                    if (reverted && restored && c[0] && c[1] && c[2] && c[3] && pageCleared && pageBack) {
                        SelfTestReport(*run, "save.newgame", Result::Pass, "a new game cleared the pet and the card, and refused the old save's state" + sessions +
                                                                                (run->savedPet.empty() ? "; there was no pet to put back" : "; the pet is back"));
                    }
                    else {
                        SelfTestReport(*run, "save.newgame", Result::Fail,
                            std::string(!reverted ? "the revert did not run" : !c[0] ? "the pet was not cleared" : !c[1] ? "no new session or load" :
                                        !c[2] ? "the old save's state was taken" : !pageCleared ? (during.empty() ? kNoAnswer : "the card kept the old pet") :
                                        !restored || !c[3] ? "the pet was not put back" : "the card did not get the pet back") + sessions);
                    }
                }

                // 5. which pump ran the work
                {
                    const auto jobs = g_selfTestJobs.load();
                    const auto off = g_selfTestOffThread.load();
                    const std::string detail = std::string(PumpName()) + " ran " + std::to_string(jobs) + " jobs, " +
                                               (off ? std::to_string(off) + " of them off the game thread" : "all on the game thread " + std::to_string(GameThreadId()));
                    SelfTestReport(*run, "pump", DovahGameThread::Pumping() && off == 0 && jobs > 0 ? Result::Pass : Result::Fail, detail);
                }
            }

            // 6. clean up, whatever happened above
            if (run->ready) {
                const bool cleaned = SelfTestOnGame("self-test clean-up", [run]() {
                    std::string notes;
                    if (PetSave::Loading()) {
                        if (PetSave::State().empty() && !run->savedPet.empty()) {
                            PetSave::SetState(run->savedPet);
                            ReactionWiring::SetBestHit(run->savedHit);
                        }
                        PetSave::FinishLoad();
                        notes += "; a load left half done was finished";
                    }
                    (void)Hub::SetCompanion(run->pet);
                    (void)Hub::ApiSetRaisePet(run->raisePet);
                    ReactionWiring::SetPlayerDead(run->playerDead);
                    ReactionWiring::CancelSleepRelease();
                    ReactionWiring::ResetGate();
                    ReactionWiring::RearmLowHealth();
                    Card::Invoke("dragonbornXP.reactEnd", "{}");
                    if (run->giantId) {
                        if (auto* giant = RE::TESForm::LookupByID<RE::TESObjectREFR>(run->giantId); giant && !giant->IsDeleted()) {
                            giant->Disable();
                            giant->SetDelete(true);
                            notes += "; the test giant was removed again";
                        }
                    }
                    run->checks[4] = g_settings.pet == run->pet && g_settings.raisePet == run->raisePet && !ReactionWiring::GateHeld();
                    run->ownSpecies = run->raisePet ? Reactions::ReadField(PetSave::State(), "species").text : run->pet;
                    run->note = notes;
                }, 8000);
                SelfTestReport(*run, "cleanup", cleaned && run->checks[4] ? Result::Pass : Result::Fail,
                               cleaned ? (run->checks[4] ? "companion " + run->pet + ", raise-a-pet " + (run->raisePet ? "on" : "off") + ", no pose held" + run->note
                                                         : "the companion or raise-a-pet is not as it was" + run->note)
                                       : std::string("the pump did not run the clean-up within 8 s"));
                const auto answer = SelfTestAskUntil("species", run->ownSpecies);
                const auto drawn = PageField(answer, "species");
                if (answer.empty()) {
                    SelfTestReport(*run, "cleanup.page", Result::Fail, kNoAnswer);
                }
                else if (drawn == run->ownSpecies) {
                    SelfTestReport(*run, "cleanup.page", Result::Pass, "the card draws " + (drawn.empty() ? std::string("the egg picker (no pet yet)") : drawn) + " again");
                }
                else {
                    SelfTestReport(*run, "cleanup.page", Result::Fail, "the card draws '" + drawn + "', expected '" + run->ownSpecies + "'");
                }
            }

            const auto done = run->report.Done(elapsed());
            logger::info("{}", done);
            if (run->info.fromHub && Hub::Present()) {
                (void)Hub::FinishSelfTest();
            }
            if (run->fromChronicle && ReactionWiring::Chronicle()) {
                (void)ReactionWiring::Chronicle()->Send(CHRONICLE_API::Kind::Mod, "minipets", "MiniPets", done.c_str());
            }
            g_selfTestRunning.store(false);
        }

        // any thread; one run at a time
        void StartSelfTest(SelfTest::Run info, bool fromChronicle, int delaySeconds)
        {
            if (g_selfTestRunning.exchange(true)) {
                logger::info("MiniPets: a self-test is already running");
                if (info.fromHub && Hub::Present()) {
                    (void)Hub::ReportSelfTestStep(SelfTest::StepJson("start", SelfTest::Result::Fail, "a MiniPets self-test was already running").c_str());
                    (void)Hub::FinishSelfTest();
                }
                return;
            }
            auto run = std::make_shared<SelfTestState>();
            run->info = std::move(info);
            run->fromChronicle = fromChronicle;
            std::thread([run, delaySeconds]() {
                if (delaySeconds > 0) {
                    std::this_thread::sleep_for(std::chrono::seconds(delaySeconds));
                }
                try {
                    RunSelfTest(run);
                } catch (const std::exception& error) {
                    logger::error("MiniPets: self-test stopped: {}", error.what());
                    g_selfTestRunning.store(false);
                }
            }).detach();
        }

        // Chronicle's "/minipets selftest" (game thread)
        bool OnChronicleCommand(const char*, const char* args, void*)
        {
            const auto words = Trim(args ? args : "");
            if (words != "selftest" && words != "self-test") {
                return false;
            }
            StartSelfTest({}, true, 0);
            if (ReactionWiring::Chronicle()) {
                (void)ReactionWiring::Chronicle()->Send(CHRONICLE_API::Kind::Mod, "minipets", "MiniPets", "Self-test started; the lines go to MiniPets.log.");
            }
            return true;
        }

        CHRONICLE_API::CommandId g_chronicleCommand = 0;

    }

    // DovahHub's Run self-test (game thread): start and return
    void StartSelfTestFromHub(const char* runJson, void*)
    {
        try {
            StartSelfTest(SelfTest::ParseRunJson(runJson ? runJson : "{}"), false, 0);
        } catch (...) {
            logger::error("MiniPets: the self-test could not start");
        }
    }

    // self_test=1: one run, ten seconds after the first load or new game. The switch goes back to 0 in
    // the file as the run is set up, so it never runs again by itself (not even after a crash mid-run).
    void MaybeStartSelfTestFromIni()
    {
        if (!g_settings.selfTest || g_selfTestIniDone.exchange(true)) {
            return;
        }
        g_settings.selfTest = false;
        SaveSettings();
        logger::info("MiniPets: self_test=1, the self-test starts in 10 s; self_test is set back to 0");
        StartSelfTest({}, false, 10);
    }

    void RegisterChronicleCommand()
    {
        if (!ReactionWiring::Chronicle()) {
            return;
        }
        CHRONICLE_API::CommandDesc command{};
        command.size = sizeof(command);
        command.prefix = "minipets";
        command.help = "minipets selftest: run MiniPets' self-test on this (throwaway) save";
        command.onCommand = &OnChronicleCommand;
        const auto result = ReactionWiring::Chronicle()->RegisterCommand(&command, &g_chronicleCommand);
        logger::info("MiniPets: Chronicle command /minipets {}", result == CHRONICLE_API::Result::Ok ? "registered" : "not registered (" + std::to_string(static_cast<int>(result)) + ")");
    }

    // the card's answer to a question (any thread): only stored, no game work
    void OnPageAnswer(const char* payload)
    {
        {
            std::lock_guard lock(g_selfTestAnswerLock);
            g_selfTestAnswer = payload ? payload : "";
        }
        g_selfTestAnswerReady.notify_all();
    }
}
