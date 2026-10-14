#include "PrismaUI_API.h"
#include "keyhandler.h"

#include <RE/A/ActorValueList.h>
#include <RE/C/Calendar.h>
#include <RE/D/DragonSoulsGained.h>
#include <RE/L/LevelIncrease.h>
#include <RE/M/MenuOpenCloseEvent.h>
#include <RE/S/SkillIncrease.h>
#include <RE/S/Sky.h>
#include <RE/U/UI.h>

#include <atomic>
#include <chrono>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <string>
#include <string_view>
#include <thread>
#include <unordered_set>

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
    };

    std::atomic_bool g_statePollerStarted = false;
    std::atomic_bool g_settingsOpen = false;
    std::atomic_uint32_t g_settingsHotkey = kDefaultSettingsHotkey;
    std::atomic_bool g_settingsHotkeyRequiresShift = kDefaultSettingsHotkeyRequiresShift;
    std::atomic_bool g_shiftDown = false;
    std::atomic_bool g_overlayHiddenForMenus = true;
    std::unordered_set<std::string> g_openBlockingMenus;
    DragonbornSettings g_settings;
    std::string g_lastCompanionState;
    std::string g_lastWorldMood;

    bool IsSupportedPet(std::string_view pet)
    {
        return pet == "dovahmin" || pet == "dovahpink" || pet == "mudcrab" || pet == "skeever" ||
               pet == "fox" || pet == "sabrecat" || pet == "frostbite-spider" || pet == "horker" ||
               pet == "troll" || pet == "flame-atronach" || pet == "frost-atronach" || pet == "spriggan" ||
               pet == "dwarven-spider" || pet == "chaurus" || pet == "netch" || pet == "mammoth" ||
               pet == "dragon-priest" || pet == "wisp" || pet == "death-hound" || pet == "chicken";
    }

    bool IsBlockingMenu(std::string_view name)
    {
        return name == "Main Menu" || name == "Loading Menu" || name == "LoadWaitSpinner" || name == "Fader Menu" ||
               name == "SystemMenu" || name == "TweenMenu" || name == "InventoryMenu" || name == "MagicMenu" ||
               name == "MapMenu" || name == "ContainerMenu" || name == "Journal Menu" || name == "LevelUpMenu" ||
               name == "StatsMenu" || name == "SleepWaitMenu" || name == "FavoritesMenu" || name == "BarterMenu" ||
               name == "CraftingMenu" || name == "Crafting Menu" || name == "SmithingMenu" || name == "Smithing Menu" ||
               name == "AlchemyMenu" || name == "Alchemy Menu" || name == "EnchantingMenu" || name == "Enchanting Menu" ||
               name == "CookingMenu" || name == "Cooking Menu" || name == "PhotoMenu" || name == "Console" ||
               name == "RaceSex Menu" || name == "Book Menu" || name == "Lockpicking Menu" || name == "Training Menu" ||
               name == "GiftMenu" || name == "Tutorial Menu" || name == "Credits Menu" || name == "Mod Manager Menu";
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

                const auto key = line.substr(0, separator);
                const auto value = line.substr(separator + 1);
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
                   << "pet=" << g_settings.pet << '\n';
        }
        catch (const std::exception& error) {
            logger::warn("DragonbornXP settings could not be saved: {}", error.what());
        }
    }

    std::string SettingsPayload()
    {
        return "{\"x\":" + std::to_string(g_settings.positionX) +
               ",\"y\":" + std::to_string(g_settings.positionY) +
               ",\"hotkey\":\"" + g_settings.settingsHotkeyName +
               "\",\"pet\":\"" + g_settings.pet + "\"}";
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
        Invoke("dragonbornXP.skillGain", "{\"skill\":\"" + std::string(skill) + "\"}");
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

    void UpdateOverlayMenuVisibility()
    {
        if (!g_prismaUI || !g_view || !g_prismaUI->IsValid(g_view)) {
            return;
        }

        const auto* player = RE::PlayerCharacter::GetSingleton();
        const bool menuOpen = !g_openBlockingMenus.empty() || !player || !player->Is3DLoaded();
        const bool alreadyHidden = g_overlayHiddenForMenus.load();
        if (menuOpen == alreadyHidden) {
            return;
        }

        if (menuOpen) {
            g_prismaUI->Hide(g_view);
            g_overlayHiddenForMenus.store(true);
            logger::debug("DragonbornXP overlay hidden while a Skyrim menu is open");
        }
        else {
            g_prismaUI->Show(g_view);
            g_overlayHiddenForMenus.store(false);
            logger::debug("DragonbornXP overlay shown after Skyrim menus closed");
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

    void UpdateWorldMood()
    {
        const auto* calendar = RE::Calendar::GetSingleton();
        const auto* sky = RE::Sky::GetSingleton();
        const auto timeOfDay = GetTimeOfDay(calendar ? calendar->GetHour() : 12.0f);
        const auto weather = GetWeatherMood(sky);
        const std::string mood = std::string(timeOfDay) + "|" + weather;

        if (mood == g_lastWorldMood) {
            return;
        }

        g_lastWorldMood = mood;
        Invoke("dragonbornXP.worldMood", "{\"time\":\"" + std::string(timeOfDay) + "\",\"weather\":\"" + weather + "\"}");
    }

    void OpenSettings()
    {
        bool expected = false;
        if (!g_settingsOpen.compare_exchange_strong(expected, true)) {
            return;
        }

        if (const auto* taskInterface = SKSE::GetTaskInterface()) {
            taskInterface->AddTask([]() {
                if (!g_prismaUI || !g_view || !g_prismaUI->IsValid(g_view)) {
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

    void ApplySettings(std::string_view payload)
    {
        const auto firstSeparator = payload.find('|');
        const auto secondSeparator = payload.find('|', firstSeparator == std::string_view::npos ? 0 : firstSeparator + 1);
        const auto thirdSeparator = payload.find('|', secondSeparator == std::string_view::npos ? 0 : secondSeparator + 1);
        if (firstSeparator == std::string_view::npos || secondSeparator == std::string_view::npos || thirdSeparator == std::string_view::npos) {
            return;
        }

        try {
            const auto x = std::stoi(std::string(payload.substr(0, firstSeparator)));
            const auto y = std::stoi(std::string(payload.substr(firstSeparator + 1, secondSeparator - firstSeparator - 1)));
            const auto hotkeyName = std::string(payload.substr(secondSeparator + 1, thirdSeparator - secondSeparator - 1));
            const auto pet = std::string(payload.substr(thirdSeparator + 1));
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
                Invoke("dragonbornXP.dragonSoul", "{\"amount\":" + std::to_string(event->souls) + "}");
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

            const std::string menuName = event->menuName.c_str();
            if (!IsBlockingMenu(menuName)) {
                return RE::BSEventNotifyControl::kContinue;
            }

            if (event->opening) {
                g_openBlockingMenus.insert(menuName);
            }
            else {
                g_openBlockingMenus.erase(menuName);
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

    SkillIncreaseSink g_skillSink;
    LevelIncreaseSink g_levelSink;
    DragonSoulSink g_soulSink;
    MenuStateSink g_menuSink;

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
    }

    void RegisterPreviewKeys()
    {
        KeyHandler::RegisterSink();
        auto* keyHandler = KeyHandler::GetSingleton();

        // F6 previews a skill XP gain; F7 previews a level-up.
        (void)keyHandler->Register(0x40, KeyEventType::KEY_DOWN, []() {
            ShowSkillGain(RE::ActorValue::kDestruction);
        });
        (void)keyHandler->Register(0x41, KeyEventType::KEY_DOWN, []() {
            Invoke("dragonbornXP.levelUp", "{\"level\":42}");
        });

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

        // Register the keyboard range once so the settings hotkey can be rebound
        // from Prisma UI without rebuilding or re-registering the input sink.
        for (std::uint32_t scanCode = 1; scanCode < 0x80; ++scanCode) {
            (void)keyHandler->Register(scanCode, KeyEventType::KEY_DOWN, [scanCode]() {
                const bool shiftDown = g_shiftDown.load() || (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
                if (scanCode != g_settingsHotkey.load() || g_settingsOpen.load() ||
                    shiftDown != g_settingsHotkeyRequiresShift.load()) {
                    return;
                }
                logger::info("DragonbornXP settings hotkey pressed: {}", g_settings.settingsHotkeyName);
                OpenSettings();
            });
        }
    }

    void OnDataLoaded()
    {
        LoadSettings();
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
            Invoke("dragonbornXP.initialize", "{}");
            Invoke("dragonbornXP.applySettings", SettingsPayload());
        });
        g_prismaUI->SetOrder(g_view, 100);

        RegisterGameEvents();
        RegisterPreviewKeys();
        StartCompanionStatePoller();
        logger::info("DragonbornXP initialized. F6 previews XP; F7 previews a level-up.");
    }
}

static void SKSEMessageHandler(SKSE::MessagingInterface::Message* message)
{
    if (message && message->type == SKSE::MessagingInterface::kDataLoaded) {
        OnDataLoaded();
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
    return true;
}
