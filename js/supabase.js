// ========================================
// Cliente Supabase
// Mis Lecturas Gabo
// ========================================
// IMPORTANTE: este archivo nunca debe lanzar una excepción.
// Si lo hace, `supabaseClient` y `supabaseConfigurado` quedan sin
// inicializar y app.js muere con un ReferenceError → pantalla en blanco.
// Por eso usamos `var` (no `const`) y envolvemos todo en try/catch:
// si el CDN de supabase-js no carga o las credenciales son inválidas,
// la app sigue funcionando en modo offline con localStorage.

// Credenciales del proyecto Supabase
// Reemplaza estos valores con los de tu proyecto en https://supabase.com/dashboard
var SUPABASE_URL = 'https://qzkgnapnwcklstqaavxj.supabase.co';
var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6a2duYXBud2NrbHN0cWFhdnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NTQyMjAsImV4cCI6MjA4OTAzMDIyMH0.lLlLkU5ZpG2eX4voFgep63DSj7VPxbTTkuoHJ-5S6M8';

// Usamos 'supabaseClient' para no colisionar con el objeto global 'supabase' del CDN
var supabaseClient = null;
var supabaseConfigurado = false;

(function inicializarSupabase() {
    if (!SUPABASE_URL || SUPABASE_URL === 'TU_SUPABASE_URL' ||
        !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY === 'TU_SUPABASE_ANON_KEY') {
        console.warn('[Supabase] Sin credenciales. La app funcionará en modo offline con localStorage.');
        return;
    }

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.warn('[Supabase] El CDN de supabase-js no cargó. Modo offline con localStorage.');
        return;
    }

    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        supabaseConfigurado = true;
        console.log('[Supabase] Cliente inicializado.');
    } catch (error) {
        console.error('[Supabase] Error al crear el cliente:', error);
        supabaseClient = null;
        supabaseConfigurado = false;
    }
})();
