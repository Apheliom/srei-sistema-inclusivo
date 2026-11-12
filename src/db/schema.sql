-- ====================================================================
-- Esquema Normalizado Relacional para SREI (Expediente Estudiantil Inclusivo)
-- Compatible 1:1 con SQLite local y PostgreSQL / Supabase / MySQL
-- ====================================================================

-- 1. Tabla de Instituciones Educativas / Planteles Escolares
CREATE TABLE IF NOT EXISTS instituciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_institucion TEXT NOT NULL UNIQUE,
  codigo_plantel TEXT,
  ubicacion TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_instituciones_nombre ON instituciones(nombre_institucion);

-- 2. Tabla de Usuarios y Roles (Director / Docentes)
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  nombre_completo TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'profesor' CHECK(rol IN ('admin', 'profesor')),
  estado TEXT NOT NULL DEFAULT 'pendiente_verificacion' CHECK(estado IN ('pendiente_verificacion', 'pendiente_aprobacion', 'activo', 'inactivo')),
  codigo_verificacion TEXT,
  codigo_expira DATETIME,
  email_verificado INTEGER DEFAULT 0,
  aprobado_por INTEGER REFERENCES usuarios(id),
  aprobado_en DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
CREATE INDEX IF NOT EXISTS idx_usuarios_rol ON usuarios(rol);
CREATE INDEX IF NOT EXISTS idx_usuarios_estado ON usuarios(estado);

-- 3. Tabla Principal de Estudiantes (Bloque 1: Identificación Institucional)
CREATE TABLE IF NOT EXISTS estudiantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  institucion_id INTEGER NOT NULL REFERENCES instituciones(id),
  numero_orden INTEGER,
  nombres_apellidos TEXT NOT NULL,
  cedula_identidad TEXT NOT NULL UNIQUE,
  fecha_nacimiento DATE NOT NULL,
  sexo TEXT NOT NULL CHECK(sexo IN ('Masculino', 'Femenino')),
  grado_seccion TEXT NOT NULL,
  registrado_por INTEGER REFERENCES usuarios(id),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_estudiantes_cedula ON estudiantes(cedula_identidad);
CREATE INDEX IF NOT EXISTS idx_estudiantes_institucion ON estudiantes(institucion_id);
CREATE INDEX IF NOT EXISTS idx_estudiantes_grado ON estudiantes(grado_seccion);
CREATE INDEX IF NOT EXISTS idx_estudiantes_registrado_por ON estudiantes(registrado_por);

-- 4. Tabla de Expedientes Médicos y Diagnósticos (Bloques 2 y 4: Situación Especial y Checklist Digital)
CREATE TABLE IF NOT EXISTS expedientes_medicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estudiante_id INTEGER NOT NULL UNIQUE REFERENCES estudiantes(id) ON DELETE CASCADE,
  condicion TEXT NOT NULL,
  estatus_diagnostico TEXT NOT NULL CHECK(estatus_diagnostico IN ('Diagnóstico Médico Verificado', 'En Proceso de Evaluación', 'Posible Proyección / Por Evaluar')),
  observaciones TEXT,
  atencion_psicologica TEXT NOT NULL DEFAULT 'No' CHECK(atencion_psicologica IN ('Sí', 'No', 'En proceso')),
  entrevista_social TEXT NOT NULL DEFAULT 'Pendiente' CHECK(entrevista_social IN ('Realizada', 'Pendiente')),
  informe_integral TEXT NOT NULL DEFAULT 'En proceso' CHECK(informe_integral IN ('Listo', 'En proceso', 'Falta informe psicológico')),
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_expedientes_estudiante ON expedientes_medicos(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_expedientes_condicion ON expedientes_medicos(condicion);
CREATE INDEX IF NOT EXISTS idx_expedientes_estatus ON expedientes_medicos(estatus_diagnostico);

-- 5. Tabla de Representantes Legales (Bloque 3: Información de Contacto)
CREATE TABLE IF NOT EXISTS representantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estudiante_id INTEGER NOT NULL UNIQUE REFERENCES estudiantes(id) ON DELETE CASCADE,
  nombre_representante TEXT NOT NULL,
  cedula_representante TEXT,
  telefono TEXT NOT NULL,
  parentesco TEXT NOT NULL DEFAULT 'Representante Legal'
);

CREATE INDEX IF NOT EXISTS idx_representantes_estudiante ON representantes(estudiante_id);
CREATE INDEX IF NOT EXISTS idx_representantes_telefono ON representantes(telefono);
