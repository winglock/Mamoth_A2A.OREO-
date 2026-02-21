@echo off
setlocal
set REPO=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%REPO%scripts\start-mammoth.ps1" -RepoPath "%REPO%"
endlocal

