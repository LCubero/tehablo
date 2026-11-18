@echo off
rem Resolve a Python interpreter and run notify.py. herdr launches this shim
rem because the bare "python" on Windows may be the Microsoft Store alias,
rem which opens the Store instead of running anything.
setlocal enabledelayedexpansion
set "HERE=%~dp0"
set "PY="

if defined TEHABLO_PYTHON call :try "%TEHABLO_PYTHON%"
if not defined PY if defined HERDR_PLUGIN_CONFIG_DIR if exist "%HERDR_PLUGIN_CONFIG_DIR%\python.txt" (
  set /p PY_HINT= < "%HERDR_PLUGIN_CONFIG_DIR%\python.txt"
  if defined PY_HINT call :try "!PY_HINT!"
)
if not defined PY call :try python3
if not defined PY call :try py
if not defined PY call :try python

if not defined PY (
  echo tehablo-herdr: no Python interpreter found. Set TEHABLO_PYTHON or write its path to python.txt in the plugin config directory. 1>&2
  exit /b 1
)

"%PY%" "%HERE%notify.py" %*
exit /b %ERRORLEVEL%

:try
"%~1" -c "import sys" >nul 2>nul
if errorlevel 1 exit /b 1
set "PY=%~1"
exit /b 0
