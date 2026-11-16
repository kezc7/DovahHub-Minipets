param(
    # Delete build\ and .xmake\ first, so nothing from an earlier build (or its recorded paths) is reused
    [switch]$Clean
)

# Builds MiniPets.dll and its MO2 zip the way a release must be built: xmake's packages and every temporary
# file are kept outside the user's own folder, so no path in the DLL (or a debug file, if one is ever shipped)
# names who built it. xmake.lua does the rest: every test file, the zip, and the three zip checks. The zip this
# script reports is checked against tools/zip-allowlist.txt once more before its SHA-256 is printed.
#   powershell -File tools\build-release.ps1 -Clean
# The version is PLUGIN_VERSION in xmake.lua; this script only reads it.

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
# xmake writes build\ and .xmake\ into the current folder even with -P, so work from the repository
Push-Location -LiteralPath $root
try {
$build = [System.IO.File]::ReadAllText((Join-Path $root 'xmake.lua'))
if ($build -notmatch 'local PLUGIN_VERSION = "((\d+\.\d+\.\d+)[^"]*)"') { throw "xmake.lua has no PLUGIN_VERSION" }
$version = $Matches[1]
$fileVersion = "$($Matches[2]).0"

# xmake keeps its packages (spdlog and the rest) in its global folder, which is under the user's own folder
# unless it is told otherwise, and the compiler records the paths it read. So the build uses a global folder
# outside it, and MiniPets' own: XMAKE_GLOBALDIR when it is set, else "xmake-global\MiniPets" at the top of this
# drive. A folder shared with other builds can stall when two configure at once, and can hold packages another
# Visual Studio compiled. The first build with a new folder fetches the packages again, at the versions
# xmake-requires.lock pins, and compiles them with the Visual Studio named below.
if (-not $env:XMAKE_GLOBALDIR) { $env:XMAKE_GLOBALDIR = Join-Path ([IO.Path]::GetPathRoot($root)) 'xmake-global\MiniPets' }
$globalDir = [IO.Path]::GetFullPath($env:XMAKE_GLOBALDIR)
$userHome = [IO.Path]::GetFullPath($env:USERPROFILE).TrimEnd('\') + '\'
if (($globalDir.TrimEnd('\') + '\').StartsWith($userHome, [StringComparison]::OrdinalIgnoreCase) -or $root.StartsWith($userHome, [StringComparison]::OrdinalIgnoreCase)) {
    throw "The build must not run from, or keep xmake's packages in, the user's own folder: its path would end up in what is shipped"
}
# xmake keeps installed packages and their cache apart from its global folder (under the user's local app data by
# default), and the compiler and linker write temporary files whose paths are recorded too. All of them go here.
$env:XMAKE_GLOBALDIR = $globalDir
$env:XMAKE_PKG_INSTALLDIR = Join-Path $globalDir 'packages'
$env:XMAKE_PKG_CACHEDIR = Join-Path $globalDir 'cache'
$buildTemp = Join-Path $globalDir 'tmp'
$env:XMAKE_TMPDIR = $buildTemp
$env:TMP = $buildTemp
$env:TEMP = $buildTemp
# DirectXTK's package build runs a script from its own folder by bare name. A shell that sets
# NoDefaultCurrentDirectoryInExePath stops cmd finding it, and the install fails with an empty log.
$env:NoDefaultCurrentDirectoryInExePath = $null
New-Item -ItemType Directory -Force -Path $globalDir, $env:XMAKE_PKG_INSTALLDIR, $env:XMAKE_PKG_CACHEDIR, $buildTemp | Out-Null
Write-Host "xmake global, package and temporary folders: $globalDir"
Write-Host "Building MiniPets $version"

# A zip must be rebuildable from its tag: nothing tracked may differ from the commit (line endings aside, which
# a build can rewrite in xmake-requires.lock), and nothing untracked may sit outside .gitignore
& git -C $root diff --ignore-cr-at-eol --quiet HEAD --
if ($LASTEXITCODE -ne 0) { throw "The working tree differs from the commit: commit or put back every change before a release build" }
$untracked = & git -C $root ls-files --others --exclude-standard
if ($untracked) { throw "Untracked files would not be in the tag: $($untracked -join ', ')" }

# A clean build never deletes a git worktree: stop, naming it, if one lies inside a folder about to go
if ($Clean) {
    foreach ($folder in 'build', '.xmake') {
        $inside = (Join-Path $root $folder).TrimEnd('\') + '\'
        foreach ($line in (& git -C $root worktree list --porcelain)) {
            if ($line -notlike 'worktree *') { continue }
            $tree = [IO.Path]::GetFullPath($line.Substring(9)).TrimEnd('\') + '\'
            if ($tree.StartsWith($inside, [StringComparison]::OrdinalIgnoreCase)) {
                throw "A git worktree lies inside $folder\: $tree. Move or remove it with the PO first; nothing was deleted"
            }
        }
    }
    foreach ($folder in 'build', '.xmake') {
        $path = Join-Path $root $folder
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
    }
    Write-Host "Removed build\ and .xmake\: everything is compiled again"
}

$zip = Join-Path $root "dovahhub-minipets-$version.zip"
Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $zip
$started = Get-Date
# Visual Studio 2022 (MSVC 14.4x), named: with a newer Visual Studio beside it, a configure from an empty folder
# picks the newer one, and its DLL needs a newer Visual C++ runtime on the player's PC. Before it zips, xmake.lua
# checks the DLL's linker version and every build number in its Rich header (tools/dll-toolset.py): 35700 and
# higher are a newer Visual Studio's.
$env:MINIPETS_LINKER = '14.4'
$env:MINIPETS_BUILD_BELOW = '35700'
# (the platform named, or a shell from Git for Windows passes for mingw; --vs=2022 without naming the msvc toolchain,
# which would make xmake skip its prebuilt DirectXTK and build it from source)
& xmake f -P $root -y -p windows -a x64 -m release --vs=2022
if ($LASTEXITCODE -ne 0) { throw "xmake configuration failed with exit code $LASTEXITCODE" }
# configure must not re-pin the package recipes: a change to xmake-requires.lock is committed on purpose, never here
& git -C $root diff --ignore-cr-at-eol --quiet HEAD -- xmake-requires.lock
if ($LASTEXITCODE -ne 0) { throw "Configure changed xmake-requires.lock; see git diff. A recipe change is committed on purpose, with its reason" }
& xmake build -P $root -y MiniPets
if ($LASTEXITCODE -ne 0) { throw "xmake build failed with exit code $LASTEXITCODE (a failed test or zip check stops it too)" }
& git -C $root diff --ignore-cr-at-eol --quiet HEAD -- xmake-requires.lock
if ($LASTEXITCODE -ne 0) { throw "The build changed xmake-requires.lock; see git diff" }

# the DLL that was packed must be the one just built for this version
$dll = Join-Path $root 'build\windows\x64\release\MiniPets.dll'
if (-not (Test-Path -LiteralPath $dll)) { throw "Build output was not found: $dll" }
$item = Get-Item -LiteralPath $dll
if ($item.LastWriteTime -lt $started) { throw "MiniPets.dll was not rebuilt by this build (written $($item.LastWriteTime))" }
$info = $item.VersionInfo
$dllVersion = "$($info.FileMajorPart).$($info.FileMinorPart).$($info.FileBuildPart).$($info.FilePrivatePart)"
if ($dllVersion -ne $fileVersion) { throw "MiniPets.dll's file version is $dllVersion, not $fileVersion" }
if (-not (Test-Path -LiteralPath $zip)) { throw "The build made no zip: $zip" }
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
    $entry = $archive.Entries | Where-Object { $_.FullName -match '^SKSE[\/]plugins[\/]MiniPets\.dll$' }
    if (-not $entry -or $entry.Length -ne $item.Length) { throw "The zip's MiniPets.dll is not the one just built" }
    # its PDB ships beside it, so crash logs can name functions
    $pdb = Get-Item -LiteralPath (Join-Path $root 'build\windows\x64\release\MiniPets.pdb')
    $pdbEntry = $archive.Entries | Where-Object { $_.FullName -match '^SKSE[\/]plugins[\/]MiniPets\.pdb$' }
    if (-not $pdbEntry -or $pdbEntry.Length -ne $pdb.Length -or $pdb.LastWriteTime -lt $started) { throw "The zip's MiniPets.pdb is missing or not the one just built" }
} finally {
    $archive.Dispose()
}
# only MiniPets' own files ship (DMP-19): the zip being reported holds nothing outside the allowlist
& python -I (Join-Path $root 'tools\zip-allowlist.py') (Join-Path $root 'tools\zip-allowlist.txt') $zip
if ($LASTEXITCODE -ne 0) { throw "The zip holds an entry outside tools\zip-allowlist.txt (named above)" }
Write-Host "DLL file version $dllVersion ($($info.FileVersion)), written $($item.LastWriteTime.ToString('HH:mm:ss'))"
Write-Host "Package complete: $zip (SHA-256 $((Get-FileHash -LiteralPath $zip).Hash))"
} finally {
    Pop-Location
}
