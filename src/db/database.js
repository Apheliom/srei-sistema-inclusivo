const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database.sqlite');
const schemaPath = path.join(__dirname, 'schema.sql');

const db = new Database(dbPath);

// Habilitar modo WAL y Claves Foráneas
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Si la tabla antigua tenía el formato preliminar plano, se reconstruye limpiamente
try {
  const info = db.prepare("PRAGMA table_info(estudiantes)").all();
  const isOldSchema = info.length > 0 && info.some(c => c.name === 'condicion_inclusion');
  if (isOldSchema) {
    db.exec('DROP TABLE IF EXISTS estudiantes;');
    console.log('[DB Migration] Migrando esquema preliminar hacia estructura relacional normalizada de 4 bloques.');
  }
} catch (e) {
  // Sin tablas previas
}

// Inicializar esquema relacional completo
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

// Migración de borrado lógico (columna activo)
try {
  const infoEst = db.prepare("PRAGMA table_info(estudiantes)").all();
  if (!infoEst.some(c => c.name === 'activo')) {
    db.exec("ALTER TABLE estudiantes ADD COLUMN activo INTEGER NOT NULL DEFAULT 1;");
  }
} catch (e) {}

try {
  const infoInst = db.prepare("PRAGMA table_info(instituciones)").all();
  if (!infoInst.some(c => c.name === 'activo')) {
    db.exec("ALTER TABLE instituciones ADD COLUMN activo INTEGER NOT NULL DEFAULT 1;");
  }
} catch (e) {}

try {
  const infoCond = db.prepare("PRAGMA table_info(condiciones_diagnosticas)").all();
  if (!infoCond.some(c => c.name === 'activo')) {
    db.exec("ALTER TABLE condiciones_diagnosticas ADD COLUMN activo INTEGER NOT NULL DEFAULT 1;");
  }
} catch (e) {}

// Garantizar creación de tabla bitácora
try {
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_bitacora_created ON bitacora(created_at);
    CREATE INDEX IF NOT EXISTS idx_bitacora_modulo ON bitacora(modulo);
  `);
} catch (e) {}

module.exports = db;
