#include "PrismaUI_API.h"
#include "keyhandler.h"

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
#include <vector>

PRISMA_UI_API::IVPrismaUI1* g_prismaUI = nullptr;
PrismaView g_view = 0;

namespace
{
    constexpr std::uint32_t kDefaultSettingsHotkey = 0x30;  // B
    constexpr bool kDefaultSettingsHotkeyRequiresShift = true;
    const std::filesystem::path kSettingsPath = L"Data/SKSE/Plugins/DragonbornXP.ini";

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
        return value < 50 ? 50 : value > 150 ? 150 : value;
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

    bool IsSupportedPet(std::string_view pet)
    {
        return pet == "dovahmin" || pet == "dovahpink" || pet == "mudcrab" || pet == "skeever" ||
               pet == "fox" || pet == "sabrecat" || pet == "frostbite-spider" || pet == "horker" ||
               pet == "troll" || pet == "flame-atronach" || pet == "frost-atronach" || pet == "spriggan" ||
               pet == "dwarven-spider" || pet == "chaurus" || pet == "netch" || pet == "mammoth" ||
               pet == "dragon-priest" || pet == "wisp" || pet == "death-hound" || pet == "chicken";
    }

    constexpr std::array<std::string_view, 37> kBlockingMenus{
        "Main Menu", "Loading Menu", "LoadWaitSpinner", "Fader Menu", "SystemMenu", "TweenMenu",
        "InventoryMenu", "MagicMenu", "MapMenu", "ContainerMenu", "Journal Menu", "LevelUpMenu",
        "StatsMenu", "SleepWaitMenu", "FavoritesMenu", "BarterMenu", "CraftingMenu", "Crafting Menu",
        "SmithingMenu", "Smithing Menu", "AlchemyMenu", "Alchemy Menu", "EnchantingMenu", "Enchanting Menu",
        "CookingMenu", "Cooking Menu", "PhotoMenu", "Console", "RaceSex Menu", "Book Menu",
        "Lockpicking Menu", "Training Menu", "GiftMenu", "Tutorial Menu", "Credits Menu", "Mod Manager Menu",
        "CustomMenu"
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
    bool IsModMenuOpen()
    {
        auto* ui = RE::UI::GetSingleton();
        if (!ui) {
            return false;
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
                return true;
            }
        }
        return false;
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

    void StorePetKey(PetKey& key, const std::string& name)
    {
        bool shift = false;
        key.scan.store(ParseHotkey(name, &shift));
        key.shift.store(shift);
    }

    void LoadSettings()
    {
        try {
            if (!std::filesystem::exists(kSettingsPath)) {
                return;
            }

            std::ifstream input(kSettingsPath);
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
                    logger::warn("DragonbornXP ignored invalid setting '{}'", key);
                }
            }
            g_settingsHotkey.store(g_settings.settingsHotkey);
            g_settingsHotkeyRequiresShift.store(g_settings.settingsHotkeyRequiresShift);
        }
        catch (const std::exception& error) {
            logger::warn("DragonbornXP settings could not be loaded: {}", error.what());
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
            logger::warn("DragonbornXP settings could not be saved: {}", error.what());
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
            if (IsModMenuOpen()) {
                return "a mod menu is open";
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
            logger::info("DragonbornXP overlay {}", shouldHide ? std::string("hidden: ") + reason : std::string("shown"));
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
            SaveSettings();
        }
        catch (const std::exception& error) {
            logger::warn("DragonbornXP ignored settings update: {}", error.what());
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
                Invoke("dragonbornXP.levelUp", "{\"level\":" + std::to_string(event->newLevel) + "}");
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

    // Feed button: uses the cheapest food in the player's inventory.
    void FeedFromPack()
    {
        auto* player = RE::PlayerCharacter::GetSingleton();
        if (!player) {
            return;
        }
        auto inventory = player->GetInventory([](RE::TESBoundObject& object) {
            const auto* alchemy = object.As<RE::AlchemyItem>();
            return alchemy && alchemy->IsFood();
        });
        RE::TESBoundObject* cheapest = nullptr;
        auto cheapestValue = (std::numeric_limits<std::int32_t>::max)();
        for (const auto& [object, entry] : inventory) {
            if (entry.first > 0 && object->GetGoldValue() < cheapestValue) {
                cheapest = object;
                cheapestValue = object->GetGoldValue();
            }
        }
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
                    logger::info("DragonbornXP settings hotkey pressed: {}", g_settings.settingsHotkeyName);
                    OpenSettings();
                    return;
                }
                if (scanCode == g_hideKey.scan.load() && shiftDown == g_hideKey.shift.load()) {
                    if (const auto* taskInterface = SKSE::GetTaskInterface(); taskInterface && !g_overlayHiddenForMenus.load()) {
                        taskInterface->AddTask([]() {
                            g_settings.petHidden = !g_settings.petHidden;
                            SaveSettings();
                            Invoke("dragonbornXP.setHidden", g_settings.petHidden ? "true" : "false");
                        });
                    }
                    return;
                }
                // feed/play only while playing (not in menus) and with raise-a-pet on
                if (!g_settings.raisePet || g_overlayHiddenForMenus.load()) {
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
            logger::critical("PrismaUI was not found. DragonbornXP will not display its overlay.");
            return;
        }

        g_view = g_prismaUI->CreateView("DragonbornXP/index.html", [](PrismaView view) {
            logger::info("DragonbornXP Prisma UI view ready: {}", view);
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
                    taskInterface->AddTask([copy]() { g_petState = copy; });
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
        logger::info("DragonbornXP initialized. Preview keys {}.", g_settings.debugPreviewKeys ? "enabled (F6 XP, F7 level-up)" : "disabled");
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
    case SKSE::MessagingInterface::kDataLoaded:
        OnDataLoaded();
        break;
    case SKSE::MessagingInterface::kPostLoadGame:
    case SKSE::MessagingInterface::kNewGame:
        // stay hidden until a game is loaded
        g_gameLoaded.store(true);
        SendPetState();
        break;
    default:
        break;
    }
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

    if (auto* serialization = SKSE::GetSerializationInterface()) {
        serialization->SetUniqueID('DBXP');
        serialization->SetSaveCallback(OnGameSaved);
        serialization->SetLoadCallback(OnGameLoaded);
        serialization->SetRevertCallback(OnRevert);
    }
    return true;
}
