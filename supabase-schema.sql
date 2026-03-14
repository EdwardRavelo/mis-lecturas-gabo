-- ================================================
-- Schema: Mis Lecturas Gabo
-- Pega este SQL en: Supabase Dashboard → SQL Editor
-- ================================================

-- Tabla principal de lecturas por usuario
CREATE TABLE IF NOT EXISTS lecturas_usuario (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    libro_id    INTEGER NOT NULL,                       -- índice 0-based del catálogo en data.js
    estado      TEXT NOT NULL DEFAULT 'Pendiente'
                    CHECK (estado IN ('Leído', 'Leyendo', 'Pendiente')),
    inicio      TEXT,                                   -- formato: DD/mes/YYYY (ej: 01/enero/2026)
    final       TEXT,                                   -- formato: DD/mes/YYYY
    dias        INTEGER,
    portada     TEXT,                                   -- URL cacheada de Google Books
    updated_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Cada usuario solo puede tener un registro por libro
    CONSTRAINT lecturas_usuario_unique UNIQUE (user_id, libro_id)
);

-- Índice para consultas rápidas por usuario
CREATE INDEX IF NOT EXISTS idx_lecturas_user_id ON lecturas_usuario(user_id);

-- Trigger para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER lecturas_updated_at
    BEFORE UPDATE ON lecturas_usuario
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ================================================
-- Row Level Security (RLS)
-- Cada usuario solo puede ver y modificar sus propias lecturas
-- ================================================

ALTER TABLE lecturas_usuario ENABLE ROW LEVEL SECURITY;

-- Política: SELECT — solo ver las propias lecturas
CREATE POLICY "usuarios pueden ver sus lecturas"
    ON lecturas_usuario
    FOR SELECT
    USING (auth.uid() = user_id);

-- Política: INSERT — solo insertar con su propio user_id
CREATE POLICY "usuarios pueden insertar sus lecturas"
    ON lecturas_usuario
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Política: UPDATE — solo actualizar sus propias lecturas
CREATE POLICY "usuarios pueden actualizar sus lecturas"
    ON lecturas_usuario
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Política: DELETE — solo borrar sus propias lecturas
CREATE POLICY "usuarios pueden borrar sus lecturas"
    ON lecturas_usuario
    FOR DELETE
    USING (auth.uid() = user_id);

-- ================================================
-- Verificación (opcional): listar tablas creadas
-- ================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public';
