# Contribuir

## Preparar el proyecto

```bash
npm install
npm run dev
```

Antes de proponer un cambio:

```bash
npm test
npm run build
```

## Reglas del dominio

- Mantén separados Ahorro ideal, Ahorro real y Proyección actualizada.
- No permitas que borradores o registros inválidos afecten resultados
  definitivos.
- No cambies fórmulas financieras sin agregar pruebas de regresión.
- No debilites pruebas existentes para hacer pasar un cambio.
- Usa bases SQLite temporales en pruebas; nunca ejecutes pruebas destructivas
  contra `data/ahorro-u.sqlite`.
- No registres en consola el estado financiero completo.

## Datos y archivos locales

No confirmes en Git:

- `node_modules`, `dist` o `server-dist`.
- `data`, `backups` o archivos SQLite.
- Respaldos JSON o CSV con datos reales.
- Archivos de editor, variables locales o rutas del equipo.

Los cambios deben incluir solamente código, pruebas y documentación
reproducibles.
