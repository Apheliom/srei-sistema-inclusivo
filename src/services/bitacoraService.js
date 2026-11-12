/**
 * SREI - Servicio de Bitácora Institucional de Auditoría
 * Registra todos los movimientos administrativos, médicos y de estudiantes
 */

function registrarBitacora(req, accion, modulo, detalles, db, usuarioOverride = null) {
  try {
    let usuarioId = 1;
    let usuarioNombre = 'Magister Amparo Aguilar';
    let usuarioEmail = 'director@srei.edu';
    let usuarioRol = 'admin';

    // Si viene usuario autenticado en la sesión/petición
    if (usuarioOverride) {
      usuarioId = usuarioOverride.id || usuarioId;
      usuarioNombre = usuarioOverride.nombre_completo || usuarioNombre;
      usuarioEmail = usuarioOverride.email || usuarioEmail;
      usuarioRol = usuarioOverride.rol || usuarioRol;
    } else if (req && req.headers && req.headers['x-user-id']) {
      const uId = parseInt(req.headers['x-user-id'], 10);
      const user = db.prepare('SELECT id, nombre_completo, email, rol FROM usuarios WHERE id = ?').get(uId);
      if (user) {
        usuarioId = user.id;
        usuarioNombre = user.nombre_completo;
        usuarioEmail = user.email;
        usuarioRol = user.rol;
      }
    } else if (req && req.body && req.body.adminId) {
      const uId = parseInt(req.body.adminId, 10);
      const user = db.prepare('SELECT id, nombre_completo, email, rol FROM usuarios WHERE id = ?').get(uId);
      if (user) {
        usuarioId = user.id;
        usuarioNombre = user.nombre_completo;
        usuarioEmail = user.email;
        usuarioRol = user.rol;
      }
    }

    // Obtener IP
    const ip = req && (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || req.ip || '127.0.0.1');
    const cleanIp = typeof ip === 'string' ? ip.split(',')[0].trim() : '127.0.0.1';

    // Insertar en SQLite
    db.prepare(`
      INSERT INTO bitacora (
        usuario_id, usuario_nombre, usuario_email, usuario_rol,
        accion, modulo, detalles, ip_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      usuarioId,
      usuarioNombre,
      usuarioEmail,
      usuarioRol,
      accion,
      modulo,
      detalles,
      cleanIp
    );

    console.log(`[Bitácora] [${modulo}] ${accion}: ${detalles} (Por: ${usuarioNombre})`);
    
    // Sincronizar asíncronamente con Supabase si está disponible
    try {
      const { syncBitacoraToSupabase } = require('../db/supabase_sync');
      syncBitacoraToSupabase(db);
    } catch (e) {}
  } catch (error) {
    console.error('[Bitácora] Error al registrar evento:', error.message);
  }
}

module.exports = { registrarBitacora };
