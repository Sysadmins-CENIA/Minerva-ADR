import { migrationRunner } from '@forge/sql';

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

const migrations = migrationRunner
  .enqueue('v001_create_adr_candidates', CREATE_ADR_CANDIDATES)
  .enqueue('v002_add_archived_at', ADD_ARCHIVED_AT)
  .enqueue('v003_add_source_type', ADD_SOURCE_TYPE)
  .enqueue('v004_add_source_reference', ADD_SOURCE_REFERENCE)
  .enqueue('v005_make_source_file_nullable', MAKE_SOURCE_FILE_NULLABLE)
  .enqueue('v006_make_source_hash_nullable', MAKE_SOURCE_HASH_NULLABLE);

export const runMigration = async () => {
  console.log('[Minerva ADR] Iniciando migraciones SQL');

  try {
    const results = await migrations.run();

    console.log('[Minerva ADR] Resultado:', results);

    const applied = await migrationRunner.list();

    console.log('[Minerva ADR] Estado de migraciones:', applied);
  } catch (error) {
    console.error('[Minerva ADR] Error de migración:', error);
    throw error;
  }
};