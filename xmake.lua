set_xmakever("3.0.0")

includes("lib/commonlibsse-ng")

local PLUGIN_NAME = "DragonbornXP"
-- bump this for releases
local PLUGIN_VERSION = "1.7.1"
local PACKAGE_NAME = "dovahhub-minipets"
local VIEW_NAME = "DragonbornXP"
-- the MiniPets tab lives inside DovahHub's view folder
local HUB_MODULE_DIR = path.join("PrismaUI", "views", "DovahHub", "modules", "pets")

set_project(PLUGIN_NAME)
set_version(PLUGIN_VERSION)
set_license("GPL-3.0")
set_languages("c++23")
set_warnings("allextra")
add_defines("UNICODE", "_UNICODE")
set_policy("package.requires_lock", true)

add_rules("mode.release")
add_rules("plugin.vsxmake.autoupdate")

target(PLUGIN_NAME)
    add_deps("commonlibsse-ng")
    add_rules("commonlibsse-ng.plugin", {
        name = PLUGIN_NAME,
        author = "DragonbornXP contributors",
        description = "Pixel-art HUD companions that celebrate your XP and level-ups"
    })
    add_files("src/**.cpp", "keyhandler/**.cpp")
    add_headerfiles("src/**.h", "keyhandler/**.h")
    add_includedirs("src", "keyhandler")
    set_pcxxheader("src/pch.h")

    after_build(function (target)
        local distdir = path.join(os.projectdir(), "dist", PLUGIN_NAME .. "_" .. PLUGIN_VERSION)
        local viewdir = path.join(distdir, "PrismaUI", "views", VIEW_NAME)
        local plugindir = path.join(distdir, "SKSE", "plugins")

        os.tryrm(distdir)
        os.mkdir(viewdir)
        os.mkdir(plugindir)
        os.cp(path.join(os.projectdir(), "view", "*"), viewdir)
        os.cp(target:targetfile(), plugindir)

        -- DovahHub's MiniPets tab: the shared scripts are copied from view/ so they can't drift
        local hubsrc = path.join(os.projectdir(), "hub", "modules", "pets")
        os.cp(path.join(os.projectdir(), "view", "pet-life.js"), hubsrc)
        os.cp(path.join(os.projectdir(), "view", "pet-sprites.js"), hubsrc)
        local hubdir = path.join(distdir, HUB_MODULE_DIR)
        os.mkdir(hubdir)
        os.cp(path.join(hubsrc, "*"), hubdir)

        -- licence texts go with the DLL (GPL plus the bundled libraries)
        local licensedir = path.join(plugindir, PLUGIN_NAME .. "-licenses")
        os.mkdir(licensedir)
        os.cp(path.join(os.projectdir(), "LICENSE"), path.join(licensedir, "LICENSE.txt"))
        os.cp(path.join(os.projectdir(), "THIRD-PARTY-NOTICES.md"), licensedir)
        os.cp(path.join(os.projectdir(), "licenses", "*"), licensedir)

        local symbolfile = target:symbolfile()
        if symbolfile and os.isfile(symbolfile) then
            os.cp(symbolfile, plugindir)
        end

        cprint("${bright green}created distribution folder: ${clear}dist/%s_%s", PLUGIN_NAME, PLUGIN_VERSION)

        -- zip for MO2, SKSE/ and PrismaUI/ at the root
        import("utils.archive")
        local zipname = PACKAGE_NAME .. PLUGIN_VERSION .. ".zip"
        local zipfile = path.join(os.projectdir(), zipname)
        os.tryrm(zipfile)
        archive.archive(zipfile, {"SKSE", "PrismaUI"}, {curdir = distdir, recurse = true})
        cprint("${bright green}created MO2 package: ${clear}%s", zipname)
    end)
