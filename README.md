# Ahorro U

Aplicación personal para planear y registrar el ahorro destinado a una carrera
universitaria. Mantiene separados el **Ahorro ideal**, el **Ahorro real** y la
**Proyección actualizada**; la integración del backend no modifica sus fórmulas
ni validaciones financieras.

> **Esta aplicación no tiene autenticación.** Cualquier persona con la URL
> pública puede ver y modificar los datos mientras el servidor esté activo.
> Publica únicamente el puerto del frontend y desactívalo cuando no lo uses.

La aplicación no se conecta con bancos, no mueve dinero y sus proyecciones no
constituyen una garantía financiera.

## Arquitectura

```text
Dispositivos externos
        ↓
Puerto público de Vite (0.0.0.0:5173)
        ↓
Frontend React
        ↓  /api
Proxy interno de Vite
        ↓
Express (127.0.0.1:3001)
        ↓
SQLite local
```

Solo se debe compartir el puerto de Vite. El navegador usa rutas relativas como
`/api/state`; nunca necesita conocer el puerto 3001. Express escucha
exclusivamente en `127.0.0.1`.

SQLite es la fuente única de verdad financiera. La base se crea en
`data/ahorro-u.sqlite`, fuera de `src`, `public` y `dist`. Las carpetas `data` y
`backups` no se sirven por HTTP.

## Instalación y ejecución

Requiere Node.js 22 o superior.

```bash
npm install
npm run dev
```

`npm run dev` inicia conjuntamente el backend y Vite. Al detener el comando,
`concurrently -k` finaliza ambos procesos.

Scripts disponibles:

| Script | Función |
|---|---|
| `npm run dev` | Inicia frontend y backend en modo desarrollo |
| `npm run dev:web` | Inicia únicamente Vite en `0.0.0.0` |
| `npm run dev:server` | Inicia Express con recarga mediante `tsx` |
| `npm run build` | Valida TypeScript y compila frontend y backend |
| `npm run build:server` | Genera `server-dist/index.js` |
| `npm start` | Inicia el backend compilado |
| `npm test` | Ejecuta toda la suite |

Para acceso externo mediante VS Code, publica el puerto del frontend que
muestre Vite, normalmente `5173`. No publiques `3001`.

Documentos del repositorio:

- [`SECURITY.md`](SECURITY.md): modelo sin autenticación y uso seguro del puerto
  público.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): reglas de desarrollo, pruebas y manejo
  de datos locales.

## API

| Método | Ruta | Uso |
|---|---|---|
| `GET` | `/api/health` | Estado ligero, revisión y fecha; no devuelve información financiera |
| `GET` | `/api/state` | Estado completo compartido |
| `PUT` | `/api/state` | Guardado validado con `expectedRevision` |
| `POST` | `/api/backups` | Crea un respaldo SQLite con nombre controlado por el servidor |

El cuerpo máximo es 5 MB. El backend valida nuevamente todo estado recibido,
usa consultas preparadas y escribe dentro de una transacción. Un error incluye
la ruta del campo cuando corresponde, sin devolver trazas internas.

La tabla principal contiene una sola fila:

```sql
CREATE TABLE app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

El documento JSON conserva configuración, movimientos y trazabilidad necesarios
para recalcular resultados; no almacena únicamente valores calculados. SQLite
usa WAL y claves foráneas activadas.

## Carga, guardado y sincronización

Al abrir la aplicación, el frontend espera `GET /api/state`. No presenta valores
predeterminados como datos reales. Si el backend no responde, muestra un error,
mantiene deshabilitada la interfaz financiera y permite reintentar.

Cada cambio válido queda pendiente y se guarda tras un debounce de 800 ms.
También existe **Guardar ahora**. La interfaz diferencia: sin cambios, cambios
pendientes, guardando, guardado, error, conflicto y servidor desconectado.

Cada escritura envía la revisión conocida. Si otro dispositivo ya guardó, el
backend responde `409 Conflict` y conserva el estado vigente. El cliente no
sobrescribe ni mezcla estados automáticamente: permite recargar desde el
servidor, conservar y exportar la edición local, o exportarla antes de
descartarla.

El frontend consulta `/api/health` cada 5 segundos:

- Si la revisión no cambió, no hace nada.
- Si cambió y no hay ediciones locales, descarga y aplica el nuevo estado.
- Si cambió y hay ediciones pendientes, muestra el conflicto sin sobrescribir.
- Tras una desconexión, conserva cambios y reintenta cuando la salud se recupera.

## Migración desde el navegador

`ahorro-u-data-v2` ya no es una fuente activa. Solo se consulta para ofrecer una
migración explícita cuando SQLite continúa en su revisión inicial.

El usuario puede migrar, descargar primero el JSON o ignorar la propuesta. La
migración:

1. Valida el estado local.
2. Crea un respaldo SQLite.
3. Guarda con control de revisión.
4. Vuelve a consultar el servidor.
5. Compara el estado completo.
6. Conserva una copia en `ahorro-u-data-v2-migrated-backup`.
7. Elimina la clave financiera activa y marca la migración como completada.

Una migración inválida o en conflicto conserva los datos del navegador. Un
dispositivo remoto no puede migrar sobre un estado compartido que ya fue
modificado.

## Importación, exportación y respaldos

El JSON sigue siendo el respaldo completo, descargable e importable. La
exportación normal contiene la última versión confirmada en SQLite; si hay
cambios locales pendientes, la interfaz lo advierte. También puede exportarse
la edición local durante un conflicto.

Antes de importar, el frontend valida, resume el contenido y pide confirmación.
Luego crea un respaldo SQLite, el backend valida nuevamente, guarda
transaccionalmente e incrementa la revisión. Una importación inválida no cambia
el estado.

Los respaldos SQLite se guardan como:

```text
backups/ahorro-u-AAAA-MM-DD-HH-mm-ss.sqlite
```

El backend crea como máximo uno automático al día y permite crear uno manual
desde la interfaz. El cliente no controla nombre, ruta ni extensión y no existe
una ruta pública para descargarlos.

Los CSV continúan siendo vistas auditables. El JSON, no el CSV ni SQLite
expuesto, es el respaldo portable recomendado.

## Qué permanece en `localStorage`

- Tema claro u oscuro (`ahorro-u-theme`).
- Indicador de migración completada.
- Copia temporal posterior a una migración verificada.
- Otras preferencias visuales que se agreguen en el futuro.

El estado financiero activo se carga y se guarda únicamente mediante SQLite.

## Recuperación y seguridad

- Un estado SQLite existente se valida al iniciar. Si es inválido o incompatible,
  el servidor falla de forma visible y no lo reemplaza por valores iniciales.
- Reiniciar no duplica filas, restaura valores ni incrementa la revisión.
- Las validaciones rechazan versiones incompatibles, duplicados, fechas, meses,
  enums, timestamps, números, saldos, retenciones, conciliaciones, traslados y
  matrículas inválidas.
- No hay CORS general, endpoints SQL, rutas arbitrarias, ejecución dinámica ni
  registro del contenido financiero completo.
- `helmet` agrega encabezados básicos.
- `data`, `backups`, `dist` y `server-dist` están excluidos según corresponda
  del control de versiones.

La ausencia de autenticación es intencional en esta etapa y constituye el
principal riesgo: cualquier persona con la URL pública tiene control completo
mientras el puerto esté habilitado.

## Funcionalidad financiera conservada

- **Ahorro ideal:** escenarios, ingresos, prima, tasas, retención, GMF,
  matrículas, concentración y traslados.
- **Ahorro real:** movimientos confirmados, borradores aislados, rendimiento Nu,
  pagos, conciliaciones y revisiones.
- **Proyección actualizada:** continúa desde el último cierre real elegible.
- **Ideal vs Real:** diferencias de aportes, rendimiento, pagos, saldos y
  patrimonio.

Los motores siguen usando `Decimal.js`. Borradores, duplicados, registros
inválidos y cierres con diferencias pendientes no afectan resultados definitivos.

## Estructura principal

```text
server/app.ts                  Rutas y errores HTTP
server/database.ts             SQLite y transacciones
server/validation.ts           Validación profunda del servidor
server/backup.ts               Respaldos manuales y diarios
server/index.ts                Inicialización y escucha local
src/services/stateApi.ts       Comunicación centralizada del frontend
src/services/migration.ts      Migración única desde localStorage
src/services/syncPolicy.ts     Debounce y decisiones de revisión
src/App.tsx                    Carga, guardado, sincronización e interfaz
src/domain/                    Motores y tipos financieros
src/utils/storage.ts           Esquema JSON y validador compartido
```

## Validación del 28 de julio de 2026

Comandos ejecutados realmente:

```bash
npm install
npm test
npm run build
npm audit
npm audit --omit=dev
npm run dev
```

Resultados:

- 139 pruebas superadas en 9 archivos: las 88 originales y 51 nuevas.
- Persistencia, reinicio, dos clientes, conflicto 409, respaldos, migración,
  proxy y equivalencia financiera verificados con SQLite temporal o ejecución
  local reproducible.
- Frontend servido por Vite y `/api/health` accesible mediante el proxy.
- Estado conservado después de reiniciar el backend compilado.
- Frontend: 2.211 módulos; JS 748,83 kB (211,43 kB gzip); CSS 63,75 kB
  (13,71 kB gzip).
- Backend compilado: 49,7 kB.
- `npm audit`: 0 vulnerabilidades.
- `npm audit --omit=dev`: 0 vulnerabilidades.

Permanece la advertencia informativa de Vite por un paquete JavaScript superior
a 500 kB. La interfaz se verificó en navegador conectado, en escritorio y
móvil, con modo claro y oscuro, navegación, menú responsive y estado del
servidor. No se detectaron errores de consola ni desbordamiento horizontal.

`npm ci` puede mostrar una advertencia de obsolescencia para Recharts 2.x. No
bloquea la instalación ni las pruebas; la migración a Recharts 3 queda pendiente
porque requiere validar compatibilidad visual y funcional.
