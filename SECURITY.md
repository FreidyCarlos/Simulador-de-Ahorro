# Seguridad

## Modelo de acceso

Ahorro U es una aplicación personal sin autenticación. Mientras el puerto de
Vite esté publicado, cualquier persona que conozca su URL puede consultar y
modificar el estado financiero compartido.

Recomendaciones:

- Publica únicamente el puerto del frontend, normalmente `5173`.
- No publiques directamente el puerto `3001`.
- Deshabilita el puerto público cuando termines de usar la aplicación.
- No subas `data`, `backups`, archivos SQLite ni respaldos JSON con información
  real al repositorio.
- Conserva los respaldos importantes fuera de carpetas sincronizadas o públicas.

El backend escucha únicamente en `127.0.0.1:3001`, valida cada escritura y no
expone rutas para descargar SQLite, leer archivos o ejecutar SQL arbitrario.

## Reportar un problema

No incluyas información financiera, respaldos, URLs públicas activas ni datos
personales en un issue. Si el repositorio tiene habilitados los avisos privados
de seguridad de GitHub, utiliza ese canal para reportar vulnerabilidades.
