# Minerva ADR Forge

Aplicación desarrollada sobre Atlassian Forge para gestionar decisiones
de arquitectura (Architecture Decision Records, ADR) desde Confluence.

## Características

-   Importación de minutas en formato Markdown.
-   Extracción de candidatos a decisiones arquitectónicas.
-   Registro manual de decisiones.
-   Revisión humana de candidatos.
-   Validación y descarte de candidatos.
-   Edición de decisiones y sus metadatos.
-   Gestión de estados de decisión:
    -   Propuesto
    -   En discusión
    -   Aprobada
    -   Rechazada
    -   Obsoleta
-   Archivado, restauración y eliminación de registros.
-   Persistencia mediante Forge SQL.

## Arquitectura

-   **Frontend:** React y `@forge/react`.
-   **Backend:** Forge Functions y resolvers.
-   **Base de datos:** Forge SQL (MySQL).
-   **Parser:** JavaScript para procesamiento de minutas Markdown.
-   **Plataforma:** Atlassian Confluence.

## Estructura del proyecto

``` text
src/
├── database/
│   ├── migrations/
│   └── migrations.js
├── frontend/
│   └── index.jsx
├── parser/
│   ├── extractor.js
│   └── markdown-parser.js
├── resolvers/
│   └── index.js
└── index.js
```

## Requisitos

-   Node.js 24.x
-   Atlassian Forge CLI
-   Acceso a un sitio Atlassian Confluence

## Desarrollo

Instalar dependencias:

``` bash
npm install
```

Ejecutar análisis estático:

``` bash
npm run lint
forge lint
```

Desplegar en el entorno de desarrollo:

``` bash
forge deploy --non-interactive --environment development
```

## Estado del proyecto

En desarrollo. La integración automática con Google Drive está
planificada.

## Licencia

Por definir.
