# Add-in independiente: Documentos de mantenimiento

Esta carpeta contiene una aplicación separada del add-in de inspección. No comparte código ejecutable ni modifica los archivos del proyecto original.

## Función incluida

- Captura de foto desde móvil o selección de imagen.
- Registro del tipo, fecha, proveedor, importe y descripción.
- Asociación al vehículo o al conductor actual de Drive.
- Cola local en IndexedDB para conservar documentos pendientes, incluida la captura sin conexión.
- Validación de formatos JPG, PNG y WebP y tamaño máximo de 10 MB.

## Estado de integración

El flujo de captura y almacenamiento local está implementado. La sincronización binaria con Geotab requiere completar la configuración de `MediaFile`: registrar una `SolutionId` propia para esta solución, conceder `ManageMedia` al usuario de API y subir la imagen con `UploadMediaFile` después de crear el registro `MediaFile`. La guía de Geotab describe esos dos pasos y la asociación opcional a `Device` y `Driver`.

Antes de desplegar, reemplaza `TU-DOMINIO` en `manifest.json` por el dominio HTTPS donde alojes esta carpeta. El elemento usa `DriveAppLink/` para abrirse en Geotab Drive.

## Archivos

- `index.html`: interfaz móvil y punto de entrada del add-in.
- `main.js`: ciclo de vida de Drive, captura y persistencia offline.
- `style.css`: estilos adaptables a móvil.
- `manifest.json`: configuración independiente para registrar el add-in.
