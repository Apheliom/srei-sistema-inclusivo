/**
 * SREI - Módulo de Sincronización Automática con Supabase PostgreSQL
 * Mantiene la base de datos en la nube de Supabase sincronizada en tiempo real
 * con SQLite para persistencia indestructible y lectura de alta velocidad.
 */

const { Pool } = require('pg');

let pool = null;
let isConnected = false;

function getSupabasePool() {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });

  pool.on('error', (err) => {
    console.error('[Supabase Sync] Error inesperado en el pool de conexiones:', err.message);
  });

  return pool;
}

/**
 * Al iniciar el servidor: Descarga todos los datos de Supabase hacia SQLite
 * para que ningún dato se pierda aunque Render se haya reiniciado.
 */
async function pullFromSupabase(db) {
  const p = getSupabasePool();
  if (!p) {
    console.log('[Supabase Sync] DATABASE_URL no configurada. Operando en modo SQLite local.');
    return;
  }

  try {
    console.log('[Supabase Sync] Conectando a Supabase PostgreSQL para restaurar datos...');
    const client = await p.connect();
    isConnected = true;

    // 1. Instituciones
    const resInst = await client.query('SELECT id, nombre_institucion, codigo_plantel, ubicacion FROM public.instituciones ORDER BY id ASC');
    if (resInst.rows.length > 0) {
      const insStmt = db.prepare('INSERT OR REPLACE INTO instituciones (id, nombre_institucion, codigo_plantel, ubicacion) VALUES (?, ?, ?, ?)');
      for (const r of resInst.rows) insStmt.run(r.id, r.nombre_institucion, r.codigo_plantel, r.ubicacion);
    }

    // 2. Condiciones Diagnósticas
    try {
      const resCond = await client.query('SELECT id, nombre_condicion FROM public.condiciones_diagnosticas ORDER BY id ASC');
      if (resCond.rows.length > 0) {
        const condStmt = db.prepare('INSERT OR REPLACE INTO condiciones_diagnosticas (id, nombre_condicion) VALUES (?, ?)');
        for (const r of resCond.rows) condStmt.run(r.id, r.nombre_condicion);
      }
    } catch (e) { /* tabla opcional en versiones previas */ }

    // 3. Usuarios
    const resUsers = await client.query('SELECT id, email, nombre_completo, password_hash, rol, estado, email_verificado FROM public.usuarios ORDER BY id ASC');
    if (resUsers.rows.length > 0) {
      const userStmt = db.prepare('INSERT OR REPLACE INTO usuarios (id, email, nombre_completo, password_hash, rol, estado, email_verificado) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const r of resUsers.rows) userStmt.run(r.id, r.email, r.nombre_completo, r.password_hash, r.rol, r.estado, r.email_verificado);
    }

    // 4. Estudiantes
    const resEst = await client.query('SELECT id, institucion_id, numero_orden, nombres_apellidos, cedula_identidad, fecha_nacimiento, sexo, grado_seccion, registrado_por FROM public.estudiantes ORDER BY id ASC');
    if (resEst.rows.length > 0) {
      const estStmt = db.prepare('INSERT OR REPLACE INTO estudiantes (id, institucion_id, numero_orden, nombres_apellidos, cedula_identidad, fecha_nacimiento, sexo, grado_seccion, registrado_por) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of resEst.rows) {
        const fecha = r.fecha_nacimiento instanceof Date ? r.fecha_nacimiento.toISOString().split('T')[0] : r.fecha_nacimiento;
        estStmt.run(r.id, r.institucion_id, r.numero_orden, r.nombres_apellidos, r.cedula_identidad, fecha, r.sexo, r.grado_seccion, r.registrado_por);
      }
    }

    // 5. Expedientes Médicos
    const resExp = await client.query('SELECT id, estudiante_id, condicion, estatus_diagnostico, observaciones, atencion_psicologica, entrevista_social, informe_integral, toma_medicamento, medicamento_detalles FROM public.expedientes_medicos ORDER BY id ASC');
    if (resExp.rows.length > 0) {
      const expStmt = db.prepare('INSERT OR REPLACE INTO expedientes_medicos (id, estudiante_id, condicion, estatus_diagnostico, observaciones, atencion_psicologica, entrevista_social, informe_integral, toma_medicamento, medicamento_detalles) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      for (const r of resExp.rows) {
        expStmt.run(r.id, r.estudiante_id, r.condicion, r.estatus_diagnostico, r.observaciones, r.atencion_psicologica, r.entrevista_social, r.informe_integral, r.toma_medicamento || 'No', r.medicamento_detalles || null);
      }
    }

    // 6. Representantes
    const resRep = await client.query('SELECT id, estudiante_id, nombre_representante, cedula_representante, telefono, parentesco FROM public.representantes ORDER BY id ASC');
    if (resRep.rows.length > 0) {
      const repStmt = db.prepare('INSERT OR REPLACE INTO representantes (id, estudiante_id, nombre_representante, cedula_representante, telefono, parentesco) VALUES (?, ?, ?, ?, ?, ?)');
      for (const r of resRep.rows) repStmt.run(r.id, r.estudiante_id, r.nombre_representante, r.cedula_representante, r.telefono, r.parentesco);
    }

    client.release();
    console.log(`[Supabase Sync] ✅ Sincronización exitosa desde la nube: ${resEst.rows.length} estudiantes, ${resUsers.rows.length} usuarios, ${resInst.rows.length} planteles.`);
  } catch (err) {
    console.error('[Supabase Sync] Advertencia al sincronizar desde Supabase:', err.message);
  }
}

/**
 * Sube inmediatamente todo el estado de una tabla hacia Supabase
 */
async function syncTableToSupabase(tableName, db) {
  const p = getSupabasePool();
  if (!p) return;

  try {
    const client = await p.connect();
    try {
      if (tableName === 'estudiantes') {
        const rows = db.prepare('SELECT * FROM estudiantes').all();
        await client.query('DELETE FROM public.estudiantes');
        for (const r of rows) {
          await client.query(
            `INSERT INTO public.estudiantes (id, institucion_id, numero_orden, nombres_apellidos, cedula_identidad, fecha_nacimiento, sexo, grado_seccion, registrado_por)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [r.id, r.institucion_id, r.numero_orden, r.nombres_apellidos, r.cedula_identidad, r.fecha_nacimiento, r.sexo, r.grado_seccion, r.registrado_por]
          );
        }
      } else if (tableName === 'expedientes_medicos') {
        const rows = db.prepare('SELECT * FROM expedientes_medicos').all();
        await client.query('DELETE FROM public.expedientes_medicos');
        for (const r of rows) {
          await client.query(
            `INSERT INTO public.expedientes_medicos (id, estudiante_id, condicion, estatus_diagnostico, observaciones, atencion_psicologica, entrevista_social, informe_integral, toma_medicamento, medicamento_detalles)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [r.id, r.estudiante_id, r.condicion, r.estatus_diagnostico, r.observaciones, r.atencion_psicologica, r.entrevista_social, r.informe_integral, r.toma_medicamento, r.medicamento_detalles]
          );
        }
      } else if (tableName === 'representantes') {
        const rows = db.prepare('SELECT * FROM representantes').all();
        await client.query('DELETE FROM public.representantes');
        for (const r of rows) {
          await client.query(
            `INSERT INTO public.representantes (id, estudiante_id, nombre_representante, cedula_representante, telefono, parentesco)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [r.id, r.estudiante_id, r.nombre_representante, r.cedula_representante, r.telefono, r.parentesco]
          );
        }
      } else if (tableName === 'usuarios') {
        const rows = db.prepare('SELECT * FROM usuarios').all();
        for (const r of rows) {
          await client.query(
            `INSERT INTO public.usuarios (id, email, nombre_completo, password_hash, rol, estado, email_verificado)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (email) DO UPDATE SET
               nombre_completo = EXCLUDED.nombre_completo,
               password_hash = EXCLUDED.password_hash,
               rol = EXCLUDED.rol,
               estado = EXCLUDED.estado,
               email_verificado = EXCLUDED.email_verificado`,
            [r.id, r.email, r.nombre_completo, r.password_hash, r.rol, r.estado, r.email_verificado]
          );
        }
      } else if (tableName === 'condiciones_diagnosticas') {
        const rows = db.prepare('SELECT * FROM condiciones_diagnosticas').all();
        for (const r of rows) {
          await client.query(
            `INSERT INTO public.condiciones_diagnosticas (id, nombre_condicion)
             VALUES ($1, $2)
             ON CONFLICT (nombre_condicion) DO NOTHING`,
            [r.id, r.nombre_condicion]
          );
        }
      } else if (tableName === 'instituciones') {
        const rows = db.prepare('SELECT * FROM instituciones').all();
        for (const r of rows) {
          await client.query(
            `INSERT INTO public.instituciones (id, nombre_institucion, codigo_plantel, ubicacion)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (nombre_institucion) DO UPDATE SET
               codigo_plantel = EXCLUDED.codigo_plantel,
               ubicacion = EXCLUDED.ubicacion`,
            [r.id, r.nombre_institucion, r.codigo_plantel, r.ubicacion]
          );
        }
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(`[Supabase Sync] Error sincronizando tabla ${tableName} hacia Supabase:`, err.message);
  }
}

/**
 * Sincroniza todas las tablas de estudiantes hacia Supabase tras una mutación
 */
function syncStudentsToSupabase(db) {
  if (!process.env.DATABASE_URL) return;
  setImmediate(async () => {
    await syncTableToSupabase('estudiantes', db);
    await syncTableToSupabase('expedientes_medicos', db);
    await syncTableToSupabase('representantes', db);
  });
}

function syncUsersToSupabase(db) {
  if (!process.env.DATABASE_URL) return;
  setImmediate(async () => {
    await syncTableToSupabase('usuarios', db);
  });
}

function syncCatalogToSupabase(tableName, db) {
  if (!process.env.DATABASE_URL) return;
  setImmediate(async () => {
    await syncTableToSupabase(tableName, db);
  });
}

module.exports = {
  pullFromSupabase,
  syncStudentsToSupabase,
  syncUsersToSupabase,
  syncCatalogToSupabase
};

