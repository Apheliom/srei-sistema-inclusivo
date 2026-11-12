const db = require('./database');

// 1. Tabla condiciones_diagnosticas
db.exec(`
  CREATE TABLE IF NOT EXISTS condiciones_diagnosticas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre_condicion TEXT NOT NULL UNIQUE
  );
`);

// 2. Columnas de medicamentos en expedientes_medicos
const cols = db.prepare('PRAGMA table_info(expedientes_medicos)').all();
const colNames = cols.map(c => c.name);

if (!colNames.includes('toma_medicamento')) {
  db.exec("ALTER TABLE expedientes_medicos ADD COLUMN toma_medicamento TEXT NOT NULL DEFAULT 'No';");
}
if (!colNames.includes('medicamento_detalles')) {
  db.exec("ALTER TABLE expedientes_medicos ADD COLUMN medicamento_detalles TEXT;");
}

// 3. Sembrar condiciones base
const condicionesIniciales = [
  'Dificultad para el aprendizaje',
  'Déficit Cognitivo Leve',
  'Déficit Cognitivo Moderado',
  'Autismo / TEA',
  'TDAH',
  'Discapacidad Motora/Fina',
  'Epilepsia / Convulsiones',
  'Trastornos del Lenguaje / Dislalias',
  'Discapacidad Visual / Estrabismo',
  'Irritación Cerebral'
];

const insertCond = db.prepare('INSERT OR IGNORE INTO condiciones_diagnosticas (nombre_condicion) VALUES (?)');
condicionesIniciales.forEach(c => insertCond.run(c));

// Agregar las condiciones que ya estén en estudiantes existentes
const existentes = db.prepare('SELECT DISTINCT condicion FROM expedientes_medicos').all();
existentes.forEach(row => {
  if (row.condicion && row.condicion.trim()) {
    insertCond.run(row.condicion.trim());
  }
});

console.log('Migración DB OK');

