// ========================================
// Visualizaciones
// ========================================
// Dos piezas, cada una con la forma que le toca:
//
//   Reparto por estado  → part-to-whole → BARRA APILADA en HTML plano.
//     Antes era un doughnut. Un anillo obliga a comparar ángulos, y en una
//     columna estrecha desperdicia el espacio; la barra apilada se lee de un
//     vistazo y admite etiquetas reales.
//
//   Páginas por mes     → magnitud en el tiempo → barras, UNA sola serie y
//     por tanto un solo color (nunca una rampa sobre categorías: duplicaría
//     en el color lo que ya dice la altura).
//
// Reglas aplicadas de la skill dataviz:
//   · hueco de 2px del color de superficie entre segmentos, no borde
//   · rejilla y ejes en línea fina SÓLIDA (nunca punteada) y discreta
//   · leyenda presente con ≥2 series; los valores van en tinta, no en el
//     color de la serie
//   · el tooltip no es la única vía al dato: el eje Y y la leyenda lo dan
//   · sin doble eje, jamás

let pagesChart = null;

const chartJsDisponible = typeof Chart !== 'undefined';

if (chartJsDisponible) {
    Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";
} else {
    console.warn('[Charts] Chart.js no está disponible; se omite la gráfica de páginas.');
}

// Los colores salen del sistema de diseño, no se repiten a mano aquí.
function token(nombre, respaldo) {
    const valor = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
    return valor || respaldo;
}

// ----------------------------------------
// Reparto por estado — barra apilada
// ----------------------------------------

function renderBarraEstados(libros) {
    const contenedor = document.getElementById('estado-chart');
    if (!contenedor) return;

    const estados = [
        { clave: 'Leído', etiqueta: 'Leídos', color: token('--leido', '#007551') },
        { clave: 'Leyendo', etiqueta: 'Leyendo', color: token('--leyendo', '#B57C00') },
        { clave: 'Pendiente', etiqueta: 'Pendientes', color: token('--pendiente', '#6A4FC7') }
    ];

    const total = libros.length;

    estados.forEach(e => {
        e.valor = libros.filter(l => l.estado === e.clave).length;
        e.pct = total ? (e.valor / total) * 100 : 0;
    });

    if (!total) {
        contenedor.innerHTML = '<p class="grid-vacio" style="padding:1rem 0">Sin libros todavía.</p>';
        return;
    }

    const segmentos = estados
        .filter(e => e.valor > 0)
        .map(e => `<div class="estado-segmento"
                        style="flex:${e.valor};background:${e.color}"
                        title="${e.etiqueta}: ${e.valor} de ${total}"></div>`)
        .join('');

    // La leyenda lleva nombre y valor SIEMPRE: la identidad nunca depende
    // solo del color, y el dato es legible sin pasar el ratón.
    const leyenda = estados.map(e => `
        <div class="estado-leyenda-fila">
            <span class="estado-leyenda-punto" style="background:${e.color}"></span>
            <span class="estado-leyenda-nombre">${e.etiqueta}</span>
            <span class="estado-leyenda-valor">${e.valor}</span>
        </div>
    `).join('');

    contenedor.innerHTML = `<div class="estado-barra">${segmentos}</div>
                            <div class="estado-leyenda">${leyenda}</div>`;
}

// ----------------------------------------
// Progreso por tema — barras apiladas horizontales
// ----------------------------------------
// Part-to-whole repetido por categoría. En HTML plano, como el reparto de
// estados: son tres segmentos por fila, no hace falta un motor de gráficas.
//
// Existe porque es lo ÚNICO que se puede medir con estos datos. Las vistas
// temporales necesitan `final`, y la de páginas necesita además `paginas`;
// la mayor parte del catálogo se cargó desde una hoja de cálculo sin esos
// campos, así que dejaban fuera casi todas las lecturas terminadas.

function renderProgresoTemas(temas, libros) {
    const contenedor = document.getElementById('temas-chart');
    if (!contenedor) return;

    if (!libros.length) {
        contenedor.innerHTML = '<p class="grid-vacio">Sin libros todavía.</p>';
        return;
    }

    const estados = [
        { clave: 'Leído', etiqueta: 'Leídos', color: token('--leido', '#007551') },
        { clave: 'Leyendo', etiqueta: 'Leyendo', color: token('--leyendo', '#B57C00') },
        { clave: 'Pendiente', etiqueta: 'Pendientes', color: token('--pendiente', '#6A4FC7') }
    ];

    // Los huérfanos también cuentan: si no, los totales no cuadran con la
    // barra de estados de la barra lateral.
    const grupos = temas.map(t => ({
        nombre: t.nombre,
        libros: libros.filter(l => l.tema_id === t.id)
    }));

    const huerfanos = libros.filter(l => !l.tema_id);
    if (huerfanos.length) grupos.push({ nombre: 'Sin tema', libros: huerfanos });

    const filas = grupos
        .filter(g => g.libros.length)
        .map(g => {
            const total = g.libros.length;
            const leidos = g.libros.filter(l => l.estado === 'Leído').length;

            const segmentos = estados
                .map(e => ({ ...e, valor: g.libros.filter(l => l.estado === e.clave).length }))
                .filter(e => e.valor > 0)
                .map(e => `<div class="progreso-seg"
                                style="flex:${e.valor};background:${e.color}"
                                title="${e.etiqueta}: ${e.valor} de ${total}"></div>`)
                .join('');

            // El valor va SIEMPRE escrito: la longitud de la barra da la
            // proporción, pero el dato exacto no puede depender del ratón.
            return `<div class="progreso-fila">
                        <span class="progreso-nombre" title="${escaparAtributo(g.nombre)}">${escaparAtributo(g.nombre)}</span>
                        <div class="progreso-barra">${segmentos}</div>
                        <span class="progreso-valor">${leidos}/${total}</span>
                    </div>`;
        })
        .join('');

    const leyenda = estados.map(e => `
        <div class="estado-leyenda-fila">
            <span class="estado-leyenda-punto" style="background:${e.color}"></span>
            <span class="estado-leyenda-nombre">${e.etiqueta}</span>
        </div>
    `).join('');

    contenedor.innerHTML = `<div class="progreso-temas">${filas}</div>
                            <div class="estado-leyenda progreso-leyenda">${leyenda}</div>`;
}

// charts.js se carga antes que app.js, así que no puede usar su escaparHtml:
// en el momento de definirse aún no existe. Se resuelve en llamada, pero se
// deja explícito con un respaldo propio.
function escaparAtributo(texto) {
    return String(texto ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ----------------------------------------
// Páginas por mes — barras
// ----------------------------------------

function createPagesChart(libros) {
    const ctx = document.getElementById('pages-chart');
    if (!ctx || !chartJsDisponible) return;

    const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
                   'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

    const porMes = {};

    libros.forEach(libro => {
        if (libro.estado !== 'Leído' || !libro.final) return;
        const fecha = parseFechaEspañol(libro.final);
        if (!fecha) return;

        const clave = `${meses[fecha.getMonth()]} ${fecha.getFullYear()}`;
        if (!porMes[clave]) porMes[clave] = { paginas: 0, libros: 0, fecha };
        porMes[clave].paginas += libro.paginas || 0;
        porMes[clave].libros++;
    });

    const ordenados = Object.keys(porMes).sort((a, b) => porMes[a].fecha - porMes[b].fecha);
    const etiquetas = ordenados;
    const valores = ordenados.map(m => porMes[m].paginas);
    const cuentas = ordenados.map(m => porMes[m].libros);

    // Se anula la referencia además de destruirla: si más abajo salimos
    // antes de reasignarla, quedaría apuntando a un gráfico ya destruido.
    if (pagesChart) {
        pagesChart.destroy();
        pagesChart = null;
    }

    // El canvas vive dentro de .chart-caja (altura fija, la que impide que
    // el gráfico crezca sin fin); el aviso de "sin datos" va fuera de ella,
    // en la tarjeta, para no quedar centrado en un hueco de 210px.
    const caja = ctx.parentElement;
    const contenedor = caja?.parentElement ?? caja;

    // Cuántas lecturas terminadas quedan fuera de la gráfica por no tener
    // fecha de fin. Callarlo es lo que hacía inútil este panel: mostraba dos
    // barras y dejaba creer que ese era todo el historial.
    const terminados = libros.filter(l => l.estado === 'Leído').length;
    const situados = ordenados.reduce((suma, m) => suma + porMes[m].libros, 0);
    const fuera = terminados - situados;

    contenedor?.querySelector('.grid-vacio')?.remove();
    contenedor?.querySelector('.nota-datos')?.remove();

    if (!etiquetas.length) {
        // Un gráfico vacío con un "Sin datos" falso es peor que decirlo.
        if (contenedor) {
            if (caja) caja.style.display = 'none';
            contenedor.insertAdjacentHTML('beforeend',
                `<p class="grid-vacio">${
                    terminados
                        ? `Ninguna de tus ${terminados} lecturas terminadas tiene fecha de fin, así que no se pueden situar en el tiempo.`
                        : 'Aún no has terminado ningún libro.'
                }</p>`);
        }
        return;
    }

    if (caja) caja.style.display = '';

    if (fuera > 0 && contenedor) {
        contenedor.insertAdjacentHTML('beforeend',
            `<p class="nota-datos">${fuera} ${fuera === 1 ? 'lectura terminada' : 'lecturas terminadas'} sin fecha de fin ${fuera === 1 ? 'no aparece' : 'no aparecen'} aquí.</p>`);
    }

    // Con el panel de análisis plegado, o con la pestaña "Timeline" delante,
    // la caja está oculta y mide 0: construir aquí daría un gráfico de tamaño
    // cero. app.js vuelve a llamar a initCharts() al abrir el panel y al
    // entrar en la pestaña, que es cuando ya se puede medir.
    if (caja && !caja.offsetParent) return;

    const tinta = token('--tinta', '#1C1815');
    const tenue = token('--tinta-tenue', '#938878');
    const rejilla = token('--rejilla', 'rgba(28,24,21,0.09)');
    const papel = token('--plano', '#FBF7F0');
    const acento = token('--tema-acento', '#B57C00');

    pagesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: etiquetas,
            datasets: [{
                label: 'Páginas leídas',
                data: valores,
                backgroundColor: acento,
                // Extremo redondeado de 4px anclado a la línea base
                borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 },
                borderSkipped: 'bottom',
                borderWidth: 0,
                maxBarThickness: 34
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    border: { display: false },
                    ticks: {
                        color: tenue,
                        font: { size: 11 },
                        padding: 8,
                        callback: v => v.toLocaleString()
                    },
                    // Rejilla sólida y discreta: el punteado añade ruido y se
                    // lee como "umbral" cuando solo es una guía.
                    grid: { color: rejilla, drawTicks: false }
                },
                x: {
                    border: { color: rejilla },
                    ticks: { color: tenue, font: { size: 11 }, padding: 6 },
                    grid: { display: false }
                }
            },
            plugins: {
                // Una sola serie: el título de la tarjeta ya la nombra.
                legend: { display: false },
                tooltip: {
                    // Invertido: tinta de fondo y papel de texto. Un tooltip
                    // claro sobre una gráfica clara necesitaría un borde para
                    // separarse del fondo; así se lee solo.
                    backgroundColor: tinta,
                    titleColor: papel,
                    bodyColor: papel,
                    padding: 10,
                    cornerRadius: 6,
                    displayColors: false,
                    callbacks: {
                        label: c => [
                            `${c.parsed.y.toLocaleString()} páginas`,
                            `${cuentas[c.dataIndex]} ${cuentas[c.dataIndex] === 1 ? 'libro' : 'libros'}`
                        ]
                    }
                }
            },
            animation: { duration: 500, easing: 'easeOutQuart' }
        }
    });
}

// ----------------------------------------

// `librosVisibles` es el ámbito del tema seleccionado; `librosTodos` y
// `temas` son globales, porque el progreso por tema los compara entre sí y
// no debe encogerse al filtrar.
function updateCharts(librosVisibles, temas = [], librosTodos = librosVisibles) {
    // Un fallo aquí no debe impedir que se vean los libros.
    try {
        renderBarraEstados(librosVisibles);
        renderProgresoTemas(temas, librosTodos);
        createPagesChart(librosVisibles);
    } catch (error) {
        console.error('[Charts] Error al renderizar:', error);
    }
}

function initCharts(librosVisibles, temas = [], librosTodos = librosVisibles) {
    updateCharts(librosVisibles, temas, librosTodos);
}
