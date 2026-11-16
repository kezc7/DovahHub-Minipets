param(
    # Delete build\ and .xmake\ first, so nothing from an earlier build (or its recorded paths) is reused
    [switch]$Clean
)

# Builds MiniPets.dll and its MO2 zip the way a release must be built: xmake's packages and every temporary
# file are kept outside the user's own folder, so no path in the DLL (or a debug file, if one is ever shipped)
# names who built it. xmake.lua does the rest: every test file, the zip, and the two zip checks.
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
# outside it: XMAKE_GLOBALDIR when it is set, else "xmake-global" at the top of this drive. The first build
# with a new folder fetches the packages again, at the versions xmake-requires.lock pins.
if (-not $env:XMAKE_GLOBALDIR) { $env:XMAKE_GLOBALDIR = Join-Path ([IO.Path]::GetPathRoot($root)) 'xmake-global' }
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
New-Item -ItemType Directory -Force -Path $globalDir, $env:XMAKE_PKG_INSTALLDIR, $env:XMAKE_PKG_CACHEDIR, $buildTemp | Out-Null
Write-Host "xmake global, package and temporary folders: $globalDir"
Write-Host "Building MiniPets $version"

if ($Clean) {
    foreach ($folder in 'build', '.xmake') {
        $path = Join-Path $root $folder
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
    }
    Write-Host "Removed build\ and .xmake\: everything is compiled again"
}

$zip = Join-Path $root "dovahhub-minipets-$version.zip"
Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $zip
$started = Get-Date
& xmake f -P $root -y -m release
if ($LASTEXITCODE -ne 0) { throw "xmake configuration failed with exit code $LASTEXITCODE" }
& xmake build -P $root -y MiniPets
if ($LASTEXITCODE -ne 0) { throw "xmake build failed with exit code $LASTEXITCODE (a failed test or zip check stops it too)" }

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
} finally {
    $archive.Dispose()
}
Write-Host "DLL file version $dllVersion ($($info.FileVersion)), written $($item.LastWriteTime.ToString('HH:mm:ss'))"
Write-Host "Package complete: $zip (SHA-256 $((Get-FileHash -LiteralPath $zip).Hash))"
} finally {
    Pop-Location
}
