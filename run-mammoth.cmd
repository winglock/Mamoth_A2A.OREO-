@echo off
setlocal
set REPO=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO%scripts\run-mammoth.ps1" -RepoPath "%REPO%"
endlocal

