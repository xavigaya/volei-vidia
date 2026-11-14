@echo off
REM Volei VidIA - executa l'eina d'analisi (vidia-vision) amb l'entorn creat per install.ps1
setlocal
set "HERE=%~dp0"
if not exist "%HERE%.venv\Scripts\python.exe" (
  echo Cal instal-lar l'eina primer: powershell -ExecutionPolicy Bypass -File "%HERE%install.ps1"
  exit /b 1
)
chcp 65001 >nul
"%HERE%.venv\Scripts\python.exe" -m vidia_vision %*
