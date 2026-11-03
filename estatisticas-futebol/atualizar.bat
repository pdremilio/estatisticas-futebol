@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Estatisticas de Futebol - atualizando dados
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar.ps1" %*
echo.
start "" "%~dp0index.html"
pause
