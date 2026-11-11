// The card bridge (DMP-12): the HUD page (Prisma UI view) and everything sent to it or read from it: the
// overlay's visibility over menus, the companion's pose, the world mood and clock, the settings window,
// the hotkeys, and the game events the card shows (skills, levels, souls, food).
#include "Plugin.h"
#include "keyhandler.h"

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
        // DovahMenu asked for settings while the overlay was hidden for a menu that is closing: open them as
        // soon as the overlay is shown again, if that's within 2 s (steady-clock ms; 0 = nothing waiting).
        std::atomic<std::int64_t> g_openSettingsWhenShownUntil = 0;
        constexpr std::int64_t kDovahMenuWaitMs = 2000;

        std::int64_t SteadyMs()
        {
            return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
        }
        std::string g_lastCompanionState;
        std::string g_lastWorldMood;
        // DMP-13: the place the pet last noticed ("" after a load: the place a load starts in says nothing)
        std::string g_lastPlace;
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
                Hub::UpdateDovahMenuHotkey();
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

        // DMN-31: the settings DovahMenu asked for while a closing menu still hid the overlay
        if (changed && !shouldHide) {
            if (const auto until = g_openSettingsWhenShownUntil.exchange(0); until != 0) {
                if (SteadyMs() <= until) {
                    logger::info("MiniPets: overlay shown; opening the settings DovahMenu asked for");
                    OpenSettings();
                }
                else {
                    logger::info("MiniPets: the settings DovahMenu asked for were dropped: the overlay stayed hidden over 2 s");
                }
            }
        }
    }

    // DMN-31: DovahMenu's entry (game thread, as DovahMenu closes). Opens now, or once the overlay is shown again.
    void OpenSettingsFromDovahMenu()
    {
        if (!g_overlayHiddenForMenus.load()) {
            logger::info("MiniPets: settings opened from DovahMenu");
            OpenSettings();
            return;
        }
        g_openSettingsWhenShownUntil.store(SteadyMs() + kDovahMenuWaitMs);
        logger::info("MiniPets: settings asked for by DovahMenu while the overlay is hidden; opening once it's shown");
    }

    // DMP-13: the player's own house, and the place as the game names it
    void UpdatePlace(std::string_view region)
    {
        const auto* player = RE::PlayerCharacter::GetSingleton();
        if (!player) {
            return;
        }
        const auto* location = player->GetCurrentLocation();
        const bool home = location && location->HasKeywordString("LocTypePlayerHouse");
        const auto* cell = player->GetParentCell();
        const char* name = nullptr;
        if (cell && cell->IsInteriorCell()) {
            name = location ? location->GetName() : nullptr;
        }
        else if (const auto* worldspace = player->GetWorldspace()) {
            name = worldspace->GetName();
        }
        const std::string place = home ? std::string("home|") + (name ? name : "") : std::string(region);
        if (place == g_lastPlace) {
            return;
        }
        const bool first = g_lastPlace.empty();
        g_lastPlace = place;
        if (!first) {
            ReactionWiring::OnPlaceChanged(region, home, name ? name : "");
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
        UpdatePlace(region);
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
        g_lastPlace.clear();
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
