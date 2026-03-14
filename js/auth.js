// ========================================
// Autenticación con Supabase
// Mis Lecturas Gabo
// ========================================

let usuarioActual = null;

// ----------------------------------------
// Estado de sesión
// ----------------------------------------

async function inicializarAuth() {
    if (!supabaseConfigurado) return null;

    // Escuchar cambios de sesión (login, logout, token refresh)
    supabase.auth.onAuthStateChange(async (event, session) => {
        usuarioActual = session?.user ?? null;

        if (event === 'SIGNED_IN') {
            await onLogin(usuarioActual);
        } else if (event === 'SIGNED_OUT') {
            onLogout();
        }
    });

    // Recuperar sesión activa al cargar
    const { data: { session } } = await supabase.auth.getSession();
    usuarioActual = session?.user ?? null;
    return usuarioActual;
}

// ----------------------------------------
// Login con OAuth
// ----------------------------------------

async function loginConGitHub() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
            redirectTo: window.location.origin + window.location.pathname
        }
    });
    if (error) {
        console.error('Error al iniciar sesión con GitHub:', error.message);
        mostrarErrorAuth('No se pudo conectar con GitHub. Intenta de nuevo.');
    }
}

async function loginConGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
            redirectTo: window.location.origin + window.location.pathname
        }
    });
    if (error) {
        console.error('Error al iniciar sesión con Google:', error.message);
        mostrarErrorAuth('No se pudo conectar con Google. Intenta de nuevo.');
    }
}

async function cerrarSesion() {
    const { error } = await supabase.auth.signOut();
    if (error) {
        console.error('Error al cerrar sesión:', error.message);
    }
}

// ----------------------------------------
// Callbacks de sesión
// ----------------------------------------

async function onLogin(usuario) {
    console.log('Sesión iniciada:', usuario.email || usuario.id);
    ocultarPantallaLogin();
    actualizarUIUsuario(usuario);

    // Cargar datos del usuario desde Supabase y refrescar UI
    await window.gaboApp.cargarDatos();
    window.gaboApp.inicializarEventListeners();
    window.gaboApp.actualizarInterfaz();
}

function onLogout() {
    console.log('Sesión cerrada');
    usuarioActual = null;
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
}

function ocultarPantallaLogin() {
    const loginScreen = document.getElementById('login-screen');
    const appLayout = document.querySelector('.library-layout');
    if (loginScreen) loginScreen.classList.remove('active');
    if (appLayout) appLayout.style.display = '';
}

function actualizarUIUsuario(usuario) {
    const userAvatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name');
    const userMenu = document.getElementById('user-menu');

    if (!userAvatar || !userName) return;

    if (usuario) {
        const avatarUrl = usuario.user_metadata?.avatar_url;
        const nombre = usuario.user_metadata?.name || usuario.user_metadata?.full_name || usuario.email?.split('@')[0] || 'Lector';

        if (avatarUrl) {
            userAvatar.innerHTML = `<img src="${avatarUrl}" alt="${nombre}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        } else {
            userAvatar.textContent = nombre.charAt(0).toUpperCase();
        }

        userName.textContent = nombre;
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
        setTimeout(() => { errorEl.style.display = 'none'; }, 4000);
    }
}

// ----------------------------------------
// Inicializar listeners de botones de auth
// ----------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    const btnGitHub = document.getElementById('btn-login-github');
    const btnGoogle = document.getElementById('btn-login-google');
    const btnLogout = document.getElementById('btn-logout');

    if (btnGitHub) btnGitHub.addEventListener('click', loginConGitHub);
    if (btnGoogle) btnGoogle.addEventListener('click', loginConGoogle);
    if (btnLogout) btnLogout.addEventListener('click', cerrarSesion);
});
