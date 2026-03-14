// ========================================
// Cliente Supabase
// Mis Lecturas Gabo
// ========================================

// Credenciales del proyecto Supabase
// Reemplaza estos valores con los de tu proyecto en https://supabase.com/dashboard
const SUPABASE_URL = 'https://qzkgnapnwcklstqaavxj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF6a2duYXBud2NrbHN0cWFhdnhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NTQyMjAsImV4cCI6MjA4OTAzMDIyMH0.lLlLkU5ZpG2eX4voFgep63DSj7VPxbTTkuoHJ-5S6M8';

// Inicializar cliente Supabase
// Usamos 'supabaseClient' para no colisionar con el objeto global 'supabase' del CDN
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Verificar que las credenciales fueron configuradas
function verificarConfiguracion() {
    if (SUPABASE_URL === 'TU_SUPABASE_URL' || SUPABASE_ANON_KEY === 'TU_SUPABASE_ANON_KEY') {
        console.warn(
            '⚠️  Supabase no configurado. ' +
            'Edita js/supabase.js con tu URL y anon key. ' +
            'La app funcionará en modo offline con localStorage.'
        );
        return false;
    }
    return true;
}

const supabaseConfigurado = verificarConfiguracion();
