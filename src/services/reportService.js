const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// Helper: Calcular edad a partir de fecha de nacimiento YYYY-MM-DD
function calcularEdad(fechaNac) {
  if (!fechaNac) return '';
  const hoy = new Date();
  const nac = new Date(fechaNac);
  if (isNaN(nac.getTime())) return '';
  let edad = hoy.getFullYear() - nac.getFullYear();
  const mes = hoy.getMonth() - nac.getMonth();
  if (mes < 0 || (mes === 0 && hoy.getDate() < nac.getDate())) {
    edad--;
  }
  return edad >= 0 ? edad : '';
}

// Normalizar condición a categorías estadísticas mayores
function categorizarCondicion(condicion) {
  const c = (condicion || '').toLowerCase();
  if (c.includes('autis') || c.includes('tea')) return 'AUTISMO';
  if (c.includes('cognit') || c.includes('intelectual') || c.includes('retardo') || c.includes('deficit cogn')) return 'DISCAPACIDAD INTELECTUAL';
  if (c.includes('motor') || c.includes('fina') || c.includes('fisic') || c.includes('físic')) return 'DISCAPACIDAD FISICO MOTORA';
  return 'DIFICULTADES PARA EL APRENDIZAJE';
}

// Clasificar nivel educativo a partir del nombre del plantel o grado
function categorizarNivel(nombreInstitucion, grado) {
  const inst = (nombreInstitucion || '').toLowerCase();
  const grd = (grado || '').toLowerCase();
  if (inst.includes('comunitario')) return 'COMUNITARIO';
  if (grd.includes('inicial') || grd.includes('preescolar')) return 'EDUCACIÓN INICIAL';
  if (inst.includes('liceo') || grd.includes('año')) return 'EDUCACIÓN MEDIA GENERAL';
  return 'EDUCACIÓN PRIMARIA';
}

/**
 * Obtener todos los datos consolidados agrupados por institución
 */
function getReportData(db) {
  const instituciones = db.prepare('SELECT * FROM instituciones ORDER BY id ASC').all();
  
  const estudiantesRaw = db.prepare(`
    SELECT 
      e.id,
      e.institucion_id,
      e.numero_orden,
      e.nombres_apellidos,
      e.cedula_identidad,
      e.fecha_nacimiento,
      e.sexo,
      e.grado_seccion,
      m.condicion,
      m.estatus_diagnostico,
      m.observaciones,
      m.atencion_psicologica,
      m.entrevista_social,
      m.informe_integral,
      m.toma_medicamento,
      m.medicamento_detalles,
      r.nombre_representante,
      r.telefono
    FROM estudiantes e
    LEFT JOIN expedientes_medicos m ON e.id = m.estudiante_id
    LEFT JOIN representantes r ON e.id = r.estudiante_id
    ORDER BY e.institucion_id ASC, e.numero_orden ASC, e.id ASC
  `).all();

  const dataPorInstitucion = instituciones.map(inst => {
    const estudiantes = estudiantesRaw.filter(e => e.institucion_id === inst.id);
    return {
      institucion: inst,
      estudiantes: estudiantes.map((e, idx) => ({
        ...e,
        numero: e.numero_orden || (idx + 1),
        edad: calcularEdad(e.fecha_nacimiento),
        sexoCorto: (e.sexo === 'Femenino' || e.sexo === 'F') ? 'F' : 'M',
        checkPsico: (e.atencion_psicologica === 'Sí' || e.atencion_psicologica === 'X') ? 'X' : '',
        checkSocial: (e.entrevista_social === 'Realizada' || e.entrevista_social === 'Sí') ? 'X' : '',
        checkInforme: (e.informe_integral === 'Listo' || e.informe_integral === 'Sí') ? 'X' : ((e.informe_integral === 'En proceso') ? 'EN PROCESO' : '')
      }))
    };
  }).filter(group => group.estudiantes.length > 0 || instituciones.length <= 5);

  return { instituciones, estudiantesRaw, dataPorInstitucion };
}

/**
 * Generar Excel (.xlsx) con el formato exacto institucional
 */
async function generateExcelReport(db) {
  const { dataPorInstitucion, estudiantesRaw } = getReportData(db);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'SREI - Servicio Especial de Educación Inclusiva';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Matrícula e Inclusión SREI', {
    pageSetup: { orientation: 'landscape', paperSize: 9 }
  });

  // Configuración de anchos de columna
  sheet.columns = [
    { key: 'col1', width: 6 },   // N°
    { key: 'col2', width: 34 },  // NOMBRES Y APELLIDOS
    { key: 'col3', width: 14 },  // FECHA DE NAC
    { key: 'col4', width: 8 },   // EDAD
    { key: 'col5', width: 7 },   // SEXO
    { key: 'col6', width: 14 },  // GRADO
    { key: 'col7', width: 28 },  // CONDICIÓN
    { key: 'col8', width: 26 },  // REPRESENTANTE
    { key: 'col9', width: 16 },  // TELEFONO
    { key: 'col10', width: 14 }, // ATENC / PSICOL
    { key: 'col11', width: 14 }, // ENTREV / SOCIAL
    { key: 'col12', width: 16 }, // INFORME INTEGRAL
    { key: 'col13', width: 32 }  // OBSERVACIÓN
  ];

  // Recorrer cada institución y dibujar su sección idéntica al Excel original
  for (const group of dataPorInstitucion) {
    // Fila vacía de separación
    sheet.addRow([]);

    // Nombre de la Institución
    const nombreInstRow = sheet.addRow([
      '',
      group.institucion.nombre_institucion.toUpperCase()
    ]);
    nombreInstRow.getCell(2).font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF1E3A8A' } };

    // Encabezados de Tabla
    const headerRow = sheet.addRow([
      'N°',
      'NOMBRES Y APELLIDOS',
      'FECHA DE NAC',
      'EDAD',
      'SEXO',
      'GRADO',
      'CONDICIÓN',
      'REPRESENTANTE',
      'TELEFONO',
      'ATENC / PSICOL',
      'ENTREV / SOCIAL',
      'INFORME INTEGRAL',
      'OBSERVACIÓN'
    ]);

    headerRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E3A8A' }
      };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // Filas de Estudiantes
    group.estudiantes.forEach((est) => {
      const dataRow = sheet.addRow([
        est.numero,
        est.nombres_apellidos,
        est.fecha_nacimiento || '',
        est.edad,
        est.sexoCorto,
        est.grado_seccion,
        est.condicion,
        est.nombre_representante || '',
        est.telefono || '',
        est.checkPsico,
        est.checkSocial,
        est.checkInforme,
        est.observaciones || ''
      ]);

      dataRow.eachCell((cell, colNum) => {
        cell.font = { name: 'Calibri', size: 9 };
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };

        // Alineación específica
        if ([1, 3, 4, 5, 6, 10, 11, 12].includes(colNum)) {
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          cell.alignment = { horizontal: 'left', vertical: 'middle' };
        }
      });
    });

    // Conteo por Grado y Sexo de esta institución
    const conteoGrados = {};
    let totalVaronesInst = 0;
    let totalHembrasInst = 0;

    group.estudiantes.forEach(est => {
      const g = (est.grado_seccion || 'SIN ASIGNAR').trim();
      if (!conteoGrados[g]) {
        conteoGrados[g] = { varones: 0, hembras: 0 };
      }
      if (est.sexoCorto === 'M') {
        conteoGrados[g].varones++;
        totalVaronesInst++;
      } else {
        conteoGrados[g].hembras++;
        totalHembrasInst++;
      }
    });

    // Fila vacía
    sheet.addRow([]);

    // Tabla Resumen de la Institución
    const subHeader = sheet.addRow(['', '', '', '', '', '', '', 'GRADO', 'VARONES', 'HEMBRAS']);
    subHeader.getCell(8).font = { bold: true, size: 9 };
    subHeader.getCell(9).font = { bold: true, size: 9 };
    subHeader.getCell(10).font = { bold: true, size: 9 };

    Object.keys(conteoGrados).forEach(grd => {
      const c = conteoGrados[grd];
      sheet.addRow(['', '', '', '', '', '', '', grd, c.varones || '', c.hembras || '']);
    });

    // Total de la institución
    const totalRow = sheet.addRow(['', '', '', '', '', '', '', 'TOTAL', totalVaronesInst, totalHembrasInst, totalVaronesInst + totalHembrasInst]);
    totalRow.getCell(8).font = { bold: true, size: 9 };
    totalRow.getCell(9).font = { bold: true, size: 9 };
    totalRow.getCell(10).font = { bold: true, size: 9 };
    totalRow.getCell(11).font = { bold: true, size: 9 };

    // Conteo de secciones
    const cantSecciones = Object.keys(conteoGrados).length;
    const secRow = sheet.addRow(['', '', '', '', '', '', '', 'SECCIONES', cantSecciones]);
    secRow.getCell(8).font = { bold: true, size: 9 };
    secRow.getCell(9).font = { bold: true, size: 9 };

    sheet.addRow([]);
  }

  // ====================================================================
  // CONSOLIDADO GENERAL DEMOGRÁFICO FINAL (IDÉNTICO AL EXCEL ORIGINAL)
  // ====================================================================

  sheet.addRow([]);
  const consHeader = sheet.addRow(['', 'CONSOLIDADO ESTADÍSTICO GENERAL - SERVICIO ESPECIAL DE EDUCACIÓN INCLUSIVA']);
  consHeader.getCell(2).font = { bold: true, size: 12, color: { argb: 'FF1E3A8A' } };

  // Resumen de Condiciones Agrupadas
  const categorias = [
    'DIFICULTADES PARA EL APRENDIZAJE',
    'AUTISMO',
    'DISCAPACIDAD INTELECTUAL',
    'DISCAPACIDAD FISICO MOTORA'
  ];

  const conteoCategorias = {
    'DIFICULTADES PARA EL APRENDIZAJE': { V: 0, H: 0 },
    'AUTISMO': { V: 0, H: 0 },
    'DISCAPACIDAD INTELECTUAL': { V: 0, H: 0 },
    'DISCAPACIDAD FISICO MOTORA': { V: 0, H: 0 }
  };

  estudiantesRaw.forEach(e => {
    const cat = categorizarCondicion(e.condicion);
    const s = (e.sexo === 'Femenino' || e.sexo === 'F') ? 'H' : 'V';
    if (conteoCategorias[cat]) {
      conteoCategorias[cat][s]++;
    }
  });

  const catHead = sheet.addRow(['', 'CONDICIÓN DIAGNÓSTICA AGRUPADA', 'VARONES', 'HEMBRAS', 'TOTAL']);
  [2, 3, 4, 5].forEach(col => {
    catHead.getCell(col).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    catHead.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
    catHead.getCell(col).alignment = { horizontal: 'center' };
  });

  let totalVGeneral = 0;
  let totalHGeneral = 0;

  categorias.forEach(cat => {
    const v = conteoCategorias[cat].V;
    const h = conteoCategorias[cat].H;
    totalVGeneral += v;
    totalHGeneral += h;
    sheet.addRow(['', cat, v, h, v + h]);
  });

  const totalCatRow = sheet.addRow(['', 'TOTAL GENERAL POR CONDICIÓN', totalVGeneral, totalHGeneral, totalVGeneral + totalHGeneral]);
  [2, 3, 4, 5].forEach(col => totalCatRow.getCell(col).font = { bold: true });

  // Distribución por Niveles Educativos
  sheet.addRow([]);
  const nivHead = sheet.addRow(['', 'NIVEL EDUCATIVO', 'VARONES', 'HEMBRAS', 'TOTAL']);
  [2, 3, 4, 5].forEach(col => {
    nivHead.getCell(col).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    nivHead.getCell(col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
    nivHead.getCell(col).alignment = { horizontal: 'center' };
  });

  const conteoNiveles = {
    'EDUCACIÓN INICIAL': { V: 0, H: 0 },
    'EDUCACIÓN PRIMARIA': { V: 0, H: 0 },
    'EDUCACIÓN MEDIA GENERAL': { V: 0, H: 0 },
    'COMUNITARIO': { V: 0, H: 0 }
  };

  estudiantesRaw.forEach(e => {
    const instObj = dataPorInstitucion.find(g => g.institucion.id === e.institucion_id);
    const nombreInst = instObj ? instObj.institucion.nombre_institucion : '';
    const niv = categorizarNivel(nombreInst, e.grado_seccion);
    const s = (e.sexo === 'Femenino' || e.sexo === 'F') ? 'H' : 'V';
    if (conteoNiveles[niv]) {
      conteoNiveles[niv][s]++;
    }
  });

  Object.keys(conteoNiveles).forEach(niv => {
    const v = conteoNiveles[niv].V;
    const h = conteoNiveles[niv].H;
    sheet.addRow(['', niv, v, h, v + h]);
  });

  const totalNivRow = sheet.addRow(['', 'TOTAL ESTUDIANTES ATENDIDOS', totalVGeneral, totalHGeneral, totalVGeneral + totalHGeneral]);
  [2, 3, 4, 5].forEach(col => totalNivRow.getCell(col).font = { bold: true });

  return await workbook.xlsx.writeBuffer();
}

/**
 * Generar Reporte PDF Binario Directo
 */
function generatePdfReport(db) {
  return new Promise((resolve, reject) => {
    try {
      const { dataPorInstitucion, estudiantesRaw } = getReportData(db);

      const doc = new PDFDocument({
        layout: 'landscape',
        size: 'LEGAL',
        margin: 25,
        bufferPages: true
      });

      const chunks = [];
      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', err => reject(err));

      // Membrete Institucional
      doc.fontSize(14).font('Helvetica-Bold').fillColor('#1E3A8A').text('SISTEMA DE REGISTRO ESTUDIANTIL INCLUSIVO (SREI)', { align: 'center' });
      doc.fontSize(10).font('Helvetica').fillColor('#10B981').text('SERVICIO ESPECIAL DE EDUCACIÓN INCLUSIVA · REPORTE OFICIAL DE EXPEDIENTES', { align: 'center' });
      doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569').text('Dirección: Magister Amparo Aguilar', { align: 'center' });
      doc.moveDown(0.8);

      // Dibujar cada institución
      dataPorInstitucion.forEach((group, gIdx) => {
        if (gIdx > 0 && doc.y > 450) {
          doc.addPage();
        }

        // Título del Plantel
        doc.rect(25, doc.y, 960, 18).fill('#1E3A8A');
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#FFFFFF')
           .text(`PLANTEL: ${group.institucion.nombre_institucion.toUpperCase()}`, 35, doc.y - 14);
        doc.moveDown(0.5);

        // Columnas del PDF
        const cols = [
          { name: 'N°', w: 25, x: 25 },
          { name: 'NOMBRES Y APELLIDOS', w: 140, x: 50 },
          { name: 'FECHA NAC', w: 60, x: 190 },
          { name: 'EDAD', w: 30, x: 250 },
          { name: 'SEXO', w: 30, x: 280 },
          { name: 'GRADO', w: 55, x: 310 },
          { name: 'CONDICIÓN DIAGNÓSTICA', w: 130, x: 365 },
          { name: 'REPRESENTANTE', w: 120, x: 495 },
          { name: 'TELÉFONO', w: 75, x: 615 },
          { name: 'PSI', w: 35, x: 690 },
          { name: 'SOC', w: 35, x: 725 },
          { name: 'INF', w: 45, x: 760 },
          { name: 'OBSERVACIÓN', w: 180, x: 805 }
        ];

        // Cabecera de columnas
        const headerY = doc.y;
        doc.rect(25, headerY, 960, 14).fill('#F1F5F9');
        cols.forEach(c => {
          doc.fontSize(7).font('Helvetica-Bold').fillColor('#1E293B').text(c.name, c.x + 2, headerY + 3, { width: c.w, align: 'left' });
        });
        doc.moveDown(0.7);

        // Filas de estudiantes
        group.estudiantes.forEach((est, rowIdx) => {
          if (doc.y > 540) {
            doc.addPage();
          }
          const rowY = doc.y;
          const bg = (rowIdx % 2 === 0) ? '#FFFFFF' : '#F8FAFC';
          doc.rect(25, rowY - 1, 960, 13).fill(bg);

          doc.fontSize(7).font('Helvetica').fillColor('#1E293B');
          doc.text(String(est.numero), cols[0].x + 2, rowY + 1, { width: cols[0].w });
          doc.font('Helvetica-Bold').text(est.nombres_apellidos, cols[1].x + 2, rowY + 1, { width: cols[1].w, ellipsis: true });
          doc.font('Helvetica').text(est.fecha_nacimiento || '—', cols[2].x + 2, rowY + 1, { width: cols[2].w });
          doc.text(String(est.edad || '—'), cols[3].x + 2, rowY + 1, { width: cols[3].w });
          doc.text(est.sexoCorto, cols[4].x + 2, rowY + 1, { width: cols[4].w });
          doc.text(est.grado_seccion, cols[5].x + 2, rowY + 1, { width: cols[5].w, ellipsis: true });
          doc.font('Helvetica-Bold').fillColor('#0F172A').text(est.condicion, cols[6].x + 2, rowY + 1, { width: cols[6].w, ellipsis: true });
          doc.font('Helvetica').fillColor('#334155').text(est.nombre_representante || '—', cols[7].x + 2, rowY + 1, { width: cols[7].w, ellipsis: true });
          doc.text(est.telefono || '—', cols[8].x + 2, rowY + 1, { width: cols[8].w, ellipsis: true });
          doc.text(est.checkPsico || '—', cols[9].x + 2, rowY + 1, { width: cols[9].w });
          doc.text(est.checkSocial || '—', cols[10].x + 2, rowY + 1, { width: cols[10].w });
          doc.text(est.checkInforme || '—', cols[11].x + 2, rowY + 1, { width: cols[11].w });
          doc.text(est.observaciones || '—', cols[12].x + 2, rowY + 1, { width: cols[12].w, ellipsis: true });

          doc.moveDown(0.7);
        });

        doc.moveDown(1);
      });

      // Pie con número de página
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.fontSize(7).font('Helvetica').fillColor('#94A3B8')
           .text(`SREI - Servicio Especial de Educación Inclusiva | Documento Oficial | Página ${i + 1} de ${range.count}`, 25, 585, { align: 'center', width: 960 });
      }

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  generateExcelReport,
  generatePdfReport
};

