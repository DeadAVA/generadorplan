@echo off
setlocal
cd /d "%~dp0"
docker compose up -d --build
if errorlevel 1 (
  echo No se pudo iniciar la aplicacion.
  pause
  exit /b 1
)
start "" "https://andrestrainer.qzz.io"
echo Aplicacion iniciada. Cloudflared debe apuntar a http://localhost:5001
timeout /t 4 /nobreak >nul
endlocal
