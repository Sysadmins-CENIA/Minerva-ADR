
import api from '@forge/api';
import { makeResolver } from '@forge/resolver';
import { sql } from '@forge/sql';
import { extractCandidates } from '../parser/extractor.js';
import { randomUUID } from 'node:crypto';
import { syncDriveMarkdown } from '../google-drive/sync.js';

const GOOGLE_REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';

// ============================================================
// GOOGLE DRIVE - FUNCIONES AUXILIARES
// ============================================================

function driveClient() {
  return api.asUser().withProvider('google', 'google-apis');
}

async function authorizedDriveClient() {
  const google = driveClient();

  const hasCredentials = await google.hasCredentials(
    GOOGLE_REQUIRED_SCOPES
  );

  if (!hasCredentials) {
    throw new Error(
      'Conecta Google Drive y autoriza el permiso de lectura.'
    );
  }

  return google;
}

async function driveGet(google, path, parameters = {}) {
  const query = new URLSearchParams(parameters);

  const response = await google.fetch(
    `${path}?${query.toString()}`
  );

  if (!response.ok) {
    const body = (await response.text()).slice(0, 700);

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
    pages += 1;
  } while (pageToken && pages < maxPages);

  return {
    files,
    truncated: Boolean(pageToken),
  };
}

function driveFolderResult(file) {
  return {
    id: file.id,
    name: file.name,
    description: file.description || null,
  };
}

function getAtlassianAccountId(context) {
  const accountId = context?.accountId;

  if (
    typeof accountId !== 'string' ||
    !accountId.trim()
  ) {
    throw new Error(
      'No fue posible identificar al usuario de Atlassian.'
    );
  }

  return accountId;
}

// ============================================================
// RESOLVERS
// ============================================================

export const handler = makeResolver({

  // ==========================================================
  // GOOGLE OAUTH
  // ==========================================================

  connectGoogle: async () => {
    const google = api
      .asUser()
      .withProvider('google', 'google-apis');

    const hasCredentials = await google.hasCredentials(
      GOOGLE_REQUIRED_SCOPES
    );

    if (!hasCredentials) {
      // Forge interrumpe el resolver para solicitar OAuth.
      // No envolver requestCredentials en un catch.
      await google.requestCredentials(
        GOOGLE_REQUIRED_SCOPES
      );

      return {
        success: false,
        connected: false,
        account: null,
      };
    }

    try {
      const account = await google.getAccount();

      if (!account) {
        return {
          success: true,
          connected: false,
          account: null,
        };
      }

      return {
        success: true,
        connected: true,
        account: {
          id: account.id,
          displayName: account.displayName,
          scopes: account.scopes || [],
        },
      };
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al obtener cuenta Google:',
        error
      );

      throw new Error(
        `Error al obtener cuenta Google: ${
          error?.message || 'Error desconocido'
        }`
      );
    }
  },

  getGoogleAccount: async () => {
    const google = api
      .asUser()
      .withProvider('google', 'google-apis');

    try {
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

      if (!account) {
        return {
          success: true,
          connected: false,
          account: null,
        };
      }

      return {
        success: true,
        connected: true,
        account: {
          id: account.id,
          displayName: account.displayName,
          scopes: account.scopes || [],
        },
      };
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al consultar Google:',
        error
      );

      throw new Error(
        `No fue posible consultar la cuenta de Google: ${
          error?.message || 'Error desconocido'
        }`
      );
    }
  },

  // ==========================================================
  // GOOGLE DRIVE - CARPETA MINERVA
  // ==========================================================

  getPreferredDriveFolders: async () => {
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
      const aInRoot = (a.parents || []).includes(root.id);
      const bInRoot = (b.parents || []).includes(root.id);

      return Number(bInRoot) - Number(aInRoot);
    });

    return {
      success: true,
      folders: files.map(driveFolderResult),
      truncated,
    };
  },

  // ==========================================================
  // GOOGLE DRIVE - BUSCADOR DE CARPETAS
  // ==========================================================

  searchDriveFolders: async ({ payload }) => {
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

      return (
        Number(exactB) - Number(exactA) ||
        a.name.localeCompare(b.name)
      );
    });

    return {
      success: true,
      folders: files.map(driveFolderResult),
      truncated,
    };
  },

  // ==========================================================
  // GOOGLE DRIVE - EXPLORACIÓN RECURSIVA
  // ==========================================================

  previewDriveFolder: async ({ payload }) => {
    const folderId = String(
      payload?.folderId || ''
    ).trim();

    if (!/^[a-zA-Z0-9_-]{5,255}$/.test(folderId)) {
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

    const queue = [
      {
        id: folder.id,
        path: folder.name,
      },
    ];

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

  // ==========================================================
  // GOOGLE DRIVE - RECUPERAR CARPETA CONFIGURADA
  // ==========================================================

  getDriveFolderConfig: async ({ context }) => {
    const accountId = getAtlassianAccountId(context);

    try {
      const result = await sql
        .prepare(`
          SELECT
            folder_id,
            folder_name,
            created_at,
            updated_at
          FROM drive_user_config
          WHERE account_id = ?
          LIMIT 1
        `)
        .bindParams(accountId)
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
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al recuperar carpeta:',
        error
      );

      throw new Error(
        'No fue posible recuperar la carpeta configurada.'
      );
    }
  },

  // ==========================================================
  // GOOGLE DRIVE - GUARDAR CARPETA POR USUARIO
  // ==========================================================

  saveDriveFolderConfig: async ({ payload, context }) => {
    const accountId = getAtlassianAccountId(context);
    const folderId = payload?.folderId;

    if (
      typeof folderId !== 'string' ||
      !/^[a-zA-Z0-9_-]{5,255}$/.test(folderId)
    ) {
      throw new Error(
        'El identificador de la carpeta no es válido.'
      );
    }

    try {
      const google = await authorizedDriveClient();

      // Verificar la carpeta directamente en Google Drive.
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
          'La carpeta seleccionada no existe o no es válida.'
        );
      }

      if (
        typeof folder.name !== 'string' ||
        !folder.name.trim() ||
        folder.name.length > 500
      ) {
        throw new Error(
          'El nombre de la carpeta no es válido.'
        );
      }

      await sql
        .prepare(`
          INSERT INTO drive_user_config (
            account_id,
            folder_id,
            folder_name
          )
          VALUES (?, ?, ?)
          ON DUPLICATE KEY UPDATE
            folder_id = VALUES(folder_id),
            folder_name = VALUES(folder_name),
            updated_at = CURRENT_TIMESTAMP
        `)
        .bindParams(
          accountId,
          folder.id,
          folder.name
        )
        .execute();

      console.log(
        '[Minerva ADR] Carpeta de Drive configurada'
      );

      return {
        success: true,
        configured: true,
        folder: {
          id: folder.id,
          name: folder.name,
        },
        message: 'Carpeta guardada correctamente.',
      };
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al guardar carpeta:',
        error
      );

      throw new Error(
        `No fue posible guardar la carpeta: ${
          error?.message || 'Error desconocido'
        }`
      );
    }
  },

  // ==========================================================
  // GOOGLE DRIVE - SINCRONIZACIÓN DE MINUTAS
  // ==========================================================

  syncDriveMarkdown: async ({ context, payload }) => {
    try {
      const reprocess = payload?.reprocess === true;

      console.log(
        '[Minerva ADR] Solicitud de sincronización recibida'
      );

      return await syncDriveMarkdown(context, {
        reprocess,
      });
    } catch (error) {
      console.error(
        '[Minerva ADR] Error de sincronización:',
        error
      );

      throw new Error(
        `No fue posible sincronizar Google Drive: ${
          error?.message || 'Error desconocido'
        }`
      );
    }
  },


  // ==========================================================
  // ADR - CONSULTAR CANDIDATOS ACTIVOS
  // ==========================================================

  getCandidates: async () => {
    try {
      const result = await sql
        .prepare(`
          SELECT
            id,
            title,
            decision,
            context,
            job,
            status,
            review_status,
            decision_owner,
            source_file,
            source_type,
            source_reference,
            meeting_date,
            evidence,
            created_at,
            updated_at
          FROM adr_candidates
          WHERE archived_at IS NULL
          ORDER BY created_at DESC
        `)
        .execute();

      return {
        success: true,
        candidates: result.rows,
      };
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al consultar candidatos:',
        error
      );

      throw new Error(
        'No fue posible consultar los candidatos ADR.'
      );
    }
  },

  // ==========================================================
  // ADR - CONSULTAR ARCHIVADOS
  // ==========================================================

  getArchivedCandidates: async () => {
    try {
      const result = await sql
        .prepare(`
          SELECT
            id,
            title,
            decision,
            context,
            job,
            status,
            review_status,
            decision_owner,
            source_file,
            source_type,
            source_reference,
            meeting_date,
            evidence,
            created_at,
            updated_at,
            archived_at
          FROM adr_candidates
          WHERE archived_at IS NOT NULL
          ORDER BY archived_at DESC
        `)
        .execute();

      return {
        success: true,
        candidates: result.rows,
      };
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al consultar archivados:',
        error
      );

      throw new Error(
        'No fue posible consultar las decisiones archivadas.'
      );
    }
  },

  // ==========================================================
  // ADR - CREACIÓN MANUAL
  // ==========================================================

  createManualCandidate: async ({ payload }) => {
    const {
      title,
      decision,
      context,
      job,
      decision_owner,
      meeting_date,
      source_reference,
    } = payload || {};

    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.trim().length > 255 ||
      typeof decision !== 'string' ||
      !decision.trim()
    ) {
      throw new Error(
        'Debes proporcionar un título y una decisión válidos.'
      );
    }

    if (
      (context != null && typeof context !== 'string') ||
      (job != null && typeof job !== 'string') ||
      (
        decision_owner != null &&
        typeof decision_owner !== 'string'
      ) ||
      (
        source_reference != null &&
        typeof source_reference !== 'string'
      ) ||
      (
        meeting_date != null &&
        typeof meeting_date !== 'string'
      )
    ) {
      throw new Error(
        'Uno o más campos opcionales no son válidos.'
      );
    }

    if (
      (job || '').trim().length > 50 ||
      (decision_owner || '').trim().length > 255 ||
      (source_reference || '').trim().length > 500
    ) {
      throw new Error(
        'Uno de los campos supera la longitud permitida.'
      );
    }

    if (
      meeting_date &&
      !/^\d{4}-\d{2}-\d{2}$/.test(meeting_date)
    ) {
      throw new Error(
        'La fecha debe tener el formato YYYY-MM-DD.'
      );
    }

    try {
      const id = randomUUID();

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
            source_type,
            source_reference,
            source_file,
            meeting_date,
            source_hash,
            evidence
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .bindParams(
          id,
          title.trim(),
          decision.trim(),
          context?.trim() || null,
          job?.trim() || null,
          'Propuesto',
          'Pendiente de revisión',
          decision_owner?.trim() || null,
          'manual',
          source_reference?.trim() || null,
          null,
          meeting_date || null,
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
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al crear candidato manual:',
        error
      );

      throw new Error(
        'No fue posible crear el candidato manual.'
      );
    }
  },

  // ==========================================================
  // ADR - PROCESAR MARKDOWN
  // ==========================================================

  processMarkdown: async ({ payload }) => {
    const {
      data,
      sourceFile,
    } = payload || {};

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

    try {
      const content = Buffer
        .from(data, 'base64')
        .toString('utf8');

      if (!content.trim()) {
        throw new Error(
          'El archivo está vacío o no contiene texto válido.'
        );
      }

      const extraction = extractCandidates(
        content,
        sourceFile
      );

      let inserted = 0;
      let duplicates = 0;

      for (const candidate of extraction.candidates) {
        const existing = await sql
          .prepare(`
            SELECT id
            FROM adr_candidates
            WHERE source_hash = ?
            LIMIT 1
          `)
          .bindParams(candidate.source_hash)
          .execute();

        if (existing.rows.length > 0) {
          duplicates++;
          continue;
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
              meeting_date,
              source_hash,
              evidence
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .bindParams(
            candidate.id,
            candidate.title,
            candidate.decision,
            candidate.context,
            candidate.job,
            candidate.status,
            candidate.review_status,
            candidate.decision_owner,
            candidate.source_file,
            candidate.meeting_date,
            candidate.source_hash,
            JSON.stringify(candidate.evidence)
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
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al procesar minuta:',
        error
      );

      throw new Error(
        'No fue posible procesar y almacenar la minuta.'
      );
    }
  },

  // ==========================================================
  // ADR - ACTUALIZAR REVISIÓN
  // ==========================================================

  updateReviewStatus: async ({ payload }) => {
    const {
      id,
      reviewStatus,
    } = payload || {};

    const allowedStatuses = [
      'Validado',
      'Descartado',
    ];

    if (
      typeof id !== 'string' ||
      !id.trim() ||
      !allowedStatuses.includes(reviewStatus)
    ) {
      throw new Error(
        'Los datos de revisión no son válidos.'
      );
    }

    try {
      const existing = await sql
        .prepare(`
          SELECT id
          FROM adr_candidates
          WHERE id = ?
          LIMIT 1
        `)
        .bindParams(id)
        .execute();

      if (existing.rows.length === 0) {
        throw new Error(
          'El candidato ADR no existe.'
        );
      }

      await sql
        .prepare(`
          UPDATE adr_candidates
          SET
            review_status = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bindParams(reviewStatus, id)
        .execute();

      return {
        success: true,
        id,
        review_status: reviewStatus,
      };
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al actualizar revisión:',
        error
      );

      throw new Error(
        'No fue posible actualizar el estado de revisión.'
      );
    }
  },

  // ==========================================================
  // ADR - EDITAR CANDIDATO
  // ==========================================================

  updateCandidate: async ({ payload }) => {
    const {
      id,
      title,
      decision,
      context,
      job,
      decision_owner,
      status,
      review_status,
    } = payload || {};

    const allowedStatuses = [
      'Propuesto',
      'En discusión',
      'Aprobada',
      'Rechazada',
      'Obsoleta',
    ];

    const allowedReviewStatuses = [
      'Pendiente de revisión',
      'Validado',
      'Descartado',
    ];

    if (
      typeof id !== 'string' ||
      !id.trim() ||
      typeof title !== 'string' ||
      !title.trim() ||
      title.trim().length > 255 ||
      typeof decision !== 'string' ||
      !decision.trim() ||
      !allowedStatuses.includes(status) ||
      !allowedReviewStatuses.includes(review_status)
    ) {
      throw new Error(
        'Los datos de la decisión no son válidos.'
      );
    }

    if (
      (
        context !== null &&
        context !== undefined &&
        typeof context !== 'string'
      ) ||
      (
        job !== null &&
        job !== undefined &&
        typeof job !== 'string'
      ) ||
      (
        decision_owner !== null &&
        decision_owner !== undefined &&
        typeof decision_owner !== 'string'
      )
    ) {
      throw new Error(
        'Los campos opcionales deben contener texto.'
      );
    }

    if (
      (job || '').trim().length > 50 ||
      (decision_owner || '').trim().length > 255
    ) {
      throw new Error(
        'Uno de los campos supera la longitud permitida.'
      );
    }

    try {
      const existing = await sql
        .prepare(`
          SELECT id
          FROM adr_candidates
          WHERE id = ?
            AND archived_at IS NULL
          LIMIT 1
        `)
        .bindParams(id)
        .execute();

      if (existing.rows.length === 0) {
        throw new Error(
          'La decisión no existe o está archivada.'
        );
      }

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
            AND archived_at IS NULL
        `)
        .bindParams(
          title.trim(),
          decision.trim(),
          context?.trim() || null,
          job?.trim() || null,
          decision_owner?.trim() || null,
          status,
          review_status,
          id
        )
        .execute();

      return {
        success: true,
        id,
        message:
          'Decisión actualizada correctamente.',
      };
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al editar decisión:',
        error
      );

      throw new Error(
        'No fue posible actualizar la decisión.'
      );
    }
  },

  // ==========================================================
  // ADR - ARCHIVAR
  // ==========================================================

  archiveCandidate: async ({ payload }) => {
    const { id } = payload || {};

    if (
      typeof id !== 'string' ||
      !id.trim()
    ) {
      throw new Error(
        'Debes proporcionar un identificador válido.'
      );
    }

    try {
      const existing = await sql
        .prepare(`
          SELECT id
          FROM adr_candidates
          WHERE id = ?
            AND archived_at IS NULL
          LIMIT 1
        `)
        .bindParams(id)
        .execute();

      if (existing.rows.length === 0) {
        throw new Error(
          'El candidato no existe o ya está archivado.'
        );
      }

      await sql
        .prepare(`
          UPDATE adr_candidates
          SET
            archived_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bindParams(id)
        .execute();

      return {
        success: true,
        id,
        message:
          'Candidato archivado correctamente.',
      };
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al archivar candidato:',
        error
      );

      throw new Error(
        'No fue posible archivar el candidato.'
      );
    }
  },

  // ==========================================================
  // ADR - RESTAURAR
  // ==========================================================

  restoreCandidate: async ({ payload }) => {
    const { id } = payload || {};

    if (
      typeof id !== 'string' ||
      !id.trim()
    ) {
      throw new Error(
        'Debes proporcionar un identificador válido.'
      );
    }

    try {
      const existing = await sql
        .prepare(`
          SELECT id
          FROM adr_candidates
          WHERE id = ?
            AND archived_at IS NOT NULL
          LIMIT 1
        `)
        .bindParams(id)
        .execute();

      if (existing.rows.length === 0) {
        throw new Error(
          'El candidato no existe o no está archivado.'
        );
      }

      await sql
        .prepare(`
          UPDATE adr_candidates
          SET
            archived_at = NULL,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `)
        .bindParams(id)
        .execute();

      return {
        success: true,
        id,
        message:
          'Candidato restaurado correctamente.',
      };
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al restaurar candidato:',
        error
      );

      throw new Error(
        'No fue posible restaurar el candidato.'
      );
    }
  },

  // ==========================================================
  // ADR - ELIMINAR DEFINITIVAMENTE
  // ==========================================================

  deleteCandidate: async ({ payload }) => {
    const { id } = payload || {};

    if (
      typeof id !== 'string' ||
      !id.trim()
    ) {
      throw new Error(
        'Debes proporcionar un identificador válido.'
      );
    }

    try {
      const existing = await sql
        .prepare(`
          SELECT id
          FROM adr_candidates
          WHERE id = ?
          LIMIT 1
        `)
        .bindParams(id)
        .execute();

      if (existing.rows.length === 0) {
        throw new Error(
          'El candidato ADR no existe.'
        );
      }

      await sql
        .prepare(`
          DELETE FROM adr_candidates
          WHERE id = ?
        `)
        .bindParams(id)
        .execute();

      return {
        success: true,
        id,
        message:
          'Candidato eliminado definitivamente.',
      };
    } catch (error) {
      console.error(
        '[Minerva ADR] Error al eliminar candidato:',
        error
      );

      throw new Error(
        'No fue posible eliminar el candidato.'
      );
    }
  },

});
