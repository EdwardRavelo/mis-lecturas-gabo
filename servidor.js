// Servidor estático mínimo, sin dependencias.
// Uso: node servidor.js [carpeta] [puerto]
const http = require('http');
const fs = require('fs');
const path = require('path');

// Se resuelve a absoluta: la comprobación anti-escape de más abajo compara
// contra path.resolve(raiz), así que una raíz relativa como "." producía
// rutas relativas que nunca casaban y devolvían 403 para todo.
const raiz = path.resolve(process.argv[2] || process.cwd());
const puerto = parseInt(process.argv[3] || '8000', 10);

const tipos = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.sql': 'text/plain; charset=utf-8'
};

http.createServer((req, res) => {
    let ruta = decodeURIComponent(req.url.split('?')[0]);
    if (ruta === '/') ruta = '/index.html';

    // Sin escapar de la raíz
    const destino = path.join(raiz, path.normalize(ruta).replace(/^(\.\.[/\\])+/, ''));
    if (!destino.startsWith(path.resolve(raiz))) {
        res.writeHead(403).end('Prohibido');
        return;
    }

    fs.readFile(destino, (err, datos) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('No encontrado: ' + ruta);
            console.log('404', ruta);
            return;
        }
        res.writeHead(200, {
            'Content-Type': tipos[path.extname(destino).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store'   // que se vean los cambios al recargar
        });
        res.end(datos);
        console.log('200', ruta);
    });
}).listen(puerto, () => {
    console.log(`Sirviendo ${raiz}`);
    console.log(`→ http://localhost:${puerto}`);
});
