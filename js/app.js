// ========================================
// Aplicación Principal - Diario de Lecturas
// ========================================

// Estado global
let temas = [];
let libros = [];
let temaActual = null;        // null = todos los temas · 'sin-tema' = huérfanos
let filtroActual = 'Todos';   // por estado de lectura
let vistaActual = 'grid';
let libroEditando = null;     // id (uuid) del libro abierto en el modal
let eventListenersInicializados = false;

const CLAVE_CACHE = 'gaboLecturas';

// ========================================
// Inicialización
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
    inicializarEventListeners();

    if (supabaseConfigurado) {
        try {
            const usuario = await inicializarAuth();

            if (usuario) {
                console.log('[App] Sesión activa al cargar, mostrando app...');
                ocultarPantallaLogin();
                actualizarUIUsuario(usuario);
                await cargarDatos();
                actualizarInterfaz();
            } else {
                console.log('[App] Sin sesión, mostrando login...');
                mostrarPantallaLogin();
            }
        } catch (error) {
            // La nube no responde (proyecto pausado, sin red): entramos con
            // la última copia local en vez de dejar al usuario en el login.
            console.error('[App] Supabase no respondió:', error.message);
            await entrarModoOffline(
                'No se pudo conectar con la nube. Estás viendo tu última copia local; los cambios se guardan en este navegador.'
            );
        }
    } else {
        await entrarModoOffline('Modo local: los cambios se guardan solo en este navegador.');
    }

    setInterval(actualizarDiasEnProceso, 60000);
});

// ========================================
// Carga y persistencia
// Prioridad: Supabase → caché local
// ========================================
async function cargarDatos() {
    if (supabaseConfigurado && usuarioActual) {
        const [temasDB, librosDB] = await Promise.all([cargarTemasDB(), cargarLibrosDB()]);

        if (temasDB !== null && librosDB !== null) {
            temas = temasDB;
            libros = librosDB;
            limpiarYValidarLibros();
            escribirCacheLocal();
            return;
        }
        console.warn('Fallo DB, usando caché local');
    }

    leerCacheLocal();
    limpiarYValidarLibros();
}

function leerCacheLocal() {
    const guardado = localStorage.getItem(CLAVE_CACHE);
    if (!guardado) {
        temas = [];
        libros = [];
        return;
    }

    try {
        const datos = JSON.parse(guardado);

        // El formato viejo era un array plano de 18 libros del catálogo
        // estático. Ya no aplica: los datos reales están en la nube.
        if (Array.isArray(datos)) {
            console.warn('[App] Caché en formato antiguo, se descarta.');
            temas = [];
            libros = [];
            return;
        }

        temas = datos.temas ?? [];
        libros = datos.libros ?? [];
    } catch (error) {
        console.error('Error al leer la caché local:', error);
        temas = [];
        libros = [];
    }
}

// Escribe siempre la copia local, esté o no disponible la nube. Es lo que
// convierte a localStorage en caché real y no en un simple fallback:
// aunque haya sesión activa, nunca te quedas sin datos.
function escribirCacheLocal() {
    try {
        localStorage.setItem(CLAVE_CACHE, JSON.stringify({ temas, libros }));
        localStorage.setItem('lastUpdated', new Date().toISOString());
        return true;
    } catch (error) {
        console.error('Error al guardar datos locales:', error);
        return false;
    }
}

function limpiarYValidarLibros() {
    libros.forEach(libro => {
        if (libro.estado === 'Pendiente') {
            libro.inicio = null;
            libro.final = null;
            libro.dias = null;
        }
        calcularDias(libro);
    });
}

// Aplica cambios a un libro, los cachea y los sube. `campos` usa nombres
// de la app (año, fechas en español); db.js traduce en el borde.
async function persistirLibro(libro, campos) {
    Object.assign(libro, campos);
    calcularDias(libro);
    escribirCacheLocal();

    if (supabaseConfigurado && usuarioActual && libro.id) {
        const ok = await actualizarLibroDB(libro.id, { ...campos, dias: libro.dias });
        if (!ok) console.warn('Fallo al guardar en la nube; queda en la caché local');
    }
}

function puedeEditarCatalogo() {
    return supabaseConfigurado && usuarioActual;
}

// ========================================
// Respaldo: exportar / importar JSON
// ========================================
function exportarDatos() {
    const respaldo = {
        version: 2,
        exportado: new Date().toISOString(),
        temas: temas.map(t => ({ nombre: t.nombre, color: t.color, orden: t.orden })),
        libros: libros.map(l => ({
            tema: temas.find(t => t.id === l.tema_id)?.nombre ?? null,
            titulo: l.titulo,
            autor: l.autor,
            año: l.año,
            paginas: l.paginas,
            resumen: l.resumen,
            estado: l.estado,
            inicio: l.inicio,
            final: l.final,
            dias: l.dias,
            comentarios: l.comentarios
        }))
    };

    const blob = new Blob([JSON.stringify(respaldo, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `mis-lecturas-${new Date().toISOString().slice(0, 10)}.json`;
    enlace.click();
    URL.revokeObjectURL(url);
}

// Restaura progreso sobre los libros que ya existen, emparejando por título.
// Crear libros nuevos es tarea del importador CSV, no de esta función.
async function importarDatos(archivo) {
    if (!archivo) return;

    let respaldo;
    try {
        respaldo = JSON.parse(await archivo.text());
    } catch (error) {
        alert('El archivo no es un JSON válido.');
        return;
    }

    const entradas = Array.isArray(respaldo) ? respaldo : respaldo.libros;
    if (!Array.isArray(entradas)) {
        alert('El archivo no tiene el formato esperado (falta la lista "libros").');
        return;
    }

    if (!confirm(`Se restaurará el progreso de ${entradas.length} lecturas sobre tus libros actuales. ¿Continuar?`)) {
        return;
    }

    const normalizar = t => String(t ?? '').trim().toLowerCase();
    let aplicados = 0;
    const sinPareja = [];

    for (const entrada of entradas) {
        const libro = libros.find(l => normalizar(l.titulo) === normalizar(entrada.titulo));
        if (!libro) {
            sinPareja.push(entrada.titulo);
            continue;
        }

        await persistirLibro(libro, {
            estado: entrada.estado ?? 'Pendiente',
            inicio: entrada.inicio ?? null,
            final: entrada.final ?? null,
            comentarios: entrada.comentarios ?? null
        });
        aplicados++;
    }

    actualizarInterfaz();

    let mensaje = `Restauradas ${aplicados} lecturas.`;
    if (sinPareja.length) {
        mensaje += `\n\nNo se encontraron estos ${sinPareja.length} libros en tu biblioteca:\n· ` +
                   sinPareja.slice(0, 10).join('\n· ');
        if (sinPareja.length > 10) mensaje += `\n… y ${sinPareja.length - 10} más.`;
    }
    alert(mensaje);
}

// ========================================
// Cálculo de días
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

    const dias = Math.floor((fechaFinal - fechaInicio) / (1000 * 60 * 60 * 24));
    libro.dias = dias >= 0 ? dias : null;
}

function actualizarDiasEnProceso() {
    let actualizado = false;

    libros.forEach(libro => {
        if (libro.estado === 'Leyendo' && libro.inicio) {
            const antes = libro.dias;
            calcularDias(libro);
            if (libro.dias !== antes) actualizado = true;
        }
    });

    if (actualizado) {
        renderizarLibros();
        actualizarEstadisticas();
    }
}

// ========================================
// Portadas (Google Books)
// ========================================
async function obtenerPortada(titulo, autor) {
    try {
        const partes = [`intitle:${titulo}`];
        if (autor) partes.push(`inauthor:${autor}`);
        const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(partes.join(' '))}&maxResults=1`;

        const respuesta = await fetch(url);
        const datos = await respuesta.json();

        const imagenes = datos.items?.[0]?.volumeInfo?.imageLinks;
        return imagenes ? (imagenes.thumbnail || imagenes.smallThumbnail || null) : null;
    } catch (error) {
        console.error(`Error al obtener portada para "${titulo}":`, error);
        return null;
    }
}

async function cargarTodasLasPortadas() {
    const pendientes = libros.filter(l => !l.portada);
    if (!pendientes.length) return;

    await Promise.all(pendientes.map(async libro => {
        const portada = await obtenerPortada(libro.titulo, libro.autor);
        if (portada) {
            libro.portada = portada;
            if (puedeEditarCatalogo() && libro.id) {
                await actualizarLibroDB(libro.id, { portada });
            }
        }
    }));

    escribirCacheLocal();
    renderizarLibros();
}

// ========================================
// Selección por tema
// ========================================
function librosDelTema() {
    if (temaActual === null) return libros;
    if (temaActual === 'sin-tema') return libros.filter(l => !l.tema_id);
    return libros.filter(l => l.tema_id === temaActual);
}

function nombreTemaActual() {
    if (temaActual === null) return 'Todas mis lecturas';
    if (temaActual === 'sin-tema') return 'Sin tema';
    return temas.find(t => t.id === temaActual)?.nombre ?? 'Tema';
}

function seleccionarTema(id) {
    temaActual = id;
    aplicarColorTema();
    renderizarTemas();
    actualizarInterfaz();
    if (window.innerWidth <= 768) cerrarSidebarMobile();
}

// Cada tema puede llevar su propio acento; se inyecta como variable CSS
// para que toda la interfaz (incluidas las gráficas) lo herede.
function aplicarColorTema() {
    const tema = temas.find(t => t.id === temaActual);
    const color = tema?.color || null;
    if (color) {
        document.documentElement.style.setProperty('--tema-acento', color);
    } else {
        document.documentElement.style.removeProperty('--tema-acento');
    }
}

// ========================================
// Renderizado
// ========================================
function actualizarInterfaz() {
    renderizarTemas();
    renderizarLibros();
    actualizarEstadisticas();
    renderizarTimeline();
    initCharts(librosDelTema(), temas, libros);
    actualizarTituloSeccion();
    cargarTodasLasPortadas();
}

function actualizarTituloSeccion() {
    const titulo = document.getElementById('section-title');
    if (titulo) {
        titulo.textContent = nombreTemaActual();
        titulo.dataset.text = nombreTemaActual();
    }
}

function renderizarTemas() {
    const lista = document.getElementById('temas-list');
    if (!lista) return;

    lista.innerHTML = '';

    const entradas = [
        { id: null, nombre: 'Todas mis lecturas', color: null, total: libros.length }
    ];

    temas.forEach(t => entradas.push({
        id: t.id,
        nombre: t.nombre,
        color: t.color,
        total: libros.filter(l => l.tema_id === t.id).length
    }));

    const huerfanos = libros.filter(l => !l.tema_id).length;
    if (huerfanos > 0) {
        entradas.push({ id: 'sin-tema', nombre: 'Sin tema', color: null, total: huerfanos });
    }

    entradas.forEach(entrada => {
        const boton = document.createElement('button');
        boton.className = 'tema-btn' + (entrada.id === temaActual ? ' active' : '');
        boton.innerHTML = `
            <span class="tema-punto" style="background:${entrada.color || 'var(--text-muted)'}"></span>
            <span class="tema-nombre">${escaparHtml(entrada.nombre)}</span>
            <span class="tema-count">${entrada.total}</span>
        `;
        boton.addEventListener('click', () => seleccionarTema(entrada.id));

        // Editar tema: solo para temas reales, no para los agregados
        if (entrada.id && entrada.id !== 'sin-tema') {
            const editar = document.createElement('span');
            editar.className = 'tema-editar';
            editar.textContent = '✎';
            editar.title = 'Editar tema';
            editar.addEventListener('click', e => {
                e.stopPropagation();
                abrirModalTema(entrada.id);
            });
            boton.appendChild(editar);
        }

        lista.appendChild(boton);
    });
}

function renderizarLibros() {
    const grid = document.getElementById('books-grid');
    if (!grid) return;

    let visibles = librosDelTema();

    if (filtroActual !== 'Todos') {
        visibles = visibles.filter(libro => libro.estado === filtroActual);
    }

    const busqueda = document.getElementById('search-input')?.value.trim().toLowerCase();
    if (busqueda) {
        visibles = visibles.filter(libro =>
            libro.titulo.toLowerCase().includes(busqueda) ||
            (libro.autor || '').toLowerCase().includes(busqueda)
        );
    }

    grid.innerHTML = '';

    if (visibles.length === 0) {
        grid.innerHTML = `<p class="grid-vacio">${
            libros.length === 0
                ? 'Todavía no hay libros. Crea un tema y añade el primero.'
                : 'No se encontraron libros con ese criterio.'
        }</p>`;
        return;
    }

    // Agrupado por subtema, conservando el orden de aparición. Si ningún
    // libro visible tiene subtema, se pinta la rejilla plana de siempre y no
    // se muestra un encabezado "Sin subtema" que no aportaría nada.
    const grupos = new Map();
    visibles.forEach(libro => {
        const clave = libro.subtema || '';
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(libro);
    });

    const haySubtemas = [...grupos.keys()].some(k => k !== '');

    if (!haySubtemas) {
        grid.classList.remove('agrupado');
        visibles.forEach(libro => grid.appendChild(crearCardLibro(libro)));
        return;
    }

    grid.classList.add('agrupado');

    for (const [subtema, delGrupo] of grupos) {
        const seccion = document.createElement('section');
        seccion.className = 'subtema-grupo';
        seccion.innerHTML = `
            <h3 class="subtema-titulo">
                <span>${escaparHtml(subtema || 'Sin subtema')}</span>
                <span class="subtema-count">${delGrupo.length}</span>
            </h3>
            <div class="subtema-grid"></div>
        `;

        const contenedor = seccion.querySelector('.subtema-grid');
        delGrupo.forEach(libro => contenedor.appendChild(crearCardLibro(libro)));
        grid.appendChild(seccion);
    }
}

function crearCardLibro(libro) {
    const card = document.createElement('div');
    card.className = 'book-card';
    card.dataset.id = libro.id;

    calcularDias(libro);

    const claseEstado = libro.estado === 'Leído' ? 'leido'
                      : libro.estado === 'Leyendo' ? 'leyendo'
                      : 'pendiente';
    card.classList.add('estado-' + claseEstado);

    let progreso = 0;
    if (libro.estado === 'Leído') {
        progreso = 100;
    } else if (libro.estado === 'Leyendo' && libro.inicio) {
        const promedio = calcularPromedioDias();
        progreso = Math.min(((libro.dias || 0) / (promedio > 0 ? promedio : 30)) * 100, 95);
    }

    card.innerHTML = `
        <div class="book-card-actions">
            <button class="quick-action-btn quick-action-pendiente" data-action="Pendiente" title="Pendiente">⊙</button>
            <button class="quick-action-btn quick-action-leyendo" data-action="Leyendo" title="Leyendo">▶</button>
            <button class="quick-action-btn quick-action-leido" data-action="Leído" title="Leído">✓</button>
        </div>
        <div class="book-cover-wrapper">
            ${libro.portada
                ? `<img src="${libro.portada}" alt="${escaparHtml(libro.titulo)}" class="book-cover">`
                : '<div class="book-cover-placeholder">📚</div>'}
        </div>
        <div class="book-info">
            <h3 class="book-title">${escaparHtml(libro.titulo)}</h3>
            <p class="book-meta">
                <span class="book-status status-${claseEstado}">${libro.estado}</span>
                ${libro.tipo && libro.tipo !== 'Libro' ? `<span class="book-tipo">${escaparHtml(libro.tipo)}</span>` : ''}
                ${libro.año ? `<span class="book-year">${libro.año}</span>` : ''}
                ${libro.paginas ? `<span class="book-pages">${libro.paginas} pág</span>` : ''}
            </p>
            <div class="book-progress" role="progressbar"
                 aria-valuenow="${Math.round(progreso)}" aria-valuemin="0" aria-valuemax="100"
                 aria-label="Progreso de ${escaparHtml(libro.titulo)}">
                <div class="book-progress-bar" style="width: ${progreso}%"></div>
            </div>
        </div>
    `;

    card.addEventListener('click', e => {
        if (e.target.closest('.quick-action-btn')) return;
        abrirModalEdicion(libro.id);
    });

    card.querySelectorAll('.quick-action-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            cambiarEstadoRapido(libro.id, btn.dataset.action);
        });
    });

    return card;
}

function actualizarEstadisticas() {
    const ambito = librosDelTema();

    const leidos = ambito.filter(l => l.estado === 'Leído');
    const paginas = leidos.reduce((total, l) => total + (l.paginas || 0), 0);

    const asignar = (id, valor) => {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    };

    asignar('total-leidos', leidos.length);
    asignar('total-leyendo', ambito.filter(l => l.estado === 'Leyendo').length);
    asignar('total-pendientes', ambito.filter(l => l.estado === 'Pendiente').length);
    asignar('total-paginas', paginas.toLocaleString());
    asignar('promedio-dias', calcularPromedioDias());
}

function calcularPromedioDias() {
    const conDias = librosDelTema().filter(l => l.estado === 'Leído' && l.dias !== null);
    if (!conDias.length) return 0;
    return Math.round(conDias.reduce((suma, l) => suma + l.dias, 0) / conDias.length);
}

// Cronología de LECTURA, no de publicación: es lo que convierte la app en
// un diario. Los pendientes sin fecha no aparecen porque no son un hito.
function claseEstado(estado) {
    return estado === 'Leído' ? 'leido'
         : estado === 'Leyendo' ? 'leyendo'
         : 'pendiente';
}

function renderizarTimeline() {
    const timeline = document.getElementById('timeline');
    if (!timeline) return;

    const delTema = librosDelTema();

    const conFecha = delTema
        .filter(l => l.inicio || l.final)
        .map(l => ({ libro: l, fecha: parseFechaEspañol(l.final || l.inicio) }))
        .filter(x => x.fecha)
        .sort((a, b) => b.fecha - a.fecha);

    // Lo empezado o terminado SIN fecha. Filtrarlo hacía que el timeline
    // mintiera por omisión: hoy la mayoría de las lecturas terminadas no
    // tienen fecha (se cargaron desde la hoja de cálculo sin ella), así que
    // el diario mostraba dos entradas y escondía el resto.
    const sinFecha = delTema
        .filter(l => l.estado !== 'Pendiente' && !l.inicio && !l.final)
        .sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));

    if (!conFecha.length && !sinFecha.length) {
        // Sin la línea: una raya vertical al lado de un aviso, sin un solo
        // hito que sostener, no significa nada.
        timeline.innerHTML = '<p class="grid-vacio">Aún no has empezado ninguna lectura.</p>';
        return;
    }

    timeline.innerHTML = conFecha.length ? '<div class="timeline-line"></div>' : '';

    const crearItem = (libro, etiquetaFecha) => {
        const clase = claseEstado(libro.estado);

        const item = document.createElement('div');
        item.className = `timeline-item ${clase}`;
        item.innerHTML = `
            <div class="timeline-dot ${clase}"></div>
            <div class="timeline-year">${etiquetaFecha}</div>
            <div class="timeline-title">${escaparHtml(libro.titulo)}</div>
            <span class="timeline-status ${clase}">${libro.estado}</span>
        `;
        item.addEventListener('click', () => abrirModalEdicion(libro.id));
        return item;
    };

    conFecha.forEach(({ libro, fecha }) => {
        timeline.appendChild(crearItem(libro, formatearFechaEspañol(fecha)));
    });

    if (!sinFecha.length) return;

    // Bloque aparte, no mezclado: son lecturas reales, pero no son hitos —
    // no se pueden ordenar en el tiempo y no deben fingir que sí.
    const separador = document.createElement('p');
    separador.className = 'timeline-separador';
    separador.textContent = `Sin fecha registrada (${sinFecha.length})`;
    timeline.appendChild(separador);

    const grupo = document.createElement('div');
    grupo.className = 'timeline-sin-fecha';
    sinFecha.forEach(libro => grupo.appendChild(crearItem(libro, '—')));
    timeline.appendChild(grupo);
}

function escaparHtml(texto) {
    const div = document.createElement('div');
    div.textContent = texto ?? '';
    return div.innerHTML;
}

// ========================================
// Modal de lectura
// ========================================
function buscarLibro(id) {
    return libros.find(l => l.id === id) || null;
}

function abrirModalEdicion(id) {
    const libro = buscarLibro(id);
    if (!libro) return;

    libroEditando = id;

    // Se asigna siempre, también el 'none': si no, la portada del libro
    // anterior se queda pegada al abrir uno que no tiene. El fondo del hueco
    // lo pone el CSS, no un degradado a mano.
    const portada = document.getElementById('modal-hero-image');
    if (portada) {
        portada.style.backgroundImage = libro.portada ? `url(${libro.portada})` : 'none';
    }

    const poner = (id, valor) => {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    };

    poner('modal-year', [libro.año, libro.tipo].filter(Boolean).join(' · '));
    poner('modal-title', libro.titulo);
    poner('modal-autor', libro.autor || '');
    poner('modal-pages', libro.paginas ? `${libro.paginas} páginas` : '');
    poner('modal-description', libro.resumen || 'Sin descripción disponible.');

    // El enlace es lo más valioso del material de estudio: sin él, una fila
    // como "Documentación MDN: Closures" no sirve de nada.
    const enlace = document.getElementById('modal-enlace');
    if (enlace) {
        if (libro.enlace) {
            enlace.href = libro.enlace;
            enlace.style.display = '';
        } else {
            enlace.style.display = 'none';
        }
    }
    poner('modal-fecha-inicio', libro.inicio || '--');
    poner('modal-fecha-final', libro.final || '--');
    poner('modal-dias', libro.dias !== null ? `${libro.dias} días` : '--');

    const badge = document.getElementById('modal-estado-badge');
    badge.textContent = libro.estado;
    badge.className = libro.estado === 'Leído' ? 'status-leido'
                    : libro.estado === 'Leyendo' ? 'status-leyendo'
                    : 'status-pendiente';

    let progreso = 0;
    if (libro.estado === 'Leído') {
        progreso = 100;
    } else if (libro.estado === 'Leyendo' && libro.inicio) {
        const promedio = calcularPromedioDias();
        progreso = Math.min(((libro.dias || 0) / (promedio > 0 ? promedio : 30)) * 100, 95);
    }
    document.getElementById('modal-progress-fill').style.width = progreso + '%';
    document.getElementById('modal-progress-text').textContent = Math.round(progreso) + '%';

    document.getElementById('edit-inicio').value = libro.inicio || '';
    document.getElementById('edit-final').value = libro.final || '';

    const comentarios = document.getElementById('edit-comentarios');
    const avisoGuardado = document.getElementById('comentarios-saved');
    if (comentarios) {
        comentarios.value = libro.comentarios || '';
        avisoGuardado?.classList.remove('visible');
    }

    const btnComentarios = document.getElementById('btn-guardar-comentarios');
    if (btnComentarios) {
        btnComentarios.onclick = async () => {
            await persistirLibro(libro, { comentarios: comentarios.value || null });
            if (avisoGuardado) {
                avisoGuardado.classList.add('visible');
                setTimeout(() => avisoGuardado.classList.remove('visible'), 2000);
            }
        };
    }

    document.querySelectorAll('.modal-action-btn').forEach(btn => {
        btn.onclick = e => {
            e.preventDefault();
            cambiarEstadoRapido(id, btn.dataset.action);
            cerrarModal();
        };
    });

    const btnEditarLibro = document.getElementById('btn-editar-libro');
    if (btnEditarLibro) {
        btnEditarLibro.style.display = puedeEditarCatalogo() ? '' : 'none';
        btnEditarLibro.onclick = () => {
            cerrarModal();
            abrirModalLibro(id);
        };
    }

    document.getElementById('edit-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function cerrarModal() {
    document.getElementById('edit-modal').classList.remove('active');
    document.body.style.overflow = '';
    libroEditando = null;
}

function actualizarDiasModal() {
    const temporal = {
        inicio: document.getElementById('edit-inicio').value || null,
        final: document.getElementById('edit-final').value || null,
        estado: buscarLibro(libroEditando)?.estado || 'Pendiente'
    };
    calcularDias(temporal);

    const display = document.getElementById('edit-dias');
    if (!display) return;
    display.textContent = temporal.dias !== null
        ? (temporal.estado === 'Leyendo' ? `${temporal.dias} días (en proceso)` : `${temporal.dias} días`)
        : '-';
}

async function guardarEdicion(event) {
    event.preventDefault();

    const libro = buscarLibro(libroEditando);
    if (!libro) return;

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

    await persistirLibro(libro, { inicio, final });
    actualizarInterfaz();
    cerrarModal();
}

// ========================================
// Cambio rápido de estado
// ========================================
async function cambiarEstadoRapido(id, nuevoEstado) {
    const libro = buscarLibro(id);
    if (!libro) return;

    const hoy = formatearFechaEspañol(new Date());
    const campos = { estado: nuevoEstado };

    if (nuevoEstado === 'Leyendo') {
        campos.inicio = libro.inicio || hoy;
        campos.final = null;
    } else if (nuevoEstado === 'Leído') {
        campos.inicio = libro.inicio || hoy;
        campos.final = libro.final || hoy;
    } else {
        campos.inicio = null;
        campos.final = null;
    }

    await persistirLibro(libro, campos);
    actualizarInterfaz();
}

// ========================================
// CRUD de temas
// ========================================
function abrirModalTema(id = null) {
    if (!puedeEditarCatalogo()) {
        alert('Necesitas iniciar sesión para editar temas.');
        return;
    }

    const tema = id ? temas.find(t => t.id === id) : null;

    document.getElementById('tema-modal-titulo').textContent = tema ? 'Editar tema' : 'Nuevo tema';
    document.getElementById('tema-nombre').value = tema?.nombre || '';
    // Por defecto, el mismo acento que --tema-acento en :root (ámbar). El
    // verde neón que había aquí era de la paleta anterior.
    document.getElementById('tema-color').value = tema?.color || '#B57C00';
    document.getElementById('tema-id').value = id || '';

    const btnBorrar = document.getElementById('btn-borrar-tema');
    btnBorrar.style.display = tema ? '' : 'none';

    document.getElementById('tema-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function cerrarModalTema() {
    document.getElementById('tema-modal').classList.remove('active');
    document.body.style.overflow = '';
}

async function guardarTema(event) {
    event.preventDefault();

    const id = document.getElementById('tema-id').value || null;
    const nombre = document.getElementById('tema-nombre').value.trim();
    const color = document.getElementById('tema-color').value;

    if (!nombre) {
        alert('El tema necesita un nombre.');
        return;
    }

    if (id) {
        const ok = await actualizarTemaDB(id, { nombre, color });
        if (!ok) {
            alert('No se pudo guardar el tema. ¿Ya existe otro con ese nombre?');
            return;
        }
        const tema = temas.find(t => t.id === id);
        if (tema) Object.assign(tema, { nombre, color });
    } else {
        const creado = await crearTemaDB(nombre, color, temas.length);
        if (!creado) {
            alert('No se pudo crear el tema. ¿Ya existe otro con ese nombre?');
            return;
        }
        temas.push(creado);
        temaActual = creado.id;
    }

    escribirCacheLocal();
    cerrarModalTema();
    aplicarColorTema();
    actualizarInterfaz();
}

async function borrarTema() {
    const id = document.getElementById('tema-id').value;
    if (!id) return;

    const afectados = libros.filter(l => l.tema_id === id).length;
    const aviso = afectados
        ? `Se borrará el tema. Sus ${afectados} libros NO se borran: quedarán en "Sin tema" para que los reasignes.`
        : 'Se borrará el tema.';

    if (!confirm(aviso + '\n\n¿Continuar?')) return;

    const ok = await borrarTemaDB(id);
    if (!ok) {
        alert('No se pudo borrar el tema.');
        return;
    }

    temas = temas.filter(t => t.id !== id);
    libros.forEach(l => { if (l.tema_id === id) l.tema_id = null; });
    if (temaActual === id) temaActual = null;

    escribirCacheLocal();
    cerrarModalTema();
    aplicarColorTema();
    actualizarInterfaz();
}

// ========================================
// CRUD de libros
// ========================================
function abrirModalLibro(id = null) {
    if (!puedeEditarCatalogo()) {
        alert('Necesitas iniciar sesión para añadir o editar libros.');
        return;
    }

    const libro = id ? buscarLibro(id) : null;

    document.getElementById('libro-modal-titulo').textContent = libro ? 'Editar libro' : 'Nuevo libro';
    document.getElementById('libro-id').value = id || '';
    document.getElementById('libro-titulo').value = libro?.titulo || '';
    document.getElementById('libro-autor').value = libro?.autor || '';
    document.getElementById('libro-anio').value = libro?.año || '';
    document.getElementById('libro-paginas').value = libro?.paginas || '';
    document.getElementById('libro-resumen').value = libro?.resumen || '';
    document.getElementById('libro-tipo').value = libro?.tipo || '';
    document.getElementById('libro-enlace').value = libro?.enlace || '';

    // Al crear, hereda el subtema del grupo en el que estás mirando
    document.getElementById('libro-subtema').value = libro?.subtema || '';

    // Sugerencias con los subtemas que ya existen, para no inventar variantes
    // ("Básico" y "basico" serían dos grupos distintos)
    const sugerencias = document.getElementById('subtemas-existentes');
    if (sugerencias) {
        const usados = [...new Set(libros.map(l => l.subtema).filter(Boolean))].sort();
        sugerencias.innerHTML = usados.map(s => `<option value="${escaparHtml(s)}"></option>`).join('');
    }

    const selector = document.getElementById('libro-tema');
    selector.innerHTML = '<option value="">Sin tema</option>';
    temas.forEach(t => {
        const opcion = document.createElement('option');
        opcion.value = t.id;
        opcion.textContent = t.nombre;
        selector.appendChild(opcion);
    });
    selector.value = libro?.tema_id
        || (temaActual && temaActual !== 'sin-tema' ? temaActual : '');

    document.getElementById('btn-borrar-libro').style.display = libro ? '' : 'none';

    document.getElementById('libro-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
}

function cerrarModalLibro() {
    document.getElementById('libro-modal').classList.remove('active');
    document.body.style.overflow = '';
}

async function guardarLibro(event) {
    event.preventDefault();

    const id = document.getElementById('libro-id').value || null;
    const titulo = document.getElementById('libro-titulo').value.trim();

    if (!titulo) {
        alert('El libro necesita un título.');
        return;
    }

    const anio = parseInt(document.getElementById('libro-anio').value, 10);
    const paginas = parseInt(document.getElementById('libro-paginas').value, 10);

    const campos = {
        titulo,
        autor: document.getElementById('libro-autor').value.trim() || null,
        año: Number.isNaN(anio) ? null : anio,
        paginas: Number.isNaN(paginas) ? null : paginas,
        resumen: document.getElementById('libro-resumen').value.trim() || null,
        tipo: document.getElementById('libro-tipo').value.trim() || null,
        enlace: document.getElementById('libro-enlace').value.trim() || null,
        tema_id: document.getElementById('libro-tema').value || null,
        subtema: document.getElementById('libro-subtema').value.trim() || null
    };

    if (id) {
        const libro = buscarLibro(id);
        if (!libro) return;
        const ok = await actualizarLibroDB(id, campos);
        if (!ok) {
            alert('No se pudo guardar el libro.');
            return;
        }
        Object.assign(libro, campos);
    } else {
        const creado = await crearLibroDB({ ...campos, estado: 'Pendiente', orden: libros.length });
        if (!creado) {
            alert('No se pudo crear el libro.');
            return;
        }
        libros.push(creado);
    }

    escribirCacheLocal();
    cerrarModalLibro();
    actualizarInterfaz();
}

async function borrarLibro() {
    const id = document.getElementById('libro-id').value;
    if (!id) return;

    const libro = buscarLibro(id);
    if (!libro) return;

    if (!confirm(`Se borrará "${libro.titulo}" y su progreso de lectura. Esto no se puede deshacer.\n\n¿Continuar?`)) {
        return;
    }

    const ok = await borrarLibroDB(id);
    if (!ok) {
        alert('No se pudo borrar el libro.');
        return;
    }

    libros = libros.filter(l => l.id !== id);
    escribirCacheLocal();
    cerrarModalLibro();
    actualizarInterfaz();
}

// ========================================
// Filtros por estado
// ========================================
function aplicarFiltro(filtro) {
    filtroActual = filtro;
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filtro);
    });
    renderizarLibros();
}

// ========================================
// Sidebar mobile
// ========================================
function abrirSidebarMobile() {
    document.querySelector('.sidebar')?.classList.add('sidebar-open');
    document.getElementById('sidebar-overlay')?.classList.add('active');
    document.body.style.overflow = 'hidden';
}

function cerrarSidebarMobile() {
    document.querySelector('.sidebar')?.classList.remove('sidebar-open');
    document.getElementById('sidebar-overlay')?.classList.remove('active');
    document.body.style.overflow = '';
}

// ========================================
// Event listeners
// ========================================
function inicializarEventListeners() {
    if (eventListenersInicializados) return;
    eventListenersInicializados = true;

    // Vista grid / lista
    const viewBtns = document.querySelectorAll('.view-btn');
    viewBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            viewBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            vistaActual = btn.dataset.view;
            document.getElementById('books-grid')?.classList.toggle('view-list', vistaActual === 'list');
        });
    });

    // Estadísticas clicables → filtran por estado
    const statItems = document.querySelectorAll('.stat-item');
    statItems.forEach(item => {
        const filtro = item.dataset.filter;
        if (!filtro) return;
        item.classList.add('clickeable');
        item.addEventListener('click', () => {
            aplicarFiltro(filtro);
            statItems.forEach(s => s.classList.remove('active'));
            item.classList.add('active');
        });
    });

    // Sidebar mobile
    document.getElementById('mobile-menu-btn')?.addEventListener('click', abrirSidebarMobile);
    document.getElementById('sidebar-overlay')?.addEventListener('click', cerrarSidebarMobile);

    // Filtros por estado
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.stat-item').forEach(s => s.classList.remove('active'));
            aplicarFiltro(btn.dataset.filter);
            if (window.innerWidth <= 768) cerrarSidebarMobile();
        });
    });

    // Búsqueda con debounce
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        let temporizador;
        searchInput.addEventListener('input', () => {
            clearTimeout(temporizador);
            temporizador = setTimeout(renderizarLibros, 300);
        });
    }

    // Panel de análisis: plegado por defecto para que no le quite pantalla
    // a la rejilla, que es lo que se mira a diario.
    const analysisSection = document.getElementById('analysis-section');
    const analysisToggle = document.getElementById('analysis-toggle');

    if (analysisSection && analysisToggle) {
        analysisToggle.addEventListener('click', () => {
            const abierto = analysisSection.classList.toggle('open');
            analysisToggle.setAttribute('aria-expanded', String(abierto));
            // Chart.js mide el contenedor al construir la gráfica, y oculto
            // mide 0: hay que rehacerla al abrir.
            if (abierto) initCharts(librosDelTema(), temas, libros);
        });
    }

    // Tabs de análisis
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab + '-tab')?.classList.add('active');
            // Mismo motivo que arriba: la pestaña oculta medía 0.
            if (btn.dataset.tab === 'charts') initCharts(librosDelTema(), temas, libros);
        });
    });

    // Modal de lectura
    document.getElementById('modal-close')?.addEventListener('click', cerrarModal);
    document.getElementById('modal-backdrop')?.addEventListener('click', cerrarModal);
    document.getElementById('edit-form')?.addEventListener('submit', guardarEdicion);

    document.getElementById('toggle-advanced')?.addEventListener('click', () => {
        const form = document.getElementById('advanced-form');
        const visible = form.style.display !== 'none';
        form.style.display = visible ? 'none' : 'block';
        document.getElementById('toggle-advanced').classList.toggle('active');
    });

    // CRUD de temas
    document.getElementById('btn-nuevo-tema')?.addEventListener('click', () => abrirModalTema(null));
    document.getElementById('tema-modal-close')?.addEventListener('click', cerrarModalTema);
    document.getElementById('tema-modal-backdrop')?.addEventListener('click', cerrarModalTema);
    document.getElementById('tema-form')?.addEventListener('submit', guardarTema);
    document.getElementById('btn-borrar-tema')?.addEventListener('click', borrarTema);

    // CRUD de libros
    document.getElementById('btn-nuevo-libro')?.addEventListener('click', () => abrirModalLibro(null));
    document.getElementById('libro-modal-close')?.addEventListener('click', cerrarModalLibro);
    document.getElementById('libro-modal-backdrop')?.addEventListener('click', cerrarModalLibro);
    document.getElementById('libro-form')?.addEventListener('submit', guardarLibro);
    document.getElementById('btn-borrar-libro')?.addEventListener('click', borrarLibro);

    // Respaldo
    document.getElementById('btn-exportar')?.addEventListener('click', exportarDatos);
    const btnImportar = document.getElementById('btn-importar');
    const inputImportar = document.getElementById('input-importar');
    if (btnImportar && inputImportar) {
        btnImportar.addEventListener('click', () => inputImportar.click());
        inputImportar.addEventListener('change', async e => {
            await importarDatos(e.target.files[0]);
            e.target.value = '';
        });
    }

    document.getElementById('btn-reintentar')?.addEventListener('click', () => location.reload());

    // Escape cierra lo que esté abierto
    document.addEventListener('keydown', e => {
        if (e.key !== 'Escape') return;
        if (document.getElementById('libro-modal')?.classList.contains('active')) return cerrarModalLibro();
        if (document.getElementById('tema-modal')?.classList.contains('active')) return cerrarModalTema();
        if (document.getElementById('edit-modal')?.classList.contains('active')) return cerrarModal();
        if (document.querySelector('.sidebar')?.classList.contains('sidebar-open')) return cerrarSidebarMobile();
    });
}

// ========================================
// API global (la usa auth.js)
// ========================================
window.gaboApp = {
    get libros() { return libros; },
    get temas() { return temas; },
    cargarDatos,
    exportarDatos,
    importarDatos,
    actualizarInterfaz,
    inicializarEventListeners
};
