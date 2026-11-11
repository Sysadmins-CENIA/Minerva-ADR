// Fecha YYYY-MM-DD presente en una ruta de Drive (p. ej. la carpeta
// "2026-11-04 – Reunión .../acta.md"). Usado por la sincronización y por la UI.
// Se toma la más cercana al archivo y se descartan fechas imposibles.
export function dateFromPath(path) {
  const matches = String(path ?? '').match(/20\d{2}-\d{2}-\d{2}/g) || [];

  for (const value of matches.reverse()) {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCMonth() === m - 1 && date.getUTCDate() === d) return value;
  }

  return null;
}
