
import { sql } from '@forge/sql';
import { createHash, randomUUID } from 'node:crypto';

import { extractCandidates } from '../parser/extractor.js';
import { dateFromPath } from '../shared/dates.js';
import {
  parseScanState,
  scanTree,
  serializeScanState,
} from './scan-plan.js';

import {
  GOOGLE_FOLDER_MIME,
  MAX_MARKDOWN_SIZE,
  getAuthorizedDriveClient,
  getDriveFolder,
  listDriveChildren,
  isMarkdownFile,
  downloadDriveMarkdown,
} from './drive-client.js';

// ============================================================
// CONFIGURACIÓN
// ============================================================

const MAX_FILES_PER_RUN = 5;
// Las funciones invocadas desde la UI tienen ~25 s; se deja margen para
// guardar el estado del recorrido y responder.
const SYNC_TIME_BUDGET_MS = 18000;
const MAX_ERRORS_RETURNED = 20;

// ============================================================
// UTILIDADES
// ============================================================

function sha256(value) {
  return createHash('sha256')
    .update(value)
    .digest('hex');
}

function getAccountId(context) {
  const accountId = context?.accountId;

  if (
    typeof accountId !== 'string' ||
    !accountId.trim()
  ) {
    throw new Error(
      'No se pudo identificar al usuario de Atlassian.'
    );
  }

  return accountId;
}

function getSpaceId(options) {
  const spaceId = options?.spaceId;

  if (
    (typeof spaceId !== 'string' &&
      typeof spaceId !== 'number') ||
    !/^[0-9]+$/.test(String(spaceId))
  ) {
    throw new Error(
      'No se recibió un espacio de Confluence válido.'
    );
  }

  return String(spaceId);
}

// Identificador de seguimiento específico
// para espacio, usuario y archivo.
function getTrackingId(spaceId, accountId, fileId) {
  return sha256(
    `${spaceId}\0${accountId}\0${fileId}`
  );
}

// Hash del candidato específico para su espacio
// y archivo de Google Drive.
function getCandidateHash(
  spaceId,
  fileId,
  candidateHash
) {
  if (!candidateHash) {
    throw new Error(
      'El candidato no contiene un hash válido.'
    );
  }

  return sha256(
    `${spaceId}\0${fileId}\0${candidateHash}`
  );
}

// ============================================================
// CONFIGURACIÓN DRIVE POR ESPACIO
// ============================================================

async function getSavedFolder(spaceId) {
  const result = await sql
    .prepare(`
      SELECT
        folder_id,
        folder_name,
        configured_by_account_id,
        scan_state
      FROM drive_space_config
      WHERE space_id = ?
      LIMIT 1
    `)
    .bindParams(spaceId)
    .execute();

  if (result.rows.length === 0) {
    throw new Error(
      'Primero debes configurar una carpeta de Google Drive para este espacio.'
    );
  }

  return result.rows[0];
}

async function saveScanState(spaceId, visited) {
  await sql
    .prepare(`
      UPDATE drive_space_config
      SET scan_state = ?
      WHERE space_id = ?
    `)
    .bindParams(serializeScanState(visited), spaceId)
    .execute();
}

// ============================================================
// HISTORIAL DE SINCRONIZACIÓN
// ============================================================

async function getFileState(trackingId, spaceId) {
  const result = await sql
    .prepare(`
      SELECT
        modified_time,
        md5_checksum,
        content_hash,
        status
      FROM drive_sync_files
      WHERE file_id = ?
        AND space_id = ?
      LIMIT 1
    `)
    .bindParams(trackingId, spaceId)
    .execute();

  return result.rows[0] || null;
}

function isUnchanged(previous, file) {
  if (
    !previous ||
    previous.status !== 'processed'
  ) {
    return false;
  }

  if (
    previous.md5_checksum &&
    file.md5Checksum
  ) {
    return (
      previous.md5_checksum === file.md5Checksum
    );
  }

  if (
    previous.modified_time &&
    file.modifiedTime
  ) {
    return (
      previous.modified_time === file.modifiedTime
    );
  }

  return false;
}

async function saveFileState({
  trackingId,
  spaceId,
  file,
  contentHash,
  status,
  error = null,
}) {
  await sql
    .prepare(`
      INSERT INTO drive_sync_files (
        file_id,
        space_id,
        file_name,
        modified_time,
        md5_checksum,
        content_hash,
        status,
        last_error,
        processed_at
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        CURRENT_TIMESTAMP
      )
      ON DUPLICATE KEY UPDATE
        space_id = VALUES(space_id),
        file_name = VALUES(file_name),
        modified_time = VALUES(modified_time),
        md5_checksum = VALUES(md5_checksum),
        content_hash = VALUES(content_hash),
        status = VALUES(status),
        last_error = VALUES(last_error),
        processed_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bindParams(
      trackingId,
      spaceId,
      file.name,
      file.modifiedTime || null,
      file.md5Checksum || null,
      contentHash,
      status,
      error
        ? String(error).slice(0, 2000)
        : null
    )
    .execute();
}

// ============================================================
// DUPLICADOS POR ESPACIO
// ============================================================

async function candidateExists(
  sourceHash,
  spaceId
) {
  const result = await sql
    .prepare(`
      SELECT id
      FROM adr_candidates
      WHERE source_hash = ?
        AND space_id = ?
      LIMIT 1
    `)
    .bindParams(sourceHash, spaceId)
    .execute();

  return result.rows.length > 0;
}

// ============================================================
// INSERTAR CANDIDATOS ADR
// ============================================================

async function insertCandidate({
  candidate,
  spaceId,
  fileId,
  sourcePath,
}) {
  if (
    typeof candidate.title !== 'string' ||
    !candidate.title.trim() ||
    typeof candidate.decision !== 'string' ||
    !candidate.decision.trim()
  ) {
    throw new Error(
      'El parser devolvió un candidato sin título o decisión.'
    );
  }

  const sourceHash = getCandidateHash(
    spaceId,
    fileId,
    candidate.source_hash
  );

  if (
    await candidateExists(
      sourceHash,
      spaceId
    )
  ) {
    return false;
  }

  await sql
    .prepare(`
      INSERT INTO adr_candidates (
        id,
        space_id,
        title,
        decision,
        context,
        job,
        status,
        review_status,
        decision_owner,
        source_file,
        source_file_id,
        source_type,
        source_reference,
        meeting_date,
        source_hash,
        evidence
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?
      )
    `)
    .bindParams(
      randomUUID(),
      spaceId,
      candidate.title.trim(),
      candidate.decision.trim(),
      candidate.context || null,
      candidate.job || null,
      candidate.status || 'Propuesto',
      'Pendiente de revisión',
      candidate.decision_owner || null,
      candidate.source_file || null,
      fileId,
      'markdown',
      sourcePath.slice(0, 500),
      candidate.meeting_date || null,
      sourceHash,
      JSON.stringify(candidate.evidence || [])
    )
    .execute();

  return true;
}

// ============================================================
// ACTUALIZAR RUTAS POR ESPACIO
// ============================================================

async function updateSourcePath(
  spaceId,
  fileId,
  sourcePath
) {
  const normalizedPath =
    sourcePath.slice(0, 500);

  await sql
    .prepare(`
      UPDATE adr_candidates
      SET source_reference = ?
      WHERE space_id = ?
        AND source_file_id = ?
        AND source_type = 'markdown'
        AND (
          source_reference IS NULL
          OR source_reference <> ?
        )
    `)
    .bindParams(
      normalizedPath,
      spaceId,
      fileId,
      normalizedPath
    )
    .execute();
}

// ============================================================
// PROCESAR MARKDOWN
// ============================================================

async function processDriveFile({
  google,
  file,
  accountId,
  spaceId,
  sourcePath,
}) {
  const trackingId = getTrackingId(
    spaceId,
    accountId,
    file.id
  );

  let contentHash = null;

  try {
    const content = await downloadDriveMarkdown(
      google,
      file
    );

    contentHash = sha256(content);

    const extraction = extractCandidates(
      content,
      file.name
    );

    const candidates =
      extraction.candidates || [];

    // El parser sólo ve el nombre del archivo (forma parte del hash anti-duplicados);
    // la fecha suele estar en la carpeta de la reunión, así que se completa aquí.
    const pathDate = dateFromPath(sourcePath);
    for (const candidate of candidates) {
      candidate.meeting_date = candidate.meeting_date || pathDate;
    }

    let inserted = 0;
    let duplicates = 0;

    for (const candidate of candidates) {
      const wasInserted = await insertCandidate({
        candidate,
        spaceId,
        fileId: file.id,
        sourcePath,
      });

      if (wasInserted) {
        inserted++;
      } else {
        duplicates++;
      }
    }

    await updateSourcePath(
      spaceId,
      file.id,
      sourcePath
    );

    await saveFileState({
      trackingId,
      spaceId,
      file,
      contentHash,
      status: 'processed',
    });

    return {
      success: true,
      candidatesFound: candidates.length,
      inserted,
      duplicates,
    };
  } catch (error) {
    console.error(
      '[Minerva ADR] Error procesando archivo:',
      {
        spaceId,
        fileName: file.name,
        message: error?.message,
      }
    );

    try {
      await saveFileState({
        trackingId,
        spaceId,
        file,
        contentHash,
        status: 'error',
        error:
          error?.message || 'Error desconocido',
      });
    } catch (stateError) {
      console.error(
        '[Minerva ADR] Error guardando estado:',
        stateError
      );
    }

    return {
      success: false,
      message:
        error?.message || 'Error desconocido',
    };
  }
}

// ============================================================
// SINCRONIZACIÓN PRINCIPAL POR ESPACIO
// ============================================================

export async function syncDriveMarkdown(
  context,
  options = {}
) {
  const accountId = getAccountId(context);
  const spaceId = getSpaceId(options);

  const forceReprocess =
    options.reprocess === true;

  const savedFolder = await getSavedFolder(
    spaceId
  );

  // Google OAuth sigue asociado al usuario
  // que ejecuta la sincronización manual.
  const google = await getAuthorizedDriveClient();

  const root = await getDriveFolder(
    google,
    savedFolder.folder_id
  );

  console.log(
    '[Minerva ADR] Iniciando sincronización',
    {
      spaceId,
      folder: root.name,
      forceReprocess,
    }
  );

  const summary = {
    success: true,
    spaceId,
    folder: root.name,
    reprocessed: forceReprocess,
    foldersScanned: 0,
    filesFound: 0,
    filesProcessed: 0,
    filesUnchanged: 0,
    candidatesFound: 0,
    inserted: 0,
    duplicates: 0,
    errors: [],
    truncated: false,
  };

  // Recorrido por etapas: retoma donde quedó la sincronización anterior y
  // revisa primero las reuniones más nuevas (ver scan-plan.js).
  const deadline = Date.now() + SYNC_TIME_BUDGET_MS;
  let attemptedFiles = 0;

  const scan = await scanTree({
    root: { id: root.id, name: root.name, path: root.name },
    visited: parseScanState(savedFolder.scan_state),
    shouldStop: () =>
      Date.now() > deadline ||
      attemptedFiles >= MAX_FILES_PER_RUN,
    listChildren: async (folder) => {
      const result = await listDriveChildren(
        google,
        folder.id
      );

      return {
        folders: result.files.filter(
          (file) =>
            file.mimeType === GOOGLE_FOLDER_MIME
        ),
        files: result.files.filter(isMarkdownFile),
        truncated: result.truncated,
      };
    },
    handleFolder: async (current, markdownFiles) => {
      for (
        let index = 0;
        index < markdownFiles.length;
        index++
      ) {
        const file = markdownFiles[index];

        const sourcePath =
          `${current.path}/${file.name}`;

        summary.filesFound++;

        const trackingId = getTrackingId(
          spaceId,
          accountId,
          file.id
        );

        const previous = await getFileState(
          trackingId,
          spaceId
        );

        if (
          !forceReprocess &&
          isUnchanged(previous, file)
        ) {
          await updateSourcePath(
            spaceId,
            file.id,
            sourcePath
          );

          summary.filesUnchanged++;
          continue;
        }

        if (
          attemptedFiles >= MAX_FILES_PER_RUN
        ) {
          return true;
        }

        attemptedFiles++;

        if (
          file.size != null &&
          Number(file.size) > MAX_MARKDOWN_SIZE
        ) {
          const message =
            'El archivo supera el límite de tamaño permitido.';

          if (
            summary.errors.length <
            MAX_ERRORS_RETURNED
          ) {
            summary.errors.push({
              file: file.name,
              message,
            });
          }

          try {
            await saveFileState({
              trackingId,
              spaceId,
              file,
              contentHash: null,
              status: 'error',
              error: message,
            });
          } catch (error) {
            console.error(
              '[Minerva ADR] Error registrando archivo:',
              error
            );
          }

          continue;
        }

        const resultFile = await processDriveFile({
          google,
          file,
          accountId,
          spaceId,
          sourcePath,
        });

        if (resultFile.success) {
          summary.filesProcessed++;

          summary.candidatesFound +=
            resultFile.candidatesFound;

          summary.inserted +=
            resultFile.inserted;

          summary.duplicates +=
            resultFile.duplicates;
        } else if (
          summary.errors.length <
          MAX_ERRORS_RETURNED
        ) {
          summary.errors.push({
            file: file.name,
            message: resultFile.message,
          });
        }

        if (
          attemptedFiles >= MAX_FILES_PER_RUN &&
          index < markdownFiles.length - 1
        ) {
          return true;
        }
      }

      return false;
    },
  });

  summary.foldersScanned = scan.foldersScanned;
  summary.pendingFolders = scan.pending;
  summary.truncated = !scan.complete;

  await saveScanState(spaceId, scan.visited);

  console.log(
    '[Minerva ADR] Sincronización finalizada',
    JSON.stringify({
      spaceId,
      folders: summary.foldersScanned,
      processed: summary.filesProcessed,
      unchanged: summary.filesUnchanged,
      inserted: summary.inserted,
      duplicates: summary.duplicates,
      errors: summary.errors.length,
    })
  );

  return summary;
}
