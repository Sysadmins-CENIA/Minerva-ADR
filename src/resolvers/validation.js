// Validación de identificadores ADR recibidos desde el frontend (payload no confiable).

export const MAX_BULK_IDS = 100;

export function assertId(id) {
  if (
    typeof id !== 'string' ||
    !/^[0-9a-fA-F-]{36}$/.test(id)
  ) {
    throw new Error('Identificador ADR no válido.');
  }

  return id;
}

// Lista de ids para operaciones masivas: no vacía, sin duplicados y con tope.
export function assertIds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error('Selecciona al menos una decisión.');
  }

  const unique = [...new Set(ids.map(assertId))];

  if (unique.length > MAX_BULK_IDS) {
    throw new Error(
      `Máximo ${MAX_BULK_IDS} decisiones por operación.`
    );
  }

  return unique;
}
