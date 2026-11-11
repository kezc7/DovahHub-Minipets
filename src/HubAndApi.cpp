// DovahHub and the API (DMP-12): the MiniPets tab and its Settings rows in DovahHub, the state they read,
// and MiniPets_API.h for other mods (feed, play, companion, card, clock, listeners, React).
#include "Plugin.h"
#include "HubText.h"
#include "DovahMenu_API.h"

namespace MiniPets::Hub
{
    namespace
    {
        // DMN-31: MiniPets' entry in DovahMenu, so DovahMenu opens the settings directly instead of pressing Shift+B
        const DOVAHMENU_API::DovahMenuApi1* g_menu = nullptr;
        DOVAHMENU_API::EntryId g_menuEntry = 0;

        void OpenFromDovahMenu(void*)  // DovahMenu calls this on the game thread as it closes
        {
            Card::OpenSettingsFromDovahMenu();
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

    // DovahMenu's entry: the id is the PrismaUI view folder, so it replaces the one DovahMenu's scan finds
    // (view/dovahmenu.json stays, for its name and key). DovahMenu then calls MiniPets instead of pressing Shift+B.
    void RegisterWithDovahMenu()
    {
        g_menu = DOVAHMENU_API::RequestApi();
        if (!g_menu) {
            logger::info("MiniPets: DovahMenu not found, no DovahMenu entry");
            return;
        }
        DOVAHMENU_API::EntryDesc desc{};
        desc.size = sizeof(desc);
        desc.id = "MiniPets";
        desc.name = "MiniPets";
        desc.hotkey = g_settings.settingsHotkeyName.c_str();
        desc.framework = DOVAHMENU_API::Framework::PrismaUI;
        desc.onOpen = &OpenFromDovahMenu;
        desc.user = nullptr;
        const auto result = g_menu->Register(&desc, &g_menuEntry);
        logger::info("MiniPets: DovahMenu entry {}", result == DOVAHMENU_API::Result::Ok ? std::string("registered (opens MiniPets' settings directly)") :
                                                        "not registered (" + std::to_string(static_cast<int>(result)) + ")");
        if (result != DOVAHMENU_API::Result::Ok) {
            g_menu = nullptr;
            g_menuEntry = 0;
        }
    }

    // The settings key changed: DovahMenu's key picker (FindKeyOwner) should know.
    void UpdateDovahMenuHotkey()
    {
        if (g_menu && g_menuEntry) {
            (void)g_menu->SetHotkey(g_menuEntry, g_settings.settingsHotkeyName.c_str());
        }
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
