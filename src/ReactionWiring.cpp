// The reaction wiring (DMP-12): the game's events, DovahDamage, DovahHub's story broadcast and other mods'
// React() calls, offered to the one gate in Reactions.h, and what it shows sent to the card.
#include "Plugin.h"

namespace MiniPets::ReactionWiring
{
    namespace
    {
        // ---- reactions (1.9.0): src/Reactions.h decides, the page draws ----

        // DovahHub's story broadcast (DHUB-67), 'DHB' 5
        using DOVAHHUB_API::kMsgStoryEvent;
        constexpr std::size_t kReactQueueDepth = 16;
        constexpr std::uint32_t kPlayerFormId = 0x14;

        Reactions::Gate g_reactionGate;
        Reactions::Threshold g_lowHealth(0.25, 0.40);
        std::mutex g_reactQueueLock;
        std::deque<std::string> g_reactQueue;   // React() JSON from any thread, drained on the game thread
        const DOVAHDAMAGE_API::DovahDamageApi1* g_damage = nullptr;
        const CHRONICLE_API::ChronicleApi1* g_chronicle = nullptr;
        float g_bestHit = 0.0f;                 // this save's biggest hit (co-save record 'HITS')
        std::uint32_t g_lastKills = 0;
        bool g_damageBaselined = false;
        std::unordered_set<std::uint32_t> g_killsSeen;
        double g_loadedAtMs = 0.0;
        double g_lastOutfitMs = -1e18;
        double g_lastChronicleMs = -1e18;
        double g_sleepReleaseAtMs = 0.0;
        bool g_playerDead = false;
        // DMP-13: when each place last got a reaction (NowMs)
        std::unordered_map<std::string, double> g_placeSeenMs;
        constexpr double kPlaceRepeatMs = 10.0 * 60.0 * 1000.0;
        bool g_bleedingOut = false;

        double NowMs()
        {
            using namespace std::chrono;
            return static_cast<double>(duration_cast<milliseconds>(steady_clock::now().time_since_epoch()).count());
        }

        OfferSeen g_lastOffer;

        // game thread. fromOtherMod: the "react to other mods" switch covers it (React, DovahDamage, DovahHub)
        void OfferReaction(const Reactions::Reaction& reaction, bool fromOtherMod)
        {
            const double now = NowMs();
            const bool visible = !Card::IsHidden() && !g_settings.petHidden;
            g_reactionGate.SetCooldownSeconds(g_settings.reactionCooldown);
            const auto verdict = g_reactionGate.Offer(reaction, now, visible, g_settings.reactToMods, fromOtherMod);
            const bool shown = verdict == Reactions::Verdict::Show;
            g_lastOffer = { true, reaction.source, reaction.mood, reaction.captionKey, reaction.hold, verdict };
            Hub::FirePetEvent("reaction", "{\"source\":" + JsonString(reaction.source) + ",\"mood\":" + JsonString(reaction.mood) +
                                         ",\"shown\":" + (shown ? "true" : "false") +
                                         (shown ? std::string() : std::string(",\"reason\":\"") + Reactions::VerdictName(verdict) + "\"") + "}");
            if (!shown) {
                logger::info("MiniPets reaction {} from {} not shown: {}", reaction.mood, reaction.source, Reactions::VerdictName(verdict));
                return;
            }
            // one Chronicle line a minute at most, when the player turned it on
            bool say = false;
            if (g_settings.chronicleLines && g_chronicle && now - g_lastChronicleMs >= 60000.0) {
                say = true;
                g_lastChronicleMs = now;
            }
            logger::info("MiniPets reaction: {} from {}{}", reaction.mood, reaction.source, reaction.hold ? " (held)" : "");
            Card::Invoke("dragonbornXP.react", "{\"source\":" + JsonString(reaction.source) + ",\"mood\":" + JsonString(reaction.mood) +
                                             ",\"caption\":" + JsonString(reaction.caption) + ",\"captionKey\":" + JsonString(reaction.captionKey) +
                                             ",\"vars\":" + (reaction.vars.empty() ? std::string("{}") : reaction.vars) +
                                             ",\"ms\":" + std::to_string(reaction.ms) + ",\"priority\":" + std::to_string(reaction.priority) +
                                             ",\"hold\":" + (reaction.hold ? "true" : "false") + ",\"care\":" + (reaction.care ? "true" : "false") +
                                             ",\"say\":" + (say ? "true" : "false") + "}");
        }

        void OwnReaction(const char* source, const char* mood, const char* captionKey, std::string vars, int ms, int priority, bool hold, bool care, bool fromOtherMod)
        {
            Reactions::Reaction reaction;
            reaction.source = source;
            reaction.mood = mood;
            reaction.captionKey = captionKey;
            reaction.vars = std::move(vars);
            reaction.ms = ms;
            reaction.priority = priority;
            reaction.hold = hold;
            reaction.care = care;
            OfferReaction(reaction, fromOtherMod);
        }

        // windows.h maps GetObject to GetObjectW, which hides BGSDefaultObjectManager::GetObject
    #ifdef GetObject
    #    undef GetObject
    #endif

        // a dragon, a giant, or a ref the game marks as a location's boss
        bool IsBossActor(std::uint32_t formId)
        {
            auto* actor = RE::TESForm::LookupByID<RE::Actor>(formId);
            if (!actor) {
                return false;
            }
            if (actor->HasKeywordString("ActorTypeDragon") || actor->HasKeywordString("ActorTypeGiant")) {
                return true;
            }
            const auto* refType = actor->extraList.GetByType<RE::ExtraLocationRefType>();
            if (!refType || !refType->locRefType) {
                return false;
            }
            const auto* defaults = RE::BGSDefaultObjectManager::GetSingleton();
            const auto* boss = defaults ? defaults->GetObject(RE::DEFAULT_OBJECT::kLocRefTypeBoss) : nullptr;
            return boss && static_cast<const RE::TESForm*>(refType->locRefType) == boss;
        }

        // game thread, on the 250 ms task: DovahDamage reads off its own frame queue, never its capture threads
        void PollDovahDamage()
        {
            WarnIfOffGameThread("DovahDamage poll");
            if (!g_damage) {
                return;
            }
            DOVAHDAMAGE_API::Totals totals{};
            totals.size = sizeof(totals);
            if (g_damage->GetTotals(&totals) != DOVAHDAMAGE_API::Result::Ok) {
                return;
            }
            const auto killedActors = [](auto&& onKilled) {
                Reactions::ForEachObject(g_damage->GetActorsJson(64), [&](std::string_view actor) {
                    if (Reactions::ReadField(actor, "killed").text != "true") {
                        return;
                    }
                    const auto id = static_cast<std::uint32_t>(std::strtoul(Reactions::ReadField(actor, "formId").text.c_str(), nullptr, 16));
                    if (id != 0 && id != kPlayerFormId) {
                        onKilled(id, Reactions::ReadField(actor, "name").text);
                    }
                });
            };
            if (!g_damageBaselined) {
                // what was already counted when MiniPets started looking is not news
                g_damageBaselined = true;
                g_lastKills = totals.kills;
                killedActors([](std::uint32_t id, const std::string&) { g_killsSeen.insert(id); });
                return;
            }
            if (Reactions::IsNewRecord(totals.biggestHit, g_bestHit)) {
                g_bestHit = totals.biggestHit;
                OwnReaction("dovahdamage", "cheer", "reactBigHit", "{\"amount\":" + std::to_string(std::lround(totals.biggestHit)) + "}", 3000, 1, false, true, true);
            }
            if (totals.kills > g_lastKills) {
                g_lastKills = totals.kills;
                bool boss = false;
                killedActors([&](std::uint32_t id, const std::string& name) {
                    if (g_killsSeen.insert(id).second && !boss) {
                        boss = OfferBossKill(id, name);
                    }
                });
            }
        }

        // the player's death: a sad pose until the next load
        class DeathSink final : public RE::BSTEventSink<RE::TESDeathEvent>
        {
        public:
            RE::BSEventNotifyControl ProcessEvent(const RE::TESDeathEvent* event, RE::BSTEventSource<RE::TESDeathEvent>*) override
            {
                if (event && event->actorDying && event->actorDying.get() == RE::PlayerCharacter::GetSingleton() && !g_playerDead) {
                    g_playerDead = true;
                    OwnReaction("minipets", "sad", "reactFallen", "{}", 2500, 2, true, false, false);
                }
                return RE::BSEventNotifyControl::kContinue;
            }
        };

        // sleeping: the pet curls up; the card is hidden behind the fade, so the pose stays until a few
        // seconds after waking, where the player sees it
        class SleepStartSink final : public RE::BSTEventSink<RE::TESSleepStartEvent>
        {
        public:
            RE::BSEventNotifyControl ProcessEvent(const RE::TESSleepStartEvent* event, RE::BSTEventSource<RE::TESSleepStartEvent>*) override
            {
                if (event) {
                    g_sleepReleaseAtMs = 0.0;
                    OwnReaction("minipets", "sleep", "reactSleeping", "{}", 2500, 1, true, false, false);
                }
                return RE::BSEventNotifyControl::kContinue;
            }
        };

        class SleepStopSink final : public RE::BSTEventSink<RE::TESSleepStopEvent>
        {
        public:
            RE::BSEventNotifyControl ProcessEvent(const RE::TESSleepStopEvent* event, RE::BSTEventSource<RE::TESSleepStopEvent>*) override
            {
                if (event && g_reactionGate.HeldMood() == "sleep") {
                    g_sleepReleaseAtMs = NowMs() + 4500.0;
                }
                return RE::BSEventNotifyControl::kContinue;
            }
        };

        DeathSink g_deathSink;
        SleepStartSink g_sleepStartSink;
        SleepStopSink g_sleepStopSink;

    }

    void ReleaseReaction(std::string_view mood)
    {
        if (g_reactionGate.Release(mood)) {
            Card::Invoke("dragonbornXP.reactEnd", "{\"mood\":" + JsonString(mood) + "}");
        }
    }

    // a load or a new game: nothing held, no cooldown, DovahDamage starts counting again
    void ResetReactions()
    {
        g_reactionGate.Reset();
        g_lowHealth.Rearm();
        g_playerDead = false;
        g_bleedingOut = false;
        g_sleepReleaseAtMs = 0.0;
        g_damageBaselined = false;
        g_lastKills = 0;
        g_killsSeen.clear();
        g_loadedAtMs = NowMs();
        g_lastOutfitMs = -1e18;
        g_lastChronicleMs = -1e18;
        g_placeSeenMs.clear();
        {
            std::lock_guard lock(g_reactQueueLock);
            g_reactQueue.clear();
        }
        Card::Invoke("dragonbornXP.reactEnd", "{}");
    }

    // DMP-13: a raised, hatched pet notices where you are. The card part calls this when the place changes,
    // never for the place a load starts in; the same place again only after ten minutes.
    void OnPlaceChanged(std::string_view region, bool home, const std::string& name, bool test)
    {
        if (!PetSave::HasPet() || PetSave::PetIsEgg()) {
            return;
        }
        Reactions::Reaction reaction;
        if (!Reactions::FromPlace(region, home, name, reaction, test)) {
            return;
        }
        const std::string key = home ? std::string("home") : std::string(region);
        const double now = NowMs();
        if (const auto seen = g_placeSeenMs.find(key); seen != g_placeSeenMs.end() && now - seen->second < kPlaceRepeatMs) {
            return;
        }
        g_placeSeenMs[key] = now;
        OfferReaction(reaction, false);
    }

    void ForgetPlaces()
    {
        g_placeSeenMs.clear();
    }

    // a kill DovahDamage counted: a boss gets a hop. True when it was a boss.
    bool OfferBossKill(std::uint32_t id, const std::string& name)
    {
        if (!IsBossActor(id)) {
            return false;
        }
        OwnReaction("dovahdamage", "hop", name.empty() ? "reactBossDownSomeone" : "reactBossDown",
                    "{\"name\":" + JsonString(Reactions::ClipUtf8(name, 60)) + "}", 3200, 2, false, true, true);
        return true;
    }

    // the player's share of health, from the 250 ms update: under 25% the pet cowers, once until it's back over 40%
    void OnHealthShare(double share)
    {
        if (g_lowHealth.Update(share)) {
            OwnReaction("minipets", "cower", "reactCareful", "{}", 3000, 1, false, false, false);
        }
    }

    // game thread, on the 250 ms task
    void UpdateReactions()
    {
        WarnIfOffGameThread("reaction drain");
        // nothing while a save loads: the counters and the record belong to the save being left
        if (!g_gameLoaded.load() || PetSave::Loading()) {
            return;
        }
        std::deque<std::string> pending;
        {
            std::lock_guard lock(g_reactQueueLock);
            pending.swap(g_reactQueue);
        }
        for (const auto& json : pending) {
            Reactions::Reaction reaction;
            if (Reactions::Parse(json, reaction) == Reactions::ParseError::None) {
                OfferReaction(reaction, true);
            }
        }

        if (g_sleepReleaseAtMs > 0.0 && NowMs() >= g_sleepReleaseAtMs) {
            g_sleepReleaseAtMs = 0.0;
            ReleaseReaction("sleep");
        }

        auto* player = RE::PlayerCharacter::GetSingleton();
        if (player && !g_playerDead) {
            const auto* state = player->AsActorState();
            const bool bleeding = state && state->IsBleedingOut();
            if (bleeding != g_bleedingOut) {
                g_bleedingOut = bleeding;
                if (bleeding) {
                    OwnReaction("minipets", "sad", "reactGetUp", "{}", 2500, 2, true, false, false);
                }
                else {
                    ReleaseReaction("sad");
                }
            }
            const float maxHealth = player->GetActorValueMax(RE::ActorValue::kHealth);
            const float health = player->AsActorValueOwner()->GetActorValue(RE::ActorValue::kHealth);
            if (!bleeding && maxHealth > 0.0f) {
                OnHealthShare(health / maxHealth);
            }
        }
        PollDovahDamage();
    }

    // DovahHub's broadcasts (DovahHub_API.h, SKSE messaging), game thread; copied and queued like the page's calls
    void OnDovahHubMessage(SKSE::MessagingInterface::Message* message)
    {
        if (!message || !message->data || (message->type != kMsgStoryEvent && message->type != DOVAHHUB_API::kMsgOutfitChanged)) {
            return;
        }
        const auto type = message->type;
        std::string json(static_cast<const char*>(message->data), message->dataLen ? message->dataLen - 1 : 0);
        json = json.c_str();  // stop at the terminator whatever dataLen says
        if (const auto tasks = GameThread("DovahHub message")) {
            tasks->Queue([type, json]() {
                if (!g_gameLoaded.load() || PetSave::Loading()) {
                    return;
                }
                Reactions::Reaction reaction;
                if (type == kMsgStoryEvent) {
                    if (Reactions::FromStoryEvent(json, reaction)) {
                        OfferReaction(reaction, true);
                    }
                    return;
                }
                const double now = NowMs();
                if (Reactions::FromOutfitChange(json, (now - g_loadedAtMs) / 1000.0, (now - g_lastOutfitMs) / 1000.0, reaction)) {
                    g_lastOutfitMs = now;
                    OfferReaction(reaction, true);
                }
            });
        }
    }

    // the page words the pet's Chronicle line in the player's language: {"speaker":"Pip","text":"Pip squeaks happily."}
    void SendChronicleLine(const std::string& json)
    {
        if (!g_chronicle || !g_settings.chronicleLines) {
            return;
        }
        const auto speaker = JsonField(json, "speaker");
        const auto text = JsonField(json, "text");
        if (text.empty()) {
            return;
        }
        const auto result = g_chronicle->Send(CHRONICLE_API::Kind::Mod, "minipets", speaker.c_str(), text.c_str());
        if (result != CHRONICLE_API::Result::Ok) {
            logger::info("MiniPets: Chronicle did not take the line ({})", static_cast<int>(result));
        }
    }

    void ConnectOtherMods()
    {
        g_damage = DOVAHDAMAGE_API::RequestApi();
        g_chronicle = CHRONICLE_API::RequestApi();
    }

    void LogOtherMods()
    {
        logger::info("MiniPets reactions: DovahDamage {}, Chronicle {}", g_damage ? g_damage->hostVersion : "not found",
                     g_chronicle ? g_chronicle->hostVersion : "not found");
    }

    void RegisterEvents()
    {
        if (auto* scripts = RE::ScriptEventSourceHolder::GetSingleton()) {
            scripts->AddEventSink<RE::TESDeathEvent>(&g_deathSink);
            scripts->AddEventSink<RE::TESSleepStartEvent>(&g_sleepStartSink);
            scripts->AddEventSink<RE::TESSleepStopEvent>(&g_sleepStopSink);
        }
    }

    const CHRONICLE_API::ChronicleApi1* Chronicle()
    {
        return g_chronicle;
    }

    bool HasDovahDamage()
    {
        return g_damage != nullptr;
    }

    // this save's biggest hit, kept in the co-save's 'HITS' record
    float BestHit()
    {
        return g_bestHit;
    }

    void SetBestHit(float hit)
    {
        g_bestHit = hit;
    }

    // MiniPets_API.h React(), any thread, already parsed: drained by UpdateReactions on the game thread
    void QueueReact(const char* json)
    {
        std::lock_guard lock(g_reactQueueLock);
        g_reactQueue.emplace_back(json);
        if (g_reactQueue.size() > kReactQueueDepth) {
            g_reactQueue.pop_front();
        }
    }

    // ---- for the self-test (game thread) ----

    OfferSeen LastOffer()
    {
        return g_lastOffer;
    }

    void ClearLastOffer()
    {
        g_lastOffer = {};
    }

    void ResetGate()
    {
        g_reactionGate.Reset();
    }

    bool GateHeld()
    {
        return g_reactionGate.Held();
    }

    void RearmLowHealth()
    {
        g_lowHealth.Rearm();
    }

    bool PlayerDead()
    {
        return g_playerDead;
    }

    void SetPlayerDead(bool dead)
    {
        g_playerDead = dead;
    }

    void CancelSleepRelease()
    {
        g_sleepReleaseAtMs = 0.0;
    }

    // the sleep-start event, through the sink the game's event reaches
    void FireSleepStart()
    {
        RE::TESSleepStartEvent event{ 0.0f, 1.0f };
        g_sleepStartSink.ProcessEvent(&event, nullptr);
    }

    // the player's death, through the sink the game's event reaches
    void FirePlayerDeath()
    {
        RE::TESDeathEvent death{};
        death.actorDying = RE::NiPointer<RE::TESObjectREFR>(RE::PlayerCharacter::GetSingleton());
        death.dead = true;
        g_deathSink.ProcessEvent(&death, nullptr);
    }
}
