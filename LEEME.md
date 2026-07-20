# Andrés Trainer · Master Endurance 2.0

Aplicación web para gestionar atletas y crear planes semanales de atletismo. Usa FastAPI, SQLModel, SQLite y una interfaz PWA adaptable a móvil.

## Inicio local con Docker

1. Abre Docker Desktop.
2. Ejecuta `iniciar-app.bat` o `iniciar-docker.bat`.
3. Abre `http://localhost:5001`.

El archivo SQLite se guarda dentro del volumen Docker `master_endurance_data` como `/data/master_endurance.db`. Reconstruir el contenedor no elimina el volumen.

Comandos útiles:

```powershell
docker compose up -d --build app
docker compose logs -f app
docker compose restart app
docker compose down
```

No uses `docker compose down -v` salvo que realmente quieras borrar la base completa.

## Funciones

- CRUD completo de atletas y zonas de ritmo.
- Planes relacionados con atleta, semana, días y ejercicios.
- Cada ejercicio admite nombre, prescripción, intensidad, pausa, ritmo y notas.
- Generador automático para base, 5K, 10K, medio maratón, maratón y 400–800 m.
- Editor rápido mediante líneas con formato `Nombre | Prescripción | Intensidad | Pausa | Nota`.
- Hoja A4 en `/print?id=ID_DEL_PLAN`, lista para imprimir o guardar como PDF.
- Respaldo y restauración JSON desde la interfaz.
- PWA instalable desde Android y iOS cuando se publica con HTTPS.
- Documentación interactiva de API en `/docs`.

## Datos iniciales

Cuando el volumen está vacío, el backend importa automáticamente `data/atletas.json`. En la primera construcción actual se migraron 5 atletas, 5 planes, 35 días y 29 ejercicios.

## Publicar en andrestrainer.qzz.io

Cloudflared se ejecuta y administra por separado en el servidor.

1. En Cloudflare Zero Trust crea o abre el túnel del dominio.
2. Configura el hostname público `andrestrainer.qzz.io` con servicio `HTTP` y URL de origen `http://localhost:5001`.
3. Ejecuta `iniciar-dominio.bat` o:

```powershell
docker compose up -d --build
```

En un servidor Linux también puedes ejecutar:

```bash
cp .env.example .env
chmod +x deploy.sh
./deploy.sh
```

En Windows Server usa `./deploy.ps1`. Ambos despliegues construyen la aplicación, levantan SQLite, esperan la comprobación de salud y mantienen los datos en el volumen `master_endurance_data`. El servicio Cloudflared instalado en el servidor debe apuntar a `http://localhost:5001`.

Comprueba el estado con:

```powershell
docker compose ps
curl http://localhost:5001/api/health
```

El archivo `.env` se versiona porque este repositorio es privado, pero continúa excluido del contexto Docker.

## Seguridad pública

Antes de exponer el dominio, crea una aplicación de Cloudflare Access para `andrestrainer.qzz.io` y limita el acceso al correo del entrenador. Sin Access, cualquier visitante del dominio podría modificar atletas y planes porque la aplicación está pensada inicialmente para un solo entrenador.

## Respaldo entre servidores o dispositivos

- **Descargar base** obtiene atletas, zonas, planes, días y ejercicios en un JSON portable.
- **Restaurar** reemplaza la información de la instalación actual con ese archivo.
- Guarda respaldos periódicos fuera del servidor.

## Desarrollo sin Docker

```powershell
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements-dev.txt
.venv\Scripts\python -m uvicorn app.main:app --reload --port 5001
```

Pruebas:

```powershell
$env:DATA_DIR = "$env:TEMP\master-endurance-tests"
.venv\Scripts\python -m unittest discover -s tests -v
```
