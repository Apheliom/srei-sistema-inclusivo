# Descubrimientos Técnicos - SREI Sistema Inclusivo

## 1. Módulo de Bitácora y Auditoría
- Servicio implementado en `src/services/bitacoraService.js`:
  - Firma: `registrarBitacora(req, accion, modulo, detalles, db, usuarioOverride = null)`
  - Registra: `usuario_id`, `usuario_nombre`, `usuario_email`, `usuario_rol`, `accion`, `modulo`, `detalles`, `ip_address`, `created_at`.
- Tabla requerida en SQLite y Supabase PostgreSQL:
  ```sql
  CREATE TABLE IF NOT EXISTS bitacora (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario_id INTEGER,
    usuario_nombre TEXT,
    usuario_email TEXT,
    usuario_rol TEXT,
    accion TEXT NOT NULL,
    modulo TEXT NOT NULL,
    detalles TEXT NOT NULL,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  ```

## 2. Errores Identificados en Capturas de Pantalla del Usuario
- **Render Error Environment Variable**: En la captura 2, el usuario pegó la URL de conexión completa `postgresql://...` en el campo **KEY** en lugar de poner `DATABASE_URL` en KEY y la URL en **VALUE**. Render rechazó la clave con el error: `Environment variable keys must consist of alphabetic characters, digits, '_', '-', or '.', and must not start with a digit`.
- **GitHub Repository Missing Folders**: En la captura 1, el repositorio `Apheliom/srei-sistema-inclusivo` en GitHub solo contenía archivos sueltos de la raíz (`.env.example`, `.gitignore`, `README.md`, `package-lock.json`, `package.json`, `server.js`). Faltan completamente las carpetas `src/` y `public/`. Por eso Render falló con `Cannot find module './src/server.js'`.

## 3. Plan de Integración
1. Asegurar tabla `bitacora` en `src/db/database.js` y `src/db/supabase_sync.js`.
2. Instrumentar rutas de `src/server.js` y habilitar endpoint `GET /api/admin/bitacora`.
3. Crear vista `public/bitacora.html` y vincular pestañas de navegación en `estudiantes.html`, `admin.html` y `docentes.html`.
4. Empaquetar el ZIP completo en el Escritorio con la estructura de carpetas lista para arrastrar o subir a GitHub.
