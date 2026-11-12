/**
 * SREI - Inicializador de Base de Datos Limpia para Producción
 * Crea el esquema relacional, catálogos institucionales, condiciones base
 * y ÚNICAMENTE la cuenta de la Directora (admin). Base de datos de estudiantes vacía.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { hashPassword } = require('./auth');

const dbPath = path.join(__dirname, 'database.sqlite');
const schemaPath = path.join(__dirname, 'schema.sql');

console.log('>>> [SREI] Inicializando Base de Datos Limpia para Producción...');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 1. Ejecutar esquema base
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

// 2. Crear tabla de condiciones_diagnosticas y columnas de medicamentos si faltan
db.exec(`
  CREATE TABLE IF NOT EXISTS condiciones_diagnosticas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_condicion TEXT NOT NULL UNIQUE
  );
`);

const cols = db.prepare('PRAGMA table_info(expedientes_medicos)').all();
const colNames = cols.map(c => c.name);
if (!colNames.includes('toma_medicamento')) {
  db.exec("ALTER TABLE expedientes_medicos ADD COLUMN toma_medicamento TEXT NOT NULL DEFAULT 'No';");
}
if (!colNames.includes('medicamento_detalles')) {
  db.exec("ALTER TABLE expedientes_medicos ADD COLUMN medicamento_detalles TEXT;");
}

// 3. Limpiar todas las tablas de datos de estudiantes y docentes de prueba
db.exec(`
  DELETE FROM representantes;
  DELETE FROM expedientes_medicos;
  DELETE FROM estudiantes;
  DELETE FROM usuarios;
  DELETE FROM sqlite_sequence WHERE name IN ('estudiantes', 'expedientes_medicos', 'representantes', 'usuarios');
`);

// 4. Insertar Catálogo de Planteles Oficiales
const planteles = [
  { nombre: 'U.E.E. Prof. Evelio José Aponte', codigo: 'OD-0412', ubicacion: 'Sector Centro' },
  { nombre: 'U.E. Dr. José María Vargas', codigo: 'OD-0821', ubicacion: 'Parroquia Norte' },
  { nombre: 'Liceo Argimiro Gabaldón Márquez', codigo: 'OD-1104', ubicacion: 'Avenida Bolívar' },
  { nombre: 'Liceo Prof. Edgar Amaya "Las Tunas"', codigo: 'OD-1522', ubicacion: 'Comunidad Las Tunas' },
  { nombre: 'Sector Comunitario SREI', codigo: 'OD-9901', ubicacion: 'Atención Comunitaria e Inclusiva' }
];

const insertPlantel = db.prepare(`
  INSERT OR IGNORE INTO instituciones (nombre_institucion, codigo_plantel, ubicacion)
  VALUES (@nombre, @codigo, @ubicacion)
`);
for (const p of planteles) insertPlantel.run(p);

// 5. Insertar Catálogo de Condiciones Diagnósticas Base
const condiciones = [
  'Dificultad para el aprendizaje',
  'Déficit Cognitivo Leve',
  'Déficit Cognitivo Moderado',
  'Autismo / TEA',
  'Síndrome de Asperger',
  'TDAH',
  'Discapacidad Motora/Fina',
  'Epilepsia / Convulsiones',
  'Trastornos del Lenguaje / Dislalias',
  'Discapacidad Visual / Estrabismo',
  'Irritación Cerebral'
];
const insertCond = db.prepare('INSERT OR IGNORE INTO condiciones_diagnosticas (nombre_condicion) VALUES (?)');
for (const c of condiciones) insertCond.run(c);

// 6. Crear ÚNICAMENTE la cuenta Administradora de la Directora
const adminPassword = process.env.ADMIN_DEFAULT_PASSWORD || 'Admin123*';
const adminEmail = process.env.ADMIN_DEFAULT_EMAIL || 'director@srei.edu';
const adminHash = hashPassword(adminPassword);

const insertUsuario = db.prepare(`
  INSERT INTO usuarios (
    email, nombre_completo, password_hash, rol, estado, email_verificado
  ) VALUES (
    @email, @nombre_completo, @password_hash, @rol, @estado, @email_verificado
  )
`);

insertUsuario.run({
  email: adminEmail,
  nombre_completo: 'Magister Amparo Aguilar (Directora)',
  password_hash: adminHash,
  rol: 'admin',
  estado: 'activo',
  email_verificado: 1
});

console.log('===========================================================');
console.log('✅ BASE DE DATOS LIMPIA CREADA CON ÉXITO');
console.log(`- Cuenta Directora: ${adminEmail}`);
console.log(`- Clave Inicial: ${adminPassword}`);
console.log(`- Total Estudiantes: 0 (Vacía para datos reales)`);
console.log(`- Planteles precargados: ${planteles.length}`);
console.log(`- Condiciones precargadas: ${condiciones.length}`);
console.log('===========================================================');

db.close();
