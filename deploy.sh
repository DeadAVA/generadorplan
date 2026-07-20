#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: Docker no esta instalado." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: Docker Compose v2 no esta disponible." >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "Error: crea .env desde .env.example." >&2
  exit 1
fi

docker compose up -d --build --remove-orphans

echo "Esperando a Master Endurance en http://localhost:5001 ..."
attempt=0
until curl --fail --silent http://localhost:5001/api/health >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Error: la aplicacion no respondio. Revisa: docker compose logs app" >&2
    exit 1
  fi
  sleep 2
done

echo "Aplicacion lista en http://localhost:5001"
