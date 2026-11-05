
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Box,
  Button,
  FilePicker,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Text,
  Textfield,
  TextArea,
  Select,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const PAGE_SIZE = 10;

const DECISION_STATUSES = [
  { label: 'Propuesto', value: 'Propuesto' },
  { label: 'En discusión', value: 'En discusión' },
  { label: 'Aprobada', value: 'Aprobada' },
  { label: 'Rechazada', value: 'Rechazada' },
  { label: 'Obsoleta', value: 'Obsoleta' },
];

const REVIEW_STATUSES = [
  { label: 'Pendiente de revisión', value: 'Pendiente de revisión' },
  { label: 'Validado', value: 'Validado' },
  { label: 'Descartado', value: 'Descartado' },
];

const REVIEW_FILTERS = [
  { label: 'Todos', value: 'all' },
  { label: 'Por revisar', value: 'Pendiente de revisión' },
  { label: 'Validados', value: 'Validado' },
  { label: 'Descartados', value: 'Descartado' },
];

const EMPTY_EDIT_FORM = {
  title: '',
  decision: '',
  context: '',
  job: '',
  decision_owner: '',
  status: 'Propuesto',
  review_status: 'Pendiente de revisión',
};

const EMPTY_MANUAL_FORM = {
  title: '',
  decision: '',
  context: '',
  job: '',
  decision_owner: '',
  meeting_date: '',
  source_reference: '',
};

const App = () => {
  const [candidates, setCandidates] = useState([]);
  const [archivedCandidates, setArchivedCandidates] = useState([]);

  const [loading, setLoading] = useState(true);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [updating, setUpdating] = useState(null);
  const [creatingManual, setCreatingManual] = useState(false);

  const [error, setError] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [importResult, setImportResult] = useState(null);

  const [activeView, setActiveView] = useState('active');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [editingCandidateId, setEditingCandidateId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);

  const [showManualForm, setShowManualForm] = useState(false);
  const [manualForm, setManualForm] = useState(EMPTY_MANUAL_FORM);

  // Consulta los candidatos activos.
  const loadCandidates = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await invoke('getCandidates');

      if (!result?.success) {
        throw new Error('La consulta no pudo completarse.');
      }

      setCandidates(result.candidates ?? []);
    } catch (err) {
      console.error('[Minerva ADR] Error al cargar candidatos:', err);
      setError('No fue posible cargar los candidatos ADR.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Consulta los candidatos archivados.
  const loadArchivedCandidates = useCallback(async () => {
    setArchivedLoading(true);

    try {
      const result = await invoke('getArchivedCandidates');

      if (!result?.success) {
        throw new Error('La consulta no pudo completarse.');
      }

      setArchivedCandidates(result.candidates ?? []);
    } catch (err) {
      console.error('[Minerva ADR] Error al cargar archivados:', err);
      setError('No fue posible cargar las decisiones archivadas.');
    } finally {
      setArchivedLoading(false);
    }
  }, []);

  // Actualiza ambas vistas.
  const refreshData = useCallback(async () => {
    await Promise.all([
      loadCandidates(),
      loadArchivedCandidates(),
    ]);
  }, [loadCandidates, loadArchivedCandidates]);

  // Selección de minuta.
  const handleFileChange = useCallback((files) => {
    setSelectedFile(null);
    setImportResult(null);
    setError(null);

    if (!files || files.length === 0) return;

    const file = files[0];

    if (!file.name.toLowerCase().endsWith('.md')) {
      setError('Selecciona un archivo con extensión .md.');
      return;
    }

    setSelectedFile(file);
  }, []);

  // Importación de minuta.
  const handleImport = useCallback(async () => {
    if (!selectedFile || importing) return;

    setImporting(true);
    setError(null);
    setImportResult(null);

    try {
      const result = await invoke('processMarkdown', {
        data: selectedFile.data,
        sourceFile: selectedFile.name,
      });

      if (!result?.success) {
        throw new Error('El procesamiento no pudo completarse.');
      }

      setImportResult(result);
      setCurrentPage(1);
      await refreshData();
    } catch (err) {
      console.error('[Minerva ADR] Error al importar minuta:', err);
      setError('No fue posible importar la minuta. Revisa los registros de Forge.');
    } finally {
      setImporting(false);
    }
  }, [selectedFile, importing, refreshData]);

  // Actualiza un campo del formulario manual.
  const handleManualField = useCallback((field, value) => {
    setManualForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }, []);

  // Cancela el registro manual.
  const handleCancelManual = useCallback(() => {
    setShowManualForm(false);
    setManualForm(EMPTY_MANUAL_FORM);
  }, []);

  // Crea un candidato manual pendiente de revisión.
  const handleCreateManual = useCallback(async () => {
    if (creatingManual) return;

    if (!manualForm.title.trim() || !manualForm.decision.trim()) {
      setError('El título y la decisión son obligatorios.');
      return;
    }

    if (
      manualForm.meeting_date &&
      !/^\d{4}-\d{2}-\d{2}$/.test(manualForm.meeting_date)
    ) {
      setError('La fecha debe tener el formato YYYY-MM-DD.');
      return;
    }

    setCreatingManual(true);
    setError(null);

    try {
      const result = await invoke('createManualCandidate', {
        title: manualForm.title,
        decision: manualForm.decision,
        context: manualForm.context,
        job: manualForm.job,
        decision_owner: manualForm.decision_owner,
        meeting_date: manualForm.meeting_date || null,
        source_reference: manualForm.source_reference,
      });

      if (!result?.success) {
        throw new Error('No se pudo crear el candidato.');
      }

      setShowManualForm(false);
      setManualForm(EMPTY_MANUAL_FORM);
      setCurrentPage(1);
      setActiveView('active');
      setReviewFilter('all');

      await refreshData();
    } catch (err) {
      console.error('[Minerva ADR] Error al crear candidato manual:', err);
      setError('No fue posible registrar la decisión manualmente.');
    } finally {
      setCreatingManual(false);
    }
  }, [creatingManual, manualForm, refreshData]);

  // Validación o descarte de candidatos.
  const handleReview = useCallback(async (candidateId, reviewStatus) => {
    if (updating) return;

    setUpdating(candidateId);
    setError(null);

    try {
      const result = await invoke('updateReviewStatus', {
        id: candidateId,
        reviewStatus,
      });

      if (!result?.success) {
        throw new Error('No se pudo actualizar el candidato.');
      }

      await loadCandidates();
    } catch (err) {
      console.error('[Minerva ADR] Error al actualizar revisión:', err);
      setError('No fue posible actualizar el estado de revisión.');
    } finally {
      setUpdating(null);
    }
  }, [updating, loadCandidates]);

  // Inicia la edición.
  const handleStartEdit = useCallback((candidate) => {
    setError(null);
    setConfirmDeleteId(null);
    setEditingCandidateId(candidate.id);

    setEditForm({
      title: candidate.title ?? '',
      decision: candidate.decision ?? '',
      context: candidate.context ?? '',
      job: candidate.job ?? '',
      decision_owner: candidate.decision_owner ?? '',
      status: candidate.status ?? 'Propuesto',
      review_status: candidate.review_status ?? 'Pendiente de revisión',
    });
  }, []);

  // Cancela la edición.
  const handleCancelEdit = useCallback(() => {
    setEditingCandidateId(null);
    setEditForm(EMPTY_EDIT_FORM);
  }, []);

  // Actualiza un campo del formulario de edición.
  const handleEditField = useCallback((field, value) => {
    setEditForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }, []);

  // Guarda los cambios.
  const handleSaveEdit = useCallback(async (candidateId) => {
    if (updating) return;

    if (!editForm.title.trim() || !editForm.decision.trim()) {
      setError('El título y la decisión son obligatorios.');
      return;
    }

    setUpdating(candidateId);
    setError(null);

    try {
      const result = await invoke('updateCandidate', {
        id: candidateId,
        title: editForm.title,
        decision: editForm.decision,
        context: editForm.context,
        job: editForm.job,
        decision_owner: editForm.decision_owner,
        status: editForm.status,
        review_status: editForm.review_status,
      });

      if (!result?.success) {
        throw new Error('No se pudo actualizar la decisión.');
      }

      setEditingCandidateId(null);
      setEditForm(EMPTY_EDIT_FORM);

      await refreshData();
    } catch (err) {
      console.error('[Minerva ADR] Error al editar decisión:', err);
      setError('No fue posible guardar los cambios de la decisión.');
    } finally {
      setUpdating(null);
    }
  }, [updating, editForm, refreshData]);

  // Archivar candidato.
  const handleArchive = useCallback(async (candidateId) => {
    if (updating) return;

    setUpdating(candidateId);
    setError(null);

    try {
      const result = await invoke('archiveCandidate', {
        id: candidateId,
      });

      if (!result?.success) {
        throw new Error('No se pudo archivar el candidato.');
      }

      setConfirmDeleteId(null);
      setEditingCandidateId(null);
      await refreshData();
    } catch (err) {
      console.error('[Minerva ADR] Error al archivar:', err);
      setError('No fue posible archivar la decisión.');
    } finally {
      setUpdating(null);
    }
  }, [updating, refreshData]);

  // Restaurar candidato archivado.
  const handleRestore = useCallback(async (candidateId) => {
    if (updating) return;

    setUpdating(candidateId);
    setError(null);

    try {
      const result = await invoke('restoreCandidate', {
        id: candidateId,
      });

      if (!result?.success) {
        throw new Error('No se pudo restaurar el candidato.');
      }

      await refreshData();
    } catch (err) {
      console.error('[Minerva ADR] Error al restaurar:', err);
      setError('No fue posible restaurar la decisión.');
    } finally {
      setUpdating(null);
    }
  }, [updating, refreshData]);

  // Eliminación definitiva.
  const handleDelete = useCallback(async (candidateId) => {
    if (updating) return;

    setUpdating(candidateId);
    setError(null);

    try {
      const result = await invoke('deleteCandidate', {
        id: candidateId,
      });

      if (!result?.success) {
        throw new Error('No se pudo eliminar el candidato.');
      }

      setConfirmDeleteId(null);
      setEditingCandidateId(null);
      await refreshData();
    } catch (err) {
      console.error('[Minerva ADR] Error al eliminar:', err);
      setError('No fue posible eliminar la decisión.');
    } finally {
      setUpdating(null);
    }
  }, [updating, refreshData]);

  // Cambiar de vista.
  const handleChangeView = useCallback((view) => {
    setActiveView(view);
    setReviewFilter('all');
    setCurrentPage(1);
    setConfirmDeleteId(null);
    setEditingCandidateId(null);
    setEditForm(EMPTY_EDIT_FORM);
    setShowManualForm(false);
    setManualForm(EMPTY_MANUAL_FORM);
  }, []);

  // Cambiar filtro de revisión.
  const handleChangeFilter = useCallback((filter) => {
    setReviewFilter(filter);
    setCurrentPage(1);
    setConfirmDeleteId(null);
    setEditingCandidateId(null);
  }, []);

  // Carga inicial.
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  // Indicadores de revisión.
  const pendingCount = candidates.filter(
    (candidate) => candidate.review_status === 'Pendiente de revisión'
  ).length;

  const validatedCount = candidates.filter(
    (candidate) => candidate.review_status === 'Validado'
  ).length;

  const discardedCount = candidates.filter(
    (candidate) => candidate.review_status === 'Descartado'
  ).length;

  // Apariencia de los estados.
  const getReviewAppearance = (status) => {
    switch (status) {
      case 'Validado':
        return 'success';
      case 'Descartado':
        return 'removed';
      default:
        return 'new';
    }
  };

  const getDecisionAppearance = (status) => {
    switch (status) {
      case 'Aprobada':
        return 'success';
      case 'Rechazada':
      case 'Obsoleta':
        return 'removed';
      case 'En discusión':
        return 'inprogress';
      default:
        return 'default';
    }
  };

  // Datos de la vista seleccionada.
  const visibleCandidates =
    activeView === 'active' ? candidates : archivedCandidates;

  const isCurrentLoading =
    activeView === 'active' ? loading : archivedLoading;

  // Aplicar filtro de revisión.
  const filteredCandidates = activeView === 'active'
    ? visibleCandidates.filter((candidate) =>
        reviewFilter === 'all' ||
        candidate.review_status === reviewFilter
      )
    : visibleCandidates;

  // Paginación.
  const totalPages = Math.max(
    1,
    Math.ceil(filteredCandidates.length / PAGE_SIZE)
  );

  const safePage = Math.min(currentPage, totalPages);
  const startIndex = (safePage - 1) * PAGE_SIZE;

  const paginatedCandidates = filteredCandidates.slice(
    startIndex,
    startIndex + PAGE_SIZE
  );

  const firstVisible = filteredCandidates.length === 0
    ? 0
    : startIndex + 1;

  const lastVisible = Math.min(
    startIndex + PAGE_SIZE,
    filteredCandidates.length
  );

  // Ajustar página si se elimina o archiva el último elemento de una página.
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return (
    <Stack space="space.300">

      {/* ENCABEZADO */}
      <Box>
        <Stack space="space.100">
          <Inline alignBlock="center" space="space.100">
            <Heading size="xlarge">Minerva ADR</Heading>
            <Lozenge appearance="inprogress">Beta</Lozenge>
          </Inline>

          <Text>
            Registro, seguimiento y validación de decisiones técnicas.
          </Text>

          <Inline space="space.100">
            <Button
              appearance="default"
              onClick={refreshData}
              isDisabled={loading || archivedLoading || importing || updating !== null || creatingManual}
            >
              Actualizar datos
            </Button>
          </Inline>
        </Stack>
      </Box>

      {/* MENSAJES DE ERROR */}
      {error && (
        <SectionMessage appearance="error">
          <Text>{error}</Text>
        </SectionMessage>
      )}

      {/* INDICADORES */}
      <Box>
        <Stack space="space.200">
          <Heading size="medium">Resumen de revisión</Heading>

          <Inline space="space.200" shouldWrap>
            <Box
              padding="space.200"
              backgroundColor="elevation.surface"
              borderColor="color.border"
              borderWidth="border.width"
              borderRadius="medium"
            >
              <Stack space="space.100">
                <Text>Total de candidatos activos</Text>
                <Heading size="xlarge">{candidates.length}</Heading>
              </Stack>
            </Box>

            <Box
              padding="space.200"
              backgroundColor="elevation.surface"
              borderColor="color.border"
              borderWidth="border.width"
              borderRadius="medium"
            >
              <Stack space="space.100">
                <Text>Pendientes</Text>
                <Heading size="xlarge">{pendingCount}</Heading>
                <Lozenge appearance="new">Por revisar</Lozenge>
              </Stack>
            </Box>

            <Box
              padding="space.200"
              backgroundColor="elevation.surface"
              borderColor="color.border"
              borderWidth="border.width"
              borderRadius="medium"
            >
              <Stack space="space.100">
                <Text>Validados</Text>
                <Heading size="xlarge">{validatedCount}</Heading>
                <Lozenge appearance="success">Aceptados</Lozenge>
              </Stack>
            </Box>

            <Box
              padding="space.200"
              backgroundColor="elevation.surface"
              borderColor="color.border"
              borderWidth="border.width"
              borderRadius="medium"
            >
              <Stack space="space.100">
                <Text>Descartados</Text>
                <Heading size="xlarge">{discardedCount}</Heading>
                <Lozenge appearance="removed">Descartados</Lozenge>
              </Stack>
            </Box>
          </Inline>
        </Stack>
      </Box>

      {/* IMPORTACIÓN DE MINUTAS */}
      <Box
        padding="space.300"
        backgroundColor="elevation.surface"
        borderColor="color.border"
        borderWidth="border.width"
        borderRadius="medium"
      >
        <Stack space="space.200">
          <Heading size="medium">Importar minuta</Heading>

          <Text>
            Carga una minuta Markdown para detectar posibles decisiones
            arquitectónicas y registrarlas como candidatos.
          </Text>

          <FilePicker
            label="Seleccionar archivo Markdown"
            description="Formato admitido: .md"
            onChange={handleFileChange}
          />

          {selectedFile && (
            <Box
              padding="space.200"
              backgroundColor="elevation.surface.sunken"
              borderRadius="medium"
            >
              <Stack space="space.100">
                <Text>{selectedFile.name}</Text>
                <Text>{selectedFile.size} bytes</Text>

                <Button
                  appearance="primary"
                  onClick={handleImport}
                  isDisabled={importing || creatingManual}
                >
                  {importing ? 'Procesando...' : 'Importar minuta'}
                </Button>
              </Stack>
            </Box>
          )}

          {importing && (
            <Inline alignBlock="center" space="space.100">
              <Spinner size="small" />
              <Text>Analizando minuta y registrando candidatos...</Text>
            </Inline>
          )}

          {importResult && (
            <SectionMessage appearance="success">
              <Stack space="space.100">
                <Text>Minuta procesada correctamente.</Text>
                <Text>Archivo: {importResult.source_file}</Text>
                <Text>
                  Candidatos encontrados: {importResult.total_candidates}
                </Text>
                <Text>Insertados: {importResult.inserted}</Text>
                <Text>Duplicados omitidos: {importResult.duplicates}</Text>

                {importResult.warnings?.map((warning, index) => (
                  <Text key={index}>{warning}</Text>
                ))}
              </Stack>
            </SectionMessage>
          )}
        </Stack>
      </Box>

      {/* REGISTRO MANUAL */}
      <Box
        padding="space.300"
        backgroundColor="elevation.surface"
        borderColor="color.border"
        borderWidth="border.width"
        borderRadius="medium"
      >
        <Stack space="space.200">
          <Heading size="medium">Registro manual</Heading>

          <Text>
            Registra una decisión que no haya sido detectada en una minuta
            o que provenga de otra fuente.
          </Text>

          {!showManualForm ? (
            <Button
              appearance="primary"
              onClick={() => {
                setError(null);
                setShowManualForm(true);
              }}
              isDisabled={creatingManual || importing || updating !== null}
            >
              Registrar decisión manualmente
            </Button>
          ) : (
            <Box
              padding="space.200"
              backgroundColor="elevation.surface.sunken"
              borderRadius="medium"
            >
              <Stack space="space.200">
                <Heading size="medium">Nueva decisión</Heading>

                <Stack space="space.100">
                  <Text weight="semibold">Título *</Text>
                  <Textfield
                    value={manualForm.title}
                    onChange={(event) =>
                      handleManualField('title', event.target.value)
                    }
                    placeholder="Ej. Uso de almacenamiento compartido"
                    isDisabled={creatingManual}
                  />
                </Stack>

                <Stack space="space.100">
                  <Text weight="semibold">Decisión *</Text>
                  <TextArea
                    value={manualForm.decision}
                    onChange={(event) =>
                      handleManualField('decision', event.target.value)
                    }
                    placeholder="Describe la decisión que se propone registrar."
                    minimumRows={4}
                    isDisabled={creatingManual}
                  />
                </Stack>

                <Stack space="space.100">
                  <Text weight="semibold">Contexto</Text>
                  <TextArea
                    value={manualForm.context}
                    onChange={(event) =>
                      handleManualField('context', event.target.value)
                    }
                    placeholder="¿Qué situación o problema motivó esta decisión?"
                    minimumRows={3}
                    isDisabled={creatingManual}
                  />
                </Stack>

                <Stack space="space.100">
                  <Text weight="semibold">Área o trabajo</Text>
                  <Textfield
                    value={manualForm.job}
                    onChange={(event) =>
                      handleManualField('job', event.target.value)
                    }
                    placeholder="Ej. Infraestructura, IA, Clusters..."
                    isDisabled={creatingManual}
                  />
                </Stack>

                <Stack space="space.100">
                  <Text weight="semibold">Responsable</Text>
                  <Textfield
                    value={manualForm.decision_owner}
                    onChange={(event) =>
                      handleManualField('decision_owner', event.target.value)
                    }
                    placeholder="Nombre del responsable"
                    isDisabled={creatingManual}
                  />
                </Stack>

                <Stack space="space.100">
                  <Text weight="semibold">Fecha de la decisión</Text>
                  <Textfield
                    value={manualForm.meeting_date}
                    onChange={(event) =>
                      handleManualField('meeting_date', event.target.value)
                    }
                    placeholder="YYYY-MM-DD"
                    isDisabled={creatingManual}
                  />
                  <Text size="small">
                    Formato: año-mes-día. Campo opcional.
                  </Text>
                </Stack>

                <Stack space="space.100">
                  <Text weight="semibold">Referencia de origen</Text>
                  <Textfield
                    value={manualForm.source_reference}
                    onChange={(event) =>
                      handleManualField('source_reference', event.target.value)
                    }
                    placeholder="Ej. Reunión del equipo, conversación, documento..."
                    isDisabled={creatingManual}
                  />
                </Stack>

                <SectionMessage appearance="information">
                  <Text>
                    El candidato se creará como Propuesto y Pendiente de revisión.
                    Deberá ser validado manualmente antes de continuar en el flujo.
                  </Text>
                </SectionMessage>

                <Inline space="space.200" shouldWrap>
                  <Button
                    appearance="primary"
                    onClick={handleCreateManual}
                    isDisabled={creatingManual || importing || updating !== null}
                  >
                    {creatingManual ? 'Registrando...' : 'Guardar candidato'}
                  </Button>

                  <Button
                    appearance="default"
                    onClick={handleCancelManual}
                    isDisabled={creatingManual}
                  >
                    Cancelar
                  </Button>
                </Inline>
              </Stack>
            </Box>
          )}

          {creatingManual && (
            <Inline alignBlock="center" space="space.100">
              <Spinner size="small" />
              <Text>Registrando candidato...</Text>
            </Inline>
          )}
        </Stack>
      </Box>

      {/* GESTIÓN DE DECISIONES */}
      <Box>
        <Stack space="space.300">
          <Heading size="medium">Gestión de decisiones</Heading>

          {/* VISTAS */}
          <Inline space="space.100" shouldWrap>
            <Button
              appearance={activeView === 'active' ? 'primary' : 'default'}
              onClick={() => handleChangeView('active')}
            >
              Activas ({candidates.length})
            </Button>

            <Button
              appearance={activeView === 'archived' ? 'primary' : 'default'}
              onClick={() => handleChangeView('archived')}
            >
              Archivadas ({archivedCandidates.length})
            </Button>
          </Inline>

          {/* FILTROS DE REVISIÓN */}
          {activeView === 'active' && (
            <Stack space="space.100">
              <Text weight="semibold">Filtrar por estado de revisión</Text>

              <Inline space="space.100" shouldWrap>
                {REVIEW_FILTERS.map((filter) => {
                  const count = filter.value === 'all'
                    ? candidates.length
                    : candidates.filter(
                        (candidate) =>
                          candidate.review_status === filter.value
                      ).length;

                  return (
                    <Button
                      key={filter.value}
                      appearance={
                        reviewFilter === filter.value
                          ? 'primary'
                          : 'default'
                      }
                      onClick={() => handleChangeFilter(filter.value)}
                    >
                      {filter.label} ({count})
                    </Button>
                  );
                })}
              </Inline>
            </Stack>
          )}

          {activeView === 'active' ? (
            <>
              <Text>
                Revisa los candidatos extraídos de las reuniones y determina
                cuáles deben conservarse.
              </Text>
              <Lozenge appearance="success">Vista activa</Lozenge>
            </>
          ) : (
            <>
              <Text>
                Estas decisiones están archivadas. Puedes restaurarlas
                o eliminarlas definitivamente.
              </Text>
              <Lozenge appearance="default">Archivo histórico</Lozenge>
            </>
          )}

          {/* CARGA */}
          {isCurrentLoading && (
            <Inline alignBlock="center" space="space.100">
              <Spinner size="medium" />
              <Text>Cargando decisiones...</Text>
            </Inline>
          )}

          {/* LISTA VACÍA */}
          {!isCurrentLoading && filteredCandidates.length === 0 && (
            <SectionMessage appearance="information">
              <Text>
                {activeView === 'archived'
                  ? 'Todavía no hay decisiones archivadas.'
                  : reviewFilter === 'all'
                    ? 'No hay decisiones activas. Importa una minuta o registra una decisión manualmente.'
                    : 'No hay decisiones que coincidan con este filtro.'}
              </Text>
            </SectionMessage>
          )}

          {/* TARJETAS */}
          {!isCurrentLoading && paginatedCandidates.map((candidate) => {
            const isPending =
              candidate.review_status === 'Pendiente de revisión';

            const isUpdating = updating === candidate.id;
            const isConfirmingDelete = confirmDeleteId === candidate.id;
            const isEditing = editingCandidateId === candidate.id;
            const isManual = candidate.source_type === 'manual';

            return (
              <Box
                key={candidate.id}
                padding="space.300"
                backgroundColor="elevation.surface"
                borderColor="color.border.accent"
                borderWidth="border.width"
                borderRadius="large"
              >
                <Stack space="space.300">

                  {/* TÍTULO Y ESTADOS */}
                  <Stack space="space.100">
                    <Heading size="medium">{candidate.title}</Heading>

                    <Inline space="space.100" shouldWrap>
                      <Lozenge appearance={getReviewAppearance(candidate.review_status)}>
                        {candidate.review_status}
                      </Lozenge>

                      <Lozenge appearance={getDecisionAppearance(candidate.status)}>
                        {candidate.status}
                      </Lozenge>

                      <Lozenge appearance={isManual ? 'inprogress' : 'default'}>
                        {isManual ? 'Registro manual' : 'Minuta Markdown'}
                      </Lozenge>

                      {activeView === 'archived' && (
                        <Lozenge appearance="default">Archivada</Lozenge>
                      )}
                    </Inline>
                  </Stack>

                  {/* FORMULARIO DE EDICIÓN */}
                  {isEditing && activeView === 'active' ? (
                    <Box
                      padding="space.200"
                      backgroundColor="elevation.surface.sunken"
                      borderRadius="medium"
                    >
                      <Stack space="space.200">
                        <Heading size="medium">Editar decisión</Heading>

                        <Stack space="space.100">
                          <Text weight="semibold">Título</Text>
                          <Textfield
                            value={editForm.title}
                            onChange={(event) =>
                              handleEditField('title', event.target.value)
                            }
                            isDisabled={isUpdating}
                          />
                        </Stack>

                        <Stack space="space.100">
                          <Text weight="semibold">Decisión</Text>
                          <TextArea
                            value={editForm.decision}
                            onChange={(event) =>
                              handleEditField('decision', event.target.value)
                            }
                            minimumRows={4}
                            isDisabled={isUpdating}
                          />
                        </Stack>

                        <Stack space="space.100">
                          <Text weight="semibold">Contexto</Text>
                          <TextArea
                            value={editForm.context}
                            onChange={(event) =>
                              handleEditField('context', event.target.value)
                            }
                            minimumRows={3}
                            isDisabled={isUpdating}
                          />
                        </Stack>

                        <Stack space="space.100">
                          <Text weight="semibold">Área o trabajo</Text>
                          <Textfield
                            value={editForm.job}
                            onChange={(event) =>
                              handleEditField('job', event.target.value)
                            }
                            isDisabled={isUpdating}
                          />
                        </Stack>

                        <Stack space="space.100">
                          <Text weight="semibold">Responsable</Text>
                          <Textfield
                            value={editForm.decision_owner}
                            onChange={(event) =>
                              handleEditField('decision_owner', event.target.value)
                            }
                            isDisabled={isUpdating}
                          />
                        </Stack>

                        <Stack space="space.100">
                          <Text weight="semibold">Estado de la decisión</Text>
                          <Select
                            options={DECISION_STATUSES}
                            value={DECISION_STATUSES.find(
                              (option) => option.value === editForm.status
                            )}
                            onChange={(option) =>
                              handleEditField('status', option?.value ?? 'Propuesto')
                            }
                            isDisabled={isUpdating}
                          />
                        </Stack>

                        <Stack space="space.100">
                          <Text weight="semibold">Estado de revisión</Text>
                          <Select
                            options={REVIEW_STATUSES}
                            value={REVIEW_STATUSES.find(
                              (option) => option.value === editForm.review_status
                            )}
                            onChange={(option) =>
                              handleEditField(
                                'review_status',
                                option?.value ?? 'Pendiente de revisión'
                              )
                            }
                            isDisabled={isUpdating}
                          />
                        </Stack>

                        <Text size="small">
                          Puedes modificar tanto el estado de la decisión como
                          el estado de revisión humana. Son estados independientes.
                        </Text>

                        <Inline space="space.200" shouldWrap>
                          <Button
                            appearance="primary"
                            onClick={() => handleSaveEdit(candidate.id)}
                            isDisabled={updating !== null}
                          >
                            {isUpdating ? 'Guardando...' : 'Guardar cambios'}
                          </Button>

                          <Button
                            appearance="default"
                            onClick={handleCancelEdit}
                            isDisabled={updating !== null}
                          >
                            Cancelar
                          </Button>
                        </Inline>
                      </Stack>
                    </Box>
                  ) : (
                    <>
                      {/* METADATOS */}
                      <Box
                        padding="space.200"
                        backgroundColor="elevation.surface.sunken"
                        borderRadius="medium"
                      >
                        <Stack space="space.100">
                          <Text>
                            <Text weight="semibold" inline>Proyecto: </Text>
                            {candidate.job || 'No especificado'}
                          </Text>

                          <Text>
                            <Text weight="semibold" inline>Responsable: </Text>
                            {candidate.decision_owner || 'No especificado'}
                          </Text>

                          <Text>
                            <Text weight="semibold" inline>Fecha: </Text>
                            {candidate.meeting_date || 'No especificada'}
                          </Text>

                          {activeView === 'archived' && candidate.archived_at && (
                            <Text>
                              <Text weight="semibold" inline>Archivada el: </Text>
                              {String(candidate.archived_at)}
                            </Text>
                          )}
                        </Stack>
                      </Box>

                      {/* DECISIÓN */}
                      <Stack space="space.100">
                        <Heading size="small">Decisión</Heading>
                        <Text>{candidate.decision}</Text>
                      </Stack>

                      {/* CONTEXTO */}
                      {candidate.context && (
                        <Stack space="space.100">
                          <Heading size="small">Contexto</Heading>
                          <Text>{candidate.context}</Text>
                        </Stack>
                      )}

                      {/* FUENTE */}
                      <Stack space="space.100">
                        <Text size="small">
                          <Text weight="semibold" inline>Origen: </Text>
                          {isManual ? 'Registro manual' : 'Minuta Markdown'}
                        </Text>

                        {candidate.source_reference && (
                          <Text size="small">
                            <Text weight="semibold" inline>Referencia: </Text>
                            {candidate.source_reference}
                          </Text>
                        )}

                        {candidate.source_file && (
                          <Text size="small">
                            <Text weight="semibold" inline>Archivo: </Text>
                            {candidate.source_file}
                          </Text>
                        )}
                      </Stack>
                    </>
                  )}

                  {/* ACCIONES ACTIVAS */}
                  {activeView === 'active' && !isEditing && (
                    <Stack space="space.200">

                      {/* REVISIÓN HUMANA */}
                      <Box
                        padding="space.200"
                        backgroundColor="elevation.surface.sunken"
                        borderRadius="medium"
                      >
                        <Stack space="space.100">
                          <Heading size="small">Revisión humana</Heading>

                          {isPending ? (
                            <>
                              <Text size="small">
                                Validar confirma que el candidato merece continuar
                                en el flujo ADR. No aprueba la decisión técnica.
                              </Text>

                              <Inline space="space.200" shouldWrap>
                                <Button
                                  appearance="primary"
                                  onClick={() => handleReview(candidate.id, 'Validado')}
                                  isDisabled={updating !== null}
                                >
                                  {isUpdating ? 'Actualizando...' : 'Validar candidato'}
                                </Button>

                                <Button
                                  appearance="danger"
                                  onClick={() => handleReview(candidate.id, 'Descartado')}
                                  isDisabled={updating !== null}
                                >
                                  Descartar
                                </Button>
                              </Inline>
                            </>
                          ) : (
                            <Text size="small">
                              Revisión completada. Estado: {candidate.review_status}.
                            </Text>
                          )}
                        </Stack>
                      </Box>

                      {/* GESTIÓN DE LA DECISIÓN */}
                      <Box
                        padding="space.200"
                        backgroundColor="elevation.surface.sunken"
                        borderRadius="medium"
                      >
                        <Stack space="space.100">
                          <Heading size="small">Acciones</Heading>

                          <Inline space="space.200" shouldWrap>
                            <Button
                              appearance="primary"
                              onClick={() => handleStartEdit(candidate)}
                              isDisabled={updating !== null}
                            >
                              Editar
                            </Button>

                            <Button
                              appearance="warning"
                              onClick={() => handleArchive(candidate.id)}
                              isDisabled={updating !== null}
                            >
                              {isUpdating ? 'Procesando...' : 'Archivar'}
                            </Button>

                            <Button
                              appearance="danger"
                              onClick={() => setConfirmDeleteId(candidate.id)}
                              isDisabled={updating !== null}
                            >
                              Eliminar
                            </Button>
                          </Inline>
                        </Stack>
                      </Box>
                    </Stack>
                  )}

                  {/* ACCIONES ARCHIVADAS */}
                  {activeView === 'archived' && (
                    <Box
                      padding="space.200"
                      backgroundColor="elevation.surface.sunken"
                      borderRadius="medium"
                    >
                      <Stack space="space.100">
                        <Heading size="small">Acciones</Heading>

                        <Inline space="space.200" shouldWrap>
                          <Button
                            appearance="primary"
                            onClick={() => handleRestore(candidate.id)}
                            isDisabled={updating !== null}
                          >
                            {isUpdating ? 'Procesando...' : 'Restaurar'}
                          </Button>

                          <Button
                            appearance="danger"
                            onClick={() => setConfirmDeleteId(candidate.id)}
                            isDisabled={updating !== null}
                          >
                            Eliminar definitivamente
                          </Button>
                        </Inline>
                      </Stack>
                    </Box>
                  )}

                  {/* CONFIRMACIÓN DE ELIMINACIÓN */}
                  {isConfirmingDelete && (
                    <Box
                      padding="space.200"
                      backgroundColor="elevation.surface.sunken"
                      borderRadius="medium"
                    >
                      <Stack space="space.200">
                        <SectionMessage appearance="warning">
                          <Stack space="space.100">
                            <Text weight="semibold">
                              ¿Eliminar definitivamente esta decisión?
                            </Text>
                            <Text>
                              Esta acción borrará el registro de Forge SQL.
                              No podrás recuperarlo desde Minerva ADR.
                            </Text>
                          </Stack>
                        </SectionMessage>

                        <Inline space="space.200" shouldWrap>
                          <Button
                            appearance="danger"
                            onClick={() => handleDelete(candidate.id)}
                            isDisabled={updating !== null}
                          >
                            {isUpdating ? 'Eliminando...' : 'Sí, eliminar definitivamente'}
                          </Button>

                          <Button
                            appearance="default"
                            onClick={() => setConfirmDeleteId(null)}
                            isDisabled={updating !== null}
                          >
                            Cancelar
                          </Button>
                        </Inline>
                      </Stack>
                    </Box>
                  )}

                </Stack>
              </Box>
            );
          })}

          {/* PAGINACIÓN */}
          {!isCurrentLoading && filteredCandidates.length > 0 && (
            <Box
              padding="space.200"
              backgroundColor="elevation.surface"
              borderColor="color.border"
              borderWidth="border.width"
              borderRadius="medium"
            >
              <Stack space="space.200">
                <Text>
                  Mostrando {firstVisible}–{lastVisible} de {filteredCandidates.length} decisiones
                </Text>

                <Inline alignBlock="center" space="space.200" shouldWrap>
                  <Button
                    appearance="default"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    isDisabled={safePage <= 1}
                  >
                    Anterior
                  </Button>

                  <Text>
                    Página {safePage} de {totalPages}
                  </Text>

                  <Button
                    appearance="default"
                    onClick={() =>
                      setCurrentPage((page) => Math.min(totalPages, page + 1))
                    }
                    isDisabled={safePage >= totalPages}
                  >
                    Siguiente
                  </Button>
                </Inline>
              </Stack>
            </Box>
          )}

        </Stack>
      </Box>

    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
