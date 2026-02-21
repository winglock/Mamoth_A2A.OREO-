@echo off
setlocal
set REPO=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO%scripts\stop-mammoth.ps1"
endlocal

