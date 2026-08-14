-- ================================================================
-- Schema v2: de biblioteca de un autor a diario de lecturas por temas
-- Pega este SQL completo en: Supabase Dashboard → SQL Editor → Run
-- ================================================================
--
-- QUÉ HACE
--   1. Crea las tablas `temas` y `libros` (con RLS, triggers e índices).
--   2. Crea el tema "Gabriel García Márquez" para cada usuario con datos.
--   3. Migra las 18 obras: metadatos desde el catálogo que vivía en
--      js/data.js (inlineados aquí abajo) + tu progreso real desde
--      `lecturas_usuario`.
--
-- QUÉ NO HACE
--   NO toca ni borra `lecturas_usuario`. Esa tabla queda intacta como
--   respaldo hasta que verifiques la migración. Se elimina en otra fase.
--
-- ES IDEMPOTENTE: ejecutarlo dos veces no duplica nada.
--
-- ANTES DE EJECUTAR: exporta tu progreso desde la app (botón Exportar)
-- y desde Table Editor → lecturas_usuario → Export CSV.
-- ================================================================


-- ----------------------------------------------------------------
-- 1. Conversión de fechas españolas a DATE
-- ----------------------------------------------------------------
-- El modelo viejo guardaba las fechas como texto ('28/diciembre/2025').
-- El nuevo usa DATE, para poder ordenar y agrupar por mes en la base.
-- La app las sigue MOSTRANDO en español; convierte solo en el borde.

CREATE OR REPLACE FUNCTION parse_fecha_es(txt TEXT)
RETURNS DATE AS $$
DECLARE
    partes TEXT[];
    meses  TEXT[] := ARRAY['enero','febrero','marzo','abril','mayo','junio',
                           'julio','agosto','septiembre','octubre','noviembre','diciembre'];
    mes_num INT;
BEGIN
    IF txt IS NULL OR btrim(txt) = '' THEN
        RETURN NULL;
    END IF;

    partes := string_to_array(lower(btrim(txt)), '/');
    IF array_length(partes, 1) <> 3 THEN
        RETURN NULL;
    END IF;

    mes_num := array_position(meses, btrim(partes[2]));
    IF mes_num IS NULL THEN
        RETURN NULL;
    END IF;

    RETURN make_date(partes[3]::INT, mes_num, partes[1]::INT);
EXCEPTION WHEN OTHERS THEN
    -- Una fecha corrupta no debe abortar la migración entera
    RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- ----------------------------------------------------------------
-- 2. Tablas
-- ----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS temas (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    nombre      TEXT NOT NULL,
    color       TEXT,                                   -- acento del tema (hex)
    orden       INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT temas_nombre_unico UNIQUE (user_id, nombre)
);

CREATE TABLE IF NOT EXISTS libros (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Borrar un tema no debe borrar los libros: quedan sin tema y la app
    -- los muestra en "Sin tema" para reasignarlos.
    tema_id     UUID REFERENCES temas(id) ON DELETE SET NULL,

    -- Metadatos
    titulo      TEXT NOT NULL,
    autor       TEXT,
    anio        INTEGER,
    paginas     INTEGER,
    resumen     TEXT,
    portada     TEXT,                                   -- URL cacheada de Google Books

    -- Progreso
    estado      TEXT NOT NULL DEFAULT 'Pendiente'
                    CHECK (estado IN ('Leído', 'Leyendo', 'Pendiente')),
    inicio      DATE,
    final       DATE,
    dias        INTEGER,
    comentarios TEXT,

    orden       INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_temas_user   ON temas(user_id);
CREATE INDEX IF NOT EXISTS idx_libros_user  ON libros(user_id);
CREATE INDEX IF NOT EXISTS idx_libros_tema  ON libros(tema_id);


-- ----------------------------------------------------------------
-- 3. Trigger de updated_at
-- ----------------------------------------------------------------
-- update_updated_at() ya existe desde supabase-schema.sql; se redefine
-- por si este script se ejecuta en un proyecto limpio.

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER temas_updated_at
    BEFORE UPDATE ON temas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER libros_updated_at
    BEFORE UPDATE ON libros
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ----------------------------------------------------------------
-- 4. Row Level Security
-- ----------------------------------------------------------------
-- Mismo criterio que lecturas_usuario: cada usuario solo ve y toca lo suyo.
-- DROP + CREATE en vez de CREATE a secas, para que el script sea repetible.

ALTER TABLE temas  ENABLE ROW LEVEL SECURITY;
ALTER TABLE libros ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "temas: ver"        ON temas;
DROP POLICY IF EXISTS "temas: insertar"   ON temas;
DROP POLICY IF EXISTS "temas: actualizar" ON temas;
DROP POLICY IF EXISTS "temas: borrar"     ON temas;

CREATE POLICY "temas: ver"        ON temas FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "temas: insertar"   ON temas FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "temas: actualizar" ON temas FOR UPDATE USING (auth.uid() = user_id)
                                                 WITH CHECK (auth.uid() = user_id);
CREATE POLICY "temas: borrar"     ON temas FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "libros: ver"        ON libros;
DROP POLICY IF EXISTS "libros: insertar"   ON libros;
DROP POLICY IF EXISTS "libros: actualizar" ON libros;
DROP POLICY IF EXISTS "libros: borrar"     ON libros;

CREATE POLICY "libros: ver"        ON libros FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "libros: insertar"   ON libros FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "libros: actualizar" ON libros FOR UPDATE USING (auth.uid() = user_id)
                                                   WITH CHECK (auth.uid() = user_id);
CREATE POLICY "libros: borrar"     ON libros FOR DELETE USING (auth.uid() = user_id);


-- ----------------------------------------------------------------
-- 5. Migración
-- ----------------------------------------------------------------
-- Se ejecuta para CADA usuario que tenga filas en lecturas_usuario.
-- Si la tabla vieja está vacía, no migra nada y solo quedan las tablas
-- creadas: la app arranca sin temas y se crean desde la interfaz.

-- 5a. El tema que agrupa las 18 obras
INSERT INTO temas (user_id, nombre, color, orden)
SELECT DISTINCT user_id, 'Gabriel García Márquez', '#00D9A3', 0
FROM lecturas_usuario
ON CONFLICT (user_id, nombre) DO NOTHING;


-- 5b. Los libros: metadatos del catálogo + progreso real del usuario
--
-- Replica exactamente lo que hacía fusionarConCatalogo() en js/db.js:
-- el catálogo manda en título/año/páginas/resumen, y si el usuario no
-- tenía fila para un libro se usan los valores por defecto del catálogo.

INSERT INTO libros (
    user_id, tema_id, titulo, autor, anio, paginas, resumen, portada,
    estado, inicio, final, dias, comentarios, orden
)
SELECT
    t.user_id,
    t.id,
    c.titulo,
    'Gabriel García Márquez',
    c.anio,
    c.paginas,
    c.resumen,
    l.portada,
    COALESCE(l.estado, c.estado_def),
    parse_fecha_es(COALESCE(l.inicio, c.inicio_def)),
    parse_fecha_es(COALESCE(l.final,  c.final_def)),
    l.dias,
    l.comentarios,
    c.libro_id
FROM temas t
CROSS JOIN (VALUES
    (0,  1955, 'La hojarasca', 192,
     'Primera novela. Narra el funeral de un médico odiado en el pueblo de Macondo desde la perspectiva de tres generaciones de una familia.',
     'Leído', '28/diciembre/2025', '01/febrero/2026'),
    (1,  1961, 'El coronel no tiene quien le escriba', 128,
     'Historia de un viejo coronel que espera cada viernes en el puerto, durante años, una pensión de veterano que nunca llega.',
     'Leído', '01/febrero/2026', '26/febrero/2026'),
    (2,  1962, 'La mala hora', 200,
     'Un pueblo vive en tensión política y social cuando empiezan a aparecer pasquines anónimos revelando secretos de los habitantes.',
     'Leyendo', '24/febrero/2026', NULL),
    (3,  1962, 'Los funerales de la Mamá Grande', 176,
     'Colección de cuentos que retratan el realismo mágico y la vida en la costa caribeña colombiana.',
     'Pendiente', NULL, NULL),
    (4,  1967, 'Cien años de soledad', 496,
     'La obra maestra. La saga de la familia Buendía a lo largo de siete generaciones en el mítico pueblo de Macondo.',
     'Leído', NULL, NULL),
    (5,  1970, 'Relato de un náufrago', 168,
     'Reportaje periodístico novelado sobre la supervivencia de un marinero que cayó al mar y sobrevivió diez días sin comida ni agua.',
     'Pendiente', NULL, NULL),
    (6,  1972, 'La increíble y triste historia de la cándida Eréndira y de su abuela desalmada', 160,
     'Relato sobre una joven explotada cruelmente por su abuela, quien la obliga a prostituirse para pagar una deuda absurda.',
     'Pendiente', NULL, NULL),
    (7,  1975, 'El otoño del patriarca', 304,
     'Una novela compleja sobre la soledad del poder absoluto, centrada en un dictador eterno en una nación caribeña ficticia.',
     'Pendiente', NULL, NULL),
    (8,  1981, 'Crónica de una muerte anunciada', 144,
     'Reconstrucción del asesinato de Santiago Nasar, un crimen que todo el pueblo sabía que iba a ocurrir pero nadie impidió.',
     'Pendiente', NULL, NULL),
    (9,  1985, 'El amor en los tiempos del cólera', 368,
     'La historia de amor y perseverancia de Florentino Ariza, quien espera más de 50 años para estar con Fermina Daza.',
     'Leído', NULL, NULL),
    (10, 1986, 'La aventura de Miguel Littín clandestino en Chile', 192,
     'Reportaje sobre la entrada secreta del cineasta exiliado Miguel Littín a Chile durante la dictadura de Pinochet.',
     'Leído', NULL, NULL),
    (11, 1989, 'El general en su laberinto', 304,
     'Novela histórica que narra los últimos días de Simón Bolívar, mostrando su faceta más humana, enferma y derrotada.',
     'Pendiente', NULL, NULL),
    (12, 1992, 'Doce cuentos peregrinos', 224,
     'Compilación de cuentos sobre latinoamericanos viviendo en Europa, explorando temas de desarraigo y extrañeza.',
     'Pendiente', NULL, NULL),
    (13, 1994, 'Del amor y otros demonios', 176,
     'En la época colonial, una niña mordida por un perro es recluida en un convento por supuesta posesión, donde surge un amor prohibido.',
     'Pendiente', NULL, NULL),
    (14, 1996, 'Noticia de un secuestro', 352,
     'Crónica periodística detallada sobre los secuestros realizados por el Cartel de Medellín y Pablo Escobar en los años 90.',
     'Pendiente', NULL, NULL),
    (15, 2002, 'Vivir para contarla', 576,
     'Autobiografía de sus años de infancia y juventud, fundamental para entender el origen de sus historias.',
     'Pendiente', NULL, NULL),
    (16, 2004, 'Memoria de mis putas tristes', 128,
     'Un anciano periodista decide regalarse una noche de amor con una adolescente virgen por su 90 cumpleaños, encontrando un amor inesperado.',
     'Leído', NULL, NULL),
    (17, 2024, 'En agosto nos vemos', 144,
     '(Póstuma) Ana Magdalena Bach viaja cada agosto a la isla donde está enterrada su madre y cada visita se convierte en una oportunidad para reinventarse.',
     'Pendiente', NULL, NULL)
) AS c(libro_id, anio, titulo, paginas, resumen, estado_def, inicio_def, final_def)
LEFT JOIN lecturas_usuario l
       ON l.user_id  = t.user_id
      AND l.libro_id = c.libro_id
WHERE t.nombre = 'Gabriel García Márquez'
  -- Idempotencia: no reinsertar si ese usuario ya tiene ese libro
  AND NOT EXISTS (
      SELECT 1 FROM libros lb
      WHERE lb.user_id = t.user_id
        AND lb.titulo  = c.titulo
  );


-- ================================================================
-- 6. Verificación — ejecuta estas consultas y comprueba el resultado
-- ================================================================
--
-- Deben salir 18 libros, y el reparto de estados debe coincidir con
-- lo que ves hoy en la app:
--
--   SELECT COUNT(*) AS total FROM libros;
--   SELECT estado, COUNT(*) FROM libros GROUP BY estado ORDER BY estado;
--
-- Contraste libro a libro contra la tabla vieja. Esta consulta debe
-- devolver CERO filas; cada fila que salga es una discrepancia:
--
--   SELECT lb.titulo, lb.estado AS estado_nuevo, l.estado AS estado_viejo,
--          lb.inicio AS inicio_nuevo, l.inicio AS inicio_viejo
--   FROM libros lb
--   JOIN temas t ON t.id = lb.tema_id AND t.nombre = 'Gabriel García Márquez'
--   JOIN lecturas_usuario l
--     ON l.user_id = lb.user_id AND l.libro_id = lb.orden
--   WHERE lb.estado IS DISTINCT FROM l.estado
--      OR lb.inicio IS DISTINCT FROM parse_fecha_es(l.inicio)
--      OR lb.final  IS DISTINCT FROM parse_fecha_es(l.final)
--      OR lb.comentarios IS DISTINCT FROM l.comentarios;
--
-- Solo cuando esto salga limpio se elimina lecturas_usuario (otra fase).
-- ================================================================
