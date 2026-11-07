
import { createHash, randomUUID } from 'node:crypto';
import { parseMarkdown } from './markdown-parser.js';

// ============================================================
// PATRONES DE DETECCIÓN
// ============================================================

// Patrones generales para detectar decisiones,
// propuestas, acuerdos y alternativas.
const CANDIDATE_PATTERNS = [
  /\bposibilidad de\b/i,
  /\bse propone\b/i,
  /\bpropuesta de\b/i,
  /\bse plantea\b/i,
  /\bevaluar la posibilidad de\b/i,
  /\bse decidió(?=\s|$|[.,;:!?])/i,
  /\bse acuerda\b/i,
  /\bse acordó(?=\s|$|[.,;:!?])/i,
  /\bse aprobó(?=\s|$|[.,;:!?])/i,
  /\bse rechaza\b/i,
  /\bse rechazó(?=\s|$|[.,;:!?])/i,
  /\bse descartó(?=\s|$|[.,;:!?])/i,
  /\bse descarta\b/i,
  /\bse reemplaza\b/i,
  /\bse comentó la posibilidad de\b/i,
];

// Patrones más estrictos para decisiones explícitas.
// Se utilizan en secciones normalmente excluidas.
const EXPLICIT_DECISION_PATTERNS = [
  /\bse decidió(?=\s|$|[.,;:!?])/i,
  /\bse acuerda\b/i,
  /\bse acordó(?=\s|$|[.,;:!?])/i,
  /\bse aprobó(?=\s|$|[.,;:!?])/i,
  /\bse rechazó(?=\s|$|[.,;:!?])/i,
  /\bse rechaza\b/i,
  /\bse descartó(?=\s|$|[.,;:!?])/i,
  /\bse descarta\b/i,
];

// Patrones que suelen indicar acciones operativas,
// no decisiones arquitectónicas.
const ACTION_PATTERNS = [
  /\bquedó a cargo\b/i,
  /\bresponsable de\b/i,
  /\bpendiente de realizar\b/i,
  /\bpróximo paso\b/i,
  /\bse encargará de\b/i,
];

// ============================================================
// SECCIONES DEL MARKDOWN
// ============================================================

const DECISION_SECTIONS = new Set([
  'decisiones',
  'decisiones tomadas',
  'decisiones tecnicas',
  'decisiones acordadas',
  'alineaciones clave',
]);

const EXCLUDED_SECTIONS = new Set([
  'acciones y proximos pasos',
  'riesgos identificados',
  'tareas sugeridas para jira',
  'avances reportados por proyecto',
  'estado actual de los trabajadores y responsables',
]);

const PROPOSAL_SECTIONS = new Set([
  'propuestas',
  'propuestas realizadas',
  'alternativas evaluadas',
]);

// ============================================================
// VALORES QUE NO SON DECISIONES
// ============================================================

const INVALID_CANDIDATE_VALUES = new Set([
  '',
  '[no especificado]',
  '[pendiente]',
  '[sin fecha definida]',
  'no especificado',
  'sin definir',
  'n/a',
]);

// Encabezados de Minerva que no deben
// convertirse en candidatos ADR.
const NON_DECISION_HEADINGS = new Set([
  'metadatos de la reunion',
  'resultado general de la sesion',
  'proyectos revisados y estado actual',
  'avances reportados por proyecto',
  'estado actual de los trabajadores y responsables',
  'acciones y proximos pasos',
  'riesgos identificados',
  'dependencias y coordinaciones transversales',
  'observaciones complementarias',
  'tareas sugeridas para jira',
]);

// ============================================================
// NORMALIZACIÓN
// ============================================================

function normalize(value = '') {
  return String(value)
    .trim()
    .toLowerCase()

    // Eliminar escapes Markdown.
    // Ejemplo: "4\\. Decisiones" -> "4. Decisiones"
    .replace(/\\([.!()[\]{}*_#+-])/g, '$1')

    // Quitar numeración inicial.
    // Ejemplo: "4. Decisiones" -> "Decisiones"
    .replace(/^\d+[.)]\s*/, '')

    // Eliminar tildes para comparar encabezados.
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

    .replace(/\s+/g, ' ');
}

// ============================================================
// EXTRACCIÓN DE METADATOS
// ============================================================

function getColumn(columns, ...names) {
  for (const name of names) {
    const value = columns[normalize(name)];

    if (
      typeof value === 'string' &&
      value.trim() &&
      ![
        '[no especificado]',
        '[sin fecha definida]',
        '[pendiente]',
      ].includes(value.trim().toLowerCase())
    ) {
      return value.trim();
    }
  }

  return null;
}

// ============================================================
// VALIDACIÓN DE CANDIDATOS
// ============================================================

function isAction(text) {
  return ACTION_PATTERNS.some(
    (pattern) => pattern.test(text)
  );
}

function isTaskBullet(text) {
  return /^definir,\s*documentar\s+y\s+socializar\b/i
    .test(text.trim());
}

function isInvalidCandidate(text) {
  const normalized = normalize(text)
    .replace(/^\*+|\*+$/g, '')
    .trim();

  return (
    INVALID_CANDIDATE_VALUES.has(normalized) ||
    NON_DECISION_HEADINGS.has(normalized)
  );
}

function isCandidate(text, section, kind = 'text') {
  const normalizedSection = normalize(section);

  // No aceptar valores vacíos, marcadores de ausencia
  // de información ni encabezados conocidos.
  if (isInvalidCandidate(text)) {
    return false;
  }

  // Excluir acciones operativas.
  if (isAction(text)) {
    return false;
  }

  if (kind === 'bullet' && isTaskBullet(text)) {
    return false;
  }

  // En secciones normalmente excluidas,
  // permitir decisiones formuladas explícitamente.
  if (EXCLUDED_SECTIONS.has(normalizedSection)) {
    return EXPLICIT_DECISION_PATTERNS.some(
      (pattern) => pattern.test(text)
    );
  }

  // Las secciones de decisiones son candidatas.
  if (DECISION_SECTIONS.has(normalizedSection)) {
    return true;
  }

  // Las propuestas también pueden generar candidatos.
  if (PROPOSAL_SECTIONS.has(normalizedSection)) {
    return true;
  }

  // En las demás secciones buscar lenguaje de decisión.
  return CANDIDATE_PATTERNS.some(
    (pattern) => pattern.test(text)
  );
}

// ============================================================
// ESTADO DE LA DECISIÓN
// ============================================================

function determineStatus(text) {
  if (
    /\bse rechazó(?=\s|$|[.,;:!?])/i.test(text) ||
    /\bse descarta\b/i.test(text) ||
    /\bse descartó(?=\s|$|[.,;:!?])/i.test(text) ||
    /\bqueda rechazado\b/i.test(text)
  ) {
    return 'Rechazada';
  }

  if (
    /\bobsoleta\b/i.test(text) ||
    /\bqueda sin efecto\b/i.test(text) ||
    /\bdeja de aplicarse\b/i.test(text)
  ) {
    return 'Obsoleta';
  }

  if (
    /\bse aprobó(?=\s|$|[.,;:!?])/i.test(text) ||
    /\bfue aprobada\b/i.test(text) ||
    /\bqueda aprobado\b/i.test(text) ||
    /\baprobado formalmente\b/i.test(text)
  ) {
    return 'Aprobada';
  }

  if (
    /\ben discusión\b/i.test(text) ||
    /\bse está discutiendo\b/i.test(text) ||
    /\bcontinúa en evaluación\b/i.test(text)
  ) {
    return 'En discusión';
  }

  return 'Propuesto';
}

// ============================================================
// PROYECTO Y TÍTULO
// ============================================================

function extractJob(text) {
  const match = text.match(
    /\b(?:CRUISE|CLUS)-\d+\b/i
  );

  return match ? match[0].toUpperCase() : null;
}

function makeTitle(text) {
  return text
    .replace(
      /^(se comentó la posibilidad de|se plantea|se propone)\s*/i,
      ''
    )
    .slice(0, 120)
    .trim()
    .replace(/\.$/, '');
}

// ============================================================
// CREACIÓN DE CANDIDATOS
// ============================================================

function createCandidate(item, sourceFile, meetingDate) {
  const {
    text,
    section,
    columns = {},
  } = item;

  const project = getColumn(
    columns,
    'Proyecto o frente asociado',
    'Proyectos impactados',
    'Proyecto',
    'Proyecto o frente'
  );

  const owner = getColumn(
    columns,
    'Responsable o Aprobador',
    'Responsable',
    'Responsable o Equipo'
  );

  const details = getColumn(
    columns,
    'Observaciones',
    'Detalle o criterio acordado',
    'Resumen ejecutivo',
    'Avance reportado'
  );

  const isAlignment =
    normalize(section) === 'alineaciones clave';

  const decisionText =
    isAlignment && details
      ? details
      : text;

  const candidateTitle =
    isAlignment
      ? text
      : makeTitle(text);

  let context = details || '';

  if (!context && item.kind === 'table') {
    context = item.context || '';
  }

  // Hash estable utilizado por la sincronización
  // para identificar candidatos dentro del archivo.
  const sourceHash = createHash('sha256')
    .update(
      `${sourceFile}|${section}|${text}`,
      'utf8'
    )
    .digest('hex');

  return {
    id: randomUUID(),

    job: project || extractJob(text),

    context,

    decision: decisionText,

    published: null,

    status: determineStatus(text),

    decision_owner: owner,

    title: candidateTitle,

    review_status: 'Pendiente de revisión',

    source_file: sourceFile,

    meeting_date: meetingDate,

    source_hash: sourceHash,

    evidence: [
      {
        quote: decisionText,
        section,
      },
    ],
  };
}

// ============================================================
// EXTRACCIÓN PRINCIPAL
// ============================================================

export function extractCandidates(content, sourceFile) {
  const parsed = parseMarkdown(
    content,
    sourceFile
  );

  const candidates = [];
  const warnings = [];

  for (const item of parsed.items) {
    if (
      !isCandidate(
        item.text,
        item.section,
        item.kind
      )
    ) {
      continue;
    }

    const candidate = createCandidate(
      item,
      sourceFile,
      parsed.meeting_date
    );

    candidates.push(candidate);
  }

  if (candidates.length === 0) {
    warnings.push(
      'No se encontraron decisiones o acuerdos técnicos con las reglas actuales.'
    );
  }

  for (const candidate of candidates) {
    if (!candidate.context) {
      warnings.push(
        `El candidato '${candidate.title}' no tiene contexto explícito.`
      );
    }
  }

  return {
    meeting_title: parsed.title,
    meeting_date: parsed.meeting_date,
    source_file: sourceFile,
    candidates,
    warnings,
  };
}
