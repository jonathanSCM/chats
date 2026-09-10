-- Agrega LOCATION al enum MediaType, para mensajes de ubicación (recibidos y
-- enviados). No es un archivo descargado de Meta: mediaUrl guarda el link de
-- Google Maps directo, nunca pasa por el job de descarga de media.
ALTER TYPE "MediaType" ADD VALUE 'LOCATION';
