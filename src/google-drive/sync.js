
import { sql } from '@forge/sql';
import { createHash, randomUUID } from 'node:crypto';

import { extractCandidates } from '../parser/extractor.js';

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
const MAX_FOLDERS_PER_RUN = 100;
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

// Identificador de seguimiento por usuario y archivo.
function getTrackingId(accountId, fileId) {
  return sha256(`${accountId}\0${fileId}`);
}

// Identificador estable de un candidato dentro
// de su archivo de Google Drive.
function getCandidateHash(fileId, candidateHash) {
  if (!candidateHash) {
    throw new Error(
      'El candidato no contiene un hash válido.'
    );
  }

  return sha256(`${fileId}\0${candidateHash}`);
}

// ============================================================
// CONFIGURACIÓN DE GOOGLE DRIVE
// ============================================================

async function getSavedFolder(accountId) {
  const result = await sql
    .prepare(`
      SELECT
        folder_id,
        folder_name
      FROM drive_user_config
      WHERE account_id = ?
      LIMIT 1
    `)
    .bindParams(accountId)
    .execute();

  if (result.rows.length === 0) {
    throw new Error(
      'Primero debes configurar una carpeta de Google Drive.'
    );
  }

  return result.rows[0];
}

// ============================================================
// HISTORIAL DE SINCRONIZACIÓN
// ============================================================

async function getFileState(trackingId) {
  const result = await sql
    .prepare(`
      SELECT
        modified_time,
        md5_checksum,
        content_hash,
        status
      FROM drive_sync_files
      WHERE file_id = ?
      LIMIT 1
    `)
    .bindParams(trackingId)
    .execute();

  return result.rows[0] || null;
}

function isUnchanged(previous, file) {
  if (!previous || previous.status !== 'processed') {
    return false;
  }

  if (previous.md5_checksum && file.md5Checksum) {
    return previous.md5_checksum === file.md5Checksum;
  }

  if (previous.modified_time && file.modifiedTime) {
    return previous.modified_time === file.modifiedTime;
  }

  return false;
}

async function saveFileState({
  trackingId,
  file,
  contentHash,
  status,
  error = null,
}) {
  await sql
    .prepare(`
      INSERT INTO drive_sync_files (
        file_id,
        file_name,
        modified_time,
        md5_checksum,
        content_hash,
        status,
        last_error,
        processed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE
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
      file.name,
      file.modifiedTime || null,
      file.md5Checksum || null,
      contentHash,
      status,
      error ? String(error).slice(0, 2000) : null
    )
    .execute();
}

// ============================================================
// CONSULTAR DUPLICADOS
// ============================================================

async function candidateExists(sourceHash) {
  const result = await sql
    .prepare(`
      SELECT id
      FROM adr_candidates
      WHERE source_hash = ?
      LIMIT 1
    `)
    .bindParams(sourceHash)
    .execute();

  return result.rows.length > 0;
}

// ============================================================
// INSERTAR CANDIDATOS ADR
// ============================================================

async function insertCandidate({
  candidate,
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
    fileId,
    candidate.source_hash
  );

  if (await candidateExists(sourceHash)) {
    return false;
  }

  await sql
    .prepare(`
      INSERT INTO adr_candidates (
        id,
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
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bindParams(
      randomUUID(),
      candidate.title.trim(),
      candidate.decision.trim(),
      candidate.context || null,
      candidate.job || null,
      candidate.status || 'Propuesto',
      'Pendiente de revisión',
      candidate.decision_owner || null,
      candidate.source_file,
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
// ACTUALIZAR RUTAS DE ORIGEN
// ============================================================

// Si una minuta se mueve a otra carpeta de Drive,
// actualizamos la ruta de sus ADR existentes.
// Se utiliza el ID del archivo, no su nombre.
async function updateSourcePath(fileId, sourcePath) {
  const normalizedPath = sourcePath.slice(0, 500);

  await sql
    .prepare(`
      UPDATE adr_candidates
      SET source_reference = ?
      WHERE source_file_id = ?
        AND source_type = 'markdown'
        AND (
          source_reference IS NULL
          OR source_reference <> ?
        )
    `)
    .bindParams(
      normalizedPath,
      fileId,
      normalizedPath
    )
    .execute();
}

// ============================================================
// PROCESAR ARCHIVO MARKDOWN
// ============================================================

async function processDriveFile({
  google,
  file,
  accountId,
  sourcePath,
}) {
  const trackingId = getTrackingId(
    accountId,
    file.id
  );

  let contentHash = null;

  try {
    // Descargar el Markdown.
    const content = await downloadDriveMarkdown(
      google,
      file
    );

    contentHash = sha256(content);

    // Ejecutar el extractor de decisiones.
    const extraction = extractCandidates(
      content,
      file.name
    );

    const candidates = extraction.candidates || [];

    let inserted = 0;
    let duplicates = 0;

    // Insertar solamente candidatos nuevos.
    for (const candidate of candidates) {
      const wasInserted = await insertCandidate({
        candidate,
        fileId: file.id,
        sourcePath,
      });

      if (wasInserted) {
        inserted++;
      } else {
        duplicates++;
      }
    }

    // Actualizar la ubicación de los ADR existentes.
    await updateSourcePath(
      file.id,
      sourcePath
    );

    // Registrar el procesamiento exitoso.
    await saveFileState({
      trackingId,
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
      file.name,
      error
    );

    try {
      await saveFileState({
        trackingId,
        file,
        contentHash,
        status: 'error',
        error: error?.message || 'Error desconocido',
      });
    } catch (stateError) {
      console.error(
        '[Minerva ADR] Error guardando estado:',
        stateError
      );
    }

    return {
      success: false,
      message: error?.message || 'Error desconocido',
    };
  }
}

// ============================================================
// SINCRONIZACIÓN PRINCIPAL
// ============================================================

export async function syncDriveMarkdown(
  context,
  options = {}
) {
  const accountId = getAccountId(context);

  const forceReprocess =
    options.reprocess === true;

  const savedFolder = await getSavedFolder(
    accountId
  );

  const google = await getAuthorizedDriveClient();

  // Verificar acceso a la carpeta configurada.
  const root = await getDriveFolder(
    google,
    savedFolder.folder_id
  );

  console.log(
    '[Minerva ADR] Iniciando sincronización',
    {
      folder: root.name,
      forceReprocess,
    }
  );

  const summary = {
    success: true,
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

  // Recorrido recursivo en anchura.
  // Se conserva la ruta de cada carpeta.
  const queue = [
    {
      id: root.id,
      path: root.name,
    },
  ];

  const visited = new Set();

  let attemptedFiles = 0;

  while (
    queue.length > 0 &&
    visited.size < MAX_FOLDERS_PER_RUN &&
    attemptedFiles < MAX_FILES_PER_RUN
  ) {
    const current = queue.shift();

    if (visited.has(current.id)) {
      continue;
    }

    visited.add(current.id);
    summary.foldersScanned++;

    // Consultar subcarpetas y archivos.
    const result = await listDriveChildren(
      google,
      current.id
    );

    if (result.truncated) {
      summary.truncated = true;
    }

    const folders = result.files.filter(
      (file) =>
        file.mimeType === GOOGLE_FOLDER_MIME
    );

    const markdownFiles = result.files.filter(
      isMarkdownFile
    );

    // Agregar subcarpetas a la cola.
    for (const folder of folders) {
      if (!visited.has(folder.id)) {
        queue.push({
          id: folder.id,
          path: `${current.path}/${folder.name}`,
        });
      }
    }

    // Procesar archivos Markdown.
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
        accountId,
        file.id
      );

      const previous = await getFileState(
        trackingId
      );

      // Sincronización normal:
      // omitir archivos sin cambios.
      if (
        !forceReprocess &&
        isUnchanged(previous, file)
      ) {
        // La ruta puede haber cambiado
        // aunque el contenido no cambie.
        await updateSourcePath(
          file.id,
          sourcePath
        );

        summary.filesUnchanged++;
        continue;
      }

      // Limitar archivos procesados por ejecución.
      if (attemptedFiles >= MAX_FILES_PER_RUN) {
        summary.truncated = true;
        break;
      }

      attemptedFiles++;

      // Validar tamaño del Markdown.
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

      // Extraer y registrar candidatos.
      const resultFile = await processDriveFile({
        google,
        file,
        accountId,
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
        summary.truncated = true;
        break;
      }
    }
  }

  if (
    queue.length > 0 ||
    visited.size >= MAX_FOLDERS_PER_RUN
  ) {
    summary.truncated = true;
  }

  console.log(
    '[Minerva ADR] Sincronización finalizada',
    JSON.stringify({
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
