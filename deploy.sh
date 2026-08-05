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

if ! docker info >/dev/null 2>&1; then
  echo "Error: el usuario actual no puede usar Docker." >&2
  echo "Ejecuta una vez: sudo usermod -aG docker \$USER; luego cierra sesion y vuelve a entrar." >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "Error: crea .env desde .env.example." >&2
  exit 1
fi

docker compose up -d --build --remove-orphans

echo "Esperando a Master Endurance en http://localhost:5001 ..."
attempt=0
until container_id="$(docker compose ps -q app)" && \
  [ -n "$container_id" ] && \
  [ "$(docker inspect --format '{{.State.Health.Status}}' "$container_id" 2>/dev/null)" = "healthy" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "Error: la aplicacion no respondio. Revisa: docker compose logs app" >&2
    exit 1
  fi
  sleep 2
done

echo "Aplicacion lista en http://localhost:5001"
