# 📖 Diario de Lecturas

Aplicación web para llevar un diario de lecturas organizado por temas: qué estás leyendo, qué terminaste, cuánto te llevó y qué pensaste de cada cosa.

Empezó como un catálogo fijo de las 18 obras de Gabriel García Márquez y hoy admite cualquier material de lectura o estudio —libros, cursos, documentación, vídeos, películas, artículos— agrupado en los temas que vos crees.

![Gabriel García Márquez](images/gabo-header.jpg)

## Qué hace

**Organización por temas y subtemas**
- Cada tema tiene su propio color de acento, que tiñe toda la interfaz al seleccionarlo
- Dentro de un tema, los subtemas agrupan las lecturas (por ejemplo `Básico` / `Intermedio` / `Avanzado`)
- Los libros sin tema no se pierden: quedan en "Sin tema" para reasignarlos

**Seguimiento de lectura**
- Tres estados: Pendiente, Leyendo, Leído
- Los días se calculan solos: para un libro leído, la diferencia entre fechas; para uno en curso, los días transcurridos hasta hoy, recalculados cada minuto
- Comentarios por lectura, para frases y reflexiones
- Enlace al recurso, imprescindible cuando la entrada es documentación o un curso
- Portadas automáticas desde la API de Google Books

**Análisis**
- Reparto por estado en barra apilada
- Páginas por mes
- Timeline cronológico de *lectura* (no de publicación), del más reciente al más antiguo

**Funciona aunque la nube no**
El plan gratuito de Supabase pausa el proyecto tras una semana sin actividad. La app está construida para sobrevivir a eso: guarda una copia local en cada escritura y arranca con ella si la nube no responde, en vez de dejarte en la pantalla de login. También podés entrar sin conexión a propósito.

Con la nube caída podés consultar y editar tu progreso, pero no crear ni borrar temas o libros: eso necesita un id generado por el servidor.

## Cómo ejecutarlo

Hay que servirlo por HTTP. Abrir `index.html` con doble clic rompe el login, porque OAuth necesita un origen real.

```bash
node servidor.js          # http://localhost:8000
node servidor.js . 8080   # otro puerto
```

`servidor.js` no tiene dependencias y manda `Cache-Control: no-store`, así que al recargar ves siempre la última versión.

### Configuración

1. Creá un proyecto en [Supabase](https://supabase.com/dashboard)
2. Pegá los esquemas en el SQL Editor, en orden: `supabase-schema.sql`, `supabase-schema-v2.sql`, `supabase-schema-v3.sql`
3. Poné la URL y la anon key en `js/supabase.js`
4. Habilitá GitHub como proveedor en Authentication → Providers
5. Agregá el origen desde el que servís (por ejemplo `http://localhost:8000`) a las Redirect URLs

La anon key va en el código a propósito: es pública por diseño. Lo que protege los datos es RLS, que restringe cada fila a su `auth.uid()`.

**Sobre el login:** solo GitHub está habilitado. El botón de Google existe en la interfaz pero el proveedor nunca se configuró, así que devuelve un error 400. Además, los datos están atados al `user_id` creado por GitHub: entrar con otro proveedor crearía un usuario nuevo y una biblioteca vacía.

## Respaldo

- **Exportar** descarga un JSON con temas y lecturas
- **Importar** restaura el *progreso* sobre los libros que ya existen, emparejando por título, y te avisa cuáles no encontró

Es la única copia que sobrevive tanto a un proyecto pausado como a un navegador limpio. La carga masiva de material nuevo se hace por SQL, como en `supabase-schema-v3.sql`.

## Formato de fechas

En la interfaz las fechas se escriben en español:

```
DD/mes/YYYY     →  15/marzo/2026
```

Meses válidos: enero, febrero, marzo, abril, mayo, junio, julio, agosto, septiembre, octubre, noviembre, diciembre.

Internamente la base guarda `DATE` en ISO y la traducción ocurre en un único punto (`js/db.js`), con cadenas y nunca con `Date`, para evitar corrimientos de un día por zona horaria.

## Tecnología

JavaScript puro, sin framework y sin paso de compilación. Chart.js por CDN para la gráfica de barras, Supabase para persistencia y autenticación, y la API de Google Books para las portadas.

El diseño es un sistema propio, *"Papel y tinta"*: papel crudo, tinta negra cálida y tipografía editorial, sin decoración que cueste espacio. Los tres colores de estado están validados para contraste y daltonismo sobre fondo claro; si los tocás, hay que revalidarlos.

La interfaz ocupa exactamente el alto de la ventana: la página no hace scroll, solo lo hacen la barra lateral y la rejilla de lecturas.

## Estructura

```
index.html              Una sola página: login, biblioteca y tres modales
servidor.js             Servidor estático mínimo, sin dependencias
css/
  styles.css            Sistema de diseño y layout
  animations.css        Keyframes y prefers-reduced-motion
js/
  supabase.js           Cliente (nunca lanza: si falla, modo offline)
  data.js               Fechas y conversión ISO ↔ español
  charts.js             Barra apilada de estados y páginas por mes
  db.js                 CRUD de temas y libros
  auth.js               Sesión, OAuth y modo offline
  app.js                Estado e interfaz
supabase-schema*.sql    Esquemas acumulativos (v1 → v3)
```

Para trabajar en el código, `CLAUDE.md` documenta las decisiones y las invariantes que conviene no romper.

## Licencia

MIT.

---

> "La vida no es la que uno vivió, sino la que uno recuerda y cómo la recuerda para contarla"
> — Gabriel García Márquez
