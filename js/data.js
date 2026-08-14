// ========================================
// Utilidades de fecha
// ========================================
// El catálogo estático de García Márquez vivía aquí (`librosOriginales`).
// Desde el esquema v2 los libros están en Supabase, uno por usuario, así
// que este archivo solo conserva el manejo de fechas.
//
// Conviven dos representaciones:
//   - Base de datos → DATE en ISO: '2026-02-24'
//   - Interfaz       → español:     '24/febrero/2026'
//
// La app trabaja en memoria con el formato español, porque de él dependen
// calcularDias(), las gráficas y el modal. La traducción ocurre en el borde
// de js/db.js (libroDesdeDB / libroParaDB).

const mesesEspañol = {
    'enero': 0,
    'febrero': 1,
    'marzo': 2,
    'abril': 3,
    'mayo': 4,
    'junio': 5,
    'julio': 6,
    'agosto': 7,
    'septiembre': 8,
    'octubre': 9,
    'noviembre': 10,
    'diciembre': 11
};

const nombresMeses = Object.keys(mesesEspañol);

// '24/febrero/2026' → Date local (o null si no es válida)
function parseFechaEspañol(fechaString) {
    if (!fechaString) return null;

    const partes = String(fechaString).split('/');
    if (partes.length !== 3) return null;

    const dia = parseInt(partes[0], 10);
    const mesNumero = mesesEspañol[partes[1].toLowerCase().trim()];
    const año = parseInt(partes[2], 10);

    if (Number.isNaN(dia) || Number.isNaN(año) || mesNumero === undefined) return null;

    return new Date(año, mesNumero, dia);
}

// Date → '24/febrero/2026' (con día de dos cifras)
function formatearFechaEspañol(fecha) {
    if (!fecha) return null;

    const dia = String(fecha.getDate()).padStart(2, '0');
    const mes = nombresMeses[fecha.getMonth()];
    const año = fecha.getFullYear();

    return `${dia}/${mes}/${año}`;
}

// ----------------------------------------
// Conversión con la base de datos
// ----------------------------------------
// Se hace con cadenas, nunca con Date: `new Date('2026-02-24')` se
// interpreta como medianoche UTC y en husos negativos devolvería el día
// anterior. Un desfase de un día en las fechas de lectura es justo el tipo
// de error que pasa desapercibido durante meses.

// '2026-02-24' → '24/febrero/2026'
function fechaIsoAEspañol(iso) {
    if (!iso) return null;

    const partes = String(iso).slice(0, 10).split('-');
    if (partes.length !== 3) return null;

    const año = parseInt(partes[0], 10);
    const mes = parseInt(partes[1], 10);
    const dia = partes[2];

    if (Number.isNaN(año) || Number.isNaN(mes) || mes < 1 || mes > 12) return null;

    return `${dia}/${nombresMeses[mes - 1]}/${año}`;
}

// '24/febrero/2026' → '2026-02-24'
function fechaEspañolAIso(fechaString) {
    if (!fechaString) return null;

    const partes = String(fechaString).split('/');
    if (partes.length !== 3) return null;

    const dia = parseInt(partes[0], 10);
    const mesNumero = mesesEspañol[partes[1].toLowerCase().trim()];
    const año = parseInt(partes[2], 10);

    if (Number.isNaN(dia) || Number.isNaN(año) || mesNumero === undefined) return null;

    return `${año}-${String(mesNumero + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
