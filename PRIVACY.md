# Política de privacidad de Minerva ADR

Última actualización: 12 de noviembre de 2026.

Minerva ADR es una aplicación para Confluence Cloud desarrollada por el equipo de Infraestructura de CENIA. Lee minutas de reuniones desde una carpeta de Google Drive, extrae las decisiones y las muestra en una página del espacio de Confluence.

## Qué datos guarda

Todo se guarda en la base Forge SQL de la instalación, alojada por Atlassian. Cada sitio de Atlassian donde se instala tiene su propia base, separada de las demás.

- **Identificadores de Atlassian:** el account ID de quien configura la carpeta de Drive de un espacio, y los IDs de los espacios.
- **Decisiones extraídas de las minutas:** título, decisión, contexto, responsable, fecha de la reunión, estado y fragmentos de evidencia. Pueden incluir nombres de personas que aparecen en las minutas.
- **Metadatos de los archivos de Drive:** ID, nombre, fecha de modificación y hashes de los archivos procesados, y el ID y nombre de la carpeta configurada.

La aplicación no guarda el contenido completo de las minutas ni datos de pago.

## Acceso a Google Drive

- Cada persona autoriza el acceso con su propia cuenta de Google mediante OAuth.
- Permisos solicitados: `drive.readonly` (solo lectura) y `userinfo.email` (para mostrar con qué cuenta se conectó).
- La aplicación solo lee la carpeta configurada en cada espacio. No crea, modifica ni borra archivos en Drive.
- Los tokens de Google los guarda y renueva la plataforma Forge de Atlassian, no la aplicación.
- El uso de datos de Google se ajusta a la [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), incluidos los requisitos de uso limitado.

## Con quién se comparten

- La aplicación no vende ni comparte datos con terceros.
- Solo se comunica con las APIs de Google (`googleapis.com`, `accounts.google.com`, `oauth2.googleapis.com`) y con Confluence.
- Cada persona ve solo los espacios de Confluence a los que ya tiene acceso.
- Los registros técnicos (logs) incluyen IDs de espacio, nombres de carpetas y conteos de la sincronización. No incluyen el contenido de las decisiones.

## Conservación y eliminación

- Los datos se conservan mientras la aplicación esté instalada.
- Una decisión archivada sigue guardada hasta que se borra desde la aplicación.
- Al desinstalar la aplicación, Atlassian elimina los datos de Forge SQL de esa instalación según sus políticas de retención.
- El acceso a Google se puede revocar en cualquier momento desde la cuenta de Google, en "Seguridad > Conexiones con terceros".

## Contacto

Equipo de Infraestructura de CENIA: esteban.palma@cenia.cl
