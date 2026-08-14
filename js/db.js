// ========================================
// Base de Datos - Supabase
// ========================================
// Tablas (ver supabase-schema-v2.sql):
//
//   temas   id · user_id · nombre · color · orden · created_at · updated_at
//   libros  id · user_id · tema_id → temas.id
//           titulo · autor · anio · paginas · resumen · portada    (metadatos)
//           estado · inicio · final · dias · comentarios · orden   (progreso)
//
// El catálogo ya no vive en js/data.js: cada fila de `libros` es un libro
// DEL USUARIO, así que metadatos y progreso están en la misma tabla y no
// hace falta fusionar nada al cargar.
//
// REGLA DE ORO de este archivo: ninguna función puede lanzar ni colgarse.
// Todo va envuelto en conTimeout() (definido en js/auth.js) y devuelve
// null / false ante cualquier fallo, para que la app caiga a modo offline
// en vez de morir. Ver CLAUDE.md → "Availability".

const DB_TIMEOUT_MS = 8000;

// ----------------------------------------
// Conversión en el borde
// ----------------------------------------
// La base guarda DATE ('2026-02-24'); la app trabaja en memoria con el
// formato español ('24/febrero/2026') porque de eso dependen calcularDias(),
// las gráficas y el modal. Se traduce aquí y solo aquí.
//
// También se mapea `anio` (columna, sin ñ para evitar problemas en SQL)
// contra `año`, que es el nombre que usa toda la interfaz.

function libroDesdeDB(fila) {
    return {
        id: fila.id,
        tema_id: fila.tema_id,
        titulo: fila.titulo,
        autor: fila.autor,
        año: fila.anio,
        paginas: fila.paginas,
        resumen: fila.resumen,
        portada: fila.portada,
        estado: fila.estado,
        inicio: fechaIsoAEspañol(fila.inicio),
        final: fechaIsoAEspañol(fila.final),
        dias: fila.dias,
        comentarios: fila.comentarios,
        orden: fila.orden
    };
}

function libroParaDB(libro) {
    return {
        tema_id: libro.tema_id ?? null,
        titulo: libro.titulo,
        autor: libro.autor ?? null,
        anio: libro.año ?? null,
        paginas: libro.paginas ?? null,
        resumen: libro.resumen ?? null,
        portada: libro.portada ?? null,
        estado: libro.estado ?? 'Pendiente',
        inicio: fechaEspañolAIso(libro.inicio),
        final: fechaEspañolAIso(libro.final),
        dias: libro.dias ?? null,
        comentarios: libro.comentarios ?? null,
        orden: libro.orden ?? 0
    };
}

// ----------------------------------------
// Temas
// ----------------------------------------

async function cargarTemasDB() {
    if (!supabaseConfigurado || !usuarioActual) return null;

    try {
        const { data, error } = await conTimeout(
            supabaseClient
                .from('temas')
                .select('*')
                .eq('user_id', usuarioActual.id)
                .order('orden', { ascending: true }),
            DB_TIMEOUT_MS,
            'cargarTemas'
        );

        if (error) {
            console.error('Error al cargar temas:', error.message);
            return null;
        }
        return data;
    } catch (e) {
        console.error('La nube no respondió al cargar temas:', e.message);
        return null;
    }
}

async function crearTemaDB(nombre, color, orden) {
    if (!supabaseConfigurado || !usuarioActual) return null;

    try {
        const { data, error } = await conTimeout(
            supabaseClient
                .from('temas')
                .insert({
                    user_id: usuarioActual.id,
                    nombre: nombre,
                    color: color ?? null,
                    orden: orden ?? 0
                })
                .select()
                .single(),
            DB_TIMEOUT_MS,
            'crearTema'
        );

        if (error) {
            // 23505 = violación de unicidad (user_id, nombre)
            if (error.code === '23505') {
                console.warn('Ya existe un tema con ese nombre.');
            } else {
                console.error('Error al crear tema:', error.message);
            }
            return null;
        }
        return data;
    } catch (e) {
        console.error('La nube no respondió al crear tema:', e.message);
        return null;
    }
}

async function actualizarTemaDB(temaId, campos) {
    if (!supabaseConfigurado || !usuarioActual) return false;

    try {
        const { error } = await conTimeout(
            supabaseClient
                .from('temas')
                .update(campos)
                .eq('id', temaId)
                .eq('user_id', usuarioActual.id),
            DB_TIMEOUT_MS,
            'actualizarTema'
        );

        if (error) {
            console.error('Error al actualizar tema:', error.message);
            return false;
        }
        return true;
    } catch (e) {
        console.error('La nube no respondió al actualizar tema:', e.message);
        return false;
    }
}

// Borrar un tema NO borra sus libros: el esquema usa ON DELETE SET NULL,
// así que quedan con tema_id = null y la app los muestra en "Sin tema".
async function borrarTemaDB(temaId) {
    if (!supabaseConfigurado || !usuarioActual) return false;

    try {
        const { error } = await conTimeout(
            supabaseClient
                .from('temas')
                .delete()
                .eq('id', temaId)
                .eq('user_id', usuarioActual.id),
            DB_TIMEOUT_MS,
            'borrarTema'
        );

        if (error) {
            console.error('Error al borrar tema:', error.message);
            return false;
        }
        return true;
    } catch (e) {
        console.error('La nube no respondió al borrar tema:', e.message);
        return false;
    }
}

// ----------------------------------------
// Libros
// ----------------------------------------

async function cargarLibrosDB() {
    if (!supabaseConfigurado || !usuarioActual) return null;

    try {
        const { data, error } = await conTimeout(
            supabaseClient
                .from('libros')
                .select('*')
                .eq('user_id', usuarioActual.id)
                .order('orden', { ascending: true }),
            DB_TIMEOUT_MS,
            'cargarLibros'
        );

        if (error) {
            console.error('Error al cargar libros:', error.message);
            return null;
        }
        return data.map(libroDesdeDB);
    } catch (e) {
        console.error('La nube no respondió al cargar libros:', e.message);
        return null;
    }
}

async function crearLibroDB(libro) {
    if (!supabaseConfigurado || !usuarioActual) return null;

    try {
        const { data, error } = await conTimeout(
            supabaseClient
                .from('libros')
                .insert({ user_id: usuarioActual.id, ...libroParaDB(libro) })
                .select()
                .single(),
            DB_TIMEOUT_MS,
            'crearLibro'
        );

        if (error) {
            console.error('Error al crear libro:', error.message);
            return null;
        }
        return libroDesdeDB(data);
    } catch (e) {
        console.error('La nube no respondió al crear libro:', e.message);
        return null;
    }
}

// `campos` va en formato de la APP (año, fechas en español); se traduce aquí.
async function actualizarLibroDB(libroId, campos) {
    if (!supabaseConfigurado || !usuarioActual) return false;

    const payload = libroParaDB(campos);

    // Solo enviamos las claves que realmente se están cambiando, para no
    // pisar con null campos que el llamador no tocó.
    const parcial = {};
    for (const [clave, valor] of Object.entries(payload)) {
        const equivalente = clave === 'anio' ? 'año' : clave;
        if (equivalente in campos) parcial[clave] = valor;
    }

    if (Object.keys(parcial).length === 0) return true;

    try {
        const { error } = await conTimeout(
            supabaseClient
                .from('libros')
                .update(parcial)
                .eq('id', libroId)
                .eq('user_id', usuarioActual.id),
            DB_TIMEOUT_MS,
            'actualizarLibro'
        );

        if (error) {
            console.error('Error al actualizar libro:', error.message);
            return false;
        }
        return true;
    } catch (e) {
        console.error('La nube no respondió al actualizar libro:', e.message);
        return false;
    }
}

async function borrarLibroDB(libroId) {
    if (!supabaseConfigurado || !usuarioActual) return false;

    try {
        const { error } = await conTimeout(
            supabaseClient
                .from('libros')
                .delete()
                .eq('id', libroId)
                .eq('user_id', usuarioActual.id),
            DB_TIMEOUT_MS,
            'borrarLibro'
        );

        if (error) {
            console.error('Error al borrar libro:', error.message);
            return false;
        }
        return true;
    } catch (e) {
        console.error('La nube no respondió al borrar libro:', e.message);
        return false;
    }
}

// ----------------------------------------
// Alta masiva (importador CSV)
// ----------------------------------------

async function crearLibrosDB(libros) {
    if (!supabaseConfigurado || !usuarioActual) return null;
    if (!libros.length) return [];

    const payload = libros.map(l => ({ user_id: usuarioActual.id, ...libroParaDB(l) }));

    try {
        const { data, error } = await conTimeout(
            supabaseClient.from('libros').insert(payload).select(),
            DB_TIMEOUT_MS,
            'crearLibros'
        );

        if (error) {
            console.error('Error al crear libros en lote:', error.message);
            return null;
        }
        return data.map(libroDesdeDB);
    } catch (e) {
        console.error('La nube no respondió al crear libros en lote:', e.message);
        return null;
    }
}
