#pragma once
// MiniPets_API.h — the DovahHub MiniPets API for SKSE plugins. Header-only, no import library:
// the MiniPets DLL is reached by GetModuleHandle/GetProcAddress, so a mod that includes this still
// loads when MiniPets is not installed (RequestApi returns nullptr).
//
// Same loader pattern, Result enum, size field and version rules as DovahMenu_API.h.
//
// MiniPets is the HUD pixel-art companion (20 companions, raise-a-pet mode with an egg that hatches
// on XP, then hunger and happiness). Its DLL is MiniPets.dll and its INI Data/SKSE/Plugins/MiniPets.ini;
// before 1.8.0 both were named DragonbornXP.
//
// What this API is for:
// - DovahHub's "MiniPets" tab (Integrations group): the gallery, the current companion, the raise-a-pet
//   state, Feed and Play, and MiniPets' options on DovahHub's Settings tab. MiniPets ships
//   modules/pets/ for it (so DovahHub never carries the sprites) and talks to the tab through
//   DovahHub_API.h; this header is what the module's onRequest calls, and what any other mod may call.
// - DovahStable later borrows the bonding and growth model ("creature care" core), so GetState's
//   JSON shape is kept stable and documented here.
//
//   #include "MiniPets_API.h"
//
//   if (const auto* pets = MINIPETS_API::RequestApi()) {
//       pets->Feed();                                   // game thread; Ok once queued, NoPet, or Refused ("egg", no food)
//       const char* json = pets->GetStateJson();        // game thread; valid until the next call
//   }
//
// C++17. Depends only on <windows.h> (for the loader; define MINIPETS_API_NO_LOADER to drop it)
// and the standard library. Include CommonLib (or your precompiled header) before this header.

#include <cstdint>

#ifndef MINIPETS_API_NO_LOADER
#    ifndef WIN32_LEAN_AND_MEAN
#        define WIN32_LEAN_AND_MEAN
#    endif
#    ifndef NOMINMAX
#        define NOMINMAX
#    endif
#    include <windows.h>
#endif

namespace MINIPETS_API
{
    inline constexpr std::uint32_t kApiVersion1 = 1;
    // 1.9.0: React. A version-2 table starts with the whole version-1 table, so RequestApi() still works
    inline constexpr std::uint32_t kApiVersion2 = 2;

    using ListenerId = std::uint32_t;   // 0 = invalid

    enum class Result : std::int32_t
    {
        Ok = 0,
        HostAbsent = 1,       // consumer-side only: RequestApi returned nullptr
        InvalidArgument = 2,  // unknown companion id, bad size, value out of range, nullptr
        Duplicate = 3,        // (unused in v1; kept so the numbering matches the suite)
        InvalidId = 4,        // unknown or unregistered ListenerId
        NotReady = 5,         // the view is not created yet, or no save is loaded (pet state is per character)
        NoPet = 6,            // raise-a-pet mode is off, or there is no egg yet
        Refused = 7,          // Feed an egg, Feed with no food in the pack
    };

    // Pushed events, on the game thread. json is a plain copy valid during the call:
    //   "hatched"   {"species":"fox"}
    //   "fed"       {"action":"feed","ok":true,"food":"Sweet Roll"}     ok false carries "reason": "full", "egg", "no food", "no pet"
    //   "played"    {"action":"play","ok":true}                          ok false: "tired" (2-hour cooldown), "no pet"; "reason":"egg" with ok true = a cuddle
    //   "levelUp"   {"level":12}            the popup MiniPets showed, for a mirror on another page
    //   "companion" {"id":"mudcrab"}        the companion changed (settings, or SetCompanion)
    //   "visible"   {"visible":false}       Shift+V, SetVisible or the "hidden" setting
    //   "reaction"  {"source":"dovahstable","mood":"cheer","shown":true}     from 1.9.0: what became of a
    //               reaction (React, or MiniPets' own); shown false carries "reason": "off", "hidden",
    //               "cooldown" or "busy"
    using EventFn = void (*)(const char* event, const char* json, void* user);

    struct ListenerDesc
    {
        std::uint32_t size;       // = sizeof(ListenerDesc) — forward-compat
        EventFn onEvent;          // required
        void* user;
    };

    struct MiniPetsApi1
    {
        std::uint32_t apiVersion;        // = kApiVersion1
        const char* hostVersion;         // "1.7.0"
        std::uint32_t hostVersionNumber; // MAJOR*10000 + MINOR*100 + PATCH

        // Game thread. Everything a Pets page needs, as JSON. The pointer is valid until the next call on
        // the game thread; copy it. Shape (kept stable for DovahStable's future creature-care core):
        //   {"companion":"fox","companions":[{"id":"dovahmin","name":"Dovahmin"},...20],
        //    "raisePet":true,
        //    "pet":{"species":"fox","stage":"egg"|"hatched","laidAt":120.5,"warmth":7.5,"hatchedAt":null,
        //           "hunger":64,"happiness":80,"lastTick":130.2,"lastPlay":null},  // or null
        //           from 1.9.0 also "careDay":5,"careCount":2 once a shared moment counted as care (the setting)
        //    "hours":130.2,                 in-game hours passed (Calendar), the clock the pet runs on
        //    "food":3,                      food items in the player's pack
        //    "card":{"x":12,"y":88,"scale":100,"shape":"square"|"wide","hidden":false},   x,y -1 = default spot
        //    "clock":{"enabled":true,"style":"plate"|"ribbon"},
        //    "hotkeys":{"settings":"Shift+B","feed":"Shift+N","play":"Shift+K","hide":"Shift+V"}}
        // "pet" is the saved pet-life record as the HUD page keeps it (view/pet-life.js); the rules that
        // turn it into a mood, a growth stage or "can play" live there (PetLife.tick/mood/growth), so a page
        // showing it loads pet-life.js and ticks it for display with "hours". Times are in-game hours.
        const char* (*GetStateJson)();

        // Game thread. The same as the Shift+N / Shift+K hotkeys: the pet-life rules in the HUD page decide,
        // and the outcome arrives in the next "fed"/"played" event. Ok once queued; NoPet when raise-a-pet
        // is off or there is no egg; Refused for what is known up front (feeding an egg, no food in the pack).
        Result (*Feed)();
        Result (*Play)();

        // Game thread. Choose a companion by id ("fox", "mudcrab", ... as in GetStateJson.companions).
        // Written to the INI like the settings page does. In raise-a-pet mode the card shows the raised pet
        // instead; the companion is what the card shows when that mode is off.
        Result (*SetCompanion)(const char* id);
        // Game thread. Turn raise-a-pet mode on (the card then offers the egg picker if there is no egg) or
        // off (the pet is kept in the co-save, hidden).
        Result (*SetRaisePet)(bool enabled);
        // Game thread. Show or hide the HUD card, as Shift+V does. Persists to the INI.
        Result (*SetVisible)(bool visible);
        // Game thread. Card layout, as the settings sliders: x,y in pixels (-1 = keep), scale 50..200
        // (0 = keep), shape "square" | "wide" | nullptr. Persists to the INI.
        Result (*SetCard)(std::int32_t x, std::int32_t y, std::int32_t scale, const char* shape);
        // Game thread. clock on/off and style ("plate" | "ribbon" | nullptr = keep).
        Result (*SetClock)(bool enabled, const char* style);

        // Any thread. True while the card is on screen (not hidden by a menu, loading screen or Shift+V).
        bool (*IsVisible)();

        // Game thread, at kPostPostLoad or kDataLoaded. Events arrive on the game thread.
        Result (*AddListener)(const ListenerDesc* desc, ListenerId* outListener);
        Result (*RemoveListener)(ListenerId listener);
    };

    // Version 2 (MiniPets 1.9.0): everything in version 1, then React.
    struct MiniPetsApi2 : MiniPetsApi1
    {
        // ANY thread. Make the pet react to something your mod noticed. The JSON is copied and queued; a
        // main-thread pass a moment later decides whether the card shows it, so Ok means "queued", and the
        // listener's "reaction" event says what happened:
        //   {"source":"dovahstable",        required: your mod, a slug [a-z0-9_-], at most 32 chars
        //    "mood":"cheer",               required: "cheer" | "wave" | "sad" | "cower" | "sleep" | "curious"
        //    "caption":"Ember was born!",  optional: one line under the pet, at most 120 bytes of UTF-8;
        //                                  MiniPets draws it (sprites and icons carry no text). Write it in
        //                                  the player's language (DovahHub's GetLanguage) or leave it out
        //    "ms":2500,                    optional: 800..6000, default 2500
        //    "priority":1}                 optional: 0 = dropped if anything else is showing, 1 = normal
        //                                  (the default), 2 = interrupts a playing reaction (a death, a birth)
        // Dropped (not an error) while the card is hidden (menus, loading, Shift+V), while the player has
        // "React to other mods" off, or within the cooldown of the last reaction (one cooldown for every
        // source, 8 s by default, the player's setting; priority 2 is exempt). InvalidArgument: nullptr, not
        // JSON, no or bad source, an unknown mood. NotReady: the card's view does not exist yet.
        Result (*React)(const char* reactionJson);
    };

    inline std::uint32_t PackVersion(std::uint32_t major, std::uint32_t minor, std::uint32_t patch)
    {
        return major * 10000 + minor * 100 + patch;
    }

#ifndef MINIPETS_API_NO_LOADER
    // nullptr when MiniPets is not installed or does not serve this version. The DLL is MiniPets.dll
    // from 1.8.0 (xmake.lua: PLUGIN_NAME); DragonbornXP.dll is still tried so a mod built against this
    // header also finds 1.7.x.
    inline const void* RequestApiRaw(std::uint32_t version)
    {
        HMODULE mod = GetModuleHandleW(L"MiniPets.dll");
        if (!mod) {
            mod = GetModuleHandleW(L"DragonbornXP.dll");
        }
        if (!mod) {
            return nullptr;
        }
        using RequestFn = const void* (*)(std::uint32_t);
        const auto request = reinterpret_cast<RequestFn>(GetProcAddress(mod, "MiniPets_RequestApi"));
        return request ? request(version) : nullptr;
    }

    inline const MiniPetsApi1* RequestApi()
    {
        return static_cast<const MiniPetsApi1*>(RequestApiRaw(kApiVersion1));
    }

    // nullptr before MiniPets 1.9.0 (then RequestApi() still serves version 1)
    inline const MiniPetsApi2* RequestApi2()
    {
        return static_cast<const MiniPetsApi2*>(RequestApiRaw(kApiVersion2));
    }
#endif
}

// ---- Threading notes --------------------------------------------------------------------------
//
// MiniPets' pet-life rules run in the HUD page (view/pet-life.js), with the state mirrored to the
// DLL as a JSON string kept in the co-save. Feed/Play queue the page call and return Ok; the next
// "fed"/"played" event carries the outcome. GetStateJson returns the last mirrored state.
//
// React (version 2) is the one call that may come from any thread: it copies the JSON into a small
// locked queue (16 deep; the oldest goes when it is full), and MiniPets' 250 ms main-thread pass drains
// it, applies the cooldown and priority, and calls the page.
//
//   if (const auto* pets = MINIPETS_API::RequestApi2()) {
//       pets->React(R"({"source":"dovahstable","mood":"wave","caption":"Frost is home."})");
//   }
