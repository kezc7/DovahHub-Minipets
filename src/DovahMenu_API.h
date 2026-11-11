#pragma once
// DovahMenu_API.h — the DovahMenu launcher API for SKSE plugins. Header-only, no import library:
// DovahMenu.dll is reached by GetModuleHandle/GetProcAddress, so a mod that includes this still
// loads when DovahMenu is not installed (RequestApi returns nullptr).
//
// DovahMenu: one key (or the pad combo) opens an alphabetical list of the UI mods it can open, and picking
// one opens that mod's own menu. Magelight mods with a manifest.json, and PrismaUI or Magelight mods with a
// dovahmenu.json key, appear on their own; registering through this API lists any mod and opens it through
// your own callback (the only way for a PrismaUI view, which only its own DLL can show). The list shows the
// name; DovahMenu 0.5.0 stopped showing descriptions, versions and frameworks, and the calls that set them
// still work and are ignored.
//
//   #include "DovahMenu_API.h"
//
//   static void OpenMyMenu(void*) { MyMod::OpenSettings(); }   // game thread; the hub has closed
//
//   // at SKSE kPostPostLoad or kDataLoaded (every plugin DLL is loaded by then):
//   if (const auto* menu = DOVAHMENU_API::RequestApi()) {
//       DOVAHMENU_API::EntryDesc d{};
//       d.size        = sizeof(d);
//       d.id          = "MyMod";                 // the PrismaUI view folder / Magelight modId
//       d.name        = "My Mod";
//       d.description = "Settings and the quest log";
//       d.version     = "1.2.0";
//       d.hotkey      = "F3";                    // display only; keep it current with SetHotkey
//       d.framework   = DOVAHMENU_API::Framework::PrismaUI;
//       d.onOpen      = &OpenMyMenu;
//       menu->Register(&d, &g_menuEntry);
//   }
//
// The Dovah suite rule (DMN-31): every suite mod with a DLL registers here, with a callback that opens its
// own window directly, as its own hotkey would. DovahMenu then never presses a key for it; pressing a mod's
// key (a dovahmenu.json "hotkey" or a [RelayKeys] line) is only for mods DovahMenu can't call, and it
// depends on timing, the game window's focus and the modifier keys held. DovahMenu.log lists, at the first
// load, every mod it still opens by a key press.
//   - Register with the id the scan would find (your PrismaUI view folder or Magelight modId), so your entry
//     replaces the scanned one. Keep the dovahmenu.json "hotkey": FindKeyOwner still uses it.
//   - The callback opens your own window. A mod whose only page is a DovahHub tab doesn't register: DovahHub's
//     own entry leads there.
//   - The callback runs as DovahMenu closes, and Magelight's focus menu can still be open for a few frames
//     (DMN-28). If your mod refuses to open while a menu is in front of the game, keep the request and open
//     as soon as that menu has gone (within about 2 s), rather than dropping it.
//   - DovahMenu checks that a window actually came up (a new menu, or a Magelight page taking UI mode) and
//     tells the player when nothing did (DMN-30), so open something the game can see as a menu, or focus your
//     PrismaUI view.
//
// C++17. Depends only on <windows.h> (for the loader; define DOVAHMENU_API_NO_LOADER to drop it)
// and the standard library. Include CommonLib (or your precompiled header) before this header.

#include <cstdint>

#ifndef DOVAHMENU_API_NO_LOADER
#    ifndef WIN32_LEAN_AND_MEAN
#        define WIN32_LEAN_AND_MEAN
#    endif
#    ifndef NOMINMAX
#        define NOMINMAX
#    endif
#    include <windows.h>
#endif

namespace DOVAHMENU_API
{
    inline constexpr std::uint32_t kApiVersion1 = 1;

    using EntryId = std::uint32_t;   // 0 = invalid

    enum class Result : std::int32_t
    {
        Ok = 0,
        HostAbsent = 1,       // consumer-side only: RequestApi returned nullptr
        InvalidArgument = 2,  // nullptr desc, missing id/onOpen, bad size, id not a slug
        Duplicate = 3,        // an entry with that id (case-insensitive) is already registered
        InvalidEntry = 4,     // unknown or unregistered EntryId
        NotReady = 5,         // Open/Close before the hub page exists (Magelight UI absent or not loaded yet), or Open at the main menu
        Busy = 6,             // Open while another mod holds Magelight's UI mode
    };

    // Which framework draws the mod's menu. Accepted and ignored since 0.5.0.
    enum class Framework : std::uint8_t
    {
        Other = 0,
        PrismaUI = 1,
        Magelight = 2,
    };

    // Called on the game thread after the hub has closed and released UI mode. Open your menu here
    // exactly as your own hotkey would.
    using OpenFn = void (*)(void* user);

    struct EntryDesc
    {
        std::uint32_t size;       // = sizeof(EntryDesc) — forward-compat
        const char* id;           // slug [A-Za-z0-9_.-], 1..64 chars. Use your PrismaUI view folder name or
                                  // Magelight modId: the entry then replaces the one the scan found, instead of
                                  // appearing twice.
        const char* name;         // display name; nullptr = id
        const char* description;  // optional; ignored since 0.5.0
        const char* version;      // optional; ignored since 0.5.0
        const char* hotkey;       // the key that opens your menu ("F3", "N", "Ctrl+M"), for FindKeyOwner; optional
        Framework framework;
        OpenFn onOpen;            // required
        void* user;               // handed back to onOpen
    };

    struct DovahMenuApi1
    {
        std::uint32_t apiVersion;        // = kApiVersion1
        const char* hostVersion;         // "0.1.0"
        std::uint32_t hostVersionNumber; // MAJOR*10000 + MINOR*100 + PATCH

        // Strings are copied; the desc need not outlive the call. Idempotent per id: registering the
        // same id again returns Duplicate and leaves the first entry.
        Result (*Register)(const EntryDesc* desc, EntryId* outEntry);
        Result (*Unregister)(EntryId entry);
        // A disabled entry is left out of the list until enabled again: e.g. your menu needs a loaded save.
        Result (*SetEnabled)(EntryId entry, bool enabled);
        // Update your hotkey when the player rebinds it (FindKeyOwner uses it).
        Result (*SetHotkey)(EntryId entry, const char* hotkey);
        // Update the name (nullptr = keep). The description and version are ignored since 0.5.0.
        Result (*SetText)(EntryId entry, const char* name, const char* description, const char* version);

        bool (*IsOpen)();
        // Open the hub as its hotkey would, and close it. Call from the game thread to get the real
        // result; from another thread the request is queued to the game thread and answers Ok.
        Result (*Open)();
        Result (*Close)();

        // ---- appended in 0.2.3: gate on hostVersionNumber >= 203 ------------------------------------
        // Suite key awareness, so two mods never claim the same key. Game thread.
        //
        // Who opens with this key ("F3", "N", "Shift+N", "Ctrl+Alt+M", or a scancode number): "DovahMenu"
        // for the hub's own key, the id of the listed entry that opens with it (a registered hotkey, a
        // manifest or dovahmenu.json hotkey, or a relay key), or "" when nobody listed claims it, or for
        // text that is not a key. Left and right Shift/Ctrl/Alt count as one; N and Shift+N differ. It
        // rescans, so call it when the player picks a key, not every frame. The string lives until the
        // next call on the same thread.
        const char* (*FindKeyOwner)(const char* chord);
        // The hub's own key as a key name ("Home"). The string lives until the next call on the same thread.
        const char* (*GetHotkey)();
    };

    inline std::uint32_t PackVersion(std::uint32_t major, std::uint32_t minor, std::uint32_t patch)
    {
        return major * 10000 + minor * 100 + patch;
    }

#ifndef DOVAHMENU_API_NO_LOADER
    // nullptr when DovahMenu is not installed or does not serve this version.
    inline const void* RequestApiRaw(std::uint32_t version)
    {
        const HMODULE mod = GetModuleHandleW(L"DovahMenu.dll");
        if (!mod) {
            return nullptr;
        }
        using RequestFn = const void* (*)(std::uint32_t);
        const auto request = reinterpret_cast<RequestFn>(GetProcAddress(mod, "DovahMenu_RequestApi"));
        return request ? request(version) : nullptr;
    }

    inline const DovahMenuApi1* RequestApi()
    {
        return static_cast<const DovahMenuApi1*>(RequestApiRaw(kApiVersion1));
    }
#endif
}
