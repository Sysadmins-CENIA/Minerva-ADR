
import { makeResolver } from '@forge/resolver';
import { sql } from '@forge/sql';
import { extractCandidates } from '../parser/extractor.js';
import { randomUUID } from 'node:crypto';

export const handler = makeResolver({
  // Consulta únicamente candidatos que no están archivados.
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
      console.error('[Minerva ADR] Error al consultar candidatos:', error);
      throw new Error('No fue posible consultar los candidatos ADR.');
    }
  },

  // Consulta los candidatos archivados.
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
      console.error('[Minerva ADR] Error al consultar archivados:', error);
      throw new Error('No fue posible consultar las decisiones archivadas.');
    }
  },

  // Crea manualmente un candidato ADR pendiente de revisión.
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

    // Campos obligatorios.
    if (
      typeof title !== 'string' ||
      !title.trim() ||
      title.trim().length > 255 ||
      typeof decision !== 'string' ||
      !decision.trim()
    ) {
      throw new Error('Debes proporcionar un título y una decisión válidos.');
    }

    // Campos opcionales.
    if (
      (context != null && typeof context !== 'string') ||
      (job != null && typeof job !== 'string') ||
      (decision_owner != null && typeof decision_owner !== 'string') ||
      (source_reference != null && typeof source_reference !== 'string') ||
      (meeting_date != null && typeof meeting_date !== 'string')
    ) {
      throw new Error('Uno o más campos opcionales no son válidos.');
    }

    if (
      (job || '').trim().length > 50 ||
      (decision_owner || '').trim().length > 255 ||
      (source_reference || '').trim().length > 500
    ) {
      throw new Error('Uno de los campos supera la longitud permitida.');
    }

    // La fecha es opcional, pero debe tener formato YYYY-MM-DD.
    if (
      meeting_date &&
      !/^\d{4}-\d{2}-\d{2}$/.test(meeting_date)
    ) {
      throw new Error('La fecha debe tener el formato YYYY-MM-DD.');
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
        message: 'Candidato manual creado y enviado a revisión.',
      };
    } catch (error) {
      console.error('[Minerva ADR] Error al crear candidato manual:', error);
      throw new Error('No fue posible crear el candidato manual.');
    }
  },

  // Procesa una minuta Markdown e inserta candidatos nuevos.
  processMarkdown: async ({ payload }) => {
    const { data, sourceFile } = payload || {};

    if (
      typeof data !== 'string' ||
      !data.trim() ||
      typeof sourceFile !== 'string' ||
      !sourceFile.trim()
    ) {
      throw new Error('Debes proporcionar el archivo Markdown y su nombre.');
    }

    try {
      const content = Buffer.from(data, 'base64').toString('utf8');

      if (!content.trim()) {
        throw new Error('El archivo está vacío o no contiene texto válido.');
      }

      const extraction = extractCandidates(content, sourceFile);

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
      console.error('[Minerva ADR] Error al procesar minuta:', error);
      throw new Error('No fue posible procesar y almacenar la minuta.');
    }
  },

  // Actualiza el estado de revisión humana.
  updateReviewStatus: async ({ payload }) => {
    const { id, reviewStatus } = payload || {};

    const allowedStatuses = ['Validado', 'Descartado'];

    if (
      typeof id !== 'string' ||
      !id.trim() ||
      !allowedStatuses.includes(reviewStatus)
    ) {
      throw new Error('Los datos de revisión no son válidos.');
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
        throw new Error('El candidato ADR no existe.');
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
      console.error('[Minerva ADR] Error al actualizar revisión:', error);
      throw new Error('No fue posible actualizar el estado de revisión.');
    }
  },
    // Edita los datos de una decisión y su estado.
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

    // Validaciones de los campos obligatorios.
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
      throw new Error('Los datos de la decisión no son válidos.');
    }

    // Validaciones de los campos opcionales.
    if (
      (context !== null && context !== undefined && typeof context !== 'string') ||
      (job !== null && job !== undefined && typeof job !== 'string') ||
      (decision_owner !== null &&
        decision_owner !== undefined &&
        typeof decision_owner !== 'string')
    ) {
      throw new Error('Los campos opcionales deben contener texto.');
    }

    if (
      (job || '').trim().length > 50 ||
      (decision_owner || '').trim().length > 255
    ) {
      throw new Error('Uno de los campos supera la longitud permitida.');
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
        throw new Error('La decisión no existe o está archivada.');
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
        message: 'Decisión actualizada correctamente.',
      };
    } catch (error) {
      console.error('[Minerva ADR] Error al editar decisión:', error);
      throw new Error('No fue posible actualizar la decisión.');
    }
  },

  // Archiva un candidato sin eliminarlo.
  archiveCandidate: async ({ payload }) => {
    const { id } = payload || {};

    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('Debes proporcionar un identificador válido.');
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
        throw new Error('El candidato no existe o ya está archivado.');
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
        message: 'Candidato archivado correctamente.',
      };
    } catch (error) {
      console.error('[Minerva ADR] Error al archivar candidato:', error);
      throw new Error('No fue posible archivar el candidato.');
    }
  },

  // Restaura un candidato archivado.
  restoreCandidate: async ({ payload }) => {
    const { id } = payload || {};

    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('Debes proporcionar un identificador válido.');
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
        throw new Error('El candidato no existe o no está archivado.');
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
        message: 'Candidato restaurado correctamente.',
      };
    } catch (error) {
      console.error('[Minerva ADR] Error al restaurar candidato:', error);
      throw new Error('No fue posible restaurar el candidato.');
    }
  },

  // Elimina definitivamente un candidato.
  deleteCandidate: async ({ payload }) => {
    const { id } = payload || {};

    if (typeof id !== 'string' || !id.trim()) {
      throw new Error('Debes proporcionar un identificador válido.');
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
        throw new Error('El candidato ADR no existe.');
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
        message: 'Candidato eliminado definitivamente.',
      };
    } catch (error) {
      console.error('[Minerva ADR] Error al eliminar candidato:', error);
      throw new Error('No fue posible eliminar el candidato.');
    }
  },
});
