# Descubrimientos Técnicos - SREI Sistema Inclusivo

## 1. Módulo de Bitácora y Auditoría
- Servicio implementado en `src/services/bitacoraService.js`:
  - Firma: `registrarBitacora(req, accion, modulo, detalles, db, usuarioOverride = null)`
  - Registra: `usuario_id`, `usuario_nombre`, `usuario_email`, `usuario_rol`, `accion`, `modulo`, `detalles`, `ip_address`, `created_at`.
- Tabla implementada y sincronizada en SQLite y Supabase PostgreSQL:
  - Verificada en arranque con `pullFromSupabase`.
  - Endpoint operativo: `GET /api/admin/bitacora`.

## 2. Diagnóstico de Problemas en Modo Móvil (Teléfono)
- **Botones de Navegación Cortados / Desbordados**:
  - En pantallas móviles (< 768px), el header intentaba colocar el logo, los 3 botones con texto e iconos largos, la información de usuario y el botón de logout en una sola fila `h-16 flex items-center justify-between`.
  - Solución arquitectónica: Header adaptativo de 2 niveles en móvil: Nivel 1 con logo e identidad + logout; Nivel 2 con barra segmentada `grid grid-cols-3 gap-1` o `flex` de ancho completo, garantizando que los botones "Estudiantes", "Docentes" y "Bitácora" se lean completos y tengan área táctil óptima sin truncamiento.
- **Bitácora HTML Bugueada en Móvil**:
  - `public/bitacora.html` utilizaba `@tailwindcss/browser@4` que presentaba incompatibilidades con clases utilitarias y fallas en navegadores móviles.
  - Se sustituye por el motor estable `tailwindcss 3` con plugins de formularios y configuración unificada idéntica a `estudiantes.html`.
  - Reestructuración de tarjetas móviles, filtros responsive y espaciado adaptativo.
- **Modal de "Nuevo Expediente" con Problemas de Tamaño**:
  - En móviles, el contenedor `#formExpedienteModal` usaba `items-center` con `overflow-y-auto` en el wrapper y el modal, lo que causaba doble scroll, cortes en el encabezado y desbordamiento de botones en pantallas pequeñas.
  - Se refactoriza a modal flex con encabezado fijo, cuerpo scrolleable y pie de acción fijo inferior ("Cancelar" y "Guardar Expediente" siempre a la vista sin scroll forzado).
  - Los encabezados de bloques (como "+ Nuevo Plantel" y "Renombrar") se adaptan con `flex-col sm:flex-row` para evitar colisión con las etiquetas en pantallas estrechas.
