// MiniPets' core: the settings file, small helpers, the game-thread pump and SKSE's entry points. The rest
// is in five parts (Plugin.h lists them).
#include "Plugin.h"
#include "SettingsFile.h"
#include "HubText.h"

namespace MiniPets
{
    namespace
    {
        const std::filesystem::path kSettingsPath = L"Data/SKSE/Plugins/MiniPets.ini";
        // before 1.8.0; copied to kSettingsPath on the first run, see SettingsFile.h
        const std::filesystem::path kLegacySettingsPath = L"Data/SKSE/Plugins/DragonbornXP.ini";

        std::atomic_bool g_statePollerStarted = false;
        bool SameHotkey(const std::string& a, const std::string& b)
        {
            bool shiftA = false;
            bool shiftB = false;
            const auto scanA = ParseHotkey(a, &shiftA);
            return scanA != 0 && scanA == ParseHotkey(b, &shiftB) && shiftA == shiftB;
        }

        // ---- the game thread (THREADS, then PUMP: the suite's rules of 8 Nov 2026) ----
        // No SKSE task queue can be trusted to reach the game's main thread: in some load orders AddTask and
        // AddUITask have each run their tasks on workers. DovahGameThread.h (DovahHub's, copied unchanged) runs
        // work from a hook on the game's own frame update: DovahHub's pump when DovahHub 0.97.4+ is installed,
        // otherwise its own chained hook, so MiniPets works alone. Installed at kPostLoad. "The game thread" is
        // the frame's thread as the pump saw it, not RE::Main's threadID.

        std::atomic_bool g_threadLogged = false;

        std::atomic_bool g_pollQueued = false;

        void StartCompanionStatePoller()
        {
            bool expected = false;
            if (!g_statePollerStarted.compare_exchange_strong(expected, true)) {
                return;
            }

            std::thread([]() {
                while (true) {
                    std::this_thread::sleep_for(std::chrono::milliseconds(250));
                    // bounded: the next pass is queued only once the last one has run
                    if (g_pollQueued.exchange(true)) {
                        continue;
                    }
                    if (const auto taskInterface = GameThread("250 ms update")) {
                        taskInterface->Queue([]() {
                            if (!g_threadLogged.exchange(true)) {
                                logger::info("MiniPets: game thread {} (the pump's{}), first update ran on {}", GameThreadId(),
                                             DovahGameThread::Pumping() ? "" : "; not pumping, SKSE's UI tasks instead", REX::W32::GetCurrentThreadId());
                            }
                            Card::UpdateOverlayMenuVisibility();
                            Card::UpdateCompanionState();
                            Card::UpdateWorldMood();
                            Card::UpdateClock();
                            ReactionWiring::UpdateReactions();
                            g_pollQueued.store(false);
                        });
                    }
                    else {
                        g_pollQueued.store(false);
                    }
                }
            }).detach();
        }

        void OnDataLoaded()
        {
            LoadSettings();
            Card::StoreKeys();
            if (!Card::CreateView()) {
                return;
            }

            Card::RegisterEvents();
            ReactionWiring::RegisterEvents();
            Card::RegisterPreviewKeys();
            StartCompanionStatePoller();
            logger::info("MiniPets initialized. Preview keys {}.", g_settings.debugPreviewKeys ? "enabled (F6 XP, F7 level-up)" : "disabled");
        }
    }

    std::atomic_uint32_t g_settingsHotkey = kDefaultSettingsHotkey;
    std::atomic_bool g_settingsHotkeyRequiresShift = kDefaultSettingsHotkeyRequiresShift;

    std::atomic_bool g_gameLoaded = false;
    DragonbornSettings g_settings;

    std::string Trim(std::string_view value)
    {
        const auto first = value.find_first_not_of(" \t\r\n");
        if (first == std::string_view::npos) {
            return {};
        }
        const auto last = value.find_last_not_of(" \t\r\n");
        return std::string(value.substr(first, last - first + 1));
    }

    // strings end up inside a script, so escape them
    std::string JsonString(std::string_view value)
    {
        std::string result = "\"";
        for (const auto character : value) {
            switch (character) {
            case '"':
                result += "\\\"";
                break;
            case '\\':
                result += "\\\\";
                break;
            default:
                if (static_cast<unsigned char>(character) >= 0x20) {
                    result += character;
                }
            }
        }
        result += '"';
        return result;
    }

    // card size in percent
    int ClampScale(int value)
    {
        return value < 50 ? 50 : value > 200 ? 200 : value;
    }

    bool IsSupportedCardShape(std::string_view shape)
    {
        return shape == "square" || shape == "wide";
    }

    bool IsSupportedClockStyle(std::string_view style)
    {
        return style == "plate" || style == "ribbon";
    }

    bool IsSupportedLanguage(std::string_view language)
    {
        return language == "en" || language == "fr" || language == "de" || language == "it" || language == "es" ||
               language == "pl" || language == "tr" || language == "zh-CN" || language == "ja" || language == "ko";
    }

    bool ParseFlag(std::string_view value)
    {
        return value == "1" || value == "true";
    }

    std::vector<std::string> Split(std::string_view value, char separator)
    {
        std::vector<std::string> parts;
        std::size_t start = 0;
        while (true) {
            const auto end = value.find(separator, start);
            parts.emplace_back(value.substr(start, end == std::string_view::npos ? std::string_view::npos : end - start));
            if (end == std::string_view::npos) {
                return parts;
            }
            start = end + 1;
        }
    }

    bool IsSupportedPet(std::string_view pet)
    {
        for (const auto& [id, name] : kCompanions) {
            if (id == pet) {
                return true;
            }
        }
        return false;
    }

    // flat JSON only ({"key":"text"} / number / true), enough for the hub's payloads
    std::string JsonField(std::string_view json, std::string_view key)
    {
        const auto quoted = "\"" + std::string(key) + "\"";
        auto at = json.find(quoted);
        if (at == std::string_view::npos) {
            return {};
        }
        at = json.find(':', at + quoted.size());
        if (at == std::string_view::npos) {
            return {};
        }
        ++at;
        while (at < json.size() && (json[at] == ' ' || json[at] == '\t')) {
            ++at;
        }
        if (at >= json.size()) {
            return {};
        }
        if (json[at] == '"') {
            std::string text;
            for (auto i = at + 1; i < json.size(); ++i) {
                if (json[i] == '\\' && i + 1 < json.size()) {
                    text += json[++i];
                }
                else if (json[i] == '"') {
                    break;
                }
                else {
                    text += json[i];
                }
            }
            return text;
        }
        const auto end = json.find_first_of(",}", at);
        return Trim(json.substr(at, end == std::string_view::npos ? std::string_view::npos : end - at));
    }

    std::uint32_t ParseHotkey(std::string value, bool* requiresShift)
    {
        for (auto& character : value) {
            character = static_cast<char>(std::toupper(static_cast<unsigned char>(character)));
        }

        if (requiresShift) {
            *requiresShift = false;
        }
        if (value.rfind("SHIFT+", 0) == 0) {
            if (requiresShift) {
                *requiresShift = true;
            }
            value.erase(0, 6);
        }

        if (value == "ENTER") {
            return MapVirtualKeyW(VK_RETURN, MAPVK_VK_TO_VSC_EX);
        }
        if (value == "SPACE") {
            return MapVirtualKeyW(VK_SPACE, MAPVK_VK_TO_VSC_EX);
        }
        if (value == "TAB") {
            return MapVirtualKeyW(VK_TAB, MAPVK_VK_TO_VSC_EX);
        }
        if (value == "BACKSPACE") {
            return MapVirtualKeyW(VK_BACK, MAPVK_VK_TO_VSC_EX);
        }
        if (value.size() >= 2 && value.front() == 'F') {
            try {
                const auto functionNumber = std::stoi(value.substr(1));
                if (functionNumber >= 1 && functionNumber <= 12) {
                    return MapVirtualKeyW(VK_F1 + functionNumber - 1, MAPVK_VK_TO_VSC_EX);
                }
            }
            catch (...) {
                return 0;
            }
        }
        if (value.size() == 1 && std::isalnum(static_cast<unsigned char>(value.front()))) {
            return MapVirtualKeyW(static_cast<UINT>(value.front()), MAPVK_VK_TO_VSC_EX);
        }
        return 0;
    }

    // settings > hide > feed > play, the first one bound to a key gets it
    void WarnAboutDuplicateHotkeys()
    {
        const std::pair<const char*, const std::string*> keys[] = {
            { "settings", &g_settings.settingsHotkeyName }, { "hide", &g_settings.hideHotkeyName },
            { "feed", &g_settings.feedHotkeyName }, { "play", &g_settings.playHotkeyName }
        };
        for (std::size_t i = 0; i < std::size(keys); ++i) {
            for (std::size_t j = i + 1; j < std::size(keys); ++j) {
                if (SameHotkey(*keys[i].second, *keys[j].second)) {
                    logger::warn("MiniPets: {} and {} are both bound to {}, {} wins", keys[i].first, keys[j].first, *keys[i].second, keys[i].first);
                }
            }
        }
    }

    void LoadSettings()
    {
        try {
            const auto file = SettingsFile::Prepare(kSettingsPath, kLegacySettingsPath);
            if (file.migrated) {
                logger::info("MiniPets: settings migrated from DragonbornXP.ini");
            }
            if (!std::filesystem::exists(file.read)) {
                return;
            }

            std::ifstream input(file.read);
            std::string line;
            while (std::getline(input, line)) {
                const auto separator = line.find('=');
                if (separator == std::string::npos) {
                    continue;
                }

                const auto key = Trim(std::string_view(line).substr(0, separator));
                const auto value = Trim(std::string_view(line).substr(separator + 1));
                try {
                    if (key == "position_x") {
                        g_settings.positionX = std::stoi(value);
                    }
                    else if (key == "position_y") {
                        g_settings.positionY = std::stoi(value);
                    }
                    else if (key == "settings_hotkey") {
                        bool requiresShift = false;
                        const auto parsed = ParseHotkey(value, &requiresShift);
                        if (parsed != 0) {
                            g_settings.settingsHotkey = parsed;
                            g_settings.settingsHotkeyRequiresShift = requiresShift;
                            g_settings.settingsHotkeyName = value;
                        }
                    }
                    else if (key == "pet" && (IsSupportedPet(value) || value == "pinky")) {
                        g_settings.pet = value == "pinky" ? "dovahpink" : value;
                    }
                    else if (key == "debug_preview_keys") {
                        g_settings.debugPreviewKeys = ParseFlag(value);
                    }
                    else if (key == "show_clock") {
                        g_settings.showClock = ParseFlag(value);
                    }
                    else if (key == "clock_style" && IsSupportedClockStyle(value)) {
                        g_settings.clockStyle = value;
                    }
                    else if (key == "scale") {
                        g_settings.scale = ClampScale(std::stoi(value));
                    }
                    else if (key == "raise_pet") {
                        g_settings.raisePet = ParseFlag(value);
                    }
                    else if (key == "feed_hotkey" && ParseHotkey(value) != 0) {
                        g_settings.feedHotkeyName = value;
                    }
                    else if (key == "play_hotkey" && ParseHotkey(value) != 0) {
                        g_settings.playHotkeyName = value;
                    }
                    else if (key == "card_shape" && IsSupportedCardShape(value)) {
                        g_settings.cardShape = value;
                    }
                    else if (key == "hide_hotkey" && ParseHotkey(value) != 0) {
                        g_settings.hideHotkeyName = value;
                    }
                    else if (key == "language" && IsSupportedLanguage(value)) {
                        g_settings.language = value;
                    }
                    else if (key == "hidden") {
                        g_settings.petHidden = ParseFlag(value);
                    }
                    else if (key == "react_to_mods") {
                        g_settings.reactToMods = ParseFlag(value);
                    }
                    else if (key == "reaction_cooldown") {
                        g_settings.reactionCooldown = std::clamp(std::stoi(value), Reactions::kMinCooldownSeconds, Reactions::kMaxCooldownSeconds);
                    }
                    else if (key == "care_moments") {
                        g_settings.careMoments = ParseFlag(value);
                    }
                    else if (key == "chronicle_lines") {
                        g_settings.chronicleLines = ParseFlag(value);
                    }
                    else if (key == "self_test") {
                        g_settings.selfTest = ParseFlag(value);
                    }
                }
                catch (...) {
                    logger::warn("MiniPets ignored invalid setting '{}'", key);
                }
            }
            g_settingsHotkey.store(g_settings.settingsHotkey);
            g_settingsHotkeyRequiresShift.store(g_settings.settingsHotkeyRequiresShift);
            WarnAboutDuplicateHotkeys();
        }
        catch (const std::exception& error) {
            logger::warn("MiniPets settings could not be loaded: {}", error.what());
        }
    }

    void SaveSettings()
    {
        try {
            std::filesystem::create_directories(kSettingsPath.parent_path());
            std::ofstream output(kSettingsPath, std::ios::trunc);
            output << "position_x=" << g_settings.positionX << '\n'
                   << "position_y=" << g_settings.positionY << '\n'
                   << "settings_hotkey=" << g_settings.settingsHotkeyName << '\n'
                   << "pet=" << g_settings.pet << '\n'
                   << "debug_preview_keys=" << (g_settings.debugPreviewKeys ? 1 : 0) << '\n'
                   << "show_clock=" << (g_settings.showClock ? 1 : 0) << '\n'
                   << "clock_style=" << g_settings.clockStyle << '\n'
                   << "scale=" << g_settings.scale << '\n'
                   << "raise_pet=" << (g_settings.raisePet ? 1 : 0) << '\n'
                   << "feed_hotkey=" << g_settings.feedHotkeyName << '\n'
                   << "play_hotkey=" << g_settings.playHotkeyName << '\n'
                   << "card_shape=" << g_settings.cardShape << '\n'
                   << "hide_hotkey=" << g_settings.hideHotkeyName << '\n'
                   << "language=" << g_settings.language << '\n'
                   << "hidden=" << (g_settings.petHidden ? 1 : 0) << '\n'
                   << "react_to_mods=" << (g_settings.reactToMods ? 1 : 0) << '\n'
                   << "reaction_cooldown=" << g_settings.reactionCooldown << '\n'
                   << "care_moments=" << (g_settings.careMoments ? 1 : 0) << '\n'
                   << "chronicle_lines=" << (g_settings.chronicleLines ? 1 : 0) << '\n';
            // only when set: the self-test is a tester's switch, not a setting the menus show
            if (g_settings.selfTest) {
                output << "self_test=1\n";
            }
        }
        catch (const std::exception& error) {
            logger::warn("MiniPets settings could not be saved: {}", error.what());
        }
    }

    std::string SettingsPayload()
    {
        return "{\"x\":" + std::to_string(g_settings.positionX) +
               ",\"y\":" + std::to_string(g_settings.positionY) +
               ",\"hotkey\":" + JsonString(g_settings.settingsHotkeyName) +
               ",\"pet\":" + JsonString(g_settings.pet) +
               ",\"clock\":" + (g_settings.showClock ? "true" : "false") +
               ",\"clockStyle\":" + JsonString(g_settings.clockStyle) +
               ",\"scale\":" + std::to_string(g_settings.scale) +
               ",\"raisePet\":" + (g_settings.raisePet ? "true" : "false") +
               ",\"feedHotkey\":" + JsonString(g_settings.feedHotkeyName) +
               ",\"playHotkey\":" + JsonString(g_settings.playHotkeyName) +
               ",\"cardShape\":" + JsonString(g_settings.cardShape) +
               ",\"hideHotkey\":" + JsonString(g_settings.hideHotkeyName) +
               ",\"language\":" + JsonString(g_settings.language) +
               ",\"hidden\":" + (g_settings.petHidden ? "true" : "false") +
               ",\"careMoments\":" + (g_settings.careMoments ? "true" : "false") + "}";
    }

    std::uint32_t GameThreadId()
    {
        return DovahGameThread::Id();
    }

    // one log line per place that finds itself off the game thread, naming the place and the threads
    void WarnIfOffGameThread(const char* where)
    {
        DovahGameThread::Note(where);
    }

    // Always posted, never run inline: some callers are inside another mod's callback.
    void QueueGameTask(const char* where, std::function<void()> task)
    {
        DovahGameThread::Post(where, std::move(task));
    }

    GameTaskQueue GameThread(const char* where)
    {
        return { where };
    }

}

// Save and load (DMP-12): the raised pet's state per save, the session that keeps one save's pet out of the
// next (SAVE-LEAK, 1.9.1), the load and new-game steps, and the SKSE co-save under the id 'DBXP'.
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

// DovahHub and the API (DMP-12): the MiniPets tab and its Settings rows in DovahHub, the state they read,
// and MiniPets_API.h for other mods (feed, play, companion, card, clock, listeners, React).
namespace MiniPets::Hub
{
    namespace
    {
        // --- DovahHub's MiniPets tab and the MiniPets API ------------------------------------------------
        //
        // The pet rules stay in the HUD page. The tab (hub/modules/pets/, shipped inside DovahHub's view
        // folder) asks for the state through DovahHub's relay, feed/play go to the page like the hotkeys
        // do, and the page's petActionResult comes back here and is pushed on to the tab.

        const DOVAHHUB_API::DovahHubApi1* g_hub = nullptr;
        DOVAHHUB_API::ModuleId g_hubModule = 0;
        std::atomic_bool g_petsTabShown = false;
        // onRequest's reply lives here until the host has copied it
        std::string g_hubReply;
        std::string g_stateJson;

        struct PetListener
        {
            MINIPETS_API::ListenerId id;
            MINIPETS_API::ListenerDesc desc;
        };
        std::vector<PetListener> g_petListeners;
        MINIPETS_API::ListenerId g_nextPetListener = 1;
        MINIPETS_API::MiniPetsApi2 g_miniPetsApi{};
        std::string g_pluginVersion;
        // what the DovahHub Settings rows were last worded for
        std::string g_hubSettingsLanguage;
        std::string g_hubSettingsHideKey;

        // DovahHub's Settings rows for MiniPets, worded in MiniPets' language (src/HubText.h, from the catalogue)
        std::string HubSettingsSchema()
        {
            const auto& text = HubText::For(g_settings.language);
            std::string hideNote = text.hubHideCardNote;
            if (const auto at = hideNote.find("{key}"); at != std::string::npos) {
                hideNote.replace(at, 5, g_settings.hideHotkeyName);
            }
            const auto choice = [](std::string_view value, std::string_view label) {
                return "{\"value\":" + JsonString(value) + ",\"label\":" + JsonString(label) + "}";
            };
            std::string languages;
            for (const auto& entry : HubText::kTexts) {
                languages += (languages.empty() ? "" : ",") + choice(entry.code, entry.languageName);
            }
            return std::string("{\"title\":\"MiniPets\",\"settings\":[") +
                   "{\"key\":\"raise_pet\",\"label\":" + JsonString(text.raisePet) + ",\"type\":\"toggle\",\"value\":false,\"note\":" + JsonString(text.raisePetHint) + "}," +
                   "{\"key\":\"show_clock\",\"label\":" + JsonString(text.hubShowClock) + ",\"type\":\"toggle\",\"value\":false}," +
                   "{\"key\":\"clock_style\",\"label\":" + JsonString(text.clockStyle) + ",\"type\":\"choice\",\"options\":[" + choice("plate", text.plate) + "," + choice("ribbon", text.ribbon) + "],\"value\":\"plate\"}," +
                   "{\"key\":\"scale\",\"label\":" + JsonString(text.hubCardSize) + ",\"type\":\"range\",\"min\":50,\"max\":200,\"step\":10,\"value\":100,\"unit\":\"%\"}," +
                   "{\"key\":\"card_shape\",\"label\":" + JsonString(text.hubCardShape) + ",\"type\":\"choice\",\"options\":[" + choice("square", text.square) + "," + choice("wide", text.wide) + "],\"value\":\"square\"}," +
                   "{\"key\":\"hidden\",\"label\":" + JsonString(text.hubHideCard) + ",\"type\":\"toggle\",\"value\":false,\"note\":" + JsonString(hideNote) + "}," +
                   "{\"key\":\"react_to_mods\",\"label\":" + JsonString(text.reactToMods) + ",\"type\":\"toggle\",\"value\":true,\"note\":" + JsonString(text.reactToModsNote) + "}," +
                   "{\"key\":\"reaction_cooldown\",\"label\":" + JsonString(text.reactionCooldown) + ",\"type\":\"range\",\"min\":" + std::to_string(Reactions::kMinCooldownSeconds) +
                   ",\"max\":" + std::to_string(Reactions::kMaxCooldownSeconds) + ",\"step\":1,\"value\":" + std::to_string(Reactions::kDefaultCooldownSeconds) + ",\"unit\":\"s\"}," +
                   "{\"key\":\"care_moments\",\"label\":" + JsonString(text.careMoments) + ",\"type\":\"toggle\",\"value\":false,\"note\":" + JsonString(text.careMomentsNote) + "}," +
                   "{\"key\":\"chronicle_lines\",\"label\":" + JsonString(text.chronicleLines) + ",\"type\":\"toggle\",\"value\":false,\"note\":" + JsonString(text.chronicleLinesNote) + "}," +
                   "{\"key\":\"language\",\"label\":" + JsonString(text.language) + ",\"type\":\"choice\",\"options\":[" + languages + "],\"value\":\"en\",\"note\":" + JsonString(text.machineTranslationNote) + "}]}";
        }

        std::string CompanionsJson()
        {
            std::string json = "[";
            for (const auto& [id, name] : kCompanions) {
                if (json.size() > 1) {
                    json += ',';
                }
                json += "{\"id\":" + JsonString(id) + ",\"name\":" + JsonString(name) + "}";
            }
            return json + "]";
        }

        // nullptr = go ahead, else why the page would refuse anyway
        const char* PetActionBlocker(std::string_view action)
        {
            if (!PetSave::HasPet()) {
                return "no pet";
            }
            if (action == "feed") {
                if (PetSave::PetIsEgg()) {
                    return "egg";
                }
                if (!Card::CheapestFood()) {
                    return "no food";
                }
            }
            return nullptr;
        }

        // the same route as the hotkeys, minus the "card on screen" check: DovahHub is open
        void SendPetAction(std::string_view action)
        {
            Card::Invoke("dragonbornXP.petAction", "{\"action\":\"" + std::string(action) + "\"}");
        }

        std::string HubSettingsJson()
        {
            return "{\"raise_pet\":" + std::string(g_settings.raisePet ? "true" : "false") +
                   ",\"show_clock\":" + (g_settings.showClock ? "true" : "false") +
                   ",\"clock_style\":" + JsonString(g_settings.clockStyle) +
                   ",\"scale\":" + std::to_string(g_settings.scale) +
                   ",\"card_shape\":" + JsonString(g_settings.cardShape) +
                   ",\"language\":" + JsonString(g_settings.language) +
                   ",\"hidden\":" + (g_settings.petHidden ? "true" : "false") +
                   ",\"react_to_mods\":" + (g_settings.reactToMods ? "true" : "false") +
                   ",\"reaction_cooldown\":" + std::to_string(g_settings.reactionCooldown) +
                   ",\"care_moments\":" + (g_settings.careMoments ? "true" : "false") +
                   ",\"chronicle_lines\":" + (g_settings.chronicleLines ? "true" : "false") + "}";
        }

        bool ApplyHubSetting(const std::string& key, const std::string& value)
        {
            if (key == "raise_pet") {
                g_settings.raisePet = ParseFlag(value);
            }
            else if (key == "show_clock") {
                g_settings.showClock = ParseFlag(value);
            }
            else if (key == "clock_style" && IsSupportedClockStyle(value)) {
                g_settings.clockStyle = value;
            }
            else if (key == "scale") {
                try {
                    g_settings.scale = ClampScale(std::stoi(value));
                }
                catch (...) {
                    return false;
                }
            }
            else if (key == "card_shape" && IsSupportedCardShape(value)) {
                g_settings.cardShape = value;
            }
            else if (key == "language" && IsSupportedLanguage(value)) {
                g_settings.language = value;
            }
            else if (key == "hidden") {
                Card::SetPetHidden(ParseFlag(value));
                return true;
            }
            else if (key == "react_to_mods") {
                g_settings.reactToMods = ParseFlag(value);
            }
            else if (key == "reaction_cooldown") {
                try {
                    g_settings.reactionCooldown = std::clamp(std::stoi(value), Reactions::kMinCooldownSeconds, Reactions::kMaxCooldownSeconds);
                }
                catch (...) {
                    return false;
                }
            }
            else if (key == "care_moments") {
                g_settings.careMoments = ParseFlag(value);
            }
            else if (key == "chronicle_lines") {
                g_settings.chronicleLines = ParseFlag(value);
            }
            else {
                return false;
            }
            SettingsChangedOutside();
            RefreshHubSettings();
            return true;
        }

        const char* OnHubRequest(const char* request, const char* json, void*)
        {
            WarnIfOffGameThread("DovahHub request");
            const std::string_view name = request ? request : "";
            const std::string_view payload = json ? json : "";
            if (name == "state") {
                g_hubReply = StateJson();
            }
            else if (name == "feed" || name == "play") {
                if (const char* reason = PetActionBlocker(name)) {
                    g_hubReply = std::string("{\"ok\":false,\"reason\":\"") + reason + "\"}";
                }
                else {
                    SendPetAction(name);
                    g_hubReply = "{\"queued\":true}";
                }
            }
            else if (name == "companion") {
                g_hubReply = SetCompanion(JsonField(payload, "pet")) ? "{\"ok\":true}" : "{\"ok\":false,\"reason\":\"unknown companion\"}";
            }
            else if (name == "settings") {
                g_hubReply = HubSettingsJson();
            }
            else if (name == "setting") {
                g_hubReply = ApplyHubSetting(JsonField(payload, "key"), JsonField(payload, "value")) ? "{\"ok\":true}" : "{\"ok\":false}";
            }
            else {
                return nullptr;
            }
            return g_hubReply.c_str();
        }

        void OnHubEvent(const char* event, void*)
        {
            const std::string_view name = event ? event : "";
            if (name == "tabShown") {
                g_petsTabShown.store(true);
                PushPetsState();
            }
            else if (name == "tabHidden" || name == "closed") {
                g_petsTabShown.store(false);
            }
        }

        // ---- MiniPets_API.h ----

        const char* ApiGetStateJson()
        {
            return StateJson().c_str();
        }

        MINIPETS_API::Result ApiPetAction(std::string_view action)
        {
            WarnIfOffGameThread("API Feed or Play");
            if (!Card::ViewValid()) {
                return MINIPETS_API::Result::NotReady;
            }
            if (const char* reason = PetActionBlocker(action)) {
                return std::strcmp(reason, "no pet") == 0 ? MINIPETS_API::Result::NoPet : MINIPETS_API::Result::Refused;
            }
            SendPetAction(action);
            return MINIPETS_API::Result::Ok;
        }

        MINIPETS_API::Result ApiFeed()
        {
            return ApiPetAction("feed");
        }

        MINIPETS_API::Result ApiPlay()
        {
            return ApiPetAction("play");
        }

        MINIPETS_API::Result ApiSetCompanion(const char* id)
        {
            return id && SetCompanion(id) ? MINIPETS_API::Result::Ok : MINIPETS_API::Result::InvalidArgument;
        }

        MINIPETS_API::Result ApiSetVisible(bool visible)
        {
            Card::SetPetHidden(!visible);
            return MINIPETS_API::Result::Ok;
        }

        MINIPETS_API::Result ApiSetCard(std::int32_t x, std::int32_t y, std::int32_t scale, const char* shape)
        {
            if (shape && !IsSupportedCardShape(shape)) {
                return MINIPETS_API::Result::InvalidArgument;
            }
            if (scale != 0 && (scale < 50 || scale > 200)) {
                return MINIPETS_API::Result::InvalidArgument;
            }
            if (x >= 0) {
                g_settings.positionX = x;
            }
            if (y >= 0) {
                g_settings.positionY = y;
            }
            if (scale != 0) {
                g_settings.scale = scale;
            }
            if (shape) {
                g_settings.cardShape = shape;
            }
            SettingsChangedOutside();
            return MINIPETS_API::Result::Ok;
        }

        MINIPETS_API::Result ApiSetClock(bool enabled, const char* style)
        {
            if (style && !IsSupportedClockStyle(style)) {
                return MINIPETS_API::Result::InvalidArgument;
            }
            g_settings.showClock = enabled;
            if (style) {
                g_settings.clockStyle = style;
            }
            SettingsChangedOutside();
            return MINIPETS_API::Result::Ok;
        }

        bool ApiIsVisible()
        {
            return !Card::IsHidden() && !g_settings.petHidden;
        }

        MINIPETS_API::Result ApiAddListener(const MINIPETS_API::ListenerDesc* desc, MINIPETS_API::ListenerId* outListener)
        {
            if (!desc || !outListener || desc->size < sizeof(MINIPETS_API::ListenerDesc) || !desc->onEvent) {
                return MINIPETS_API::Result::InvalidArgument;
            }
            g_petListeners.push_back({ g_nextPetListener, *desc });
            *outListener = g_nextPetListener++;
            return MINIPETS_API::Result::Ok;
        }

        MINIPETS_API::Result ApiRemoveListener(MINIPETS_API::ListenerId listener)
        {
            for (auto it = g_petListeners.begin(); it != g_petListeners.end(); ++it) {
                if (it->id == listener) {
                    g_petListeners.erase(it);
                    return MINIPETS_API::Result::Ok;
                }
            }
            return MINIPETS_API::Result::InvalidId;
        }

        // any thread: parse to refuse what can never show, then queue for UpdateReactions
        MINIPETS_API::Result ApiReact(const char* json)
        {
            if (!json) {
                return MINIPETS_API::Result::InvalidArgument;
            }
            Reactions::Reaction reaction;
            const auto error = Reactions::Parse(json, reaction);
            if (error != Reactions::ParseError::None) {
                logger::info("MiniPets: React refused ({})", error == Reactions::ParseError::Mood ? "mood" : error == Reactions::ParseError::Source ? "source" : "not JSON");
                return MINIPETS_API::Result::InvalidArgument;
            }
            if (!Card::ViewCreated()) {
                return MINIPETS_API::Result::NotReady;
            }
            ReactionWiring::QueueReact(json);
            return MINIPETS_API::Result::Ok;
        }

    }

    // everything the tab (or another mod) needs; see MiniPets_API.h for the shape
    const std::string& StateJson()
    {
        WarnIfOffGameThread("pet state for DovahHub or the API");
        const auto* calendar = RE::Calendar::GetSingleton();
        int food = 0;
        Card::CheapestFood(&food);
        g_stateJson = "{\"companion\":" + JsonString(g_settings.pet) +
                      ",\"companions\":" + CompanionsJson() +
                      ",\"raisePet\":" + (g_settings.raisePet ? "true" : "false") +
                      ",\"pet\":" + (PetSave::HasPet() ? PetSave::State() : std::string("null")) +
                      ",\"hours\":" + std::to_string(calendar ? calendar->GetHoursPassed() : 0.0f) +
                      ",\"food\":" + std::to_string(food) +
                      ",\"card\":{\"x\":" + std::to_string(g_settings.positionX) +
                      ",\"y\":" + std::to_string(g_settings.positionY) +
                      ",\"scale\":" + std::to_string(g_settings.scale) +
                      ",\"shape\":" + JsonString(g_settings.cardShape) +
                      ",\"hidden\":" + (g_settings.petHidden ? "true" : "false") + "}" +
                      ",\"clock\":{\"enabled\":" + (g_settings.showClock ? "true" : "false") +
                      ",\"style\":" + JsonString(g_settings.clockStyle) + "}" +
                      ",\"language\":" + JsonString(g_settings.language) +
                      ",\"hotkeys\":{\"settings\":" + JsonString(g_settings.settingsHotkeyName) +
                      ",\"feed\":" + JsonString(g_settings.feedHotkeyName) +
                      ",\"play\":" + JsonString(g_settings.playHotkeyName) +
                      ",\"hide\":" + JsonString(g_settings.hideHotkeyName) + "}}";
        return g_stateJson;
    }

    // Queued, never direct: the host must not be called back from inside its own callbacks, and
    // the state is read on the game thread.
    void PushPetsState()
    {
        if (!g_hub || !g_hubModule || !g_petsTabShown.load()) {
            return;
        }
        if (const auto taskInterface = GameThread("DovahHub tab push")) {
            taskInterface->Queue([]() {
                if (g_hub && g_hubModule && g_petsTabShown.load()) {
                    (void)g_hub->PushJson(g_hubModule, ("{\"state\":" + StateJson() + "}").c_str());
                }
            });
        }
    }

    void FirePetEvent(const char* event, const std::string& json)
    {
        const auto listeners = g_petListeners;
        for (const auto& listener : listeners) {
            if (listener.desc.onEvent) {
                listener.desc.onEvent(event, json.c_str(), listener.desc.user);
            }
        }
    }

    // after a setting changed from the hub or the API: save, tell the card, tell the tab
    void SettingsChangedOutside()
    {
        SaveSettings();
        Card::Invoke("dragonbornXP.applySettings", SettingsPayload());
        PushPetsState();
    }

    bool SetCompanion(std::string_view id)
    {
        if (!IsSupportedPet(id)) {
            return false;
        }
        if (g_settings.pet != id) {
            g_settings.pet = std::string(id);
            SettingsChangedOutside();
            FirePetEvent("companion", "{\"id\":" + JsonString(id) + "}");
        }
        return true;
    }

    // Sends the Settings rows again after the language or the hide key changed. Queued: DovahHub
    // must not be called from inside its own callbacks, and AddSettings is game-thread only.
    void RefreshHubSettings()
    {
        if (!g_hub || !g_hubModule) {
            return;
        }
        if (g_hubSettingsLanguage == g_settings.language && g_hubSettingsHideKey == g_settings.hideHotkeyName) {
            return;
        }
        g_hubSettingsLanguage = g_settings.language;
        g_hubSettingsHideKey = g_settings.hideHotkeyName;
        if (const auto tasks = GameThread("DovahHub settings")) {
            tasks->Queue([]() {
                if (g_hub && g_hubModule) {
                    (void)g_hub->AddSettings(g_hubModule, HubSettingsSchema().c_str());
                    logger::info("MiniPets: DovahHub settings sent again in {}", g_settings.language);
                }
            });
        }
    }

    void RegisterWithDovahHub()
    {
        g_hub = DOVAHHUB_API::RequestApi();
        if (!g_hub) {
            logger::info("MiniPets: DovahHub not found, no MiniPets tab");
            return;
        }
        DOVAHHUB_API::ModuleDesc desc{};
        desc.size = sizeof(desc);
        desc.id = "pets";
        desc.tab = "MiniPets";
        desc.group = nullptr;
        desc.pageDir = "modules/pets/";
        desc.version = g_pluginVersion.c_str();
        desc.onRequest = &OnHubRequest;
        desc.onEvent = &OnHubEvent;
        const auto result = g_hub->RegisterModule(&desc, &g_hubModule);
        if (result != DOVAHHUB_API::Result::Ok) {
            logger::warn("MiniPets: DovahHub refused the MiniPets tab ({})", static_cast<int>(result));
            g_hub = nullptr;
            g_hubModule = 0;
            return;
        }
        g_hubSettingsLanguage = g_settings.language;
        g_hubSettingsHideKey = g_settings.hideHotkeyName;
        (void)g_hub->AddSettings(g_hubModule, HubSettingsSchema().c_str());
        logger::info("MiniPets: MiniPets tab registered with DovahHub {} on {}", g_hub->hostVersion, g_hub->host);
        // DovahHub 0.98.0+: Settings > Diagnostics > Run self-test runs MiniPets' too
        if (DOVAHHUB_API::HasSelfTest(g_hub)) {
            const auto selfTest = g_hub->RegisterSelfTest(g_hubModule, &SelfTestRunner::StartSelfTestFromHub, nullptr);
            logger::info("MiniPets: self-test {} with DovahHub", selfTest == DOVAHHUB_API::Result::Ok ? "registered" : "not registered (" + std::to_string(static_cast<int>(selfTest)) + ")");
        }
    }

    // the page told us how a feed/play went: on to the tab and to API listeners
    void OnPetActionResult(const std::string& result)
    {
        if (g_hub && g_hubModule && g_petsTabShown.load()) {
            (void)g_hub->PushJson(g_hubModule, ("{\"result\":" + result + "}").c_str());
        }
        FirePetEvent(JsonField(result, "action") == "feed" ? "fed" : "played", result);
    }

    MINIPETS_API::Result ApiSetRaisePet(bool enabled)
    {
        if (g_settings.raisePet != enabled) {
            g_settings.raisePet = enabled;
            SettingsChangedOutside();
        }
        return MINIPETS_API::Result::Ok;
    }

    void BuildMiniPetsApi()
    {
        const auto version = SKSE::PluginDeclaration::GetSingleton()->GetVersion();
        g_pluginVersion = version.string(".");
        g_miniPetsApi.apiVersion = MINIPETS_API::kApiVersion2;
        g_miniPetsApi.hostVersion = g_pluginVersion.c_str();
        g_miniPetsApi.hostVersionNumber = MINIPETS_API::PackVersion(version.major(), version.minor(), version.patch());
        g_miniPetsApi.GetStateJson = &ApiGetStateJson;
        g_miniPetsApi.Feed = &ApiFeed;
        g_miniPetsApi.Play = &ApiPlay;
        g_miniPetsApi.SetCompanion = &ApiSetCompanion;
        g_miniPetsApi.SetRaisePet = &ApiSetRaisePet;
        g_miniPetsApi.SetVisible = &ApiSetVisible;
        g_miniPetsApi.SetCard = &ApiSetCard;
        g_miniPetsApi.SetClock = &ApiSetClock;
        g_miniPetsApi.IsVisible = &ApiIsVisible;
        g_miniPetsApi.AddListener = &ApiAddListener;
        g_miniPetsApi.RemoveListener = &ApiRemoveListener;
        g_miniPetsApi.React = &ApiReact;
    }

    const void* Api()
    {
        return &g_miniPetsApi;
    }

    // DovahHub is there and took the MiniPets tab
    bool Present()
    {
        return g_hub && g_hubModule;
    }

    DOVAHHUB_API::Result ReportSelfTestStep(const char* stepJson)
    {
        return g_hub->ReportSelfTestStep(g_hubModule, stepJson);
    }

    DOVAHHUB_API::Result FinishSelfTest()
    {
        return g_hub->FinishSelfTest(g_hubModule);
    }
}

// The self-test runner (DMP-11, moved here by DMP-12): starts the run (MiniPets.ini, Chronicle or DovahHub),
// walks SelfTest.h's steps through the pump, asks the card what it draws, and reports each line.
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

using namespace MiniPets;
static void SKSEMessageHandler(SKSE::MessagingInterface::Message* message)
{
    if (!message) {
        return;
    }
    switch (message->type) {
    case SKSE::MessagingInterface::kPostLoad:
        // every plugin is loaded: DovahHub's pump if it has one, otherwise MiniPets' own frame hook
        DovahGameThread::Install("MiniPets");
        break;
    case SKSE::MessagingInterface::kPostPostLoad:
        Hub::BuildMiniPetsApi();
        Hub::RegisterWithDovahHub();
        ReactionWiring::ConnectOtherMods();
        SelfTestRunner::RegisterChronicleCommand();
        ReactionWiring::LogOtherMods();
        break;
    case SKSE::MessagingInterface::kDataLoaded:
        OnDataLoaded();
        break;
    case SKSE::MessagingInterface::kPreLoadGame:
        PetSave::BeginLoad();
        break;
    case SKSE::MessagingInterface::kPostLoadGame:
    case SKSE::MessagingInterface::kNewGame:
        // stay hidden until a game is loaded
        g_gameLoaded.store(true);
        PetSave::FinishLoad();
        Hub::PushPetsState();
        SelfTestRunner::MaybeStartSelfTestFromIni();
        break;
    default:
        break;
    }
}

// A manual install that kept the 1.7 files has two copies of the plugin running. Mod managers
// replace the folder, so only hand-copied installs can get here.
static void WarnAboutLeftoverDll()
{
    if (!REX::W32::GetModuleHandleW(L"DragonbornXP.dll")) {
        return;
    }
    logger::warn("MiniPets: the old DragonbornXP.dll is still installed next to MiniPets.dll");
    // in the player's language: the settings are read early for this, and again at kDataLoaded
    LoadSettings();
    const std::string_view text = HubText::For(g_settings.language).leftoverDll;
    const std::wstring message = std::filesystem::path(std::u8string(reinterpret_cast<const char8_t*>(text.data()), text.size())).wstring();
    REX::W32::MessageBoxW(nullptr, message.c_str(), L"MiniPets", 0x00000030);  // MB_ICONWARNING
}

extern "C" DLLEXPORT bool SKSEPlugin_Load(const SKSE::LoadInterface* skse)
{
    REL::Module::reset();
    SKSE::Init(skse, { .trampoline = true, .trampolineSize = 1 << 10 });

    auto* messaging = reinterpret_cast<SKSE::MessagingInterface*>(
        skse->QueryInterface(SKSE::LoadInterface::kMessaging));
    if (!messaging) {
        logger::critical("Failed to acquire SKSE messaging interface.");
        return false;
    }

    messaging->RegisterListener("SKSE", SKSEMessageHandler);
    // DovahHub's story events and outfit changes; nothing arrives when DovahHub isn't installed
    messaging->RegisterListener("DovahHub", ReactionWiring::OnDovahHubMessage);
    WarnAboutLeftoverDll();

    // 'DBXP' is the co-save record from before the rename; every player's pet is stored under it
    if (auto* serialization = SKSE::GetSerializationInterface()) {
        serialization->SetUniqueID('DBXP');
        serialization->SetSaveCallback(PetSave::OnGameSaved);
        serialization->SetLoadCallback(PetSave::OnGameLoaded);
        serialization->SetRevertCallback(PetSave::OnRevert);
    }
    return true;
}

extern "C" DLLEXPORT const void* MiniPets_RequestApi(std::uint32_t version)
{
    // a version-2 table starts with the version-1 one, so both are served from it
    return version == MINIPETS_API::kApiVersion1 || version == MINIPETS_API::kApiVersion2 ? Hub::Api() : nullptr;
}
