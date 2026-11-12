const db = require('./database');
const { hashPassword } = require('./auth');

// 1. Instituciones Escolares del Servicio Comunitario
const planteles = [
  { nombre: 'U.E.E. Prof. Evelio José Aponte', codigo: 'OD-0412', ubicacion: 'Sector Centro' },
  { nombre: 'U.E. Dr. José María Vargas', codigo: 'OD-0821', ubicacion: 'Parroquia Norte' },
  { nombre: 'Liceo Argimiro Gabaldón Márquez', codigo: 'OD-1104', ubicacion: 'Avenida Bolívar' },
  { nombre: 'Liceo Prof. Edgar Amaya "Las Tunas"', codigo: 'OD-1522', ubicacion: 'Comunidad Las Tunas' }
];

const insertPlantel = db.prepare(`
  INSERT OR IGNORE INTO instituciones (nombre_institucion, codigo_plantel, ubicacion)
  VALUES (@nombre, @codigo, @ubicacion)
`);

for (const p of planteles) insertPlantel.run(p);

// 2. Usuarios del Sistema
const adminHash = hashPassword('Admin123*');
const docenteHash = hashPassword('Docente123*');

const insertUsuario = db.prepare(`
  INSERT OR IGNORE INTO usuarios (
    email, nombre_completo, password_hash, rol, estado, email_verificado
  ) VALUES (
    @email, @nombre_completo, @password_hash, @rol, @estado, @email_verificado
  )
`);

insertUsuario.run({
  email: 'director@srei.edu',
  nombre_completo: 'Magister Amparo Aguilar (Directora)',
  password_hash: adminHash,
  rol: 'admin',
  estado: 'activo',
  email_verificado: 1
});

insertUsuario.run({
  email: 'docente.marquez@srei.edu',
  nombre_completo: 'Profa. Carolina Márquez',
  password_hash: docenteHash,
  rol: 'profesor',
  estado: 'pendiente_aprobacion',
  email_verificado: 1
});

// 3. Expedientes Estudiantiles de Ejemplo (Estructura de 4 Bloques Normalizada)
const expedientesEjemplo = [
  {
    institucion_nombre: 'U.E.E. Prof. Evelio José Aponte',
    numero_orden: 1,
    nombres_apellidos: 'Mateo Alejandro García Rivas',
    cedula_identidad: 'V-32145890',
    fecha_nacimiento: '2016-04-12',
    sexo: 'Masculino',
    grado_seccion: '3er Grado "A"',
    condicion: 'Dificultad para el aprendizaje',
    estatus_diagnostico: 'Diagnóstico Médico Verificado',
    observaciones: 'Requiere material de lectura adaptado en macrotipo y pausas supervisadas durante las evaluaciones.',
    atencion_psicologica: 'Sí',
    entrevista_social: 'Realizada',
    informe_integral: 'Listo',
    nombre_representante: 'Carmen Rivas',
    cedula_representante: 'V-15432987',
    telefono: '04141234567',
    parentesco: 'Madre'
  },
  {
    institucion_nombre: 'U.E. Dr. José María Vargas',
    numero_orden: 2,
    nombres_apellidos: 'Sofía Valentina Mendoza Pérez',
    cedula_identidad: 'V-31987654',
    fecha_nacimiento: '2015-09-28',
    sexo: 'Femenino',
    grado_seccion: '4to Grado "B"',
    condicion: 'Autismo / TEA',
    estatus_diagnostico: 'Diagnóstico Médico Verificado',
    observaciones: 'Apoyo con pictogramas visuales para rutinas diarias y ambiente de bajo estímulo sonoro.',
    atencion_psicologica: 'En proceso',
    entrevista_social: 'Realizada',
    informe_integral: 'En proceso',
    nombre_representante: 'Roberto Mendoza',
    cedula_representante: 'V-14223114',
    telefono: '04249876543',
    parentesco: 'Padre'
  },
  {
    institucion_nombre: 'Liceo Argimiro Gabaldón Márquez',
    numero_orden: 3,
    nombres_apellidos: 'Diego José Morales Silva',
    cedula_identidad: 'V-30554123',
    fecha_nacimiento: '2011-02-15',
    sexo: 'Masculino',
    grado_seccion: '1er Año "U"',
    condicion: 'Discapacidad Motora/Fina',
    estatus_diagnostico: 'En Proceso de Evaluación',
    observaciones: 'Movilidad reducida. Rampa de acceso despejada y pupitre adaptado a nivel ergonómico.',
    atencion_psicologica: 'No',
    entrevista_social: 'Pendiente',
    informe_integral: 'Falta informe psicológico',
    nombre_representante: 'Elena Silva',
    cedula_representante: 'V-12998345',
    telefono: '04125551234',
    parentesco: 'Madre'
  }
];

const insertAllExpedientes = db.transaction((lista) => {
  for (const exp of lista) {
    const inst = db.prepare('SELECT id FROM instituciones WHERE nombre_institucion = ?').get(exp.institucion_nombre);
    const instId = inst ? inst.id : 1;

    // 1. Estudiante
    const resEst = db.prepare(`
      INSERT OR IGNORE INTO estudiantes (
        institucion_id, numero_orden, nombres_apellidos, cedula_identidad,
        fecha_nacimiento, sexo, grado_seccion, registrado_por
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      instId, exp.numero_orden, exp.nombres_apellidos, exp.cedula_identidad,
      exp.fecha_nacimiento, exp.sexo, exp.grado_seccion
    );

    const estId = resEst.lastInsertRowid || db.prepare('SELECT id FROM estudiantes WHERE cedula_identidad = ?').get(exp.cedula_identidad).id;

    // 2. Expediente Médico y Checklist Digital
    db.prepare(`
      INSERT OR REPLACE INTO expedientes_medicos (
        estudiante_id, condicion, estatus_diagnostico, observaciones,
        atencion_psicologica, entrevista_social, informe_integral
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      estId, exp.condicion, exp.estatus_diagnostico, exp.observaciones,
      exp.atencion_psicologica, exp.entrevista_social, exp.informe_integral
    );

    // 3. Representante
    db.prepare(`
      INSERT OR REPLACE INTO representantes (
        estudiante_id, nombre_representante, cedula_representante, telefono, parentesco
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      estId, exp.nombre_representante, exp.cedula_representante, exp.telefono, exp.parentesco
    );
  }
});

insertAllExpedientes(expedientesEjemplo);
console.log('Semillas relacionales de Instituciones, Usuarios y Expedientes Estudiantiles cargadas.');
