// Lógica pura de la vista de decisiones (sin UI Kit), para poder testearla con node --test.

import { dateFromPath } from '../shared/dates.js';

export const REVIEW = {
  pending: 'Pendiente de revisión',
  validated: 'Validado',
  discarded: 'Descartado',
};

// Pestañas de la cola de revisión, en el orden en que se muestran.
export const TABS = [
  { id: 'pending', label: 'Pendientes' },
  { id: 'validated', label: 'Validadas' },
  { id: 'discarded', label: 'Descartadas' },
  { id: 'all', label: 'Todas' },
  { id: 'archived', label: 'Archivadas' },
];

const reviewOf = (d) => d.review_status || REVIEW.pending;

export const countByTab = (active, archived) => ({
  pending: active.filter((d) => reviewOf(d) === REVIEW.pending).length,
  validated: active.filter((d) => reviewOf(d) === REVIEW.validated).length,
  discarded: active.filter((d) => reviewOf(d) === REVIEW.discarded).length,
  all: active.length,
  archived: archived.length,
});

// Minúsculas y sin tildes, para que "alvaro" encuentre "Álvaro".
const normalize = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// keep: ids recién revisados que siguen visibles en la pestaña actual, para que la
// tabla no se desplace bajo el cursor justo después de Validar/Descartar.
export const filterDecisions = (active, archived, tabId, query, keep = new Set()) => {
  const source = tabId === 'archived' ? archived : active;
  const byTab =
    tabId in REVIEW
      ? source.filter((d) => reviewOf(d) === REVIEW[tabId] || keep.has(d.id))
      : source;

  const q = normalize(query).trim();
  if (!q) return byTab;

  return byTab.filter((d) =>
    [d.title, d.job, d.decision_owner, d.decision].some((v) =>
      normalize(v).includes(q)
    )
  );
};

export const toggleId = (set, id) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export const toggleAll = (set, ids) => {
  const next = new Set(set);
  const allIn = ids.length > 0 && ids.every((id) => next.has(id));
  ids.forEach((id) => (allIn ? next.delete(id) : next.add(id)));
  return next;
};

export const formatDate = (value) => (value ? String(value).slice(0, 10) : '');

// Fecha de reunión; las decisiones importadas antes de guardar la fecha de la
// carpeta la recuperan desde la ruta de origen.
export const decisionDate = (d) =>
  formatDate(d.meeting_date) || dateFromPath(d.source_reference || d.source_file) || '';

// Más recientes primero; sin fecha al final.
export const sortByDateDesc = (decisions) =>
  [...decisions].sort((a, b) => (decisionDate(b) || '').localeCompare(decisionDate(a) || ''));

export const EXPORT_COLUMNS = [
  { header: 'Título', value: (d) => d.title, width: 40 },
  { header: 'Decisión', value: (d) => d.decision, width: 60 },
  { header: 'Contexto', value: (d) => d.context, width: 60 },
  { header: 'Proyecto', value: (d) => d.job, width: 22 },
  { header: 'Responsable', value: (d) => d.decision_owner, width: 28 },
  { header: 'Fecha de reunión', value: decisionDate, width: 16 },
  { header: 'Estado de la decisión', value: (d) => d.status, width: 20 },
  { header: 'Revisión', value: (d) => d.review_status, width: 22 },
  { header: 'Origen', value: (d) => d.source_reference || d.source_file, width: 50 },
  { header: 'Archivada', value: (d) => (d.archived_at ? 'Sí' : 'No'), width: 10 },
];

// Matriz de texto: fila 0 = encabezados. La UI la convierte al formato de write-excel-file.
export const exportRows = (decisions) => [
  EXPORT_COLUMNS.map((c) => c.header),
  ...decisions.map((d) => EXPORT_COLUMNS.map((c) => String(c.value(d) ?? ''))),
];
