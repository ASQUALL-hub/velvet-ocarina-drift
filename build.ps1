# Builds a release of the YouTube desktop app (Pake + the scripts in app\).
#
#   .\build.ps1 -Version 1.1.0 -Repo owner/name            # build into out\v1.1.0
#   .\build.ps1 -Version 1.1.0 -Repo owner/name -Publish   # ...and publish a GitHub release
#
# Needs: pake-cli 3.17.6 (npm i -g pake-cli@3.17.6), Rust (stable-msvc), the
# signing key in %USERPROFILE%\.yt-app-signing\updater.key (never commit it),
# and yt-dlp.exe, ffmpeg.exe and deno.exe in -ToolsDir. -Publish needs gh.
# The latest uBlock Origin Lite is downloaded from its GitHub on every build.
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$Repo,
    [string]$ToolsDir = "$env:USERPROFILE\Downloads\Demo",
    [string]$Notes = "",
    [switch]$Publish
)
$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$pake = Join-Path $env:APPDATA "npm\node_modules\pake-cli"
$keyFile = Join-Path $env:USERPROFILE ".yt-app-signing\updater.key"
$out = Join-Path $root "out\v$Version"

if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "Version must look like 1.2.3" }
if ($Repo -notmatch '^[\w.-]+/[\w.-]+$') { throw "Repo must look like owner/name" }
$pakeVersion = (Get-Content (Join-Path $pake "package.json") -Raw | ConvertFrom-Json).version
if ($pakeVersion -ne "3.17.6") { throw "pake-cli $pakeVersion found; the patches are for 3.17.6" }
if (-not (Test-Path $keyFile)) { throw "Signing key not found at $keyFile" }
foreach ($tool in "yt-dlp.exe", "ffmpeg.exe", "deno.exe") {
    if (-not (Test-Path (Join-Path $ToolsDir $tool))) { throw "$tool not found in $ToolsDir" }
}

Write-Host "Applying patches to pake-cli..."
$patches = Join-Path $root "pake-patches"
Get-ChildItem $patches -Recurse -File | ForEach-Object {
    $dest = Join-Path $pake $_.FullName.Substring($patches.Length + 1)
    Copy-Item $_.FullName $dest -Force
}
# Point the updater at this repo's latest release.
$confPath = Join-Path $pake "src-tauri\tauri.conf.json"
$conf = Get-Content $confPath -Raw | ConvertFrom-Json
$conf.plugins.updater.endpoints = @("https://github.com/$Repo/releases/latest/download/latest.json")
$utf8 = New-Object System.Text.UTF8Encoding $false  # no BOM: JSON parsers reject it
[IO.File]::WriteAllText($confPath, ($conf | ConvertTo-Json -Depth 20), $utf8)

Write-Host "Copying tools..."
$toolsDest = Join-Path $pake "src-tauri\tools"
New-Item -ItemType Directory -Force $toolsDest | Out-Null
foreach ($tool in "yt-dlp.exe", "ffmpeg.exe", "deno.exe") {
    Copy-Item (Join-Path $ToolsDir $tool) $toolsDest -Force
}

Write-Host "Fetching the latest uBlock Origin Lite (Edge build)..."
# Every release bundles the newest uBOL; installed apps also update it themselves.
$ubolRelease = Invoke-RestMethod -UseBasicParsing "https://api.github.com/repos/uBlockOrigin/uBOL-home/releases/latest"
$ubolAsset = $ubolRelease.assets | Where-Object { $_.name -like "*.edge.zip" } | Select-Object -First 1
if (-not $ubolAsset -or $ubolAsset.browser_download_url -notlike "https://github.com/uBlockOrigin/uBOL-home/releases/download/*") {
    throw "No uBlock Origin Lite Edge build found in its latest release"
}
$ubolZip = Join-Path $env:TEMP "ubol-$($ubolRelease.tag_name).zip"
Invoke-WebRequest -UseBasicParsing $ubolAsset.browser_download_url -OutFile $ubolZip
$ubolDest = Join-Path $pake "src-tauri\extensions\ublock"
Remove-Item (Join-Path $pake "src-tauri\extensions") -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive $ubolZip $ubolDest -Force
Remove-Item $ubolZip
$ubolVersion = (Get-Content (Join-Path $ubolDest "manifest.json") -Raw | ConvertFrom-Json).version
if ($ubolVersion -ne $ubolRelease.tag_name) { throw "uBlock package version $ubolVersion doesn't match release $($ubolRelease.tag_name)" }
Write-Host "  bundled uBlock Origin Lite $ubolVersion"

Write-Host "Building $Version (this takes a few minutes)..."
Remove-Item (Join-Path $pake "src-tauri\target\.pake-build.lock") -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $out | Out-Null
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyFile -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
$app = Join-Path $root "app"
$inject = (("tabs.js", "links.js", "download.js", "miniplayer.js") | ForEach-Object { Join-Path $app $_ }) -join ","
Push-Location $out
# pake and gh print progress on stderr; Windows PowerShell treats that as an
# error under "Stop", so rely on exit codes for native commands instead.
$ErrorActionPreference = "Continue"
try {
    & pake.cmd https://www.youtube.com --name YouTube --width 1280 --height 800 `
        --hide-window-decorations --app-version $Version --inject $inject
    if ($LASTEXITCODE -ne 0) { throw "pake build failed ($LASTEXITCODE)" }
} finally {
    $ErrorActionPreference = "Stop"
    Pop-Location
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}

Write-Host "Collecting release files..."
$bundle = Join-Path $pake "src-tauri\target\x86_64-pc-windows-msvc\release\bundle\msi"
$msiName = "YouTube_${Version}_x64_en-US.msi"
# Pake moves the bundled MSI into the working folder as YouTube.msi; its
# updater signature stays behind in the bundle folder.
Move-Item (Join-Path $out "YouTube.msi") (Join-Path $out $msiName) -Force
$signature = (Get-Content (Join-Path $bundle "$msiName.sig") -Raw).Trim()

$latest = [ordered]@{
    version   = $Version
    notes     = $Notes
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $signature
            url       = "https://github.com/$Repo/releases/download/v$Version/$msiName"
        }
    }
}
[IO.File]::WriteAllText((Join-Path $out "latest.json"), ($latest | ConvertTo-Json -Depth 5), $utf8)

# Small manual update for an existing install: just the app exe + script.
$extract = Join-Path $env:TEMP "yt-app-extract-$Version"
Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
Start-Process msiexec.exe -ArgumentList "/a `"$(Join-Path $out $msiName)`" /qn TARGETDIR=`"$extract`"" -Wait
$exe = Get-ChildItem $extract -Recurse -Filter "pake-youtube.exe" | Select-Object -First 1
$stage = Join-Path $env:TEMP "yt-app-update-$Version"
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $stage | Out-Null
Copy-Item $exe.FullName $stage
Copy-Item (Join-Path $root "update\Install update.cmd") $stage
Compress-Archive -Path "$stage\*" -DestinationPath (Join-Path $out "YouTube-Update.zip") -Force
Remove-Item $extract, $stage -Recurse -Force

Get-ChildItem $out | Select-Object Name, @{ n = "MB"; e = { [math]::Round($_.Length / 1MB, 1) } } | Format-Table -AutoSize

if ($Publish) {
    Write-Host "Publishing v$Version to $Repo..."
    $assets = @((Join-Path $out $msiName), (Join-Path $out "latest.json"), (Join-Path $out "YouTube-Update.zip"))
    $releaseNotes = if ($Notes) { $Notes } else { "Version $Version" }
    $gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
    if (-not $gh) { $gh = Join-Path $env:ProgramFiles "GitHub CLI\gh.exe" }
    $ErrorActionPreference = "Continue"
    & $gh release create "v$Version" @assets --repo $Repo --title "v$Version" --notes $releaseNotes
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($code -ne 0) { throw "gh release create failed ($code)" }
}
