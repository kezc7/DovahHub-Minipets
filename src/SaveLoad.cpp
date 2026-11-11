// Save and load (DMP-12): the raised pet's state per save, the session that keeps one save's pet out of the
// next (SAVE-LEAK, 1.9.1), the load and new-game steps, and the SKSE co-save under the id 'DBXP'.
#include "Plugin.h"

namespace MiniPets::PetSave
{
    namespace
    {
        // raise-a-pet state from the view (JSON), kept per save in the SKSE co-save
        std::string g_petState;
        // SAVE-LEAK: every load and new game starts a new pet session. The page echoes it with each pet
        // state it sends back, so a state the page worked out for the previous save (a clock tick that
        // landed while the next save was loading) is dropped instead of being written into this one.
        std::atomic_uint32_t g_petSession = 1;
        // between a load starting (Revert, kPreLoadGame) and the game being ready (kPostLoadGame, kNewGame)
        std::atomic_bool g_loadingSave = false;

        constexpr std::uint32_t kPetRecord = 'PETS';
        constexpr std::uint32_t kHitRecord = 'HITS';  // 1.9.0: this save's biggest hit, for DovahDamage's records

    }

    void SendPetState()
    {
        Card::Invoke("dragonbornXP.petState", "{\"state\":" + JsonString(g_petState) + ",\"session\":" + std::to_string(g_petSession.load()) + "}");
    }

    // "<session>|<pet JSON>" from the page; false (and nothing kept) for another save's session
    bool AcceptPetState(const std::string& payload, std::string& state)
    {
        const auto bar = payload.find('|');
        if (bar == std::string::npos || bar == 0 || bar > 10) {
            logger::info("MiniPets: pet state without a session ignored");
            return false;
        }
        const auto session = static_cast<std::uint32_t>(std::strtoul(payload.substr(0, bar).c_str(), nullptr, 10));
        if (g_loadingSave.load() || session != g_petSession.load()) {
            logger::info("MiniPets: pet state from an earlier save ignored (session {}, now {})", session, g_petSession.load());
            return false;
        }
        state = payload.substr(bar + 1);
        return true;
    }

    // Revert and kPreLoadGame: the page forgets the pet it had, so it can't tick or save it into
    // the save being loaded; reactions, cooldowns and DovahDamage's counters start over
    void BeginLoad()
    {
        g_loadingSave.store(true);
        g_petSession.fetch_add(1);
        ReactionWiring::ResetReactions();
        SendPetState();
    }

    // SKSE's revert (a new game, or before a load): this save's pet and record are gone
    void RevertSave()
    {
        g_petState.clear();
        ReactionWiring::SetBestHit(0.0f);
        BeginLoad();
    }

    // kPostLoadGame and kNewGame: everything the card shows is sent again for this save
    void FinishLoad()
    {
        g_loadingSave.store(false);
        Card::ForgetLastSent();
        ReactionWiring::ResetReactions();
        SendPetState();
    }

    bool HasPet()
    {
        return g_settings.raisePet && !g_petState.empty() && g_petState.front() == '{';
    }

    bool PetIsEgg()
    {
        return g_petState.find("\"stage\":\"egg\"") != std::string::npos;
    }

    void OnPetStateChanged(const std::string& state)
    {
        const bool hatched = PetIsEgg() && state.find("\"stage\":\"hatched\"") != std::string::npos;
        g_petState = state;
        Hub::PushPetsState();
        if (hatched) {
            Hub::FirePetEvent("hatched", "{\"species\":" + JsonString(JsonField(state, "species")) + "}");
        }
    }

    void OnGameSaved(SKSE::SerializationInterface* serialization)
    {
        if (!g_petState.empty()) {
            serialization->WriteRecord(kPetRecord, 1, g_petState.data(), static_cast<std::uint32_t>(g_petState.size()));
        }
        if (const float bestHit = ReactionWiring::BestHit(); bestHit > 0.0f) {
            serialization->WriteRecord(kHitRecord, 1, &bestHit, sizeof(bestHit));
        }
    }

    void OnGameLoaded(SKSE::SerializationInterface* serialization)
    {
        std::uint32_t type = 0;
        std::uint32_t version = 0;
        std::uint32_t length = 0;
        while (serialization->GetNextRecordInfo(type, version, length)) {
            if (type == kPetRecord && version == 1) {
                std::string state(length, '\0');
                serialization->ReadRecordData(state.data(), length);
                g_petState = state;
            }
            else if (type == kHitRecord && version == 1 && length == sizeof(float)) {
                float bestHit = 0.0f;
                serialization->ReadRecordData(&bestHit, sizeof(bestHit));
                ReactionWiring::SetBestHit(bestHit);
            }
        }
    }

    void OnRevert(SKSE::SerializationInterface*)
    {
        RevertSave();
    }

    const std::string& State()
    {
        return g_petState;
    }

    void SetState(std::string state)
    {
        g_petState = std::move(state);
    }

    std::uint32_t Session()
    {
        return g_petSession.load();
    }

    bool Loading()
    {
        return g_loadingSave.load();
    }

    // returns what it was
    bool SetLoading(bool loading)
    {
        return g_loadingSave.exchange(loading);
    }
}
