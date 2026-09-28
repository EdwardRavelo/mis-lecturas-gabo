// ========================================
// Autenticación con Supabase (solo GitHub)
// Mis Lecturas Gabo
// ========================================

let usuarioActual = null;

// Modo offline: la app funciona con localStorage, sin nube.
// Se activa cuando Supabase no está disponible (proyecto pausado, sin red,
// CDN bloqueado) o cuando el usuario elige entrar sin cuenta.
let modoOffline = false;

// Timeout para no quedarnos colgados esperando a Supabase.
const AUTH_TIMEOUT_MS = 8000;

// ----------------------------------------
// Utilidad: promesa con límite de tiempo
// ----------------------------------------

function conTimeout(promesa, ms, etiqueta) {
    return Promise.race([
        promesa,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: ${etiqueta}`)), ms)
        )
    ]);
}

// ----------------------------------------
// Inicialización de Auth
// Retorna el usuario si hay sesión activa, null si no.
// Lanza si Supabase no responde a tiempo → el llamador entra en modo offline.
// ----------------------------------------

async function inicializarAuth() {
    if (!supabaseConfigurado) return null;

    // Escuchar cambios de sesión FUTUROS (login, logout)
    // INITIAL_SESSION se ignora aquí porque lo manejamos con getSession()
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        console.log('[Auth] evento:', event);

        if (event === 'SIGNED_IN') {
            // Solo actuar en SIGNED_IN si el usuario cambió
            // (evitar doble carga si ya lo manejó getSession)
            const nuevoUsuario = session?.user ?? null;
            if (nuevoUsuario && nuevoUsuario.id !== usuarioActual?.id) {
                usuarioActual = nuevoUsuario;
                modoOffline = false;
                await onLogin(usuarioActual);
            }
        } else if (event === 'SIGNED_OUT') {
            usuarioActual = null;
            onLogout();
        } else if (event === 'TOKEN_REFRESHED') {
            usuarioActual = session?.user ?? null;
        }
    });

    // Recuperar sesión activa al cargar (source of truth)
    const { data: { session } } = await conTimeout(
        supabaseClient.auth.getSession(),
        AUTH_TIMEOUT_MS,
        'getSession'
    );
    usuarioActual = session?.user ?? null;
    return usuarioActual;
}

// ----------------------------------------
// Login con OAuth
// ----------------------------------------
// GitHub es el único proveedor habilitado en el proyecto Supabase. Hubo un
// botón de Google en la interfaz, pero el proveedor nunca se dio de alta y
// devolvía validation_failed, así que se retiró. Ver CLAUDE.md si alguna
// vez se añade: los datos cuelgan del user_id que creó GitHub.

async function loginConGitHub() {
    if (!supabaseConfigurado) {
        mostrarErrorAuth('La nube no está disponible. Usa "Entrar sin conexión".');
        return;
    }

    const { error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'github',
        options: {
            redirectTo: window.location.origin + window.location.pathname
        }
    });
    if (error) {
        console.error('Error al iniciar sesión con GitHub:', error.message);
        mostrarErrorAuth('No se pudo conectar con GitHub. Puedes entrar sin conexión.');
    }
}

async function cerrarSesion() {
    if (supabaseConfigurado) {
        const { error } = await supabaseClient.auth.signOut();
        if (error) console.error('Error al cerrar sesión:', error.message);
    }
    // Forzar logout en UI sin esperar el evento SIGNED_OUT
    // (el evento puede no llegar si el token ya expiró o hay error de red)
    usuarioActual = null;
    modoOffline = false;
    onLogout();
}

// ----------------------------------------
// Modo offline
// ----------------------------------------

async function entrarModoOffline(motivo) {
    console.warn('[Auth] Modo offline:', motivo);
    modoOffline = true;
    usuarioActual = null;

    ocultarPantallaLogin();
    actualizarUIUsuario(null);
    mostrarBannerOffline(motivo);

    await window.gaboApp.cargarDatos();
    window.gaboApp.actualizarInterfaz();
}

function mostrarBannerOffline(motivo) {
    const banner = document.getElementById('offline-banner');
    const texto = document.getElementById('offline-banner-text');
    if (!banner) return;

    if (texto) texto.textContent = motivo || 'Sin conexión con la nube.';
    banner.style.display = 'flex';
    // El banner va fixed: sin esto taparía la leyenda y el botón del menú.
    document.body.classList.add('con-banner');
}

function ocultarBannerOffline() {
    const banner = document.getElementById('offline-banner');
    if (banner) banner.style.display = 'none';
    document.body.classList.remove('con-banner');
}

// ----------------------------------------
// Callbacks de sesión
// ----------------------------------------

async function onLogin(usuario) {
    console.log('[Auth] Sesión iniciada:', usuario.email || usuario.id);
    modoOffline = false;
    ocultarPantallaLogin();
    ocultarBannerOffline();
    actualizarUIUsuario(usuario);

    // Ya no hay migración desde localStorage: con el esquema v2 el catálogo
    // vive en Supabase y localStorage es solo caché de lectura.
    await window.gaboApp.cargarDatos();
    window.gaboApp.actualizarInterfaz();
}

function onLogout() {
    console.log('[Auth] Sesión cerrada');
    usuarioActual = null;
    ocultarBannerOffline();
    mostrarPantallaLogin();
    actualizarUIUsuario(null);
}

// ----------------------------------------
// UI de autenticación
// ----------------------------------------

function mostrarPantallaLogin() {
    const loginScreen = document.getElementById('login-screen');
    const appLayout = document.querySelector('.library-layout');
    if (loginScreen) loginScreen.classList.add('active');
    if (appLayout) appLayout.style.display = 'none';
    // El mueble de fondo. Va después de mostrar la pantalla: un contenedor
    // oculto mide 0 y la cámara saldría con un aspecto absurdo.
    window.gaboApp?.montarFondoLogin?.();
}

function ocultarPantallaLogin() {
    const loginScreen = document.getElementById('login-screen');
    const appLayout = document.querySelector('.library-layout');
    if (loginScreen) loginScreen.classList.remove('active');
    if (appLayout) appLayout.style.display = 'flex';
    // Se libera el fondo antes de que se monte el estante de verdad. En
    // rigor renderizarLibros() ya lo haría, pero dejarlo explícito evita
    // que el día de mañana alguien cambie ese orden y se encuentre con dos
    // contextos WebGL vivos.
    desmontarMuro();
}

function actualizarUIUsuario(usuario) {
    const userAvatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name');
    const userMenu = document.getElementById('user-menu');

    if (!userAvatar || !userName) return;

    if (usuario) {
        const avatarUrl = usuario.user_metadata?.avatar_url;
        const nombre = usuario.user_metadata?.name || usuario.user_metadata?.full_name || usuario.email?.split('@')[0] || 'Lector';
        const inicial = nombre.charAt(0).toUpperCase();

        if (avatarUrl) {
            userAvatar.innerHTML = `<img src="${avatarUrl}" alt="${nombre}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        } else {
            userAvatar.textContent = inicial;
        }

        userName.textContent = nombre;
        if (userMenu) userMenu.style.display = 'flex';
    } else if (modoOffline) {
        // En offline mostramos el widget con identidad local, para que el
        // botón de "cerrar sesión" siga disponible y se pueda volver al login.
        userAvatar.textContent = '⬤';
        userName.textContent = 'Local';
        if (userMenu) userMenu.style.display = 'flex';
    } else {
        userAvatar.textContent = '?';
        userName.textContent = '';
        if (userMenu) userMenu.style.display = 'none';
    }
}

function mostrarErrorAuth(mensaje) {
    const errorEl = document.getElementById('auth-error');
    if (errorEl) {
        errorEl.textContent = mensaje;
        errorEl.style.display = 'block';
        setTimeout(() => { errorEl.style.display = 'none'; }, 6000);
    }
}

// ----------------------------------------
// Inicializar listeners de botones de auth
// ----------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    const btnGitHub = document.getElementById('btn-login-github');
    const btnOffline = document.getElementById('btn-login-offline');
    const btnLogout = document.getElementById('btn-logout');

    if (btnGitHub) btnGitHub.addEventListener('click', loginConGitHub);
    if (btnOffline) {
        btnOffline.addEventListener('click', () =>
            entrarModoOffline('Estás trabajando sin conexión. Los cambios se guardan en este navegador.')
        );
    }
    if (btnLogout) btnLogout.addEventListener('click', cerrarSesion);
});
