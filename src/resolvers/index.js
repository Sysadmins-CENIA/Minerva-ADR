
import api, { route } from '@forge/api';
import { makeResolver } from '@forge/resolver';
import { sql } from '@forge/sql';
import { randomUUID } from 'node:crypto';

import { extractCandidates } from '../parser/extractor.js';
import { syncDriveMarkdown } from '../google-drive/sync.js';
import { assertId, assertIds } from './validation.js';

const GOOGLE_REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const GOOGLE_FOLDER_MIME =
  'application/vnd.google-apps.folder';

const DECISION_STATUSES = [
  'Propuesto',
  'En discusión',
  'Aprobada',
  'Rechazada',
  'Obsoleta',
];

const REVIEW_STATUSES = [
  'Pendiente de revisión',
  'Validado',
  'Descartado',
];

const ADR_COLUMNS = `
  id, title, decision, context, job, status,
  review_status, decision_owner, source_file,
  source_file_id, source_type, source_reference,
  meeting_date, evidence, created_at, updated_at,
  archived_at
`;

// ============================================================
// CONTEXTO Y SEGURIDAD
// ============================================================

function getAccountId(context) {
  const id = context?.accountId;

  if (typeof id !== 'string' || !id.trim()) {
    throw new Error(
      'No fue posible identificar al usuario de Atlassian.'
    );
  }

  return id;
}

function getSpaceId(context) {
  // Obtener el espacio exclusivamente del contexto
  // proporcionado por Forge, nunca desde payload.
  const id = context?.extension?.space?.id;

  if (
    (typeof id !== 'string' &&
      typeof id !== 'number') ||
    !String(id).trim()
  ) {
    throw new Error(
      'Abre Minerva ADR desde un espacio de Confluence.'
    );
  }

  const spaceId = String(id);

  if (!/^[0-9]+$/.test(spaceId)) {
    throw new Error(
      'Identificador de espacio no válido.'
    );
  }

  return spaceId;
}

async function authorizedSpace(context) {
  getAccountId(context);

  const spaceId = getSpaceId(context);

  // Confluence comprueba el acceso del usuario real.
  const response = await api
    .asUser()
    .requestConfluence(
      route`/wiki/api/v2/spaces/${spaceId}`,
      {
        headers: {
          Accept: 'application/json',
        },
      }
    );

  if (!response.ok) {
    throw new Error(
      'No tienes acceso al espacio de Confluence.'
    );
  }

  return spaceId;
}

function optionalText(value, maxLength = null) {
  if (value == null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new Error('El campo debe contener texto.');
  }

  const text = value.trim();

  if (maxLength && text.length > maxLength) {
    throw new Error(
      `El campo supera ${maxLength} caracteres.`
    );
  }

  return text || null;
}

function requiredText(value, maxLength = null) {
  const result = optionalText(value, maxLength);

  if (!result) {
    throw new Error('Falta un campo obligatorio.');
  }

  return result;
}

function optionalDate(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    throw new Error(
      'La fecha debe tener el formato YYYY-MM-DD.'
    );
  }

  return value;
}

// ============================================================
// GOOGLE OAUTH
// ============================================================

function driveClient() {
  return api
    .asUser()
    .withProvider('google', 'google-apis');
}

async function authorizedDriveClient() {
  const google = driveClient();

  const hasCredentials =
    await google.hasCredentials(
      GOOGLE_REQUIRED_SCOPES
    );

  if (!hasCredentials) {
    throw new Error(
      'Conecta Google Drive y autoriza el permiso de lectura.'
    );
  }

  return google;
}

async function googleAccount() {
  const google = driveClient();

  const connected = await google.hasCredentials(
    GOOGLE_REQUIRED_SCOPES
  );

  if (!connected) {
    return {
      success: true,
      connected: false,
      account: null,
    };
  }

  const account = await google.getAccount();

  return {
    success: true,
    connected: Boolean(account),
    account: account
      ? {
          id: account.id,
          displayName: account.displayName,
          scopes: account.scopes || [],
        }
      : null,
  };
}

// ============================================================
// GOOGLE DRIVE - API
// ============================================================

async function driveGet(
  google,
  path,
  parameters = {}
) {
  const query = new URLSearchParams(parameters);
  const suffix = query.toString();

  const response = await google.fetch(
    suffix ? `${path}?${suffix}` : path
  );

  if (!response.ok) {
    const body = (await response.text())
      .slice(0, 700);

    throw new Error(
      `Google Drive respondió ${response.status}: ${body}`
    );
  }

  return response.json();
}

async function driveList(
  google,
  query,
  fields,
  maxPages = 10
) {
  const files = [];
  let pageToken;
  let pages = 0;

  do {
    const data = await driveGet(
      google,
      '/drive/v3/files',
      {
        q: query,
        fields: `nextPageToken,files(${fields})`,
        pageSize: '100',
        spaces: 'drive',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        ...(pageToken ? { pageToken } : {}),
      }
    );

    files.push(...(data.files || []));
    pageToken = data.nextPageToken;
    pages++;
  } while (pageToken && pages < maxPages);

  return {
    files,
    truncated: Boolean(pageToken),
  };
}

function folderResult(file) {
  return {
    id: file.id,
    name: file.name,
    description: file.description || null,
  };
}

function validFolderId(value) {
  return typeof value === 'string' &&
    /^[a-zA-Z0-9_-]{5,255}$/.test(value);
}

// ============================================================
// ADR - CONSULTAS AUXILIARES
// ============================================================

async function candidateExists(
  id,
  spaceId,
  archiveCondition = ''
) {
  const result = await sql
    .prepare(`
      SELECT id
      FROM adr_candidates
      WHERE id = ?
        AND space_id = ?
        ${archiveCondition}
      LIMIT 1
    `)
    .bindParams(id, spaceId)
    .execute();

  if (result.rows.length === 0) {
    throw new Error(
      'La decisión no existe en este espacio.'
    );
  }
}

async function hashExists(hash, spaceId) {
  const result = await sql
    .prepare(`
      SELECT id
      FROM adr_candidates
      WHERE source_hash = ?
        AND space_id = ?
      LIMIT 1
    `)
    .bindParams(hash, spaceId)
    .execute();

  return result.rows.length > 0;
}

// ============================================================
// RESOLVERS
// ============================================================

export const handler = makeResolver({

  // ----------------------------------------------------------
  // GOOGLE OAUTH
  // ----------------------------------------------------------

  connectGoogle: async ({ context }) => {
    await authorizedSpace(context);

    const google = driveClient();

    const connected = await google.hasCredentials(
      GOOGLE_REQUIRED_SCOPES
    );

    if (!connected) {
      // No envolver en try/catch:
      // Forge necesita gestionar el flujo OAuth.
      await google.requestCredentials(
        GOOGLE_REQUIRED_SCOPES
      );

      return {
        success: false,
        connected: false,
        account: null,
      };
    }

    return googleAccount();
  },

  getGoogleAccount: async ({ context }) => {
    await authorizedSpace(context);
    return googleAccount();
  },

  // ----------------------------------------------------------
  // GOOGLE DRIVE - CARPETAS PREFERIDAS
  // ----------------------------------------------------------

  getPreferredDriveFolders: async ({ context }) => {
    await authorizedSpace(context);

    const google = await authorizedDriveClient();

    const root = await driveGet(
      google,
      '/drive/v3/files/root',
      {
        fields: 'id',
        supportsAllDrives: 'true',
      }
    );

    const { files, truncated } = await driveList(
      google,
      `trashed = false and mimeType = '${GOOGLE_FOLDER_MIME}' and name = 'Minerva'`,
      'id,name,parents,description',
      10
    );

    files.sort((a, b) => {
      const aRoot = (a.parents || [])
        .includes(root.id);

      const bRoot = (b.parents || [])
        .includes(root.id);

      return Number(bRoot) - Number(aRoot);
    });

    return {
      success: true,
      folders: files.map(folderResult),
      truncated,
    };
  },

  // ----------------------------------------------------------
  // GOOGLE DRIVE - BÚSQUEDA
  // ----------------------------------------------------------

  searchDriveFolders: async ({
    payload,
    context,
  }) => {
    await authorizedSpace(context);

    const term = String(
      payload?.query || ''
    ).trim();

    if (term.length < 2) {
      return {
        success: true,
        folders: [],
        truncated: false,
      };
    }

    if (term.length > 100) {
      throw new Error(
        'La búsqueda no puede superar 100 caracteres.'
      );
    }

    const escaped = term
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'");

    const google = await authorizedDriveClient();

    const { files, truncated } = await driveList(
      google,
      `trashed = false and mimeType = '${GOOGLE_FOLDER_MIME}' and name contains '${escaped}'`,
      'id,name,description',
      5
    );

    files.sort((a, b) => {
      const exactA =
        a.name.toLowerCase() === term.toLowerCase();

      const exactB =
        b.name.toLowerCase() === term.toLowerCase();

      return Number(exactB) - Number(exactA) ||
        a.name.localeCompare(b.name);
    });

    return {
      success: true,
      folders: files.map(folderResult),
      truncated,
    };
  },

  // ----------------------------------------------------------
  // GOOGLE DRIVE - PREVISUALIZAR CARPETA
  // ----------------------------------------------------------

  previewDriveFolder: async ({
    payload,
    context,
  }) => {
    await authorizedSpace(context);

    const folderId = payload?.folderId;

    if (!validFolderId(folderId)) {
      throw new Error(
        'Identificador de carpeta no válido.'
      );
    }

    const google = await authorizedDriveClient();

    const folder = await driveGet(
      google,
      `/drive/v3/files/${encodeURIComponent(folderId)}`,
      {
        fields: 'id,name,mimeType',
        supportsAllDrives: 'true',
      }
    );

    if (folder.mimeType !== GOOGLE_FOLDER_MIME) {
      throw new Error(
        'El elemento seleccionado no es una carpeta.'
      );
    }

    const queue = [{
      id: folder.id,
      path: folder.name,
    }];

    const visited = new Set();
    const markdownFiles = [];

    let truncated = false;

    while (
      queue.length > 0 &&
      visited.size < 250 &&
      markdownFiles.length < 1000
    ) {
      const current = queue.shift();

      if (visited.has(current.id)) {
        continue;
      }

      visited.add(current.id);

      const result = await driveList(
        google,
        `'${current.id}' in parents and trashed = false`,
        'id,name,mimeType,modifiedTime,md5Checksum,webViewLink',
        10
      );

      truncated = truncated || result.truncated;

      for (const file of result.files) {
        if (file.mimeType === GOOGLE_FOLDER_MIME) {
          if (!visited.has(file.id)) {
            queue.push({
              id: file.id,
              path: `${current.path}/${file.name}`,
            });
          }
        } else if (
          file.name.toLowerCase().endsWith('.md')
        ) {
          markdownFiles.push({
            id: file.id,
            name: file.name,
            path: `${current.path}/${file.name}`,
            modifiedTime: file.modifiedTime || null,
          });
        }
      }
    }

    if (
      queue.length > 0 ||
      markdownFiles.length >= 1000
    ) {
      truncated = true;
    }

    return {
      success: true,
      folder: {
        id: folder.id,
        name: folder.name,
      },
      foldersScanned: visited.size,
      totalMarkdown: markdownFiles.length,
      files: markdownFiles.slice(0, 30),
      truncated,
    };
  },

  // ----------------------------------------------------------
  // GOOGLE DRIVE - CONFIGURACIÓN POR ESPACIO
  // ----------------------------------------------------------

  getDriveFolderConfig: async ({ context }) => {
    const spaceId = await authorizedSpace(context);

    const result = await sql
      .prepare(`
        SELECT folder_id, folder_name
        FROM drive_space_config
        WHERE space_id = ?
        LIMIT 1
      `)
      .bindParams(spaceId)
      .execute();

    if (result.rows.length === 0) {
      return {
        success: true,
        configured: false,
        folder: null,
      };
    }

    const config = result.rows[0];

    return {
      success: true,
      configured: true,
      folder: {
        id: config.folder_id,
        name: config.folder_name,
      },
    };
  },

  saveDriveFolderConfig: async ({
    payload,
    context,
  }) => {
    const spaceId = await authorizedSpace(context);
    const accountId = getAccountId(context);

    const folderId = payload?.folderId;

    if (!validFolderId(folderId)) {
      throw new Error(
        'El identificador de la carpeta no es válido.'
      );
    }

    const google = await authorizedDriveClient();

    const folder = await driveGet(
      google,
      `/drive/v3/files/${encodeURIComponent(folderId)}`,
      {
        fields: 'id,name,mimeType,trashed',
        supportsAllDrives: 'true',
      }
    );

    if (
      folder.mimeType !== GOOGLE_FOLDER_MIME ||
      folder.trashed === true
    ) {
      throw new Error(
        'La carpeta seleccionada no es válida.'
      );
    }

    const name = requiredText(folder.name, 500);

    await sql
      .prepare(`
        INSERT INTO drive_space_config (
          space_id,
          folder_id,
          folder_name,
          configured_by_account_id
        )
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          folder_id = VALUES(folder_id),
          folder_name = VALUES(folder_name),
          configured_by_account_id =
            VALUES(configured_by_account_id),
          updated_at = CURRENT_TIMESTAMP
      `)
      .bindParams(
        spaceId,
        folder.id,
        name,
        accountId
      )
      .execute();

    return {
      success: true,
      configured: true,
      folder: {
        id: folder.id,
        name,
      },
      message: 'Carpeta guardada correctamente.',
    };
  },

  // ----------------------------------------------------------
  // GOOGLE DRIVE - SINCRONIZACIÓN
  // ----------------------------------------------------------

syncDriveMarkdown: async ({ context, payload }) => {
  const spaceId = await authorizedSpace(context);

  return syncDriveMarkdown(context, {
    spaceId,
    reprocess: payload?.reprocess === true,
  });
},

  // ----------------------------------------------------------
  // ADR - CANDIDATOS ACTIVOS
  // ----------------------------------------------------------

  getCandidates: async ({ context }) => {
    const spaceId = await authorizedSpace(context);

    const result = await sql
      .prepare(`
        SELECT ${ADR_COLUMNS}
        FROM adr_candidates
        WHERE space_id = ?
          AND archived_at IS NULL
        ORDER BY created_at DESC
      `)
      .bindParams(spaceId)
      .execute();

    return {
      success: true,
      candidates: result.rows,
    };
  },

  // ----------------------------------------------------------
  // ADR - CANDIDATOS ARCHIVADOS
  // ----------------------------------------------------------

  getArchivedCandidates: async ({ context }) => {
    const spaceId = await authorizedSpace(context);

    const result = await sql
      .prepare(`
        SELECT ${ADR_COLUMNS}
        FROM adr_candidates
        WHERE space_id = ?
          AND archived_at IS NOT NULL
        ORDER BY archived_at DESC
      `)
      .bindParams(spaceId)
      .execute();

    return {
      success: true,
      candidates: result.rows,
    };
  },

  // ----------------------------------------------------------
  // ADR - CREAR MANUALMENTE
  // ----------------------------------------------------------

  createManualCandidate: async ({
    payload,
    context,
  }) => {
    const spaceId = await authorizedSpace(context);

    const title = requiredText(
      payload?.title,
      255
    );

    const decision = requiredText(
      payload?.decision
    );

    const job = optionalText(
      payload?.job,
      50
    );

    const owner = optionalText(
      payload?.decision_owner,
      255
    );

    const contextText = optionalText(
      payload?.context
    );

    const sourceReference = optionalText(
      payload?.source_reference,
      500
    );

    const meetingDate = optionalDate(
      payload?.meeting_date
    );

    const id = randomUUID();

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
          source_type,
          source_reference,
          source_file,
          meeting_date,
          source_hash,
          evidence
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `)
      .bindParams(
        id,
        spaceId,
        title,
        decision,
        contextText,
        job,
        'Propuesto',
        'Pendiente de revisión',
        owner,
        'manual',
        sourceReference,
        null,
        meetingDate,
        null,
        null
      )
      .execute();

    return {
      success: true,
      id,
      message:
        'Candidato manual creado y enviado a revisión.',
    };
  },

  // ----------------------------------------------------------
  // ADR - IMPORTAR MARKDOWN MANUALMENTE
  // ----------------------------------------------------------

  processMarkdown: async ({
    payload,
    context,
  }) => {
    const spaceId = await authorizedSpace(context);

    const { data, sourceFile } = payload || {};

    if (
      typeof data !== 'string' ||
      !data.trim() ||
      typeof sourceFile !== 'string' ||
      !sourceFile.trim()
    ) {
      throw new Error(
        'Debes proporcionar el archivo Markdown y su nombre.'
      );
    }

    if (
      Buffer.byteLength(data, 'utf8') >
      2 * 1024 * 1024
    ) {
      throw new Error(
        'El Markdown supera el tamaño permitido.'
      );
    }

    const content = Buffer
      .from(data, 'base64')
      .toString('utf8');

    if (!content.trim()) {
      throw new Error(
        'El archivo está vacío.'
      );
    }

    const extraction = extractCandidates(
      content,
      sourceFile
    );

    let inserted = 0;
    let duplicates = 0;

    for (const candidate of extraction.candidates) {
      if (
        await hashExists(
          candidate.source_hash,
          spaceId
        )
      ) {
        duplicates++;
        continue;
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
            source_type,
            meeting_date,
            source_hash,
            evidence
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bindParams(
          candidate.id,
          spaceId,
          candidate.title,
          candidate.decision,
          candidate.context || null,
          candidate.job || null,
          candidate.status || 'Propuesto',
          'Pendiente de revisión',
          candidate.decision_owner || null,
          candidate.source_file,
          'markdown',
          candidate.meeting_date || null,
          candidate.source_hash,
          JSON.stringify(candidate.evidence || [])
        )
        .execute();

      inserted++;
    }

    return {
      success: true,
      meeting_title: extraction.meeting_title,
      meeting_date: extraction.meeting_date,
      source_file: extraction.source_file,
      total_candidates: extraction.candidates.length,
      inserted,
      duplicates,
      warnings: extraction.warnings,
    };
  },

  // ----------------------------------------------------------
  // ADR - VALIDAR / DESCARTAR
  // ----------------------------------------------------------

  updateReviewStatus: async ({
    payload,
    context,
  }) => {
    const spaceId = await authorizedSpace(context);

    const id = assertId(payload?.id);
    const reviewStatus = payload?.reviewStatus;

    if (
      !['Validado', 'Descartado'].includes(
        reviewStatus
      )
    ) {
      throw new Error(
        'Estado de revisión no válido.'
      );
    }

    await candidateExists(id, spaceId);

    await sql
      .prepare(`
        UPDATE adr_candidates
        SET
          review_status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND space_id = ?
      `)
      .bindParams(
        reviewStatus,
        id,
        spaceId
      )
      .execute();

    return {
      success: true,
      id,
      review_status: reviewStatus,
    };
  },

  // ----------------------------------------------------------
  // ADR - EDITAR
  // ----------------------------------------------------------

  updateCandidate: async ({
    payload,
    context,
  }) => {
    const spaceId = await authorizedSpace(context);

    const id = assertId(payload?.id);

    const title = requiredText(
      payload?.title,
      255
    );

    const decision = requiredText(
      payload?.decision
    );

    const contextText = optionalText(
      payload?.context
    );

    const job = optionalText(
      payload?.job,
      50
    );

    const owner = optionalText(
      payload?.decision_owner,
      255
    );

    const status = payload?.status;
    const reviewStatus = payload?.review_status;

    if (
      !DECISION_STATUSES.includes(status) ||
      !REVIEW_STATUSES.includes(reviewStatus)
    ) {
      throw new Error(
        'Los estados de la decisión no son válidos.'
      );
    }

    await candidateExists(
      id,
      spaceId,
      'AND archived_at IS NULL'
    );

    await sql
      .prepare(`
        UPDATE adr_candidates
        SET
          title = ?,
          decision = ?,
          context = ?,
          job = ?,
          decision_owner = ?,
          status = ?,
          review_status = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND space_id = ?
          AND archived_at IS NULL
      `)
      .bindParams(
        title,
        decision,
        contextText,
        job,
        owner,
        status,
        reviewStatus,
        id,
        spaceId
      )
      .execute();

    return {
      success: true,
      id,
      message:
        'Decisión actualizada correctamente.',
    };
  },

  // ----------------------------------------------------------
  // ADR - ARCHIVAR
  // ----------------------------------------------------------

  archiveCandidate: async ({
    payload,
    context,
  }) => {
    const spaceId = await authorizedSpace(context);
    const id = assertId(payload?.id);

    await candidateExists(
      id,
      spaceId,
      'AND archived_at IS NULL'
    );

    await sql
      .prepare(`
        UPDATE adr_candidates
        SET
          archived_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND space_id = ?
          AND archived_at IS NULL
      `)
      .bindParams(id, spaceId)
      .execute();

    return {
      success: true,
      id,
      message: 'Candidato archivado correctamente.',
    };
  },

  // ----------------------------------------------------------
  // ADR - RESTAURAR
  // ----------------------------------------------------------

  restoreCandidate: async ({
    payload,
    context,
  }) => {
    const spaceId = await authorizedSpace(context);
    const id = assertId(payload?.id);

    await candidateExists(
      id,
      spaceId,
      'AND archived_at IS NOT NULL'
    );

    await sql
      .prepare(`
        UPDATE adr_candidates
        SET
          archived_at = NULL,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
          AND space_id = ?
          AND archived_at IS NOT NULL
      `)
      .bindParams(id, spaceId)
      .execute();

    return {
      success: true,
      id,
      message: 'Candidato restaurado correctamente.',
    };
  },

  // ----------------------------------------------------------
  // ADR - ELIMINAR DEFINITIVAMENTE
  // ----------------------------------------------------------

  deleteCandidate: async ({
    payload,
    context,
  }) => {
    const spaceId = await authorizedSpace(context);
    const id = assertId(payload?.id);

    await candidateExists(id, spaceId);

    await sql
      .prepare(`
        DELETE FROM adr_candidates
        WHERE id = ?
          AND space_id = ?
      `)
      .bindParams(id, spaceId)
      .execute();

    return {
      success: true,
      id,
      message:
        'Candidato eliminado definitivamente.',
    };
  },

  // ----------------------------------------------------------
  // ADR - ACCIONES MASIVAS
  // Una sola sentencia por operación; el filtro por space_id
  // garantiza que ids de otro espacio simplemente no se tocan.
  // ----------------------------------------------------------

  archiveCandidates: async ({ payload, context }) => {
    const spaceId = await authorizedSpace(context);
    const ids = assertIds(payload?.ids);
    const marks = ids.map(() => '?').join(', ');

    const result = await sql
      .prepare(`
        UPDATE adr_candidates
        SET
          archived_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE space_id = ?
          AND archived_at IS NULL
          AND id IN (${marks})
      `)
      .bindParams(spaceId, ...ids)
      .execute();

    return {
      success: true,
      count: result.rows?.affectedRows ?? ids.length,
    };
  },

  deleteCandidates: async ({ payload, context }) => {
    const spaceId = await authorizedSpace(context);
    const ids = assertIds(payload?.ids);
    const marks = ids.map(() => '?').join(', ');

    const result = await sql
      .prepare(`
        DELETE FROM adr_candidates
        WHERE space_id = ?
          AND id IN (${marks})
      `)
      .bindParams(spaceId, ...ids)
      .execute();

    return {
      success: true,
      count: result.rows?.affectedRows ?? ids.length,
    };
  },
});
