
import { createHash, randomUUID } from 'node:crypto';
import { parseMarkdown } from './markdown-parser.js';

const CANDIDATE_PATTERNS = [
  /\bposibilidad de\b/i,
  /\bse propone\b/i,
  /\bpropuesta de\b/i,
  /\bse plantea\b/i,
  /\bevaluar la posibilidad de\b/i,
  /\bse decidió\b/i,
  /\bse acuerda\b/i,
  /\bse acordó\b/i,
  /\bse aprobó\b/i,
  /\bse rechaza\b/i,
  /\bse descartó\b/i,
  /\bse descarta\b/i,
  /\bse reemplaza\b/i,
  /\bse comentó la posibilidad de\b/i,
];

const ACTION_PATTERNS = [
  /\bquedó a cargo\b/i,
  /\bresponsable de\b/i,
  /\bpendiente de realizar\b/i,
  /\bpróximo paso\b/i,
  /\bse encargará de\b/i,
];

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

function normalize(value = '') {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\d+[\.)]\s*/, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function getColumn(columns, ...names) {
  for (const name of names) {
    const value = columns[normalize(name)];

    if (
      value &&
      ![
        '[no especificado]',
        '[sin fecha definida]',
        '[pendiente]',
      ].includes(value.toLowerCase())
    ) {
      return value.trim();
    }
  }

  return null;
}

function isAction(text) {
  return ACTION_PATTERNS.some((pattern) => pattern.test(text));
}

function isTaskBullet(text) {
  return /^definir,\s*documentar\s+y\s+socializar\b/i.test(text.trim());
}

function isCandidate(text, section, kind = 'text') {
  const normalizedSection = normalize(section);

  if (EXCLUDED_SECTIONS.has(normalizedSection)) {
    return false;
  }

  if (isAction(text)) {
    return false;
  }

  if (kind === 'bullet' && isTaskBullet(text)) {
    return false;
  }

  if (normalizedSection === 'alineaciones clave') {
    return true;
  }

  if (DECISION_SECTIONS.has(normalizedSection)) {
    return true;
  }

  if (PROPOSAL_SECTIONS.has(normalizedSection)) {
    return true;
  }

  return CANDIDATE_PATTERNS.some((pattern) => pattern.test(text));
}

function determineStatus(text) {
  if (/\b(se rechazó|se descarta|se descartó|queda rechazado)\b/i.test(text)) {
    return 'Rechazada';
  }

  if (/\b(obsoleta|queda sin efecto|deja de aplicarse)\b/i.test(text)) {
    return 'Obsoleta';
  }

  if (/\b(se aprobó|fue aprobada|queda aprobado|aprobado formalmente)\b/i.test(text)) {
    return 'Aprobada';
  }

  if (/\b(en discusión|se está discutiendo|continúa en evaluación)\b/i.test(text)) {
    return 'En discusión';
  }

  return 'Propuesto';
}

function extractJob(text) {
  const match = text.match(/\b(?:CRUISE|CLUS)-\d+\b/i);
  return match ? match[0].toUpperCase() : null;
}

function makeTitle(text) {
  return text
    .replace(/^(se comentó la posibilidad de|se plantea|se propone)\s*/i, '')
    .slice(0, 120)
    .trim()
    .replace(/\.$/, '');
}

function createCandidate(item, sourceFile, meetingDate) {
  const { text, section, columns = {} } = item;

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

  const isAlignment = normalize(section) === 'alineaciones clave';

  const decisionText = isAlignment && details ? details : text;
  const candidateTitle = isAlignment ? text : makeTitle(text);

  let context = details || '';

  if (!context && item.kind === 'table') {
    context = item.context || '';
  }

  const sourceHash = createHash('sha256')
    .update(`${sourceFile}|${section}|${text}`, 'utf8')
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

export function extractCandidates(content, sourceFile) {
  const parsed = parseMarkdown(content, sourceFile);
  const candidates = [];
  const warnings = [];

  for (const item of parsed.items) {
    if (!isCandidate(item.text, item.section, item.kind)) {
      continue;
    }

    candidates.push(
      createCandidate(item, sourceFile, parsed.meeting_date)
    );
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
