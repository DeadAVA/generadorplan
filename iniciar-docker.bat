@echo off
setlocal
cd /d "%~dp0"
docker info >nul 2>nul
if errorlevel 1 (
  echo Docker Desktop no esta iniciado. Abre Docker Desktop y vuelve a ejecutar este archivo.
  pause
  exit /b 1
)
docker compose up -d --build app
if errorlevel 1 (
  echo No se pudo iniciar Master Endurance.
  pause
  exit /b 1
)
start "" "http://localhost:5001"
echo Master Endurance esta ejecutandose en http://localhost:5001
timeout /t 4 /nobreak >nul
endlocal
