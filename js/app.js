// ========================================
// Aplicación Principal - Mis Lecturas Gabo
// ========================================

// Estado global de la aplicación
let libros = [];
let filtroActual = 'Todos';
let vistaActual = 'grid'; // 'grid' | 'list'
let libroEditando = null;
let eventListenersInicializados = false;

// ========================================
// Inicialización
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
    // Registrar listeners de UI una sola vez
    inicializarEventListeners();

    if (supabaseConfigurado) {
        // inicializarAuth: registra onAuthStateChange y obtiene sesión actual
        const usuario = await inicializarAuth();

        if (usuario) {
            // Sesión activa desde el inicio (recarga con sesión, o post-OAuth redirect)
            console.log('[App] Sesión activa al cargar, mostrando app...');
            ocultarPantallaLogin();
            actualizarUIUsuario(usuario);
            await migrarDesdeLocalStorage();
            await cargarDatos();
            actualizarInterfaz();
        } else {
            // Sin sesión → mostrar login
            // onAuthStateChange manejará el SIGNED_IN futuro
            console.log('[App] Sin sesión, mostrando login...');
            mostrarPantallaLogin();
        }
    } else {
        // Modo offline: usar localStorage directamente
        await cargarDatos();
        actualizarInterfaz();
    }

    // Actualizar días para libros "Leyendo" cada minuto
    setInterval(actualizarDiasEnProceso, 60000);
});

// ========================================
// Gestión de Datos
// Prioridad: Supabase → localStorage → datos originales
// ========================================
async function cargarDatos() {
    // --- Modo Supabase ---
    if (supabaseConfigurado && usuarioActual) {
        const lecturasDB = await cargarLecturasDB();

        if (lecturasDB !== null) {
            libros = fusionarConCatalogo(lecturasDB);
            limpiarYValidarLibros();
            return;
        }
        // Si falla la DB, caer a localStorage como fallback
        console.warn('Fallo DB, usando localStorage como fallback');
    }

    // --- Modo localStorage (offline o fallback) ---
    const datosGuardados = localStorage.getItem('gaboLecturas');

    if (datosGuardados) {
        try {
            libros = JSON.parse(datosGuardados);
        } catch (error) {
            console.error('Error al parsear datos guardados:', error);
            libros = JSON.parse(JSON.stringify(librosOriginales));
        }
    } else {
        libros = JSON.parse(JSON.stringify(librosOriginales));
    }

    limpiarYValidarLibros();
}

function limpiarYValidarLibros() {
    libros.forEach(libro => {
        // Limpiar fechas de libros pendientes
        if (libro.estado === 'Pendiente') {
            libro.inicio = null;
            libro.final = null;
            libro.dias = null;
        }
        // Recalcular días
        calcularDias(libro);
    });
}

async function guardarDatos() {
    // --- Modo Supabase ---
    if (supabaseConfigurado && usuarioActual) {
        const ok = await guardarTodasLecturasDB(libros);
        if (ok) return;
        console.warn('Fallo al guardar en DB, usando localStorage como fallback');
    }

    // --- Modo localStorage ---
    try {
        localStorage.setItem('gaboLecturas', JSON.stringify(libros));
        localStorage.setItem('lastUpdated', new Date().toISOString());
    } catch (error) {
        console.error('Error al guardar datos:', error);
        alert('Error al guardar los datos. Es posible que el almacenamiento esté lleno.');
    }
}

async function guardarLectura(index) {
    const libro = libros[index];

    // --- Modo Supabase (guardar solo la lectura modificada) ---
    if (supabaseConfigurado && usuarioActual) {
        const ok = await guardarLecturaDB(index, libro);
        if (ok) return;
        console.warn('Fallo al guardar lectura en DB, usando localStorage como fallback');
    }

    // --- Modo localStorage ---
    try {
        localStorage.setItem('gaboLecturas', JSON.stringify(libros));
        localStorage.setItem('lastUpdated', new Date().toISOString());
    } catch (error) {
        console.error('Error al guardar datos:', error);
    }
}

function resetearDatos() {
    if (confirm('¿Estás seguro de que quieres resetear todos los datos a los valores originales?')) {
        localStorage.removeItem('gaboLecturas');
        localStorage.removeItem('lastUpdated');
        location.reload();
    }
}

// ========================================
// Cálculo Automático de Días
// ========================================
function calcularDias(libro) {
    if (!libro.inicio) {
        libro.dias = null;
        return;
    }

    const fechaInicio = parseFechaEspañol(libro.inicio);
    if (!fechaInicio) {
        libro.dias = null;
        return;
    }

    let fechaFinal;

    if (libro.estado === 'Leyendo') {
        fechaFinal = new Date();
    } else if (libro.estado === 'Leído' && libro.final) {
        fechaFinal = parseFechaEspañol(libro.final);
    } else {
        libro.dias = null;
        return;
    }

    if (!fechaFinal) {
        libro.dias = null;
        return;
    }

    const diferenciaMilisegundos = fechaFinal - fechaInicio;
    const dias = Math.floor(diferenciaMilisegundos / (1000 * 60 * 60 * 24));
    libro.dias = dias >= 0 ? dias : null;
}

function actualizarDiasEnProceso() {
    let actualizado = false;

    libros.forEach(libro => {
        if (libro.estado === 'Leyendo' && libro.inicio) {
            const diasAntes = libro.dias;
            calcularDias(libro);
            if (libro.dias !== diasAntes) actualizado = true;
        }
    });

    if (actualizado) {
        renderizarLibros();
        actualizarEstadisticas();
    }
}

// ========================================
// Google Books API - Obtener Portadas
// ========================================
async function obtenerPortada(titulo, autor = 'Gabriel García Márquez') {
    try {
        const query = encodeURIComponent(`intitle:${titulo} inauthor:${autor}`);
        const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=1`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.items && data.items.length > 0) {
            const imageLinks = data.items[0].volumeInfo.imageLinks;
            if (imageLinks) {
                return imageLinks.thumbnail || imageLinks.smallThumbnail || null;
            }
        }
        return null;
    } catch (error) {
        console.error(`Error al obtener portada para "${titulo}":`, error);
        return null;
    }
}

async function cargarTodasLasPortadas() {
    const promesas = libros.map(async (libro, index) => {
        if (!libro.portada) {
            const portada = await obtenerPortada(libro.titulo);
            if (portada) {
                libros[index].portada = portada;
            }
        }
    });

    await Promise.all(promesas);
    await guardarDatos();
    renderizarLibros();
}

// ========================================
// Renderizado de Interfaz
// ========================================
function actualizarInterfaz() {
    renderizarLibros();
    actualizarEstadisticas();
    renderizarTimeline();
    initCharts(libros);

    // Cargar portadas de forma asíncrona
    cargarTodasLasPortadas();
}

function renderizarLibros() {
    const grid = document.getElementById('books-grid');
    if (!grid) return;

    let librosFiltrados = libros;

    if (filtroActual !== 'Todos') {
        librosFiltrados = libros.filter(libro => libro.estado === filtroActual);
    }

    const searchInput = document.getElementById('search-input');
    if (searchInput && searchInput.value.trim()) {
        const busqueda = searchInput.value.toLowerCase();
        librosFiltrados = librosFiltrados.filter(libro =>
            libro.titulo.toLowerCase().includes(busqueda)
        );
    }

    grid.innerHTML = '';

    librosFiltrados.forEach((libro) => {
        const realIndex = libros.indexOf(libro);
        const card = crearCardLibro(libro, realIndex);
        grid.appendChild(card);
    });

    if (librosFiltrados.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #666;">No se encontraron libros con ese criterio.</p>';
    }
}

function crearCardLibro(libro, index) {
    const card = document.createElement('div');
    card.className = 'book-card';
    card.dataset.index = index;

    calcularDias(libro);

    const estadoClass = libro.estado === 'Leído' ? 'status-leido' :
                        libro.estado === 'Leyendo' ? 'status-leyendo' :
                        'status-pendiente';

    const estadoCardClass = libro.estado === 'Leído' ? 'estado-leido' :
                             libro.estado === 'Leyendo' ? 'estado-leyendo' :
                             'estado-pendiente';
    card.classList.add(estadoCardClass);

    // Calcular progreso basado en promedio real de días leídos
    let progreso = 0;
    if (libro.estado === 'Leído') {
        progreso = 100;
    } else if (libro.estado === 'Leyendo' && libro.inicio) {
        const diasTranscurridos = libro.dias || 0;
        const promedioReal = calcularPromedioDias();
        const diasEstimados = promedioReal > 0 ? promedioReal : 30;
        progreso = Math.min((diasTranscurridos / diasEstimados) * 100, 95);
    }

    card.innerHTML = `
        <div class="book-card-actions">
            <button class="quick-action-btn quick-action-pendiente" data-action="Pendiente" title="Pendiente">⊙</button>
            <button class="quick-action-btn quick-action-leyendo" data-action="Leyendo" title="Leyendo">▶</button>
            <button class="quick-action-btn quick-action-leido" data-action="Leído" title="Leído">✓</button>
        </div>
        <div class="book-cover-wrapper">
            ${libro.portada
                ? `<img src="${libro.portada}" alt="${libro.titulo}" class="book-cover">`
                : '<div class="book-cover-placeholder">📚</div>'}
        </div>
        <div class="book-info">
            <div class="book-year">${libro.año}</div>
            <span class="book-status ${estadoClass}">${libro.estado}</span>
            <h3 class="book-title">${libro.titulo}</h3>
            <p class="book-pages">${libro.paginas} pág</p>
            ${progreso > 0 ? `
                <div class="book-progress">
                    <div class="book-progress-bar" style="width: ${progreso}%"></div>
                </div>
            ` : ''}
        </div>
    `;

    // Click en cualquier parte de la card abre el modal
    card.addEventListener('click', (e) => {
        // Ignorar si el click fue en un botón de acción rápida
        if (e.target.closest('.quick-action-btn')) return;
        abrirModalEdicion(card.dataset.index);
    });

    const actionButtons = card.querySelectorAll('.quick-action-btn');
    actionButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            cambiarEstadoRapido(card.dataset.index, btn.dataset.action);
        });
    });

    return card;
}

function actualizarEstadisticas() {
    const leidos = libros.filter(l => l.estado === 'Leído').length;
    const leyendo = libros.filter(l => l.estado === 'Leyendo').length;
    const pendientes = libros.filter(l => l.estado === 'Pendiente').length;

    const paginasLeidas = libros
        .filter(l => l.estado === 'Leído')
        .reduce((total, libro) => total + libro.paginas, 0);

    const promedioDias = calcularPromedioDias();

    document.getElementById('total-leidos').textContent = leidos;
    document.getElementById('total-leyendo').textContent = leyendo;
    document.getElementById('total-pendientes').textContent = pendientes;
    document.getElementById('total-paginas').textContent = paginasLeidas.toLocaleString();
    document.getElementById('promedio-dias').textContent = promedioDias;
}

function calcularPromedioDias() {
    const librosConDias = libros.filter(l => l.estado === 'Leído' && l.dias !== null);
    if (librosConDias.length === 0) return 0;
    return Math.round(
        librosConDias.reduce((sum, l) => sum + l.dias, 0) / librosConDias.length
    );
}

function renderizarTimeline() {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;

    timeline.innerHTML = '<div class="timeline-line"></div>';

    libros.forEach((libro, index) => {
        const item = document.createElement('div');

        const estadoClass = libro.estado === 'Leído' ? 'leido' :
                            libro.estado === 'Leyendo' ? 'leyendo' : 'pendiente';

        // clase en el item para controlar colores de año y título via CSS
        item.className = `timeline-item ${estadoClass}`;

        const statusLabel = libro.estado === 'Leído' ? 'leido' :
                            libro.estado === 'Leyendo' ? 'leyendo' : 'pendiente';

        item.innerHTML = `
            <div class="timeline-dot ${estadoClass === 'pendiente' ? '' : estadoClass}"></div>
            <div class="timeline-year">${libro.año}</div>
            <div class="timeline-title">${libro.titulo}</div>
            <span class="timeline-status ${statusLabel}">${libro.estado}</span>
        `;

        item.addEventListener('click', () => abrirModalEdicion(index));
        timeline.appendChild(item);
    });
}

// ========================================
// Modal de Edición
// ========================================
function abrirModalEdicion(index) {
    libroEditando = parseInt(index);
    const libro = libros[libroEditando];

    const heroImage = document.getElementById('modal-hero-image');
    if (libro.portada) {
        heroImage.style.backgroundImage = `url(${libro.portada})`;
    } else {
        heroImage.style.background = 'linear-gradient(135deg, rgba(0, 217, 163, 0.2), rgba(255, 107, 157, 0.2))';
    }

    document.getElementById('modal-year').textContent = libro.año;
    document.getElementById('modal-title').textContent = libro.titulo;
    document.getElementById('modal-pages').textContent = `${libro.paginas} páginas`;

    const estadoBadge = document.getElementById('modal-estado-badge');
    estadoBadge.textContent = libro.estado;
    estadoBadge.className = '';
    estadoBadge.classList.add(
        libro.estado === 'Leído' ? 'status-leido' :
        libro.estado === 'Leyendo' ? 'status-leyendo' :
        'status-pendiente'
    );

    document.getElementById('modal-description').textContent = libro.resumen || 'Sin descripción disponible.';
    document.getElementById('modal-fecha-inicio').textContent = libro.inicio || '--';
    document.getElementById('modal-fecha-final').textContent = libro.final || '--';
    document.getElementById('modal-dias').textContent = libro.dias !== null ? `${libro.dias} días` : '--';

    let progreso = 0;
    if (libro.estado === 'Leído') {
        progreso = 100;
    } else if (libro.estado === 'Leyendo' && libro.inicio) {
        const diasTranscurridos = libro.dias || 0;
        const promedioReal = calcularPromedioDias();
        const diasEstimados = promedioReal > 0 ? promedioReal : 30;
        progreso = Math.min((diasTranscurridos / diasEstimados) * 100, 95);
    }

    document.getElementById('modal-progress-fill').style.width = progreso + '%';
    document.getElementById('modal-progress-text').textContent = Math.round(progreso) + '%';

    document.getElementById('edit-index').value = index;
    document.getElementById('edit-inicio').value = libro.inicio || '';
    document.getElementById('edit-final').value = libro.final || '';

    // Cargar comentarios del libro
    const comentariosEl = document.getElementById('edit-comentarios');
    const savedEl = document.getElementById('comentarios-saved');
    if (comentariosEl) {
        comentariosEl.value = libro.comentarios || '';
        if (savedEl) savedEl.classList.remove('visible');
    }

    // Listener del botón guardar comentarios (reemplazar cada vez para evitar duplicados)
    const btnGuardar = document.getElementById('btn-guardar-comentarios');
    if (btnGuardar) {
        btnGuardar.onclick = async () => {
            libros[libroEditando].comentarios = comentariosEl.value || null;
            await guardarLectura(libroEditando);
            if (savedEl) {
                savedEl.classList.add('visible');
                setTimeout(() => savedEl.classList.remove('visible'), 2000);
            }
        };
    }

    const actionButtons = document.querySelectorAll('.modal-action-btn');
    actionButtons.forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            cambiarEstadoRapido(index, btn.dataset.action);
            cerrarModal();
        };
    });

    const modal = document.getElementById('edit-modal');
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function cerrarModal() {
    const modal = document.getElementById('edit-modal');
    modal.classList.remove('active');
    document.body.style.overflow = '';
    libroEditando = null;
}

function actualizarDiasModal() {
    const inicio = document.getElementById('edit-inicio').value;
    const final = document.getElementById('edit-final').value;
    const estadoSeleccionado = document.querySelector('input[name="estado"]:checked')?.value;

    const libroTemp = {
        inicio: inicio || null,
        final: final || null,
        estado: estadoSeleccionado || 'Pendiente'
    };

    calcularDias(libroTemp);

    const displayDias = document.getElementById('edit-dias');
    if (libroTemp.dias !== null) {
        displayDias.textContent = libroTemp.estado === 'Leyendo'
            ? `${libroTemp.dias} días (en proceso)`
            : `${libroTemp.dias} días`;
    } else {
        displayDias.textContent = '-';
    }
}

async function guardarEdicion(event) {
    event.preventDefault();

    if (libroEditando === null) return;

    const inicio = document.getElementById('edit-inicio').value || null;
    const final = document.getElementById('edit-final').value || null;

    if (inicio && !parseFechaEspañol(inicio)) {
        alert('Formato de fecha de inicio inválido. Usa: DD/mes/YYYY (ej: 01/enero/2026)');
        return;
    }

    if (final && !parseFechaEspañol(final)) {
        alert('Formato de fecha final inválido. Usa: DD/mes/YYYY (ej: 15/febrero/2026)');
        return;
    }

    libros[libroEditando].inicio = inicio;
    libros[libroEditando].final = final;
    calcularDias(libros[libroEditando]);

    await guardarLectura(libroEditando);
    actualizarInterfaz();
    cerrarModal();
}

// ========================================
// Cambio Rápido de Estado
// ========================================
async function cambiarEstadoRapido(index, nuevoEstado) {
    if (!libros[index]) return;

    const libro = libros[index];
    libro.estado = nuevoEstado;

    const hoy = formatearFechaEspañol(new Date());

    if (nuevoEstado === 'Leyendo' && !libro.inicio) {
        libro.inicio = hoy;
        libro.final = null;
    } else if (nuevoEstado === 'Leído') {
        if (!libro.inicio) libro.inicio = hoy;
        if (!libro.final) libro.final = hoy;
    } else if (nuevoEstado === 'Pendiente') {
        libro.inicio = null;
        libro.final = null;
    }

    calcularDias(libro);
    await guardarLectura(parseInt(index));
    actualizarInterfaz();
}

function formatearFechaEspañol(fecha) {
    const meses = [
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
    ];
    const dia = String(fecha.getDate()).padStart(2, '0');
    const mes = meses[fecha.getMonth()];
    const año = fecha.getFullYear();
    return `${dia}/${mes}/${año}`;
}

// ========================================
// Aplicar filtro (desde sidebar o desde stat-items)
// ========================================
function aplicarFiltro(filtro) {
    filtroActual = filtro;
    // Sincronizar botones del sidebar
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filtro);
    });
    renderizarLibros();
}

// ========================================
// Event Listeners
// ========================================
function inicializarEventListeners() {
    if (eventListenersInicializados) return;
    eventListenersInicializados = true;

    // Toggle vista grid / lista
    const viewBtns = document.querySelectorAll('.view-btn');
    viewBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            viewBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            vistaActual = btn.dataset.view;
            const grid = document.getElementById('books-grid');
            if (grid) {
                grid.classList.toggle('view-list', vistaActual === 'list');
            }
        });
    });

    // Click en estadísticas → filtra por estado
    const statItems = document.querySelectorAll('.stat-item');
    statItems.forEach(item => {
        item.classList.add('clickeable');
        const filtro = item.dataset.filter;
        if (!filtro) return;
        item.addEventListener('click', () => {
            // Activar el filtro correspondiente
            aplicarFiltro(filtro);
            // Highlight visual en stat-item
            statItems.forEach(s => s.classList.remove('active'));
            item.classList.add('active');
        });
    });

    // Filtros del sidebar
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Quitar highlight de stat-items al usar filtros del sidebar
            document.querySelectorAll('.stat-item').forEach(s => s.classList.remove('active'));
            filtroActual = btn.dataset.filter;
            renderizarLibros();
        });
    });

    // Búsqueda con debounce
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => renderizarLibros(), 300);
        });
    }

    // Tabs de análisis
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            const tabId = btn.dataset.tab + '-tab';
            const tabContent = document.getElementById(tabId);
            if (tabContent) tabContent.classList.add('active');
        });
    });

    // Modal
    const modalClose = document.getElementById('modal-close');
    const modalBackdrop = document.getElementById('modal-backdrop');
    const editForm = document.getElementById('edit-form');
    const toggleAdvanced = document.getElementById('toggle-advanced');

    if (modalClose) modalClose.addEventListener('click', cerrarModal);
    if (modalBackdrop) modalBackdrop.addEventListener('click', cerrarModal);

    if (editForm) {
        editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            guardarEdicion(e);
        });
    }

    if (toggleAdvanced) {
        toggleAdvanced.addEventListener('click', () => {
            const advancedForm = document.getElementById('advanced-form');
            const isVisible = advancedForm.style.display !== 'none';
            advancedForm.style.display = isVisible ? 'none' : 'block';
            toggleAdvanced.classList.toggle('active');
        });
    }

    // Cerrar modal con tecla Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('edit-modal').classList.contains('active')) {
            cerrarModal();
        }
    });
}

// ========================================
// Utilidades
// ========================================
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Exportar funciones globales
window.gaboApp = {
    get libros() { return libros; },
    cargarDatos,
    guardarDatos,
    resetearDatos,
    actualizarInterfaz,
    inicializarEventListeners
};
