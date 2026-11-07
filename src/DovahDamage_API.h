#pragma once
// DovahDamage_API.h - combat statistics from DovahDamage for other SKSE plugins. Header-only, no
// import library: DovahDamage.dll is reached by GetModuleHandle/GetProcAddress, so a mod that
// includes this still loads when DovahDamage is not installed (RequestApi returns nullptr).
//
// Served by DovahDamage 0.1.22 and later (API version 1). Same loader pattern, Result enum, size
// field and version rules as DovahMenu_API.h.
//
// What it counts: every health-damage hit DovahDamage sees (Actor::HandleHealthDamage), per actor
// (damage dealt and taken, hits, kills, the last hit's source) and the player's totals. Everything
// counts from the last save load or new game; nothing is written to the save yet.
//
//   #include "DovahDamage_API.h"
//
//   if (const auto* dmg = DOVAHDAMAGE_API::RequestApi()) {
//       DOVAHDAMAGE_API::Totals t{};
//       t.size = sizeof(t);
//       if (dmg->GetTotals(&t) == DOVAHDAMAGE_API::Result::Ok) { /* t.dealt, t.taken, t.biggestHit ... */ }
//       const char* json = dmg->GetActorsJson(20);   // game thread; valid until the next frame
//   }
//
// C++17. Depends only on <windows.h> (for the loader; define DOVAHDAMAGE_API_NO_LOADER to drop it)
// and the standard library. Include CommonLib (or your precompiled header) before this header.
//
// Threads: damage arrives on several worker threads. DovahDamage queues each hit under the lock it
// already uses for capture, and the overlay's per-frame update drains that queue on the game thread
// and updates the counters there. So every call below is game-thread only and reads without a lock;
// from a worker, queue through SKSE::GetTaskInterface() first. Calls made off the game thread return
// NotReady (GetActorsJson returns "[]"). A hit shows up in the counters on the frame after it lands.

#include <cstdint>

#ifndef DOVAHDAMAGE_API_NO_LOADER
#    ifndef WIN32_LEAN_AND_MEAN
#        define WIN32_LEAN_AND_MEAN
#    endif
#    ifndef NOMINMAX
#        define NOMINMAX
#    endif
#    include <windows.h>
#endif

namespace DOVAHDAMAGE_API
{
    inline constexpr std::uint32_t kApiVersion1 = 1;

    enum class Result : std::int32_t
    {
        Ok = 0,
        HostAbsent = 1,       // consumer-side only: RequestApi returned nullptr
        InvalidArgument = 2,  // nullptr out, size too small
        Duplicate = 3,        // unused in v1, kept so the numbering matches the suite
        InvalidId = 4,        // GetActor: DovahDamage hasn't seen that actor since the load
        NotReady = 5,         // called off the game thread
    };

    // The player's side since the load. Strings are valid until the next frame; copy them.
    struct Totals
    {
        std::uint32_t size;          // = sizeof(Totals); the host fills what fits
        double dealt;                // health damage the player dealt
        double taken;                // health damage the player took
        std::uint32_t hits;          // hits dealt
        std::uint32_t hitsTaken;
        std::uint32_t kills;         // the player's hit took the target to 0 health
        float biggestHit;            // largest single hit dealt
        const char* biggestHitTarget;  // that target's name, or ""
        const char* biggestHitSource;  // weapon or spell name, or "" when the hit couldn't be matched
    };

    // One actor since the load. Strings are valid until the next frame; copy them.
    struct ActorStats
    {
        std::uint32_t size;          // = sizeof(ActorStats)
        double dealt;                // damage this actor dealt to anyone
        double taken;                // damage this actor took from anyone
        std::uint32_t hitsDealt;
        std::uint32_t hitsTaken;
        std::uint32_t kills;
        bool killed;                 // a hit took this actor to 0 health (essential NPCs count when they go down)
        const char* name;
        const char* lastHitSource;   // weapon or spell of the last hit taken, or ""
        const char* lastHitBy;       // name of whoever landed it, or ""
        float secondsSinceLastHit;   // -1 when it has never been hit
    };

    struct DovahDamageApi1
    {
        std::uint32_t apiVersion;        // = kApiVersion1
        const char* hostVersion;         // "0.1.22"
        std::uint32_t hostVersionNumber; // MAJOR*10000 + MINOR*100 + PATCH

        Result (*GetTotals)(Totals* out);

        // refFormId is the actor reference's FormID (the player is 0x14).
        Result (*GetActor)(std::uint32_t refFormId, ActorStats* out);

        // Top `limit` actors by damage dealt plus taken (at most 256 are kept; the one seen longest ago
        // makes room). Valid until the next frame:
        //   [{"formId":"0x00000014","name":"Prisoner","dealt":1290.0,"taken":310.0,"hitsDealt":41,
        //     "hitsTaken":12,"kills":3,"killed":false,"lastHitSource":"Iron Sword","lastHitBy":"Bandit",
        //     "secondsSinceLastHit":4.2}]
        const char* (*GetActorsJson)(std::uint32_t limit);

        // Zero everything. Loading a save or starting a new game does the same.
        Result (*Reset)();
    };

    inline std::uint32_t PackVersion(std::uint32_t major, std::uint32_t minor, std::uint32_t patch)
    {
        return major * 10000 + minor * 100 + patch;
    }

#ifndef DOVAHDAMAGE_API_NO_LOADER
    // nullptr when DovahDamage is not installed or does not serve this version.
    inline const void* RequestApiRaw(std::uint32_t version)
    {
        const HMODULE mod = GetModuleHandleW(L"DovahDamage.dll");
        if (!mod) {
            return nullptr;
        }
        using RequestFn = const void* (*)(std::uint32_t);
        const auto request = reinterpret_cast<RequestFn>(GetProcAddress(mod, "DovahDamage_RequestApi"));
        return request ? request(version) : nullptr;
    }

    inline const DovahDamageApi1* RequestApi()
    {
        return static_cast<const DovahDamageApi1*>(RequestApiRaw(kApiVersion1));
    }
#endif
}
