# Landing de CRM ProShop

Sitio estático (un solo `index.html`) servido con nginx. Vive en esta rama (`landing`), separada del CRM.

## Archivos
- `index.html`: la página completa (HTML, CSS y JS dentro). Es la V2 de la landing más las animaciones y la sección "Así se mueve tu proceso comercial, paso a paso".
- `logo-proshop.png` y `brand-*.png`: logo e íconos del ecosistema (Meta, WhatsApp, Google, OpenAI).
- `robots.txt`
- `nginx.conf` y `Dockerfile`: imagen del sitio.

## Despliegue en Coolify (recurso aparte)
1. Nuevo recurso desde el repositorio `jonathanSCM/chats`, rama **`landing`**.
2. Build pack: **Dockerfile**. Puerto: **80**.
3. Dominio: el que quieras usar para la landing.
4. Healthcheck: `GET /health` responde `ok`.

## Contacto
El formulario no usa servidor: abre WhatsApp con el mensaje prellenado y la persona lo envía.

## Probar en local
Abrir `index.html` con doble clic, o con Docker:

```bash
docker build -t proshop-landing .
docker run --rm -p 8080:80 proshop-landing
```
