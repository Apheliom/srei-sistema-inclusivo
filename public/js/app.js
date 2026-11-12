/**
 * SREI - Sistema de Registro Estudiantil Inclusivo
 * Lógica Frontend Nativa: Cero dependencias externas, Modo Offline y Sincronización
 */

(function () {
  'use strict';

  // --- Estado Global de la Aplicación ---
  let allStudents = [];
  let fontScale = parseInt(localStorage.getItem('srei_font_scale') || '100', 10);
  let isHighContrast = localStorage.getItem('srei_contrast') === 'true';

  // --- Referencias al DOM ---
  const optionsBtn = document.getElementById('optionsBtn');
  const optionsPanel = document.getElementById('optionsPanel');
  const closePanelBtn = document.getElementById('closePanelBtn');
  const contrastBtn = document.getElementById('contrastBtn');
  const contrastStatus = document.getElementById('contrastStatus');
  const fontInc = document.getElementById('fontInc');
  const fontDec = document.getElementById('fontDec');
  const fontReset = document.getElementById('fontReset');
  const speakBtn = document.getElementById('speakBtn');

  const connectionStatus = document.getElementById('connectionStatus');
  const registrationForm = document.getElementById('registrationForm');
  const studentsTableBody = document.getElementById('studentsTableBody');
  const searchInput = document.getElementById('searchInput');
  const filterGrade = document.getElementById('filterGrade');
  const filterCondition = document.getElementById('filterCondition');

  const statTotal = document.getElementById('statTotal');
  const statTea = document.getElementById('statTea');
  const statMotor = document.getElementById('statMotor');
  const statVisual = document.getElementById('statVisual');

  const exportSupabaseBtn = document.getElementById('exportSupabaseBtn');

  // --- 1. Inicialización de Accesibilidad y Estado Guardado ---
  function initAccessibility() {
    // Aplicar escala de fuente
    document.documentElement.style.fontSize = (fontScale / 100 * 16) + 'px';

    // Aplicar modo alto contraste
    if (isHighContrast) {
      document.body.classList.add('high-contrast');
      if (contrastStatus) {
        contrastStatus.textContent = 'Activado';
        contrastStatus.className = 'badge';
        contrastStatus.style.backgroundColor = '#10B981';
        contrastStatus.style.color = '#fff';
      }
    }

    // Eventos panel accesibilidad
    if (optionsBtn && optionsPanel) {
      optionsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        optionsPanel.classList.toggle('hidden');
        const isOpen = !optionsPanel.classList.contains('hidden');
        optionsBtn.setAttribute('aria-expanded', String(isOpen));
      });

      if (closePanelBtn) {
        closePanelBtn.addEventListener('click', () => {
          optionsPanel.classList.add('hidden');
          optionsBtn.setAttribute('aria-expanded', 'false');
        });
      }

      document.addEventListener('click', (e) => {
        if (!optionsPanel.contains(e.target) && !optionsBtn.contains(e.target)) {
          optionsPanel.classList.add('hidden');
          optionsBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // Controles de tamaño de fuente
    if (fontInc) {
      fontInc.addEventListener('click', () => {
        if (fontScale < 130) {
          fontScale += 10;
          updateFontScale();
        }
      });
    }

    if (fontDec) {
      fontDec.addEventListener('click', () => {
        if (fontScale > 80) {
          fontScale -= 10;
          updateFontScale();
        }
      });
    }

    if (fontReset) {
      fontReset.addEventListener('click', () => {
        fontScale = 100;
        updateFontScale();
      });
    }

    // Alternar alto contraste
    if (contrastBtn) {
      contrastBtn.addEventListener('click', () => {
        isHighContrast = !isHighContrast;
        document.body.classList.toggle('high-contrast', isHighContrast);
        localStorage.setItem('srei_contrast', String(isHighContrast));
        if (contrastStatus) {
          contrastStatus.textContent = isHighContrast ? 'Activado' : 'Desactivado';
          contrastStatus.style.backgroundColor = isHighContrast ? '#10B981' : '#CBD5E1';
          contrastStatus.style.color = isHighContrast ? '#FFFFFF' : '#1E293B';
        }
      });
    }

    // Lector de voz accesible (Web Speech API nativa sin consumo de red)
    if (speakBtn && 'speechSynthesis' in window) {
      speakBtn.addEventListener('click', () => {
        window.speechSynthesis.cancel();
        const textToRead = "Sistema de Registro Estudiantil Inclusivo. Ser especial, es algo diferente. Construyendo un camino equitativo donde cada estudiante puede brillar con luz propia.";
        const utterance = new SpeechSynthesisUtterance(textToRead);
        utterance.lang = 'es-ES';
        utterance.rate = 0.95;
        window.speechSynthesis.speak(utterance);
        showToast('Reproduciendo audio institucional...', 'info');
      });
    }
  }

  function updateFontScale() {
    document.documentElement.style.fontSize = (fontScale / 100 * 16) + 'px';
    localStorage.setItem('srei_font_scale', String(fontScale));
  }

  // --- 2. Gestión de Red, Service Worker y Modo Offline ---
  function initNetworkAndSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        console.log('[SW] Service Worker registrado para funcionamiento sin conexión');
      }).catch((err) => {
        console.warn('[SW] No se pudo registrar el Service Worker:', err);
      });
    }

    function updateNetworkStatus() {
      const isOnline = navigator.onLine;
      if (connectionStatus) {
        if (isOnline) {
          connectionStatus.className = 'connection-pill';
          connectionStatus.innerHTML = '<span class="status-dot"></span> Modo En Línea';
          // Sincronizar registros pendientes en segundo plano
          syncPendingOfflineRegistrations();
        } else {
          connectionStatus.className = 'connection-pill offline';
          connectionStatus.innerHTML = '<span class="status-dot"></span> Modo Sin Conexión (Datos Guardados Localmente)';
        }
      }
    }

    window.addEventListener('online', () => {
      updateNetworkStatus();
      showToast('Conexión reestablecida. Sincronizando registros...', 'success');
      loadStudents();
    });

    window.addEventListener('offline', () => {
      updateNetworkStatus();
      showToast('Modo sin conexión activo. Puedes seguir registrando estudiantes.', 'info');
    });

    updateNetworkStatus();
  }

  // --- 3. Cola de Sincronización Offline (LocalStorage) ---
  function getOfflineQueue() {
    try {
      return JSON.parse(localStorage.getItem('srei_offline_queue') || '[]');
    } catch {
      return [];
    }
  }

  function saveOfflineQueue(queue) {
    localStorage.setItem('srei_offline_queue', JSON.stringify(queue));
  }

  async function syncPendingOfflineRegistrations() {
    const queue = getOfflineQueue();
    if (queue.length === 0) return;

    let syncedCount = 0;
    const remaining = [];

    for (const student of queue) {
      try {
        const res = await fetch('/api/estudiantes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(student)
        });
        const data = await res.json();
        if (data.success || res.status === 409) {
          syncedCount++;
        } else {
          remaining.push(student);
        }
      } catch {
        remaining.push(student);
      }
    }

    saveOfflineQueue(remaining);
    if (syncedCount > 0) {
      showToast(`¡${syncedCount} registro(s) sincronizados con la base de datos!`, 'success');
      loadStudents();
    }
  }

  // --- 4. Carga y Visualización de Estudiantes ---
  async function loadStudents() {
    try {
      const res = await fetch('/api/estudiantes');
      const json = await res.json();
      if (json.success) {
        allStudents = json.data;
        // Guardar copia local para visualización sin internet
        localStorage.setItem('srei_cached_students', JSON.stringify(allStudents));
        renderStudentsTable(allStudents);
        updateStats();
        return;
      }
    } catch (e) {
      console.warn('Fallo al obtener estudiantes del servidor, cargando copia offline...', e);
    }

    // Fallback offline
    const cached = localStorage.getItem('srei_cached_students');
    if (cached) {
      allStudents = JSON.parse(cached);
      renderStudentsTable(allStudents);
      updateStats();
    }
  }

  function updateStats() {
    if (!statTotal) return;
    statTotal.textContent = allStudents.length;

    const tea = allStudents.filter(s => s.condicion_inclusion.toLowerCase().includes('tea')).length;
    const motor = allStudents.filter(s => s.condicion_inclusion.toLowerCase().includes('motriz')).length;
    const visual = allStudents.filter(s => s.condicion_inclusion.toLowerCase().includes('visual')).length;

    if (statTea) statTea.textContent = tea;
    if (statMotor) statMotor.textContent = motor;
    if (statVisual) statVisual.textContent = visual;
  }

  function renderStudentsTable(students) {
    if (!studentsTableBody) return;

    if (students.length === 0) {
      studentsTableBody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 2rem; color: var(--brand-muted);">
            No se encontraron estudiantes registrados con los criterios seleccionados.
          </td>
        </tr>
      `;
      return;
    }

    studentsTableBody.innerHTML = students.map((s) => `
      <tr>
        <td><strong>${escapeHtml(s.cedula)}</strong></td>
        <td>
          <div style="font-weight: 700; color: var(--brand-navy);">${escapeHtml(s.nombres)} ${escapeHtml(s.apellidos)}</div>
          <small style="color: var(--brand-muted);">Nacimiento: ${escapeHtml(s.fecha_nacimiento)} (${escapeHtml(s.genero || 'N/E')})</small>
        </td>
        <td>
          <span class="badge badge-grade">${escapeHtml(s.grado)} - Sec. ${escapeHtml(s.seccion || 'A')}</span>
        </td>
        <td>
          <span class="badge badge-inclusion">${escapeHtml(s.condicion_inclusion)}</span>
          ${s.detalles_apoyo ? `<div style="font-size: 0.78rem; color: #475569; margin-top: 4px;"><strong>Apoyo:</strong> ${escapeHtml(s.detalles_apoyo)}</div>` : ''}
        </td>
        <td>
          <div>${escapeHtml(s.nombre_tutor)}</div>
          <small style="color: var(--brand-muted);">${escapeHtml(s.telefono_tutor)} (${escapeHtml(s.parentesco_tutor || 'Tutor')})</small>
        </td>
        <td>
          <button class="btn btn-outline btn-sm delete-btn" data-id="${s.id}" title="Eliminar registro">
            ✕
          </button>
        </td>
      </tr>
    `).join('');

    // Asignar listeners a botones de eliminar
    document.querySelectorAll('.delete-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        deleteStudent(id);
      });
    });
  }

  // Filtrado reactivo en cliente (cero consumo de red)
  function filterStudents() {
    const search = (searchInput ? searchInput.value : '').toLowerCase().trim();
    const grade = filterGrade ? filterGrade.value : '';
    const cond = filterCondition ? filterCondition.value : '';

    const filtered = allStudents.filter((s) => {
      const matchSearch = !search || 
        s.nombres.toLowerCase().includes(search) || 
        s.apellidos.toLowerCase().includes(search) || 
        s.cedula.toLowerCase().includes(search);
      const matchGrade = !grade || s.grado === grade;
      const matchCond = !cond || s.condicion_inclusion === cond;
      return matchSearch && matchGrade && matchCond;
    });

    renderStudentsTable(filtered);
  }

  if (searchInput) searchInput.addEventListener('input', filterStudents);
  if (filterGrade) filterGrade.addEventListener('change', filterStudents);
  if (filterCondition) filterCondition.addEventListener('change', filterStudents);

  // --- 5. Envío del Formulario de Registro ---
  if (registrationForm) {
    registrationForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const formData = new FormData(registrationForm);
      const payload = Object.fromEntries(formData.entries());

      // Validar campos requeridos
      if (!payload.cedula || !payload.nombres || !payload.apellidos || !payload.fecha_nacimiento || !payload.grado || !payload.condicion_inclusion || !payload.nombre_tutor || !payload.telefono_tutor) {
        showToast('Por favor completa todos los campos requeridos con asterisco (*)', 'error');
        return;
      }

      // Si no hay conexión o falla la red, guardar en cola offline
      if (!navigator.onLine) {
        const queue = getOfflineQueue();
        payload.id = 'temp_' + Date.now();
        queue.push(payload);
        saveOfflineQueue(queue);

        allStudents.unshift(payload);
        renderStudentsTable(allStudents);
        updateStats();
        registrationForm.reset();
        showToast('Guardado localmente sin conexión. Se sincronizará al volver la red.', 'info');
        return;
      }

      try {
        const res = await fetch('/api/estudiantes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok && data.success) {
          showToast('¡Estudiante registrado exitosamente en el SREI!', 'success');
          registrationForm.reset();
          loadStudents();
          // Desplazar suavemente a la lista
          const listElem = document.getElementById('estudiantes');
          if (listElem) listElem.scrollIntoView({ behavior: 'smooth' });
        } else {
          showToast(data.error || 'Error al procesar el registro.', 'error');
        }
      } catch (err) {
        console.warn('Error de red al registrar, guardando en cola offline...', err);
        const queue = getOfflineQueue();
        payload.id = 'temp_' + Date.now();
        queue.push(payload);
        saveOfflineQueue(queue);
        allStudents.unshift(payload);
        renderStudentsTable(allStudents);
        updateStats();
        registrationForm.reset();
        showToast('Conexión inestable: Guardado en almacenamiento local.', 'info');
      }
    });
  }

  // --- 6. Eliminar Estudiante ---
  async function deleteStudent(id) {
    if (!confirm('¿Estás seguro de que deseas eliminar este registro estudiantil?')) return;

    if (String(id).startsWith('temp_')) {
      const queue = getOfflineQueue().filter(s => s.id !== id);
      saveOfflineQueue(queue);
      allStudents = allStudents.filter(s => s.id !== id);
      renderStudentsTable(allStudents);
      updateStats();
      showToast('Registro eliminado de la memoria local.', 'info');
      return;
    }

    try {
      const res = await fetch(`/api/estudiantes/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        showToast('Estudiante eliminado correctamente.', 'success');
        loadStudents();
      } else {
        showToast(data.error || 'No se pudo eliminar.', 'error');
      }
    } catch {
      showToast('No fue posible conectar con el servidor para eliminar.', 'error');
    }
  }

  // --- 7. Exportación hacia Supabase ---
  if (exportSupabaseBtn) {
    exportSupabaseBtn.addEventListener('click', () => {
      showToast('Generando script SQL compatible con Supabase...', 'info');
      window.location.href = '/api/export/supabase';
    });
  }

  // --- 8. Notificaciones Toast Accesibles ---
  function showToast(message, type = 'info') {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.setAttribute('role', 'alert');
    toast.textContent = message;

    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Inicializar todo al cargar el DOM
  document.addEventListener('DOMContentLoaded', () => {
    initAccessibility();
    initNetworkAndSW();
    loadStudents();
  });
})();

