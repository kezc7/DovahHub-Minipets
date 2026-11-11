#pragma once

// MiniPets' plugin: a small core (main.cpp: settings, helpers, the pump, SKSE's entry points) and five parts,
// each owning its state (DMP-12). This header is what the parts offer each other.
//   CardBridge.cpp      the HUD page and what is sent to it
//   ReactionWiring.cpp  events, DovahDamage, DovahHub's broadcasts and React(), through Reactions.h's gate
//   SaveLoad.cpp        the pet per save, the load steps and the co-save
//   HubAndApi.cpp       the DovahHub tab and MiniPets_API.h
//   SelfTestRunner.cpp  the in-game self-test (SelfTest.h)

#include "PrismaUI_API.h"
#include "DovahHub_API.h"
#include "DovahGameThread.h"
#include "MiniPets_API.h"
#include "SelfTest.h"
#include "DovahDamage_API.h"
#include "Chronicle_API.h"
#include "Reactions.h"

#include <RE/A/ActorValueList.h>
#include <RE/A/AlchemyItem.h>
#include <RE/B/BGSDefaultObjectManager.h>
#include <RE/B/BGSLocation.h>
#include <RE/E/ExtraLocationRefType.h>
#include <RE/C/Calendar.h>
#include <RE/D/DragonSoulsGained.h>
#include <RE/L/LevelIncrease.h>
#include <RE/I/IMenu.h>
#include <RE/M/Main.h>
#include <RE/M/MenuOpenCloseEvent.h>
#include <RE/S/SkillIncrease.h>
#include <RE/S/ScriptEventSourceHolder.h>
#include <RE/S/Sky.h>
#include <RE/T/TESDataHandler.h>
#include <RE/T/TESDeathEvent.h>
#include <RE/T/TESSleepStopEvent.h>
#include <RE/T/TESEquipEvent.h>
#include <RE/T/TESObjectCELL.h>
#include <RE/T/TESWorldSpace.h>
#include <RE/U/UI.h>
#include <REX/W32/KERNEL32.h>
#include <REX/W32/USER32.h>

#include <atomic>
#include <chrono>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <functional>
#include <set>
#include <fstream>
#include <string>
#include <string_view>
#include <thread>
#include <array>
#include <limits>
#include <cstring>
#include <condition_variable>
#include <deque>
#include <future>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <unordered_set>
#include <vector>

// CommonLib declares the sleep-start event without its members; MiniPets only needs it to arrive
namespace RE
{
    struct TESSleepStartEvent
    {
        float startTime;    // 00
        float endTime;      // 04
    };
}

namespace MiniPets
{
    // ---- the core (main.cpp) ----

    constexpr std::uint32_t kDefaultSettingsHotkey = 0x30;  // B
    constexpr bool kDefaultSettingsHotkeyRequiresShift = true;

    struct DragonbornSettings
    {
        int positionX = -1;
        int positionY = -1;
        std::uint32_t settingsHotkey = kDefaultSettingsHotkey;
        bool settingsHotkeyRequiresShift = kDefaultSettingsHotkeyRequiresShift;
        std::string settingsHotkeyName = "Shift+B";
        std::string pet = "dovahmin";
        bool debugPreviewKeys = false;
        bool showClock = false;
        std::string clockStyle = "plate";
        int scale = 100;
        bool raisePet = false;
        std::string feedHotkeyName = "Shift+N";
        std::string playHotkeyName = "Shift+K";
        std::string cardShape = "square";
        std::string hideHotkeyName = "Shift+V";
        std::string language = "en";
        bool petHidden = false;
        // reactions (1.9.0): other mods' and the suite's events, the one cooldown, and the two extras
        bool reactToMods = true;
        int reactionCooldown = Reactions::kDefaultCooldownSeconds;
        bool careMoments = false;
        bool chronicleLines = false;
        // self_test=1: run the self-test once, ten seconds after the first game loads, then back to 0 (DMP-11)
        bool selfTest = false;
    };

    extern std::atomic_uint32_t g_settingsHotkey;
    extern std::atomic_bool g_settingsHotkeyRequiresShift;
    extern std::atomic_bool g_gameLoaded;
    extern DragonbornSettings g_settings;

    // same order and names as pet-sprites.js
    inline constexpr std::array<std::pair<std::string_view, std::string_view>, 20> kCompanions{ {
        { "dovahmin", "Dovahmin" }, { "dovahpink", "Dovahpink" }, { "mudcrab", "Clack" }, { "skeever", "Nibbles" },
        { "fox", "Ember" }, { "sabrecat", "Stripes" }, { "frostbite-spider", "Webber" }, { "horker", "Waddles" },
        { "troll", "Grumble" }, { "flame-atronach", "Cinder" }, { "frost-atronach", "Shiver" }, { "spriggan", "Moss" },
        { "dwarven-spider", "Tinker" }, { "chaurus", "Skitter" }, { "netch", "Bloop" }, { "mammoth", "Tusker" },
        { "dragon-priest", "Masky" }, { "wisp", "Glowbug" }, { "death-hound", "Gnasher" }, { "chicken", "Pip" }
    } };

    std::string Trim(std::string_view value);
    std::string JsonString(std::string_view value);
    int ClampScale(int value);
    bool IsSupportedCardShape(std::string_view shape);
    bool IsSupportedClockStyle(std::string_view style);
    bool IsSupportedLanguage(std::string_view language);
    bool ParseFlag(std::string_view value);
    std::vector<std::string> Split(std::string_view value, char separator);
    bool IsSupportedPet(std::string_view pet);
    std::string JsonField(std::string_view json, std::string_view key);
    std::uint32_t ParseHotkey(std::string value, bool* requiresShift = nullptr);
    void WarnAboutDuplicateHotkeys();
    void LoadSettings();
    void SaveSettings();
    std::string SettingsPayload();

    std::uint32_t GameThreadId();
    void WarnIfOffGameThread(const char* where);
    void QueueGameTask(const char* where, std::function<void()> task);

    // GameThread("place")->Queue([]{ ... }): the place names the job in the pump's log and the warning
    struct GameTaskQueue
    {
        const char* where;
        explicit operator bool() const { return true; }
        const GameTaskQueue* operator->() const { return this; }
        void Queue(std::function<void()> task) const
        {
            QueueGameTask(where, [where = where, task = std::move(task)]() {
                WarnIfOffGameThread(where);
                task();
            });
        }
    };

    GameTaskQueue GameThread(const char* where);

    // ---- the card bridge (CardBridge.cpp) ----
    namespace Card
    {
        void Invoke(const std::string& functionName, const std::string& json);
        void UpdateCompanionState();
        void UpdateOverlayMenuVisibility();
        void UpdateWorldMood();
        void UpdateClock();
        RE::TESBoundObject* CheapestFood(int* count = nullptr);
        void SetPetHidden(bool hidden);
        void RegisterPreviewKeys();
        bool IsHidden();     // a menu, a load, another Prisma UI menu: the overlay is hidden
        bool ViewCreated();
        bool ViewValid();
        const std::string& LastCompanionState();
        void ForgetLastSent();
        void StoreKeys();
        bool CreateView();
        void RegisterEvents();
        void OpenSettingsFromDovahMenu();  // DovahMenu's entry (DMN-31): opens now, or once the overlay is shown again
    }

    // ---- the reaction wiring (ReactionWiring.cpp) ----
    namespace ReactionWiring
    {
        // the last reaction offered to the gate and its verdict (game thread), read by the self-test
        struct OfferSeen
        {
            bool seen = false;
            std::string source;
            std::string mood;
            std::string captionKey;
            bool hold = false;
            Reactions::Verdict verdict = Reactions::Verdict::Off;
        };

        void ReleaseReaction(std::string_view mood);
        void ResetReactions();
        bool OfferBossKill(std::uint32_t id, const std::string& name);
        void OnHealthShare(double share);
        void UpdateReactions();
        void OnDovahHubMessage(SKSE::MessagingInterface::Message* message);
        void SendChronicleLine(const std::string& json);
        void OnPlaceChanged(std::string_view region, bool home, const std::string& name, bool test = false);
        void ForgetPlaces();
        void ConnectOtherMods();
        void LogOtherMods();
        void RegisterEvents();
        const CHRONICLE_API::ChronicleApi1* Chronicle();
        bool HasDovahDamage();
        float BestHit();
        void SetBestHit(float hit);
        void QueueReact(const char* json);
        // for the self-test
        OfferSeen LastOffer();
        void ClearLastOffer();
        void ResetGate();
        bool GateHeld();
        void RearmLowHealth();
        bool PlayerDead();
        void SetPlayerDead(bool dead);
        void CancelSleepRelease();
        void FireSleepStart();
        void FirePlayerDeath();
    }

    // ---- save and load (SaveLoad.cpp) ----
    namespace PetSave
    {
        void SendPetState();
        bool AcceptPetState(const std::string& payload, std::string& state);
        void BeginLoad();
        void RevertSave();
        void FinishLoad();
        bool HasPet();
        bool PetIsEgg();
        void OnPetStateChanged(const std::string& state);
        void OnGameSaved(SKSE::SerializationInterface* serialization);
        void OnGameLoaded(SKSE::SerializationInterface* serialization);
        void OnRevert(SKSE::SerializationInterface*);
        const std::string& State();
        void SetState(std::string state);
        std::uint32_t Session();
        bool Loading();
        bool SetLoading(bool loading);
    }

    // ---- DovahHub and the API (HubAndApi.cpp) ----
    namespace Hub
    {
        const std::string& StateJson();
        void PushPetsState();
        void FirePetEvent(const char* event, const std::string& json);
        void SettingsChangedOutside();
        bool SetCompanion(std::string_view id);
        void RefreshHubSettings();
        void RegisterWithDovahHub();
        void OnPetActionResult(const std::string& result);
        MINIPETS_API::Result ApiSetRaisePet(bool enabled);
        void BuildMiniPetsApi();
        const void* Api();
        bool Present();
        DOVAHHUB_API::Result ReportSelfTestStep(const char* stepJson);
        DOVAHHUB_API::Result FinishSelfTest();
        void RegisterWithDovahMenu();
        void UpdateDovahMenuHotkey();
    }

    // ---- the self-test runner (SelfTestRunner.cpp) ----
    namespace SelfTestRunner
    {
        void StartSelfTestFromHub(const char* runJson, void* user);
        void MaybeStartSelfTestFromIni();
        void RegisterChronicleCommand();
        void OnPageAnswer(const char* payload);
    }
}
