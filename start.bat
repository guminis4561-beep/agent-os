@echo off
REM Atidaro nauja langa su /k - neuzsidarys net klaidos atveju
if "%1"=="INNER" goto :run

start "" cmd /k "%~f0" INNER
exit /b

:run
cd /d "%~dp0"
title AGENT OS — Serveris

echo.
echo  ═══════════════════════════════════════════════
echo  AGENT OS — Paleidimas
echo  ═══════════════════════════════════════════════
echo.

where node >nul 2>&1
if errorlevel 1 (
    echo  [KLAIDA] Node.js nerastas! Atsisiuskite is: https://nodejs.org
    echo.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo  [OK] Node.js %%v

REM Sustabdyti sena procesu ant porto 3000
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    echo  [*] Sustabdoma esama instancija ^(PID %%a^)...
    taskkill /PID %%a /F >nul 2>&1
    timeout /t 1 /nobreak >nul
)

if not exist node_modules (
    echo  [*] Diegiamos priklausomybes...
    call npm install
    if errorlevel 1 (
        echo  [KLAIDA] npm install nepavyko!
        pause & exit /b 1
    )
    echo  [OK] Priklausomybes idiegtos
    echo.
)

echo  [*] http://127.0.0.1:3000
echo  [*] Ctrl+C — sustabdyti
echo  ───────────────────────────────────────────────
echo.
node server/index.js

echo.
echo  ───────────────────────────────────────────────
echo  [!] Serveris sustojo.
pause
