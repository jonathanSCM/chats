# Landing de CRM ProShop

Sitio estático (un solo `index.html`) servido con nginx. Vive en esta rama (`landing`), separada del CRM.

## Archivos
- `index.html`: la página completa (HTML, CSS y JS dentro).
- `logo-proshop.png`: logo.
- `robots.txt`
- `nginx.conf` y `Dockerfile`: imagen del sitio.

## Despliegue en Coolify (recurso aparte)
1. Nuevo recurso desde el repositorio `jonathanSCM/chats`, rama **`landing`**.
2. Build pack: **Dockerfile**. Puerto: **80**.
3. Dominio: el que quieras usar para la landing.
4. Healthcheck: `GET /health` responde `ok`.

## Enlaces al CRM
El botón "Iniciar sesión" apunta a `https://chats.proshop.lat/login`. Si el dominio del CRM cambia, editar ese enlace en `index.html`.

## Probar en local
Abrir `index.html` con doble clic, o con Docker:

```bash
docker build -t proshop-landing .
docker run --rm -p 8080:80 proshop-landing
```
