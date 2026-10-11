@echo off
title Josked
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 18 or newer from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

set PORT=4173
echo Starting Josked on http://localhost:%PORT%
echo Keep this window open while you use the site. Close it to stop.
echo.

start "" "http://localhost:%PORT%"
call npm start
if errorlevel 1 (
  echo.
  echo Josked stopped with an error. See the message above.
  pause
)
