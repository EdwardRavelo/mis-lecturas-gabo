// ========================================
// Datos de las obras de Gabriel García Márquez
// ========================================

const librosOriginales = [
    {
        año: 1955,
        titulo: "La hojarasca",
        paginas: 192,
        resumen: "Primera novela. Narra el funeral de un médico odiado en el pueblo de Macondo desde la perspectiva de tres generaciones de una familia.",
        estado: "Leído",
        inicio: "28/diciembre/2025",
        final: "01/febrero/2026",
        dias: 35,
        portada: null
    },
    {
        año: 1961,
        titulo: "El coronel no tiene quien le escriba",
        paginas: 128,
        resumen: "Historia de un viejo coronel que espera cada viernes en el puerto, durante años, una pensión de veterano que nunca llega.",
        estado: "Leído",
        inicio: "01/febrero/2026",
        final: "26/febrero/2026",
        dias: 25,
        portada: null
    },
    {
        año: 1962,
        titulo: "La mala hora",
        paginas: 200,
        resumen: "Un pueblo vive en tensión política y social cuando empiezan a aparecer pasquines anónimos revelando secretos de los habitantes.",
        estado: "Leyendo",
        inicio: "24/febrero/2026",
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 1962,
        titulo: "Los funerales de la Mamá Grande",
        paginas: 176,
        resumen: "Colección de cuentos que retratan el realismo mágico y la vida en la costa caribeña colombiana.",
        estado: "Pendiente",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 1967,
        titulo: "Cien años de soledad",
        paginas: 496,
        resumen: "La obra maestra. La saga de la familia Buendía a lo largo de siete generaciones en el mítico pueblo de Macondo.",
        estado: "Leído",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 1970,
        titulo: "Relato de un náufrago",
        paginas: 168,
        resumen: "Reportaje periodístico novelado sobre la supervivencia de un marinero que cayó al mar y sobrevivió diez días sin comida ni agua.",
        estado: "Pendiente",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 1972,
        titulo: "La increíble y triste historia de la cándida Eréndira y de su abuela desalmada",
        paginas: 160,
        resumen: "Relato sobre una joven explotada cruelmente por su abuela, quien la obliga a prostituirse para pagar una deuda absurda.",
        estado: "Pendiente",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 1975,
        titulo: "El otoño del patriarca",
        paginas: 304,
        resumen: "Una novela compleja sobre la soledad del poder absoluto, centrada en un dictador eterno en una nación caribeña ficticia.",
        estado: "Pendiente",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 1981,
        titulo: "Crónica de una muerte anunciada",
        paginas: 144,
        resumen: "Reconstrucción del asesinato de Santiago Nasar, un crimen que todo el pueblo sabía que iba a ocurrir pero nadie impidió.",
        estado: "Pendiente",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 1985,
        titulo: "El amor en los tiempos del cólera",
        paginas: 368,
        resumen: "La historia de amor y perseverancia de Florentino Ariza, quien espera más de 50 años para estar con Fermina Daza.",
        estado: "Leído",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 1986,
        titulo: "La aventura de Miguel Littín clandestino en Chile",
        paginas: 192,
        resumen: "Reportaje sobre la entrada secreta del cineasta exiliado Miguel Littín a Chile durante la dictadura de Pinochet.",
        estado: "Leído",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 1989,
        titulo: "El general en su laberinto",
        paginas: 304,
        resumen: "Novela histórica que narra los últimos días de Simón Bolívar, mostrando su faceta más humana, enferma y derrotada.",
        estado: "Pendiente",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 1992,
        titulo: "Doce cuentos peregrinos",
        paginas: 224,
        resumen: "Compilación de cuentos sobre latinoamericanos viviendo en Europa, explorando temas de desarraigo y extrañeza.",
        estado: "Pendiente",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 1994,
        titulo: "Del amor y otros demonios",
        paginas: 176,
        resumen: "En la época colonial, una niña mordida por un perro es recluida en un convento por supuesta posesión, donde surge un amor prohibido.",
        estado: "Pendiente",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 1996,
        titulo: "Noticia de un secuestro",
        paginas: 352,
        resumen: "Crónica periodística detallada sobre los secuestros realizados por el Cartel de Medellín y Pablo Escobar en los años 90.",
        estado: "Pendiente",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 2002,
        titulo: "Vivir para contarla",
        paginas: 576,
        resumen: "Autobiografía de sus años de infancia y juventud, fundamental para entender el origen de sus historias.",
        estado: "Pendiente",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 2004,
        titulo: "Memoria de mis putas tristes",
        paginas: 128,
        resumen: "Un anciano periodista decide regalarse una noche de amor con una adolescente virgen por su 90 cumpleaños, encontrando un amor inesperado.",
        estado: "Leído",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    },
    {
        año: 2024,
        titulo: "En agosto nos vemos",
        paginas: 144,
        resumen: "(Póstuma) Ana Magdalena Bach viaja cada agosto a la isla donde está enterrada su madre y cada visita se convierte en una oportunidad para reinventarse.",
        estado: "Pendiente",
        inicio: null,
        final: null,
        dias: null,
        portada: null
    }
];

// Mapa de meses en español para parsing de fechas
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

// Función para parsear fechas en formato español
function parseFechaEspañol(fechaString) {
    if (!fechaString) return null;
    
    // Formato: "28/diciembre/2025"
    const partes = fechaString.split('/');
    if (partes.length !== 3) return null;
    
    const dia = parseInt(partes[0]);
    const mesNombre = partes[1].toLowerCase();
    const año = parseInt(partes[2]);
    
    const mesNumero = mesesEspañol[mesNombre];
    if (mesNumero === undefined) return null;
    
    return new Date(año, mesNumero, dia);
}

// Función para formatear fecha a string español
function formatFechaEspañol(fecha) {
    if (!fecha) return null;
    
    const dia = fecha.getDate();
    const mes = Object.keys(mesesEspañol)[fecha.getMonth()];
    const año = fecha.getFullYear();
    
    return `${dia}/${mes}/${año}`;
}

// Exportar datos y funciones
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        librosOriginales,
        mesesEspañol,
        parseFechaEspañol,
        formatFechaEspañol
    };
}
