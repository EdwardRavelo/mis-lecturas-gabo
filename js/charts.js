// ========================================
// Sistema de Gráficas con Chart.js
// ========================================

let statusChart = null;
let pagesChart = null;

// Configuración de colores - Paleta Modernista
const chartColors = {
    leido: 'rgba(0, 217, 163, 0.7)',
    leyendo: 'rgba(255, 217, 61, 0.7)',
    pendiente: 'rgba(167, 139, 250, 0.5)',
    leidoBorder: 'rgba(0, 217, 163, 1)',
    leyendoBorder: 'rgba(255, 217, 61, 1)',
    pendienteBorder: 'rgba(167, 139, 250, 1)',
    tierra: 'rgba(255, 107, 157, 0.7)',
    amarillo: 'rgba(255, 217, 61, 0.8)',
    verde: 'rgba(0, 217, 163, 0.8)',
    caribe: 'rgba(0, 217, 163, 1)'
};

// Configuración común de Chart.js
Chart.defaults.font.family = "'DM Sans', sans-serif";
Chart.defaults.color = 'rgba(255, 255, 255, 0.7)';

// Función para crear gráfica de distribución por estado (Pie Chart)
function createStatusChart(libros) {
    const ctx = document.getElementById('status-chart');
    if (!ctx) return;
    
    // Contar libros por estado
    const estados = {
        'Leído': 0,
        'Leyendo': 0,
        'Pendiente': 0
    };
    
    libros.forEach(libro => {
        if (estados.hasOwnProperty(libro.estado)) {
            estados[libro.estado]++;
        }
    });
    
    // Destruir gráfica anterior si existe
    if (statusChart) {
        statusChart.destroy();
    }
    
    // Crear nueva gráfica
    statusChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Leídos', 'Leyendo', 'Pendientes'],
            datasets: [{
                label: 'Libros',
                data: [estados['Leído'], estados['Leyendo'], estados['Pendiente']],
                backgroundColor: [
                    chartColors.leido,
                    chartColors.leyendo,
                    chartColors.pendiente
                ],
                borderColor: [
                    chartColors.leidoBorder,
                    chartColors.leyendoBorder,
                    chartColors.pendienteBorder
                ],
                borderWidth: 2,
                hoverOffset: 10
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 22, 40, 0.9)',
                    padding: 12,
                    borderColor: 'rgba(0, 217, 163, 0.3)',
                    borderWidth: 1,
                    titleColor: '#FFFFFF',
                    bodyColor: 'rgba(255, 255, 255, 0.8)',
                    titleFont: {
                        size: 14,
                        weight: 'bold',
                        family: "'DM Sans', sans-serif"
                    },
                    bodyFont: {
                        size: 13,
                        family: "'DM Sans', sans-serif"
                    },
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = ((context.parsed / total) * 100).toFixed(1);
                            return `${context.label}: ${context.parsed} (${percentage}%)`;
                        }
                    }
                }
            },
            animation: {
                animateRotate: true,
                animateScale: true,
                duration: 1000,
                easing: 'easeInOutQuart'
            }
        }
    });
}

// Función para crear gráfica de páginas por mes (Bar Chart)
function createPagesChart(libros) {
    const ctx = document.getElementById('pages-chart');
    if (!ctx) return;
    
    // Agrupar libros por mes de finalización
    const mesesData = {};
    const mesesEspañol = [
        'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
        'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'
    ];
    
    libros.forEach(libro => {
        if (libro.estado === 'Leído' && libro.final) {
            const fecha = parseFechaEspañol(libro.final);
            if (fecha) {
                const mesAño = `${mesesEspañol[fecha.getMonth()]} ${fecha.getFullYear()}`;
                if (!mesesData[mesAño]) {
                    mesesData[mesAño] = {
                        paginas: 0,
                        libros: 0,
                        fecha: fecha
                    };
                }
                mesesData[mesAño].paginas += libro.paginas;
                mesesData[mesAño].libros++;
            }
        }
    });
    
    // Ordenar por fecha
    const mesesOrdenados = Object.keys(mesesData).sort((a, b) => {
        return mesesData[a].fecha - mesesData[b].fecha;
    });
    
    // Preparar datos para la gráfica
    const labels = mesesOrdenados;
    const datos = mesesOrdenados.map(mes => mesesData[mes].paginas);
    const librosCount = mesesOrdenados.map(mes => mesesData[mes].libros);
    
    // Si no hay datos, mostrar mensaje
    if (labels.length === 0) {
        labels.push('Sin datos');
        datos.push(0);
        librosCount.push(0);
    }
    
    // Destruir gráfica anterior si existe
    if (pagesChart) {
        pagesChart.destroy();
    }
    
    // Crear nueva gráfica
    pagesChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Páginas leídas',
                data: datos,
                backgroundColor: chartColors.verde,
                borderColor: chartColors.caribe,
                borderWidth: 2,
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)',
                        font: {
                            size: 12,
                            family: "'DM Sans', sans-serif"
                        },
                        callback: function(value) {
                            return value + ' pág.';
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    }
                },
                x: {
                    ticks: {
                        color: 'rgba(255, 255, 255, 0.7)',
                        font: {
                            size: 12,
                            weight: '500',
                            family: "'DM Sans', sans-serif"
                        }
                    },
                    grid: {
                        display: false,
                        drawBorder: false
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(10, 22, 40, 0.95)',
                    backdropFilter: 'blur(10px)',
                    borderColor: 'rgba(0, 217, 163, 0.3)',
                    borderWidth: 1,
                    titleColor: '#FFFFFF',
                    bodyColor: 'rgba(255, 255, 255, 0.9)',
                    titleFont: {
                        size: 14,
                        weight: 'bold',
                        family: "'DM Sans', sans-serif"
                    },
                    bodyFont: {
                        size: 13,
                        family: "'DM Sans', sans-serif"
                    },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const index = context.dataIndex;
                            const paginas = context.parsed.y;
                            const libros = librosCount[index];
                            return [
                                `Páginas: ${paginas}`,
                                `Libros: ${libros}`
                            ];
                        }
                    }
                }
            },
            animation: {
                duration: 1000,
                easing: 'easeInOutQuart'
            }
        }
    });
}

// Función para actualizar todas las gráficas
function updateCharts(libros) {
    createStatusChart(libros);
    createPagesChart(libros);
}

// Inicializar gráficas cuando el DOM esté listo
// (Se llamará desde app.js después de cargar los datos)
function initCharts(libros) {
    updateCharts(libros);
}

// Exportar funciones
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createStatusChart, createPagesChart, updateCharts, initCharts };
}
