require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db/database');
const { generateSupabaseSQL } = require('./db/export');
const { hashPassword, verifyPassword, generateVerificationCode } = require('./db/auth');
const { sendVerificationEmail } = require('./services/emailService');
const { generateExcelReport, generatePdfReport } = require('./services/reportService');
const { pullFromSupabase, syncStudentsToSupabase, syncUsersToSupabase, syncCatalogToSupabase, syncBitacoraToSupabase } = require('./db/supabase_sync');
const { registrarBitacora } = require('./services/bitacoraService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos con no-cache estricto para desarrollo
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res, filePath) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Helper: Calcular edad a partir de fecha de nacimiento YYYY-MM-DD
function calcularEdad(fechaNac) {
  if (!fechaNac) return 0;
  const hoy = new Date();
  const nac = new Date(fechaNac);
  let edad = hoy.getFullYear() - nac.getFullYear();
  const mes = hoy.getMonth() - nac.getMonth();
  if (mes < 0 || (mes === 0 && hoy.getDate() < nac.getDate())) {
    edad--;
  }
  return edad >= 0 ? edad : 0;
}

// ====================================================================
// RUTAS DE AUTENTICACIÓN Y ROLES
// ====================================================================

app.post('/api/auth/register-profesor', async (req, res) => {
  try {
    const { nombre_completo, email, password, confirmPassword } = req.body;

    if (!nombre_completo || !email || !password || !confirmPassword) {
      return res.status(400).json({ success: false, error: 'Todos los campos son obligatorios.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ success: false, error: 'La contraseña debe tener mínimo 8 caracteres.' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'Las contraseñas no coinciden.' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const existe = db.prepare('SELECT id FROM usuarios WHERE email = ?').get(cleanEmail);
    if (existe) {
      return res.status(409).json({ success: false, error: 'Este correo institucional ya está registrado.' });
    }

    const codigo = generateVerificationCode();
    const expira = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const pHash = hashPassword(password);

    db.prepare(`
      INSERT INTO usuarios (
        email, nombre_completo, password_hash, rol, estado,
        codigo_verificacion, codigo_expira, email_verificado
      ) VALUES (?, ?, ?, 'profesor', 'pendiente_verificacion', ?, ?, 0)
    `).run(cleanEmail, nombre_completo.trim(), pHash, codigo, expira);

    const emailRes = await sendVerificationEmail(cleanEmail, codigo, nombre_completo.trim());
    registrarBitacora(req, 'REGISTRO_DOCENTE', 'DOCENTES', `Solicitud de registro docente creada: ${nombre_completo.trim()} (${cleanEmail})`, db);

    res.status(201).json({
      success: true,
      message: 'Cuenta creada. Se ha enviado un código de verificación a tu correo.',
      email: cleanEmail,
      debugCode: emailRes.simulated || !emailRes.delivered ? codigo : undefined
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/auth/verify-code', (req, res) => {
  try {
    const { email, codigo } = req.body;
    if (!email || !codigo) return res.status(400).json({ success: false, error: 'Datos incompletos.' });

    const cleanEmail = email.trim().toLowerCase();
    const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(cleanEmail);
    if (!user) return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });

    if (user.codigo_verificacion !== codigo.trim()) {
      return res.status(400).json({ success: false, error: 'Código de verificación incorrecto.' });
    }

    if (user.codigo_expira && new Date(user.codigo_expira) < new Date()) {
      return res.status(400).json({ success: false, error: 'El código ha expirado.' });
    }

    db.prepare(`
      UPDATE usuarios 
      SET email_verificado = 1, estado = 'pendiente_aprobacion', codigo_verificacion = NULL 
      WHERE id = ?
    `).run(user.id);
    syncUsersToSupabase(db);
    registrarBitacora(req, 'VERIFICAR_CORREO', 'AUTENTICACION', `Código verificado exitosamente por el docente ${user.nombre_completo} (${user.email})`, db, user);

    res.json({
      success: true,
      message: '¡Correo verificado! Tu cuenta está en espera de aprobación por la Dirección escolar.',
      estado: 'pendiente_aprobacion'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ success: false, error: 'Ingresa credenciales.' });

    const user = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(username.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ success: false, error: 'Correo o contraseña incorrectos.' });
    }

    if (user.email_verificado === 0) {
      return res.status(403).json({
        success: false,
        requiresVerification: true,
        email: user.email,
        error: 'Debes verificar tu correo institucional antes de continuar.'
      });
    }

    if (user.rol === 'profesor' && user.estado === 'pendiente_aprobacion') {
      return res.json({
        success: true,
        isPendingApproval: true,
        user: { id: user.id, email: user.email, nombre_completo: user.nombre_completo, rol: user.rol, estado: user.estado },
        message: 'Tu cuenta ha sido verificada pero está pendiente de activación por la Dirección del plantel.'
      });
    }

    if (user.estado === 'inactivo') {
      return res.status(403).json({ success: false, error: 'Cuenta desactivada por la Dirección escolar.' });
    }

    const redirectTo = user.rol === 'admin' ? '/estudiantes.html' : '/';

    registrarBitacora(req, 'INICIO_SESION', 'AUTENTICACION', `Inicio de sesión exitoso al sistema como ${user.rol.toUpperCase()}`, db, user);

    res.json({
      success: true,
      isPendingApproval: false,
      redirectTo,
      user: { id: user.id, email: user.email, nombre_completo: user.nombre_completo, rol: user.rol, estado: user.estado },
      message: 'Acceso autorizado al SREI.'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ====================================================================
// RUTAS DE INSTITUCIONES Y EXPEDIENTES ESTUDIANTILES (4 BLOQUES)
// ====================================================================

// Listar planteles escolares
app.get('/api/instituciones', (req, res) => {
  try {
    const data = db.prepare('SELECT * FROM instituciones ORDER BY nombre_institucion ASC').all();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Registrar nuevo plantel escolar directamente desde el formulario
app.post('/api/instituciones', (req, res) => {
  try {
    const { nombre_institucion, codigo_plantel } = req.body;
    if (!nombre_institucion || !nombre_institucion.trim()) {
      return res.status(400).json({ success: false, error: 'El nombre del plantel es obligatorio.' });
    }
    const nombre = nombre_institucion.trim();
    const existing = db.prepare('SELECT * FROM instituciones WHERE LOWER(nombre_institucion) = LOWER(?)').get(nombre);
    if (existing) {
      return res.json({ success: true, data: existing, message: 'El plantel ya existía.' });
    }
    const info = db.prepare('INSERT INTO instituciones (nombre_institucion, codigo_plantel) VALUES (?, ?)').run(
      nombre, codigo_plantel ? codigo_plantel.trim() : null
    );
    syncCatalogToSupabase('instituciones', db);
    const newInst = db.prepare('SELECT * FROM instituciones WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, data: newInst, message: 'Plantel registrado exitosamente.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Modificar / corregir nombre de plantel existente
app.put('/api/instituciones/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { nombre_institucion, codigo_plantel } = req.body;
    if (!nombre_institucion || !nombre_institucion.trim()) {
      return res.status(400).json({ success: false, error: 'El nombre del plantel es obligatorio.' });
    }
    const nombre = nombre_institucion.trim();
    db.prepare('UPDATE instituciones SET nombre_institucion = ?, codigo_plantel = ? WHERE id = ?').run(
      nombre, codigo_plantel ? codigo_plantel.trim() : null, id
    );
    syncCatalogToSupabase('instituciones', db);
    const updated = db.prepare('SELECT * FROM instituciones WHERE id = ?').get(id);
    res.json({ success: true, data: updated, message: 'Plantel actualizado exitosamente.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ====================================================================
// RUTAS DE CONDICIONES DIAGNÓSTICAS DINÁMICAS
// ====================================================================

// Listar condiciones diagnósticas
app.get('/api/condiciones', (req, res) => {
  try {
    const data = db.prepare('SELECT * FROM condiciones_diagnosticas ORDER BY nombre_condicion ASC').all();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Registrar nueva condición diagnóstica
app.post('/api/condiciones', (req, res) => {
  try {
    const { nombre_condicion } = req.body;
    if (!nombre_condicion || !nombre_condicion.trim()) {
      return res.status(400).json({ success: false, error: 'El nombre de la condición es obligatorio.' });
    }
    const nombre = nombre_condicion.trim();
    const existing = db.prepare('SELECT * FROM condiciones_diagnosticas WHERE LOWER(nombre_condicion) = LOWER(?)').get(nombre);
    if (existing) {
      return res.json({ success: true, data: existing, message: 'La condición ya existía.' });
    }
    const info = db.prepare('INSERT INTO condiciones_diagnosticas (nombre_condicion) VALUES (?)').run(nombre);
    syncCatalogToSupabase('condiciones_diagnosticas', db);
    const newCond = db.prepare('SELECT * FROM condiciones_diagnosticas WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json({ success: true, data: newCond, message: 'Condición registrada exitosamente.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Renombrar condición diagnóstica existente
app.put('/api/condiciones/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { nombre_condicion } = req.body;
    if (!nombre_condicion || !nombre_condicion.trim()) {
      return res.status(400).json({ success: false, error: 'El nombre de la condición es obligatorio.' });
    }
    const nombre = nombre_condicion.trim();
    const current = db.prepare('SELECT * FROM condiciones_diagnosticas WHERE id = ?').get(id);
    if (!current) {
      return res.status(404).json({ success: false, error: 'Condición no encontrada.' });
    }
    
    // Transacción para actualizar catálogo y los expedientes que la usaban
    const renombrarTx = db.transaction(() => {
      db.prepare('UPDATE condiciones_diagnosticas SET nombre_condicion = ? WHERE id = ?').run(nombre, id);
      db.prepare('UPDATE expedientes_medicos SET condicion = ? WHERE condicion = ?').run(nombre, current.nombre_condicion);
    });
    renombrarTx();
    syncCatalogToSupabase('condiciones_diagnosticas', db);
    syncStudentsToSupabase(db);

    const updated = db.prepare('SELECT * FROM condiciones_diagnosticas WHERE id = ?').get(id);
    res.json({ success: true, data: updated, message: 'Condición actualizada exitosamente.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ====================================================================
// PERFIL DE USUARIO / DOCENTE (CON VALIDACIÓN DE CONTRASEÑA OBLIGATORIA)
// ====================================================================

app.put('/api/usuarios/perfil', async (req, res) => {
  try {
    const { id, nombre_completo, email, current_password, new_password } = req.body;

    if (!id || !current_password) {
      return res.status(400).json({ success: false, error: 'Debes ingresar tu contraseña actual para confirmar los cambios.' });
    }

    const user = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
    }

    // Validar contraseña actual con hash scrypt
    const passValida = verifyPassword(current_password, user.password_hash);
    if (!passValida) {
      return res.status(401).json({ success: false, error: 'La contraseña actual ingresada es incorrecta.' });
    }

    // Validar email si cambió
    if (email && email.trim().toLowerCase() !== user.email.toLowerCase()) {
      const emailExistente = db.prepare('SELECT id FROM usuarios WHERE email = ? AND id != ?').get(email.trim().toLowerCase(), id);
      if (emailExistente) {
        return res.status(409).json({ success: false, error: 'El correo electrónico ya está en uso por otra cuenta.' });
      }
    }

    let finalPassHash = user.password_hash;
    if (new_password && new_password.trim()) {
      if (new_password.length < 8) {
        return res.status(400).json({ success: false, error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
      }
      finalPassHash = hashPassword(new_password);
    }

    const nuevoNombre = (nombre_completo && nombre_completo.trim()) ? nombre_completo.trim() : user.nombre_completo;
    const nuevoEmail = (email && email.trim()) ? email.trim().toLowerCase() : user.email;

    db.prepare(`
      UPDATE usuarios 
      SET nombre_completo = ?, email = ?, password_hash = ?
      WHERE id = ?
    `).run(nuevoNombre, nuevoEmail, finalPassHash, id);

    const userActualizado = db.prepare('SELECT id, nombre_completo, email, rol, estado, email_verificado FROM usuarios WHERE id = ?').get(id);
    syncUsersToSupabase(db);
    registrarBitacora(req, 'ACTUALIZAR_PERFIL', 'USUARIOS', `Perfil institucional actualizado para ${nuevoNombre} (${nuevoEmail})`, db, userActualizado);

    res.json({
      success: true,
      message: 'Perfil actualizado exitosamente.',
      data: userActualizado
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Listar expedientes estudiantiles con filtros y búsqueda (Soporta borrado lógico)
app.get('/api/expedientes', (req, res) => {
  try {
    const { search, institucion_id, condicion, grado_seccion, estatus_diagnostico, estado } = req.query;

    let sql = `
      SELECT 
        e.id,
        e.institucion_id,
        i.nombre_institucion,
        i.codigo_plantel,
        e.numero_orden,
        e.nombres_apellidos,
        e.cedula_identidad,
        e.fecha_nacimiento,
        e.sexo,
        e.grado_seccion,
        e.activo,
        e.registrado_por,
        e.created_at,
        m.condicion,
        m.estatus_diagnostico,
        m.observaciones,
        m.atencion_psicologica,
        m.entrevista_social,
        m.informe_integral,
        m.toma_medicamento,
        m.medicamento_detalles,
        r.nombre_representante,
        r.cedula_representante,
        r.telefono,
        r.parentesco
      FROM estudiantes e
      JOIN instituciones i ON e.institucion_id = i.id
      LEFT JOIN expedientes_medicos m ON e.id = m.estudiante_id
      LEFT JOIN representantes r ON e.id = r.estudiante_id
      WHERE 1=1
    `;

    const params = [];

    // Filtro de Borrado Lógico (por defecto solo activos)
    if (estado === 'inactivo') {
      sql += ` AND e.activo = 0`;
    } else if (estado === 'todos') {
      // no filtrar por activo
    } else {
      sql += ` AND e.activo = 1`;
    }

    if (search) {
      sql += ` AND (e.nombres_apellidos LIKE ? OR e.cedula_identidad LIKE ? OR r.nombre_representante LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term);
    }

    if (institucion_id) {
      sql += ` AND e.institucion_id = ?`;
      params.push(institucion_id);
    }

    if (condicion) {
      sql += ` AND m.condicion = ?`;
      params.push(condicion);
    }

    if (grado_seccion) {
      sql += ` AND e.grado_seccion = ?`;
      params.push(grado_seccion);
    }

    if (estatus_diagnostico) {
      sql += ` AND m.estatus_diagnostico = ?`;
      params.push(estatus_diagnostico);
    }

    sql += ` ORDER BY e.id DESC`;

    const rows = db.prepare(sql).all(...params);

    // Adjuntar edad calculada dinámicamente
    const expedientes = rows.map(r => ({
      ...r,
      edad_calculada: calcularEdad(r.fecha_nacimiento)
    }));

    res.json({ success: true, count: expedientes.length, data: expedientes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Obtener un expediente completo por ID
app.get('/api/expedientes/:id', (req, res) => {
  try {
    const sql = `
      SELECT 
        e.*, i.nombre_institucion,
        m.condicion, m.estatus_diagnostico, m.observaciones,
        m.atencion_psicologica, m.entrevista_social, m.informe_integral,
        m.toma_medicamento, m.medicamento_detalles,
        r.nombre_representante, r.cedula_representante, r.telefono, r.parentesco
      FROM estudiantes e
      JOIN instituciones i ON e.institucion_id = i.id
      LEFT JOIN expedientes_medicos m ON e.id = m.estudiante_id
      LEFT JOIN representantes r ON e.id = r.estudiante_id
      WHERE e.id = ?
    `;
    const exp = db.prepare(sql).get(req.params.id);
    if (!exp) return res.status(404).json({ success: false, error: 'Expediente no encontrado.' });

    exp.edad_calculada = calcularEdad(exp.fecha_nacimiento);
    res.json({ success: true, data: exp });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper para normalizar valores del Checklist Digital
function normalizarChecklist(atencion, entrevista, informe) {
  let atencionNormalizada = 'No';
  if (atencion === 'Sí' || atencion === 'Si' || atencion === 'X' || atencion === true || atencion === '1') {
    atencionNormalizada = 'Sí';
  } else if (atencion === 'En proceso') {
    atencionNormalizada = 'En proceso';
  }

  let entrevistaNormalizada = 'Pendiente';
  if (entrevista === 'Realizada' || entrevista === 'Sí' || entrevista === 'Si' || entrevista === 'X' || entrevista === true || entrevista === '1') {
    entrevistaNormalizada = 'Realizada';
  }

  let informeNormalizado = 'En proceso';
  if (informe === 'Listo' || informe === 'Sí' || informe === 'Si' || informe === 'X' || informe === true || informe === '1') {
    informeNormalizado = 'Listo';
  } else if (informe === 'Falta informe psicológico') {
    informeNormalizado = 'Falta informe psicológico';
  }

  return { atencionNormalizada, entrevistaNormalizada, informeNormalizado };
}

// Crear nuevo Expediente Estudiantil (Transacción de los 4 Bloques)
app.post('/api/expedientes', (req, res) => {
  try {
    let {
      institucion_id, numero_orden, nombres_apellidos, cedula_identidad,
      fecha_nacimiento, edad, sexo, grado_seccion, registrado_por,
      condicion, estatus_diagnostico, observaciones,
      atencion_psicologica, entrevista_social, informe_integral,
      toma_medicamento, medicamento_detalles,
      nombre_representante, cedula_representante, telefono, parentesco
    } = req.body;

    if (!institucion_id || !nombres_apellidos || !grado_seccion || !condicion) {
      return res.status(400).json({ success: false, error: 'Institución, nombres, grado y condición diagnóstica son obligatorios.' });
    }

    // Normalizar Cédula (si no posee, generar correlativo escolar editable)
    let cedulaLimpia = (cedula_identidad && cedula_identidad.trim()) 
      ? cedula_identidad.trim().toUpperCase() 
      : `ESC-${numero_orden || Math.floor(Math.random() * 8999 + 1000)}-${Date.now().toString().slice(-4)}`;

    const existe = db.prepare('SELECT id, activo FROM estudiantes WHERE cedula_identidad = ?').get(cedulaLimpia);
    if (existe && existe.activo === 1) {
      return res.status(409).json({ success: false, error: `Ya existe un estudiante activo con la cédula ${cedulaLimpia}.` });
    }

    // Normalizar Fecha y Sexo
    if (!fecha_nacimiento || fecha_nacimiento.trim() === '?' || fecha_nacimiento.trim() === '') {
      const añoEstimado = edad ? (new Date().getFullYear() - parseInt(edad, 10)) : 2015;
      fecha_nacimiento = `${añoEstimado}-01-01`;
    }

    let sexoNormalizado = (sexo === 'F' || sexo === 'Femenino') ? 'Femenino' : 'Masculino';

    // Normalizar Checklist Digital
    const { atencionNormalizada, entrevistaNormalizada, informeNormalizado } = normalizarChecklist(
      atencion_psicologica, entrevista_social, informe_integral
    );

    const tomaMedNormalizado = (toma_medicamento === 'Sí' || toma_medicamento === 'Si') ? 'Sí' : 'No';

    const crearExpedienteTx = db.transaction(() => {
      let estId;
      if (existe && existe.activo === 0) {
        estId = existe.id;
        db.prepare(`
          UPDATE estudiantes SET
            institucion_id = ?, numero_orden = ?, nombres_apellidos = ?,
            fecha_nacimiento = ?, sexo = ?, grado_seccion = ?, activo = 1
          WHERE id = ?
        `).run(
          institucion_id, numero_orden || null, nombres_apellidos.trim(),
          fecha_nacimiento, sexoNormalizado, grado_seccion.trim(), estId
        );
        db.prepare('DELETE FROM expedientes_medicos WHERE estudiante_id = ?').run(estId);
        db.prepare('DELETE FROM representantes WHERE estudiante_id = ?').run(estId);
      } else {
        const resEst = db.prepare(`
          INSERT INTO estudiantes (
            institucion_id, numero_orden, nombres_apellidos, cedula_identidad,
            fecha_nacimiento, sexo, grado_seccion, activo, registrado_por
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        `).run(
          institucion_id, numero_orden || null, nombres_apellidos.trim(), cedulaLimpia,
          fecha_nacimiento, sexoNormalizado, grado_seccion.trim(), registrado_por || 1
        );
        estId = resEst.lastInsertRowid;
      }

      // 2. Expediente Médico, Checklist Digital y Medicamentos
      db.prepare(`
        INSERT INTO expedientes_medicos (
          estudiante_id, condicion, estatus_diagnostico, observaciones,
          atencion_psicologica, entrevista_social, informe_integral,
          toma_medicamento, medicamento_detalles
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        estId, condicion.trim(), estatus_diagnostico || 'En Proceso de Evaluación', observaciones ? observaciones.trim() : '',
        atencionNormalizada, entrevistaNormalizada, informeNormalizado,
        tomaMedNormalizado, tomaMedNormalizado === 'Sí' ? (medicamento_detalles ? medicamento_detalles.trim() : '') : ''
      );

      // 3. Representante
      db.prepare(`
        INSERT INTO representantes (
          estudiante_id, nombre_representante, cedula_representante, telefono, parentesco
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        estId,
        nombre_representante && nombre_representante.trim() ? nombre_representante.trim() : 'Por asignar',
        cedula_representante ? cedula_representante.trim() : '',
        telefono && telefono.trim() ? telefono.trim() : 'No especificado',
        parentesco && parentesco.trim() ? parentesco.trim() : 'Representante Legal'
      );

      return estId;
    });

    const nuevoId = crearExpedienteTx();
    syncStudentsToSupabase(db);
    
    if (existe && existe.activo === 0) {
      registrarBitacora(req, 'REACTIVAR_ESTUDIANTE', 'ESTUDIANTES', `Expediente reactivado por coincidencia: ${nombres_apellidos.trim()} (C.I. ${cedulaLimpia}) - Condición: ${condicion}`, db);
    } else {
      registrarBitacora(req, 'CREAR_ESTUDIANTE', 'ESTUDIANTES', `Nuevo expediente registrado: ${nombres_apellidos.trim()} (C.I. ${cedulaLimpia}) - Condición: ${condicion}`, db);
    }

    const mensaje = (existe && existe.activo === 0)
      ? 'El estudiante ya existía en el archivo histórico y fue reactivado exitosamente con los datos actualizados.'
      : 'Expediente estudiantil registrado correctamente.';
    res.status(201).json({ success: true, message: mensaje, id: nuevoId, reactivado: !!(existe && existe.activo === 0) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Actualizar Expediente Estudiantil
app.put('/api/expedientes/:id', (req, res) => {
  try {
    const estId = req.params.id;
    let {
      institucion_id, numero_orden, nombres_apellidos, cedula_identidad,
      fecha_nacimiento, edad, sexo, grado_seccion,
      condicion, estatus_diagnostico, observaciones,
      atencion_psicologica, entrevista_social, informe_integral,
      toma_medicamento, medicamento_detalles,
      nombre_representante, cedula_representante, telefono, parentesco
    } = req.body;

    if (!institucion_id || !nombres_apellidos || !grado_seccion || !condicion) {
      return res.status(400).json({ success: false, error: 'Institución, nombres, grado y condición diagnóstica son obligatorios.' });
    }

    let cedulaLimpia = (cedula_identidad && cedula_identidad.trim())
      ? cedula_identidad.trim().toUpperCase()
      : `ESC-${numero_orden || Math.floor(Math.random() * 8999 + 1000)}-${Date.now().toString().slice(-4)}`;

    if (!fecha_nacimiento || fecha_nacimiento.trim() === '?' || fecha_nacimiento.trim() === '') {
      const añoEstimado = edad ? (new Date().getFullYear() - parseInt(edad, 10)) : 2015;
      fecha_nacimiento = `${añoEstimado}-01-01`;
    }

    let sexoNormalizado = (sexo === 'F' || sexo === 'Femenino') ? 'Femenino' : 'Masculino';

    const { atencionNormalizada, entrevistaNormalizada, informeNormalizado } = normalizarChecklist(
      atencion_psicologica, entrevista_social, informe_integral
    );

    const tomaMedNormalizado = (toma_medicamento === 'Sí' || toma_medicamento === 'Si') ? 'Sí' : 'No';

    const actualizarTx = db.transaction(() => {
      db.prepare(`
        UPDATE estudiantes SET
          institucion_id = ?, numero_orden = ?, nombres_apellidos = ?,
          cedula_identidad = ?, fecha_nacimiento = ?, sexo = ?, grado_seccion = ?
        WHERE id = ?
      `).run(
        institucion_id, numero_orden || null, nombres_apellidos.trim(),
        cedulaLimpia, fecha_nacimiento, sexoNormalizado, grado_seccion.trim(), estId
      );

      db.prepare(`
        UPDATE expedientes_medicos SET
          condicion = ?, estatus_diagnostico = ?, observaciones = ?,
          atencion_psicologica = ?, entrevista_social = ?, informe_integral = ?,
          toma_medicamento = ?, medicamento_detalles = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE estudiante_id = ?
      `).run(
        condicion.trim(), estatus_diagnostico || 'En Proceso de Evaluación', observaciones ? observaciones.trim() : '',
        atencionNormalizada, entrevistaNormalizada, informeNormalizado,
        tomaMedNormalizado, tomaMedNormalizado === 'Sí' ? (medicamento_detalles ? medicamento_detalles.trim() : '') : '',
        estId
      );

      db.prepare(`
        UPDATE representantes SET
          nombre_representante = ?, cedula_representante = ?, telefono = ?, parentesco = ?
        WHERE estudiante_id = ?
      `).run(
        nombre_representante && nombre_representante.trim() ? nombre_representante.trim() : 'Por asignar',
        cedula_representante ? cedula_representante.trim() : '',
        telefono && telefono.trim() ? telefono.trim() : 'No especificado',
        parentesco && parentesco.trim() ? parentesco.trim() : 'Representante Legal',
        estId
      );
    });

    actualizarTx();
    syncStudentsToSupabase(db);
    registrarBitacora(req, 'ACTUALIZAR_ESTUDIANTE', 'ESTUDIANTES', `Expediente actualizado: ${nombres_apellidos.trim()} (ID ${estId}, C.I. ${cedulaLimpia}) - Condición: ${condicion}`, db);
    res.json({ success: true, message: 'Expediente actualizado exitosamente.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Desactivar / Borrado Lógico de Expediente Estudiantil
app.delete('/api/expedientes/:id', (req, res) => {
  try {
    const est = db.prepare('SELECT nombres_apellidos, cedula_identidad FROM estudiantes WHERE id = ?').get(req.params.id);
    const result = db.prepare('UPDATE estudiantes SET activo = 0 WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ success: false, error: 'Expediente no encontrado.' });
    syncStudentsToSupabase(db);
    const nombre = est ? `${est.nombres_apellidos} (C.I. ${est.cedula_identidad})` : `ID ${req.params.id}`;
    registrarBitacora(req, 'DESACTIVAR_ESTUDIANTE', 'ESTUDIANTES', `Expediente desactivado/archivado: ${nombre}`, db);
    res.json({ success: true, message: 'Expediente desactivado y protegido en el archivo histórico.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reactivar Expediente Estudiantil
app.post('/api/expedientes/:id/reactivar', (req, res) => {
  try {
    const est = db.prepare('SELECT nombres_apellidos, cedula_identidad FROM estudiantes WHERE id = ?').get(req.params.id);
    const result = db.prepare('UPDATE estudiantes SET activo = 1 WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ success: false, error: 'Expediente no encontrado.' });
    syncStudentsToSupabase(db);
    const nombre = est ? `${est.nombres_apellidos} (C.I. ${est.cedula_identidad})` : `ID ${req.params.id}`;
    registrarBitacora(req, 'REACTIVAR_ESTUDIANTE', 'ESTUDIANTES', `Expediente reactivado manualmente: ${nombre}`, db);
    res.json({ success: true, message: 'Expediente reactivado exitosamente.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Estadísticas del Panel Admin (Solo estudiantes e instituciones activas)
app.get('/api/stats', (req, res) => {
  try {
    const totalEstudiantes = db.prepare('SELECT COUNT(*) as c FROM estudiantes WHERE activo = 1').get().c;
    const totalVarones = db.prepare("SELECT COUNT(*) as c FROM estudiantes WHERE activo = 1 AND sexo LIKE 'M%'").get().c;
    const totalHembras = db.prepare("SELECT COUNT(*) as c FROM estudiantes WHERE activo = 1 AND sexo LIKE 'F%'").get().c;
    const totalPlanteles = db.prepare('SELECT COUNT(*) as c FROM instituciones WHERE activo = 1').get().c;
    const psicologicaLista = db.prepare(`
      SELECT COUNT(*) as c FROM expedientes_medicos m 
      JOIN estudiantes e ON m.estudiante_id = e.id 
      WHERE e.activo = 1 AND m.atencion_psicologica = 'Sí'
    `).get().c;
    const informeListo = db.prepare(`
      SELECT COUNT(*) as c FROM expedientes_medicos m 
      JOIN estudiantes e ON m.estudiante_id = e.id 
      WHERE e.activo = 1 AND m.informe_integral = 'Listo'
    `).get().c;

    const docentesActivos = db.prepare("SELECT COUNT(*) as c FROM usuarios WHERE rol = 'profesor' AND estado = 'activo'").get().c;
    const docentesInactivos = db.prepare("SELECT COUNT(*) as c FROM usuarios WHERE rol = 'profesor' AND estado = 'inactivo'").get().c;
    const docentesPendientes = db.prepare("SELECT COUNT(*) as c FROM usuarios WHERE rol = 'profesor' AND estado = 'pendiente_aprobacion'").get().c;
    const docentesTotal = db.prepare("SELECT COUNT(*) as c FROM usuarios WHERE rol = 'profesor'").get().c;

    const porCondicion = db.prepare(`
      SELECT m.condicion, COUNT(*) as total 
      FROM expedientes_medicos m
      JOIN estudiantes e ON m.estudiante_id = e.id
      WHERE e.activo = 1
      GROUP BY m.condicion 
      ORDER BY total DESC
    `).all();

    const porInstitucion = db.prepare(`
      SELECT i.nombre_institucion, COUNT(e.id) as total 
      FROM instituciones i
      LEFT JOIN estudiantes e ON i.id = e.institucion_id AND e.activo = 1
      WHERE i.activo = 1
      GROUP BY i.id
    `).all();

    res.json({
      success: true,
      data: {
        totalEstudiantes,
        totalVarones,
        totalHembras,
        totalExpedientes: totalEstudiantes, // compatibilidad
        totalPlanteles,
        psicologicaLista,
        informeListo,
        docentesActivos,
        docentesInactivos,
        docentesPendientes,
        docentesTotal,
        porCondicion,
        porInstitucion
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Redirigir /admin.html a /estudiantes.html
app.get(['/admin', '/admin.html'], (req, res) => {
  res.redirect('/estudiantes.html');
});

// Gestión de Docentes
app.get('/api/admin/profesores', (req, res) => {
  try {
    const data = db.prepare(`SELECT id, email, nombre_completo, rol, estado, email_verificado, created_at FROM usuarios WHERE rol = 'profesor' ORDER BY id DESC`).all();
    res.json({ success: true, count: data.length, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/profesores/:id/status', (req, res) => {
  try {
    const { id } = req.params;
    const { estado, adminId } = req.body;
    const targetUser = db.prepare('SELECT nombre_completo, email FROM usuarios WHERE id = ?').get(id);
    db.prepare('UPDATE usuarios SET estado = ?, aprobado_por = ?, aprobado_en = CURRENT_TIMESTAMP WHERE id = ?').run(estado, adminId || 1, id);
    syncUsersToSupabase(db);
    const targetInfo = targetUser ? `${targetUser.nombre_completo} (${targetUser.email})` : `ID ${id}`;
    registrarBitacora(req, 'CAMBIO_ESTADO_DOCENTE', 'DOCENTES', `Estado del docente ${targetInfo} actualizado a '${estado}'`, db);
    res.json({ success: true, message: `Estado actualizado a ${estado}.` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Eliminar Docente de forma definitiva (Local + Nube)
app.delete('/api/admin/profesores/:id', (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id, 10) === 1) {
      return res.status(403).json({ success: false, error: 'No se puede eliminar la cuenta principal de la Directora.' });
    }
    const targetUser = db.prepare('SELECT nombre_completo, email FROM usuarios WHERE id = ?').get(id);
    if (!targetUser) return res.status(404).json({ success: false, error: 'Docente no encontrado.' });

    db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
    syncUsersToSupabase(db);

    const targetInfo = `${targetUser.nombre_completo} (${targetUser.email})`;
    registrarBitacora(req, 'ELIMINAR_DOCENTE', 'DOCENTES', `Docente ${targetInfo} eliminado del sistema y de la nube`, db);

    res.json({ success: true, message: 'Docente eliminado exitosamente.' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ====================================================================
// BITÁCORA INSTITUCIONAL DE AUDITORÍA (EXCLUSIVO DIRECTORA / MAGISTER AMPARO AGUILAR)
// ====================================================================

app.get('/api/admin/bitacora', (req, res) => {
  try {
    const { search, desde, hasta, modulo, accion } = req.query;
    let sql = `SELECT * FROM bitacora WHERE 1=1`;
    const params = [];

    if (search && search.trim()) {
      sql += ` AND (detalles LIKE ? OR usuario_nombre LIKE ? OR usuario_email LIKE ? OR accion LIKE ? OR modulo LIKE ?)`;
      const term = `%${search.trim()}%`;
      params.push(term, term, term, term, term);
    }

    if (modulo && modulo !== 'todos' && modulo.trim()) {
      sql += ` AND modulo = ?`;
      params.push(modulo.trim());
    }

    if (accion && accion !== 'todas' && accion.trim()) {
      sql += ` AND accion = ?`;
      params.push(accion.trim());
    }

    if (desde && desde.trim()) {
      sql += ` AND created_at >= ?`;
      params.push(`${desde.trim()} 00:00:00`);
    }

    if (hasta && hasta.trim()) {
      sql += ` AND created_at <= ?`;
      params.push(`${hasta.trim()} 23:59:59`);
    }

    sql += ` ORDER BY id DESC LIMIT 500`;
    const logs = db.prepare(sql).all(...params);

    const totalMovimientos = db.prepare('SELECT COUNT(*) as c FROM bitacora').get().c;
    const movimientosHoy = db.prepare("SELECT COUNT(*) as c FROM bitacora WHERE date(created_at) = date('now')").get().c;
    const modulosDistintos = db.prepare('SELECT COUNT(DISTINCT modulo) as c FROM bitacora').get().c;

    res.json({
      success: true,
      count: logs.length,
      stats: {
        totalMovimientos,
        movimientosHoy,
        modulosDistintos
      },
      data: logs
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Exportar a Supabase / PostgreSQL
app.get('/api/export/supabase', (req, res) => {
  try {
    const { outputPath } = generateSupabaseSQL();
    res.download(outputPath, 'srei_supabase_export.sql');
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Exportar a Excel (.xlsx) institucional oficial
app.get('/api/export/excel', async (req, res) => {
  try {
    const buffer = await generateExcelReport(db);
    registrarBitacora(req, 'DESCARGAR_EXCEL', 'REPORTES', 'Descarga de nómina institucional completa en formato Excel (.xlsx)', db);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="SREI_Reporte_Estudiantil_Inclusivo.xlsx"');
    res.send(buffer);
  } catch (error) {
    console.error('Error generando reporte Excel:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Exportar a PDF oficial con tablas y membrete institucional
app.get('/api/export/pdf', async (req, res) => {
  try {
    const buffer = await generatePdfReport(db);
    registrarBitacora(req, 'DESCARGAR_PDF', 'REPORTES', 'Descarga de reporte oficial institucional en formato PDF', db);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="SREI_Reporte_Estudiantil_Inclusivo.pdf"');
    res.send(buffer);
  } catch (error) {
    console.error('Error generando reporte PDF:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, async () => {
  console.log(`====================================================`);
  console.log(` Sistema SREI - Educación Inclusiva`);
  console.log(` Servidor local activo en: http://localhost:${PORT}`);
  console.log(` Panel de Administración: http://localhost:${PORT}/admin.html`);
  console.log(` Base de datos relacional de 4 bloques lista`);
  console.log(`====================================================`);

  // Sincronizar automáticamente con Supabase en la nube si DATABASE_URL está activa
  try {
    await pullFromSupabase(db);
  } catch (err) {
    console.error('[Supabase Boot Sync] Error:', err.message);
  }
});
