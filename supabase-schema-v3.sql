-- ================================================================
-- Schema v3: subtemas + carga del Sheets "lecturas"
-- Pega este SQL completo en: Supabase Dashboard → SQL Editor → Run
-- ================================================================
--
-- 1. Añade a `libros` las columnas subtema, tipo y enlace.
-- 2. Crea 4 temas nuevos y carga 94 registros desde la hoja de cálculo.
--
-- ES IDEMPOTENTE: ejecutarlo dos veces no duplica nada (no reinserta un
-- libro si ya existe uno con el mismo título en el mismo tema).
--
-- El tema "Gabriel García Márquez" y sus 18 obras NO se tocan.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. Columnas nuevas (aditivas, admiten nulos)
-- ----------------------------------------------------------------
ALTER TABLE libros ADD COLUMN IF NOT EXISTS subtema TEXT;
ALTER TABLE libros ADD COLUMN IF NOT EXISTS tipo    TEXT;
ALTER TABLE libros ADD COLUMN IF NOT EXISTS enlace  TEXT;

-- Agrupar por subtema dentro de un tema es la consulta más frecuente
CREATE INDEX IF NOT EXISTS idx_libros_subtema ON libros(tema_id, subtema);


-- ----------------------------------------------------------------
-- Tema: JavaScript  (24 registros)
-- ----------------------------------------------------------------
INSERT INTO temas (user_id, nombre, color, orden)
SELECT DISTINCT user_id, 'JavaScript', '#c98500', 1
FROM libros
ON CONFLICT (user_id, nombre) DO NOTHING;

INSERT INTO libros (user_id, tema_id, subtema, titulo, autor, anio, resumen, tipo, enlace, estado, inicio, orden)
-- Casts explícitos: si TODAS las filas de una columna del VALUES son NULL,
-- Postgres la infiere como text y luego rechaza insertarla en integer/date.
SELECT t.user_id, t.id, v.subtema, v.titulo, v.autor, v.anio::integer, v.resumen,
       v.tipo, v.enlace, v.estado, v.inicio::date, v.orden::integer
FROM temas t
CROSS JOIN (VALUES
    ('Básico', 'Eloquent JavaScript (Capítulos 1-6)', NULL, NULL, 'Sintaxis básica, funciones, tipos de datos, estructuras básicas', 'Libro', 'https://eloquentjavascript.net/', 'Leyendo', '2026-01-07', 0),
    ('Básico', 'Documentación MDN: Introducción a JavaScript', NULL, NULL, 'Guía oficial y actualizada de JavaScript', 'Documentación', 'https://developer.mozilla.org/es/docs/Web/JavaScript/Guide/Introduction', 'Pendiente', NULL, 1),
    ('Básico', 'Curso JavaScript Essentials - freeCodeCamp', NULL, NULL, 'Conceptos básicos y ejercicios prácticos', 'Curso', 'https://www.freecodecamp.org/learn/javascript-algorithms-and-data-structures/basic-javascript/', 'Pendiente', NULL, 2),
    ('Básico', 'Video: JavaScript Tutorial para Principiantes (freeCodeCamp 4 horas)', NULL, NULL, 'Curso completo para comenzar con JavaScript', 'Vídeo', 'https://www.youtube.com/watch?v=PkZNo7MFNFg', 'Pendiente', NULL, 3),
    ('Intermedio', 'Eloquent JavaScript (Capítulos 7-12)', NULL, NULL, 'Objetos, arreglos, funciones avanzadas, manejo de errores', 'Libro', 'https://eloquentjavascript.net/', 'Pendiente', NULL, 4),
    ('Intermedio', 'You Don’t Know JS: Scope & Closures', NULL, NULL, 'Profundización en closures y alcance', 'Libro', 'https://github.com/getify/You-Dont-Know-JS/tree/2nd-ed/scope-closures', 'Pendiente', NULL, 5),
    ('Intermedio', 'Documentación MDN: Funciones y Closures', NULL, NULL, 'Explicación detallada de closures', 'Documentación', 'https://developer.mozilla.org/es/docs/Web/JavaScript/Closures', 'Pendiente', NULL, 6),
    ('Intermedio', 'Eloquent JavaScript (Capítulo 14 - DOM)', NULL, NULL, 'Manipulación del DOM y eventos', 'Libro', 'https://eloquentjavascript.net/14_dom.html', 'Pendiente', NULL, 7),
    ('Intermedio', 'Documentación MDN: Introducción al DOM', NULL, NULL, 'Conceptos básicos del DOM', 'Documentación', 'https://developer.mozilla.org/es/docs/Web/API/Document_Object_Model/Introduction', 'Pendiente', NULL, 8),
    ('Intermedio', 'Curso JavaScript DOM Manipulation - Scrimba', NULL, NULL, 'Manipulación práctica del DOM y eventos', 'Curso', 'https://scrimba.com/learn/learnjavascriptdom', 'Pendiente', NULL, 9),
    ('Intermedio', 'Eloquent JavaScript (Capítulo 11 - Asincronía)', NULL, NULL, 'Promesas y async/await', 'Libro', 'https://eloquentjavascript.net/11_async.html', 'Pendiente', NULL, 10),
    ('Intermedio', 'You Don’t Know JS: Async & Performance', NULL, NULL, 'Manejo avanzado de asincronía y rendimiento', 'Libro', 'https://github.com/getify/You-Dont-Know-JS/tree/2nd-ed/async-performance', 'Pendiente', NULL, 11),
    ('Intermedio', 'Documentación MDN: Promesas, async/await', NULL, NULL, 'Guía de promesas y async/await', 'Documentación', 'https://developer.mozilla.org/es/docs/Web/JavaScript/Guide/Using_promises', 'Pendiente', NULL, 12),
    ('Intermedio', 'Eloquent JavaScript (Capítulos 6 y 15 - Objetos y Clases)', NULL, NULL, 'Programación orientada a objetos y clases', 'Libro', 'https://eloquentjavascript.net/', 'Pendiente', NULL, 13),
    ('Intermedio', 'Documentación MDN: Clases en JavaScript', NULL, NULL, 'Explicación oficial de clases', 'Documentación', 'https://developer.mozilla.org/es/docs/Web/JavaScript/Reference/Classes', 'Pendiente', NULL, 14),
    ('Intermedio', 'You Don’t Know JS: ES6 & Beyond', NULL, NULL, 'ES6+ características modernas de JavaScript', 'Libro', 'https://github.com/getify/You-Dont-Know-JS/tree/2nd-ed/es6-and-beyond', 'Pendiente', NULL, 15),
    ('Avanzado', 'Introducción a npm y paquetes', NULL, NULL, 'Gestión de paquetes y dependencias', 'Documentación', 'https://docs.npmjs.com/about-npm', 'Pendiente', NULL, 16),
    ('Avanzado', 'Guía básica de Webpack', NULL, NULL, 'Conceptos y uso de Webpack', 'Documentación', 'https://webpack.js.org/concepts/', 'Pendiente', NULL, 17),
    ('Avanzado', 'Guía básica de Babel', NULL, NULL, 'Transformación de código moderno a compatible', 'Documentación', 'https://babeljs.io/docs/en/', 'Pendiente', NULL, 18),
    ('Avanzado', 'Learning JavaScript Design Patterns', NULL, NULL, 'Patrones de diseño en JS', 'Libro', 'https://addyosmani.com/resources/essentialjsdesignpatterns/book/', 'Pendiente', NULL, 19),
    ('Avanzado', 'Documentación Jest (Testing en JS)', NULL, NULL, 'Pruebas automatizadas en JavaScript', 'Documentación', 'https://jestjs.io/docs/getting-started', 'Pendiente', NULL, 20),
    ('Avanzado', 'Video: Curso avanzado de JavaScript - Traversy Media', NULL, NULL, 'Temas avanzados y mejores prácticas', 'Vídeo', 'https://www.youtube.com/watch?v=Oe421EPjeBE', 'Pendiente', NULL, 21),
    ('Avanzado', 'Documentación TypeScript', NULL, NULL, 'Tipado estático para JavaScript', 'Documentación', 'https://www.typescriptlang.org/docs/', 'Pendiente', NULL, 22),
    ('Avanzado', 'MDN: Event Loop y Performance', NULL, NULL, 'Funcionamiento interno de JS y performance', 'Documentación', 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/EventLoop', 'Pendiente', NULL, 23)
) AS v(subtema, titulo, autor, anio, resumen, tipo, enlace, estado, inicio, orden)
WHERE t.nombre = 'JavaScript'
  AND NOT EXISTS (
      SELECT 1 FROM libros lb
      WHERE lb.user_id = t.user_id AND lb.tema_id = t.id AND lb.titulo = v.titulo
  );

-- ----------------------------------------------------------------
-- Tema: Ficción y cine  (8 registros)
-- ----------------------------------------------------------------
INSERT INTO temas (user_id, nombre, color, orden)
SELECT DISTINCT user_id, 'Ficción y cine', '#9085e9', 2
FROM libros
ON CONFLICT (user_id, nombre) DO NOTHING;

INSERT INTO libros (user_id, tema_id, subtema, titulo, autor, anio, resumen, tipo, enlace, estado, inicio, orden)
-- Casts explícitos: si TODAS las filas de una columna del VALUES son NULL,
-- Postgres la infiere como text y luego rechaza insertarla en integer/date.
SELECT t.user_id, t.id, v.subtema, v.titulo, v.autor, v.anio::integer, v.resumen,
       v.tipo, v.enlace, v.estado, v.inicio::date, v.orden::integer
FROM temas t
CROSS JOIN (VALUES
    ('Libros', 'Ética promiscua', NULL, NULL, NULL, 'Libro', NULL, 'Pendiente', NULL, 0),
    ('Libros', 'Las ceremonias', 'Marcos Aramburu', NULL, NULL, 'Libro', NULL, 'Leído', NULL, 1),
    ('Libros', 'La amiga estupenda', 'Elena Ferrante', NULL, NULL, 'Libro', NULL, 'Leído', NULL, 2),
    ('Libros', 'Cadáver exquisito', 'Agustina Bazterrica', NULL, NULL, 'Libro', NULL, 'Leído', NULL, 3),
    ('Libros', 'Maniac', 'Benjamin Labatut', NULL, NULL, 'Libro', NULL, 'Leyendo', NULL, 4),
    ('Películas', 'On the Silver Globe', 'Andrzej Żuławski', NULL, NULL, 'Película', NULL, 'Pendiente', NULL, 5),
    ('Películas', 'Die My Love', NULL, NULL, NULL, 'Película', NULL, 'Pendiente', NULL, 6),
    ('Películas', 'Possession', 'Andrzej Żuławski', NULL, NULL, 'Película', NULL, 'Pendiente', NULL, 7)
) AS v(subtema, titulo, autor, anio, resumen, tipo, enlace, estado, inicio, orden)
WHERE t.nombre = 'Ficción y cine'
  AND NOT EXISTS (
      SELECT 1 FROM libros lb
      WHERE lb.user_id = t.user_id AND lb.tema_id = t.id AND lb.titulo = v.titulo
  );

-- ----------------------------------------------------------------
-- Tema: Programación  (10 registros)
-- ----------------------------------------------------------------
INSERT INTO temas (user_id, nombre, color, orden)
SELECT DISTINCT user_id, 'Programación', '#199e70', 3
FROM libros
ON CONFLICT (user_id, nombre) DO NOTHING;

INSERT INTO libros (user_id, tema_id, subtema, titulo, autor, anio, resumen, tipo, enlace, estado, inicio, orden)
-- Casts explícitos: si TODAS las filas de una columna del VALUES son NULL,
-- Postgres la infiere como text y luego rechaza insertarla en integer/date.
SELECT t.user_id, t.id, v.subtema, v.titulo, v.autor, v.anio::integer, v.resumen,
       v.tipo, v.enlace, v.estado, v.inicio::date, v.orden::integer
FROM temas t
CROSS JOIN (VALUES
    ('1 – Fundamentos', 'Fundamentos de Programación', 'Luis Joyanes Aguilar', NULL, 'Libro base para entender algoritmos, estructuras de datos, lógica, tipos de datos y resolución de problemas usando pseudocódigo. — Te da las bases del pensamiento computacional.', 'Libro', NULL, 'Pendiente', NULL, 0),
    ('1 – Fundamentos', 'Programming Logic & Design', 'Joyce Farrell', NULL, 'Orientado a principiantes, explica la lógica de programación con diagramas de flujo, pseudocódigo y problemas prácticos. — Te enseña cómo pensar como un programador incluso antes de dominar un lenguaje.', 'Libro', NULL, 'Pendiente', NULL, 1),
    ('2 – Pensamiento algorítmico', 'Think Like a Programmer', 'V. Anton Spraul', NULL, 'Entrena la mente para resolver problemas desarmando, organizando y reconstruyendo soluciones. — Pulís tu habilidad para enfrentar desafíos lógicos reales.', 'Libro', NULL, 'Pendiente', NULL, 2),
    ('2 – Mentalidad profesional', 'The Practice of Programming', 'Brian W. Kernighan & Rob Pike', NULL, 'Habla de diseño de código, depuración, testing, eficiencia, portabilidad y estilo. — Primer contacto con pensamiento profesional y buenas prácticas.', 'Libro', NULL, 'Pendiente', NULL, 3),
    ('3 – Código profesional', 'Clean Code', 'Robert C. Martin', NULL, 'Enseña cómo escribir código claro, simple, mantenible, modular y fácil de entender. — Aprendés a transformar tus soluciones lógicas en código de calidad real.', 'Libro', NULL, 'Pendiente', NULL, 4),
    ('4 – Profundización académica', 'Introduction to Algorithms (CLRS)', 'Cormen, Leiserson, Rivest & Stein', NULL, 'El libro académico más usado en universidades; analiza algoritmos en profundidad con teoría, pseudocódigo, complejidad y matemática. — Dominio estructurado de algoritmos y estructuras de datos.', 'Libro', NULL, 'Pendiente', NULL, 5),
    ('4 – Resolución avanzada', 'Algorithmic Puzzles', 'Anany Levitin & Maria Levitin', NULL, 'Recopilación de problemas tipo rompecabezas que requieren creatividad y pensamiento lateral algorítmico. — Mejora tu forma de pensar y desbloquear caminos de solución.', 'Libro', NULL, 'Pendiente', NULL, 6),
    ('5 – Lenguajes y teoría', 'Types and Programming Languages', 'Benjamin C. Pierce', NULL, 'Marco teórico sobre tipos, expresiones, semántica y diseño de lenguajes. — Para entender cómo funcionan los lenguajes por dentro.', 'Libro', NULL, 'Pendiente', NULL, 7),
    ('5 – Paradigmas superiores', 'Paradigms of AI Programming', 'Peter Norvig', NULL, 'Utiliza Lisp para enseñar inteligencia artificial clásica, resolución lógica, búsquedas y lenguajes declarativos. — Lleva tu pensamiento a otro nivel conceptual.', 'Libro', NULL, 'Pendiente', NULL, 8),
    ('6 – Arquitectura profesional', 'Clean Architecture', 'Robert C. Martin', NULL, 'Guía para construir sistemas escalables, estables y mantenibles desde una perspectiva arquitectónica. — Te prepara para diseñar aplicaciones completas pensadas para el mundo real.', 'Libro', NULL, 'Pendiente', NULL, 9)
) AS v(subtema, titulo, autor, anio, resumen, tipo, enlace, estado, inicio, orden)
WHERE t.nombre = 'Programación'
  AND NOT EXISTS (
      SELECT 1 FROM libros lb
      WHERE lb.user_id = t.user_id AND lb.tema_id = t.id AND lb.titulo = v.titulo
  );

-- ----------------------------------------------------------------
-- Tema: Filosofía política  (52 registros)
-- ----------------------------------------------------------------
INSERT INTO temas (user_id, nombre, color, orden)
SELECT DISTINCT user_id, 'Filosofía política', '#3987e5', 4
FROM libros
ON CONFLICT (user_id, nombre) DO NOTHING;

INSERT INTO libros (user_id, tema_id, subtema, titulo, autor, anio, resumen, tipo, enlace, estado, inicio, orden)
-- Casts explícitos: si TODAS las filas de una columna del VALUES son NULL,
-- Postgres la infiere como text y luego rechaza insertarla en integer/date.
SELECT t.user_id, t.id, v.subtema, v.titulo, v.autor, v.anio::integer, v.resumen,
       v.tipo, v.enlace, v.estado, v.inicio::date, v.orden::integer
FROM temas t
CROSS JOIN (VALUES
    ('Justicia', 'A Theory of Justice', 'John Rawls', 1971, 'Cap. II: Los dos principios de justicia. Donde formula el Principio de diferencia. — Texto fundacional, explica desde la base el principio.', 'Libro', NULL, 'Pendiente', NULL, 0),
    ('Justicia', 'Justice as Fairness: A Restatement', 'John Rawls', 2001, 'Síntesis y clarificación de su teoría para evitar malas interpretaciones. — Aporta la versión madura y revisada por el propio Rawls.', 'Libro', NULL, 'Pendiente', NULL, 1),
    ('Justicia', 'Contemporary Political Philosophy', 'Will Kymlicka', 2002, 'Capítulos sobre liberalismo igualitario y Rawls. — Clarifica la teoría y discute sus críticas principales.', 'Libro', NULL, 'Pendiente', NULL, 2),
    ('Justicia', 'Rawls', 'Samuel Freeman', 2007, 'Manual completo para entender la teoría de Rawls en profundidad. — Muy pedagógico, aclara detalles del Principio de diferencia.', 'Libro', NULL, 'Pendiente', NULL, 3),
    ('Justicia', 'Realizing Rawls', 'Thomas Pogge', 1989, 'Análisis técnico de la implementación práctica del principio. — Analiza problemas concretos de aplicación.', 'Libro', NULL, 'Pendiente', NULL, 4),
    ('Justicia', 'Anarchy, State and Utopia', 'Robert Nozick', 1974, 'Crítica libertaria al Principio de diferencia desde derechos individuales. — Pone en cuestión la justificación de Rawls de forma clásica.', 'Libro', NULL, 'Pendiente', NULL, 5),
    ('Justicia', 'The Idea of Justice', 'Amartya Sen', 2009, 'Alternativa al marco de Rawls sobre equidad y desigualdad. — Propone una visión más práctica y menos contractualista.', 'Libro', NULL, 'Pendiente', NULL, 6),
    ('Justicia', 'If You’re an Egalitarian, How Come You’re So Rich?', 'G.A. Cohen', 2000, 'Crítica desde la izquierda igualitarista al principio de diferencia. — Cuestiona que Rawls sea verdaderamente igualitarista.', 'Libro', NULL, 'Pendiente', NULL, 7),
    ('Justicia', 'Justice as Fairness: Political not Metaphysical', 'John Rawls', 1985, 'Artículo donde aclara el enfoque político del principio. — Aclara el alcance práctico y filosófico.', 'Libro', NULL, 'Pendiente', NULL, 8),
    ('Justicia', 'What is the Point of Equality?', 'Elizabeth Anderson', 1999, 'Artículo que propone una crítica feminista-relacional a Rawls. — Discute los límites éticos y sociales del principio.', 'Libro', NULL, 'Pendiente', NULL, 9),
    ('Justicia', 'Liberalism and the Limits of Justice', 'Michael Sandel', 1998, 'Crítica comunitarista al individualismo en Rawls. — Explora debilidades del marco liberal.', 'Libro', NULL, 'Pendiente', NULL, 10),
    ('Justicia', 'Sovereign Virtue: The Theory and Practice of Equality', 'Ronald Dworkin', 2000, 'Alternativa teórica al Principio de diferencia con enfoque en respeto igualitario. — Amplía el debate contemporáneo en torno a la igualdad.', 'Libro', NULL, 'Pendiente', NULL, 11),
    ('Justicia', 'Introducción a la Filosofía del Derecho', 'Carlos Santiago Nino', NULL, 'Capítulos sobre Rawls, muy claros y resumidos. — Visión introductoria sencilla en español.', 'Libro', NULL, 'Pendiente', NULL, 12),
    ('Justicia', 'Why Social Justice Matters', 'Brian Barry', 2005, 'Defensa de ideas afines al Principio de diferencia en tono accesible. — Actualiza el debate sobre justicia e igualdad.', 'Libro', NULL, 'Pendiente', NULL, 13),
    ('Peronismo', 'La comunidad organizada', 'Juan Domingo Perón', 1949, 'Obra central del pensamiento peronista clásico. — Fuente directa del pensamiento de Perón.', 'Libro', NULL, 'Pendiente', NULL, 14),
    ('Peronismo', 'Conducción política', 'Juan Domingo Perón', 1952, 'Compilación de clases sobre liderazgo político. — Clave para entender la doctrina peronista sobre el poder.', 'Libro', NULL, 'Pendiente', NULL, 15),
    ('Peronismo', 'La razón de mi vida', 'Eva Perón', 1951, 'Autobiografía con fuerte carga ideológica. — Fundamental para entender el rol simbólico de Evita.', 'Libro', NULL, 'Pendiente', NULL, 16),
    ('Peronismo', 'Perón: Formación, ascenso y caída (1893-1955)', 'Joseph Page', 1983, 'Biografía exhaustiva y mirada externa rigurosa. — Contextualiza históricamente el surgimiento de Perón.', 'Libro', NULL, 'Pendiente', NULL, 17),
    ('Peronismo', 'El peronismo (1943-1955)', 'Hugo Gambini', 1982, 'Visión crítica y muy documentada. — Clásico para entender las tensiones de la etapa inicial.', 'Libro', NULL, 'Pendiente', NULL, 18),
    ('Peronismo', 'El 45. Crónica de un año decisivo', 'Félix Luna', 1993, 'Relata el contexto político-social del surgimiento peronista. — Ayuda a comprender el clima social previo al peronismo.', 'Libro', NULL, 'Pendiente', NULL, 19),
    ('Peronismo', 'Breve historia del peronismo clásico', 'Juan Carlos Torre', 2002, 'Síntesis clara y actualizada. — Muy útil como introducción general.', 'Libro', NULL, 'Pendiente', NULL, 20),
    ('Peronismo', 'La larga agonía de la Argentina peronista', 'Nicolás Iñigo Carrera', 1993, 'Perspectiva marxista crítica del ciclo peronista. — Aporta una mirada distinta a la hegemónica.', 'Libro', NULL, 'Pendiente', NULL, 21),
    ('Peronismo', 'La otra historia del peronismo', 'Ernesto Semán', 2016, 'Relectura cultural y sociológica del peronismo. — Actualiza el debate desde perspectivas culturales.', 'Libro', NULL, 'Pendiente', NULL, 22),
    ('Peronismo', 'El peronismo en el gobierno (1989-2015)', 'Juan Carlos Torre', 2016, 'Análisis crítico del PJ en democracia. — Claves para entender su evolución reciente.', 'Libro', NULL, 'Pendiente', NULL, 23),
    ('Peronismo', 'Peronismo: la persistencia de una ideología populista', 'Steven Levitsky', 2005, 'Análisis desde la ciencia política. — Ubica al peronismo en debates comparativos.', 'Libro', NULL, 'Pendiente', NULL, 24),
    ('Peronismo', 'Historia del peronismo', 'Roberto Baschetti (comp.)', NULL, 'Compilación documental (1943-1955 / 1956-1983). — Ofrece fuentes visuales y documentos clave.', 'Libro', NULL, 'Pendiente', NULL, 25),
    ('Peronismo', 'Populismo', 'Ernesto Laclau', 2005, 'Marco teórico sobre populismo y peronismo. — Fundamental para entender el debate ideológico.', 'Libro', NULL, 'Pendiente', NULL, 26),
    ('Peronismo', 'La razón populista', 'Ernesto Laclau', 2005, 'Teoría del discurso populista con ejemplos del peronismo. — Profundiza el marco teórico.', 'Libro', NULL, 'Pendiente', NULL, 27),
    ('Peronismo', 'El mito del populismo', 'Pierre Rosanvallon', 2007, 'Crítica al concepto populista. — Ofrece otra visión del debate teórico.', 'Libro', NULL, 'Pendiente', NULL, 28),
    ('Peronismo', 'Peronismo, populismo y democracia en la Argentina', 'Steven Levitsky', NULL, 'Artículo académico sobre el peronismo en democracia. — Análisis comparativo actualizado.', 'Libro', NULL, 'Pendiente', NULL, 29),
    ('Peronismo', '¿Qué es el populismo?', 'Pierre Rosanvallon y Ernesto Laclau', NULL, 'Artículos y debates cruzados. — Enfrenta visiones distintas sobre el populismo.', 'Libro', NULL, 'Pendiente', NULL, 30),
    ('Peronismo', '¿Peronismo o peronismos?', 'Natalia Milanesio', NULL, 'Estudios sobre cultura e identidades peronistas. — Actualiza debates sobre el pluralismo peronista.', 'Libro', NULL, 'Pendiente', NULL, 31),
    ('Peronismo', 'Revista Prismas (varios números)', 'Apuntes de Historia Intelectual', NULL, 'Artículos dedicados al peronismo y populismo. — Mirada crítica e intelectual reciente.', 'Libro', NULL, 'Pendiente', NULL, 32),
    ('Liberalismo', 'Segundo tratado sobre el gobierno civil', 'John Locke', 1689, 'Fundamento del liberalismo político clásico. — Establece la base de la teoría liberal moderna.', 'Libro', NULL, 'Pendiente', NULL, 33),
    ('Liberalismo', 'Cartas sobre la tolerancia', 'John Locke', 1689, 'Defensa de la libertad de conciencia. — Central para entender la relación entre religión y liberalismo.', 'Libro', NULL, 'Pendiente', NULL, 34),
    ('Liberalismo', 'El espíritu de las leyes', 'Montesquieu', 1748, 'Idea de separación de poderes, germen liberal. — Clave para comprender la institucionalidad liberal.', 'Libro', NULL, 'Pendiente', NULL, 35),
    ('Liberalismo', 'La riqueza de las naciones', 'Adam Smith', 1776, 'Base del liberalismo económico. — Fundamento de la economía de mercado en el liberalismo.', 'Libro', NULL, 'Pendiente', NULL, 36),
    ('Liberalismo', 'Sobre la libertad', 'John Stuart Mill', 1859, 'Defensa del individuo y de la libertad de expresión. — Texto esencial sobre derechos individuales y libertad civil.', 'Libro', NULL, 'Pendiente', NULL, 37),
    ('Liberalismo', 'Consideraciones sobre el gobierno representativo', 'John Stuart Mill', 1861, 'Defensa del sistema parlamentario como ideal liberal. — Aporta a la teoría de la representación y democracia liberal.', 'Libro', NULL, 'Pendiente', NULL, 38),
    ('Liberalismo', 'Camino de servidumbre', 'Friedrich Hayek', 1944, 'Crítica a las planificaciones estatales y defensa de las libertades. — Advierte sobre los peligros del totalitarismo.', 'Libro', NULL, 'Pendiente', NULL, 39),
    ('Liberalismo', 'Constitución de la libertad', 'Friedrich Hayek', 1960, 'Desarrolla la teoría liberal del orden espontáneo. — Profundiza la visión del liberalismo clásico en el siglo XX.', 'Libro', NULL, 'Pendiente', NULL, 40),
    ('Liberalismo', 'Los fundamentos de la libertad', 'Isaiah Berlin', 1969, 'Diferencia entre libertad negativa y positiva. — Fundamental para entender debates internos del liberalismo.', 'Libro', NULL, 'Pendiente', NULL, 41),
    ('Liberalismo', 'Justicia y mercado', 'John Tomasi', 2012, 'Liberalismo de mercado y justicia social. — Renueva el debate sobre libertades económicas y justicia.', 'Libro', NULL, 'Pendiente', NULL, 42),
    ('Liberalismo', 'Capitalismo y libertad', 'Milton Friedman', 1962, 'Defensa del capitalismo como garante de libertades. — Texto clave del liberalismo económico contemporáneo.', 'Libro', NULL, 'Pendiente', NULL, 43),
    ('Liberalismo', 'Anarquía, Estado y Utopía', 'Robert Nozick', 1974, 'Defensa del libertarianismo contra Rawls. — Contrapunto liberal-libertario al igualitarismo.', 'Libro', NULL, 'Pendiente', NULL, 44),
    ('Liberalismo', 'Teoría de la justicia', 'John Rawls', 1971, 'Redefinición del liberalismo desde la equidad. — Renovó el liberalismo político con énfasis en la justicia social.', 'Libro', NULL, 'Pendiente', NULL, 45),
    ('Liberalismo', 'El liberalismo político', 'John Rawls', 1993, 'Replanteo del liberalismo para sociedades plurales. — Fundamental para el debate liberal contemporáneo.', 'Libro', NULL, 'Pendiente', NULL, 46),
    ('Liberalismo', 'El miedo a la libertad', 'Erich Fromm', 1941, 'Crítica psico-social al concepto liberal de libertad. — Perspectiva crítica desde la psicología y la sociología.', 'Libro', NULL, 'Pendiente', NULL, 47),
    ('Liberalismo', 'El liberalismo. Historia de una ilusión', 'Jordi Canal', 2015, 'Historia y evolución crítica del liberalismo. — Contextualiza históricamente su evolución.', 'Libro', NULL, 'Pendiente', NULL, 48),
    ('Liberalismo', 'Liberalism: A Very Short Introduction', 'Michael Freeden', 2015, 'Síntesis breve y clara para introducirse. — Ideal para una visión general rápida y académica.', 'Libro', NULL, 'Pendiente', NULL, 49),
    ('Liberalismo', 'Historia intelectual del liberalismo', 'Pierre Manent', 1987, 'Recorrido por las ideas centrales del liberalismo. — Estudia la tradición liberal desde sus raíces filosóficas.', 'Libro', NULL, 'Pendiente', NULL, 50),
    ('Liberalismo', 'El liberalismo no es pecado', 'Juan Ramón Rallo', 2011, 'Defensa del liberalismo económico. — Aboga por un liberalismo clásico en el debate actual.', 'Libro', NULL, 'Pendiente', NULL, 51)
) AS v(subtema, titulo, autor, anio, resumen, tipo, enlace, estado, inicio, orden)
WHERE t.nombre = 'Filosofía política'
  AND NOT EXISTS (
      SELECT 1 FROM libros lb
      WHERE lb.user_id = t.user_id AND lb.tema_id = t.id AND lb.titulo = v.titulo
  );


-- ================================================================
-- Verificación
-- ================================================================
--   SELECT t.nombre AS tema, lb.subtema, COUNT(*)
--   FROM libros lb JOIN temas t ON t.id = lb.tema_id
--   GROUP BY t.nombre, lb.subtema
--   ORDER BY t.nombre, lb.subtema;
--
--   SELECT COUNT(*) AS total_libros FROM libros;   -- debe dar 18 + 94
-- ================================================================
