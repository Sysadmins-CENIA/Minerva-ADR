// Recorrido de la carpeta de minutas por etapas.
//
// Cada sincronización tiene poco tiempo (la función de Forge tiene un límite),
// así que el árbol se recorre en varias ejecuciones:
// - Las carpetas sin fecha (raíz, grupos) se listan siempre: son pocas y
//   revelan las reuniones nuevas.
// - Las carpetas de reunión (con fecha en el nombre) van de la más nueva a la
//   más antigua, y las ya revisadas en el ciclo actual no se vuelven a listar.
// - Cuando una ejecución termina el árbol completo, el ciclo se reinicia y la
//   siguiente vuelve a revisarlo todo (así se detectan minutas editadas).
//
// Este módulo no habla con Drive ni con SQL: recibe esas operaciones como
// funciones para poder probarlo con un árbol falso.

import { dateFromPath } from '../shared/dates.js';

// Tope de ids guardados por espacio (≈ 35 bytes cada uno).
export const MAX_VISITED = 5000;

const DRIVE_ID = /^[A-Za-z0-9_-]{1,128}$/;

// Sin fecha primero (contenedores), luego fecha descendente, luego nombre descendente.
export function folderPriority(a, b) {
  const da = dateFromPath(a.name);
  const db = dateFromPath(b.name);

  if (!da !== !db) return da ? 1 : -1;
  if (da && db && da !== db) return db.localeCompare(da);
  return String(b.name ?? '').localeCompare(String(a.name ?? ''));
}

// El estado viene de la base de datos (columna JSON): se valida igual.
export function parseScanState(raw) {
  let value = raw;

  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return new Set();
    }
  }

  const ids = Array.isArray(value?.visited) ? value.visited : [];
  return new Set(ids.filter((id) => typeof id === 'string' && DRIVE_ID.test(id)));
}

export function serializeScanState(visited) {
  if (!visited || visited.size === 0) return null;
  return JSON.stringify({ visited: [...visited].slice(0, MAX_VISITED) });
}

/**
 * Recorre el árbol desde `root`.
 * - listChildren(folder) → { folders: [{id,name}], files: [...], truncated }
 * - handleFolder(folder, files) → true si se detuvo antes de procesar todos sus archivos
 * - shouldStop() → true cuando se agotó el presupuesto de la ejecución
 * Devuelve { visited, complete, pending, foldersScanned }.
 */
export async function scanTree({ root, visited, listChildren, handleFolder, shouldStop }) {
  const done = new Set(visited);
  const seen = new Set();
  const pending = [root];
  let foldersScanned = 0;
  let incomplete = false;

  while (pending.length > 0) {
    if (shouldStop()) {
      return { visited: done, complete: false, pending: pending.length, foldersScanned };
    }

    pending.sort(folderPriority);
    const current = pending.shift();

    if (seen.has(current.id)) continue;
    seen.add(current.id);

    const { folders = [], files = [], truncated = false } = await listChildren(current);
    foldersScanned++;

    for (const folder of folders) {
      if (!done.has(folder.id) && !seen.has(folder.id)) {
        pending.push({
          id: folder.id,
          name: folder.name,
          path: `${current.path}/${folder.name}`,
        });
      }
    }

    const stopped = await handleFolder(current, files);

    if (stopped) {
      return { visited: done, complete: false, pending: pending.length + 1, foldersScanned };
    }

    // Una reunión (sin subcarpetas) listada completa queda revisada en este ciclo.
    if (truncated) incomplete = true;
    else if (folders.length === 0 && current.id !== root.id) done.add(current.id);
  }

  if (incomplete) {
    return { visited: done, complete: false, pending: 0, foldersScanned };
  }

  return { visited: new Set(), complete: true, pending: 0, foldersScanned };
}
