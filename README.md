# Minerva ADR Forge

Aplicación desarrollada con Atlassian Forge para gestionar decisiones arquitectónicas (Architecture Decision Records, ADR) dentro de espacios de Confluence Cloud, a partir de minutas generadas en formato Markdown.

El sistema permite identificar candidatos ADR, revisarlos y mantener un registro de las decisiones tomadas por los equipos.

## Características

### Gestión de decisiones

- Extracción automática de candidatos ADR desde archivos Markdown.
- Creación manual de decisiones.
- Revisión humana: validar o descartar candidatos.
- Edición de títulos, decisiones, contexto, proyectos y responsables.
- Estados: Propuesto, En discusión, Aprobada, Rechazada y Obsoleta.
- Archivado, restauración y eliminación definitiva.
- Filtros, indicadores y paginación.

### Integración con Google Drive

- Autenticación mediante Google OAuth 2.0.
- Búsqueda y selección de carpetas.
- Exploración recursiva de subcarpetas.
- Sincronización manual de minutas Markdown.
- Detección de archivos nuevos o modificados.
- Prevención de duplicados mediante hashes.
- Registro del historial de sincronización.
- Opción de reprocesar archivos.

### Integración con Confluence

Minerva ADR utiliza `confluence:spacePage` para integrarse en la navegación de los espacios de Confluence.

La aplicación permite que varios equipos utilicen Minerva ADR de forma independiente:

- Cada espacio dispone de sus propios registros ADR.
- Cada espacio puede configurar su propia carpeta de Google Drive.
- Las consultas y modificaciones se filtran por `space_id`.
- Una instalación de la aplicación comparte una instancia de Forge SQL.
- Las instalaciones en distintos sitios de Atlassian mantienen bases de datos independientes.

La aplicación también conserva el módulo `confluence:globalPage`, aunque las operaciones de gestión requieren un contexto de espacio.

## Arquitectura

| Componente | Tecnología |
|---|---|
| Plataforma | Atlassian Confluence Cloud |
| Framework | Atlassian Forge |
| Frontend | React y Forge UI Kit |
| Backend | Forge Functions y resolvers |
| Base de datos | Forge SQL (MySQL) |
| Parser | JavaScript / Node.js |
| Integración externa | Google Drive API v3 |
| Autenticación externa | OAuth 2.0 |

## Estructura del proyecto

```text
src/
├── database/
│   └── migrations.js
├── frontend/
│   └── index.jsx
├── google-drive/
│   ├── drive-client.js
│   └── sync.js
├── parser/
│   ├── extractor.js
│   └── markdown-parser.js
├── resolvers/
│   └── index.js
└── index.js
```

## Requisitos

- Node.js 22.x o 24.x compatible con Forge CLI.
- npm.
- Atlassian Forge CLI.
- Acceso a Confluence Cloud.
- Permisos para instalar aplicaciones en el sitio.
- Configuración OAuth de Google para utilizar Google Drive.

## Instalación y desarrollo

Clonar el repositorio e instalar dependencias:

```bash
git clone https://github.com/Sysadmins-CENIA/Minerva-ADR.git
cd Minerva-ADR
npm install
```

Autenticarse con Atlassian Forge:

```bash
forge login
```

Validar el proyecto:

```bash
npm run lint
forge lint
```

Desplegar:

```bash
forge deploy --environment development
```

Instalar en Confluence:

```bash
forge install --environment development
```

Actualizar una instalación existente:

```bash
forge install --upgrade --environment development
```

**Nota:** para desplegar una copia propia del proyecto se requiere configurar su identificador de aplicación Forge y sus credenciales OAuth. No debe reutilizarse el identificador de producción de otra organización sin autorización.

## Uso

1. Abrir un espacio de Confluence donde esté instalada Minerva ADR.
2. Acceder a la página **Minerva ADR** del espacio.
3. En **Configuración**, conectar la cuenta de Google.
4. Seleccionar una carpeta de Google Drive con las minutas.
5. Ejecutar **Sincronizar ahora**.
6. Revisar los candidatos desde **Decisiones**.
7. Validar, descartar, editar o archivar según corresponda.

También es posible importar archivos `.md` y registrar decisiones manualmente desde **Incorporar**.

## Modelo de datos

La persistencia se implementa mediante Forge SQL.

Tablas principales:

- `adr_candidates`: decisiones y candidatos ADR.
- `drive_space_config`: carpeta de Google Drive por espacio.
- `drive_sync_files`: historial de archivos procesados.
- `drive_user_config`: configuración heredada por usuario, conservada por compatibilidad.

El aislamiento lógico entre espacios utiliza `space_id`.

Las migraciones SQL se aplican solas en la primera llamada al resolver de cada contenedor (`ensureMigrations`), tanto en instalaciones nuevas como después de cada despliegue. No hace falta activar ningún disparador.

## Limitaciones y tareas pendientes

- Automatizar la sincronización periódica de Google Drive.
- Resolver la autenticación OAuth para ejecuciones sin sesión interactiva.
- Definir una política para migrar los registros históricos sin `space_id`.
- Completar la configuración y verificación de Google OAuth para uso institucional.
- Validar la instalación en el Confluence institucional de CENIA.

## Estado del proyecto

**Prototipo funcional desplegado en entorno de desarrollo.**

Funcionan la gestión de candidatos ADR, la importación de Markdown, la sincronización manual de Google Drive y la separación lógica de datos por espacio de Confluence.
