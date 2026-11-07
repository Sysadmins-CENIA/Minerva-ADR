
import api from '@forge/api';

export const GOOGLE_FOLDER_MIME =
  'application/vnd.google-apps.folder';

export const GOOGLE_REQUIRED_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

export const MAX_MARKDOWN_SIZE = 1024 * 1024;

// ============================================================
// VALIDACIONES
// ============================================================

function validateFileId(fileId) {
  if (
    typeof fileId !== 'string' ||
    !/^[a-zA-Z0-9_-]{5,255}$/.test(fileId)
  ) {
    throw new Error(
      'El identificador de Google Drive no es válido.'
    );
  }

  return fileId;
}

// ============================================================
// AUTENTICACIÓN
// ============================================================

export async function getAuthorizedDriveClient() {
  const google = api
    .asUser()
    .withProvider('google', 'google-apis');

  const authorized = await google.hasCredentials(
    GOOGLE_REQUIRED_SCOPES
  );

  if (!authorized) {
    throw new Error(
      'Conecta Google Drive antes de continuar.'
    );
  }

  return google;
}

// ============================================================
// SOLICITUDES A GOOGLE DRIVE
// ============================================================

export async function driveGet(
  google,
  path,
  parameters = {}
) {
  const query = new URLSearchParams(parameters);

  const url = query.toString()
    ? `${path}?${query.toString()}`
    : path;

  const response = await google.fetch(url);

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);

    throw new Error(
      `Google Drive respondió HTTP ${response.status}: ${detail}`
    );
  }

  return response.json();
}

// ============================================================
// INFORMACIÓN DE UNA CARPETA
// ============================================================

export async function getDriveFolder(google, folderId) {
  validateFileId(folderId);

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
      'La carpeta no existe o no está disponible.'
    );
  }

  return {
    id: folder.id,
    name: folder.name,
  };
}

// ============================================================
// LISTAR CONTENIDO DE UNA CARPETA
// ============================================================

export async function listDriveChildren(
  google,
  folderId,
  maxPages = 10
) {
  validateFileId(folderId);

  const files = [];
  let pageToken;
  let pages = 0;

  do {
    const result = await driveGet(
      google,
      '/drive/v3/files',
      {
        q: `'${folderId}' in parents and trashed = false`,
        fields:
          'nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size)',
        pageSize: '100',
        spaces: 'drive',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        ...(pageToken ? { pageToken } : {}),
      }
    );

    files.push(...(result.files || []));

    pageToken = result.nextPageToken;
    pages++;
  } while (pageToken && pages < maxPages);

  return {
    files,
    truncated: Boolean(pageToken),
  };
}

// ============================================================
// DETECTAR ARCHIVOS MARKDOWN
// ============================================================

export function isMarkdownFile(file) {
  return (
    file &&
    file.mimeType !== GOOGLE_FOLDER_MIME &&
    typeof file.name === 'string' &&
    file.name.toLowerCase().endsWith('.md')
  );
}

// ============================================================
// DESCARGAR ARCHIVO MARKDOWN
// ============================================================

export async function downloadDriveMarkdown(
  google,
  file
) {
  if (!file || !isMarkdownFile(file)) {
    throw new Error(
      'El archivo seleccionado no es Markdown.'
    );
  }

  validateFileId(file.id);

  if (
    file.size != null &&
    Number(file.size) > MAX_MARKDOWN_SIZE
  ) {
    throw new Error(
      `El archivo ${file.name} supera el límite de 1 MB.`
    );
  }

  const response = await google.fetch(
    `/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`
  );

  if (!response.ok) {
    throw new Error(
      `No se pudo descargar ${file.name}. HTTP ${response.status}`
    );
  }

  const contentLength = Number(
    response.headers.get('content-length') || 0
  );

  if (contentLength > MAX_MARKDOWN_SIZE) {
    throw new Error(
      `El archivo ${file.name} supera el límite de 1 MB.`
    );
  }

  const content = await response.text();

  if (
    Buffer.byteLength(content, 'utf8') >
    MAX_MARKDOWN_SIZE
  ) {
    throw new Error(
      `El archivo ${file.name} supera el límite de 1 MB.`
    );
  }

  if (!content.trim()) {
    throw new Error(
      `El archivo ${file.name} está vacío.`
    );
  }

  return content;
}
