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

module.exports = db;
