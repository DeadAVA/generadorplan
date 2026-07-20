$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker no esta instalado."
}

docker compose version | Out-Null

if (-not (Test-Path -LiteralPath ".env")) {
    throw "Crea .env desde .env.example."
}

docker compose up -d --build --remove-orphans

Write-Host "Esperando a Master Endurance en http://localhost:5001 ..."
$ready = $false
foreach ($attempt in 1..30) {
    try {
        $health = Invoke-RestMethod -Uri "http://localhost:5001/api/health" -TimeoutSec 3
        if ($health.status -eq "ok") {
            $ready = $true
            break
        }
    } catch {
        Start-Sleep -Seconds 2
    }
}

if (-not $ready) {
    throw "La aplicacion no respondio. Revisa: docker compose logs app"
}

Write-Host "Aplicacion lista en http://localhost:5001"
