# Master Endurance — Generador de Planes de Entrenamiento

Aplicación web (PWA) para gestionar atletas y generar planes de entrenamiento semanales de atletismo, con generación automática por tipo de carrera (5K, 10K, medio maratón, maratón, 400–800 m) y hojas de plan listas para imprimir.

> Web app (PWA) for managing athletes and generating weekly running training plans, with automatic plan generation by race distance and print-ready plan sheets.

## Características

- **Gestión de atletas y zonas de ritmo** — CRUD completo con zonas de ritmo personalizadas por atleta.
- **Planes de entrenamiento** — Estructurados por semana, día y ejercicio (nombre, prescripción, intensidad, pausa, ritmo, notas).
- **Generador automático** — Plantillas para base, 5K, 10K, medio maratón, maratón y series de 400–800 m.
- **Editor rápido** — Captura de ejercicios en formato de línea: `Nombre | Prescripción | Intensidad | Pausa | Nota`.
- **Hoja de impresión** — Vista A4 en `/print?id=<plan_id>` para imprimir o exportar a PDF.
- **Respaldo y restauración** — Exportación/importación de datos en JSON desde la interfaz.
- **PWA instalable** — Instalable en Android/iOS cuando se sirve por HTTPS.
- **Documentación de API** — Swagger/OpenAPI interactivo en `/docs` (FastAPI).

## Stack técnico

FastAPI · SQLModel · SQLite · Docker · PWA (frontend estático)

## Estructura

```
generadorplan/
├── app/
│   ├── main.py        # App FastAPI, middlewares, montaje de estáticos
│   ├── models.py       # Athlete, PaceZone, TrainingPlan, PlanDay, Exercise, FieldTest
│   ├── routers/         # athletes, plans, field_tests, backups
│   ├── services.py · seed.py · database.py
├── web/                # Frontend (PWA)
├── data/atletas.json    # Datos semilla
└── docker-compose.yml
```

## Puesta en marcha

```bash
docker compose up -d --build app
```

La base SQLite persiste en el volumen Docker `master_endurance_data`. Consulta [`LEEME.md`](./LEEME.md) para despliegue en servidor (Linux/Windows) y publicación vía Cloudflare Tunnel.

---

## English summary

FastAPI + SQLModel application for managing athletes and generating structured weekly running training plans, with automatic templates by race distance, a print-ready plan sheet, JSON backup/restore, and an installable PWA frontend. Runs via Docker with a persisted SQLite volume; see `LEEME.md` for deployment details.
