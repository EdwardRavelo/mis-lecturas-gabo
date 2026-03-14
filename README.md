# 📚 Mis Lecturas - Gabriel García Márquez

Una aplicación web interactiva para visualizar y gestionar tus lecturas de las obras completas de Gabriel García Márquez.

![Gabriel García Márquez](images/gabo-header.jpg)

## ✨ Características

### 🎨 Diseño Temático
- **Paleta de colores inspirada en GGM**: Amarillo mariposa, verde caribeño, tierra de Macondo
- **Mariposas amarillas animadas**: Referencia icónica a "Cien años de soledad" y Mauricio Babilonia
- **Tipografía elegante**: Combinación de fuentes serif y sans-serif
- **Diseño responsivo**: Optimizado para desktop, tablet y móvil

### 📖 Gestión de Lecturas
- **17 obras completas** de Gabriel García Márquez (1955-2024)
- **Estados de lectura**: Leído, Leyendo, Pendiente
- **Portadas automáticas**: Obtenidas desde Google Books API
- **Edición en tiempo real**: Modal interactivo para actualizar estado y fechas
- **Persistencia de datos**: LocalStorage para guardar tus cambios

### 📊 Análisis y Estadísticas
- **Cálculo automático de días de lectura**:
  - Para libros "Leídos": diferencia entre fecha inicio y final
  - Para libros "Leyendo": días transcurridos desde inicio hasta HOY (se actualiza en tiempo real)
- **Panel de estadísticas**:
  - Total de libros leídos, leyendo y pendientes
  - Total de páginas leídas
  - Promedio de días por libro
- **Gráficas interactivas**:
  - Distribución por estado (gráfica circular)
  - Páginas leídas por mes (gráfica de barras)

### 🔍 Filtros y Búsqueda
- Filtrar por estado: Todos, Leídos, Leyendo, Pendientes
- Búsqueda por título en tiempo real
- Timeline visual cronológico (1955-2024)

### 🎭 Animaciones Sutiles
- Mariposas amarillas flotando en el fondo
- Transiciones suaves al hacer hover
- Efectos de fade-in al cargar
- Animaciones de glow en el timeline
- Efecto shimmer mientras cargan las portadas

## 🚀 Cómo Usar

### Instalación
1. Clona o descarga este repositorio
2. Abre el archivo `index.html` en tu navegador web preferido
3. ¡Listo! No requiere instalación ni servidor web

### Uso Básico

#### Ver tus Lecturas
- La página principal muestra todos los libros en orden cronológico
- Cada tarjeta muestra: portada, año, título, páginas, días de lectura, estado y fechas

#### Editar una Lectura
1. Haz click en cualquier tarjeta de libro
2. Se abrirá un modal con el formulario de edición
3. Actualiza el estado (Pendiente/Leyendo/Leído)
4. Agrega o modifica fechas (formato: DD/mes/YYYY)
5. Los días se calculan automáticamente
6. Haz click en "Guardar Cambios"

#### Filtrar Libros
- Usa los botones de filtro: Todos, Leídos, Leyendo, Pendientes
- O usa la barra de búsqueda para encontrar un libro específico

#### Resetear Datos
- Si quieres volver a los datos originales, haz click en "↻ Resetear datos"
- Esto borrará todas tus ediciones (confirma antes de proceder)

## 📋 Formato de Fechas

Las fechas deben ingresarse en formato español:
```
DD/mes/YYYY
```

Ejemplos válidos:
- `28/diciembre/2025`
- `01/febrero/2026`
- `15/marzo/2026`

Meses aceptados:
enero, febrero, marzo, abril, mayo, junio, julio, agosto, septiembre, octubre, noviembre, diciembre

## 🛠️ Tecnologías Utilizadas

### Frontend
- **HTML5**: Estructura semántica
- **CSS3**: Estilos y animaciones
  - CSS Grid y Flexbox para layouts responsivos
  - CSS Custom Properties (variables)
  - Animaciones con keyframes
- **JavaScript ES6+**: Lógica de la aplicación
  - Vanilla JS (sin frameworks)
  - LocalStorage para persistencia
  - Fetch API para Google Books

### Librerías Externas
- **[Chart.js v4](https://www.chartjs.org/)**: Gráficas interactivas (CDN)

### APIs
- **[Google Books API](https://developers.google.com/books)**: Portadas de libros automáticas

## 📁 Estructura del Proyecto

```
mis-lecturas-gabo/
│
├── index.html              # Página principal
│
├── css/
│   ├── styles.css         # Estilos principales
│   └── animations.css     # Animaciones y efectos
│
├── js/
│   ├── data.js           # Datos de los 17 libros
│   ├── app.js            # Lógica principal
│   ├── charts.js         # Sistema de gráficas
│   └── butterflies.js    # Animación de mariposas
│
├── images/
│   └── gabo-header.jpg   # Foto de Gabriel García Márquez
│
└── README.md             # Este archivo
```

## 🎨 Paleta de Colores

| Color | Hex | Uso |
|-------|-----|-----|
| Amarillo Mariposa | `#FFD700` | Acentos y detalles dorados |
| Verde Caribe | `#50C878` | Gráficas y elementos verdes |
| Tierra Macondo | `#8B4513` | Títulos y elementos principales |
| Crema Papel | `#F5E6D3` | Fondos y texturas suaves |
| Azul Oscuro | `#2C3E50` | Textos principales |
| Verde Leído | `#4CAF50` | Estado "Leído" |
| Naranja Leyendo | `#FFA726` | Estado "Leyendo" |
| Gris Pendiente | `#9E9E9E` | Estado "Pendiente" |

## 🔧 Funcionalidades Técnicas

### Cálculo Automático de Días
```javascript
// Para libros "Leído"
dias = fechaFinal - fechaInicio

// Para libros "Leyendo"
dias = HOY - fechaInicio (se actualiza cada minuto)

// Para libros "Pendiente"
dias = null
```

### Persistencia con LocalStorage
- Los datos se guardan automáticamente en localStorage
- Se cargan al iniciar la aplicación
- Función de reset para volver a datos originales

### Integración con Google Books API
- Búsqueda por título y autor
- Caché de portadas en localStorage
- Fallback a placeholder si no se encuentra portada

## 📱 Compatibilidad

### Navegadores Soportados
- ✅ Chrome/Edge (últimas 2 versiones)
- ✅ Firefox (últimas 2 versiones)
- ✅ Safari (últimas 2 versiones)
- ✅ Opera (últimas 2 versiones)

### Responsive Breakpoints
- **Desktop**: > 1024px (3 columnas)
- **Tablet**: 768px - 1024px (2 columnas)
- **Mobile**: < 768px (1 columna)

### Accesibilidad
- ✅ HTML5 semántico
- ✅ Alt text en imágenes
- ✅ Contraste de colores WCAG AA
- ✅ Navegación por teclado
- ✅ Soporte para `prefers-reduced-motion`

## 📚 Obras Incluidas

1. **La hojarasca** (1955) - 192 pág.
2. **El coronel no tiene quien le escriba** (1961) - 128 pág.
3. **La mala hora** (1962) - 200 pág.
4. **Los funerales de la Mamá Grande** (1962) - 176 pág.
5. **Cien años de soledad** (1967) - 496 pág. ⭐ Obra maestra
6. **Relato de un náufrago** (1970) - 168 pág.
7. **La increíble y triste historia de la cándida Eréndira...** (1972) - 160 pág.
8. **El otoño del patriarca** (1975) - 304 pág.
9. **Crónica de una muerte anunciada** (1981) - 144 pág.
10. **El amor en los tiempos del cólera** (1985) - 368 pág.
11. **La aventura de Miguel Littín clandestino en Chile** (1986) - 192 pág.
12. **El general en su laberinto** (1989) - 304 pág.
13. **Doce cuentos peregrinos** (1992) - 224 pág.
14. **Del amor y otros demonios** (1994) - 176 pág.
15. **Noticia de un secuestro** (1996) - 352 pág.
16. **Vivir para contarla** (2002) - 576 pág.
17. **Memoria de mis putas tristes** (2004) - 128 pág.
18. **En agosto nos vemos** (2024) - 144 pág. (Póstuma)

**Total: 4,368 páginas de realismo mágico**

## 🎯 Próximas Mejoras (Ideas)

- [ ] Exportar datos a CSV/JSON
- [ ] Importar datos desde archivo
- [ ] Agregar notas personales por libro
- [ ] Sistema de calificación (estrellas)
- [ ] Modo oscuro
- [ ] Compartir progreso en redes sociales
- [ ] PWA (Progressive Web App) para uso offline
- [ ] Sincronización con cloud (Firebase/Supabase)

## 🙏 Créditos

### Autor de la Aplicación
Edward Morales - 2026

### Inspiración
**Gabriel García Márquez** (1927-2014)  
Premio Nobel de Literatura 1982

### Imagen
Foto de Gabriel García Márquez desde Wikimedia Commons (dominio público)

### Herramientas
- [Chart.js](https://www.chartjs.org/) - Gráficas interactivas
- [Google Books API](https://developers.google.com/books) - Portadas de libros
- [Google Fonts](https://fonts.google.com/) - Tipografías Crimson Text e Inter

## 📄 Licencia

Este proyecto es de código abierto y está disponible bajo la licencia MIT.

---

## 💛 Dedicatoria

> "La vida no es la que uno vivió, sino la que uno recuerda y cómo la recuerda para contarla"  
> — Gabriel García Márquez

Esta aplicación fue creada con amor para celebrar la obra de uno de los más grandes escritores de todos los tiempos. Que las mariposas amarillas te acompañen en cada lectura.

**¡Feliz lectura! 📚✨🦋**
