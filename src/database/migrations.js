
import { migrationRunner } from '@forge/sql';

// ============================================================
// V001 - TABLA PRINCIPAL DE CANDIDATOS ADR
// ============================================================

const CREATE_ADR_CANDIDATES = `
  CREATE TABLE IF NOT EXISTS adr_candidates (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    decision TEXT NOT NULL,
    context TEXT,
    job VARCHAR(50),
    status VARCHAR(30) NOT NULL DEFAULT 'Propuesto',
    review_status VARCHAR(30) NOT NULL DEFAULT 'Pendiente de revisión',
    decision_owner VARCHAR(255),
    source_file VARCHAR(500) NOT NULL,
    meeting_date DATE,
    source_hash VARCHAR(64) NOT NULL,
    evidence JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;

// ============================================================
// V002 - V006
// ============================================================

const ADD_ARCHIVED_AT = `
  ALTER TABLE adr_candidates
  ADD COLUMN archived_at TIMESTAMP NULL
`;

const ADD_SOURCE_TYPE = `
  ALTER TABLE adr_candidates
  ADD COLUMN source_type VARCHAR(20) NOT NULL DEFAULT 'markdown'
`;

const ADD_SOURCE_REFERENCE = `
  ALTER TABLE adr_candidates
  ADD COLUMN source_reference VARCHAR(500) NULL
`;

const MAKE_SOURCE_FILE_NULLABLE = `
  ALTER TABLE adr_candidates
  MODIFY COLUMN source_file VARCHAR(500) NULL
`;

const MAKE_SOURCE_HASH_NULLABLE = `
  ALTER TABLE adr_candidates
  MODIFY COLUMN source_hash VARCHAR(64) NULL
`;

// ============================================================
// V007 - HISTORIAL DE SINCRONIZACIÓN
// ============================================================

const CREATE_DRIVE_SYNC_FILES = `
  CREATE TABLE IF NOT EXISTS drive_sync_files (
    file_id VARCHAR(255) PRIMARY KEY,
    file_name VARCHAR(500) NOT NULL,
    modified_time VARCHAR(40),
    md5_checksum VARCHAR(64),
    content_hash VARCHAR(64),
    status VARCHAR(20) NOT NULL DEFAULT 'error',
    last_error TEXT,
    processed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;

// ============================================================
// V008 - CONFIGURACIÓN LEGACY POR USUARIO
// ============================================================

const CREATE_DRIVE_USER_CONFIG = `
  CREATE TABLE IF NOT EXISTS drive_user_config (
    account_id VARCHAR(255) PRIMARY KEY,
    folder_id VARCHAR(255) NOT NULL,
    folder_name VARCHAR(500) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;

// ============================================================
// V009 - IDENTIFICADOR ÚNICO DE ARCHIVO GOOGLE DRIVE
// ============================================================

const ADD_SOURCE_FILE_ID = `
  ALTER TABLE adr_candidates
  ADD COLUMN source_file_id VARCHAR(255) NULL
`;

// ============================================================
// V010 - AISLAMIENTO DE ADR POR ESPACIO
// ============================================================

const ADD_ADR_SPACE_ID = `
  ALTER TABLE adr_candidates
  ADD COLUMN space_id VARCHAR(255) NULL
`;

// ============================================================
// V011 - CONFIGURACIÓN DE DRIVE POR ESPACIO
// ============================================================

// Cada espacio tiene una carpeta configurada.
// configured_by_account_id identifica al usuario que
// autorizó inicialmente esa configuración.
//
// La tabla legacy drive_user_config se conserva para
// evitar perder las configuraciones existentes.

const CREATE_DRIVE_SPACE_CONFIG = `
  CREATE TABLE IF NOT EXISTS drive_space_config (
    space_id VARCHAR(255) PRIMARY KEY,
    folder_id VARCHAR(255) NOT NULL,
    folder_name VARCHAR(500) NOT NULL,
    configured_by_account_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )
`;

// ============================================================
// V012 - AISLAMIENTO DEL HISTORIAL POR ESPACIO
// ============================================================

// Conservamos la clave primaria file_id actual.
// El sincronizador generará una clave de seguimiento
// mediante el espacio, usuario y archivo de Google.
//
// Las filas anteriores permanecerán sin espacio hasta
// que se decida si deben migrarse o mantenerse como legacy.

const ADD_SYNC_SPACE_ID = `
  ALTER TABLE drive_sync_files
  ADD COLUMN space_id VARCHAR(255) NULL
`;

// ============================================================
// REGISTRO DE MIGRACIONES
// ============================================================

const migrations = migrationRunner
  .enqueue(
    'v001_create_adr_candidates',
    CREATE_ADR_CANDIDATES
  )
  .enqueue(
    'v002_add_archived_at',
    ADD_ARCHIVED_AT
  )
  .enqueue(
    'v003_add_source_type',
    ADD_SOURCE_TYPE
  )
  .enqueue(
    'v004_add_source_reference',
    ADD_SOURCE_REFERENCE
  )
  .enqueue(
    'v005_make_source_file_nullable',
    MAKE_SOURCE_FILE_NULLABLE
  )
  .enqueue(
    'v006_make_source_hash_nullable',
    MAKE_SOURCE_HASH_NULLABLE
  )
  .enqueue(
    'v007_create_drive_sync_files',
    CREATE_DRIVE_SYNC_FILES
  )
  .enqueue(
    'v008_create_drive_user_config',
    CREATE_DRIVE_USER_CONFIG
  )
  .enqueue(
    'v009_add_source_file_id',
    ADD_SOURCE_FILE_ID
  )
  .enqueue(
    'v010_add_adr_space_id',
    ADD_ADR_SPACE_ID
  )
  .enqueue(
    'v011_create_drive_space_config',
    CREATE_DRIVE_SPACE_CONFIG
  )
  .enqueue(
    'v012_add_sync_space_id',
    ADD_SYNC_SPACE_ID
  );

// ============================================================
// EJECUCIÓN DE MIGRACIONES
// ============================================================

export const runMigration = async () => {
  console.log(
    '[Minerva ADR] Iniciando migraciones SQL'
  );

  try {
    const results = await migrations.run();

    console.log(
      '[Minerva ADR] Resultado:',
      results
    );

    const applied = await migrationRunner.list();

    console.log(
      '[Minerva ADR] Estado de migraciones:',
      applied
    );
  } catch (error) {
    console.error(
      '[Minerva ADR] Error de migración:',
      error
    );

    throw error;
  }
};

