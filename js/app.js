// ========================================
// Aplicación Principal - Diario de Lecturas
// ========================================

// Estado global
let temas = [];
let libros = [];
let filtroActual = 'Todos';   // por estado de lectura
let libroEditando = null;     // id (uuid) del libro abierto en el modal
let eventListenersInicializados = false;

const CLAVE_CACHE = 'gaboLecturas';

// ========================================
// Inicialización
// ========================================
document.addEventListener('DOMContentLoaded', async () => {
    inicializarEventListeners();

    // El login ya viene visible desde el HTML, así que el fondo se monta
    // aquí y no solo desde mostrarPantallaLogin(): mientras se espera a
    // getSession() —hasta 8 segundos— esa función todavía no ha corrido y
    // la pantalla se quedaría sin fondo justo durante la espera.
    if (document.getElementById('login-screen')?.classList.contains('active')) {
        montarFondoLogin();
    }

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
    }
}

// ========================================
// Portadas (Google Books)
// ========================================
// La API se llama SIN clave, y para un proyecto anónimo Google da cuota
// cero: responde 429 a todo. El código anterior no se enteraba, porque un
// 429 no lanza — fetch resuelve, .json() parsea el objeto de error y
// `datos.items` sale undefined, así que devolvía null como si el libro no
// existiera. Resultado: ninguna portada, ni un aviso, y 112 peticiones en
// paralelo repetidas en cada refresco de la interfaz.
//
// Ahora falla en voz alta y se calla para el resto de la sesión.
let portadasDesactivadas = false;

function desactivarPortadas(motivo) {
    if (portadasDesactivadas) return;
    portadasDesactivadas = true;
    console.warn(`[Portadas] ${motivo} No se piden más portadas en esta sesión.`);
}

async function obtenerPortada(titulo, autor) {
    if (portadasDesactivadas) return null;

    try {
        const partes = [`intitle:${titulo}`];
        if (autor) partes.push(`inauthor:${autor}`);
        const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(partes.join(' '))}&maxResults=1`;

        const respuesta = await fetch(url);

        if (!respuesta.ok) {
            desactivarPortadas(
                respuesta.status === 429
                    ? 'Google Books devolvió 429: la API sin clave tiene cuota cero. Hace falta una API key propia para que funcionen.'
                    : `Google Books devolvió ${respuesta.status}.`
            );
            return null;
        }

        const datos = await respuesta.json();
        const imagenes = datos.items?.[0]?.volumeInfo?.imageLinks;
        return imagenes ? (imagenes.thumbnail || imagenes.smallThumbnail || null) : null;
    } catch (error) {
        // Un fallo de red tumba la tanda entera: no tiene sentido insistir
        // libro por libro.
        desactivarPortadas(`No se pudo contactar con Google Books (${error.message}).`);
        return null;
    }
}

// De cinco en cinco, no las 112 de golpe: así un rechazo corta la tanda en
// la primera hornada en vez de disparar cien peticiones condenadas.
const PORTADAS_POR_TANDA = 5;

async function cargarTodasLasPortadas() {
    if (portadasDesactivadas) return;

    const pendientes = libros.filter(l => !l.portada);
    if (!pendientes.length) return;

    let encontradas = 0;

    for (let i = 0; i < pendientes.length; i += PORTADAS_POR_TANDA) {
        if (portadasDesactivadas) break;

        const tanda = pendientes.slice(i, i + PORTADAS_POR_TANDA);
        await Promise.all(tanda.map(async libro => {
            const portada = await obtenerPortada(libro.titulo, libro.autor);
            if (portada) {
                libro.portada = portada;
                encontradas++;
                if (puedeEditarCatalogo() && libro.id) {
                    await actualizarLibroDB(libro.id, { portada });
                }
            }
        }));
    }

    if (!encontradas) return;

    escribirCacheLocal();
    renderizarLibros();
}

// ========================================
// Renderizado
// ========================================
// Ya no hay vistas que elegir ni tema seleccionado: la interfaz es el mueble.
// Los temas se eligen abriendo su balda, no en una lista aparte, así que
// `temaActual`, `librosDelTema()` y `aplicarColorTema()` desaparecieron en el
// recorte del 2026-09-26 — eran estado que ya no gobernaba nada.

function actualizarInterfaz() {
    actualizarAccionesCatalogo();
    renderizarLibros();
    // La ficha se repinta con los datos nuevos: si acabas de marcar un libro
    // como leído, el estado y el progreso de la columna tienen que moverse.
    if (libroEnFicha) {
        const libro = buscarLibro(libroEnFicha);
        libro ? renderizarFicha(libro) : cerrarFicha();
    }
    cargarTodasLasPortadas();
}

function renderizarLibros() {
    const raiz = document.getElementById('estante-raiz');
    if (!raiz) return;

    // El muro 3D vive dentro de este mismo contenedor. Hay que desmontarlo
    // ANTES de vaciarlo: si no, el canvas se queda huérfano con su contexto
    // WebGL vivo y cada re-render deja uno más colgando.
    desmontarMuro();
    if (pistaEl) pistaEl.hidden = true;

    let visibles = libros;

    // La colección elegida en el nav filtra antes que nada.
    if (temaActual === 'sin-tema') {
        visibles = visibles.filter(libro => !libro.tema_id);
    } else if (temaActual) {
        visibles = visibles.filter(libro => libro.tema_id === temaActual);
    }

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

    raiz.innerHTML = '';
    actualizarRecuentos();
    renderizarColecciones();
    actualizarTituloSeccion(visibles);

    if (visibles.length === 0) {
        raiz.innerHTML = `<p class="estante-vacio">${
            libros.length === 0
                ? 'Todavía no hay lecturas. Abre el menú y crea un tema.'
                : 'Ninguna lectura coincide con ese criterio.'
        }</p>`;
        return;
    }

    renderizarEstante(raiz, visibles);
}

// ========================================
// Fondo del login
// ========================================
// El mueble detrás de la tarjeta de entrada: lo primero que se ve es el
// producto y no una tarjeta sobre negro.
//
// Reutiliza montarMuro() tal cual, sin callbacks. Eso no es un atajo: el
// fondo ES el mismo `muro` del módulo, así que el desmontaje ya está resuelto
// —renderizarLibros() empieza llamando a desmontarMuro()— y nunca puede haber
// dos contextos WebGL vivos. Esa regla está explicada en CLAUDE.md.
//
// Es decoración: no se pulsa (pointer-events: none en el CSS), no lleva
// espejo accesible y no toca `libros` ni `temas`.

// Baldas de adorno para cuando no hay caché, es decir, cuando nadie ha
// entrado todavía en este navegador.
const TEMAS_ADORNO = [
    { nombre: 'Novela', color: '#c98500' },
    { nombre: 'Ensayo', color: '#3987e5' },
    { nombre: 'Historia', color: '#199e70' },
    { nombre: 'Poesía', color: '#9085e9' }
];

function baldasDeAdorno() {
    // Si hay caché local, el fondo es TU estante: quien vuelve ve sus libros.
    const cache = leerCacheLocal();
    if (cache?.temas?.length && cache?.libros?.length) {
        const reales = cache.temas
            .map(t => ({
                id: t.id,
                nombre: t.nombre,
                color: t.color || token('--laton', '#BF8550'),
                libros: cache.libros.filter(l => l.tema_id === t.id)
            }))
            .filter(b => b.libros.length);
        if (reales.length) return reales;
    }

    // Inventadas, pero deterministas como todo lo que alimenta al mueble.
    return TEMAS_ADORNO.map((tema, i) => {
        const cuantos = 7 + Math.floor(hashEstante('adorno' + i) * 12);
        const libros = [];
        for (let n = 0; n < cuantos; n++) {
            const id = 'adorno-' + i + '-' + n;
            const suerte = hashEstante(id + '|estado');
            libros.push({
                id: id,
                titulo: '',
                tema_id: 'adorno-' + i,
                // Reparto parecido al de una biblioteca de verdad: más
                // pendientes que leídos.
                estado: suerte < 0.22 ? 'Leído' : suerte < 0.38 ? 'Leyendo' : 'Pendiente',
                paginas: null
            });
        }
        return { id: 'adorno-' + i, nombre: tema.nombre, color: tema.color, libros };
    });
}

function montarFondoLogin() {
    const contenedor = document.getElementById('login-fondo');
    if (!contenedor || !estanteDisponible) return;
    if (contenedor.querySelector('canvas')) return;   // ya montado

    montarMuro(contenedor, baldasDeAdorno(), null, null, null);
}

// ========================================
// Chrome: barra, colecciones y ficha
// ========================================
// Todo esto viene del diseño de Figma. Los filtros y la búsqueda vuelven a la
// barra superior —estuvieron un tiempo dentro del menú «···»— y el menú se
// queda con lo que no cabe arriba: altas, respaldo y sesión.

// Tema por el que se filtra. null = todos. Vuelve a existir tras el recorte
// que lo eliminó, pero ahora es SOLO un filtro del muro: no cambia el acento
// global ni nada más.
let temaActual = null;

function renderizarColecciones() {
    const lista = document.getElementById('category-list');
    if (!lista) return;

    const hayHuerfanos = libros.some(l => !l.tema_id);
    const entradas = [{ id: null, nombre: 'Todos' }]
        .concat(temas.map(t => ({ id: t.id, nombre: t.nombre })));
    if (hayHuerfanos) entradas.push({ id: 'sin-tema', nombre: 'Sin tema' });

    lista.innerHTML = entradas.map(e =>
        '<button type="button" data-tema="' + escaparHtml(e.id ?? '') + '"' +
        (e.id === temaActual ? ' class="active"' : '') + '>' +
        escaparHtml(e.nombre) + '</button>'
    ).join('');
}

function seleccionarColeccion(valor) {
    temaActual = valor === '' ? null : valor;
    renderizarColecciones();
    renderizarLibros();
}

// Recuentos de la barra. Son sobre TODA la biblioteca, no sobre lo filtrado:
// son el mapa de dónde estás, y encogerlos al filtrar los volvería inútiles.
function actualizarRecuentos() {
    const poner = (id, valor) => {
        const el = document.getElementById(id);
        if (el) el.textContent = valor;
    };
    poner('total-leidos', libros.filter(l => l.estado === 'Leído').length);
    poner('total-leyendo', libros.filter(l => l.estado === 'Leyendo').length);
    poner('total-pendientes', libros.filter(l => l.estado === 'Pendiente').length);
}

// El encabezado de la sala se retiró: repetía la marca y la colección
// activa, que ya se ve resaltada en el nav. Queda el recuento, que sí dice
// algo que no está en ningún otro sitio.
function actualizarTituloSeccion(visibles) {
    const cuenta = document.getElementById('cuenta-visibles');
    if (cuenta) {
        cuenta.textContent = visibles.length === 1
            ? '1 volumen visible'
            : visibles.length + ' volúmenes visibles';
    }
}

// ----------------------------------------
// Ficha lateral
// ----------------------------------------
// Resume el libro seleccionado. Para editar —fechas, comentarios, estado— el
// botón «Ver notas y detalles» abre el modal de siempre, que sigue siendo el
// único sitio donde se escribe. Así la ficha no duplica el formulario.

let libroEnFicha = null;

function seleccionarLibro(id) {
    const libro = buscarLibro(id);
    if (!libro) return;
    libroEnFicha = id;
    renderizarFicha(libro);
}

function cerrarFicha() {
    libroEnFicha = null;
    const cuerpo = document.getElementById('detail-cuerpo');
    const vacio = document.getElementById('detail-vacio');
    if (cuerpo) cuerpo.hidden = true;
    if (vacio) vacio.hidden = false;
}

function renderizarFicha(libro) {
    const ficha = document.getElementById('book-detail');
    if (!ficha) return;

    const poner = (id, valor) => {
        const el = document.getElementById(id);
        if (el) el.textContent = valor ?? '';
    };

    const tema = temas.find(t => t.id === libro.tema_id);
    const acento = tema?.color || token('--laton', '#BF8550');

    // El acento de la tapa es el del tema: la ficha se tiñe del color de la
    // balda de la que sale el libro.
    ficha.style.setProperty('--tema-acento', acento);

    poner('detail-tema', tema?.nombre || 'Sin tema');
    poner('detail-titulo-tapa', libro.titulo);
    poner('detail-autor-tapa', libro.autor || '');
    poner('detail-titulo', libro.titulo);
    poner('detail-autor', [libro.autor, libro.año].filter(Boolean).join(' · '));

    const insignia = document.getElementById('detail-estado');
    if (insignia) {
        insignia.textContent = libro.estado;
        insignia.className = 'state-badge ' + claseEstado(libro.estado);
    }

    // El progreso de un libro leído es 100; el de uno en curso se estima con
    // los días transcurridos contra el promedio, igual que en el modal.
    calcularDias(libro);
    let progreso = 0;
    if (libro.estado === 'Leído') {
        progreso = 100;
    } else if (libro.estado === 'Leyendo' && libro.inicio) {
        const promedio = calcularPromedioDias();
        progreso = Math.min(((libro.dias || 0) / (promedio > 0 ? promedio : 30)) * 100, 95);
    }
    poner('detail-progreso', Math.round(progreso) + '%');
    const barra = document.getElementById('detail-progreso-barra');
    if (barra) barra.style.width = progreso + '%';

    // La cita del diseño era de relleno. Aquí va tu propio comentario, si lo
    // hay, y si no la sección desaparece en vez de inventarse una frase.
    const nota = document.getElementById('detail-nota');
    if (nota) {
        const texto = (libro.comentarios || '').trim();
        nota.textContent = texto ? '“' + texto + '”' : '';
        nota.hidden = !texto;
    }

    const cuerpo = document.getElementById('detail-cuerpo');
    const vacio = document.getElementById('detail-vacio');
    if (cuerpo) cuerpo.hidden = false;
    if (vacio) vacio.hidden = true;
    ficha.scrollTop = 0;
}

// ----------------------------------------
// Buscador desplegable
// ----------------------------------------

function alternarBuscador(abrir) {
    const caja = document.getElementById('search-box');
    const boton = document.getElementById('btn-buscar');
    const input = document.getElementById('search-input');
    if (!caja || !boton || !input) return;

    const abierto = abrir ?? !caja.classList.contains('open');
    caja.classList.toggle('open', abierto);
    boton.setAttribute('aria-expanded', String(abierto));

    if (abierto) {
        input.focus();
    } else if (input.value) {
        // Cerrar el buscador limpia el filtro: dejarlo puesto y escondido es
        // la mejor forma de que parezca que faltan libros.
        input.value = '';
        renderizarLibros();
    }
}

// ========================================
// Estantería: muro, espejo accesible y respaldo plano
// ========================================
// El 3D lo pinta js/estante3d.js. Aquí vive todo lo que es DOM: agrupar en
// baldas, la leyenda, el espejo accesible y el estante plano de respaldo.

// Agrupa los libros visibles en baldas {id, nombre, color, libros}, en el
// orden de los temas. Los huérfanos (sin tema_id) van al final en la balda
// virtual 'sin-tema', igual que el selector de la barra lateral.
function baldasDesde(visibles) {
    const porTema = new Map();
    visibles.forEach(libro => {
        const clave = libro.tema_id || 'sin-tema';
        if (!porTema.has(clave)) porTema.set(clave, []);
        porTema.get(clave).push(libro);
    });

    const baldas = [];
    temas.forEach(tema => {
        if (!porTema.has(tema.id)) return;
        baldas.push({
            id: tema.id,
            nombre: tema.nombre,
            color: tema.color || token('--laton', '#BF8550'),
            libros: porTema.get(tema.id)
        });
    });

    if (porTema.has('sin-tema')) {
        baldas.push({
            id: 'sin-tema',
            nombre: 'Sin tema',
            color: token('--tinta-tenue', '#69665F'),
            libros: porTema.get('sin-tema')
        });
    }

    return baldas;
}

function renderizarEstante(grid, visibles) {
    const baldas = baldasDesde(visibles);

    const muroEl = document.createElement('div');
    muroEl.className = 'estante-muro';

    const escena = document.createElement('div');
    escena.className = 'estante-escena';
    muroEl.appendChild(escena);
    muroEl.appendChild(crearEspejoEstante(baldas, enfocarLibroEnMuro));
    grid.appendChild(muroEl);

    const gestos = document.createElement('p');
    gestos.className = 'estante-gestos';
    gestos.textContent = 'Rueda para acercar · pulsa la rueda para girar';
    grid.appendChild(gestos);

    // montarMuro devuelve false si Three.js no llegó o no hay WebGL. Entonces
    // se cambia la escena por el estante plano y la app sigue igual de usable:
    // la misma regla que ya sigue la gráfica de páginas.
    // Pulsar un lomo rellena la ficha lateral. El modal completo se abre
    // desde ahí, con «Ver notas y detalles»: así el mueble y el detalle se
    // ven a la vez, que es la gracia de la columna.
    const montado = montarMuro(escena, baldas, abrirEstante, seleccionarLibro, mostrarPista);
    if (!montado) {
        escena.remove();
        muroEl.insertBefore(crearEstantePlano(baldas), muroEl.querySelector('.estante-espejo'));
    }
}

// Etiqueta flotante con lo que hay bajo el cursor. Los lomos del muro no
// llevan texto rasterizado —serían 112 texturas para un ancho de 16px en el
// que no se leería nada—, así que el título vive aquí, en DOM real.
let pistaEl = null;

function mostrarPista(libroId, evento) {
    if (!pistaEl) {
        pistaEl = document.createElement('div');
        pistaEl.className = 'estante-pista';
        pistaEl.hidden = true;
        document.body.appendChild(pistaEl);
    }

    const libro = libroId ? buscarLibro(libroId) : null;
    if (!libro || !evento) {
        pistaEl.hidden = true;
        return;
    }

    pistaEl.innerHTML =
        '<strong>' + escaparHtml(libro.titulo) + '</strong>' +
        (libro.autor ? '<span>' + escaparHtml(libro.autor) + '</span>' : '') +
        '<span class="estante-pista-estado ' + claseEstado(libro.estado) + '">' +
        escaparHtml(libro.estado) + '</span>';
    pistaEl.hidden = false;

    // Se coloca tras medirla, y se repliega si se saldría por la derecha o
    // por abajo: junto al borde de la ventana, arriba a la izquierda.
    const caja = pistaEl.getBoundingClientRect();
    const margen = 14;
    let x = evento.clientX + margen;
    let y = evento.clientY + margen;
    if (x + caja.width > window.innerWidth - 8) x = evento.clientX - caja.width - margen;
    if (y + caja.height > window.innerHeight - 8) y = evento.clientY - caja.height - margen;
    pistaEl.style.transform = 'translate(' + Math.max(8, x) + 'px, ' + Math.max(8, y) + 'px)';
}

// El espejo accesible: el mueble en DOM real, invisible pero enfocable. Sin
// esto el canvas sería un muro opaco para el teclado y el lector de pantalla,
// y los títulos no existirían para Ctrl+F.
function crearEspejoEstante(baldas, alEnfocar) {
    const el = document.createElement('div');
    el.className = 'estante-espejo';

    const partes = baldas.map(balda => {
        const items = balda.libros.map(libro =>
            '<li><button type="button" data-libro="' + escaparHtml(libro.id) + '">' +
            escaparHtml(libro.titulo) +
            (libro.autor ? ' — ' + escaparHtml(libro.autor) : '') +
            ' · ' + escaparHtml(libro.estado) +
            '</button></li>'
        ).join('');

        return '<section><h3><button type="button" data-balda="' + escaparHtml(balda.id) + '">' +
               'Abrir el estante ' + escaparHtml(balda.nombre) + ' (' + balda.libros.length + ')' +
               '</button></h3><ul>' + items + '</ul></section>';
    });

    el.innerHTML = '<h2>Estantería</h2>' + partes.join('');

    el.addEventListener('click', e => {
        const btnLibro = e.target.closest('button[data-libro]');
        if (btnLibro) return abrirModalEdicion(btnLibro.dataset.libro);
        const btnBalda = e.target.closest('button[data-balda]');
        if (btnBalda) return abrirEstante(btnBalda.dataset.balda);
    });

    // Tabular saca el mismo libro que sacaría el ratón: el foco de teclado y
    // el hover cuentan la misma historia.
    el.addEventListener('focusin', e => {
        const btn = e.target.closest('button[data-libro]');
        if (btn && alEnfocar) alEnfocar(btn.dataset.libro);
    });

    return el;
}

// Respaldo sin WebGL. No imita el 3D: los mismos lomos, en plano.
function crearEstantePlano(baldas) {
    const el = document.createElement('div');
    el.className = 'estante-plano';

    el.innerHTML = baldas.map(balda => {
        const lomos = balda.libros.map(libro =>
            '<button type="button" class="estante-plano-lomo ' + claseEstado(libro.estado) + '"' +
            ' style="height: ' + (52 + (libro.titulo.length % 7) * 5) + 'px; background: ' + escaparHtml(balda.color) + ';"' +
            ' title="' + escaparHtml(libro.titulo) + '"' +
            ' aria-label="' + escaparHtml(libro.titulo) + ' · ' + escaparHtml(libro.estado) + '"' +
            ' data-libro="' + escaparHtml(libro.id) + '"></button>'
        ).join('');

        return '<section class="estante-plano-balda">' +
               '<button type="button" class="estante-plano-canto" data-balda="' + escaparHtml(balda.id) + '">' +
               escaparHtml(balda.nombre) +
               '<span class="estante-plano-cuenta">' + balda.libros.length + '</span>' +
               '</button>' +
               '<div class="estante-plano-lomos">' + lomos + '</div>' +
               '</section>';
    }).join('');

    el.addEventListener('click', e => {
        const btnLibro = e.target.closest('button[data-libro]');
        if (btnLibro) return abrirModalEdicion(btnLibro.dataset.libro);
        const btnBalda = e.target.closest('button[data-balda]');
        if (btnBalda) return abrirEstante(btnBalda.dataset.balda);
    });

    return el;
}

// ----------------------------------------
// Modal del estante
// ----------------------------------------

function abrirEstante(baldaId) {
    const modal = document.getElementById('estante-modal');
    const cuerpo = document.getElementById('estante-modal-cuerpo');
    if (!modal || !cuerpo) return;

    const esSinTema = baldaId === 'sin-tema';
    const tema = esSinTema ? null : temas.find(t => t.id === baldaId);
    if (!esSinTema && !tema) return;

    const delTema = esSinTema
        ? libros.filter(l => !l.tema_id)
        : libros.filter(l => l.tema_id === baldaId);

    const nombre = esSinTema ? 'Sin tema' : tema.nombre;
    const acento = (esSinTema ? null : tema.color) || token('--laton', '#BF8550');

    document.getElementById('estante-modal-titulo').textContent = nombre;
    document.getElementById('estante-modal-cuenta').textContent =
        delTema.length === 1 ? '1 lectura' : delTema.length + ' lecturas';
    // El acento se fija en el modal, no en :root: abrir un estante no cambia
    // el tema que estás mirando en el resto de la interfaz.
    modal.style.setProperty('--tema-acento', acento);

    desmontarEstanteModal();
    cuerpo.innerHTML = '';

    // El modal se activa ANTES de montar la escena. Un contenedor oculto mide
    // 0 y la cámara saldría con un aspect ratio absurdo: la misma lección que
    // obliga a rehacer las gráficas al abrir el panel de análisis.
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';

    // El muro se desmonta al abrir el modal. No es solo ahorro: un navegador
    // admite del orden de 16 contextos WebGL a la vez y, al pasarse, mata el
    // MÁS VIEJO — que es justo el del muro. Abriendo y cerrando estantes
    // deprisa, el mueble del fondo se quedaba en negro y ya no volvía.
    // Con esto nunca hay dos escenas vivas, y de paso el muro tapado deja de
    // ocupar memoria de vídeo.
    desmontarMuro();

    const escena = document.createElement('div');
    escena.className = 'estante-escena';
    cuerpo.appendChild(escena);

    const baldaUnica = [{ id: baldaId, nombre: nombre, color: acento, libros: delTema }];
    cuerpo.appendChild(crearEspejoEstante(baldaUnica, enfocarLibroEnModal));

    const montado = montarEstanteModal(escena, { nombre: nombre, color: acento }, delTema, id => {
        cerrarEstante();
        abrirModalEdicion(id);
    });

    if (!montado) {
        escena.remove();
        cuerpo.insertBefore(crearEstantePlano(baldaUnica), cuerpo.firstChild);
    }

    document.getElementById('estante-modal-close')?.focus();
}

function cerrarEstante() {
    const modal = document.getElementById('estante-modal');
    if (!modal) return;
    // Liberar la GPU antes de ocultar: abrir y cerrar el estante veinte veces
    // no puede dejar veinte escenas vivas.
    desmontarEstanteModal();
    document.getElementById('estante-modal-cuerpo').innerHTML = '';
    modal.classList.remove('active');
    modal.style.removeProperty('--tema-acento');
    document.body.style.overflow = '';

    // Y se vuelve a levantar el muro, que se había desmontado al abrir.
    renderizarLibros();
}

function calcularPromedioDias() {
    const conDias = libros.filter(l => l.estado === 'Leído' && l.dias !== null);
    if (!conDias.length) return 0;
    return Math.round(conDias.reduce((suma, l) => suma + l.dias, 0) / conDias.length);
}

function claseEstado(estado) {
    return estado === 'Leído' ? 'leido'
         : estado === 'Leyendo' ? 'leyendo'
         : 'pendiente';
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

    // Sin portada, el hueco se oculta entero. Antes solo se le quitaba la
    // imagen, y el elemento seguía ahí con su borde y sus 68x96: como las
    // portadas no cargan nunca —Google Books sin clave responde 429—, cada
    // libro que abrías enseñaba un rectángulo gris vacío.
    //
    // Se reasigna siempre, también al ocultar: si no, la portada del libro
    // anterior se queda pegada al abrir uno que no tiene.
    const portada = document.getElementById('modal-hero-image');
    if (portada) {
        portada.style.backgroundImage = libro.portada ? `url(${libro.portada})` : 'none';
        portada.hidden = !libro.portada;
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
    // Sin sesión no se puede: los botones del menú ya salen deshabilitados,
    // así que aquí basta con no hacer nada. Un alert bloqueaba el hilo y
    // era ruido justo en la parte de la interfaz que se limpió.
    if (!puedeEditarCatalogo()) return;

    const tema = id ? temas.find(t => t.id === id) : null;

    document.getElementById('tema-modal-titulo').textContent = tema ? 'Editar tema' : 'Nuevo tema';
    document.getElementById('tema-nombre').value = tema?.nombre || '';
    // Por defecto, el mismo acento que --tema-acento en :root (latón). El
    // verde neón que había aquí era de la paleta anterior.
    document.getElementById('tema-color').value = tema?.color || '#BF8550';
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
    }

    escribirCacheLocal();
    cerrarModalTema();
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
    escribirCacheLocal();
    cerrarModalTema();
    actualizarInterfaz();
}

// ========================================
// CRUD de libros
// ========================================
function abrirModalLibro(id = null) {
    // Sin sesión no se puede: los botones del menú ya salen deshabilitados,
    // así que aquí basta con no hacer nada. Un alert bloqueaba el hilo y
    // era ruido justo en la parte de la interfaz que se limpió.
    if (!puedeEditarCatalogo()) return;

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
    selector.value = libro?.tema_id || '';

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
// Alta de varias lecturas (tabla editable)
// ========================================
// Sustituye a la hoja de cálculo: se escriben las filas aquí y se crean
// todas de un viaje con crearLibrosDB(), que ya existía en db.js sin que
// nadie la llamara.

const LOTE_COLUMNAS = ['titulo', 'autor', 'tipo', 'año', 'paginas', 'enlace'];
const LOTE_FILAS_INICIALES = 4;

function normalizarTitulo(texto) {
    return String(texto ?? '').trim().toLowerCase();
}

function abrirModalLote() {
    // Sin sesión no se puede: los botones del menú ya salen deshabilitados,
    // así que aquí basta con no hacer nada. Un alert bloqueaba el hilo y
    // era ruido justo en la parte de la interfaz que se limpió.
    if (!puedeEditarCatalogo()) return;

    const selector = document.getElementById('lote-tema');
    selector.innerHTML = '<option value="">Sin tema</option>';
    temas.forEach(t => {
        const opcion = document.createElement('option');
        opcion.value = t.id;
        opcion.textContent = t.nombre;
        selector.appendChild(opcion);
    });
    // Antes heredaba el tema que estabas mirando. Ya no existe esa noción:
    // el destino se elige aquí, a mano.
    selector.value = '';

    document.getElementById('lote-subtema').value = '';

    // Sugerencias de subtema con los que ya existen, para no acabar con
    // "Básico" y "basico" como dos grupos distintos.
    const sugerencias = document.getElementById('subtemas-existentes');
    if (sugerencias) {
        const usados = [...new Set(libros.map(l => l.subtema).filter(Boolean))].sort();
        sugerencias.innerHTML = usados.map(s => `<option value="${escaparHtml(s)}"></option>`).join('');
    }

    const cuerpo = document.getElementById('lote-filas');
    cuerpo.innerHTML = '';
    for (let i = 0; i < LOTE_FILAS_INICIALES; i++) cuerpo.appendChild(crearFilaLote());

    actualizarResumenLote();

    document.getElementById('lote-modal').classList.add('active');
    document.body.style.overflow = 'hidden';
    cuerpo.querySelector('input')?.focus();
}

function cerrarModalLote() {
    document.getElementById('lote-modal').classList.remove('active');
    document.body.style.overflow = '';
}

function crearFilaLote() {
    const fila = document.createElement('tr');

    fila.innerHTML = LOTE_COLUMNAS.map(campo => {
        const numero = campo === 'año' || campo === 'paginas';
        const lista = campo === 'tipo' ? ' list="tipos-existentes"' : '';
        return `<td><input type="${numero ? 'number' : 'text'}" class="lote-input"
                          data-campo="${campo}"${lista}
                          ${numero ? 'min="0"' : ''}></td>`;
    }).join('') +
    `<td><button type="button" class="lote-quitar" title="Quitar fila" aria-label="Quitar fila">×</button></td>`;

    fila.querySelector('.lote-quitar').addEventListener('click', () => {
        fila.remove();
        // Nunca dejar la tabla sin una fila donde escribir.
        const cuerpo = document.getElementById('lote-filas');
        if (!cuerpo.children.length) cuerpo.appendChild(crearFilaLote());
        actualizarResumenLote();
    });

    return fila;
}

function leerFilasLote() {
    return [...document.querySelectorAll('#lote-filas tr')].map(fila => {
        const datos = {};
        fila.querySelectorAll('.lote-input').forEach(input => {
            const valor = input.value.trim();
            if (valor) datos[input.dataset.campo] = valor;
        });
        return { fila, datos };
    });
}

function actualizarResumenLote() {
    const resumen = document.getElementById('lote-resumen');
    const boton = document.getElementById('btn-crear-lote');
    if (!resumen || !boton) return;

    const existentes = new Set(libros.map(l => normalizarTitulo(l.titulo)));
    const vistos = new Set();
    let nuevas = 0;
    let repetidas = 0;

    leerFilasLote().forEach(({ fila, datos }) => {
        const titulo = normalizarTitulo(datos.titulo);
        // Una fila sin título no cuenta ni estorba: es sitio para escribir.
        if (!titulo) {
            fila.classList.remove('lote-repetida');
            return;
        }

        const duplicada = existentes.has(titulo) || vistos.has(titulo);
        fila.classList.toggle('lote-repetida', duplicada);

        if (duplicada) repetidas++;
        else { nuevas++; vistos.add(titulo); }
    });

    const partes = [];
    if (nuevas) partes.push(`${nuevas} ${nuevas === 1 ? 'nueva' : 'nuevas'}`);
    if (repetidas) partes.push(`${repetidas} ya ${repetidas === 1 ? 'existe' : 'existen'} y se ${repetidas === 1 ? 'omitirá' : 'omitirán'}`);

    resumen.textContent = partes.join(' · ') || 'Escribe al menos un título.';
    boton.disabled = nuevas === 0;
    boton.textContent = nuevas ? `Crear ${nuevas}` : 'Crear';
}

async function crearLoteLecturas() {
    const temaId = document.getElementById('lote-tema').value || null;
    const subtema = document.getElementById('lote-subtema').value.trim() || null;

    const existentes = new Set(libros.map(l => normalizarTitulo(l.titulo)));
    const vistos = new Set();
    const nuevos = [];

    leerFilasLote().forEach(({ datos }) => {
        const titulo = normalizarTitulo(datos.titulo);
        if (!titulo || existentes.has(titulo) || vistos.has(titulo)) return;
        vistos.add(titulo);

        const anio = parseInt(datos.año, 10);
        const paginas = parseInt(datos.paginas, 10);

        nuevos.push({
            titulo: datos.titulo.trim(),
            autor: datos.autor ?? null,
            tipo: datos.tipo ?? null,
            enlace: datos.enlace ?? null,
            año: Number.isNaN(anio) ? null : anio,
            paginas: Number.isNaN(paginas) ? null : paginas,
            tema_id: temaId,
            subtema,
            estado: 'Pendiente',
            orden: libros.length + nuevos.length
        });
    });

    if (!nuevos.length) return;

    const boton = document.getElementById('btn-crear-lote');
    boton.disabled = true;
    boton.textContent = 'Creando…';

    const creados = await crearLibrosDB(nuevos);

    if (!creados) {
        alert('No se pudieron crear las lecturas. Se conservan en la tabla para reintentar.');
        actualizarResumenLote();
        return;
    }

    libros.push(...creados);
    escribirCacheLocal();
    cerrarModalLote();
    actualizarInterfaz();
}

// ========================================
// Filtros por estado
// ========================================
function aplicarFiltro(filtro) {
    filtroActual = filtro;
    document.querySelectorAll('.status-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filtro);
    });
    renderizarLibros();
}

// ========================================
// Menú "···"
// ========================================
// Recoge todo lo que antes ocupaba la barra lateral. En reposo la pantalla es
// solo el mueble; el precio acordado es que buscar sea un gesto de dos pasos.

// Crear temas y libros necesita un id generado por el servidor, así que sin
// sesión no se puede. En vez de dejar pulsar y avisar después, las tres
// acciones salen deshabilitadas con una nota que dice por qué.
function actualizarAccionesCatalogo() {
    const permitido = !!puedeEditarCatalogo();
    ['btn-nuevo-tema', 'btn-nuevo-libro', 'btn-nuevas-lecturas'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = !permitido;
    });
    const nota = document.getElementById('menu-nota-offline');
    if (nota) nota.hidden = permitido;
}

function menuAbierto() {
    return document.getElementById('menu-btn')?.getAttribute('aria-expanded') === 'true';
}

function abrirMenu() {
    const btn = document.getElementById('menu-btn');
    const panel = document.getElementById('menu-panel');
    const velo = document.getElementById('menu-velo');
    if (!btn || !panel) return;

    actualizarAccionesCatalogo();
    btn.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    if (velo) velo.hidden = false;
    // Se abre con el cursor ya en la búsqueda: es lo que más se viene a hacer.
    document.getElementById('search-input')?.focus();
}

function cerrarMenu() {
    const btn = document.getElementById('menu-btn');
    const panel = document.getElementById('menu-panel');
    const velo = document.getElementById('menu-velo');
    if (!btn || !panel) return;

    btn.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    if (velo) velo.hidden = true;
}

function alternarMenu() {
    menuAbierto() ? cerrarMenu() : abrirMenu();
}

// ========================================
// Event listeners
// ========================================
function inicializarEventListeners() {
    if (eventListenersInicializados) return;
    eventListenersInicializados = true;

    // Menú "···": búsqueda, filtro, altas, respaldo y sesión
    document.getElementById('menu-btn')?.addEventListener('click', alternarMenu);
    document.getElementById('menu-velo')?.addEventListener('click', cerrarMenu);

    // Filtros de estado en la barra. Vuelven a pulsarse para desactivarse:
    // sin eso no habría forma de volver a «Todos», porque no hay pastilla.
    document.querySelectorAll('.status-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            aplicarFiltro(filtroActual === btn.dataset.filter ? 'Todos' : btn.dataset.filter);
        });
    });

    // Colecciones: delegado, porque la lista se repinta en cada render.
    document.getElementById('category-list')?.addEventListener('click', e => {
        const btn = e.target.closest('button[data-tema]');
        if (btn) seleccionarColeccion(btn.dataset.tema);
    });

    // Buscador desplegable
    document.getElementById('btn-buscar')?.addEventListener('click', () => alternarBuscador());

    // Ficha lateral
    document.getElementById('detail-close')?.addEventListener('click', cerrarFicha);
    document.getElementById('btn-ver-detalles')?.addEventListener('click', () => {
        if (libroEnFicha) abrirModalEdicion(libroEnFicha);
    });

    // Búsqueda con debounce. El menú NO se cierra al escribir: se ve el mueble
    // filtrarse detrás mientras tecleas, que es medio motivo para tenerlo abierto.
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        let temporizador;
        searchInput.addEventListener('input', () => {
            clearTimeout(temporizador);
            temporizador = setTimeout(renderizarLibros, 300);
        });
    }

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

    // Modal del estante
    document.getElementById('estante-modal-close')?.addEventListener('click', cerrarEstante);
    document.getElementById('estante-modal-backdrop')?.addEventListener('click', cerrarEstante);

    // Los nombres de las baldas se dibujan en una textura de canvas, no en el
    // DOM. Si las fuentes aún no han cargado cuando se monta el mueble, el
    // texto queda grabado con la fuente de respaldo y ahí se queda: hay que
    // rehacerlo una vez, cuando la tipografía esté lista.
    document.fonts?.ready.then(() => renderizarLibros());

    // Alta de varias lecturas
    document.getElementById('btn-nuevas-lecturas')?.addEventListener('click', abrirModalLote);
    document.getElementById('lote-modal-close')?.addEventListener('click', cerrarModalLote);
    document.getElementById('lote-modal-backdrop')?.addEventListener('click', cerrarModalLote);
    document.getElementById('btn-crear-lote')?.addEventListener('click', crearLoteLecturas);

    const cuerpoLote = document.getElementById('lote-filas');
    if (cuerpoLote) {
        // Delegación: las filas nacen y mueren, los listeners no.
        cuerpoLote.addEventListener('input', actualizarResumenLote);

        cuerpoLote.addEventListener('keydown', e => {
            if (e.key !== 'Enter' || !e.target.classList.contains('lote-input')) return;
            e.preventDefault();

            const filaActual = e.target.closest('tr');
            const siguiente = filaActual.nextElementSibling
                || cuerpoLote.appendChild(crearFilaLote());

            // Al bajar se mantiene la columna: se está rellenando una tabla,
            // no un formulario.
            const columna = e.target.dataset.campo;
            siguiente.querySelector(`[data-campo="${columna}"]`)?.focus();
            actualizarResumenLote();
        });

        // Pegar varias celdas de golpe reparte el texto por la tabla en vez
        // de meterlo entero en una casilla.
        cuerpoLote.addEventListener('paste', e => {
            const texto = e.clipboardData?.getData('text/plain') ?? '';
            if (!texto.includes('\t') && !texto.includes('\n')) return;

            e.preventDefault();

            const filas = texto.split(/\r?\n/).filter(l => l.trim());
            const filaInicio = e.target.closest('tr');
            const columnaInicio = LOTE_COLUMNAS.indexOf(e.target.dataset.campo);

            let destino = filaInicio;
            filas.forEach((linea, i) => {
                if (!destino) destino = cuerpoLote.appendChild(crearFilaLote());

                linea.split('\t').forEach((celda, j) => {
                    const campo = LOTE_COLUMNAS[columnaInicio + j];
                    if (!campo) return;
                    const input = destino.querySelector(`[data-campo="${campo}"]`);
                    if (input) input.value = celda.trim();
                });

                destino = i < filas.length - 1
                    ? (destino.nextElementSibling || cuerpoLote.appendChild(crearFilaLote()))
                    : destino;
            });

            actualizarResumenLote();
        });
    }

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
        if (document.getElementById('estante-modal')?.classList.contains('active')) return cerrarEstante();
        if (document.getElementById('lote-modal')?.classList.contains('active')) return cerrarModalLote();
        if (document.getElementById('libro-modal')?.classList.contains('active')) return cerrarModalLibro();
        if (document.getElementById('tema-modal')?.classList.contains('active')) return cerrarModalTema();
        if (document.getElementById('edit-modal')?.classList.contains('active')) return cerrarModal();
        if (document.getElementById('search-box')?.classList.contains('open')) {
            return alternarBuscador(false);
        }
        if (menuAbierto()) return cerrarMenu();
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
    inicializarEventListeners,
    montarFondoLogin
};
