// ========================================
// Base de Datos - Supabase
// ========================================
// Tabla: lecturas_usuario
//   id           uuid (PK, auto)
//   user_id      uuid (FK → auth.users)
//   libro_id     integer (índice del catálogo en data.js, 0-based)
//   estado       text ('Leído' | 'Leyendo' | 'Pendiente')
//   inicio       text (formato DD/mes/YYYY, nullable)
//   final        text (formato DD/mes/YYYY, nullable)
//   dias         integer (nullable)
//   portada      text (URL cacheada, nullable)
//   comentarios  text (notas personales, nullable)
//   updated_at   timestamptz (auto)

// ----------------------------------------
// Cargar lecturas del usuario desde Supabase
// ----------------------------------------

async function cargarLecturasDB() {
    if (!supabaseConfigurado || !usuarioActual) return null;

    const { data, error } = await supabaseClient
        .from('lecturas_usuario')
        .select('*')
        .eq('user_id', usuarioActual.id);

    if (error) {
        console.error('Error al cargar lecturas:', error.message);
        return null;
    }

    return data;
}

// ----------------------------------------
// Guardar/actualizar una lectura
// ----------------------------------------

async function guardarLecturaDB(libroIndex, campos) {
    if (!supabaseConfigurado || !usuarioActual) return false;

    const payload = {
        user_id: usuarioActual.id,
        libro_id: libroIndex,
        estado: campos.estado,
        inicio: campos.inicio ?? null,
        final: campos.final ?? null,
        dias: campos.dias ?? null,
        portada: campos.portada ?? null,
        comentarios: campos.comentarios ?? null,
        updated_at: new Date().toISOString()
    };

    // Upsert: inserta si no existe, actualiza si ya existe (por user_id + libro_id)
    const { error } = await supabaseClient
        .from('lecturas_usuario')
        .upsert(payload, { onConflict: 'user_id,libro_id' });

    if (error) {
        console.error('Error al guardar lectura:', error.message);
        return false;
    }

    return true;
}

// ----------------------------------------
// Guardar todas las lecturas en batch
// ----------------------------------------

async function guardarTodasLecturasDB(libros) {
    if (!supabaseConfigurado || !usuarioActual) return false;

    const payload = libros.map((libro, index) => ({
        user_id: usuarioActual.id,
        libro_id: index,
        estado: libro.estado,
        inicio: libro.inicio ?? null,
        final: libro.final ?? null,
        dias: libro.dias ?? null,
        portada: libro.portada ?? null,
        comentarios: libro.comentarios ?? null,
        updated_at: new Date().toISOString()
    }));

    const { error } = await supabaseClient
        .from('lecturas_usuario')
        .upsert(payload, { onConflict: 'user_id,libro_id' });

    if (error) {
        console.error('Error al guardar lecturas en batch:', error.message);
        return false;
    }

    return true;
}

// ----------------------------------------
// Fusionar datos de DB con el catálogo local
// ----------------------------------------
// El catálogo (librosOriginales) es la fuente de verdad para
// título, año, páginas y resumen.
// La DB solo almacena el progreso del usuario.

function fusionarConCatalogo(lecturasDB) {
    return librosOriginales.map((libroBase, index) => {
        const lectura = lecturasDB.find(l => l.libro_id === index);

        if (lectura) {
            return {
                ...libroBase,
                estado: lectura.estado,
                inicio: lectura.inicio,
                final: lectura.final,
                dias: lectura.dias,
                portada: lectura.portada ?? libroBase.portada,
                comentarios: lectura.comentarios ?? null
            };
        }

        // Si no hay registro en DB, usar estado por defecto del catálogo
        return { ...libroBase };
    });
}

// ----------------------------------------
// Migrar datos de localStorage a Supabase
// (Se llama una sola vez si el usuario tiene datos locales)
// ----------------------------------------

async function migrarDesdeLocalStorage() {
    if (!supabaseConfigurado || !usuarioActual) return;

    const datosLocales = localStorage.getItem('gaboLecturas');
    if (!datosLocales) return;

    // Verificar si el usuario ya tiene datos en DB
    const { data, error } = await supabaseClient
        .from('lecturas_usuario')
        .select('id')
        .eq('user_id', usuarioActual.id)
        .limit(1);

    if (error || (data && data.length > 0)) return; // Ya tiene datos, no migrar

    try {
        const librosLocales = JSON.parse(datosLocales);
        const ok = await guardarTodasLecturasDB(librosLocales);
        if (ok) {
            console.log('✅ Datos migrados de localStorage a Supabase');
            // Limpiar localStorage después de migrar exitosamente
            localStorage.removeItem('gaboLecturas');
            localStorage.removeItem('lastUpdated');
        }
    } catch (e) {
        console.error('Error al migrar datos locales:', e);
    }
}
