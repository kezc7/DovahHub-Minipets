// Checks SettingsFile::Prepare against a scratch folder. Build and run with
//   xmake build MiniPets_tests && xmake run MiniPets_tests
#include "SettingsFile.h"

#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>

namespace
{
    int failures = 0;

    void Check(bool ok, const char* what)
    {
        std::cout << (ok ? "ok   " : "FAIL ") << what << '\n';
        if (!ok) {
            ++failures;
        }
    }

    std::string ReadAll(const std::filesystem::path& path)
    {
        std::ifstream input(path);
        std::stringstream buffer;
        buffer << input.rdbuf();
        return buffer.str();
    }

    void WriteAll(const std::filesystem::path& path, const std::string& text)
    {
        std::filesystem::create_directories(path.parent_path());
        std::ofstream output(path, std::ios::trunc);
        output << text;
    }

    struct Scratch
    {
        std::filesystem::path root;
        std::filesystem::path current;
        std::filesystem::path legacy;

        explicit Scratch(const char* name)
        {
            root = std::filesystem::temp_directory_path() / "minipets-settings-test" / name;
            std::filesystem::remove_all(root);
            current = root / "Data" / "SKSE" / "Plugins" / "MiniPets.ini";
            legacy = root / "Data" / "SKSE" / "Plugins" / "DragonbornXP.ini";
        }

        ~Scratch()
        {
            std::error_code ignored;
            std::filesystem::remove_all(root, ignored);
        }
    };
}

int main()
{
    {
        Scratch scratch("neither");
        const auto choice = SettingsFile::Prepare(scratch.current, scratch.legacy);
        Check(choice.read == scratch.current && !choice.migrated, "no file at all: read the new path, nothing migrated");
        Check(!std::filesystem::exists(scratch.current), "no file at all: nothing is written");
    }
    {
        Scratch scratch("legacy-only");
        WriteAll(scratch.legacy, "pet=fox\nscale=120\n");
        const auto choice = SettingsFile::Prepare(scratch.current, scratch.legacy);
        Check(choice.read == scratch.current && choice.migrated, "old file only: migrated to the new path");
        Check(ReadAll(scratch.current) == "pet=fox\nscale=120\n", "old file only: the new file has the old contents");
        Check(std::filesystem::exists(scratch.legacy), "old file only: the old file is left alone");
        const auto again = SettingsFile::Prepare(scratch.current, scratch.legacy);
        Check(again.read == scratch.current && !again.migrated, "second run: no migration reported");
    }
    {
        Scratch scratch("both");
        WriteAll(scratch.legacy, "pet=fox\n");
        WriteAll(scratch.current, "pet=mudcrab\n");
        const auto choice = SettingsFile::Prepare(scratch.current, scratch.legacy);
        Check(choice.read == scratch.current && !choice.migrated, "both files: the new one wins");
        Check(ReadAll(scratch.current) == "pet=mudcrab\n", "both files: the new one is not overwritten");
    }
    {
        Scratch scratch("current-only");
        WriteAll(scratch.current, "pet=chicken\n");
        const auto choice = SettingsFile::Prepare(scratch.current, scratch.legacy);
        Check(choice.read == scratch.current && !choice.migrated, "new file only: read as is");
    }

    std::cout << (failures ? "FAILED" : "all passed") << '\n';
    return failures ? EXIT_FAILURE : EXIT_SUCCESS;
}
