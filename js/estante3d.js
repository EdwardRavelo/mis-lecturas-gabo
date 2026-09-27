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
    const base = new THREE.Color(acentoHex || '#C9A227');
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    const n = hashEstante(libro.id + '|lomo');
    const m = hashEstante(libro.id + '|luz');

    // El jitter de saturación se calcula igual para todos y DESPUÉS se atenúa,
    // para que dos libros grises sigan sin ser idénticos entre sí.
    const croma = Math.max(0.30, Math.min(0.82, hsl.s + (m - 0.5) * 0.26));
    const factor = CROMA_POR_ESTADO[libro.estado] ?? CROMA_POR_ESTADO['Pendiente'];

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
        // sí varía es por libro, y el rango subió de 0.13–0.38 a 0.20–0.55:
        // acotado tan abajo, todo el mueble se veía apagado.
        Math.max(0.20, Math.min(0.55, hsl.l * 0.86 + (n - 0.5) * 0.22))
    );
}

function colorEstado(estado) {
    if (estado === 'Leído') return token('--leido', '#2FA377');
    if (estado === 'Leyendo') return token('--leyendo', '#BE831C');
    return token('--pendiente', '#8676E0');
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

    ctx.fillStyle = token('--superficie-honda', '#100C09');
    ctx.fillRect(0, 0, W, H);

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
    ctx.fillStyle = token('--tinta', '#F4EDE3');
    ctx.fillText(nombre, W * 0.035, H * 0.13, W * 0.72);

    const anchoNombre = Math.min(ctx.measureText(nombre).width, W * 0.72);
    ctx.font = '600 ' + Math.round(cuerpo * 0.72) + 'px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillStyle = acentoHex || token('--laton', '#C9A227');
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

    const papel = new THREE.Color(token('--tinta-suave', '#C3B4A2')).multiplyScalar(0.94);
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
               token('--madera-clara', '#7A5335'), token('--madera', '#4A3120'));

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
    ctx.fillStyle = token('--laton', '#C9A227');
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
                    if (m.map) m.map.dispose();
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

    return { escena, camara, renderer, lampara, pedirRender, redimensionar,
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
    polarMin: Math.PI * 0.38,     // ±20° alrededor de la horizontal
    polarMax: Math.PI * 0.62,
    // Fracciones de la distancia encuadrada. 0.22 deja el encuadre en una
    // balda aproximadamente: acercarse a leer los lomos es media razón de
    // que exista el zoom, y con 0.55 te quedabas mirando el mueble entero.
    cerca: 0.22,
    lejos: 1.6
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

    // Izquierda desplaza, rueda pulsada gira: navegar es lo que se hace
    // todo el rato y se queda en el gesto principal; girar es el gesto de
    // mirar. El botón derecho queda libre a propósito.
    c.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.ROTATE,
        RIGHT: null
    };
    c.enablePan = true;
    c.panSpeed = 0.9;
    // En el plano de pantalla: el mueble es una pared, y panear siguiendo
    // el suelo lo mandaría hacia atrás en vez de hacia los lados.
    c.screenSpacePanning = true;
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
    if (THREE.TOUCH) {
        c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
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
function instalarNavegacion(contenedor, camara, escena, mueble, controles, alCambiar) {
    if (!controles) return { limitar() {}, destruir() {} };

    // Topes del paneo: la caja del MUEBLE con holgura. Medir la escena daría
    // los límites de la pared, que es enorme, y no sujetarían nada.
    const caja = new THREE.Box3().setFromObject(mueble);
    const holgura = caja.getSize(new THREE.Vector3()).multiplyScalar(0.12);
    const minTarget = caja.min.clone().sub(holgura);
    const maxTarget = caja.max.clone().add(holgura);

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
    }

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
            destino.copy(golpes[0].point);
        } else {
            camara.getWorldDirection(normal);
            plano.setFromNormalAndCoplanarPoint(normal, controles.target);
            if (!rayo.ray.intersectPlane(plano, destino)) return;
        }

        const distancia = camara.position.distanceTo(controles.target);
        if (distancia <= 0) return;

        const paso = evento.deltaY < 0 ? 0.86 : 1 / 0.86;
        const nueva = Math.min(Math.max(distancia * paso, controles.minDistance),
                               controles.maxDistance);
        const factor = nueva / distancia;
        if (Math.abs(factor - 1) < 0.0005) return;   // ya está en el tope

        camara.position.sub(destino).multiplyScalar(factor).add(destino);
        controles.target.sub(destino).multiplyScalar(factor).add(destino);

        limitar();
        controles.update();
        alCambiar?.();
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

function encuadrarEscena(camara, objeto, margen) {
    // OJO: mide el MUEBLE, no la escena. Desde que hay pared y suelo, medir
    // la escena entera dispararía la caja envolvente y la cámara se iría
    // hasta dejar el mueble del tamaño de un sello.
    const caja = new THREE.Box3().setFromObject(objeto);
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

function texturaPared(colorBase) {
    const lienzo = document.createElement('canvas');
    lienzo.width = 32;
    lienzo.height = 256;
    const ctx = lienzo.getContext('2d');

    // Una direccional no tiene caída, así que sin esto la pared quedaría
    // igual de iluminada arriba que abajo y se leería como un telón.
    const base = new THREE.Color(colorBase || token('--pared', '#0F1A1E'));
    const arriba = base.clone().multiplyScalar(2.1);
    const abajo = base.clone().multiplyScalar(0.55);

    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#' + arriba.getHexString());
    g.addColorStop(0.55, '#' + base.getHexString());
    g.addColorStop(1, '#' + abajo.getHexString());
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 256);

    const tex = new THREE.CanvasTexture(lienzo);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

function construirHabitacion(escena, mueble, lampara) {
    const caja = new THREE.Box3().setFromObject(mueble);
    const tam = caja.getSize(new THREE.Vector3());
    const centro = caja.getCenter(new THREE.Vector3());

    // La pared va a todo lo ancho. El caso exigente no es el encuadre inicial
    // sino el peor: cámara al máximo alejamiento (1.6× la distancia
    // encuadrada, unas 400 unidades) Y girada al tope de ±30°. Ahí la cámara
    // se desplaza lateralmente 400·sen(30°) ≈ 200, y todavía ve unas 140 más
    // hacia ese lado: el punto visible más lejano cae a ~340 del centro.
    //
    // Con 7× el ancho del mueble la semianchura era 260 y asomaba el negro.
    // Un plano son dos triángulos, así que pasarse no cuesta nada y quedarse
    // corto se ve al instante.
    const ancho = Math.max(tam.x * 14, 1000);
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

    const pared = new THREE.Mesh(
        new THREE.PlaneGeometry(ancho, alto),
        new THREE.MeshStandardMaterial(acabado({ map: texturaPared(token('--pared', '#0F1A1E')) }))
    );
    pared.position.set(centro.x, centro.y, caja.min.z - 10);
    pared.receiveShadow = true;
    escena.add(pared);

    // Un plano horizontal recibe la luz cenital casi de frente, mientras que
    // la pared la recibe rasante: con el mismo color, el suelo sale mucho más
    // encendido y vuelve a leerse como una repisa clara bajo el mueble. Se
    // compensa oscureciéndolo aparte, no bajando la luz de toda la escena.
    //
    // Y va bien por debajo de la balda inferior: pegado a ella parecía otra
    // tabla más.
    const suelo = new THREE.Mesh(
        new THREE.PlaneGeometry(ancho, ancho),
        new THREE.MeshStandardMaterial(acabado({
            color: new THREE.Color(token('--suelo', '#0A1114')).multiplyScalar(0.45)
        }))
    );
    suelo.rotation.x = -Math.PI / 2;
    suelo.position.set(centro.x, caja.min.y - 42, caja.max.z + tam.z * 0.6);
    suelo.receiveShadow = true;
    escena.add(suelo);

    // El frustum de sombra tiene que abarcar el mueble MÁS la pared y el suelo.
    // Si se queda corto, la sombra aparece cortada por una recta a media pared,
    // que es peor que no tener sombra. No se escala con `ancho`, que ahora es
    // enorme: basta con cubrir el mueble y su sombra proyectada.
    const alcance = Math.max(tam.x, tam.y) * 0.75 + 45;
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

// ----------------------------------------
// El muro: una balda por tema
// ----------------------------------------

let muro = null;

// `baldas` son {id, nombre, color, libros}: cada una trae ya sus libros, de
// modo que la balda virtual "Sin tema" (los huérfanos, que no casan con
// ningún tema_id) se monta igual que las demás.
function montarMuro(contenedor, baldas, alPulsarTema, alPulsarLibro, alSenalar) {
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
            color: new THREE.Color(token('--superficie-honda', '#100C09')),
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

    escena.add(mueble);
    construirHabitacion(escena, mueble, ctx.lampara);
    ajustarEntorno(escena);

    const enc = encuadrarEscena(camara, mueble, 1.10);
    const controles = crearControles(camara, ctx.renderer.domElement, enc.centro, enc.dist);
    const navegacion = instalarNavegacion(contenedor, camara, escena, mueble, controles,
                                          () => ctx.pedirRender());

    // La vista se restaura DESPUÉS de crear los controles: necesita fijar
    // también su target, no solo la posición de la cámara.
    if (aplicarVistaMuro(camara, controles, enc.centro, enc.dist)) controles?.update();

    // El encuadre automático solo manda hasta que el usuario toca el mueble.
    // Después, un cambio de tamaño de ventana solo ajusta el aspect ratio —que
    // ya hace redimensionar() por su cuenta—, y no le tira el ángulo elegido.
    let usuarioMovio = !!vistaMuro;
    ctx.fijarGanchoResize(() => {
        if (usuarioMovio) return;
        const e = encuadrarEscena(camara, mueble, 1.10);
        controles?.target.copy(e.centro);
        controles?.update();
    });

    // ---- interacción
    const rayo = new THREE.Raycaster();
    const puntero = new THREE.Vector2();
    let resaltado = null;
    let girando = false;
    const objetivoZ = new WeakMap();

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
            while (o && !o.userData?.libroId && !o.userData?.esBalda) o = o.parent;
            if (o) return o;
        }
        return null;
    }

    function resaltar(grupo, evento) {
        if (resaltado === grupo) return;
        if (resaltado) objetivoZ.set(resaltado, 0);
        resaltado = grupo && grupo.userData.libroId ? grupo : null;
        if (resaltado) objetivoZ.set(resaltado, 3.4);
        contenedor.style.cursor = grupo ? 'pointer' : '';
        // En el muro los lomos no llevan texto: sin esto no hay forma de
        // saber qué es un libro sin abrirlo. El raycaster ya lo sabe.
        if (alSenalar) alSenalar(resaltado?.userData.libroId ?? null, evento);
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

            // update() devuelve true mientras la cámara siga moviéndose.
            const camaraSeMueve = controles ? controles.update() : false;

            // Las sombras están congeladas para que girar salga fluido, pero
            // si se ha movido un LIBRO hay que rehacerlas: su sombra se
            // quedaría clavada donde estaba.
            if (sigue) ctx.lampara.shadow.needsUpdate = true;

            ctx.renderer.render(escena, camara);

            if (sigue || camaraSeMueve) {
                requestAnimationFrame(paso);
            } else {
                animando = false;
            }
        };
        requestAnimationFrame(paso);
    }

    function alMover(e) {
        // Durante el arrastre no se resalta: serían sesenta raycasts por
        // segundo y el tooltip iría parpadeando mientras giras.
        if (girando) return;
        aCoordenadas(e);
        resaltar(tocado(), e);
    }

    function alSalir() {
        resaltar(null);
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
        } else if (o.userData.esBalda) {
            alPulsarTema?.(o.userData.temaId);
        }
    }

    // La vista persiste toda la sesión, así que hace falta una salida: sin
    // esto un ángulo raro se queda puesto y no hay forma de deshacerlo.
    function alDobleClick(e) {
        aCoordenadas(e);
        if (tocado()) return;          // solo sobre el fondo

        const e2 = encuadrarEscena(camara, mueble, 1.10);
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
    const acento = tema?.color || token('--laton', '#C9A227');
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
                color: new THREE.Color(token('--superficie-honda', '#100C09')),
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
    construirHabitacion(escena, mueble, ctx.lampara);
    ajustarEntorno(escena);

    const enc = encuadrarEscena(camara, mueble, 1.16);

    // Mismos límites que el muro: el mueble se comporta igual en los dos
    // sitios. La vista del modal NO se persiste — cada balda se abre de
    // frente, que es como quieres verla al entrar.
    const controles = crearControles(camara, ctx.renderer.domElement, enc.centro, enc.dist);
    const navegacion = instalarNavegacion(contenedor, camara, escena, mueble, controles,
                                          () => ctx.pedirRender());
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
            // update() devuelve true mientras la cámara siga moviéndose. Con
            // amortiguado, la inercia solo avanza si esto corre cada
            // fotograma; antes solo se llamaba mientras un libro se movía y
            // al soltar el giro se paraba de golpe.
            const camaraSeMueve = controles ? controles.update() : false;
            if (sigue) ctx.lampara.shadow.needsUpdate = true;
            ctx.renderer.render(escena, camara);
            if (sigue || camaraSeMueve) requestAnimationFrame(paso);
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
