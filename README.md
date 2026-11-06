# Add-in independiente: Documentos de mantenimiento

Esta carpeta contiene una aplicación separada del add-in de inspección. No comparte código ejecutable ni modifica los archivos del proyecto original.

## Función incluida

- Captura desde la cámara/galería nativa de Drive o selección de imagen/PDF.
- Registro del tipo, fecha, proveedor, importe y descripción.
- Asociación al vehículo o al conductor actual de Drive.
- Cola local en IndexedDB para conservar documentos pendientes sin conexión y sincronizarlos al recuperar conexión.
- Asociación de `MediaFile` a vehículo o conductor y metadatos con tipo, fecha, proveedor, importe y descripción.
- Validación de JPG, PNG, WebP y PDF; límite de 10 MB.

## Estado de integración

El add-in crea el registro `MediaFile` y luego envía el binario mediante `UploadMediaFile`. Utiliza una `SolutionId` estable incluida en `main.js`. El usuario de Drive debe tener `ManageMedia`, y el permiso debe cubrir el vehículo/conductor asociado. La guía de Geotab describe los dos pasos de carga y los límites de archivo.

El repositorio Pages independiente `mantenimiento-documentacion` publica `index.html` e `icon.svg` desde su raíz. La URL del manifiesto apunta a `https://josetecnycom-ai.github.io/mantenimiento-documentacion/`. Actualiza/importa la versión `0.2.8` del manifiesto en MyGeotab. La etiqueta debe cambiar de `HTML v0.2.8 · JavaScript pendiente` a `v0.2.8 · JS activo` para confirmar que también se cargó `main.js`. La vista previa prueba primero una data URL y luego un URL blob; si Drive bloquea ambas, indica que la foto se puede guardar y elimina el icono de imagen rota. Los documentos se conservan localmente aunque Drive todavía no haya proporcionado vehículo/conductor y se asocian al recibirse ese contexto. El elemento usa `DriveAppLink/` para abrirse en Geotab Drive.

## Archivos

- `index.html`: interfaz móvil y punto de entrada del add-in.
- `main.js`: ciclo de vida de Drive, captura y persistencia offline.
- `style.css`: estilos adaptables a móvil.
- `manifest.json`: configuración independiente para registrar el add-in.
