// MiniPets' core: the settings file, small helpers, the game-thread pump and SKSE's entry points. The rest
// is in five parts (Plugin.h lists them).
#include "Plugin.h"
#include "SettingsFile.h"
#include "HubText.h"
#include "keyhandler.h"

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

// The card bridge (DMP-12): the HUD page (Prisma UI view) and everything sent to it or read from it: the
// overlay's visibility over menus, the companion's pose, the world mood and clock, the settings window,
// the hotkeys, and the game events the card shows (skills, levels, souls, food).
namespace MiniPets::Card
{
    namespace
    {
    PRISMA_UI_API::IVPrismaUI1* g_prismaUI = nullptr;
    PrismaView g_view = 0;

        std::atomic_bool g_settingsOpen = false;
        struct PetKey
        {
            std::atomic_uint32_t scan = 0;
            std::atomic_bool shift = false;
        };
        PetKey g_feedKey;
        PetKey g_playKey;
        PetKey g_hideKey;
        std::atomic_bool g_shiftDown = false;
        std::atomic_bool g_overlayHiddenForMenus = true;
        std::string g_lastCompanionState;
        std::string g_lastWorldMood;
        std::int64_t g_lastClockMinute = -1;

        constexpr std::array<std::string_view, 36> kBlockingMenus{
            "Main Menu", "Loading Menu", "LoadWaitSpinner", "Fader Menu", "SystemMenu", "TweenMenu",
            "InventoryMenu", "MagicMenu", "MapMenu", "ContainerMenu", "Journal Menu", "LevelUpMenu",
            "StatsMenu", "SleepWaitMenu", "FavoritesMenu", "BarterMenu", "CraftingMenu", "Crafting Menu",
            "SmithingMenu", "Smithing Menu", "AlchemyMenu", "Alchemy Menu", "EnchantingMenu", "Enchanting Menu",
            "CookingMenu", "Cooking Menu", "PhotoMenu", "Console", "RaceSex Menu", "Book Menu",
            "Lockpicking Menu", "Training Menu", "GiftMenu", "Tutorial Menu", "Credits Menu", "Mod Manager Menu"
        };

        // polled because the main menu and first loading screen open before we're listening
        bool IsAnyBlockingMenuOpen()
        {
            auto* ui = RE::UI::GetSingleton();
            if (!ui) {
                return true;
            }
            for (const auto menu : kBlockingMenus) {
                if (ui->IsMenuOpen(menu)) {
                    return true;
                }
            }
            return false;
        }

        // menus from other mods (SKSE's CustomMenu, UIExtensions and so on) that pause or show a cursor
        const char* OpenModMenu()
        {
            auto* ui = RE::UI::GetSingleton();
            if (!ui) {
                return nullptr;
            }
            for (const auto& [name, entry] : ui->menuMap) {
                const auto* menu = entry.menu.get();
                if (!menu || (!menu->PausesGame() && !menu->UsesCursor())) {
                    continue;
                }
                const std::string_view menuName = name.c_str();
                if (menuName == "HUD Menu" || menuName == "Cursor Menu" || menuName == "Dialogue Menu" ||
                    menuName.find("Prisma") != std::string_view::npos) {
                    continue;
                }
                if (ui->IsMenuOpen(name)) {
                    return name.c_str();
                }
            }
            return nullptr;
        }

        // SKSE Menu Framework draws with ImGui, so it never shows up as a Skyrim menu
        bool IsMenuFrameworkOpen()
        {
            using IsOpenFn = bool (*)();
            static const auto isOpen = []() -> IsOpenFn {
                const auto module = REX::W32::GetModuleHandleW(L"SKSEMenuFramework.dll");
                return module ? reinterpret_cast<IsOpenFn>(REX::W32::GetProcAddress(module, "IsAnyBlockingWindowOpened")) : nullptr;
            }();
            return isOpen && isOpen();
        }

        void StorePetKey(PetKey& key, const std::string& name)
        {
            bool shift = false;
            key.scan.store(ParseHotkey(name, &shift));
            key.shift.store(shift);
        }

        void ShowSkillGain(RE::ActorValue actorValue)
        {
            const auto skill = RE::ActorValueToString(actorValue);
            Invoke("dragonbornXP.skillGain", "{\"skill\":" + JsonString(skill) + "}");
        }

        void PublishCompanionState(const std::string& state)
        {
            if (state == g_lastCompanionState) {
                return;
            }

            const auto previous = g_lastCompanionState;
            g_lastCompanionState = state;

            if (state == "idle" && previous != "" && previous != "idle") {
                Invoke("dragonbornXP.companionState", "{\"state\":\"landed\"}");
            }
            else {
                Invoke("dragonbornXP.companionState", "{\"state\":\"" + state + "\"}");
            }
        }

        const char* OverlayHiddenReason()
        {
            if (!g_gameLoaded.load()) {
                return "no game loaded yet";
            }
            if (IsAnyBlockingMenuOpen()) {
                return "a Skyrim menu is open";
            }
            // other prisma menus
            if (g_prismaUI->HasAnyActiveFocus() && !g_prismaUI->HasFocus(g_view)) {
                return "another Prisma UI menu has focus";
            }
            // our own settings open a cursor menu too
            if (!g_prismaUI->HasFocus(g_view)) {
                if (const char* menu = OpenModMenu()) {
                    static std::string reason;
                    reason = std::string("a mod menu is open (") + menu + ")";
                    return reason.c_str();
                }
                if (IsMenuFrameworkOpen()) {
                    return "SKSE Menu Framework is open";
                }
            }
            const auto* player = RE::PlayerCharacter::GetSingleton();
            if (!player || !player->Is3DLoaded()) {
                return "the player is not loaded";
            }
            return nullptr;
        }

        const char* GetTimeOfDay(float hour)
        {
            if (hour >= 5.0f && hour < 7.0f) {
                return "dawn";
            }
            if (hour >= 7.0f && hour < 18.0f) {
                return "day";
            }
            if (hour >= 18.0f && hour < 20.0f) {
                return "sunset";
            }
            return "night";
        }

        const char* GetWeatherMood(const RE::Sky* sky)
        {
            if (!sky) {
                return "clear";
            }

            const auto* weather = sky->currentWeather;
            const bool raining = sky->IsRaining() || (weather && weather->data.flags.any(RE::TESWeather::WeatherDataFlag::kRainy));
            const bool snowing = sky->IsSnowing() || (weather && weather->data.flags.any(RE::TESWeather::WeatherDataFlag::kSnow));

            if (snowing) {
                return "snow";
            }
            if (raining && weather && weather->data.thunderLightningFrequency > 0) {
                return "storm";
            }
            if (raining) {
                return "rain";
            }
            if (weather && weather->data.flags.any(RE::TESWeather::WeatherDataFlag::kCloudy)) {
                return "cloudy";
            }
            return "clear";
        }

        bool IsSolstheim(const RE::TESWorldSpace* worldspace)
        {
            // solstheim worldspace in Dragonborn.esm
            static const RE::TESWorldSpace* solstheim = []() -> const RE::TESWorldSpace* {
                auto* dataHandler = RE::TESDataHandler::GetSingleton();
                return dataHandler ? dataHandler->LookupForm<RE::TESWorldSpace>(0x800, "Dragonborn.esm") : nullptr;
            }();
            return worldspace && worldspace == solstheim;
        }

        std::string Lowercase(std::string_view value)
        {
            std::string result(value);
            for (auto& character : result) {
                character = static_cast<char>(std::tolower(static_cast<unsigned char>(character)));
            }
            return result;
        }

        // matched by editor id prefix
        const char* RegionForWorldspace(const RE::TESWorldSpace* worldspace)
        {
            if (!worldspace) {
                return nullptr;
            }
            if (IsSolstheim(worldspace)) {
                return "solstheim";
            }
            const auto editorID = Lowercase(worldspace->GetFormEditorID() ? worldspace->GetFormEditorID() : "");
            constexpr std::array<std::pair<std::string_view, const char*>, 10> kWorldspaces{ {
                { "dlc2solstheim", "solstheim" },
                { "dlc2apocrypha", "apocrypha" },
                { "dlc01soulcairn", "soulcairn" },
                { "sovngarde", "sovngarde" },
                { "blackreach", "blackreach" },
                { "whiterun", "whiterun" },
                { "windhelm", "windhelm" },
                { "solitude", "solitude" },
                { "riften", "riften" },
                { "markarth", "markarth" },
            } };
            for (const auto& [prefix, region] : kWorldspaces) {
                if (editorID.rfind(prefix, 0) == 0) {
                    return region;
                }
            }
            return nullptr;
        }

        // most specific first, unknown interiors get the normal backdrop
        const char* RegionForInterior(const RE::BGSLocation* location)
        {
            if (!location) {
                return nullptr;
            }
            constexpr std::array<std::pair<std::string_view, const char*>, 18> kKeywords{ {
                { "LocTypeDwarvenAutomatons", "dwemer" },
                { "LocTypeDraugrCrypt", "tomb" },
                { "LocTypeFalmerHive", "falmer" },
                { "LocTypeVampireLair", "vampire" },
                { "LocTypeMine", "mine" },
                { "LocTypeTemple", "temple" },
                { "LocTypeInn", "inn" },
                { "LocTypePlayerHouse", "house" },
                { "LocTypeHouse", "house" },
                { "LocTypeStore", "house" },
                { "LocTypeCastle", "house" },
                { "LocTypeGuild", "house" },
                { "LocTypeAnimalDen", "cave" },
                { "LocTypeBanditCamp", "cave" },
                { "LocTypeForswornCamp", "cave" },
                { "LocTypeHagravenNest", "cave" },
                { "LocTypeWarlockLair", "cave" },
                { "LocTypeDungeon", "cave" },
            } };
            for (const auto& [keyword, region] : kKeywords) {
                if (location->HasKeywordString(keyword)) {
                    return region;
                }
            }
            return nullptr;
        }

        const char* GetRegion()
        {
            const auto* player = RE::PlayerCharacter::GetSingleton();
            if (!player) {
                return "skyrim";
            }
            const auto* cell = player->GetParentCell();
            if (cell && cell->IsInteriorCell()) {
                const auto* region = RegionForInterior(player->GetCurrentLocation());
                return region ? region : "skyrim";
            }
            const auto* region = RegionForWorldspace(player->GetWorldspace());
            return region ? region : "skyrim";
        }

        void OpenSettings()
        {
            bool expected = false;
            if (!g_settingsOpen.compare_exchange_strong(expected, true)) {
                return;
            }

            if (const auto taskInterface = GameThread("open settings")) {
                taskInterface->Queue([]() {
                    // not over game menus, the view is hidden there
                    if (!g_prismaUI || !g_view || !g_prismaUI->IsValid(g_view) || g_overlayHiddenForMenus.load()) {
                        g_settingsOpen.store(false);
                        return;
                    }

                    Invoke("dragonbornXP.openSettings", SettingsPayload());
                    g_prismaUI->Focus(g_view, false, false);
                });
            }
            else {
                g_settingsOpen.store(false);
            }
        }

        void CloseSettings()
        {
            if (!g_settingsOpen.exchange(false)) {
                return;
            }

            if (const auto taskInterface = GameThread("close settings")) {
                taskInterface->Queue([]() {
                    if (g_prismaUI && g_view && g_prismaUI->IsValid(g_view) && g_prismaUI->HasFocus(g_view)) {
                        g_prismaUI->Unfocus(g_view);
                    }
                });
            }
        }

        // x|y|hotkey|pet|clock|clockStyle|scale|raisePet|feedKey|playKey|shape|hideKey|language, everything after pet is optional
        void ApplySettings(std::string_view payload)
        {
            const auto parts = Split(payload, '|');
            if (parts.size() < 4) {
                return;
            }

            try {
                const auto x = std::stoi(parts[0]);
                const auto y = std::stoi(parts[1]);
                const auto& hotkeyName = parts[2];
                const auto& pet = parts[3];
                const bool showClock = parts.size() > 4 ? ParseFlag(parts[4]) : g_settings.showClock;
                const auto clockStyle = parts.size() > 5 && IsSupportedClockStyle(parts[5]) ? parts[5] : g_settings.clockStyle;
                const auto scale = parts.size() > 6 ? ClampScale(std::stoi(parts[6])) : g_settings.scale;
                const bool raisePet = parts.size() > 7 ? ParseFlag(parts[7]) : g_settings.raisePet;
                const auto feedKey = parts.size() > 8 && ParseHotkey(parts[8]) != 0 ? parts[8] : g_settings.feedHotkeyName;
                const auto playKey = parts.size() > 9 && ParseHotkey(parts[9]) != 0 ? parts[9] : g_settings.playHotkeyName;
                const auto cardShape = parts.size() > 10 && IsSupportedCardShape(parts[10]) ? parts[10] : g_settings.cardShape;
                const auto hideKey = parts.size() > 11 && ParseHotkey(parts[11]) != 0 ? parts[11] : g_settings.hideHotkeyName;
                const auto language = parts.size() > 12 && IsSupportedLanguage(parts[12]) ? parts[12] : g_settings.language;
                bool requiresShift = false;
                const auto hotkey = ParseHotkey(hotkeyName, &requiresShift);
                if (hotkey == 0 || x < -1 || y < -1 || !IsSupportedPet(pet)) {
                    return;
                }

                const auto previousPet = g_settings.pet;
                g_settings.positionX = x;
                g_settings.positionY = y;
                g_settings.settingsHotkey = hotkey;
                g_settings.settingsHotkeyRequiresShift = requiresShift;
                g_settings.settingsHotkeyName = hotkeyName;
                g_settings.pet = pet;
                g_settings.showClock = showClock;
                g_settings.clockStyle = clockStyle;
                g_settings.scale = scale;
                g_settings.raisePet = raisePet;
                g_settings.feedHotkeyName = feedKey;
                g_settings.playHotkeyName = playKey;
                g_settings.cardShape = cardShape;
                g_settings.hideHotkeyName = hideKey;
                g_settings.language = language;
                StorePetKey(g_feedKey, feedKey);
                StorePetKey(g_playKey, playKey);
                StorePetKey(g_hideKey, hideKey);
                g_settingsHotkey.store(hotkey);
                g_settingsHotkeyRequiresShift.store(requiresShift);
                WarnAboutDuplicateHotkeys();
                SaveSettings();
                Hub::PushPetsState();
                Hub::RefreshHubSettings();
                if (pet != previousPet) {
                    Hub::FirePetEvent("companion", "{\"id\":" + JsonString(pet) + "}");
                }
            }
            catch (const std::exception& error) {
                logger::warn("MiniPets ignored settings update: {}", error.what());
            }
        }

        std::atomic_bool g_menuCheckQueued = false;

        class SkillIncreaseSink final : public RE::BSTEventSink<RE::SkillIncrease::Event>
        {
        public:
            RE::BSEventNotifyControl ProcessEvent(
                const RE::SkillIncrease::Event* event,
                RE::BSTEventSource<RE::SkillIncrease::Event>*) override
            {
                if (event && event->player == RE::PlayerCharacter::GetSingleton()) {
                    ShowSkillGain(event->actorValue);
                }
                return RE::BSEventNotifyControl::kContinue;
            }
        };

        class LevelIncreaseSink final : public RE::BSTEventSink<RE::LevelIncrease::Event>
        {
        public:
            RE::BSEventNotifyControl ProcessEvent(
                const RE::LevelIncrease::Event* event,
                RE::BSTEventSource<RE::LevelIncrease::Event>*) override
            {
                if (event && event->player == RE::PlayerCharacter::GetSingleton()) {
                    const auto json = "{\"level\":" + std::to_string(event->newLevel) + "}";
                    Invoke("dragonbornXP.levelUp", json);
                    Hub::FirePetEvent("levelUp", json);
                }
                return RE::BSEventNotifyControl::kContinue;
            }
        };

        class DragonSoulSink final : public RE::BSTEventSink<RE::DragonSoulsGained::Event>
        {
        public:
            RE::BSEventNotifyControl ProcessEvent(
                const RE::DragonSoulsGained::Event* event,
                RE::BSTEventSource<RE::DragonSoulsGained::Event>*) override
            {
                if (event && event->souls > 0.0f) {
                    const auto rounded = std::lround(event->souls);
                    const auto souls = rounded > 0 ? rounded : 1L;
                    Invoke("dragonbornXP.dragonSoul", "{\"amount\":" + std::to_string(souls) + "}");
                }
                return RE::BSEventNotifyControl::kContinue;
            }
        };

        class MenuStateSink final : public RE::BSTEventSink<RE::MenuOpenCloseEvent>
        {
        public:
            RE::BSEventNotifyControl ProcessEvent(
                const RE::MenuOpenCloseEvent* event,
                RE::BSTEventSource<RE::MenuOpenCloseEvent>*) override
            {
                if (!event) {
                    return RE::BSEventNotifyControl::kContinue;
                }

                if (g_menuCheckQueued.exchange(true)) {
                    return RE::BSEventNotifyControl::kContinue;
                }
                GameThread("menu check")->Queue([]() {
                    g_menuCheckQueued.store(false);
                    UpdateOverlayMenuVisibility();
                });
                return RE::BSEventNotifyControl::kContinue;
            }
        };

        void SendPetFed(const RE::TESForm* food, const char* source)
        {
            const char* name = food ? food->GetName() : nullptr;
            Invoke("dragonbornXP.petFed", "{\"name\":" + JsonString(name ? name : "") + ",\"source\":\"" + source + "\"}");
        }

        // eating food in game feeds the pet too
        class EquipSink final : public RE::BSTEventSink<RE::TESEquipEvent>
        {
        public:
            RE::BSEventNotifyControl ProcessEvent(const RE::TESEquipEvent* event, RE::BSTEventSource<RE::TESEquipEvent>*) override
            {
                if (!event || !event->equipped || event->actor.get() != RE::PlayerCharacter::GetSingleton()) {
                    return RE::BSEventNotifyControl::kContinue;
                }
                const auto* form = RE::TESForm::LookupByID(event->baseObject);
                const auto* alchemy = form ? form->As<RE::AlchemyItem>() : nullptr;
                if (alchemy && alchemy->IsFood()) {
                    SendPetFed(alchemy, "ate");
                }
                return RE::BSEventNotifyControl::kContinue;
            }
        };

        // Feed button: uses the cheapest food in the player's inventory.
        void FeedFromPack()
        {
            auto* player = RE::PlayerCharacter::GetSingleton();
            if (!player) {
                return;
            }
            auto* cheapest = CheapestFood();
            if (!cheapest) {
                Invoke("dragonbornXP.petFed", "{\"none\":true}");
                return;
            }
            SendPetFed(cheapest, "pack");
            player->RemoveItem(cheapest, 1, RE::ITEM_REMOVE_REASON::kRemove, nullptr, nullptr);
        }

        SkillIncreaseSink g_skillSink;
        LevelIncreaseSink g_levelSink;
        DragonSoulSink g_soulSink;
        MenuStateSink g_menuSink;
        EquipSink g_equipSink;
    }

    void Invoke(const std::string& functionName, const std::string& json)
    {
        WarnIfOffGameThread("view Invoke");
        if (!g_prismaUI || !g_view || !g_prismaUI->IsValid(g_view)) {
            return;
        }

        const auto script = "window." + functionName + "(" + json + ");";
        g_prismaUI->Invoke(g_view, script.c_str());
    }

    void UpdateCompanionState()
    {
        auto* player = RE::PlayerCharacter::GetSingleton();
        if (!player) {
            return;
        }

        bool moving = false;
        if (const auto* actorState = player->AsActorState()) {
            const auto& movement = actorState->actorState1;
            moving = movement.movingForward || movement.movingBack || movement.movingLeft || movement.movingRight ||
                     movement.walking || movement.running || movement.sprinting;
        }

        PublishCompanionState(player->IsInCombat() ? "combat" : moving ? "flying" : "idle");
    }

    // checks the real view state every poll in case something else showed it
    void UpdateOverlayMenuVisibility()
    {
        if (!g_prismaUI || !g_view || !g_prismaUI->IsValid(g_view)) {
            return;
        }

        const char* reason = OverlayHiddenReason();
        const bool shouldHide = reason != nullptr;
        const bool changed = shouldHide != g_overlayHiddenForMenus.exchange(shouldHide);
        const bool viewHidden = g_prismaUI->IsHidden(g_view);

        if (changed) {
            Invoke("dragonbornXP.setActive", shouldHide ? "false" : "true");
            logger::info("MiniPets overlay {}", shouldHide ? std::string("hidden: ") + reason : std::string("shown"));
        }

        if (shouldHide) {
            // close settings first or the hidden view keeps input focus
            if (g_settingsOpen.load()) {
                Invoke("dragonbornXP.closeSettings", "{}");
                CloseSettings();
            }
            if (!viewHidden) {
                g_prismaUI->Hide(g_view);
            }
        }
        else if (viewHidden) {
            g_prismaUI->Show(g_view);
        }
    }

    void UpdateWorldMood()
    {
        const auto* calendar = RE::Calendar::GetSingleton();
        const auto* sky = RE::Sky::GetSingleton();
        const auto timeOfDay = GetTimeOfDay(calendar ? calendar->GetHour() : 12.0f);
        const auto weather = GetWeatherMood(sky);
        const auto region = GetRegion();
        const std::string mood = std::string(timeOfDay) + "|" + weather + "|" + region;

        if (mood == g_lastWorldMood) {
            return;
        }

        g_lastWorldMood = mood;
        Invoke("dragonbornXP.worldMood", "{\"time\":\"" + std::string(timeOfDay) + "\",\"weather\":\"" + weather +
                                             "\",\"region\":\"" + region + "\"}");
    }

    // once per in-game minute
    void UpdateClock()
    {
        const auto* calendar = RE::Calendar::GetSingleton();
        if (!calendar) {
            return;
        }

        const auto hours = calendar->GetHour();
        const auto hour = static_cast<int>(hours);
        const auto minute = static_cast<int>((hours - static_cast<float>(hour)) * 60.0f);
        const auto day = static_cast<int>(calendar->GetDay());
        const auto year = static_cast<std::int64_t>(calendar->GetYear());
        const auto month = static_cast<std::int64_t>(calendar->GetMonth());
        const auto stamp = (((year * 12 + month) * 32 + day) * 24 + hour) * 60 + minute;
        if (stamp == g_lastClockMinute) {
            return;
        }

        g_lastClockMinute = stamp;
        Invoke("dragonbornXP.clock", "{\"hour\":" + std::to_string(hour) +
                                         ",\"minute\":" + std::to_string(minute) +
                                         // the names are the game's, in the game's language; the page
                                         // words the date by the numbers, in MiniPets' language
                                         ",\"weekday\":" + JsonString(calendar->GetDayName()) +
                                         ",\"weekdayIndex\":" + std::to_string(calendar->GetDayOfWeek()) +
                                         ",\"day\":" + std::to_string(day) +
                                         ",\"month\":" + JsonString(calendar->GetMonthName()) +
                                         ",\"monthIndex\":" + std::to_string(month) +
                                         ",\"year\":" + std::to_string(year) +
                                         ",\"hours\":" + std::to_string(calendar->GetHoursPassed()) + "}");
    }

    // cheapest food in the player's pack, and how many food items there are
    RE::TESBoundObject* CheapestFood(int* count)
    {
        if (count) {
            *count = 0;
        }
        auto* player = RE::PlayerCharacter::GetSingleton();
        if (!player) {
            return nullptr;
        }
        auto inventory = player->GetInventory([](RE::TESBoundObject& object) {
            const auto* alchemy = object.As<RE::AlchemyItem>();
            return alchemy && alchemy->IsFood();
        });
        RE::TESBoundObject* cheapest = nullptr;
        auto cheapestValue = (std::numeric_limits<std::int32_t>::max)();
        for (const auto& [object, entry] : inventory) {
            if (entry.first <= 0) {
                continue;
            }
            if (count) {
                *count += entry.first;
            }
            if (object->GetGoldValue() < cheapestValue) {
                cheapest = object;
                cheapestValue = object->GetGoldValue();
            }
        }
        return cheapest;
    }

    void SetPetHidden(bool hidden)
    {
        if (g_settings.petHidden == hidden) {
            return;
        }
        g_settings.petHidden = hidden;
        SaveSettings();
        Invoke("dragonbornXP.setHidden", hidden ? "true" : "false");
        Hub::PushPetsState();
        Hub::FirePetEvent("visible", std::string("{\"visible\":") + (hidden ? "false" : "true") + "}");
    }

    void RegisterPreviewKeys()
    {
        KeyHandler::RegisterSink();
        auto* keyHandler = KeyHandler::GetSingleton();

        // F6/F7 test toasts, only with debug_preview_keys=1
        if (g_settings.debugPreviewKeys) {
            (void)keyHandler->Register(0x40, KeyEventType::KEY_DOWN, []() {
                ShowSkillGain(RE::ActorValue::kDestruction);
            });
            (void)keyHandler->Register(0x41, KeyEventType::KEY_DOWN, []() {
                Invoke("dragonbornXP.levelUp", "{\"level\":42}");
            });
        }

        (void)keyHandler->Register(0x2A, KeyEventType::KEY_DOWN, []() {
            g_shiftDown.store(true);
        });
        (void)keyHandler->Register(0x36, KeyEventType::KEY_DOWN, []() {
            g_shiftDown.store(true);
        });
        (void)keyHandler->Register(0x2A, KeyEventType::KEY_UP, []() {
            g_shiftDown.store(false);
        });
        (void)keyHandler->Register(0x36, KeyEventType::KEY_UP, []() {
            g_shiftDown.store(false);
        });

        // register every key once so the hotkey can be rebound at runtime
        for (std::uint32_t scanCode = 1; scanCode < 0x80; ++scanCode) {
            (void)keyHandler->Register(scanCode, KeyEventType::KEY_DOWN, [scanCode]() {
                const bool shiftDown = g_shiftDown.load() || (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
                if (g_settingsOpen.load()) {
                    return;
                }
                if (scanCode == g_settingsHotkey.load() && shiftDown == g_settingsHotkeyRequiresShift.load()) {
                    logger::info("MiniPets settings hotkey pressed: {}", g_settings.settingsHotkeyName);
                    OpenSettings();
                    return;
                }
                if (scanCode == g_hideKey.scan.load() && shiftDown == g_hideKey.shift.load()) {
                    if (const auto taskInterface = GameThread("hide hotkey"); taskInterface && !g_overlayHiddenForMenus.load()) {
                        taskInterface->Queue([]() {
                            SetPetHidden(!g_settings.petHidden);
                        });
                    }
                    return;
                }
                // feed/play only while the pet is on screen and raise-a-pet is on
                if (!g_settings.raisePet || g_settings.petHidden || g_overlayHiddenForMenus.load()) {
                    return;
                }
                const char* action = nullptr;
                if (scanCode == g_feedKey.scan.load() && shiftDown == g_feedKey.shift.load()) {
                    action = "feed";
                }
                else if (scanCode == g_playKey.scan.load() && shiftDown == g_playKey.shift.load()) {
                    action = "play";
                }
                if (action) {
                    if (const auto taskInterface = GameThread("pet hotkey")) {
                        taskInterface->Queue([action]() {
                            Invoke("dragonbornXP.petAction", std::string("{\"action\":\"") + action + "\"}");
                        });
                    }
                }
            });
        }
    }

    bool IsHidden()
    {
        return g_overlayHiddenForMenus.load();
    }

    bool ViewCreated()
    {
        return g_prismaUI && g_view;
    }

    bool ViewValid()
    {
        return g_prismaUI && g_view && g_prismaUI->IsValid(g_view);
    }

    const std::string& LastCompanionState()
    {
        return g_lastCompanionState;
    }

    // a load or a new game: the clock, the world and the pose are sent again
    void ForgetLastSent()
    {
        g_lastClockMinute = -1;
        g_lastWorldMood.clear();
        g_lastCompanionState.clear();
    }

    void StoreKeys()
    {
        StorePetKey(g_feedKey, g_settings.feedHotkeyName);
        StorePetKey(g_playKey, g_settings.playHotkeyName);
        StorePetKey(g_hideKey, g_settings.hideHotkeyName);
    }

    // the HUD page and what it sends back; false without Prisma UI
    bool CreateView()
    {
        g_prismaUI = PRISMA_UI_API::RequestPluginAPI<PRISMA_UI_API::IVPrismaUI1>();
        if (!g_prismaUI) {
            logger::critical("PrismaUI was not found. MiniPets will not display its overlay.");
            return false;
        }

        g_view = g_prismaUI->CreateView("MiniPets/index.html", [](PrismaView view) {
            logger::info("MiniPets Prisma UI view ready: {}", view);
            g_prismaUI->Hide(view);
            g_overlayHiddenForMenus.store(true);
            g_prismaUI->RegisterJSListener(view, "settingsChanged", [](const char* payload) {
                if (!payload) {
                    return;
                }
                const std::string copy(payload);
                if (const auto taskInterface = GameThread("settings from the card")) {
                    taskInterface->Queue([copy]() {
                        ApplySettings(copy);
                    });
                }
            });
            g_prismaUI->RegisterJSListener(view, "settingsClosed", [](const char*) {
                CloseSettings();
            });
            // one-line reports from the page (language, whether i18n.js loaded)
            g_prismaUI->RegisterJSListener(view, "viewLog", [](const char* payload) {
                const std::string_view line = payload ? payload : "";
                logger::info("MiniPets page: {}", line.substr(0, 200));
            });
            g_prismaUI->RegisterJSListener(view, "petStateChanged", [](const char* payload) {
                const std::string copy(payload ? payload : "");
                if (const auto taskInterface = GameThread("pet state from the card")) {
                    // the session is checked when the task runs, after any load that started meanwhile
                    taskInterface->Queue([copy]() {
                        std::string state;
                        if (PetSave::AcceptPetState(copy, state)) {
                            PetSave::OnPetStateChanged(state);
                        }
                    });
                }
            });
            g_prismaUI->RegisterJSListener(view, "petActionResult", [](const char* payload) {
                if (!payload || *payload != '{') {
                    return;
                }
                const std::string copy(payload);
                if (const auto taskInterface = GameThread("pet action result")) {
                    taskInterface->Queue([copy]() { Hub::OnPetActionResult(copy); });
                }
            });
            g_prismaUI->RegisterJSListener(view, "petSays", [](const char* payload) {
                if (!payload || *payload != '{') {
                    return;
                }
                const std::string copy(payload);
                if (const auto taskInterface = GameThread("Chronicle line")) {
                    taskInterface->Queue([copy]() { ReactionWiring::SendChronicleLine(copy); });
                }
            });
            // the self-test's questions to the card: the answer is only stored, no game work
            g_prismaUI->RegisterJSListener(view, "selfTestAnswer", [](const char* payload) {
                SelfTestRunner::OnPageAnswer(payload);
            });
            g_prismaUI->RegisterJSListener(view, "feedPet", [](const char*) {
                if (const auto taskInterface = GameThread("feed from the pack")) {
                    taskInterface->Queue([]() { FeedFromPack(); });
                }
            });
            // new page, resend everything
            g_lastWorldMood.clear();
            g_lastClockMinute = -1;
            Invoke("dragonbornXP.initialize", "{}");
            Invoke("dragonbornXP.applySettings", SettingsPayload());
            PetSave::SendPetState();
        });
        // draw under other prisma views
        g_prismaUI->SetOrder(g_view, -100);
        return true;
    }

    // the game's events the card shows (the reactions register their own)
    void RegisterEvents()
    {
        if (auto* source = RE::SkillIncrease::GetEventSource()) {
            source->AddEventSink(&g_skillSink);
        }
        if (auto* source = RE::LevelIncrease::GetEventSource()) {
            source->AddEventSink(&g_levelSink);
        }
        if (auto* source = RE::DragonSoulsGained::GetEventSource()) {
            source->AddEventSink(&g_soulSink);
        }
        if (auto* ui = RE::UI::GetSingleton()) {
            ui->AddEventSink<RE::MenuOpenCloseEvent>(&g_menuSink);
        }
        if (auto* scripts = RE::ScriptEventSourceHolder::GetSingleton()) {
            scripts->AddEventSink<RE::TESEquipEvent>(&g_equipSink);
        }
    }
}

// The reaction wiring (DMP-12): the game's events, DovahDamage, DovahHub's story broadcast and other mods'
// React() calls, offered to the one gate in Reactions.h, and what it shows sent to the card.
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
        {
            std::lock_guard lock(g_reactQueueLock);
            g_reactQueue.clear();
        }
        Card::Invoke("dragonbornXP.reactEnd", "{}");
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
