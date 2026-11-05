
import path from 'node:path';

function normalizeHeader(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function parseMarkdown(content, sourceFile = '') {
  const lines = content.split(/\r?\n/);

  let title = null;
  let meetingDate = null;
  let currentSection = 'Sin sección';
  let items = [];
  let tableHeaders = null;

  // Recuperar fecha desde el nombre del archivo.
  if (sourceFile) {
    const dateMatch = path.basename(sourceFile).match(
      /(20\d{2}-\d{2}-\d{2})/
    );

    if (dateMatch) {
      meetingDate = dateMatch[1];
    }
  }

  for (const line of lines) {
    const stripped = line.trim();

    if (!stripped) {
      tableHeaders = null;
      continue;
    }

    const heading = stripped.match(/^#\s+(.+)/);

    if (heading) {
      title = heading[1].trim();
      tableHeaders = null;
      continue;
    }

    const dateMatch = stripped.match(
      /^\*\*Fecha:\*\*\s*(\d{4}-\d{2}-\d{2})/i
    );

    if (dateMatch) {
      meetingDate = dateMatch[1];
      continue;
    }

    if (/^\*\*(Duración|Participantes):\*\*/i.test(stripped)) {
      continue;
    }

    const section = stripped.match(/^#{2,6}\s+(.+)/);

    if (section) {
      currentSection = section[1].trim();
      tableHeaders = null;
      continue;
    }

    if (stripped.includes('|')) {
      const cells = stripped
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());

      if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
        continue;
      }

      // Primera fila de la tabla: encabezados.
      if (tableHeaders === null) {
        tableHeaders = cells.map(normalizeHeader);
        continue;
      }

      // Asociar valores con sus encabezados.
      const columns = Object.fromEntries(
        tableHeaders
          .map((header, index) => [header, cells[index]?.trim()])
          .filter(([header, value]) => header && value !== undefined)
      );

      const firstValue = cells[0] || '';

      if (firstValue) {
        items.push({
          text: firstValue,
          context: cells.slice(1).filter(Boolean).join(' | '),
          columns,
          section: currentSection,
          kind: 'table',
        });
      }

      continue;
    }

    tableHeaders = null;

    const bullet = stripped.match(/^[-*+]\s+(.+)/);

    if (bullet) {
      items.push({
        text: bullet[1].trim(),
        context: '',
        columns: {},
        section: currentSection,
        kind: 'bullet',
      });

      continue;
    }

    if (!stripped.startsWith('<!--')) {
      items.push({
        text: stripped,
        context: '',
        columns: {},
        section: currentSection,
        kind: 'text',
      });
    }
  }

  return {
    title,
    meeting_date: meetingDate,
    items,
  };
}
