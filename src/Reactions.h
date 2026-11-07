#pragma once

#include <algorithm>
#include <cstdint>
#include <cstdlib>
#include <string>
#include <string_view>

// The pet's reactions to what happens around it: the game (low health, death, sleep), DovahDamage
// (a new biggest hit, a boss kill), DovahHub's story broadcast, and other mods through
// MiniPets_API.h React(). Everything is offered to one Gate, which decides whether the card shows it:
// one global cooldown, three priorities, and held reactions (the sad pose after a death stays until the
// next load). Standard library only, so tests/cpp can run it without the game.
namespace Reactions
{
    // the six moods React() takes, then the two MiniPets uses itself
    inline constexpr std::string_view kMoods[] = { "cheer", "wave", "sad", "cower", "sleep", "curious", "hop", "fanfare" };
    inline constexpr std::size_t kApiMoods = 6;

    inline constexpr int kDefaultMs = 2500;
    inline constexpr int kMinMs = 800;
    inline constexpr int kMaxMs = 6000;
    inline constexpr std::size_t kMaxCaptionBytes = 120;
    inline constexpr std::size_t kMaxSourceBytes = 32;
    inline constexpr int kDefaultCooldownSeconds = 8;
    inline constexpr int kMinCooldownSeconds = 2;
    inline constexpr int kMaxCooldownSeconds = 60;

    struct Reaction
    {
        std::string source;    // slug: "minipets", "dovahdamage", "dovahhub", or the calling mod's
        std::string mood;
        std::string caption;   // drawn by MiniPets under the pet; "" = the pet's name only
        int ms = kDefaultMs;
        int priority = 1;      // 0 dropped if anything is showing, 1 normal, 2 interrupts
        bool hold = false;     // stays until Release (MiniPets' own death and sleep poses)
        bool care = false;     // a big moment: may count as care when that setting is on
        // MiniPets' own reactions name a catalogue line (view/i18n.js) instead of a caption, so the
        // card words it in the player's language; vars fill its {placeholders}
        std::string captionKey;
        std::string vars = "{}";  // a JSON object, "{}" when empty
    };

    inline bool IsMood(std::string_view mood, bool apiOnly)
    {
        const std::size_t count = apiOnly ? kApiMoods : std::size(kMoods);
        for (std::size_t i = 0; i < count; ++i) {
            if (kMoods[i] == mood) {
                return true;
            }
        }
        return false;
    }

    inline bool IsSlug(std::string_view text)
    {
        if (text.empty() || text.size() > kMaxSourceBytes) {
            return false;
        }
        return std::all_of(text.begin(), text.end(), [](char c) {
            return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
        });
    }

    inline void AppendUtf8(std::string& out, std::uint32_t code)
    {
        if (code < 0x80) {
            out += static_cast<char>(code);
        }
        else if (code < 0x800) {
            out += static_cast<char>(0xC0 | (code >> 6));
            out += static_cast<char>(0x80 | (code & 0x3F));
        }
        else if (code < 0x10000) {
            out += static_cast<char>(0xE0 | (code >> 12));
            out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (code & 0x3F));
        }
        else {
            out += static_cast<char>(0xF0 | (code >> 18));
            out += static_cast<char>(0x80 | ((code >> 12) & 0x3F));
            out += static_cast<char>(0x80 | ((code >> 6) & 0x3F));
            out += static_cast<char>(0x80 | (code & 0x3F));
        }
    }

    // A top-level field of a flat JSON object: a string (escapes decoded), or a number, true, false or
    // null as written. found false when the key is absent.
    struct Field
    {
        bool found = false;
        bool isString = false;
        std::string text;
    };

    inline bool IsSpace(char c)
    {
        return c == ' ' || c == '\t' || c == '\r' || c == '\n';
    }

    // reads the JSON string starting at the quote json[at]; returns the index of its closing quote
    inline std::size_t ReadString(std::string_view json, std::size_t at, std::string& text)
    {
        std::size_t j = at + 1;
        for (; j < json.size() && json[j] != '"'; ++j) {
            if (json[j] != '\\' || j + 1 >= json.size()) {
                text += json[j];
                continue;
            }
            const char e = json[++j];
            switch (e) {
            case 'n': text += '\n'; break;
            case 't': text += '\t'; break;
            case 'r': case 'b': case 'f': break;
            case 'u':
                if (j + 4 < json.size()) {
                    auto code = static_cast<std::uint32_t>(std::strtoul(std::string(json.substr(j + 1, 4)).c_str(), nullptr, 16));
                    j += 4;
                    if (code >= 0xD800 && code < 0xDC00 && j + 6 < json.size() && json[j + 1] == '\\' && json[j + 2] == 'u') {
                        const auto low = static_cast<std::uint32_t>(std::strtoul(std::string(json.substr(j + 3, 4)).c_str(), nullptr, 16));
                        if (low >= 0xDC00 && low < 0xE000) {
                            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00);
                            j += 6;
                        }
                    }
                    AppendUtf8(text, code);
                }
                break;
            default: text += e; break;
            }
        }
        return j;
    }

    inline Field ReadField(std::string_view json, std::string_view key)
    {
        Field field;
        int depth = 0;
        const auto skipSpace = [&](std::size_t k) {
            while (k < json.size() && IsSpace(json[k])) {
                ++k;
            }
            return k;
        };
        for (std::size_t i = 0; i < json.size(); ++i) {
            const char c = json[i];
            if (c == '{' || c == '[') {
                ++depth;
                continue;
            }
            if (c == '}' || c == ']') {
                --depth;
                continue;
            }
            if (c != '"') {
                continue;
            }
            std::string text;
            const std::size_t close = ReadString(json, i, text);
            std::size_t k = skipSpace(close + 1);
            if (k >= json.size() || json[k] != ':' || depth != 1 || text != key) {
                i = close;
                continue;
            }
            k = skipSpace(k + 1);
            field.found = true;
            if (k < json.size() && json[k] == '"') {
                field.isString = true;
                ReadString(json, k, field.text);
                return field;
            }
            std::size_t end = k;
            while (end < json.size() && json[end] != ',' && json[end] != '}' && json[end] != ']' && !IsSpace(json[end])) {
                ++end;
            }
            field.text = std::string(json.substr(k, end - k));
            return field;
        }
        return field;
    }

    // cut at a character boundary, never inside a UTF-8 sequence
    inline std::string ClipUtf8(std::string text, std::size_t maxBytes)
    {
        if (text.size() <= maxBytes) {
            return text;
        }
        std::size_t cut = maxBytes;
        while (cut > 0 && (static_cast<unsigned char>(text[cut]) & 0xC0) == 0x80) {
            --cut;
        }
        text.resize(cut);
        return text;
    }

    inline int ToInt(const Field& field, int fallback)
    {
        if (!field.found || field.isString || field.text.empty()) {
            return fallback;
        }
        char* end = nullptr;
        const double value = std::strtod(field.text.c_str(), &end);
        if (end == field.text.c_str()) {
            return fallback;
        }
        return static_cast<int>(value);
    }

    enum class ParseError
    {
        None,
        NotJson,
        Source,    // missing, or not a slug
        Mood,      // missing, or not one of the six
    };

    // React()'s JSON: {"source":"dovahstable","mood":"cheer","caption":"Ember was born!","ms":2500,"priority":0..2}
    inline ParseError Parse(std::string_view json, Reaction& out)
    {
        std::size_t first = json.find_first_not_of(" \t\r\n");
        if (first == std::string_view::npos || json[first] != '{' || json.find_last_of('}') == std::string_view::npos) {
            return ParseError::NotJson;
        }
        Reaction reaction;
        const auto source = ReadField(json, "source");
        if (!source.isString || !IsSlug(source.text)) {
            return ParseError::Source;
        }
        reaction.source = source.text;
        const auto mood = ReadField(json, "mood");
        if (!mood.isString || !IsMood(mood.text, true)) {
            return ParseError::Mood;
        }
        reaction.mood = mood.text;
        const auto caption = ReadField(json, "caption");
        if (caption.isString) {
            std::string clean;
            for (const char c : caption.text) {
                clean += (static_cast<unsigned char>(c) < 0x20) ? ' ' : c;
            }
            reaction.caption = ClipUtf8(clean, kMaxCaptionBytes);
        }
        reaction.ms = std::clamp(ToInt(ReadField(json, "ms"), kDefaultMs), kMinMs, kMaxMs);
        reaction.priority = std::clamp(ToInt(ReadField(json, "priority"), 1), 0, 2);
        out = reaction;
        return ParseError::None;
    }

    enum class Verdict
    {
        Show,
        Off,        // "react to other mods" is off (another mod's reaction)
        Hidden,     // the card is hidden: menus, loading, Shift+V
        Cooldown,   // within the cooldown of the last reaction
        Busy,       // a reaction of the same or higher weight is showing or held
    };

    inline const char* VerdictName(Verdict verdict)
    {
        switch (verdict) {
        case Verdict::Show: return "shown";
        case Verdict::Off: return "off";
        case Verdict::Hidden: return "hidden";
        case Verdict::Cooldown: return "cooldown";
        case Verdict::Busy: return "busy";
        }
        return "?";
    }

    // Times in milliseconds of any steady clock.
    class Gate
    {
    public:
        void SetCooldownSeconds(int seconds) { cooldownMs_ = std::clamp(seconds, kMinCooldownSeconds, kMaxCooldownSeconds) * 1000.0; }
        double CooldownMs() const { return cooldownMs_; }

        // fromOtherMod: React() or a suite source that the "react to other mods" switch covers
        Verdict Offer(const Reaction& reaction, double now, bool visible, bool otherModsOn, bool fromOtherMod)
        {
            if (fromOtherMod && !otherModsOn) {
                return Verdict::Off;
            }
            if (!visible && !reaction.hold) {
                return Verdict::Hidden;
            }
            const bool showing = held_ || now < busyUntil_;
            if (showing) {
                // 2 interrupts anything but a held 2; 1 and 0 never interrupt
                if (reaction.priority < 2 || (held_ && heldPriority_ >= 2 && !reaction.hold)) {
                    return Verdict::Busy;
                }
            }
            else if (reaction.priority < 2 && now - lastShown_ < cooldownMs_) {
                return Verdict::Cooldown;
            }
            lastShown_ = now;
            busyUntil_ = now + reaction.ms;
            if (reaction.hold) {
                held_ = true;
                heldPriority_ = reaction.priority;
                heldMood_ = reaction.mood;
            }
            else {
                held_ = false;
                heldMood_.clear();
            }
            return Verdict::Show;
        }

        // ends a held reaction (only the mood given, or any when mood is empty)
        bool Release(std::string_view mood = {})
        {
            if (!held_ || (!mood.empty() && mood != heldMood_)) {
                return false;
            }
            held_ = false;
            heldMood_.clear();
            busyUntil_ = 0;
            return true;
        }

        // a load: nothing showing, no cooldown
        void Reset()
        {
            held_ = false;
            heldMood_.clear();
            busyUntil_ = 0;
            lastShown_ = -1e18;
        }

        bool Held() const { return held_; }
        const std::string& HeldMood() const { return heldMood_; }

    private:
        double cooldownMs_ = kDefaultCooldownSeconds * 1000.0;
        double lastShown_ = -1e18;
        double busyUntil_ = 0;
        bool held_ = false;
        int heldPriority_ = 0;
        std::string heldMood_;
    };

    // Low health with a margin, so hovering around the line doesn't keep firing: fires once when the
    // share drops under `below`, again only after it has been back over `rearm`.
    class Threshold
    {
    public:
        Threshold(double below, double rearm) : below_(below), rearm_(rearm) {}
        bool Update(double share)
        {
            if (armed_ && share > 0.0 && share < below_) {
                armed_ = false;
                return true;
            }
            if (!armed_ && share >= rearm_) {
                armed_ = true;
            }
            return false;
        }
        void Rearm() { armed_ = true; }

    private:
        double below_;
        double rearm_;
        bool armed_ = true;
    };

    // Calls fn(objectText) for each object of a JSON array of flat objects ("[{...},{...}]"), as
    // DovahDamage's GetActorsJson returns. Strings may hold braces; they are skipped as strings.
    template <class Fn>
    void ForEachObject(std::string_view json, Fn&& fn)
    {
        int depth = 0;
        std::size_t start = std::string_view::npos;
        for (std::size_t i = 0; i < json.size(); ++i) {
            const char c = json[i];
            if (c == '"') {
                std::string ignored;
                i = ReadString(json, i, ignored);
                continue;
            }
            if (c == '{') {
                if (depth++ == 0) {
                    start = i;
                }
            }
            else if (c == '}' && depth > 0) {
                if (--depth == 0 && start != std::string_view::npos) {
                    fn(json.substr(start, i - start + 1));
                    start = std::string_view::npos;
                }
            }
        }
    }

    inline std::string JsonText(std::string_view value)
    {
        std::string out = "\"";
        for (const char c : value) {
            if (c == '"' || c == '\\') {
                out += '\\';
                out += c;
            }
            else if (static_cast<unsigned char>(c) >= 0x20) {
                out += c;
            }
        }
        return out + "\"";
    }

    // DovahHub's kMsgStoryEvent (DHUB-67), as agreed with the DovahHub team:
    //   {"key":"...","kind":"joined"|...|"companion"|"milestone"|...,"category":"life"|...,"subject":"Frost",
    //    "source":"stable"|"dovahhub","tier":2,"title":"Wanderer II"}  (from DovahHub 0.96.4-beta, while Your Story records)
    // joined: a wave with the name; lost: a sad pose; a milestone tier: a fanfare. false = no reaction.
    inline bool FromStoryEvent(std::string_view json, Reaction& out)
    {
        const auto kind = ReadField(json, "kind");
        const auto source = ReadField(json, "source");
        if (source.text == "pets") {
            return false;  // MiniPets' own moments
        }
        const auto subject = ClipUtf8(ReadField(json, "subject").text, 60);
        const auto tier = ReadField(json, "tier");
        Reaction reaction;
        reaction.source = source.isString && IsSlug(source.text) ? source.text : "dovahhub";
        // a follower joining the player is DovahHub's own kind "companion" (source "dovahhub")
        if (kind.text == "joined" || kind.text == "companion") {
            reaction.mood = "wave";
            reaction.captionKey = subject.empty() ? "reactJoinedSomeone" : "reactJoined";
            reaction.vars = "{\"name\":" + JsonText(subject) + "}";
            reaction.ms = 3200;
            reaction.care = true;
        }
        else if (kind.text == "lost") {
            reaction.mood = "sad";
            reaction.captionKey = subject.empty() ? "reactLostSomeone" : "reactLost";
            reaction.vars = "{\"name\":" + JsonText(subject) + "}";
            reaction.ms = 4000;
            reaction.priority = 2;
        }
        else if (kind.text == "milestone" || (tier.found && !tier.isString && tier.text != "0" && tier.text != "null")) {
            const auto title = ClipUtf8(ReadField(json, "title").text, 60);
            reaction.mood = "fanfare";
            reaction.captionKey = title.empty() ? "reactMilestoneSomething" : "reactMilestone";
            reaction.vars = "{\"title\":" + JsonText(title) + "}";
            reaction.ms = 3200;
            reaction.care = true;
        }
        else {
            return false;
        }
        out = reaction;
        return true;
    }

    // kMsgOutfitChanged: only the player, never from a load or a cell attach, at most once in 10 minutes
    // (seconds since the last one passed in), and not in the first 30 s after a load.
    inline bool FromOutfitChange(std::string_view json, double secondsSinceLoad, double secondsSinceLast, Reaction& out)
    {
        if (ReadField(json, "actor").text != "player") {
            return false;
        }
        const auto reason = ReadField(json, "reason").text;
        if (reason == "load" || reason == "attach") {
            return false;
        }
        if (secondsSinceLoad < 30.0 || secondsSinceLast < 600.0) {
            return false;
        }
        Reaction reaction;
        reaction.source = "dovahhub";
        reaction.mood = "curious";
        reaction.captionKey = "reactOutfit";
        reaction.vars = "{}";
        reaction.ms = 2600;
        reaction.priority = 0;
        out = reaction;
        return true;
    }

    // DovahDamage's biggest hit since the load against the best this save has seen (kept in the co-save).
    // A new record when it beats the best by at least 1 point; the first record of a save counts.
    inline bool IsNewRecord(double biggestSinceLoad, double bestThisSave)
    {
        return biggestSinceLoad >= 1.0 && biggestSinceLoad >= bestThisSave + 1.0;
    }
}
