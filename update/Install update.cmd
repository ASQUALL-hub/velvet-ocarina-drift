@echo off
setlocal
title YouTube app update

rem Updates an installed YouTube app by replacing pake-youtube.exe only.
rem The download tools (yt-dlp, ffmpeg, deno) already installed are left alone.

set "APPDIR=%ProgramFiles%\YouTube"
set "NEWEXE=%~dp0pake-youtube.exe"

if not exist "%NEWEXE%" (
  echo pake-youtube.exe is missing next to this file.
  echo Extract the whole zip first, then run "Install update.cmd" from the extracted folder.
  echo.
  pause
  exit /b 1
)
if not exist "%APPDIR%\pake-youtube.exe" (
  echo The YouTube app isn't installed in "%APPDIR%".
  echo Install "YouTube Full.msi" instead.
  echo.
  pause
  exit /b 1
)

rem Replacing a file in Program Files needs admin rights: ask once and rerun.
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo Closing YouTube...
taskkill /F /IM pake-youtube.exe >nul 2>&1
timeout /t 2 /nobreak >nul

echo Updating...
copy /Y "%NEWEXE%" "%APPDIR%\pake-youtube.exe" >nul
if errorlevel 1 (
  echo Update failed: couldn't replace the app. Make sure YouTube is closed and try again.
  echo.
  pause
  exit /b 1
)

if not exist "%APPDIR%\tools\yt-dlp.exe" (
  echo.
  echo Note: this PC doesn't have the download tools ^(yt-dlp, ffmpeg, deno^).
  echo Everything else works, but "Download Video" needs "YouTube Full.msi".
  echo.
  pause
)

echo.
echo Done. Starting YouTube...
rem Start it through Explorer so it runs as the normal user, not as admin.
start "" explorer.exe "%APPDIR%\pake-youtube.exe"
timeout /t 3 >nul
