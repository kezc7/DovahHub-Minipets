#include "PrismaUI_API.h"
#include "keyhandler.h"
#include "DovahHub_API.h"
#include "MiniPets_API.h"

#include <RE/A/ActorValueList.h>
#include <RE/A/AlchemyItem.h>
#include <RE/B/BGSLocation.h>
#include <RE/C/Calendar.h>
#include <RE/D/DragonSoulsGained.h>
#include <RE/L/LevelIncrease.h>
#include <RE/I/IMenu.h>
#include <RE/M/MenuOpenCloseEvent.h>
#include <RE/S/SkillIncrease.h>
#include <RE/S/ScriptEventSourceHolder.h>
#include <RE/S/Sky.h>
#include <RE/T/TESDataHandler.h>
#include <RE/T/TESEquipEvent.h>
#include <RE/T/TESObjectCELL.h>
#include <RE/T/TESWorldSpace.h>
#include <RE/U/UI.h>
#include <REX/W32/KERNEL32.h>
#include <REX/W32/USER32.h>
#include "SettingsFile.h"

#include <atomic>
#include <chrono>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <thread>
#include <array>
#include <limits>
#include <cstring>
#include <vector>

PRISMA_UI_API::IVPrismaUI1* g_prismaUI = nullptr;
PrismaView g_view = 0;

namespace
{
    constexpr std::uint32_t kDefaultSettingsHotkey = 0x30;  // B
    constexpr bool kDefaultSettingsHotkeyRequiresShift = true;
    const std::filesystem::path kSettingsPath = L"Data/SKSE/Plugins/MiniPets.ini";
    // before 1.8.0; copied to kSettingsPath on the first run, see SettingsFile.h
    const std::filesystem::path kLegacySettingsPath = L"Data/SKSE/Plugins/DragonbornXP.ini";

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
        bool petHidden = false;
    };

    std::atomic_bool g_statePollerStarted = false;
    std::atomic_bool g_settingsOpen = false;
    std::atomic_uint32_t g_settingsHotkey = kDefaultSettingsHotkey;
    std::atomic_bool g_settingsHotkeyRequiresShift = kDefaultSettingsHotkeyRequiresShift;

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
    std::atomic_bool g_gameLoaded = false;
    DragonbornSettings g_settings;
    std::string g_lastCompanionState;
    std::string g_lastWorldMood;
    // raise-a-pet state from the view (JSON), kept per save in the SKSE co-save
    std::string g_petState;
    std::int64_t g_lastClockMinute = -1;

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

    // same order and names as pet-sprites.js
    constexpr std::array<std::pair<std::string_view, std::string_view>, 20> kCompanions{ {
        { "dovahmin", "Dovahmin" }, { "dovahpink", "Dovahpink" }, { "mudcrab", "Clack" }, { "skeever", "Nibbles" },
        { "fox", "Ember" }, { "sabrecat", "Stripes" }, { "frostbite-spider", "Webber" }, { "horker", "Waddles" },
        { "troll", "Grumble" }, { "flame-atronach", "Cinder" }, { "frost-atronach", "Shiver" }, { "spriggan", "Moss" },
        { "dwarven-spider", "Tinker" }, { "chaurus", "Skitter" }, { "netch", "Bloop" }, { "mammoth", "Tusker" },
        { "dragon-priest", "Masky" }, { "wisp", "Glowbug" }, { "death-hound", "Gnasher" }, { "chicken", "Pip" }
    } };

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

    std::uint32_t ParseHotkey(std::string value, bool* requiresShift = nullptr)
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

    bool SameHotkey(const std::string& a, const std::string& b)
    {
        bool shiftA = false;
        bool shiftB = false;
        const auto scanA = ParseHotkey(a, &shiftA);
        return scanA != 0 && scanA == ParseHotkey(b, &shiftB) && shiftA == shiftB;
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

    void StorePetKey(PetKey& key, const std::string& name)
    {
        bool shift = false;
        key.scan.store(ParseHotkey(name, &shift));
        key.shift.store(shift);
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
                    else if (key == "hidden") {
                        g_settings.petHidden = ParseFlag(value);
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
                   << "hidden=" << (g_settings.petHidden ? 1 : 0) << '\n';
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
               ",\"hidden\":" + (g_settings.petHidden ? "true" : "false") + "}";
    }

    void Invoke(const std::string& functionName, const std::string& json)
    {
        if (!g_prismaUI || !g_view || !g_prismaUI->IsValid(g_view)) {
            return;
        }

        const auto script = "window." + functionName + "(" + json + ");";
        g_prismaUI->Invoke(g_view, script.c_str());
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

    void CloseSettings();
    void PushPetsState();
    void FirePetEvent(const char* event, const std::string& json);

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
                                         ",\"weekday\":" + JsonString(calendar->GetDayName()) +
                                         ",\"day\":" + std::to_string(day) +
                                         ",\"month\":" + JsonString(calendar->GetMonthName()) +
                                         ",\"year\":" + std::to_string(year) +
                                         ",\"hours\":" + std::to_string(calendar->GetHoursPassed()) + "}");
    }

    void OpenSettings()
    {
        bool expected = false;
        if (!g_settingsOpen.compare_exchange_strong(expected, true)) {
            return;
        }

        if (const auto* taskInterface = SKSE::GetTaskInterface()) {
            taskInterface->AddTask([]() {
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

        if (const auto* taskInterface = SKSE::GetTaskInterface()) {
            taskInterface->AddTask([]() {
                if (g_prismaUI && g_view && g_prismaUI->IsValid(g_view) && g_prismaUI->HasFocus(g_view)) {
                    g_prismaUI->Unfocus(g_view);
                }
            });
        }
    }

    // x|y|hotkey|pet|clock|clockStyle|scale|raisePet|feedKey|playKey|shape|hideKey, everything after pet is optional
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
            StorePetKey(g_feedKey, feedKey);
            StorePetKey(g_playKey, playKey);
            StorePetKey(g_hideKey, hideKey);
            g_settingsHotkey.store(hotkey);
            g_settingsHotkeyRequiresShift.store(requiresShift);
            WarnAboutDuplicateHotkeys();
            SaveSettings();
            PushPetsState();
            if (pet != previousPet) {
                FirePetEvent("companion", "{\"id\":" + JsonString(pet) + "}");
            }
        }
        catch (const std::exception& error) {
            logger::warn("MiniPets ignored settings update: {}", error.what());
        }
    }

    void StartCompanionStatePoller()
    {
        bool expected = false;
        if (!g_statePollerStarted.compare_exchange_strong(expected, true)) {
            return;
        }

        std::thread([]() {
            while (true) {
                std::this_thread::sleep_for(std::chrono::milliseconds(250));
                if (const auto* taskInterface = SKSE::GetTaskInterface()) {
                    taskInterface->AddTask([]() {
                        UpdateOverlayMenuVisibility();
                        UpdateCompanionState();
                        UpdateWorldMood();
                        UpdateClock();
                    });
                }
            }
        }).detach();
    }

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
                FirePetEvent("levelUp", json);
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

            if (const auto* taskInterface = SKSE::GetTaskInterface()) {
                taskInterface->AddTask([]() {
                    UpdateOverlayMenuVisibility();
                });
            }
            else {
                UpdateOverlayMenuVisibility();
            }
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

    // cheapest food in the player's pack, and how many food items there are
    RE::TESBoundObject* CheapestFood(int* count = nullptr)
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

    void SendPetState()
    {
        Invoke("dragonbornXP.petState", "{\"state\":" + JsonString(g_petState) + "}");
    }


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
    MINIPETS_API::MiniPetsApi1 g_miniPetsApi{};
    std::string g_pluginVersion;

    constexpr const char* kHubSettingsSchema = R"({"title":"MiniPets","settings":[
{"key":"raise_pet","label":"Raise a pet","type":"toggle","value":false,"note":"Start from an egg, feed it and play with it"},
{"key":"show_clock","label":"Show the clock","type":"toggle","value":false},
{"key":"clock_style","label":"Clock style","type":"choice","options":[{"value":"plate","label":"Plate"},{"value":"ribbon","label":"Ribbon"}],"value":"plate"},
{"key":"scale","label":"Card size","type":"range","min":50,"max":200,"step":10,"value":100,"unit":"%"},
{"key":"card_shape","label":"Card shape","type":"choice","options":[{"value":"square","label":"Square"},{"value":"wide","label":"Wide"}],"value":"square"},
{"key":"hidden","label":"Hide the card","type":"toggle","value":false,"note":"Shift+V toggles this in game"}]})";

    bool HasPet()
    {
        return g_settings.raisePet && !g_petState.empty() && g_petState.front() == '{';
    }

    bool PetIsEgg()
    {
        return g_petState.find("\"stage\":\"egg\"") != std::string::npos;
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

    // everything the tab (or another mod) needs; see MiniPets_API.h for the shape
    const std::string& StateJson()
    {
        const auto* calendar = RE::Calendar::GetSingleton();
        int food = 0;
        CheapestFood(&food);
        g_stateJson = "{\"companion\":" + JsonString(g_settings.pet) +
                      ",\"companions\":" + CompanionsJson() +
                      ",\"raisePet\":" + (g_settings.raisePet ? "true" : "false") +
                      ",\"pet\":" + (HasPet() ? g_petState : std::string("null")) +
                      ",\"hours\":" + std::to_string(calendar ? calendar->GetHoursPassed() : 0.0f) +
                      ",\"food\":" + std::to_string(food) +
                      ",\"card\":{\"x\":" + std::to_string(g_settings.positionX) +
                      ",\"y\":" + std::to_string(g_settings.positionY) +
                      ",\"scale\":" + std::to_string(g_settings.scale) +
                      ",\"shape\":" + JsonString(g_settings.cardShape) +
                      ",\"hidden\":" + (g_settings.petHidden ? "true" : "false") + "}" +
                      ",\"clock\":{\"enabled\":" + (g_settings.showClock ? "true" : "false") +
                      ",\"style\":" + JsonString(g_settings.clockStyle) + "}" +
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
        if (const auto* taskInterface = SKSE::GetTaskInterface()) {
            taskInterface->AddTask([]() {
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
        Invoke("dragonbornXP.applySettings", SettingsPayload());
        PushPetsState();
    }

    void SetPetHidden(bool hidden)
    {
        if (g_settings.petHidden == hidden) {
            return;
        }
        g_settings.petHidden = hidden;
        SaveSettings();
        Invoke("dragonbornXP.setHidden", hidden ? "true" : "false");
        PushPetsState();
        FirePetEvent("visible", std::string("{\"visible\":") + (hidden ? "false" : "true") + "}");
    }

    // nullptr = go ahead, else why the page would refuse anyway
    const char* PetActionBlocker(std::string_view action)
    {
        if (!HasPet()) {
            return "no pet";
        }
        if (action == "feed") {
            if (PetIsEgg()) {
                return "egg";
            }
            if (!CheapestFood()) {
                return "no food";
            }
        }
        return nullptr;
    }

    // the same route as the hotkeys, minus the "card on screen" check: DovahHub is open
    void SendPetAction(std::string_view action)
    {
        Invoke("dragonbornXP.petAction", "{\"action\":\"" + std::string(action) + "\"}");
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

    std::string HubSettingsJson()
    {
        return "{\"raise_pet\":" + std::string(g_settings.raisePet ? "true" : "false") +
               ",\"show_clock\":" + (g_settings.showClock ? "true" : "false") +
               ",\"clock_style\":" + JsonString(g_settings.clockStyle) +
               ",\"scale\":" + std::to_string(g_settings.scale) +
               ",\"card_shape\":" + JsonString(g_settings.cardShape) +
               ",\"hidden\":" + (g_settings.petHidden ? "true" : "false") + "}";
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
        else if (key == "hidden") {
            SetPetHidden(ParseFlag(value));
            return true;
        }
        else {
            return false;
        }
        SettingsChangedOutside();
        return true;
    }

    const char* OnHubRequest(const char* request, const char* json, void*)
    {
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
        (void)g_hub->AddSettings(g_hubModule, kHubSettingsSchema);
        logger::info("MiniPets: MiniPets tab registered with DovahHub {} on {}", g_hub->hostVersion, g_hub->host);
    }

    // the page told us how a feed/play went: on to the tab and to API listeners
    void OnPetActionResult(const std::string& result)
    {
        if (g_hub && g_hubModule && g_petsTabShown.load()) {
            (void)g_hub->PushJson(g_hubModule, ("{\"result\":" + result + "}").c_str());
        }
        FirePetEvent(JsonField(result, "action") == "feed" ? "fed" : "played", result);
    }

    void OnPetStateChanged(const std::string& state)
    {
        const bool hatched = PetIsEgg() && state.find("\"stage\":\"hatched\"") != std::string::npos;
        g_petState = state;
        PushPetsState();
        if (hatched) {
            FirePetEvent("hatched", "{\"species\":" + JsonString(JsonField(state, "species")) + "}");
        }
    }

    // ---- MiniPets_API.h ----

    const char* ApiGetStateJson()
    {
        return StateJson().c_str();
    }

    MINIPETS_API::Result ApiPetAction(std::string_view action)
    {
        if (!g_prismaUI || !g_view || !g_prismaUI->IsValid(g_view)) {
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

    MINIPETS_API::Result ApiSetRaisePet(bool enabled)
    {
        if (g_settings.raisePet != enabled) {
            g_settings.raisePet = enabled;
            SettingsChangedOutside();
        }
        return MINIPETS_API::Result::Ok;
    }

    MINIPETS_API::Result ApiSetVisible(bool visible)
    {
        SetPetHidden(!visible);
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
        return !g_overlayHiddenForMenus.load() && !g_settings.petHidden;
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

    void BuildMiniPetsApi()
    {
        const auto version = SKSE::PluginDeclaration::GetSingleton()->GetVersion();
        g_pluginVersion = version.string(".");
        g_miniPetsApi.apiVersion = MINIPETS_API::kApiVersion1;
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
    }

    SkillIncreaseSink g_skillSink;
    LevelIncreaseSink g_levelSink;
    DragonSoulSink g_soulSink;
    MenuStateSink g_menuSink;
    EquipSink g_equipSink;

    void RegisterGameEvents()
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
                    if (const auto* taskInterface = SKSE::GetTaskInterface(); taskInterface && !g_overlayHiddenForMenus.load()) {
                        taskInterface->AddTask([]() {
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
                    if (const auto* taskInterface = SKSE::GetTaskInterface()) {
                        taskInterface->AddTask([action]() {
                            Invoke("dragonbornXP.petAction", std::string("{\"action\":\"") + action + "\"}");
                        });
                    }
                }
            });
        }
    }

    void OnDataLoaded()
    {
        LoadSettings();
        StorePetKey(g_feedKey, g_settings.feedHotkeyName);
        StorePetKey(g_playKey, g_settings.playHotkeyName);
        StorePetKey(g_hideKey, g_settings.hideHotkeyName);
        g_prismaUI = PRISMA_UI_API::RequestPluginAPI<PRISMA_UI_API::IVPrismaUI1>();
        if (!g_prismaUI) {
            logger::critical("PrismaUI was not found. MiniPets will not display its overlay.");
            return;
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
                if (const auto* taskInterface = SKSE::GetTaskInterface()) {
                    taskInterface->AddTask([copy]() {
                        ApplySettings(copy);
                    });
                }
            });
            g_prismaUI->RegisterJSListener(view, "settingsClosed", [](const char*) {
                CloseSettings();
            });
            g_prismaUI->RegisterJSListener(view, "petStateChanged", [](const char* payload) {
                const std::string copy(payload ? payload : "");
                if (const auto* taskInterface = SKSE::GetTaskInterface()) {
                    taskInterface->AddTask([copy]() { OnPetStateChanged(copy); });
                }
            });
            g_prismaUI->RegisterJSListener(view, "petActionResult", [](const char* payload) {
                if (!payload || *payload != '{') {
                    return;
                }
                const std::string copy(payload);
                if (const auto* taskInterface = SKSE::GetTaskInterface()) {
                    taskInterface->AddTask([copy]() { OnPetActionResult(copy); });
                }
            });
            g_prismaUI->RegisterJSListener(view, "feedPet", [](const char*) {
                if (const auto* taskInterface = SKSE::GetTaskInterface()) {
                    taskInterface->AddTask([]() { FeedFromPack(); });
                }
            });
            // new page, resend everything
            g_lastWorldMood.clear();
            g_lastClockMinute = -1;
            Invoke("dragonbornXP.initialize", "{}");
            Invoke("dragonbornXP.applySettings", SettingsPayload());
            SendPetState();
        });
        // draw under other prisma views
        g_prismaUI->SetOrder(g_view, -100);

        RegisterGameEvents();
        RegisterPreviewKeys();
        StartCompanionStatePoller();
        logger::info("MiniPets initialized. Preview keys {}.", g_settings.debugPreviewKeys ? "enabled (F6 XP, F7 level-up)" : "disabled");
    }
}

constexpr std::uint32_t kPetRecord = 'PETS';

static void OnGameSaved(SKSE::SerializationInterface* serialization)
{
    if (!g_petState.empty()) {
        serialization->WriteRecord(kPetRecord, 1, g_petState.data(), static_cast<std::uint32_t>(g_petState.size()));
    }
}

static void OnGameLoaded(SKSE::SerializationInterface* serialization)
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
    }
}

static void OnRevert(SKSE::SerializationInterface*)
{
    g_petState.clear();
}

static void SKSEMessageHandler(SKSE::MessagingInterface::Message* message)
{
    if (!message) {
        return;
    }
    switch (message->type) {
    case SKSE::MessagingInterface::kPostPostLoad:
        BuildMiniPetsApi();
        RegisterWithDovahHub();
        break;
    case SKSE::MessagingInterface::kDataLoaded:
        OnDataLoaded();
        break;
    case SKSE::MessagingInterface::kPostLoadGame:
    case SKSE::MessagingInterface::kNewGame:
        // stay hidden until a game is loaded
        g_gameLoaded.store(true);
        SendPetState();
        PushPetsState();
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
    REX::W32::MessageBoxW(nullptr,
        L"MiniPets 1.8 replaced DragonbornXP.dll, but the old file is still installed.\n\n"
        L"Delete these from Skyrim's Data folder, then start the game again:\n"
        L"    SKSE\\Plugins\\DragonbornXP.dll\n"
        L"    PrismaUI\\views\\DragonbornXP\n\n"
        L"Your pet, settings and hotkeys are kept.",
        L"MiniPets", 0x00000030);  // MB_ICONWARNING
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
    WarnAboutLeftoverDll();

    // 'DBXP' is the co-save record from before the rename; every player's pet is stored under it
    if (auto* serialization = SKSE::GetSerializationInterface()) {
        serialization->SetUniqueID('DBXP');
        serialization->SetSaveCallback(OnGameSaved);
        serialization->SetLoadCallback(OnGameLoaded);
        serialization->SetRevertCallback(OnRevert);
    }
    return true;
}

extern "C" DLLEXPORT const void* MiniPets_RequestApi(std::uint32_t version)
{
    return version == MINIPETS_API::kApiVersion1 ? static_cast<const void*>(&g_miniPetsApi) : nullptr;
}
