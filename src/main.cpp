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
