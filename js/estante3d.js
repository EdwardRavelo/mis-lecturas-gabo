// ========================================
// Estantería 3D (WebGL / Three.js)
// ========================================
// El mueble de la biblioteca: un muro con una balda por tema, y un modal
// grande que abre una balda y reparte sus libros por subtema.
//
// REGLA DE ORO, como en db.js: este archivo nunca debe tumbar la app.
// Three.js llega por CDN y WebGL puede no existir (GPU bloqueada, navegador
// viejo, --disable-gpu). `estanteDisponible` se calcula igual que
// `chartJsDisponible` en charts.js: si es false, app.js pinta el estante
// plano en HTML y todo lo demás sigue funcionando.
//
// Los colores NO se repiten aquí: salen de :root con token(), que define
// charts.js y que se carga antes que este archivo. Retematizar la app llega
// solo al 3D.
//
// Tres cosas que este archivo se toma en serio:
//
//   1. DISPOSAL. renderizarLibros() reconstruye en cada cambio. Sin liberar
//      la GPU cada re-render filtra geometrías, materiales y texturas. Todo
//      lo que se crea se registra y se destruye en desmontar().
//   2. EL CANVAS NO EMPUJA. El canvas va en position:absolute dentro de un
//      contenedor de altura definida, así que no puede crecer a su padre ni
//      realimentar al ResizeObserver. Es la misma trampa que ya se comió una
//      vez la gráfica de páginas (ver charts.js).
//   3. RENDER BAJO DEMANDA. Esto es un diario de lecturas, no un juego: no
//      hay bucle permanente. Se dibuja cuando algo cambia y se para solo.

// ----------------------------------------
// Disponibilidad
// ----------------------------------------

var estanteDisponible = (function comprobarWebGL() {
    if (typeof THREE === 'undefined') {
        console.warn('[Estante] Three.js no está disponible; se usa el estante plano.');
        return false;
    }
    try {
        const lienzo = document.createElement('canvas');
        const ctx = lienzo.getContext('webgl2') || lienzo.getContext('webgl');
        if (!ctx) {
            console.warn('[Estante] Este navegador no da contexto WebGL; se usa el estante plano.');
            return false;
        }
        return true;
    } catch (e) {
        console.warn('[Estante] WebGL falló al inicializar:', e.message);
        return false;
    }
})();

// ----------------------------------------
// Utilidades
// ----------------------------------------

// Los colores salen del sistema de diseño, no se repiten a mano aquí.
// Vivía en charts.js, que desapareció con las gráficas en el recorte del
// 2026-09-26; se muda aquí porque es el único sitio que aún lo necesita,
// más app.js, que carga después.
function token(nombre, respaldo) {
    const valor = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
    return valor || respaldo;
}

// Color para el `color` de un material, convertido de sRGB a LINEAL.
//
// Esta función existe porque su ausencia era el defecto más caro de toda la
// escena, y no se veía como un error de color sino como falta de acabado:
// todo salía pastel, el canto del mueble más claro que sus propias baldas, la
// maceta salmón y las hojas verde menta.
//
// three r147 corre con ColorManagement.legacyMode: `new THREE.Color('#39271B')`
// NO convierte nada, mete el hex tal cual como valor lineal, y el renderer le
// aplica después el gamma de salida. Un nogal oscuro sale así a #6E5A47, que
// es un tostado claro. Es decir: TODO hex puesto a mano en un material salía
// entre una y dos paradas más claro y más lavado de lo escrito.
//
// El apaño anterior era escribir los tokens ya pre-compensados (--planta-hoja
// era #081C0C para verse #3E6B4A), lo que obligaba a elevar a 2.2 a mano cada
// color nuevo y dejaba :root lleno de hexes que no se parecen a lo que pintan.
// Con esto los tokens vuelven a ser el color de verdad y la conversión ocurre
// en un solo sitio.
//
// OJO, y es la mitad de la regla: esto va SOLO donde el color alimenta a un
// material. Los colores que acaban dibujados en un <canvas> (la pared, las
// duelas, el papel) viajan en una textura marcada sRGBEncoding, que el
// renderer ya decodifica sola: convertirlos aquí los oscurecería dos veces.
function colorMaterial(nombre, respaldo) {
    return new THREE.Color(token(nombre, respaldo)).convertSRGBToLinear();
}

// Hash determinista de un id → 0..1. Determinista es el punto: la altura y
// el tono de cada libro salen de aquí, y renderizarLibros() reconstruye el
// mueble en cada cambio. Con Math.random() los libros bailarían al filtrar.
function hashEstante(texto) {
    let h = 2166136261;
    const s = String(texto || '');
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ((h >>> 0) % 100000) / 100000;
}

// Grosor del lomo a partir de las páginas. La mayoría del catálogo se cargó
// desde una hoja de cálculo sin `paginas`, así que el caso por defecto no es
// el raro: es el común.
function grosorLomo(libro) {
    const p = Number(libro.paginas);
    if (!p || Number.isNaN(p)) {
        // Las 94 lecturas que entraron por supabase-schema-v3.sql no traen
        // `paginas`: su INSERT no incluye la columna. Con un grosor fijo el
        // estante real era una valla de listones idénticos, así que sin dato
        // se reparte por hash. Determinista, como todo lo demás: un libro
        // tiene siempre el mismo grosor aunque el muro se reconstruya.
        // En cuanto una lectura reciba sus páginas de verdad, pasa a usarlas.
        return 0.8 + hashEstante(libro.id + '|grosor') * 1.4;
    }
    return Math.max(0.6, Math.min(3.2, 0.55 + p / 190));
}

function alturaLomo(libro) {
    // Techo 18.5 sobre un panel de 28: el tercio superior queda libre para el
    // rótulo. Subirlo mas hace que el libro mas alto tape el nombre del tema.
    return 13 + hashEstante(libro.id) * 5.5;
}

// Color del lomo: el acento del tema, desviado por libro de forma
// determinista para que la balda tenga vida sin dejar de leerse como un tema.
// Cuánto del color del tema conserva un libro según su estado. Es la capa
// que deja leer el avance de un vistazo: el color se gana terminando.
//
// No sustituye al tejuelo. El punto de estado sigue llevando el color exacto
// de --leido / --leyendo / --pendiente, así que el estado de un libro concreto
// nunca depende solo de lo saturado que esté su lomo: esto es una segunda
// codificación, redundante a propósito, para la lectura a distancia.
//
// Pendiente no baja a cero: un resto de tono deja un gris CÁLIDO, del color
// de la habitación. A cero exacto el mueble parece una foto en blanco y negro
// pegada dentro de una escena en color.
const CROMA_POR_ESTADO = {
    'Leído': 1,
    'Leyendo': 0.45,
    'Pendiente': 0.10
};

function colorLomo(libro, acentoHex) {
    const base = new THREE.Color(acentoHex || '#BF8550');
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    const n = hashEstante(libro.id + '|lomo');
    const m = hashEstante(libro.id + '|luz');

    // El jitter de saturación se calcula igual para todos y DESPUÉS se atenúa,
    // para que dos libros grises sigan sin ser idénticos entre sí.
    const croma = Math.max(0.30, Math.min(0.82, hsl.s + (m - 0.5) * 0.26));
    const factor = CROMA_POR_ESTADO[libro.estado] ?? CROMA_POR_ESTADO['Pendiente'];

    // setHSL da un color en el espacio en el que se lea: se convierte a lineal
    // como cualquier otro hex de material (ver colorMaterial). Sin esa
    // conversión el 0.55 de arriba llegaba al material COMO lineal, o sea un
    // 0.77 en pantalla, y de ahí venía el aire de caramelo de toda la fila:
    // los lomos no eran tela ni cartoné, eran pastillas de colores.
    return new THREE.Color().setHSL(
        // Tono: ±32° alrededor del acento del tema. Estaba en ±18° y una
        // balda entera salía casi del mismo color; un estante de verdad es
        // mucho más desordenado. Con este margen la balda sigue leyéndose
        // como un tema, pero deja de parecer pintada de una sola lata.
        (hsl.h + (n - 0.5) * 0.18 + 1) % 1,
        croma * factor,
        // La luminosidad NO cambia con el ESTADO: lo único que separa un libro
        // leído de uno pendiente es el color. Si además variara el brillo, los
        // pendientes se hundirían en el fondo y dejarías de contarlos. Lo que
        // sí varía es por libro. El rango se lee ya como sRGB, que es lo que
        // parece: 0.30–0.62 es la tapa de tela de un libro bajo una lámpara.
        Math.max(0.30, Math.min(0.62, hsl.l * 0.92 + (n - 0.5) * 0.24))
    ).convertSRGBToLinear();
}

function colorEstado(estado) {
    if (estado === 'Leído') return token('--leido', '#37A06A');
    if (estado === 'Leyendo') return token('--leyendo', '#C07E24');
    return token('--pendiente', '#9184DC');
}

// ----------------------------------------
// Texturas
// ----------------------------------------
// Toda textura creada aquí se registra en `basura` para poder liberarla.

function vetaMadera(ctx, ancho, alto, claro, oscuro) {
    const grad = ctx.createLinearGradient(0, 0, 0, alto);
    grad.addColorStop(0, claro);
    grad.addColorStop(0.55, oscuro);
    grad.addColorStop(1, claro);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, ancho, alto);

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 70; i++) {
        const y = (i / 70) * alto + Math.sin(i * 12.9898) * 3;
        ctx.globalAlpha = 0.25 + (i % 5) * 0.08;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= ancho; x += 40) {
            ctx.lineTo(x, y + Math.sin((x + i * 37) * 0.012) * 2.4);
        }
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

// Rótulo de la balda: el nombre pintado en el PANEL TRASERO, en el hueco que
// queda por encima de los libros. Estuvo primero grabado en el canto de la
// tabla, que es donde iría en un mueble real, pero ese canto mide 1.6
// unidades sobre 74 de ancho — doce píxeles en pantalla — y el nombre no se
// leía. El panel de atrás mide 74x28 y está vacío: ahí sí cabe.
//
// Es texto en una textura, no en el DOM: por eso el espejo accesible de app.js
// no es opcional, es la única vía de este texto al teclado y al lector de
// pantalla.
function texturaTrasera(nombre, cuenta, acentoHex, ancho, alto) {
    // El lienzo copia la proporción de la cara, o el texto sale estirado.
    const lienzo = document.createElement('canvas');
    lienzo.width = 1024;
    lienzo.height = Math.max(64, Math.round((1024 * alto) / ancho));
    const ctx = lienzo.getContext('2d');
    const W = lienzo.width, H = lienzo.height;

    // El fondo del mueble es madera, no un agujero. Iba de un gris casi negro
    // y plano, y el resultado era que cada balda tenía detrás un rectángulo de
    // vacío: el estante se leía como cinco huecos recortados en la pared en
    // vez de como un mueble con trasera. Sigue siendo muy oscuro —el rótulo y
    // los lomos se apoyan encima y tienen que ganar— pero ya tiene veta.
    const hondo = new THREE.Color(token('--superficie-honda', '#100C09'));
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#' + hondo.clone().multiplyScalar(2.3).getHexString());
    g.addColorStop(1, '#' + hondo.getHexString());
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(214, 170, 120, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 46; i++) {
        const v = hashEstante('trasera|' + i);
        const x = v * W;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        for (let y = 0; y <= H; y += 12) {
            ctx.lineTo(x + Math.sin((y + v * 140) * 0.03) * 1.6, y);
        }
        ctx.stroke();
    }

    // Un halo cálido arriba a la izquierda: la misma dirección que la luz de
    // la escena, para que el panel no se lea como un recorte plano.
    const halo = ctx.createRadialGradient(W * 0.22, 0, 0, W * 0.22, 0, H * 1.5);
    halo.addColorStop(0, 'rgba(255, 214, 160, 0.16)');
    halo.addColorStop(1, 'rgba(255, 214, 160, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    const cuerpo = Math.round(H * 0.18);
    ctx.textBaseline = 'middle';
    ctx.font = '700 ' + cuerpo + 'px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillStyle = token('--tinta', '#E9E4DB');
    ctx.fillText(nombre, W * 0.035, H * 0.13, W * 0.72);

    const anchoNombre = Math.min(ctx.measureText(nombre).width, W * 0.72);
    ctx.font = '600 ' + Math.round(cuerpo * 0.72) + 'px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillStyle = acentoHex || token('--laton', '#BF8550');
    ctx.fillText(String(cuenta), W * 0.035 + anchoNombre + cuerpo * 0.45, H * 0.135);

    // Filete bajo el rótulo, del ancho del nombre
    ctx.globalAlpha = 0.5;
    ctx.fillRect(W * 0.035, H * 0.13 + cuerpo * 0.70, anchoNombre, Math.max(2, H * 0.006));
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(lienzo);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = ANISOTROPIA;
    return tex;
}

// Un tema de 52 libros generaba 156 lienzos por apertura, de los que 104 eran
// repetidos: el tejuelo solo tiene tres variantes posibles —una por estado— y
// el canto de hojas seis. Solo el rótulo del lomo es único por libro.
//
// La cache es de módulo y se vacía en destruir(), lo cual es correcto porque
// nunca hay dos escenas vivas a la vez (ver la regla del contexto único).
// Ranuras de textura que destruir() tiene que liberar en cada material.
const MAPAS_MATERIAL = ['map', 'bumpMap', 'normalMap', 'roughnessMap',
                        'metalnessMap', 'alphaMap', 'aoMap', 'emissiveMap'];

const CACHE_TEXTURAS = new Map();

function texturaCacheada(clave, fabrica) {
    let tex = CACHE_TEXTURAS.get(clave);
    if (!tex) {
        tex = fabrica();
        CACHE_TEXTURAS.set(clave, tex);
    }
    return tex;
}

function vaciarCacheTexturas() {
    CACHE_TEXTURAS.forEach(t => t.dispose());
    CACHE_TEXTURAS.clear();
}

// Canto de papel: estrías finas, irregulares y con el tono ligeramente
// variado. Sin esto la cara de hojas es un plano de color y a media distancia
// parece cartón cortado.
function texturaHojas(libro) {
    // El peine de estrías se cuantiza a seis variantes: a esta escala nadie
    // distingue más, y son seis lienzos en vez de cincuenta y dos.
    const variante = Math.floor(hashEstante(libro.id + '|hojas') * 6);
    return texturaCacheada('hojas:' + variante, () => construirTexturaHojas(variante));
}

function construirTexturaHojas(variante) {
    const lienzo = document.createElement('canvas');
    lienzo.width = 256;
    lienzo.height = 64;
    const ctx = lienzo.getContext('2d');

    const papel = new THREE.Color(token('--tinta-suave', '#928C81')).multiplyScalar(0.94);
    ctx.fillStyle = '#' + papel.getHexString();
    ctx.fillRect(0, 0, 256, 64);

    // Una estría por "hoja". La separación varía con el id, para que dos
    // libros contiguos no muestren el mismo peine.
    const paso = 1.5 + (variante / 6) * 1.6;
    for (let x = 0; x < 256; x += paso) {
        const t = (Math.sin(x * 12.9898) * 43758.5453) % 1;
        ctx.globalAlpha = 0.10 + Math.abs(t) * 0.16;
        ctx.fillStyle = '#4a3f33';
        ctx.fillRect(x, 0, 0.8, 64);
    }
    ctx.globalAlpha = 1;

    // Un punto de suciedad en el borde, que es donde se ensucian los libros
    const borde = ctx.createLinearGradient(0, 0, 0, 64);
    borde.addColorStop(0, 'rgba(74, 63, 51, 0.30)');
    borde.addColorStop(0.18, 'rgba(74, 63, 51, 0)');
    borde.addColorStop(0.82, 'rgba(74, 63, 51, 0)');
    borde.addColorStop(1, 'rgba(74, 63, 51, 0.30)');
    ctx.fillStyle = borde;
    ctx.fillRect(0, 0, 256, 64);

    const tex = new THREE.CanvasTexture(lienzo);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = ANISOTROPIA;
    return tex;
}

// Tejuelo de biblioteca: etiqueta mate, con borde, y el punto de color del
// estado. Reemplaza a la banda saturada que ocupaba el bajo del lomo.
function texturaTejuelo(estado) {
    return texturaCacheada('tejuelo:' + estado, () => construirTexturaTejuelo(estado));
}

function construirTexturaTejuelo(estado) {
    const lienzo = document.createElement('canvas');
    lienzo.width = 128;
    lienzo.height = 256;
    const ctx = lienzo.getContext('2d');
    ctx.clearRect(0, 0, 128, 256);

    // Papel de la etiqueta, ligeramente más claro que el lomo
    ctx.fillStyle = 'rgba(238, 230, 214, 0.94)';
    ctx.strokeStyle = 'rgba(60, 48, 36, 0.38)';
    ctx.lineWidth = 3;
    const r = 8;
    ctx.beginPath();
    ctx.moveTo(14 + r, 18);
    ctx.arcTo(114, 18, 114, 238, r);
    ctx.arcTo(114, 238, 14, 238, r);
    ctx.arcTo(14, 238, 14, 18, r);
    ctx.arcTo(14, 18, 114, 18, r);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // El punto de estado
    ctx.fillStyle = colorEstado(estado);
    ctx.beginPath();
    ctx.arc(64, 104, 34, 0, Math.PI * 2);
    ctx.fill();

    // Una raya bajo el punto, que insinúa la signatura sin competir con él
    ctx.fillStyle = 'rgba(60, 48, 36, 0.30)';
    ctx.fillRect(38, 176, 52, 7);

    const tex = new THREE.CanvasTexture(lienzo);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = ANISOTROPIA;
    return tex;
}

// Tabla de madera con veta. Usa vetaMadera(), que llevaba sin usarse desde
// que el rótulo del tema se mudó al panel trasero.
function texturaMadera(ancho, fondo) {
    const lienzo = document.createElement('canvas');
    lienzo.width = 1024;
    lienzo.height = Math.max(64, Math.round((1024 * fondo) / ancho));
    const ctx = lienzo.getContext('2d');

    vetaMadera(ctx, lienzo.width, lienzo.height,
               token('--madera-clara', '#6E492E'), token('--madera', '#4E301E'));

    const tex = new THREE.CanvasTexture(lienzo);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = ANISOTROPIA;
    return tex;
}

// Mancha suave para el oscurecimiento de contacto bajo la fila de libros.
function texturaSombraContacto() {
    const lienzo = document.createElement('canvas');
    lienzo.width = 64;
    lienzo.height = 64;
    const ctx = lienzo.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(0, 0, 0, 0)');
    g.addColorStop(0.55, 'rgba(0, 0, 0, 0.85)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);

    const tex = new THREE.CanvasTexture(lienzo);
    return tex;
}

// Lomo con título y autor. Solo se usa en el modal: en el muro los lomos van
// sin texto, que es lo que mantiene el gasto de texturas acotado (máximo 52
// libros a la vez, los del tema más grande, y no los 112 del catálogo).
function texturaLomo(libro, colorFondo) {
    const lienzo = document.createElement('canvas');
    // 128x512 es de sobra: un lomo se dibuja a unos 20px de ancho incluso en
    // el modal. A 256x1024 eran 1 MB por libro y 54 MB de GPU en un tema de
    // 52 — el título se recortaba por las UV del bisel, no por resolución.
    lienzo.width = 128;
    lienzo.height = 512;
    const ctx = lienzo.getContext('2d');

    // Fondo transparente: el color lo pone la tapa que hay debajo. Encima
    // van el degradado de curvatura, los filetes y el texto.
    ctx.clearRect(0, 0, 128, 512);

    // Umbral bajo a propósito: el mapa de curvatura oscurece algo el lomo
    // renderizado, así que un tono que en el color base parecía claro puede
    // no serlo en pantalla. Ante la duda, texto claro.
    const claro = colorFondo.getHSL({ h: 0, s: 0, l: 0 }).l > 0.52;
    const tinta = claro ? 'rgba(18,12,8,0.92)' : 'rgba(246,240,232,0.94)';

    // Filetes de latón arriba y abajo, como en una encuadernación
    ctx.fillStyle = token('--laton', '#BF8550');
    ctx.globalAlpha = 0.8;
    ctx.fillRect(16, 40, 96, 3);
    ctx.fillRect(16, 470, 96, 3);
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.translate(64, 256);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const titulo = String(libro.titulo || '').slice(0, 42);
    ctx.font = '700 34px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillStyle = tinta;
    ctx.fillText(titulo, 0, -12, 380);

    if (libro.autor) {
        ctx.font = '500 24px "Plus Jakarta Sans", system-ui, sans-serif';
        ctx.globalAlpha = 0.62;
        ctx.fillText(String(libro.autor).slice(0, 38), 0, 24, 380);
        ctx.globalAlpha = 1;
    }
    ctx.restore();

    const tex = new THREE.CanvasTexture(lienzo);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = ANISOTROPIA;
    return tex;
}

// ----------------------------------------
// Escena base
// ----------------------------------------
// Devuelve un pequeño contexto con render bajo demanda y un recolector de
// basura GPU. Lo comparten el muro y el modal.

function crearEscenaEstante(contenedor, opciones) {
    const opts = opciones || {};
    const basura = [];

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;

    // Sin tone mapping los brillos se recortan a blanco plano, que es la
    // marca de fábrica de un render. ACES los hace caer suave, como una
    // película. Es el cambio más barato con más efecto de todo el archivo.
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.86;

    ANISOTROPIA = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // position:absolute lo pone la hoja de estilos. Es lo que impide que el
    // canvas empuje a su contenedor y realimente al ResizeObserver.
    renderer.domElement.classList.add('estante-lienzo');
    contenedor.appendChild(renderer.domElement);

    const escena = new THREE.Scene();

    // Un material PBR sin mapa de entorno no tiene reflejo especular: todo
    // es difuso puro, y por eso la madera y la tela leían como plástico
    // mate. RoomEnvironment da un entorno de estudio sin descargar nada.
    let envMap = null;
    if (typeof THREE.RoomEnvironment === 'function') {
        const pmrem = new THREE.PMREMGenerator(renderer);
        const sala = new THREE.RoomEnvironment();
        envMap = pmrem.fromScene(sala, 0.05).texture;
        escena.environment = envMap;
        sala.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
        pmrem.dispose();
    } else {
        console.warn('[Estante] RoomEnvironment no cargó; el mueble se verá mate.');
    }

    // near y far son provisionales: los fija ajustarProfundidad() cuando ya
    // existen la escena y los controles, que es cuando se sabe cuanto puede
    // alejarse la camara y que hay detras. Un far fijo aqui es una bomba de
    // relojeria - ver esa funcion.
    const camara = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    camara.position.set(0, 0, 60);

    // Luz de lámpara: cálida, desde arriba a la izquierda, más un relleno
    // frío muy bajo para que las sombras no se cierren en negro.
    const ambiente = new THREE.AmbientLight(0xFFF1DC, 0.05);
    escena.add(ambiente);

    const lampara = new THREE.DirectionalLight(0xFFD9A8, 1.05);
    lampara.position.set(-20, 30, 54);
    lampara.castShadow = true;
    lampara.shadow.mapSize.set(2048, 2048);
    lampara.shadow.camera.near = 1;
    lampara.shadow.camera.far = 160;
    lampara.shadow.camera.left = -70;
    lampara.shadow.camera.right = 70;
    lampara.shadow.camera.top = 70;
    lampara.shadow.camera.bottom = -70;
    lampara.shadow.bias = -0.0012;
    // PCFSoft difumina, pero el radio es lo que quita el canto de cuchilla.
    lampara.shadow.radius = 4;
    escena.add(lampara);

    // Relleno frío de verdad, no un testimonial. Con la clave cálida sola,
    // toda la escena caía en la misma familia de marrones y se veía turbia:
    // lo que saca de ahí a una escena oscura es el contraste de temperatura,
    // luces ámbar contra sombras azuladas. Estaba a 0.09, o sea apagado.
    const relleno = new THREE.DirectionalLight(0x8FB4DC, 0.30);
    relleno.position.set(34, 6, 26);
    escena.add(relleno);

    // ---- render bajo demanda
    let pedido = false;
    let vivo = true;

    function dibujar() {
        pedido = false;
        if (!vivo) return;
        if (opts.antesDeDibujar) opts.antesDeDibujar();
        renderer.render(escena, camara);
    }

    function pedirRender() {
        if (pedido || !vivo) return;
        pedido = true;
        requestAnimationFrame(dibujar);
    }

    // ---- tamaño
    let ganchoResize = null;
    function redimensionar() {
        const caja = contenedor.getBoundingClientRect();
        const ancho = Math.max(1, Math.round(caja.width));
        const alto = Math.max(1, Math.round(caja.height));
        renderer.setSize(ancho, alto, false);
        camara.aspect = ancho / alto;
        camara.updateProjectionMatrix();
        if (ganchoResize) ganchoResize();
        pedirRender();
    }

    const observador = new ResizeObserver(redimensionar);
    observador.observe(contenedor);
    redimensionar();

    function registrar(objeto) {
        basura.push(objeto);
        return objeto;
    }

    // Libera TODO lo que la escena haya creado. Sin esto, cada re-render del
    // muro deja geometrías y texturas colgadas en la GPU.
    function destruir() {
        vivo = false;
        observador.disconnect();

        escena.traverse(obj => {
            // GEOM_CAJA la comparten todos los montajes: destruirla aquí dejaría
            // el siguiente muro sin geometría. Se libera solo lo propio.
            if (obj.geometry && obj.geometry !== GEOM_CAJA) obj.geometry.dispose();
            if (obj.material) {
                const materiales = Array.isArray(obj.material) ? obj.material : [obj.material];
                materiales.forEach(m => {
                    // No solo `map`: la tarima trae bumpMap, y quien añada un
                    // material con normal o rugosidad los dejaría colgados en
                    // la GPU sin que nada avise.
                    MAPAS_MATERIAL.forEach(k => { if (m[k]) m[k].dispose(); });
                    m.dispose();
                });
            }
        });
        vaciarCacheTexturas();
        if (envMap) envMap.dispose();
        basura.forEach(o => { if (o && typeof o.dispose === 'function') o.dispose(); });
        basura.length = 0;

        escena.clear();
        renderer.dispose();
        if (renderer.domElement.parentNode) {
            renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
    }

    function fijarGanchoResize(fn) { ganchoResize = fn; }

    // Recalcula el mapa de sombras una vez más y lo deja congelado. Girar la
    // cámara no cambia ninguna sombra —no se mueve nada en la escena—, así
    // que rehacerlo en cada fotograma del arrastre sería tirar el
    // presupuesto justo cuando hace falta fluidez. Quien mueva un objeto de
    // verdad (el tween de un libro) vuelve a pedirlo con needsUpdate.
    function congelarSombras() {
        lampara.shadow.autoUpdate = false;
        lampara.shadow.needsUpdate = true;
    }

    return { escena, camara, renderer, lampara, relleno, ambiente,
             pedirRender, redimensionar,
             registrar, destruir, fijarGanchoResize, congelarSombras };
}

// ----------------------------------------
// Órbita: girar e acercar
// ----------------------------------------
// Se mueve la cámara alrededor del mueble, no el mueble delante de la cámara.
// Además de ser lo que espera cualquiera en un visor 3D, tiene una
// consecuencia que decide el asunto: orbitando la cámara NADA se mueve en la
// escena, así que el mapa de sombras se puede congelar. Con el mueble girando
// bajo una luz fija habría que recalcularlo en cada fotograma del arrastre,
// con 2048² de mapa y un centenar de libros.
//
// El recorrido va limitado a propósito. Detrás hay una pared, así que el
// fondo está cubierto, pero el mueble en sí son tablas y un panel trasero
// por balda: no tiene laterales, ni techo, ni suelo. Pasando de unos 30° se
// empieza a ver que no es un mueble cerrado sino una fachada.

const LIMITES_ORBITA = {
    azimut: 0.52,                 // ±30°
    polarMin: Math.PI * 0.38,     // 20° por encima de la horizontal
    // Y hasta 36° por debajo, PERO este no suele ser el tope que manda: el
    // que manda es el suelo. Ver limitarInclinacion() en instalarNavegacion,
    // que baja este valor según lo lejos que esté la cámara, porque bajar la
    // vista es bajar la cámara y a cierta distancia eso la mete por debajo de
    // la tarima. Este número es solo el límite de diseño: cuánto se deja
    // picar hacia arriba el mueble cuando la cámara está lo bastante cerca
    // como para hacerlo sin atravesar el suelo.
    polarMax: Math.PI * 0.70,
    // Fracciones de la distancia encuadrada. 0.22 deja el encuadre en una
    // balda aproximadamente: acercarse a leer los lomos es media razón de
    // que exista el zoom, y con 0.55 te quedabas mirando el mueble entero.
    cerca: 0.22,
    // 1.6 dejaba llegar tan lejos que el mueble quedaba diminuto y empezaba
    // a verse el borde de la habitación. 1.25 es lo que cabe sin que la
    // escena se deshaga por fuera.
    lejos: 1.25
};

// La inercia es movimiento que el usuario no pidió: con movimiento reducido
// se apaga. El bloque de animations.css no llega hasta aquí, porque esto no
// lo mueve el CSS.
function sinInercia() {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function crearControles(camara, dom, centro, distancia) {
    if (typeof THREE.OrbitControls !== 'function') {
        console.warn('[Estante] OrbitControls no cargó; el mueble no se podrá girar.');
        return null;
    }

    const c = new THREE.OrbitControls(camara, dom);
    c.target.copy(centro);

    // El botón izquierdo NO mueve nada: solo selecciona. El desplazamiento
    // libre que tenía se sentía caótico —te ibas a cualquier lado y te
    // perdías—, y lo sustituye el parálax de montarMuro(), que sigue al
    // cursor unos grados y vuelve solo al centro.
    //
    // Sin paneo se sigue llegando a cualquier balda: la rueda acerca al
    // cursor y el nav de colecciones filtra.
    c.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: null
    };
    c.enablePan = false;
    c.rotateSpeed = 0.45;

    // Queda activo para el pellizco de dos dedos, que gestiona él. La rueda
    // la intercepta instalarNavegacion() antes de que llegue aquí, para
    // poder acercar al cursor y no al centro.
    c.enableZoom = true;
    c.zoomSpeed = 0.8;

    c.minDistance = distancia * LIMITES_ORBITA.cerca;
    c.maxDistance = distancia * LIMITES_ORBITA.lejos;
    c.minAzimuthAngle = -LIMITES_ORBITA.azimut;
    c.maxAzimuthAngle = LIMITES_ORBITA.azimut;
    c.minPolarAngle = LIMITES_ORBITA.polarMin;
    c.maxPolarAngle = LIMITES_ORBITA.polarMax;

    c.enableDamping = !sinInercia();
    c.dampingFactor = 0.09;

    // Un dedo desplaza —igual que el botón izquierdo—, dos dedos acercan y
    // giran. El shell es de 100dvh y no scrollea, así que el arrastre de un
    // dedo sobre el lienzo no le quita el scroll a nadie.
    // En táctil no hay hover, así que el parálax no llega: un dedo gira,
    // que es el equivalente más cercano a mirar el mueble desde un lado.
    if (THREE.TOUCH) {
        c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
    }

    c.update();
    return c;
}

// Navegación: desplazar, y acercar DONDE APUNTA EL CURSOR.
//
// OrbitControls acerca siempre hacia su `target`, es decir hacia el centro, lo
// que en un mueble ancho significa que para mirar de cerca una balda de la
// esquina tienes que acercarte al medio y luego arrastrar hasta ella. La
// versión de three que usamos (r147) no trae `zoomToCursor` —llegó después—,
// así que la rueda se maneja aquí.
//
// El truco es escalar la escena alrededor del punto que hay bajo el cursor:
// si cámara y target se acercan a ese punto en la misma proporción, el punto
// se queda clavado en pantalla y la distancia baja. Eso es exactamente lo que
// significa "acercar ahí".
function instalarNavegacion(contenedor, camara, escena, mueble, controles, alCambiar,
                            centroVista, yPiso) {
    if (!controles) return { limitar() {}, pasoZoom() { return false; }, destruir() {} };

    // Topes del paneo: la caja del MUEBLE con holgura. Medir la escena daría
    // los límites de la pared, que es enorme, y no sujetarían nada.
    const caja = new THREE.Box3().setFromObject(mueble);
    const holgura = caja.getSize(new THREE.Vector3()).multiplyScalar(0.12);
    const minTarget = caja.min.clone().sub(holgura);
    const maxTarget = caja.max.clone().add(holgura);

    // El centro del encuadre inicial, al que vuelve el zoom out. Lo pasa quien
    // monta la escena, porque desde que hay escenografía el encuadre mide más
    // que el estante: usar aquí el centro del mueble dejaría el reencuadre
    // desviado justo lo que la planta y la mesa descentran la vista. El
    // respaldo es la caja del mueble, para el modal, que no lleva decorado.
    const centroMueble = centroVista
        ? centroVista.clone()
        : caja.getCenter(new THREE.Vector3());

    const rayo = new THREE.Raycaster();
    const puntero = new THREE.Vector2();
    const plano = new THREE.Plane();
    const normal = new THREE.Vector3();
    const destino = new THREE.Vector3();
    const previo = new THREE.Vector3();
    const salto = new THREE.Vector3();

    // Mantiene el target dentro del mueble. La cámara se mueve el mismo delta
    // para que el encuadre no pegue un tirón: el paneo simplemente topa.
    function limitar() {
        previo.copy(controles.target);
        controles.target.clamp(minTarget, maxTarget);
        salto.subVectors(controles.target, previo);
        if (salto.lengthSq() > 0) camara.position.add(salto);
        limitarInclinacion();
    }

    // EL SUELO ES EL TOPE DE LA INCLINACIÓN, y tiene que serlo por distancia.
    //
    // Inclinar la vista hacia arriba es bajar la cámara: la altura del ojo es
    // `target.y + distancia · cos(phi)`, así que con phi pasado de 90° el
    // coseno se vuelve negativo y la cámara baja tanto más cuanto más lejos
    // esté. Con un tope fijo en grados hay que elegir entre dos males: o se
    // pone flojo y de cerca apenas se puede picar, o se pone suelto y al
    // alejarse la cámara acaba por debajo de la tarima. Y por debajo no hay
    // nada: el suelo es un PlaneGeometry de una cara, así que desde abajo
    // desaparece y se ve la habitación flotando sobre el vacío.
    //
    // Así que el tope no se fija en grados sino en ALTURA, y de ahí sale el
    // ángulo. De cerca se puede picar mucho; al alejarse, el tope se cierra
    // solo hacia la horizontal. Es el mismo criterio que limitar() aplica al
    // paneo: no se prohíbe el gesto, se topa donde dejaría de tener sentido.
    const ROCE_SUELO = Math.max(1.5, caja.getSize(new THREE.Vector3()).y * 0.02);
    const esfera = new THREE.Spherical();
    const desp = new THREE.Vector3();

    function limitarInclinacion() {
        if (typeof yPiso !== 'number') return;

        desp.subVectors(camara.position, controles.target);
        const radio = desp.length();
        if (radio < 1e-6) return;

        // Se busca el phi que deja el ojo justo a ras de tarima:
        //   yPiso + ROCE = target.y + radio · cos(phi)
        const coseno = (yPiso + ROCE_SUELO - controles.target.y) / radio;
        const phiSuelo = Math.acos(Math.min(1, Math.max(-1, coseno)));
        const tope = Math.min(LIMITES_ORBITA.polarMax, phiSuelo);

        controles.maxPolarAngle = tope;
        // Si el suelo aprieta más que el tope de picado hacia abajo, el mínimo
        // tiene que ceder: con min > max OrbitControls se queda atascado.
        controles.minPolarAngle = Math.min(LIMITES_ORBITA.polarMin, tope);

        // Y si ya se había pasado —típicamente por alejarse con la vista ya
        // inclinada, que alarga el radio y hunde la cámara sin que el ratón se
        // mueva—, se sube al tope conservando distancia y azimut. Se toca la
        // cámara directamente y no con update(), como hace limitar(): esto
        // corre DENTRO del handler de `change`, y llamar a update() ahí lo
        // volvería a disparar. OrbitControls recalcula sus esféricas desde
        // camara.position en cada update(), así que no se le descuadra nada.
        esfera.setFromVector3(desp);
        if (esfera.phi > tope) {
            esfera.phi = tope;
            desp.setFromSpherical(esfera);
            camara.position.copy(controles.target).add(desp);
            // Aquí sí hace falta reorientar: limitar() puede saltarse este paso
            // porque mueve cámara y target el mismo delta y la dirección no
            // cambia, pero esto es un giro.
            camara.lookAt(controles.target);
        }
    }

    // ---- zoom suave
    //
    // La rueda no mueve la cámara: apunta el factor que queda por aplicar y lo
    // reparte el bucle de animación en varias rebanadas. Antes cada muesca
    // aplicaba su 14% de golpe y el acercamiento iba a saltos.
    //
    // Se puede trocear así porque las DOS ramas del zoom son escalados
    // multiplicativos alrededor de un punto —el cursor al acercarse, el target
    // al alejarse—, y una escala es el producto de sus partes: aplicar el
    // factor entero o N rebanadas de `factor^(1/N)` lleva exactamente al mismo
    // sitio. El recentrado del zoom out también sobrevive al troceo, y por la
    // misma razón que sobrevive a encadenar muescas: su producto telescopia
    // (ver el comentario largo más abajo).
    //
    // `zoomPendiente` es lo que queda por hacer. Se acumula entre muescas, así
    // que girar rápido no se queda corto, y mezclar direcciones se cancela
    // solo, que es lo que uno espera.
    let zoomPendiente = 1;
    const anclaZoom = new THREE.Vector3();

    // Cuánto del recorrido que queda se hace en cada fotograma, en escala
    // logarítmica: 0.22 deja el 78% para el siguiente, así que a 60 fps el
    // grueso del viaje se hace en unos diez fotogramas (~170 ms). Con
    // movimiento reducido no hay rebanadas: se aplica entero y ya.
    const SUAVIDAD_ZOOM = sinInercia() ? 1 : 0.22;

    // Tope de acumulación. El rango de distancia es 0.22×–1.25× de la
    // encuadrada, o sea menos de 6× de punta a punta: guardar más pendiente
    // que eso solo sirve para que la rueda siga corriendo después de haber
    // llegado al tope.
    const ZOOM_MAX_PENDIENTE = 6;

    function alRueda(evento) {
        evento.preventDefault();
        // En fase de captura sobre el contenedor: así el listener propio de
        // OrbitControls, que está en el canvas, no llega a verlo. Su zoom
        // sigue activo para el pellizco de dos dedos, que sí gestiona él.
        evento.stopPropagation();

        const c = contenedor.getBoundingClientRect();
        puntero.x = ((evento.clientX - c.left) / c.width) * 2 - 1;
        puntero.y = -((evento.clientY - c.top) / c.height) * 2 + 1;
        rayo.setFromCamera(puntero, camara);

        // Punto bajo el cursor: lo primero que toque el rayo. Si el cursor
        // está sobre el vacío, un plano que pasa por el target.
        const golpes = rayo.intersectObjects(escena.children, true);
        if (golpes.length) {
            anclaZoom.copy(golpes[0].point);
        } else {
            camara.getWorldDirection(normal);
            plano.setFromNormalAndCoplanarPoint(normal, controles.target);
            if (!rayo.ray.intersectPlane(plano, anclaZoom)) return;
        }

        const paso = evento.deltaY < 0 ? 0.86 : 1 / 0.86;
        zoomPendiente = Math.min(ZOOM_MAX_PENDIENTE,
                                 Math.max(1 / ZOOM_MAX_PENDIENTE, zoomPendiente * paso));
        alCambiar?.();
    }

    // Una rebanada del zoom pendiente. La llama el bucle de animación una vez
    // por fotograma y devuelve si queda trabajo.
    //
    // Que el ancla se guarde y el escalado se aplique sobre la posición ACTUAL
    // de la cámara es lo que hace que girar mientras el zoom viaja no rompa
    // nada: cada fotograma escala desde donde esté la cámara en ese momento.
    // Umbral de convergencia. Parece un detalle y no lo es: lo que quede sin
    // aplicar al cortar se TIRA, y como cada muesca arranca de la distancia
    // real, el error no se compensa — se acumula muesca a muesca. A 0.002 eran
    // dos por mil por gesto, que en veinte muescas ya es un 4% de distancia
    // perdido. Las últimas rebanadas no se ven, así que sale gratis apretarlo.
    const ZOOM_EPSILON = 0.0005;

    function pasoZoom() {
        if (Math.abs(zoomPendiente - 1) < ZOOM_EPSILON) {
            zoomPendiente = 1;
            return false;
        }

        const distancia = camara.position.distanceTo(controles.target);
        if (distancia <= 0) { zoomPendiente = 1; return false; }

        const trozo = Math.pow(zoomPendiente, SUAVIDAD_ZOOM);
        const deseada = distancia * trozo;
        const nueva = Math.min(Math.max(deseada, controles.minDistance),
                               controles.maxDistance);
        const factor = nueva / distancia;

        // TOPAR Y CONVERGER SON COSAS DISTINTAS, y confundirlas costaba
        // precisión: el corte estaba puesto sobre `factor`, que es la rebanada,
        // y una rebanada es solo el 22% del pendiente en logaritmos — así que
        // se daba por terminado cuatro veces y media antes de tiempo y tiraba
        // un 0.2% del recorrido en cada gesto.
        //
        // Se mira si el tope ha recortado la rebanada, que es la única razón
        // de verdad para descartar lo que quede: no tiene a dónde ir.
        if (nueva !== deseada) zoomPendiente = 1;
        else zoomPendiente /= trozo;

        if (Math.abs(factor - 1) < 1e-7) return false;   // ya estaba en el tope

        if (factor > 1) {
            // ALEJARSE RECENTRA. Escalar también aquí alrededor del cursor
            // amplificaba la desviación respecto del centro: te alejabas y el
            // mueble se iba quedando a un lado, cada vez más descuadrado.
            //
            // Así que el zoom out se parte en dos: un dolly puro —la cámara se
            // retira del target, que no se mueve— y una vuelta del target al
            // centro del mueble.
            //
            // El factor de vuelta es lo que queda de recorrido después del paso
            // dividido por lo que quedaba antes. Al encadenar pasos el
            // producto se telescopia y la desviación acaba valiendo
            // `inicial · (tope − distancia) / (tope − distancia inicial)`: un
            // desvanecido lineal en la distancia, sin tirones, y exactamente
            // cero al llegar al tope. Es decir, el encuadre inicial. Eso vale
            // igual para muescas enteras que para las rebanadas de aquí, que
            // es lo que permite suavizar el zoom sin tocar esta cuenta.
            const quedaba = controles.maxDistance - distancia;
            const queda = controles.maxDistance - nueva;
            const vuelta = quedaba > 1e-6 ? Math.max(0, queda / quedaba) : 0;

            camara.position.sub(controles.target).multiplyScalar(factor).add(controles.target);

            previo.copy(controles.target);
            controles.target.sub(centroMueble).multiplyScalar(vuelta).add(centroMueble);
            // La cámara acompaña al target el mismo delta: el recentrado es un
            // desplazamiento del encuadre, no un giro.
            camara.position.add(salto.subVectors(controles.target, previo));
        } else {
            camara.position.sub(anclaZoom).multiplyScalar(factor).add(anclaZoom);
            controles.target.sub(anclaZoom).multiplyScalar(factor).add(anclaZoom);
        }

        limitar();
        // El fotograma se pinta igual aunque esto devuelva false: el bucle
        // renderiza y DESPUÉS mira las banderas.
        return zoomPendiente !== 1;
    }

    // El botón central dispara el autoscroll de Chrome —el widget de las
    // cuatro flechas—, que se comería el arrastre de giro. OrbitControls no
    // lo frena: no llama a preventDefault en pointerdown. Va en captura
    // para llegar antes que nadie; prevenir el pointerdown suprime además
    // el mousedown de compatibilidad, que es el que lo desencadena.
    function alBajarCentral(evento) {
        if (evento.button === 1) evento.preventDefault();
    }

    contenedor.addEventListener('wheel', alRueda, { passive: false, capture: true });
    contenedor.addEventListener('pointerdown', alBajarCentral, { capture: true });

    return {
        limitar,
        pasoZoom,
        destruir() {
            contenedor.removeEventListener('wheel', alRueda, { capture: true });
            contenedor.removeEventListener('pointerdown', alBajarCentral, { capture: true });
        }
    };
}

// ----------------------------------------
// Vista persistida del muro
// ----------------------------------------
// renderizarLibros() desmonta y reconstruye el muro entero en cada tecla del
// buscador, en cada filtro y al cerrar una balda. Sin guardar el ángulo, girar
// el mueble y teclear una letra lo devolvería al frente.
//
// Se guarda en esféricas y con la distancia como FRACCIÓN de la encuadrada,
// no en absoluto: el encuadre depende de cuántas baldas quedan visibles, y al
// filtrar el mueble se hace más pequeño.

let vistaMuro = null;   // { theta, phi, fraccion }

function guardarVistaMuro(camara, controles, centro, distancia) {
    const objetivo = controles ? controles.target : centro;
    const esf = new THREE.Spherical().setFromVector3(
        new THREE.Vector3().subVectors(camara.position, objetivo)
    );
    vistaMuro = {
        theta: esf.theta,
        phi: esf.phi,
        fraccion: distancia > 0 ? esf.radius / distancia : 1,
        // Hacia dónde se ha desplazado, también en fracciones: si el filtro
        // deja menos baldas el mueble encoge y un desplazamiento en unidades
        // absolutas apuntaría a otro sitio.
        desvio: distancia > 0
            ? new THREE.Vector3().subVectors(objetivo, centro).divideScalar(distancia)
            : new THREE.Vector3()
    };
}

function aplicarVistaMuro(camara, controles, centro, distancia) {
    if (!vistaMuro) return false;

    const objetivo = centro.clone().add(
        (vistaMuro.desvio || new THREE.Vector3()).clone().multiplyScalar(distancia)
    );
    const esf = new THREE.Spherical(
        distancia * vistaMuro.fraccion,
        vistaMuro.phi,
        vistaMuro.theta
    );
    camara.position.setFromSpherical(esf).add(objetivo);
    camara.lookAt(objetivo);
    if (controles) controles.target.copy(objetivo);
    return true;
}

function olvidarVistaMuro() {
    vistaMuro = null;
}

// Encuadra la camara sobre lo que HAY en la escena, no sobre cuantas baldas
// se pidieron: los libros sobresalen por encima de su tabla, asi que contar
// filas dejaba la primera balda fuera de cuadro.
// El mapa de entorno se aplica a tope por defecto y aplana el contraste. Lo
// que queremos de él es el reflejo especular, no que haga de segunda lámpara,
// así que se baja en todos los materiales de una pasada.
const FUERZA_ENTORNO = 0.30;

function ajustarEntorno(escena) {
    escena.traverse(obj => {
        if (!obj.material) return;
        const materiales = Array.isArray(obj.material) ? obj.material : [obj.material];
        materiales.forEach(m => {
            // Quien se haya fijado su propio nivel manda: esta pasada corre
            // después de construir la habitación y le pisaba el suyo.
            if (m.userData?.entornoFijo) return;
            if ('envMapIntensity' in m) {
                m.envMapIntensity = FUERZA_ENTORNO;
                m.needsUpdate = true;
            }
        });
    });
}

// Plano de recorte lejano, calculado y no fijado a mano.
//
// La camara nacia con far = 500. Iba sobrada mientras el encuadre solo media
// el estante: el tope de alejamiento eran 344 unidades. Al entrar la
// escenografia en el encuadre, la distancia ajustada subio a 428 y el tope a
// 535 - por delante del plano de recorte. El resultado no era un error ni un
// hueco: el mueble, la pared y la mesa sencillamente DESAPARECIAN al llegar al
// tope del zoom out, como si la escena se borrara.
//
// (Las esquinas de la pared ya se recortaban antes de la escenografia, porque
// girada a 30 grados la esquina visible cae a unas 700 unidades del ojo. Nadie
// lo vio nunca porque la pared es casi negra sobre fondo negro.)
//
// Asi que far sale de lo que hay: el alejamiento maximo que permiten los
// controles mas el radio de la escena entera. Y de paso sube `near`, que a 0.1
// desperdiciaba casi todo el buffer de profundidad en un espacio donde nada se
// acerca a menos de decenas de unidades; el margen que gana es lo que evita
// que dos lomos pegados empiecen a parpadear uno sobre otro.
function ajustarProfundidad(camara, controles, escena) {
    const esfera = cajaDe(escena).getBoundingSphere(new THREE.Sphere());
    const lejos = controles ? controles.maxDistance
                            : camara.position.distanceTo(esfera.center);

    camara.far = lejos + esfera.radius * 1.1 + 50;
    camara.near = controles ? Math.max(0.5, controles.minDistance * 0.04) : 0.1;
    camara.updateProjectionMatrix();
}

// Caja envolvente de uno o de varios objetos. Existe porque el encuadre pasó
// a medir el mueble MÁS la escenografía: sin sumar la planta y la mesa, la
// cámara encuadra solo el estante y las deja fuera de cuadro.
function cajaDe(objeto) {
    const caja = new THREE.Box3();
    (Array.isArray(objeto) ? objeto : [objeto]).forEach(o => {
        if (o) caja.expandByObject(o);
    });
    return caja;
}

function encuadrarEscena(camara, objeto, margen) {
    // OJO: mide el MUEBLE y la escenografía, NUNCA la escena. Pared y suelo
    // son telón: medirlos dispararía la caja envolvente y la cámara se iría
    // hasta dejar el mueble del tamaño de un sello.
    const caja = cajaDe(objeto);
    if (caja.isEmpty()) return { centro: new THREE.Vector3(), dist: 60 };

    const centro = caja.getCenter(new THREE.Vector3());
    const tam = caja.getSize(new THREE.Vector3());
    const fov = (camara.fov * Math.PI) / 180;

    // Se toma la restriccion mas exigente de las dos: alto o ancho. Sin la
    // de ancho, una ventana estrecha corta el mueble por los lados.
    const porAlto = (tam.y / 2) / Math.tan(fov / 2);
    const porAncho = (tam.x / 2) / Math.tan(fov / 2) / Math.max(0.2, camara.aspect);
    const dist = Math.max(porAlto, porAncho) * (margen || 1.12) + tam.z;

    camara.position.set(centro.x, centro.y, centro.z + dist);
    camara.lookAt(centro);
    camara.updateProjectionMatrix();
    return { centro, dist };
}

// ----------------------------------------
// La habitación
// ----------------------------------------
// Pared y suelo. Lo que más aportan no son los planos en sí, sino que el
// mueble por fin proyecte su sombra sobre algo: sin nada detrás ni debajo, un
// objeto no parece estar en ningún sitio, parece recortado.
//
// Van a la escena, NO al grupo `mueble`. Quien los meta dentro del mueble
// romperá el encuadre de cámara y los topes del paneo, que miden esa caja.

// El POZO DE LUZ, que es lo que faltaba para que esto fuera un cuarto.
//
// Una luz direccional no tiene caída: ilumina igual el metro de pared que hay
// detrás del mueble que el que hay a trescientas unidades. Con la pared
// pintada de un color plano el resultado era un vacío negro uniforme de
// horizonte a horizonte, y NINGÚN detalle del mueble arregla eso — el ojo lee
// primero el fondo, y un fondo sin gradiente dice "esto es un render" antes de
// que dé tiempo a mirar la carpintería.
//
// Así que la caída va pintada. La pared mide mil unidades, está centrada en el
// mueble y no se mide nunca para nada, así que el óvalo cae justo detrás del
// estante y las esquinas se cierran solas. Cuesta un lienzo y ni una luz más.
//
// Se usa dos veces, con distinto tamaño: en la pared y en el suelo (ver
// penumbraSuelo). Es el mismo fenómeno visto en dos planos.
function pintarPozo(ctx, W, H, cx, cy, radio, ensanche, calidez, cierre) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(ensanche, 1);

    // El halo cálido: la lámpara devolviendo luz sobre la pared.
    if (calidez > 0) {
        const pozo = ctx.createRadialGradient(0, 0, 0, 0, 0, radio);
        pozo.addColorStop(0, 'rgba(255, 206, 148, ' + calidez.toFixed(3) + ')');
        pozo.addColorStop(0.42, 'rgba(255, 194, 138, ' + (calidez * 0.34).toFixed(3) + ')');
        pozo.addColorStop(1, 'rgba(255, 188, 132, 0)');
        ctx.fillStyle = pozo;
        ctx.fillRect(-W, -H, W * 2, H * 2);
    }

    // Y el cierre: fuera del halo cae a negro. Esto es lo que hace que la
    // habitación TERMINE en algún sitio en vez de seguir hasta el borde del
    // encuadre con el mismo tono.
    const sombra = ctx.createRadialGradient(0, 0, radio * 0.34, 0, 0, radio * 1.9);
    sombra.addColorStop(0, 'rgba(0, 0, 0, 0)');
    sombra.addColorStop(0.55, 'rgba(0, 0, 0, ' + (cierre * 0.45).toFixed(3) + ')');
    sombra.addColorStop(1, 'rgba(0, 0, 0, ' + cierre.toFixed(3) + ')');
    ctx.fillStyle = sombra;
    ctx.fillRect(-W, -H, W * 2, H * 2);
    ctx.restore();
}

// La pared es de PANELES MOLDURADOS, y pasar de un color plano a esto obligó a
// reorganizar cómo se ilumina, así que conviene entender el porqué.
//
// Un plano de mil unidades pintado con UNA textura estirada da, a 512 píxeles,
// unas dos unidades por téxel: suficiente para un degradado, ridículo para una
// moldura. Y subir la textura hasta que la moldura sea nítida significa 2048²
// —16 MB de GPU para el telón de fondo, más que todo el resto de la escena
// junta— cuando lo único que hay que repetir es un entrepaño.
//
// Así que el mosaico vuelve: un entrepaño en 256×512 que se repite, con lo cual
// cada téxel mide un cuarto de unidad y la moldura sale limpia.
//
// El precio es que el POZO DE LUZ ya no cabe aquí. Repetido catorce veces
// serían catorce pozos. Se muda a su propio plano —velo(), delante de la
// pared—, que es exactamente el mismo recurso que penumbraSuelo() y que
// sombraDeContacto(). Y el halo cálido que llevaba se elimina del todo: cuando
// se pintó no había lámpara en la escena. Ahora la hay, y da un pozo de luz de
// verdad, con su caída y su color, que es mejor que cualquier cosa pintada.
//
// La luz de las molduras está HORNEADA (canto superior e izquierdo claros,
// inferior y derecho oscuros) y eso es correcto, no un atajo: la pared no se
// mueve, la clave no se mueve y viene de arriba a la izquierda. Quien cambie la
// dirección de la lámpara tiene que venir aquí a darle la vuelta.
function texturaPared(colorBase) {
    const W = 256, H = 512;
    const lienzo = document.createElement('canvas');
    lienzo.width = W;
    lienzo.height = H;
    const ctx = lienzo.getContext('2d');

    const base = new THREE.Color(colorBase || token('--pared', '#13120F'));
    const tono = k => '#' + base.clone().multiplyScalar(k).getHexString();

    ctx.fillStyle = tono(0.88);
    ctx.fillRect(0, 0, W, H);

    // Grano de yeso sobre el fondo, con el mismo repertorio de dos escalas que
    // el relieve. Aquí en color y muy tenue: solo para que el entrepaño no sea
    // un valor constante.
    for (let i = 0; i < 300; i++) {
        const a = hashEstante('parGrano|' + i);
        const b = hashEstante('parGrano|b|' + i);
        ctx.fillStyle = a > 0.5 ? 'rgba(255,240,220,0.022)' : 'rgba(0,0,0,0.03)';
        ctx.fillRect(a * W, b * H, 3 + a * 26, 2 + b * 5);
    }

    // El entrepaño: un rectángulo hundido con su moldura alrededor. Se dibuja
    // como cuatro biseles, no como un marco de una pieza, porque lo que hace
    // que una moldura se lea es que sus cuatro cantos NO sean iguales.
    const MX = W * 0.14, MY = H * 0.085;
    const x0 = MX, y0 = MY, x1 = W - MX, y1 = H - MY;
    const g = 5;                                  // ancho del bisel

    ctx.fillStyle = tono(0.66);                   // el fondo del entrepaño, hundido
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);

    ctx.fillStyle = tono(0.30);                   // canto de arriba: en sombra
    ctx.fillRect(x0 - g, y0 - g, x1 - x0 + g * 2, g);
    ctx.fillStyle = tono(0.40);                   // izquierda: casi rasante
    ctx.fillRect(x0 - g, y0 - g, g, y1 - y0 + g * 2);
    ctx.fillStyle = tono(1.45);                   // abajo: de cara a la luz
    ctx.fillRect(x0 - g, y1, x1 - x0 + g * 2, g);
    ctx.fillStyle = tono(1.25);                   // derecha
    ctx.fillRect(x1, y0 - g, g, y1 - y0 + g * 2);

    // Y un filete fino por dentro, que es lo que separa una moldura de un
    // escalón. Media unidad de ancho en el mundo.
    ctx.strokeStyle = tono(1.05);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x0 + g * 1.2, y0 + g * 1.2,
                   x1 - x0 - g * 2.4, y1 - y0 - g * 2.4);

    const tex = new THREE.CanvasTexture(lienzo);
    tex.encoding = THREE.sRGBEncoding;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = ANISOTROPIA;
    return tex;
}

// El velo: el pozo de luz y el cierre a negro, en un plano transparente por
// delante de la pared. Antes iban pintados dentro de la textura de la pared;
// salieron de ahí cuando la pared pasó a repetirse en mosaico, porque una
// viñeta repetida catorce veces son catorce viñetas. Es el mismo recurso que
// penumbraSuelo(), y por el mismo motivo.
function veloPared(ancho, alto) {
    const clave = 'velo-pared|' + Math.round(ancho) + 'x' + Math.round(alto);
    const tex = texturaCacheada(clave, () => {
        const L = 512;
        const lienzo = document.createElement('canvas');
        lienzo.width = L;
        lienzo.height = L;
        const ctx = lienzo.getContext('2d');
        ctx.clearRect(0, 0, L, L);
        // Sin calidez: la da la lámpara, que ahora es una luz de verdad.
        pintarPozo(ctx, L, L, L * 0.46, L * 0.34, L * 0.30, 1.5, 0, 0.96);
        const t = new THREE.CanvasTexture(lienzo);
        t.anisotropy = ANISOTROPIA;
        return t;
    });

    return new THREE.Mesh(
        new THREE.PlaneGeometry(ancho, alto),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
}

// Grano de yeso. Va de bumpMap y no de map, por una razón de escala: el mapa
// de color se estira una sola vez sobre mil unidades de pared, así que
// cualquier detalle fino pintado ahí saldría del tamaño de una mesa. El
// relieve sí puede ir en mosaico, porque el grano no tiene dibujo que delate
// la repetición.
//
// Lo que aporta no es verse: es que la pared deje de ser un valor constante y
// el rasante de la lámpara la recorra. Una pared perfectamente lisa no existe.
function texturaGranoPared() {
    return texturaCacheada('pared-grano', () => {
        const L = 128;
        const lienzo = document.createElement('canvas');
        lienzo.width = L;
        lienzo.height = L;
        const ctx = lienzo.getContext('2d');

        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, L, L);

        // Dos escalas y nada más: llaneado —manchas largas y tendidas, como
        // pasa una espátula— y picado.
        //
        // La primera versión llevaba encima un ruido por píxel, y estaba mal
        // por los dos lados. Costaba 12 ms de getImageData/putImageData sobre
        // 256², y esto se reconstruye en CADA montaje, o sea en cada pulsación
        // de tecla del buscador, porque renderizarLibros() desmonta y vuelve a
        // montar. Y además no se veía: con el mosaico repitiendo 22 veces
        // sobre mil unidades de pared, un texel caía por debajo del píxel de
        // pantalla. Eran doce milisegundos por fotograma de ruido invisible.
        //
        // El mosaico ahora repite mucho menos (8×6), que es lo que pone el
        // grano al tamaño en que se ve, y todo se dibuja con el canvas 2D.
        const mancha = (n, largoMin, largoVar, altoVar, alfa) => {
            for (let i = 0; i < n; i++) {
                const h = hashEstante('yeso|' + n + '|' + i);
                const k = hashEstante('yeso|b|' + n + '|' + i);
                ctx.save();
                ctx.translate(h * L, k * L);
                ctx.rotate((k - 0.5) * 0.8);
                ctx.fillStyle = h > 0.5
                    ? 'rgba(255, 255, 255, ' + alfa + ')'
                    : 'rgba(0, 0, 0, ' + alfa + ')';
                ctx.fillRect(0, 0, largoMin + h * largoVar, 1 + k * altoVar);
                ctx.restore();
            }
        };

        mancha(70, 14, 44, 7, 0.07);    // llaneado
        mancha(420, 1, 3, 2, 0.10);     // picado

        const tex = new THREE.CanvasTexture(lienzo);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(8, 6);
        tex.anisotropy = ANISOTROPIA;
        return tex;
    });
}

// Máscara horizontal para las piezas largas del decorado: blanca en el centro
// y negra en los extremos. Va de `map`, que MULTIPLICA al color, así que los
// extremos se apagan solos.
//
// Existe por el rodapié: es un listón de mil unidades bajo una luz sin caída,
// o sea una raya clara que cruzaría el encuadre de lado a lado por muy oscura
// que fuese. Con esto se desvanece a la vez que la pared que tiene detrás.
function texturaDesvanecida() {
    return texturaCacheada('desvanecido', () => {
        const lienzo = document.createElement('canvas');
        lienzo.width = 512;
        lienzo.height = 4;
        const ctx = lienzo.getContext('2d');
        const g = ctx.createLinearGradient(0, 0, 512, 0);
        g.addColorStop(0, '#000000');
        g.addColorStop(0.32, '#242424');
        g.addColorStop(0.5, '#ffffff');
        g.addColorStop(0.68, '#242424');
        g.addColorStop(1, '#000000');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 512, 4);

        const tex = new THREE.CanvasTexture(lienzo);
        tex.encoding = THREE.sRGBEncoding;
        return tex;
    });
}

// Penumbra del suelo: el mismo pozo de luz de la pared, tumbado.
//
// No se puede pintar dentro de la tarima porque esa textura va en mosaico
// —repite 26 veces— y una viñeta repetida 26 veces son 26 viñetas. Así que va
// en un plano aparte, justo encima, con el centro transparente: el mismo
// recurso que sombraDeContacto() usa bajo cada fila de libros.
//
// El plano calca tamaño y sitio del suelo para que no haya un canto donde la
// penumbra se acabe. Y como el suelo arranca en la pared y se extiende HACIA
// el espectador, el claro no va en el centro del lienzo sino pegado al borde
// de atrás, que es donde está el mueble: con rotation.x = -90° la v=1 del
// plano cae sobre la pared y la v=0 queda detrás de la cámara.
function penumbraSuelo(lado, vDelMueble) {
    const clave = 'penumbra-suelo|' + Math.round(vDelMueble * 1000);
    const tex = texturaCacheada(clave, () => {
        const L = 1024;
        const lienzo = document.createElement('canvas');
        lienzo.width = L;
        lienzo.height = L;
        const ctx = lienzo.getContext('2d');
        ctx.clearRect(0, 0, L, L);
        // El lienzo se lee con la v hacia arriba, así que el borde de la pared
        // (v=1) es y=0 en píxeles.
        pintarPozo(ctx, L, L, L * 0.5, L * (1 - vDelMueble), L * 0.12, 2.1, 0, 0.94);
        const t = new THREE.CanvasTexture(lienzo);
        t.anisotropy = ANISOTROPIA;
        return t;
    });

    const plano = new THREE.Mesh(
        new THREE.PlaneGeometry(lado, lado),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    plano.rotation.x = -Math.PI / 2;
    plano.renderOrder = 1;
    return plano;
}

function construirHabitacion(escena, mueble, lampara, escenografia) {
    const caja = new THREE.Box3().setFromObject(mueble);
    const tam = caja.getSize(new THREE.Vector3());
    const centro = caja.getCenter(new THREE.Vector3());

    // Lo que la cámara llega a encuadrar: mueble más escenografía. La pared y
    // el frustum de sombra se dimensionan sobre ESTO y no sobre el estante
    // solo, porque al sumar la planta y la mesa el encuadre se aleja y lo que
    // antes sobraba deja de sobrar.
    const tamVista = cajaDe(escenografia ? [mueble, escenografia] : mueble)
        .getSize(new THREE.Vector3());

    // La pared va a todo lo ancho. El caso exigente no es el encuadre inicial
    // sino el peor: cámara al máximo alejamiento (1.6× la distancia
    // encuadrada, unas 400 unidades) Y girada al tope de ±30°. Ahí la cámara
    // se desplaza lateralmente 400·sen(30°) ≈ 200, y todavía ve unas 140 más
    // hacia ese lado: el punto visible más lejano cae a ~340 del centro.
    //
    // Con 7× el ancho del mueble la semianchura era 260 y asomaba el negro.
    // Un plano son dos triángulos, así que pasarse no cuesta nada y quedarse
    // corto se ve al instante.
    const ancho = Math.max(tamVista.x * 8, tam.x * 14, 1000);
    const alto = Math.max(tam.y * 5, 750);

    // Se comparte entre pared y suelo: los dos enmarcan y ninguno compite con
    // el mueble.
    const acabado = extra => Object.assign({
        roughness: 0.94,
        metalness: 0,
        // ajustarEntorno() corre después de esto y pondría el entorno al nivel
        // del resto, encendiendo la pared más que el propio mueble. La marca
        // es lo que hace que respete este valor.
        envMapIntensity: 0.12,
        userData: { entornoFijo: true }
    }, extra);

    // Cuántos entrepaños entran. Se fija por ANCHO DE MUNDO, no por un número
    // de repeticiones: el plano crece con la escenografía, y un recuento fijo
    // haría que los paneles se estiraran cada vez que se añade algo a la
    // escena. Un entrepaño de unas 68 unidades es aproximadamente el ancho del
    // mueble, que es la escala a la que la pared acompaña en vez de competir.
    const ANCHO_PANEL = 54;
    const mapaPared = texturaPared(token('--pared', '#13120F'));
    mapaPared.repeat.set(Math.max(2, Math.round(ancho / ANCHO_PANEL)),
                         Math.max(1, Math.round(alto / (ANCHO_PANEL * 2.2))));

    const pared = new THREE.Mesh(
        new THREE.PlaneGeometry(ancho, alto),
        new THREE.MeshStandardMaterial(acabado({
            map: mapaPared,
            bumpMap: texturaGranoPared(),
            bumpScale: 0.7
        }))
    );
    const zPared = caja.min.z - 10;
    pared.position.set(centro.x, centro.y, zPared);
    pared.receiveShadow = true;
    escena.add(pared);

    // El velo, medio paso por delante: apaga la pared hacia las esquinas para
    // que la habitación termine en algún sitio.
    const velo = veloPared(ancho, alto);
    velo.position.set(centro.x, centro.y, zPared + 0.5);
    velo.renderOrder = 1;
    escena.add(velo);

    // Un plano horizontal recibe la luz cenital casi de frente, mientras que
    // la pared la recibe rasante: con el mismo color, el suelo sale mucho más
    // encendido y vuelve a leerse como una repisa clara. Se compensa
    // oscureciéndolo aparte, no bajando la luz de toda la escena.
    //
    // Su borde trasero ENCAJA con la pared. Antes arrancaba por delante del
    // mueble y quedaba una rendija entre los dos planos: de cerca no se veía,
    // pero al alejarse aparecía el canto y la habitación se deshacía en dos
    // losas sueltas.
    //
    // Y el mueble se APOYA en él. Flotaba 42 unidades por encima, que era un
    // apaño de cuando no tenía patas; ahora las tiene y tienen que tocar algo.
    //
    // Y es tarima, no un plano de color: duelas a matajunta con veta, nudos y
    // la junta hundida por bumpMap. El plano liso delataba la escena entera
    // —el mueble estaba trabajado y se apoyaba sobre nada.
    const mapasSuelo = texturasSuelo();
    const suelo = new THREE.Mesh(
        new THREE.PlaneGeometry(ancho, ancho),
        new THREE.MeshStandardMaterial(acabado({
            map: mapasSuelo.color,
            bumpMap: mapasSuelo.relieve,
            bumpScale: 0.6,
            // El `map` ya trae el color de la madera; esto solo lo baja. Un
            // plano horizontal recibe la clave casi de frente, y a pleno color
            // la tarima se enciende más que el mueble que sostiene.
            color: new THREE.Color(0xFFD7B0).multiplyScalar(0.34),
            // Un suelo de verdad tiene brillo, y es la mitad de lo que lo hace
            // parecer un suelo: refleja la lámpara en vez de tragársela. Por
            // eso se salta el 0.94 mate de `acabado` y sube el entorno.
            roughness: 0.56,
            envMapIntensity: 0.38
        }))
    );
    suelo.rotation.x = -Math.PI / 2;
    const yPiso = caja.min.y - 0.4;
    suelo.position.set(centro.x, yPiso, zPared + ancho / 2);
    suelo.receiveShadow = true;
    escena.add(suelo);

    // La penumbra del suelo, calcada al suelo. El mueble se apoya a unas
    // pocas unidades de la pared sobre un plano de mil, así que en coordenadas
    // del plano el claro va casi pegado al borde de atrás.
    const penumbra = penumbraSuelo(ancho, 1 - (tam.z + 14) / ancho);
    penumbra.position.set(centro.x, yPiso + 0.08, zPared + ancho / 2);
    escena.add(penumbra);

    // RODAPIÉ. Es la pieza más barata de toda la habitación y la que más
    // hace, porque sin ella pared y suelo se cortan en una recta perfecta que
    // no existe en ningún cuarto: el encuentro se lee como el canto de dos
    // cartulinas apoyadas. Con un listón delante, los dos planos dejan de ser
    // planos y pasan a ser paramentos.
    //
    // Va a la escena, como la pared y el suelo: es telón, no mueble, y nadie
    // lo mide. Y lleva la máscara de desvanecido porque mide lo que la pared:
    // sin ella sería una raya clara cruzando el encuadre de lado a lado.
    const ALTO_RODAPIE = 7.5;
    const rodapie = new THREE.Mesh(
        new THREE.BoxGeometry(ancho, ALTO_RODAPIE, 1.8),
        new THREE.MeshStandardMaterial({
            color: colorMaterial('--madera-canto', '#39271B'),
            map: texturaDesvanecida(),
            roughness: 0.7,
            metalness: 0.03,
            envMapIntensity: 0.16,
            userData: { entornoFijo: true }
        })
    );
    rodapie.position.set(centro.x, yPiso + ALTO_RODAPIE / 2, zPared + 0.9);
    rodapie.castShadow = true;
    rodapie.receiveShadow = true;
    escena.add(rodapie);

    // El frustum de sombra tiene que abarcar el mueble MÁS la pared y el suelo.
    // Si se queda corto, la sombra aparece cortada por una recta a media pared,
    // que es peor que no tener sombra. No se escala con `ancho`, que ahora es
    // enorme: basta con cubrir el mueble y su sombra proyectada.
    // Sobre la VISTA, no sobre el mueble: si la planta no cabe en el frustum
    // no proyecta sombra, y un objeto sin sombra junto a otro que sí la tiene
    // se ve pegado encima, no puesto en el suelo.
    const alcance = Math.max(tamVista.x, tam.y) * 0.62 + 45;
    lampara.shadow.camera.left = -alcance;
    lampara.shadow.camera.right = alcance;
    lampara.shadow.camera.top = alcance;
    lampara.shadow.camera.bottom = -alcance;
    lampara.shadow.camera.far = alcance * 3.5;
    lampara.shadow.camera.updateProjectionMatrix();

    // La lámpara apunta al mueble: por defecto mira al origen, y con cinco
    // baldas el mueble baja bastante por debajo de él.
    lampara.target.position.copy(centro);
    escena.add(lampara.target);

    // La cota del suelo sale de aquí porque es aquí donde se decide. La
    // necesita el tope de inclinación de la órbita: sin ella, inclinar la
    // vista hacia abajo acaba metiendo la cámara por debajo de la tarima, y
    // como el suelo es un plano de una sola cara, desde abajo no existe — se
    // ve la habitación desde dentro del forjado.
    return { yPiso, zPared };
}

// Degradado que finge que el lomo es curvo: oscuro en los cantos, claro hacia
// el centro. Se perdió cuando el rótulo pasó a un plano transparente y la
// textura dejó de pintar el fondo; sin él la cara del lomo es color plano.
//
// Va sobre el plano del rótulo y no en el `map` del material porque
// RoundedBoxGeometry reparte las UV sobre la forma redondeada: un mapa en el
// material saldría estirado por las esquinas. Es la misma razón por la que el
// título ya vive en un plano.
// Gris, no negro translúcido: esto va como `map` del material, y `map`
// MULTIPLICA al color del libro. Blanco = no toca nada, gris = oscurece.
// Así el canto cae y el centro conserva su color.
function texturaCurvatura() {
    return texturaCacheada('curvatura', () => {
        const lienzo = document.createElement('canvas');
        lienzo.width = 128;
        lienzo.height = 4;
        const ctx = lienzo.getContext('2d');

        const g = ctx.createLinearGradient(0, 0, 128, 0);
        g.addColorStop(0, '#8f8f8f');
        g.addColorStop(0.18, '#d8d8d8');
        g.addColorStop(0.42, '#ffffff');
        g.addColorStop(0.72, '#e0e0e0');
        g.addColorStop(1, '#8a8a8a');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 128, 4);

        const tex = new THREE.CanvasTexture(lienzo);
        tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = ANISOTROPIA;
        return tex;
    });
}


// ----------------------------------------
// Piezas del mueble
// ----------------------------------------

// Una sola geometría unitaria para todos los libros y tablas: se escala por
// instancia. Con 112 libros esto es la diferencia entre 300 geometrías y una.
// Caja unitaria compartida por las piezas planas —traseras y rótulos—, que
// no necesitan bisel. Los libros y las tablas ya no la usan: llevan su
// propia RoundedBoxGeometry al tamaño real, porque un bisel sobre una caja
// unitaria escalada saldría estirado en el eje largo.
const GEOM_CAJA = estanteDisponible ? new THREE.BoxGeometry(1, 1, 1) : null;

// La fija el renderer al crearse; 4 era un número puesto a mano.
let ANISOTROPIA = 4;

function construirLibro(libro, acentoHex, conTexto) {
    const grosor = grosorLomo(libro);
    const alto = alturaLomo(libro);
    const fondo = 11 + hashEstante(libro.id + '|fondo') * 2.5;
    const color = colorLomo(libro, acentoHex);

    const grupo = new THREE.Group();

    // Rugosidad por libro: tela mate en un extremo, sobrecubierta satinada
    // en el otro. Con los 97 a 0.74 la fila brillaba como una sola pieza.
    const materialTapa = new THREE.MeshStandardMaterial({
        color: color,
        map: texturaCurvatura(),
        roughness: 0.55 + hashEstante(libro.id + '|acabado') * 0.40,
        metalness: 0.03
    });


    // El canto de papel, con sus estrías. Antes era un color liso, y como
    // además estaba mal asignado (ver abajo) los libros inclinados enseñaban
    // tochos crema que parecían cartón.
    const materialHojas = new THREE.MeshStandardMaterial({
        map: texturaHojas(libro),
        roughness: 0.96,
        metalness: 0
    });

    // Orden de caras de BoxGeometry: +X, -X, +Y, -Y, +Z, -Z.
    //
    // OJO, esto estaba mal y es el error que más se notaba: ±X son las TAPAS,
    // delantera y trasera, no las hojas. Estaban pintadas con el material de
    // papel, así que cada libro ladeado mostraba una losa crema enorme. Solo
    // son papel el canto superior e inferior (±Y) y el canto delantero (-Z);
    // el lomo mira al espectador en +Z.
    const cuerpo = new THREE.Mesh(
        new THREE.RoundedBoxGeometry(grosor, alto, fondo, 2, Math.min(0.07, grosor * 0.18)),
        [
            materialTapa, materialTapa,     // +X, -X → tapas
            materialHojas, materialHojas,   // +Y, -Y → cantos de papel
            materialTapa, materialHojas     // +Z → lomo · -Z → canto delantero
        ]
    );
    cuerpo.position.y = alto / 2;
    cuerpo.castShadow = true;
    cuerpo.receiveShadow = true;
    grupo.add(cuerpo);

    // El rótulo del lomo va en un plano propio, no como material de la cara.
    // RoundedBoxGeometry reparte las UV sobre la forma redondeada, así que la
    // cara plana ya no corresponde 1:1 con la textura y el título salía
    // recortado por los lados. Con un plano encima se controla exacto, y de
    // paso el texto puede ir a más resolución que el resto del libro.
    // El plano solo existe si hay título que poner. La curvatura ya la da el
    // material de la tapa, sin malla extra ni transparencia.
    if (conTexto) {
        const rotulo = new THREE.Mesh(
            new THREE.PlaneGeometry(grosor * 0.88, alto * 0.94),
            new THREE.MeshStandardMaterial({
                map: texturaLomo(libro, color),
                transparent: true,
                roughness: 0.7,
                metalness: 0.05
            })
        );
        rotulo.position.set(0, alto / 2, fondo / 2 + 0.02);
        grupo.add(rotulo);
    }

    // Tejuelo: la etiqueta de signatura que llevan los libros de biblioteca.
    // Sustituye a la banda de color que ocupaba todo el bajo del lomo y leía
    // como una pegatina fluorescente. La señal de estado es la misma —el
    // punto de color— pero montada sobre una etiqueta mate con su borde.
    const tejuelo = new THREE.Mesh(
        new THREE.PlaneGeometry(grosor * 0.82, 2.5),
        new THREE.MeshStandardMaterial({
            map: texturaTejuelo(libro.estado),
            transparent: true,
            roughness: 0.92,
            metalness: 0
        })
    );
    tejuelo.position.set(0, 2.5, fondo / 2 + 0.05);
    grupo.add(tejuelo);

    grupo.userData = {
        libroId: libro.id,
        grosor: grosor,
        alto: alto,
        reposoZ: 0,
        cuerpo: cuerpo
    };

    return grupo;
}

function construirTabla(ancho, fondo) {
    // La veta vuelve a la tabla. Se quedó sin usar cuando el rótulo del tema
    // se mudó al panel trasero, y la madera llevaba desde entonces un color
    // plano sin grano ninguno.
    const madera = new THREE.MeshStandardMaterial({
        map: texturaMadera(ancho, fondo),
        roughness: 0.82,
        metalness: 0.04
    });

    const tabla = new THREE.Mesh(
        new THREE.RoundedBoxGeometry(ancho, 1.7, fondo, 2, 0.16),
        madera
    );
    tabla.castShadow = true;
    tabla.receiveShadow = true;
    return tabla;
}

// Franja oscura donde la fila de libros se apoya en la tabla. La luz
// direccional ya proyecta sombras, pero el oscurecimiento de contacto —lo
// que ocurre en la rendija de un milímetro entre el libro y la madera— no lo
// da ninguna sombra proyectada, y sin él los libros parecen pegados encima.
// Una por balda, no una por libro: cinco mallas en vez de cien.
function sombraDeContacto(ancho, fondo) {
    const plano = new THREE.Mesh(
        new THREE.PlaneGeometry(ancho, fondo * 0.8),
        new THREE.MeshBasicMaterial({
            map: texturaSombraContacto(),
            transparent: true,
            opacity: 0.55,
            depthWrite: false
        })
    );
    plano.rotation.x = -Math.PI / 2;
    plano.position.y = 0.02;
    return plano;
}

// Carcasa del mueble: laterales, coronación y patas.
//
// Viene del marco que el diseño de Figma dibuja en CSS alrededor de las
// baldas. Aquí va en 3D y DENTRO del grupo `mueble`, no en la escena, por dos
// razones que importan:
//
//   · gira con el mueble. Un marco en CSS se quedaría quieto mientras el
//     estante rota por dentro, y eso se ve roto al instante.
//   · entra en la caja envolvente que miden encuadrarEscena() y los topes del
//     paneo, que es lo correcto: la carcasa ES el mueble, no decorado.
//
// Es además lo que le faltaba al estante para ser un mueble cerrado en vez de
// una fachada, que era el motivo de limitar el giro a ±30°.
function construirCarcasa(mueble, ancho, fondo) {
    const caja = new THREE.Box3().setFromObject(mueble);
    const tam = caja.getSize(new THREE.Vector3());
    const centro = caja.getCenter(new THREE.Vector3());

    const GRUESO = 3.2;          // canto de los laterales
    const VUELO = 2.4;           // cuánto sobresalen coronación y base
    const altura = tam.y + GRUESO * 2;

    const maderaCanto = new THREE.MeshStandardMaterial({
        color: colorMaterial('--madera-canto', '#39271B'),
        roughness: 0.86,
        metalness: 0.04
    });

    const maderaTapa = new THREE.MeshStandardMaterial({
        map: texturaMadera(ancho + GRUESO * 2 + VUELO * 2, fondo + VUELO),
        roughness: 0.8,
        metalness: 0.05
    });

    const pieza = (geo, material, pos) => {
        const m = new THREE.Mesh(geo, material);
        m.position.copy(pos);
        m.castShadow = true;
        m.receiveShadow = true;
        mueble.add(m);
        return m;
    };

    // Laterales, con un bisel suave como el resto del mueble
    const lateral = new THREE.RoundedBoxGeometry(GRUESO, altura, fondo, 2, 0.18);
    const x = ancho / 2 + GRUESO / 2;
    pieza(lateral, maderaCanto, new THREE.Vector3(centro.x - x, centro.y, 0));
    pieza(lateral.clone(), maderaCanto, new THREE.Vector3(centro.x + x, centro.y, 0));

    // Coronación y base: sobresalen por delante y por los lados, que es lo que
    // hace que un mueble parezca carpintería y no una caja.
    const anchoTapa = ancho + GRUESO * 2 + VUELO * 2;
    const tapa = new THREE.RoundedBoxGeometry(anchoTapa, 2.6, fondo + VUELO, 2, 0.2);
    pieza(tapa, maderaTapa, new THREE.Vector3(centro.x, caja.max.y + GRUESO, VUELO / 2));
    pieza(tapa.clone(), maderaTapa, new THREE.Vector3(centro.x, caja.min.y - GRUESO, VUELO / 2));

    // Patas: dos tacos, no un zócalo corrido. Levantan el mueble del suelo lo
    // justo para que la sombra pase por debajo.
    const pata = new THREE.RoundedBoxGeometry(11, 4.5, fondo * 0.7, 2, 0.15);
    const yPata = caja.min.y - GRUESO - 3.5;
    const xPata = ancho / 2 - 4;
    pieza(pata, maderaCanto, new THREE.Vector3(centro.x - xPata, yPata, 0));
    pieza(pata.clone(), maderaCanto, new THREE.Vector3(centro.x + xPata, yPata, 0));
}

// ----------------------------------------
// El muro: una balda por tema
// ----------------------------------------

// ----------------------------------------
// Escenografía: los muebles que no son el estante
// ----------------------------------------
// Una planta grande y una mesa auxiliar, para que el estante esté en una
// habitación y no sobre un fondo.
//
// La regla de reparto de la escena tiene ahora tres alturas, y conviene
// entenderla antes de añadir nada:
//
//   · `mueble`        el estante. Es de lo que va la app: fija los topes del
//                     zoom y es lo que el encuadre tiene que garantizar.
//   · `escenografia`  planta y mesa. Objetos con sitio y tamaño reales, así
//                     que SÍ entran en el encuadre de la cámara: si no, caen
//                     fuera del cuadro inicial y no se ven. Lo que no hacen
//                     es mandar en nada más.
//   · la escena       pared y suelo. Telón: no se miden NUNCA. Medirlos
//                     mandaría la cámara a mil unidades con el mueble del
//                     tamaño de un sello.
//
// Quien añada un mueble nuevo lo cuelga de `escenografia`. Quien añada un
// fondo lo cuelga de la escena.

// Cuántas veces se repite el mosaico de duelas a lo largo del suelo. El plano
// mide más de mil unidades: con una sola copia cada duela mediría dos metros
// y se leería como una moqueta estampada.
const REPETICION_SUELO = 26;

// Una duela: color base con su propio tono, veta longitudinal y un reflejo
// suave a lo largo. El tono lo decide el hash de su índice, no Math.random:
// la textura se reconstruye en cada montaje y un suelo que cambia de dibujo
// al filtrar se nota.
function dibujarDuela(ctx, x, y, largo, alto, base, semilla) {
    const h = hashEstante('duela|' + semilla);
    const tono = base.clone().multiplyScalar(0.74 + h * 0.5);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1.5, y + 1.5, largo - 3, alto - 3);
    ctx.clip();

    ctx.fillStyle = '#' + tono.getHexString();
    ctx.fillRect(x, y, largo, alto);

    // Veta: arcos largos y muy tendidos. En un suelo la veta va en el sentido
    // de la duela, y es lo que impide que cada tabla sea un rectángulo plano.
    ctx.lineWidth = 1;
    const vetas = 7;
    for (let i = 0; i < vetas; i++) {
        const g = hashEstante('veta|' + semilla + '|' + i);
        const yv = y + ((i + g) / vetas) * alto;
        const amplitud = 1.2 + g * 3.4;
        ctx.strokeStyle = g > 0.5
            ? 'rgba(0, 0, 0, ' + (0.10 + g * 0.16).toFixed(3) + ')'
            : 'rgba(255, 228, 196, ' + (0.03 + g * 0.05).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(x, yv);
        for (let px = 0; px <= largo; px += 24) {
            ctx.lineTo(x + px, yv + Math.sin((px + semilla * 53) * 0.004 + i) * amplitud);
        }
        ctx.stroke();
    }

    // Nudos: dos o tres por duela, no en todas. Son lo que delata que es
    // madera y no un laminado impreso.
    if (h > 0.45) {
        const nx = x + largo * (0.2 + h * 0.6);
        const ny = y + alto * (0.3 + hashEstante('nudo|' + semilla) * 0.4);
        for (let a = 0; a < 4; a++) {
            ctx.strokeStyle = 'rgba(0, 0, 0, ' + (0.20 - a * 0.04).toFixed(3) + ')';
            ctx.beginPath();
            ctx.ellipse(nx, ny, 2.5 + a * 2.6, 1.1 + a * 1.0, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Bisel: el canto superior de cada duela coge algo de luz y el inferior
    // cae. Es medio píxel de dibujo y es lo que da el relieve de tarima.
    ctx.fillStyle = 'rgba(255, 225, 185, 0.045)';
    ctx.fillRect(x, y + 1, largo, 1);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.fillRect(x, y + alto - 2, largo, 1.5);

    ctx.restore();
}

// Mosaico de tarima a matajunta. Devuelve color y relieve: el relieve es el
// mismo dibujo en gris y va de `bumpMap`, que es lo que hace que la junta
// entre duelas se hunda de verdad en vez de ser una raya pintada.
function texturasSuelo() {
    const construir = enRelieve => {
        const L = 1024;
        const lienzo = document.createElement('canvas');
        lienzo.width = L;
        lienzo.height = L;
        const ctx = lienzo.getContext('2d');

        const tabla = new THREE.Color(token('--suelo-tabla', '#3B2A1C'));
        ctx.fillStyle = enRelieve ? '#000000' : token('--suelo-junta', '#140D08');
        ctx.fillRect(0, 0, L, L);

        // La proporción es lo que distingue una tarima de un solado. Con
        // duelas de 2.5:1 —cinco filas y dos por fila— el suelo salía
        // embaldosado; una duela real ronda el 9:1, así que va una por fila y
        // nueve filas.
        const FILAS = 9;
        const alto = L / FILAS;
        const LARGO = L;

        for (let f = 0; f < FILAS; f++) {
            // Aparejo a matajunta: media duela de desfase en filas alternas.
            // Con todas las juntas alineadas el suelo se lee como una rejilla.
            const desfase = (f % 2) * (LARGO / 2);
            for (let t = -1; t <= 1; t++) {
                dibujarDuela(ctx, desfase + t * LARGO, f * alto, LARGO, alto,
                             enRelieve ? new THREE.Color(0x9a9a9a) : tabla,
                             f * 11 + t + 3);
            }
        }

        const tex = new THREE.CanvasTexture(lienzo);
        if (!enRelieve) tex.encoding = THREE.sRGBEncoding;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(REPETICION_SUELO, REPETICION_SUELO);
        // Las duelas corren HACIA el espectador, no de lado a lado. No es un
        // capricho: tumbadas en el sentido de la vista sus juntas son rectas
        // horizontales paralelas al borde del encuadre, que es exactamente el
        // dibujo de un solado. Giradas un cuarto de vuelta esas mismas juntas
        // se vuelven líneas que convergen en fuga, y la perspectiva del suelo
        // es la mitad de la profundidad de la escena.
        tex.center.set(0.5, 0.5);
        tex.rotation = Math.PI / 2;
        tex.anisotropy = ANISOTROPIA;
        return tex;
    };

    return {
        color: texturaCacheada('suelo-color', () => construir(false)),
        relieve: texturaCacheada('suelo-relieve', () => construir(true))
    };
}

// ----------------------------------------
// La planta
// ----------------------------------------
// Un ficus lyrata: tronco leñoso desnudo y unas pocas hojas enormes y enteras.
//
// Antes era una monstera, y no funcionaba. La razón es instructiva y vale para
// cualquier cosa que se modele aquí: la identidad de una monstera está en la
// FILIGRANA — gajos profundos, calados, un contorno muy recortado. Y a la
// distancia a la que se ve esta planta, la filigrana no se lee como filigrana;
// se lee como un borde sucio. Se intentó dos veces, cada vez con una forma más
// correcta botánicamente, y las dos veces salió un recorte de cartulina.
//
// El ficus lyrata va en la dirección contraria y por eso sale bien: su silueta
// son pocas palas grandes y LISAS sobre un tronco pelado. No hay detalle fino
// que perder a distancia, porque no hay detalle fino. Y el contraste entre el
// tronco desnudo y la copa ancha es legible en cualquier tamaño, que es lo que
// se le pide a un objeto de fondo.
//
// La regla, para la próxima: a esta escala elige una planta por su MASA y su
// contorno general, nunca por el detalle de su hoja. Una palmera o un helecho
// —decenas de folíolos pequeños— fallarían por lo mismo que falló la monstera,
// y encima costando mucha más geometría.

// Perfil de la hoja, en el plano XY: +X va del pecíolo a la punta.
//
// Es una hoja OBOVADA con una insinuación de cintura: ancha pasada la mitad,
// roma en la punta y algo acorazonada en la base. Los dos extremos tienen que
// quedar romos — una punta de lanza la devuelve al montón de hojas genéricas.
//
// Lo importante aquí es lo que NO se hace. El nombre de la planta invita a
// modelar un violín, y ese fue el primer intento: dos lóbulos gaussianos
// sumados, con la cintura naciendo en el valle entre ellos. Con la cintura lo
// bastante marcada como para verse, la hoja deja de leerse como una hoja y
// pasa a leerse como dos lóbulos pegados — sale un roble. La cintura de un
// ficus lyrata es una insinuación: aquí es un 11% sobre una sola campana.
function formaHojaFicus(largo, ancho, semilla) {
    const forma = new THREE.Shape();
    const N = 84;
    const s = hashEstante('ficus|' + semilla);

    const perfil = t => {
        // OBOVADA: una sola campana con el máximo pasada la mitad (t≈0.59) y
        // los dos extremos romos. El exponente 1.3 de dentro es lo que corre
        // el máximo hacia el ápice; el 0.55 de fuera es lo que achata la punta.
        const campana = Math.pow(Math.sin(Math.PI * Math.pow(t, 1.3)), 0.55);
        // Y la cintura del violín, muy suave. Se intentó primero con dos
        // gaussianas sumadas —un lóbulo en la base y una pala en el ápice— y
        // salía tan marcada que la hoja se leía como DOS lóbulos pegados: una
        // hoja de roble, no un ficus. La cintura de esta hoja es una
        // insinuación, no una escotadura.
        const cintura = 1 - 0.11 * Math.exp(-Math.pow((t - 0.38) / 0.15, 2));
        return campana * cintura;
    };

    // Margen ondulado. Es la otra firma de esta hoja y no es adorno: un
    // contorno liso sobre una pala tan grande la deja plana como una paleta de
    // ping-pong. Las dos mitades van desfasadas, por lo de siempre — una hoja
    // simétrica se lee como troquel.
    //
    // La onda se APAGA en los extremos. Sin ese factor, un seno cayendo cerca
    // de t=1 muerde la punta y la deja dentada, que fue exactamente cómo estas
    // hojas pasaron de parecer ficus a parecer arce.
    const borde = (t, lado) => {
        const fase = s * 6.283 + (lado > 0 ? 0 : 1.15);
        const onda = 0.035 * Math.sin(t * Math.PI * 3.0 + fase) * Math.sin(Math.PI * t);
        return ancho * perfil(t) * (1 + onda);
    };

    forma.moveTo(0, 0);
    for (let i = 1; i <= N; i++) forma.lineTo((i / N) * largo, borde(i / N, 1));
    for (let i = N; i >= 0; i--) forma.lineTo((i / N) * largo, -borde(i / N, -1));
    forma.closePath();

    // Sin calados: un ficus lyrata no los tiene, y es medio motivo del cambio.
    return forma;
}

// Subdivisión por puntos medios: cada triángulo en cuatro, `veces` veces.
//
// Hace falta porque ShapeGeometry NO tesela el interior: triangula el
// polígono con los vértices del contorno y nada más, así que el centro de la
// hoja son cuatro triángulos enormes. Da igual lo fina que sea la curvatura
// que se les aplique después — con tres vértices por triángulo, el sombreado
// se interpola en línea recta a lo ancho de media hoja y lo que se ve son
// facetas. La hoja parecía papel de origami.
//
// Va ANTES de desplazar los vértices: subdividir una malla ya curvada solo
// parte las facetas que ya existen, no las quita.
function subdividirMalla(geo, veces) {
    let pos = Array.from(geo.attributes.position.array);
    let uv = Array.from(geo.attributes.uv.array);
    let idx = Array.from(geo.index.array);

    for (let v = 0; v < veces; v++) {
        const salida = [];
        const cache = new Map();
        const medio = (a, b) => {
            const clave = a < b ? a + ':' + b : b + ':' + a;
            let m = cache.get(clave);
            if (m === undefined) {
                m = pos.length / 3;
                pos.push((pos[a * 3] + pos[b * 3]) / 2,
                         (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2,
                         (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2);
                uv.push((uv[a * 2] + uv[b * 2]) / 2,
                        (uv[a * 2 + 1] + uv[b * 2 + 1]) / 2);
                cache.set(clave, m);
            }
            return m;
        };
        for (let i = 0; i < idx.length; i += 3) {
            const a = idx[i], b = idx[i + 1], c = idx[i + 2];
            const ab = medio(a, b), bc = medio(b, c), ca = medio(c, a);
            salida.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
        }
        idx = salida;
    }

    const fina = new THREE.BufferGeometry();
    fina.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fina.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    fina.setIndex(idx);
    return fina;
}

function geometriaHoja(largo, ancho, semilla) {
    const plana = new THREE.ShapeGeometry(formaHojaFicus(largo, ancho, semilla), 6);

    // LAS UV DE ShapeGeometry NO ESTÁN NORMALIZADAS. El código de three las
    // emite con un comentario que lo dice —`uvs.push( vertex.x, vertex.y ); //
    // world uvs`—: son las coordenadas del plano tal cual, no un 0..1.
    //
    // Con hojas de unas 25 unidades de largo, la u iba de 0 a 25. Con el
    // envoltorio por defecto (ClampToEdge) eso significa que TODA la hoja,
    // salvo una franja de una unidad junto al pecíolo, se pintaba con la
    // última columna de píxeles del lienzo. La nervadura llevaba desde el
    // principio sin verse, y no por sutil: no se estaba dibujando.
    //
    // Se normaliza aquí, sobre la malla de partida: subdividirMalla() promedia
    // las uv linealmente, así que hacerlo antes o después da lo mismo y antes
    // son muchos menos vértices.
    const uvPlana = plana.attributes.uv;
    for (let i = 0; i < uvPlana.count; i++) {
        uvPlana.setXY(i, uvPlana.getX(i) / largo,
                         (uvPlana.getY(i) + ancho) / (2 * ancho));
    }

    // Dos pasadas: cada triángulo del contorno pasa a dieciséis. Son unos dos
    // mil triángulos por hoja y trece hojas en toda la escena — nada al lado de
    // los cien libros, y es la diferencia entre una hoja y una pajarita.
    const geo = subdividirMalla(plana, 2);
    // La malla de partida no llega a la escena, así que destruir() no la vería.
    plana.dispose();

    const s = hashEstante('alabeo|' + semilla);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const t = Math.min(1, Math.max(0, x / largo));
        const r = Math.abs(y) / ancho;

        // La caída hacia la punta: es el peso de una hoja que llega a medio
        // metro. Sin ella la pala sale tiesa y parece de plástico.
        const caida = -Math.pow(t, 1.7) * largo * 0.30;
        // El canal a lo largo del nervio, que es como una hoja grande se
        // sostiene sin doblarse por la mitad.
        const canal = Math.pow(r, 1.8) * ancho * 0.26;
        // Y la ONDA DEL MARGEN en 3D, no solo en el contorno. Esto es lo que
        // de verdad vende la hoja: recortar el borde en zigzag y dejar la
        // superficie plana da una sierra; ondular la superficie hace que cada
        // seno coja la luz de la lámpara de una manera distinta y la hoja pase
        // a tener relieve propio. Crece con r² para que el nervio no se mueva.
        const onda = Math.sin(t * Math.PI * 3.0 + s * 6.283) * r * r * ancho * 0.07;
        // Torsión suave: ninguna hoja está contenida en un plano.
        const alabeo = y * t * (s - 0.5) * 0.45;

        pos.setZ(i, caida + canal + onda + alabeo);
    }
    geo.computeVertexNormals();
    return geo;
}

// Nervadura, en DOS mapas que salen del mismo dibujo.
//
// `map` MULTIPLICA al color del material, así que solo puede oscurecer: por
// eso el fondo del lienzo es gris y los nervios BLANCOS. Un nervio pintado de
// un color propio competiría con la hoja; así lo único que pasa es que el
// limbo baja un punto y los nervios se quedan donde están, que es exactamente
// cómo se ve un ficus lyrata — nervadura pálida y muy marcada sobre verde
// oscuro.
//
// Y `bumpMap`, que es la mitad que faltaba. Una nervadura solo pintada es un
// dibujo sobre una superficie lisa, y se nota: la hoja sigue leyéndose como
// una pala de color uniforme con unas rayas encima. En relieve, el nervio
// central levanta un caballete y los secundarios surcan el limbo, así que la
// luz de la lámpara los recorre y la hoja pasa a tener superficie. Es el mismo
// razonamiento que la tarima: el `map` dice de qué color es, el relieve dice
// que existe.
//
// Es el rasgo que más identifica a esta hoja después del contorno: los nervios
// secundarios salen muy abiertos respecto al central y llegan hasta el margen.
function texturaNervio() {
    return texturaCacheada('nervio-hoja', () => {
        const W = 512, H = 256;
        const lienzo = document.createElement('canvas');
        lienzo.width = W;
        lienzo.height = H;
        const ctx = lienzo.getContext('2d');

        // Gris medio, no blanco: es el margen que deja sitio a que los nervios
        // se vean más claros que el limbo.
        ctx.fillStyle = '#b4b4b4';
        ctx.fillRect(0, 0, W, H);

        // Moteado del limbo. Una hoja grande nunca es de un tono plano, y sin
        // esto toda la variación de la hoja depende de la geometría.
        for (let i = 0; i < 260; i++) {
            const a = hashEstante('limbo|' + i);
            const b = hashEstante('limbo|b|' + i);
            ctx.fillStyle = a > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
            ctx.beginPath();
            ctx.ellipse(a * W, b * H, 6 + a * 22, 4 + b * 12, b * 3.1, 0, 6.283);
            ctx.fill();
        }

        // El nervio central corre a media altura: la u va del pecíolo a la
        // punta y la v cruza la hoja, con el nervio justo en v = 0.5.
        ctx.lineCap = 'round';

        // Secundarios primero, para que el central les pase por encima. Muy
        // abiertos, y ni equidistantes ni iguales: a paso fijo y mismo grosor
        // la nervadura sale un peine, que es justo lo que la delata como
        // dibujo. El desorden lo pone el hash, no Math.random, por lo de
        // siempre — el muro se reconstruye en cada pulsación.
        //
        // Cada nervio se traza en varios tramos que van adelgazando y perdiendo
        // opacidad hacia el margen: un nervio de grosor constante hasta el
        // borde es lo segundo que lo delata.
        const TRAMOS = 5;
        for (let i = 1; i < 12; i++) {
            const j = hashEstante('nervio|' + i);
            const k = hashEstante('nervio|k|' + i);
            const x = ((i + (j - 0.5) * 0.55) / 12) * W;
            const abre = 0.052 + k * 0.026;
            [1, -1].forEach(lado => {
                const desvio = lado > 0 ? j : k;
                for (let t = 0; t < TRAMOS; t++) {
                    const a0 = t / TRAMOS, a1 = (t + 1) / TRAMOS;
                    const pt = u => [
                        x + W * abre * u * u,
                        H / 2 + lado * H * 0.54 * u * (1 + (desvio - 0.5) * 0.18)
                    ];
                    ctx.strokeStyle = 'rgba(255, 255, 255, ' +
                        (0.34 * (1 - a0 * 0.75)).toFixed(3) + ')';
                    ctx.lineWidth = 3.0 * (1 - a0 * 0.62);
                    ctx.beginPath();
                    ctx.moveTo(...pt(a0));
                    ctx.lineTo(...pt(a1));
                    ctx.stroke();
                }
            });
        }

        // Sombra bajo el central: es lo que lo despega del limbo.
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.20)';
        ctx.lineWidth = 11;
        ctx.beginPath();
        ctx.moveTo(0, H / 2 + 5);
        ctx.lineTo(W, H / 2 + 5);
        ctx.stroke();

        // Y el central, que se estrecha hacia la punta.
        const central = ctx.createLinearGradient(0, 0, W, 0);
        central.addColorStop(0, 'rgba(255, 255, 255, 0.80)');
        central.addColorStop(1, 'rgba(255, 255, 255, 0.34)');
        ctx.strokeStyle = central;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(0, H / 2);
        ctx.lineTo(W, H / 2);
        ctx.stroke();

        const tex = new THREE.CanvasTexture(lienzo);
        tex.encoding = THREE.sRGBEncoding;
        tex.anisotropy = ANISOTROPIA;
        return tex;
    });
}

// La maceta es de torno, literalmente: un perfil girado con LatheGeometry.
// Un cilindro con un bisel se ve como un cubo de obra; lo que hace que se lea
// como terracota es la panza y el labio del borde.
function construirMaceta(alto, radio) {
    const perfil = [];
    const pasos = 14;
    for (let i = 0; i <= pasos; i++) {
        const t = i / pasos;
        // Estrecha en la base, panza a media altura, recogida bajo el labio.
        const r = radio * (0.62 + 0.42 * Math.sin(Math.PI * Math.pow(t, 0.8)) + t * 0.16);
        perfil.push(new THREE.Vector2(r, t * alto * 0.92));
    }
    perfil.push(new THREE.Vector2(radio * 1.12, alto * 0.94));   // labio, hacia fuera
    perfil.push(new THREE.Vector2(radio * 1.10, alto));
    perfil.push(new THREE.Vector2(radio * 0.98, alto));          // canto interior

    const geo = new THREE.LatheGeometry(perfil, 28);
    const material = new THREE.MeshStandardMaterial({
        color: colorMaterial('--maceta', '#6B4A38'),
        roughness: 0.88,
        metalness: 0.02,
        envMapIntensity: 0.14,
        userData: { entornoFijo: true },
        side: THREE.DoubleSide
    });

    const maceta = new THREE.Mesh(geo, material);
    maceta.castShadow = true;
    maceta.receiveShadow = true;
    return maceta;
}

// Planta entera. `altura` es de la base de la maceta a la hoja más alta.
function construirPlanta(altura) {
    const planta = new THREE.Group();

    const ALTO_MACETA = altura * 0.20;
    const RADIO_MACETA = ALTO_MACETA * 0.70;
    planta.add(construirMaceta(ALTO_MACETA, RADIO_MACETA));

    // Tierra: un disco hundido bajo el labio. Sin él se ve el interior hueco
    // de la maceta desde arriba y se acaba la ilusión.
    const tierra = new THREE.Mesh(
        new THREE.CircleGeometry(RADIO_MACETA * 1.02, 24),
        new THREE.MeshStandardMaterial({
            color: colorMaterial('--tierra', '#1A1410'),
            roughness: 1,
            metalness: 0
        })
    );
    tierra.rotation.x = -Math.PI / 2;
    tierra.position.y = ALTO_MACETA * 0.9;
    tierra.receiveShadow = true;
    planta.add(tierra);

    // EL TRONCO. Es la mitad de la silueta de un ficus lyrata: un fuste pelado
    // y claro que sube desde la tierra y no tiene nada hasta bien arriba. Una
    // mata de hojas saliendo del tiesto sería otra planta distinta.
    //
    // Se construye como un cilindro con segmentos y se le desplaza el eje: un
    // tronco perfectamente recto se lee como un palo de escoba, y curvarlo con
    // una función suave de la altura cuesta un bucle.
    const Y_BASE = ALTO_MACETA * 0.88;
    const Y_COPA = altura * 0.74;
    const ALTO_TRONCO = Y_COPA - Y_BASE;
    const R_TRONCO = altura * 0.015;
    const inclina = t => Math.sin(t * 3.4) * ALTO_TRONCO * 0.06;

    const geoTronco = new THREE.CylinderGeometry(R_TRONCO * 0.72, R_TRONCO,
                                                 ALTO_TRONCO, 10, 14);
    const posT = geoTronco.attributes.position;
    for (let i = 0; i < posT.count; i++) {
        const t = (posT.getY(i) + ALTO_TRONCO / 2) / ALTO_TRONCO;
        posT.setX(i, posT.getX(i) + inclina(t));
    }
    geoTronco.computeVertexNormals();

    const tronco = new THREE.Mesh(geoTronco, new THREE.MeshStandardMaterial({
        color: colorMaterial('--planta-tronco', '#6B5C4A'),
        roughness: 0.88,
        metalness: 0,
        envMapIntensity: 0.18,
        userData: { entornoFijo: true }
    }));
    tronco.position.y = Y_BASE + ALTO_TRONCO / 2;
    tronco.castShadow = true;
    planta.add(tronco);

    // Tres materiales de hoja, no uno por hoja: a esta escala la variación que
    // se aprecia es de tono, y unos pocos tonos ya rompen la mancha plana. Es
    // la misma cuenta que hace texturaHojas() con sus seis variantes.
    //
    // El tercero es el oscuro: las hojas de dentro de la copa reciben menos
    // luz que las de fuera, y sin esa diferencia la copa no tiene volumen.
    const nervio = texturaNervio();
    const materiales = [
        token('--planta-hoja', '#2C4A33'),
        token('--planta-hoja-clara', '#3D6242'),
        token('--planta-hoja-honda', '#1D3324')
    ].map(hex => new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex).convertSRGBToLinear(),
        map: nervio,
        // El mismo dibujo en relieve. Sin esto la nervadura es una calcomanía
        // sobre una superficie perfectamente lisa.
        bumpMap: nervio,
        bumpScale: 0.55,
        // La hoja del ficus lyrata es CORIÁCEA y brillante, bastante más que
        // la de una monstera: quiere especular. Pero el entorno de
        // RoomEnvironment ilumina TAMBIÉN en difuso, y al 0.30 del resto de la
        // escena las hojas salían verde menta. Se marcan como fijas para que
        // ajustarEntorno() no las vuelva a subir.
        //
        // El brillo bajó a 0.62 cuando las hojas salían de plástico, pero el
        // problema no era que brillaran: era que brillaban PLANO, porque el
        // relieve no existía y el reflejo barría la pala entera de una pieza.
        // Con la nervadura en bumpMap el especular se rompe solo, y se puede
        // volver a subir hasta donde una hoja coriácea de verdad lo tiene.
        roughness: 0.52,
        metalness: 0,
        envMapIntensity: 0.11,
        userData: { entornoFijo: true },
        side: THREE.DoubleSide
    }));

    const peciolo = new THREE.MeshStandardMaterial({
        color: colorMaterial('--planta-tallo', '#2A4026'),
        roughness: 0.7,
        metalness: 0,
        envMapIntensity: 0.16,
        userData: { entornoFijo: true }
    });

    // Trece hojas grandes repartidas por los tres cuartos altos del tronco.
    // Van pocas y enormes a propósito: repartir la misma masa en más piezas es
    // lo que convertía la monstera en un surtidor de tiras.
    const HOJAS = 13;
    const LARGO_HOJA = altura * 0.25;

    for (let i = 0; i < HOJAS; i++) {
        const h = hashEstante('ficus|hoja|' + i);
        const g = hashEstante('ficus|giro|' + i);
        const f = HOJAS > 1 ? i / (HOJAS - 1) : 0;   // 0 = la más baja

        // Ángulo áureo: reparte las hojas alrededor del tronco sin que dos
        // caigan nunca en la misma dirección, que es justo el defecto de
        // repartir a intervalos iguales.
        const azim = i * 2.39996 + g * 0.3;
        const y = Y_BASE + ALTO_TRONCO * (0.26 + 0.74 * f);
        const x = inclina((y - Y_BASE) / ALTO_TRONCO);

        // El pecíolo sale del tronco y es corto: en esta planta la hoja nace
        // casi pegada al fuste.
        const largoPeciolo = LARGO_HOJA * (0.20 + h * 0.10);
        const nudo = new THREE.Group();
        nudo.position.set(x, y, 0);
        nudo.rotation.y = -azim;

        // Las de abajo se abren y caen; las de arriba se recogen y apuntan
        // hacia la luz. Es lo que le da forma de copa en vez de de rueda.
        const pico = new THREE.Group();
        pico.rotation.z = -0.55 + f * 1.05 + (h - 0.5) * 0.2;
        nudo.add(pico);

        const tallo = new THREE.Mesh(
            new THREE.CylinderGeometry(R_TRONCO * 0.20, R_TRONCO * 0.30,
                                       largoPeciolo, 6),
            peciolo
        );
        // El cilindro nace vertical; se tumba para que salga en el sentido de
        // la hoja, que es +X en el plano del pico.
        tallo.rotation.z = -Math.PI / 2;
        tallo.position.x = largoPeciolo / 2;
        tallo.castShadow = true;
        pico.add(tallo);

        const largo = LARGO_HOJA * (1.14 - 0.22 * f) * (0.88 + h * 0.26);
        // OJO: el segundo argumento es la SEMIANCHURA. La hoja se dibuja a
        // ±borde(t), así que el ancho total es el doble de esto. Estuvo un
        // rato en 0.62 del largo, o sea 1.24 de ancho total: hojas MÁS ANCHAS
        // QUE LARGAS, que salían redondas y convertían el ficus en un árbol
        // de jade. Un ficus lyrata ronda el 1.6:1.
        const hoja = new THREE.Mesh(geometriaHoja(largo, largo * 0.29, i),
                                    materiales[(i * 5 + Math.round(g * 3)) % materiales.length]);
        hoja.position.x = largoPeciolo;
        // Vuelta sobre su propio nervio: sin esto todas las hojas enseñan la
        // cara igual y se ve el patrón.
        hoja.rotation.x = (g - 0.5) * 0.7;
        hoja.castShadow = true;
        pico.add(hoja);

        planta.add(nudo);
    }

    return planta;
}

// ----------------------------------------
// La mesa auxiliar
// ----------------------------------------

function construirMesa(ancho, fondo, alto) {
    const mesa = new THREE.Group();

    const GRUESO = 3.4;
    // El tablero se guarda porque es lo único de la mesa que lleva acción: ver
    // construirEscenografia.
    const tapa = new THREE.Mesh(
        new THREE.RoundedBoxGeometry(ancho, GRUESO, fondo, 2, 0.6),
        new THREE.MeshStandardMaterial({
            map: texturaMadera(ancho, fondo),
            roughness: 0.55,
            metalness: 0.05
        })
    );
    tapa.position.y = alto - GRUESO / 2;
    tapa.castShadow = true;
    tapa.receiveShadow = true;
    mesa.add(tapa);
    mesa.userData.tapa = tapa;

    const oscura = new THREE.MeshStandardMaterial({
        color: colorMaterial('--madera-canto', '#39271B'),
        roughness: 0.8,
        metalness: 0.03
    });

    // Faldón: la franja bajo el tablero que une las patas. Es lo que separa
    // una mesa de cuatro palos con una tabla encima.
    const faldon = new THREE.Mesh(
        new THREE.RoundedBoxGeometry(ancho - 7, 4.6, fondo - 7, 2, 0.4),
        oscura
    );
    faldon.position.y = alto - GRUESO - 2.3;
    faldon.castShadow = true;
    mesa.add(faldon);

    // Patas torneadas: más estrechas abajo. Un prisma recto da mesa de
    // montaje; el cono ligero da mueble.
    const altoPata = alto - GRUESO - 0.6;
    const pata = new THREE.CylinderGeometry(2.6, 1.9, altoPata, 10);
    const dx = ancho / 2 - 4.5;
    const dz = fondo / 2 - 4.5;
    [[-dx, -dz], [dx, -dz], [-dx, dz], [dx, dz]].forEach(([x, z], i) => {
        const m = new THREE.Mesh(i === 0 ? pata : pata.clone(), oscura);
        m.position.set(x, altoPata / 2, z);
        m.castShadow = true;
        mesa.add(m);
    });

    return mesa;
}

// ----------------------------------------
// La lámpara de la mesa
// ----------------------------------------
// El objeto que más hace por la escena después del pozo de luz, y por la misma
// razón: una habitación iluminada por una direccional sin origen visible es un
// estudio de fotografía. En cuanto se ve la lámpara, la luz cálida que entra
// por la izquierda deja de ser un ajuste del render y pasa a tener un motivo
// dentro del cuadro.
//
// Lleva luz propia —un punto cálido con caída— porque la pantalla encendida
// sin un charco de luz debajo se lee como un objeto pintado de amarillo. Va
// SIN sombra a propósito: la sombra de la escena la da la lámpara direccional,
// que está congelada (ver congelarSombras), y un segundo mapa de sombras
// costaría lo mismo que todo lo demás junto para iluminar un rincón.
// Tela de la pantalla: oscura en el hombro, encendida en el borde de abajo.
// Va a la vez de `map` y de `emissiveMap`, así que modula el color difuso y el
// brillo propio con el mismo dibujo — que es justo lo que hace una tela con
// una bombilla dentro.
function texturaPantallaLampara() {
    return texturaCacheada('pantalla-lampara', () => {
        const lienzo = document.createElement('canvas');
        lienzo.width = 4;
        lienzo.height = 128;
        const ctx = lienzo.getContext('2d');
        const g = ctx.createLinearGradient(0, 0, 0, 128);
        g.addColorStop(0, '#5e5346');      // hombro, a contraluz
        g.addColorStop(0.42, '#b7a488');
        g.addColorStop(1, '#ffffff');      // el faldón, donde sale la luz
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 4, 128);

        const tex = new THREE.CanvasTexture(lienzo);
        tex.encoding = THREE.sRGBEncoding;
        return tex;
    });
}

// ¿Está encendida? Estado de MÓDULO, igual que `vistaMuro`, y por la misma
// razón: renderizarLibros() desmonta y vuelve a montar el muro en cada
// pulsación del buscador. Una variable dentro de montarMuro() se perdería y la
// lámpara se volvería a encender sola al teclear.
let luzLampara = true;

// Lo que el muro montado deja aquí para que lo llame el interruptor del DOM.
// Es null mientras no haya muro —en el modal no hay lámpara—, y alternarLuz()
// se limita a guardar el estado si no hay nada que encender.
let aplicarLuzMuro = null;

function luzLamparaEncendida() {
    return luzLampara;
}

function alternarLuzLampara(valor) {
    luzLampara = typeof valor === 'boolean' ? valor : !luzLampara;
    if (aplicarLuzMuro) aplicarLuzMuro();
    // La lámpara se puede pulsar en la escena, y entonces el botón del menú
    // se quedaría diciendo lo contrario de lo que pasa. Es la misma relación
    // cíclica que auth.js ↔ app.js resuelve con window.gaboApp, y se resuelve
    // igual: este archivo carga antes que app.js, pero la llamada es en
    // tiempo de ejecución, no de carga.
    window.gaboApp?.sincronizarBotonLuz?.(luzLampara);
    return luzLampara;
}

function construirLamparaMesa(alto) {
    const grupo = new THREE.Group();
    const R = alto * 0.34;

    const bronce = new THREE.MeshStandardMaterial({
        color: colorMaterial('--lampara-pie', '#3A3128'),
        roughness: 0.42,
        metalness: 0.65,
        envMapIntensity: 0.5,
        userData: { entornoFijo: true }
    });

    // Pie: un perfil de torno, como la maceta. Un cilindro se lee como un bote.
    const perfil = [
        new THREE.Vector2(R * 0.92, 0),
        new THREE.Vector2(R * 0.90, alto * 0.035),
        new THREE.Vector2(R * 0.34, alto * 0.09),
        new THREE.Vector2(R * 0.12, alto * 0.16),
        new THREE.Vector2(R * 0.075, alto * 0.62)
    ];
    const pie = new THREE.Mesh(new THREE.LatheGeometry(perfil, 20), bronce);
    pie.castShadow = true;
    grupo.add(pie);

    // Pantalla: tronco de cono ABIERTO por arriba y por abajo, para que la luz
    // se derrame por los dos lados como en una pantalla de verdad. Cerrada, el
    // cono se ve como un sombrero macizo.
    //
    // El degradado de la tela es lo que la salva de parecer un recorte de
    // papel blanco. Una pantalla encendida NO es de un solo valor: la bombilla
    // está dentro y abajo, así que el borde inferior arde y el hombro superior
    // se queda en penumbra. Con un color plano y el emissive al alza salía un
    // cono blanco reventado que era lo más luminoso del cuadro — y lo más
    // luminoso del cuadro tiene que ser un libro, no un mueble auxiliar.
    const tela = texturaPantallaLampara();
    const pantalla = new THREE.Mesh(
        new THREE.CylinderGeometry(R * 0.66, R * 1.12, alto * 0.42, 24, 1, true),
        new THREE.MeshStandardMaterial({
            color: colorMaterial('--pantalla', '#E8C48A'),
            map: tela,
            // La pantalla es el único emisor visible de la escena. Sin
            // `emissive` sería un cono beige apagado con una luz saliendo de
            // dentro por arte de magia.
            emissive: colorMaterial('--pantalla', '#E8C48A'),
            emissiveMap: tela,
            emissiveIntensity: 0.34,
            roughness: 0.95,
            metalness: 0,
            side: THREE.DoubleSide,
            envMapIntensity: 0.1,
            userData: { entornoFijo: true }
        })
    );
    pantalla.position.y = alto * 0.78;
    grupo.add(pantalla);

    // La bombilla. `distance` acota hasta dónde llega: sin ella el punto
    // iluminaría la pared del fondo entera y la caída —que es justo lo que se
    // busca— desaparecería.
    const bombilla = new THREE.PointLight(0xFFD2A0, 2.7, alto * 6, 1.7);
    bombilla.position.y = alto * 0.80;
    grupo.add(bombilla);

    // Marcada para el raycaster: pulsar la lámpara la apaga. `esLampara` va en
    // el grupo entero, así que vale tanto el clic en la pantalla como en el pie.
    grupo.userData.esLampara = true;
    grupo.userData.etiqueta = 'Encender o apagar la lámpara';
    grupo.userData.bombilla = bombilla;
    grupo.userData.pantalla = pantalla.material;
    grupo.userData.brilloMaximo = bombilla.intensity;

    return grupo;
}

// Tres libros tumbados. La mesa vacía se leía como un sitio donde no pasa
// nada; una pila a medio leer dice de qué va la habitación, y es el único
// decorado de la escena que habla del tema de la app.
function construirPilaLibros(ancho) {
    const grupo = new THREE.Group();
    const fondo = ancho * 0.72;
    let y = 0;

    // Tonos de encuadernación, no del arcoíris: el hash repartía el tono por
    // toda la rueda y salían tres piezas turquesa que se leían como un juego
    // de platos. Marrón, granate y azul de biblioteca.
    const TONOS = [0.075, 0.99, 0.60];

    for (let i = 0; i < 3; i++) {
        const h = hashEstante('pila|' + i);
        // Chatos: un libro tumbado es mucho más ancho que grueso. Con el
        // grosor de antes eran tacos, y redondeados parecían pastillas.
        const alto = ancho * (0.055 + h * 0.035);
        const tapa = new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(TONOS[i], 0.22 + h * 0.14, 0.17 + h * 0.12)
                                    .convertSRGBToLinear(),
            roughness: 0.66 + h * 0.28,
            metalness: 0.03
        });
        const libro = new THREE.Mesh(
            new THREE.RoundedBoxGeometry(ancho * (0.84 + h * 0.16), alto,
                                         fondo * (0.84 + h * 0.16), 2, alto * 0.10),
            tapa
        );
        libro.position.y = y + alto / 2;
        // Nadie apila tres libros perfectamente a escuadra.
        libro.rotation.y = (h - 0.5) * 0.5;
        libro.castShadow = true;
        libro.receiveShadow = true;
        grupo.add(libro);
        y += alto;
    }

    return grupo;
}

// ----------------------------------------
// Montaje
// ----------------------------------------
// Devuelve el grupo ya colocado, o null si no hay nada que poner. Se le pasa
// la caja del MUEBLE: todo se sitúa relativo al estante —a sus lados y sobre
// el mismo suelo—, así que si el estante crece o encoge al filtrar, la
// escenografía le sigue en vez de quedarse flotando.
function construirEscenografia(mueble) {
    const caja = new THREE.Box3().setFromObject(mueble);
    if (caja.isEmpty()) return null;

    const tam = caja.getSize(new THREE.Vector3());
    const centro = caja.getCenter(new THREE.Vector3());
    const suelo = caja.min.y;           // el mueble se apoya; la escenografía también
    const frente = caja.max.z;

    const grupo = new THREE.Group();

    // Planta a la izquierda, alta: dos tercios del mueble. Una planta baja
    // junto a un mueble de esta altura se lee como un detalle, no como parte
    // de la habitación.
    //
    // Se coloca por el borde de la copa, no por el centro: la hoja más
    // exterior llega a ALCANCE + su largo, y con la planta más cerca las
    // hojas entraban por delante de la última balda y tapaban su rótulo. Esos
    // rótulos son el único sitio del muro donde se lee el nombre del tema.
    const ALTURA_PLANTA = tam.y * 0.68;
    const planta = construirPlanta(ALTURA_PLANTA);
    // El vuelo de la copa: el pecíolo más largo (0.30 · 0.30) más la hoja más
    // larga (0.30 · 1.08 · 1.14), por el coseno del ángulo al que sale. Los
    // números salen todos de construirPlanta y hay que traerlos a la vez que
    // allí — cada vez que la hoja ha crecido y esto se ha quedado atrás, la
    // copa ha vuelto a meterse por delante de la última balda, encima de su
    // rótulo, que es el único sitio del muro donde se lee el nombre del tema.
    const vueloCopa = ALTURA_PLANTA * 0.42;
    planta.position.set(caja.min.x - vueloCopa - tam.x * 0.02, suelo, frente - tam.z * 0.1);
    grupo.add(planta);

    // Mesa a la derecha, un poco por delante del plano del mueble. Las
    // siluetas que se solapan son lo que da profundidad a una escena; tres
    // objetos alineados en la misma z se ven como un friso.
    const ANCHO_MESA = tam.y * 0.30;
    const FONDO_MESA = tam.y * 0.22;
    const ALTO_MESA = tam.y * 0.28;
    const mesa = construirMesa(ANCHO_MESA, FONDO_MESA, ALTO_MESA);
    mesa.position.set(caja.max.x + tam.y * 0.20, suelo, frente + tam.z * 0.5);
    grupo.add(mesa);

    // Y encima, lo que hacía falta para que la mesa sea de alguien: la lámpara
    // detrás y a un lado, los libros delante. El origen local de la mesa está
    // en el suelo, así que el tablero cae justo a ALTO_MESA.
    const lamparaMesa = construirLamparaMesa(ALTO_MESA * 0.70);
    lamparaMesa.position.set(-ANCHO_MESA * 0.20, ALTO_MESA, -FONDO_MESA * 0.16);
    mesa.add(lamparaMesa);
    // El montaje necesita encontrarla para cablear el interruptor.
    grupo.userData.lampara = lamparaMesa;

    const pila = construirPilaLibros(ANCHO_MESA * 0.36);
    pila.position.set(ANCHO_MESA * 0.22, ALTO_MESA, FONDO_MESA * 0.14);
    pila.rotation.y = 0.34;
    mesa.add(pila);

    // LOS OBJETOS SON LA INTERFAZ. Desde que no hay barra ni menú flotante,
    // cada cosa que antes era un botón cuelga de una pieza de la habitación.
    //
    // El reparto no es arbitrario, es el que hace que se adivine: una pila de
    // libros sin colocar es lo que se da de alta, y una mesa de trabajo es
    // donde se busca y se ordena. La lámpara ya se encendía antes.
    //
    // Se marca la MESA y no el tablero: userData va en el grupo, y el
    // raycaster sube por los padres hasta encontrar una marca, así que valen
    // el tablero, el faldón y las patas. La pila se marca después y gana
    // porque está más cerca del rayo.
    // La acción va en el TABLERO, no en la mesa entera. Marcada en el grupo,
    // las cuatro patas y el faldón respondían también, y son un objeto alto y
    // estrecho barriendo mucha pantalla a la altura del suelo: pasabas el
    // cursor camino de cualquier otra cosa y saltaba el menú. Lo que invita a
    // pulsar una mesa de trabajo es su superficie.
    mesa.userData.tapa.userData.accion = 'menu';
    mesa.userData.tapa.userData.etiqueta = 'Buscar, filtrar y ajustes';
    pila.userData.accion = 'alta';
    pila.userData.etiqueta = 'Añadir una lectura';

    return grupo;
}

let muro = null;

// `baldas` son {id, nombre, color, libros}: cada una trae ya sus libros, de
// modo que la balda virtual "Sin tema" (los huérfanos, que no casan con
// ningún tema_id) se monta igual que las demás.
// `alPulsarAccion(accion)` es nuevo y lo trae el rediseño: la barra y el nav
// desaparecieron, así que las acciones que llevaban ahora cuelgan de objetos
// de la habitación. Recibe 'menu' (la mesa) o 'alta' (la pila de libros); la
// lámpara se resuelve aquí dentro, porque su estado es de este archivo.
function montarMuro(contenedor, baldas, alPulsarTema, alPulsarLibro, alSenalar,
                    alPulsarAccion) {
    desmontarMuro();
    if (!estanteDisponible) return false;

    const ctx = crearEscenaEstante(contenedor);
    const { escena, camara, pedirRender, registrar } = ctx;

    const ANCHO = 74;
    const FONDO = 14;
    const SEPARACION = 30;

    // El mueble va en su propio grupo, aparte de la pared y el suelo. Todo lo
    // que mide (encuadre de cámara, topes del paneo) mide ESTO, no la escena.
    const mueble = new THREE.Group();

    const grupos = [];
    const librosMesh = [];

    baldas.forEach((tema, i) => {
        const delTema = tema.libros;
        const grupo = new THREE.Group();
        grupo.position.y = -i * SEPARACION;

        const tabla = construirTabla(ANCHO, FONDO);
        tabla.position.y = -0.85;
        grupo.add(tabla);
        grupo.add(sombraDeContacto(ANCHO, FONDO));

        // Fondo del mueble: sostiene el rótulo y evita que los lomos floten
        // sobre la nada.
        const ALTO_TRASERA = SEPARACION - 2;
        const rotulo = registrar(texturaTrasera(tema.nombre, delTema.length, tema.color, ANCHO, ALTO_TRASERA));
        const maderaFondo = new THREE.MeshStandardMaterial({
            color: colorMaterial('--superficie-honda', '#100C09'),
            roughness: 1,
            metalness: 0
        });
        const caraRotulo = new THREE.MeshStandardMaterial({ map: rotulo, roughness: 1, metalness: 0 });
        // +X, -X, +Y, -Y, +Z (la cara que mira al espectador), -Z
        const trasera = new THREE.Mesh(GEOM_CAJA, [
            maderaFondo, maderaFondo, maderaFondo, maderaFondo, caraRotulo, maderaFondo
        ]);
        trasera.scale.set(ANCHO, ALTO_TRASERA, 0.6);
        trasera.position.set(0, ALTO_TRASERA / 2 - 1, -FONDO / 2);
        trasera.receiveShadow = true;
        grupo.add(trasera);

        tabla.userData = { temaId: tema.id, esBalda: true };
        trasera.userData = { temaId: tema.id, esBalda: true };

        // Los libros se apoyan de izquierda a derecha. Si el tema no cabe en
        // la balda, se muestran los que entran: el muro es un vistazo, el
        // recuento real lo da el canto y el detalle lo da el modal.
        // Se mide primero lo que cabe y luego se centra: apoyados desde el
        // borde izquierdo, un tema corto dejaba media tabla desierta.
        const caben = [];
        let usado = 0;
        for (const libro of delTema) {
            const g = grosorLomo(libro) + 0.32;
            if (usado + g > ANCHO - 6) break;
            caben.push(libro);
            usado += g;
        }

        let x = -usado / 2;
        caben.forEach(libro => {
            const g = grosorLomo(libro);
            const mallaLibro = construirLibro(libro, tema.color, false);
            mallaLibro.position.set(x + g / 2, 0, 0);
            // Una inclinación mínima y determinista: una fila perfectamente
            // recta se lee como render, no como estantería.
            mallaLibro.rotation.z = (hashEstante(libro.id + '|giro') - 0.5) * 0.035;
            grupo.add(mallaLibro);
            librosMesh.push(mallaLibro);
            x += g + 0.32;
        });

        mueble.add(grupo);
        grupos.push(grupo);
    });

    // La carcasa se mide sobre las baldas ya colocadas, así que va aquí y
    // no antes. Entra en el grupo `mueble`: gira con él y cuenta para el
    // encuadre.
    construirCarcasa(mueble, ANCHO, FONDO);

    escena.add(mueble);

    // La habitación se amuebla. Va a la escena y NO dentro de `mueble`: los
    // topes del paneo y del zoom siguen siendo los del estante, que es de lo
    // que va la app. Pero sí entra en `marco`, que es lo que la cámara
    // encuadra — si no, la planta queda fuera de cuadro y no la ve nadie.
    const escenografia = construirEscenografia(mueble);
    if (escenografia) escena.add(escenografia);

    const sala = construirHabitacion(escena, mueble, ctx.lampara, escenografia);
    ajustarEntorno(escena);

    const marco = escenografia ? [mueble, escenografia] : mueble;
    // Margen ajustado: con la escenografía dentro es el ANCHO el que manda el
    // encuadre, y el holgado 1.10 de cuando solo se medía el mueble dejaba una
    // franja de pared vacía arriba y abajo con el estante pequeño en medio.
    const enc = encuadrarEscena(camara, marco, 1.03);
    const controles = crearControles(camara, ctx.renderer.domElement, enc.centro, enc.dist);
    // Después de los controles: necesita su maxDistance para saber hasta dónde
    // hay que seguir viendo.
    ajustarProfundidad(camara, controles, escena);
    // El aviso de la navegación arranca el BUCLE, no un fotograma suelto: el
    // zoom ya no se aplica de una vez en el handler de la rueda, sino a
    // rebanadas desde animar(), y con un pedirRender() se pintaría la primera
    // y ahí se quedaría. (`animar` es una declaración de función, así que está
    // izada; y solo se invoca desde manejadores registrados más abajo, cuando
    // `navegacion` ya existe.)
    const navegacion = instalarNavegacion(contenedor, camara, escena, mueble, controles,
                                          () => animar(), enc.centro, sala.yPiso);
    // Una pasada al montar: fija el tope de inclinación que corresponde a la
    // distancia de partida, y corrige la vista restaurada si venía de una
    // sesión con el mueble más alto y ahora cae por debajo del suelo.
    navegacion.limitar();

    // La vista se restaura DESPUÉS de crear los controles: necesita fijar
    // también su target, no solo la posición de la cámara.
    if (aplicarVistaMuro(camara, controles, enc.centro, enc.dist)) controles?.update();

    // El encuadre automático solo manda hasta que el usuario toca el mueble.
    // Después, un cambio de tamaño de ventana solo ajusta el aspect ratio —que
    // ya hace redimensionar() por su cuenta—, y no le tira el ángulo elegido.
    let usuarioMovio = !!vistaMuro;
    ctx.fijarGanchoResize(() => {
        if (usuarioMovio) return;
        const e = encuadrarEscena(camara, marco, 1.03);
        controles?.target.copy(e.centro);
        controles?.update();
    });

    // ---- el interruptor de la lámpara
    //
    // Apagarla no es solo apagar su bombilla: si se apagara solo el punto de
    // luz, la habitación se quedaría igual de iluminada por la direccional y
    // el gesto no se notaría más que en un rincón. La direccional ES esa
    // lámpara —es la razón de que la clave sea ámbar y venga de la izquierda—,
    // así que se apaga con ella, y lo que queda es el relleno frío subido: luz
    // de calle entrando en un cuarto a oscuras.
    //
    // La sombra sigue congelada. Cambiar la INTENSIDAD de una luz no invalida
    // su mapa de sombras —es un uniform, no geometría—, así que congelarSombras
    // sigue siendo válido y el interruptor no cuesta un recálculo de 2048².
    const lamparaMesa = escenografia?.userData.lampara ?? null;
    const CLAVE_ENCENDIDA = ctx.lampara.intensity;
    const RELLENO_ENCENDIDO = ctx.relleno.intensity;
    const EMISION_ENCENDIDA = lamparaMesa?.userData.pantalla.emissiveIntensity ?? 0;

    let luzActual = luzLampara ? 1 : 0;
    let luzObjetivo = luzActual;

    function pintarLuz() {
        const k = luzActual;
        ctx.lampara.intensity = CLAVE_ENCENDIDA * (0.22 + 0.78 * k);
        // El relleno frío SUBE al apagar, no baja: es lo único que queda
        // iluminando y sin ello el mueble se hundiría en negro liso.
        ctx.relleno.intensity = RELLENO_ENCENDIDO * (1.55 - 0.55 * k);
        if (lamparaMesa) {
            lamparaMesa.userData.bombilla.intensity =
                lamparaMesa.userData.brilloMaximo * k;
            lamparaMesa.userData.pantalla.emissiveIntensity =
                EMISION_ENCENDIDA * (0.03 + 0.97 * k);
        }
    }

    // Se registra en el módulo para que el botón del DOM llegue hasta aquí.
    aplicarLuzMuro = () => {
        luzObjetivo = luzLampara ? 1 : 0;

        // Con la pestaña en segundo plano el navegador PARA requestAnimationFrame,
        // y como el fundido vive dentro del bucle de animación, el interruptor se
        // quedaba a medias: el estado decía "apagada" y las luces seguian al
        // máximo, esperando un fotograma que no llegaba hasta que volvieras a la
        // pestaña. Sin fotogramas no hay nada que interpolar y tampoco nadie
        // mirando, así que se salta el fundido y se aplica de golpe.
        if (document.hidden) {
            luzActual = luzObjetivo;
            pintarLuz();
            ctx.pedirRender();
            return;
        }
        animar();
    };

    pintarLuz();

    // ---- interacción
    const rayo = new THREE.Raycaster();
    const puntero = new THREE.Vector2();
    // Dos estados distintos, y confundirlos era un fallo. `resaltado` es el
    // libro que está sacado del estante, y solo puede ser un libro o nada;
    // `senalado` es lo último que estuvo bajo el cursor, sea lo que sea.
    let resaltado = null;
    let senalado = null;
    let girando = false;
    const objetivoZ = new WeakMap();

    // Parálax: el mueble se asoma unos grados hacia donde está el cursor y
    // vuelve solo al centro. Sustituye al desplazamiento libre del botón
    // izquierdo, que dejaba perderse.
    //
    // Va sobre la CÁMARA y no rotando el mueble, y eso importa: mover la
    // cámara no cambia ninguna sombra, así que el mapa de sombras congelado
    // sigue valiendo. Rotando el mueble habría que recalcularlo en cada
    // fotograma del hover.
    const PARALAJE = 3.4;
    const paralajeObjetivo = new THREE.Vector3();
    const paralajeAplicado = new THREE.Vector3();
    const ejeX = new THREE.Vector3();
    const ejeY = new THREE.Vector3();
    const paso3 = new THREE.Vector3();

    // LA RESPUESTA NO ES LINEAL, y esto es lo que quita el nerviosismo.
    //
    // Con una respuesta recta, medio centímetro de ratón en mitad de la
    // pantalla mueve la cámara lo mismo que medio centímetro en el borde: el
    // mueble reacciona a cualquier temblor y la escena no se queda nunca
    // quieta. Elevando al cuadrado —conservando el signo— la zona central se
    // vuelve casi insensible y el recorrido completo sigue llegando igual de
    // lejos en los bordes, que es donde uno sí quiere asomarse.
    //
    // Es el mismo truco que una zona muerta de mando, pero sin escalón: no hay
    // un punto donde el movimiento «empiece», simplemente crece despacio.
    const curva = v => v * Math.abs(v);

    function fijarParalaje(x, y) {
        // En ejes de la cámara, no del mundo: si el mueble está girado, el
        // desplazamiento tiene que seguir siendo hacia los lados de quien mira.
        camara.matrixWorld.extractBasis(ejeX, ejeY, paso3);
        paralajeObjetivo.set(0, 0, 0)
            .addScaledVector(ejeX, curva(x) * PARALAJE)
            .addScaledVector(ejeY, curva(y) * PARALAJE * 0.55);
        animar();
    }

    function aCoordenadas(evento) {
        const caja = contenedor.getBoundingClientRect();
        puntero.x = ((evento.clientX - caja.left) / caja.width) * 2 - 1;
        puntero.y = -((evento.clientY - caja.top) / caja.height) * 2 + 1;
    }

    function tocado() {
        rayo.setFromCamera(puntero, camara);
        const golpes = rayo.intersectObjects(escena.children, true);
        for (const golpe of golpes) {
            let o = golpe.object;
            while (o && !o.userData?.libroId && !o.userData?.esBalda
                     && !o.userData?.esLampara && !o.userData?.accion) o = o.parent;
            if (o) return o;
        }
        return null;
    }

    // Lo que hay bajo el cursor, descrito para quien mira. Antes solo se
    // avisaba de los libros; ahora también de la mesa, la pila y la lámpara,
    // porque son botones y NO LO PARECEN: sin barra ni menú visible, esta
    // pista es lo único que cuenta qué hace cada objeto. Una interfaz hecha de
    // objetos se sostiene sobre que al pasar por encima digan su nombre.
    function describir(grupo) {
        if (!grupo) return null;
        if (grupo.userData.libroId) return { libroId: grupo.userData.libroId };
        if (grupo.userData.etiqueta) return { etiqueta: grupo.userData.etiqueta };
        if (grupo.userData.esBalda) return { etiqueta: 'Ver tema' };
        return null;
    }

    function resaltar(grupo, evento) {
        // LA GUARDA VA SOBRE `senalado`, NO SOBRE `resaltado`, y este fue un
        // fallo real que costaba caro: `resaltado` solo vale un libro o null,
        // así que al pasar de un objeto-botón —la mesa, la lámpara— a un hueco
        // vacío, ambos lados de la comparación valían null, la función salía por
        // aquí y la pista NUNCA se ocultaba. Las etiquetas se quedaban pegadas
        // por la escena hasta que tocabas un libro o sacabas el ratón del
        // lienzo, que es la mitad de la sensación de desorden.
        if (senalado === grupo) return;
        senalado = grupo;

        // Solo los libros se levantan al pasar por encima. La lámpara, la mesa
        // y la pila entran aquí para poner el cursor de mano y su pista, pero
        // no se mueven: son interruptores, no objetos que se sacan del estante.
        const libro = grupo && grupo.userData.libroId ? grupo : null;
        if (resaltado !== libro) {
            if (resaltado) objetivoZ.set(resaltado, 0);
            if (libro) objetivoZ.set(libro, 3.4);
            resaltado = libro;
        }

        contenedor.style.cursor = grupo ? 'pointer' : '';
        if (alSenalar) alSenalar(describir(grupo), evento);
        animar();
    }

    // Tween propio, sin librería: interpola hacia el objetivo y se apaga solo
    // cuando ya no queda movimiento. Nada de bucle permanente.
    //
    // Este mismo bucle es el que hace avanzar la inercia de los controles.
    // OrbitControls con amortiguado necesita un update() por fotograma
    // mientras la inercia decae; sin él, al soltar el arrastre el movimiento
    // se corta en seco.
    let animando = false;
    function animar() {
        if (animando) return;
        animando = true;
        const paso = () => {
            let sigue = false;

            // El fundido de la lámpara. Va aquí y no en un bucle propio porque
            // este ya existe y ya sabe pararse solo. Un interruptor instantáneo
            // funciona, pero una lámpara que sube en un cuarto de segundo es la
            // diferencia entre cambiar un valor y encender una luz.
            // OJO con la variable: `sigue` significa "sigue habiendo fotograma
            // siguiente", y más abajo se usa TAMBIÉN como "algo se ha movido,
            // rehaz la sombra". Para el fundido de la luz eso sería falso y
            // caro: no se mueve nada, solo cambia una intensidad, y recalcular
            // un mapa de 2048² treinta veces por un interruptor es exactamente
            // lo que congelarSombras() existe para evitar. Por eso el fundido
            // pide fotograma por su cuenta y no toca `sigue`.
            let sigueLuz = false;
            if (Math.abs(luzObjetivo - luzActual) > 0.004) {
                luzActual += (luzObjetivo - luzActual) * 0.16;
                pintarLuz();
                sigueLuz = true;
            } else if (luzActual !== luzObjetivo) {
                luzActual = luzObjetivo;
                pintarLuz();
            }

            librosMesh.forEach(g => {
                const meta = objetivoZ.get(g) ?? 0;
                const d = meta - g.position.z;
                if (Math.abs(d) > 0.01) {
                    g.position.z += d * 0.18;
                    g.rotation.y = g.position.z * 0.035;
                    sigue = true;
                } else if (g.position.z !== meta) {
                    g.position.z = meta;
                    g.rotation.y = meta * 0.035;
                }
            });

            // El parálax se quita antes de update(): si no, los controles lo
            // leen como parte de la posición, lo absorben en sus esféricas y la
            // cámara deriva sola hasta quedarse torcida.
            camara.position.sub(paralajeAplicado);

            // Una rebanada del zoom pendiente. Lleva su propia bandera y no
            // toca `sigue`, que más abajo significa además "algo se movió,
            // rehaz la sombra" — y en un zoom no se mueve nada de la escena,
            // solo la cámara.
            // Va aquí, ya sin el parálax encima, para que el escalado se
            // aplique sobre la posición real de la cámara y no sobre la
            // desviada unos grados por el cursor.
            const sigueZoom = navegacion.pasoZoom();

            // update() devuelve true mientras la cámara siga moviéndose.
            const camaraSeMueve = controles ? controles.update() : false;

            paso3.subVectors(paralajeObjetivo, paralajeAplicado);
            let paralajeSeMueve = false;
            if (paso3.lengthSq() > 0.0004) {
                // 0.055 y no 0.10: el mueble llega al mismo sitio, pero va
                // detrás del cursor en vez de pegado a él. Pegado se siente
                // como un objeto agarrado al ratón; detrás, como una vitrina
                // a la que te asomas.
                paralajeAplicado.addScaledVector(paso3, 0.055);
                paralajeSeMueve = true;
            } else {
                paralajeAplicado.copy(paralajeObjetivo);
            }
            camara.position.add(paralajeAplicado);

            // Las sombras están congeladas para que girar salga fluido, pero
            // si se ha movido un LIBRO hay que rehacerlas: su sombra se
            // quedaría clavada donde estaba.
            if (sigue) ctx.lampara.shadow.needsUpdate = true;

            ctx.renderer.render(escena, camara);

            if (sigue || sigueLuz || sigueZoom || camaraSeMueve || paralajeSeMueve) {
                requestAnimationFrame(paso);
            } else {
                animando = false;
            }
        };
        requestAnimationFrame(paso);
    }

    function alMover(e) {
        // Durante el giro no se resalta ni se aplica parálax: serían sesenta
        // raycasts por segundo y dos movimientos peleándose.
        if (girando) return;
        aCoordenadas(e);
        fijarParalaje(puntero.x, puntero.y);
        resaltar(tocado(), e);
    }

    function alSalir() {
        paralajeObjetivo.set(0, 0, 0);
        resaltar(null);
        animar();
    }

    // Umbral en píxeles, no en tiempo: un arrastre lento y corto sigue siendo
    // un click. Sin esto, soltar el ratón después de girar abriría la balda
    // que hubiera quedado debajo del cursor.
    const UMBRAL_ARRASTRE = 4;
    let bajada = null;

    function alBajar(e) {
        bajada = { x: e.clientX, y: e.clientY };
    }

    function fueArrastre(e) {
        if (!bajada) return false;
        return Math.hypot(e.clientX - bajada.x, e.clientY - bajada.y) > UMBRAL_ARRASTRE;
    }

    function alHacerClick(e) {
        if (fueArrastre(e)) return;
        aCoordenadas(e);
        const o = tocado();
        if (!o) return;
        if (o.userData.libroId) {
            alPulsarLibro?.(o.userData.libroId);
        } else if (o.userData.esLampara) {
            alternarLuzLampara();
        } else if (o.userData.accion) {
            alPulsarAccion?.(o.userData.accion);
        } else if (o.userData.esBalda) {
            alPulsarTema?.(o.userData.temaId);
        }
    }

    // La vista persiste toda la sesión, así que hace falta una salida: sin
    // esto un ángulo raro se queda puesto y no hay forma de deshacerlo.
    function alDobleClick(e) {
        aCoordenadas(e);
        if (tocado()) return;          // solo sobre el fondo

        const e2 = encuadrarEscena(camara, marco, 1.03);
        if (controles) {
            controles.target.copy(e2.centro);
            controles.update();
        }

        // Se limpia DESPUÉS del update(), no antes: update() emite 'change'
        // de forma síncrona y el manejador de ahí abajo volvería a guardar
        // la vista y a marcar usuarioMovio, dejando el reencuadre
        // automático apagado para siempre.
        olvidarVistaMuro();
        usuarioMovio = false;
        ctx.pedirRender();
    }

    if (controles) {
        controles.addEventListener('start', () => {
            girando = true;
            usuarioMovio = true;
            resaltar(null);
            contenedor.classList.add('girando');
        });
        controles.addEventListener('end', () => {
            girando = false;
            contenedor.classList.remove('girando');
            guardarVistaMuro(camara, controles, enc.centro, enc.dist);
        });
        controles.addEventListener('change', () => {
            usuarioMovio = true;
            // El paneo puede llevarse el mueble fuera de cuadro: se topa aquí,
            // moviendo cámara y target a la vez para que no dé un tirón.
            navegacion.limitar();
            guardarVistaMuro(camara, controles, enc.centro, enc.dist);
            animar();
        });
        contenedor.classList.add('orbitable');
    }

    contenedor.addEventListener('pointerdown', alBajar);
    contenedor.addEventListener('pointermove', alMover);
    contenedor.addEventListener('pointerleave', alSalir);
    contenedor.addEventListener('click', alHacerClick);
    contenedor.addEventListener('dblclick', alDobleClick);

    pedirRender();
    ctx.congelarSombras();

    muro = {
        ctx,
        destruir() {
            // El interruptor del DOM apuntaba a este muro: se descuelga antes
            // que nada. El ESTADO (luzLampara) sobrevive a propósito — es lo
            // que hace que la lámpara siga apagada al teclear en el buscador.
            aplicarLuzMuro = null;
            contenedor.removeEventListener('pointerdown', alBajar);
            contenedor.removeEventListener('pointermove', alMover);
            contenedor.removeEventListener('pointerleave', alSalir);
            contenedor.removeEventListener('click', alHacerClick);
            contenedor.removeEventListener('dblclick', alDobleClick);
            contenedor.classList.remove('orbitable', 'girando');
            navegacion.destruir();
            if (controles) controles.dispose();
            ctx.destruir();
        },
        // El espejo DOM llama aquí para que el foco de teclado saque el mismo
        // libro que sacaría el ratón.
        enfocarLibro(id) {
            const g = librosMesh.find(m => m.userData.libroId === id);
            resaltar(g || null);
        }
    };

    return true;
}

function desmontarMuro() {
    if (muro) {
        muro.destruir();
        muro = null;
    }
}

function enfocarLibroEnMuro(id) {
    muro?.enfocarLibro(id);
}

// ----------------------------------------
// El modal: una balda por subtema
// ----------------------------------------

let estanteModal = null;

function montarEstanteModal(contenedor, tema, librosDelTema, alPulsarLibro) {
    desmontarEstanteModal();
    if (!estanteDisponible) return false;

    const ctx = crearEscenaEstante(contenedor);
    const { escena, camara, registrar } = ctx;

    const ANCHO = 80;
    const FONDO = 15;
    const SEPARACION = 30;

    // Agrupado por subtema conservando el orden de aparición, igual que hace
    // renderizarLibros() con la rejilla.
    const grupos = new Map();
    librosDelTema.forEach(l => {
        const clave = l.subtema || '';
        if (!grupos.has(clave)) grupos.set(clave, []);
        grupos.get(clave).push(l);
    });

    // El mueble va en su propio grupo, aparte de la pared y el suelo. Todo lo
    // que mide (encuadre de cámara, topes del paneo) mide ESTO, no la escena.
    const mueble = new THREE.Group();

    const librosMesh = [];
    const acento = tema?.color || token('--laton', '#BF8550');
    let fila = 0;

    for (const [subtema, delGrupo] of grupos) {
        // Un subtema con muchos libros ocupa varias tablas: se parte por lo
        // que cabe, no se encoge la tipografía hasta lo ilegible.
        const trozos = [];
        let actual = [];
        let ancho = 0;
        delGrupo.forEach(l => {
            const g = grosorLomo(l) + 0.34;
            if (ancho + g > ANCHO - 7 && actual.length) {
                trozos.push(actual);
                actual = [];
                ancho = 0;
            }
            actual.push(l);
            ancho += g;
        });
        if (actual.length) trozos.push(actual);

        trozos.forEach((trozo, iTrozo) => {
            const grupo = new THREE.Group();
            grupo.position.y = -fila * SEPARACION;

            const etiqueta = subtema || 'Sin subtema';
            const tabla = construirTabla(ANCHO, FONDO);
            tabla.position.y = -0.85;
            grupo.add(tabla);
            grupo.add(sombraDeContacto(ANCHO, FONDO));

            // Un subtema partido en varias tablas solo se rotula en la
            // primera: repetir el nombre en cada tramo lo convierte en ruido.
            const ALTO_TRASERA = SEPARACION - 2;
            const rotulo = registrar(texturaTrasera(
                iTrozo === 0 ? etiqueta : '',
                iTrozo === 0 ? delGrupo.length : '',
                acento, ANCHO, ALTO_TRASERA
            ));
            const maderaFondo = new THREE.MeshStandardMaterial({
                color: colorMaterial('--superficie-honda', '#100C09'),
                roughness: 1,
                metalness: 0
            });
            const caraRotulo = new THREE.MeshStandardMaterial({ map: rotulo, roughness: 1, metalness: 0 });
            const trasera = new THREE.Mesh(GEOM_CAJA, [
                maderaFondo, maderaFondo, maderaFondo, maderaFondo, caraRotulo, maderaFondo
            ]);
            trasera.scale.set(ANCHO, ALTO_TRASERA, 0.6);
            trasera.position.set(0, ALTO_TRASERA / 2 - 1, -FONDO / 2);
            trasera.receiveShadow = true;
            grupo.add(trasera);

            let anchoTrozo = 0;
            trozo.forEach(l => { anchoTrozo += grosorLomo(l) + 0.34; });
            let x = -anchoTrozo / 2;
            trozo.forEach(libro => {
                const g = grosorLomo(libro);
                const malla = construirLibro(libro, acento, true);
                malla.position.set(x + g / 2, 0, 0);
                malla.rotation.z = (hashEstante(libro.id + '|giro') - 0.5) * 0.03;
                grupo.add(malla);
                librosMesh.push(malla);
                x += g + 0.34;
            });

            mueble.add(grupo);
            fila++;
        });
    }

    escena.add(mueble);
    const sala = construirHabitacion(escena, mueble, ctx.lampara);
    ajustarEntorno(escena);

    const enc = encuadrarEscena(camara, mueble, 1.16);

    // Mismos límites que el muro: el mueble se comporta igual en los dos
    // sitios. La vista del modal NO se persiste — cada balda se abre de
    // frente, que es como quieres verla al entrar.
    const controles = crearControles(camara, ctx.renderer.domElement, enc.centro, enc.dist);
    ajustarProfundidad(camara, controles, escena);
    // Sin centro de vista propio —el modal no lleva escenografía, así que el
    // reencuadre cae en el centro del mueble— pero SÍ con la cota del suelo:
    // el tope de inclinación hace aquí la misma falta que en el muro.
    const navegacion = instalarNavegacion(contenedor, camara, escena, mueble, controles,
                                          () => animar(), null, sala.yPiso);
    navegacion.limitar();
    if (controles) contenedor.classList.add('orbitable');

    // ---- interacción (misma mecánica que el muro)
    const rayo = new THREE.Raycaster();
    const puntero = new THREE.Vector2();
    const objetivoZ = new WeakMap();
    let resaltado = null;
    let animando = false;

    function aCoordenadas(evento) {
        const caja = contenedor.getBoundingClientRect();
        puntero.x = ((evento.clientX - caja.left) / caja.width) * 2 - 1;
        puntero.y = -((evento.clientY - caja.top) / caja.height) * 2 + 1;
    }

    function tocado() {
        rayo.setFromCamera(puntero, camara);
        const golpes = rayo.intersectObjects(escena.children, true);
        for (const golpe of golpes) {
            let o = golpe.object;
            while (o && !o.userData?.libroId) o = o.parent;
            if (o) return o;
        }
        return null;
    }

    function animar() {
        if (animando) return;
        animando = true;
        const paso = () => {
            let sigue = false;
            librosMesh.forEach(g => {
                const meta = objetivoZ.get(g) ?? 0;
                const d = meta - g.position.z;
                if (Math.abs(d) > 0.01) {
                    g.position.z += d * 0.2;
                    g.rotation.y = -g.position.z * 0.06;
                    sigue = true;
                } else if (g.position.z !== meta) {
                    g.position.z = meta;
                    g.rotation.y = -meta * 0.06;
                }
            });
            // Una rebanada del zoom pendiente. Lleva su propia bandera y no
            // toca `sigue`, que más abajo significa además "algo se movió,
            // rehaz la sombra" — y en un zoom no se mueve nada de la escena,
            // solo la cámara.
            const sigueZoom = navegacion.pasoZoom();

            // update() devuelve true mientras la cámara siga moviéndose. Con
            // amortiguado, la inercia solo avanza si esto corre cada
            // fotograma; antes solo se llamaba mientras un libro se movía y
            // al soltar el giro se paraba de golpe.
            const camaraSeMueve = controles ? controles.update() : false;
            if (sigue) ctx.lampara.shadow.needsUpdate = true;
            ctx.renderer.render(escena, camara);
            if (sigue || sigueZoom || camaraSeMueve) requestAnimationFrame(paso);
            else animando = false;
        };
        requestAnimationFrame(paso);
    }

    function resaltar(grupo) {
        if (resaltado === grupo) return;
        if (resaltado) objetivoZ.set(resaltado, 0);
        resaltado = grupo;
        if (resaltado) objetivoZ.set(resaltado, 5.5);
        contenedor.style.cursor = grupo ? 'pointer' : '';
        animar();
    }

    let girando = false;
    let bajada = null;

    function alMover(e) {
        if (girando) return;
        aCoordenadas(e);
        resaltar(tocado());
    }
    function alSalir() { resaltar(null); }
    function alBajar(e) { bajada = { x: e.clientX, y: e.clientY }; }

    // Igual que en el muro: sin umbral, soltar tras girar abriría el libro
    // que hubiera quedado debajo del cursor.
    function alHacerClick(e) {
        if (bajada && Math.hypot(e.clientX - bajada.x, e.clientY - bajada.y) > 4) return;
        aCoordenadas(e);
        const o = tocado();
        if (o?.userData.libroId) alPulsarLibro?.(o.userData.libroId);
    }

    if (controles) {
        controles.addEventListener('start', () => {
            girando = true;
            resaltar(null);
            contenedor.classList.add('girando');
        });
        controles.addEventListener('end', () => {
            girando = false;
            contenedor.classList.remove('girando');
        });
        controles.addEventListener('change', () => {
            navegacion.limitar();
            animar();
        });
    }

    contenedor.addEventListener('pointerdown', alBajar);
    contenedor.addEventListener('pointermove', alMover);
    contenedor.addEventListener('pointerleave', alSalir);
    contenedor.addEventListener('click', alHacerClick);

    ctx.pedirRender();
    ctx.congelarSombras();

    estanteModal = {
        destruir() {
            contenedor.removeEventListener('pointerdown', alBajar);
            contenedor.removeEventListener('pointermove', alMover);
            contenedor.removeEventListener('pointerleave', alSalir);
            contenedor.removeEventListener('click', alHacerClick);
            contenedor.classList.remove('orbitable', 'girando');
            navegacion.destruir();
            if (controles) controles.dispose();
            ctx.destruir();
        },
        enfocarLibro(id) {
            const g = librosMesh.find(m => m.userData.libroId === id);
            resaltar(g || null);
        },
        redimensionar: ctx.redimensionar
    };

    return true;
}

function desmontarEstanteModal() {
    if (estanteModal) {
        estanteModal.destruir();
        estanteModal = null;
    }
}

function enfocarLibroEnModal(id) {
    estanteModal?.enfocarLibro(id);
}

function redimensionarEstanteModal() {
    estanteModal?.redimensionar();
}
