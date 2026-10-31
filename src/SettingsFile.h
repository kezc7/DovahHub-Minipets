#pragma once

#include <filesystem>
#include <system_error>

// Which settings file to read. 1.8.0 renamed DragonbornXP.ini to MiniPets.ini; on the first run
// after the upgrade the old file is copied to the new name and left where it was (MO2's Overwrite
// may own it). Standard library only, so the unit test can run it without the game.
namespace SettingsFile
{
    struct Choice
    {
        std::filesystem::path read;
        bool migrated = false;
    };

    inline Choice Prepare(const std::filesystem::path& current, const std::filesystem::path& legacy)
    {
        std::error_code error;
        if (std::filesystem::exists(current, error)) {
            return { current, false };
        }
        if (!std::filesystem::exists(legacy, error)) {
            return { current, false };
        }
        std::filesystem::create_directories(current.parent_path(), error);
        error.clear();
        std::filesystem::copy_file(legacy, current, std::filesystem::copy_options::skip_existing, error);
        if (error) {
            // read the old file this time; the next save writes the new one
            return { legacy, false };
        }
        return { current, true };
    }
}
