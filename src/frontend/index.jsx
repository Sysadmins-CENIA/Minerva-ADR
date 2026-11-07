
import React, {
  useCallback,
  useEffect,
  useState,
} from 'react';

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

const REVIEW_STATUSES = [
  { label: 'Pendiente de revisión', value: 'Pendiente de revisión' },
  { label: 'Validado', value: 'Validado' },
  { label: 'Descartado', value: 'Descartado' },
];

const DECISION_STATUSES = [
  { label: 'Propuesto', value: 'Propuesto' },
  { label: 'En discusión', value: 'En discusión' },
  { label: 'Aprobada', value: 'Aprobada' },
  { label: 'Rechazada', value: 'Rechazada' },
  { label: 'Obsoleta', value: 'Obsoleta' },
];

const FILTERS = [
  { label: 'Todos', value: 'all' },
  { label: 'Pendientes', value: 'Pendiente de revisión' },
  { label: 'Validados', value: 'Validado' },
  { label: 'Descartados', value: 'Descartado' },
];

const EMPTY_FORM = {
  title: '',
  decision: '',
  context: '',
  job: '',
  decision_owner: '',
  meeting_date: '',
  source_reference: '',
};

const EMPTY_EDIT = {
  title: '',
  decision: '',
  context: '',
  job: '',
  decision_owner: '',
  status: 'Propuesto',
  review_status: 'Pendiente de revisión',
};

const errorMessage = (error) =>
  error?.message || 'Ocurrió un error desconocido.';

const reviewAppearance = (value) => {
  if (value === 'Validado') return 'success';
  if (value === 'Descartado') return 'removed';
  return 'inprogress';
};

const decisionAppearance = (value) => {
  if (value === 'Aprobada') return 'success';
  if (value === 'Rechazada') return 'removed';
  if (value === 'En discusión') return 'inprogress';
  return 'default';
};

const formatDate = (value) => {
  if (!value) return '';
  return String(value).slice(0, 10);
};

const Field = ({
  label,
  value,
  onChange,
  multiline = false,
  placeholder = '',
}) => (
  <Stack space="space.050">
    <Text weight="semibold">{label}</Text>
    {multiline ? (
      <TextArea
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    ) : (
      <Textfield
        value={value || ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    )}
  </Stack>
);

const App = () => {

  // ==========================================================
  // NAVEGACIÓN
  // ==========================================================

  const [view, setView] = useState('decisions');
  const [activeView, setActiveView] = useState('active');
  const [reviewFilter, setReviewFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [expandedId, setExpandedId] = useState(null);

  // ==========================================================
  // ESTADO GENERAL
  // ==========================================================

  const [candidates, setCandidates] = useState([]);
  const [archivedCandidates, setArchivedCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // ==========================================================
  // FORMULARIOS
  // ==========================================================

  const [selectedFile, setSelectedFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [manualForm, setManualForm] = useState(EMPTY_FORM);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  // ==========================================================
  // GOOGLE
  // ==========================================================

  const [googleAccount, setGoogleAccount] = useState(null);
  const [googleLoading, setGoogleLoading] = useState(true);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [googleError, setGoogleError] = useState(null);

  const [savedDriveFolder, setSavedDriveFolder] = useState(null);
  const [driveConfigLoading, setDriveConfigLoading] = useState(true);
  const [driveSaving, setDriveSaving] = useState(false);

  const [showDriveSettings, setShowDriveSettings] = useState(false);
  const [preferredFolders, setPreferredFolders] = useState([]);
  const [preferredLoading, setPreferredLoading] = useState(false);

  const [driveQuery, setDriveQuery] = useState('');
  const [driveMatches, setDriveMatches] = useState([]);
  const [driveSearching, setDriveSearching] = useState(false);

  const [selectedDriveFolder, setSelectedDriveFolder] = useState(null);
  const [drivePreview, setDrivePreview] = useState(null);
  const [drivePreviewLoading, setDrivePreviewLoading] = useState(false);
  const [driveError, setDriveError] = useState(null);
  const [driveNotice, setDriveNotice] = useState(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncError, setSyncError] = useState(null);

  // ==========================================================
  // CARGA DE CANDIDATOS
  // ==========================================================

  const refreshCandidates = useCallback(async () => {
    try {
      const [active, archived] = await Promise.all([
        invoke('getCandidates'),
        invoke('getArchivedCandidates'),
      ]);

      if (!active?.success || !archived?.success) {
        throw new Error('No se pudieron cargar las decisiones.');
      }

      setCandidates(active.candidates || []);
      setArchivedCandidates(archived.candidates || []);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // ==========================================================
  // GOOGLE - CARGA INICIAL
  // ==========================================================

  const loadGoogleAccount = useCallback(async () => {
    setGoogleLoading(true);

    try {
      const result = await invoke('getGoogleAccount');

      setGoogleAccount(
        result?.connected ? result.account : null
      );
      setGoogleError(null);
    } catch (err) {
      setGoogleAccount(null);
      setGoogleError(errorMessage(err));
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  const loadDriveConfig = useCallback(async () => {
    setDriveConfigLoading(true);

    try {
      const result = await invoke('getDriveFolderConfig');

      if (!result?.success) {
        throw new Error('No se pudo recuperar la configuración.');
      }

      const folder = result.configured
        ? result.folder
        : null;

      setSavedDriveFolder(folder);
      setSelectedDriveFolder((previous) => previous || folder);
    } catch (err) {
      setDriveError(errorMessage(err));
    } finally {
      setDriveConfigLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshCandidates();
    loadGoogleAccount();
    loadDriveConfig();
  }, [
    refreshCandidates,
    loadGoogleAccount,
    loadDriveConfig,
  ]);

  // ==========================================================
  // GOOGLE - ACCIONES
  // ==========================================================

  const handleConnectGoogle = async () => {
    setGoogleConnecting(true);
    setGoogleError(null);

    try {
      const result = await invoke('connectGoogle');

      if (result?.connected && result.account) {
        setGoogleAccount(result.account);
      } else {
        await loadGoogleAccount();
      }
    } catch (err) {
      if (err?.name === 'NEEDS_AUTHENTICATION_ERR') {
        throw err;
      }
      setGoogleError(errorMessage(err));
    } finally {
      setGoogleConnecting(false);
    }
  };

  const loadPreferredFolders = async () => {
    setPreferredLoading(true);
    setDriveError(null);

    try {
      const result = await invoke('getPreferredDriveFolders');

      if (!result?.success) {
        throw new Error('No se encontraron las carpetas.');
      }

      setPreferredFolders(result.folders || []);
    } catch (err) {
      setDriveError(errorMessage(err));
    } finally {
      setPreferredLoading(false);
    }
  };

  const handleToggleDriveSettings = () => {
    if (!showDriveSettings && googleAccount) {
      loadPreferredFolders();
    }

    setShowDriveSettings(!showDriveSettings);
  };

  const handleSearchFolders = async () => {
    const query = driveQuery.trim();

    if (query.length < 2) {
      setDriveError('Escribe al menos dos caracteres.');
      return;
    }

    setDriveSearching(true);
    setDriveMatches([]);
    setDriveError(null);

    try {
      const result = await invoke(
        'searchDriveFolders',
        { query }
      );

      if (!result?.success) {
        throw new Error('No se pudo buscar la carpeta.');
      }

      setDriveMatches(result.folders || []);
    } catch (err) {
      setDriveError(errorMessage(err));
    } finally {
      setDriveSearching(false);
    }
  };

  const handleSelectFolder = async (folder) => {
    setSelectedDriveFolder(folder);
    setDrivePreview(null);
    setDriveError(null);
    setDriveNotice(null);
    setDrivePreviewLoading(true);

    try {
      const result = await invoke(
        'previewDriveFolder',
        { folderId: folder.id }
      );

      if (!result?.success) {
        throw new Error('No se pudo explorar la carpeta.');
      }

      setDrivePreview(result);
    } catch (err) {
      setDriveError(errorMessage(err));
    } finally {
      setDrivePreviewLoading(false);
    }
  };

  const handleSaveFolder = async () => {
    if (!selectedDriveFolder?.id || !drivePreview) {
      setDriveError('Selecciona y explora una carpeta válida.');
      return;
    }

    setDriveSaving(true);
    setDriveError(null);
    setDriveNotice(null);

    try {
      const result = await invoke(
        'saveDriveFolderConfig',
        { folderId: selectedDriveFolder.id }
      );

      if (!result?.success || !result.folder) {
        throw new Error('No se pudo guardar la carpeta.');
      }

      setSavedDriveFolder(result.folder);
      setSelectedDriveFolder(result.folder);
      setDriveNotice('Carpeta guardada correctamente.');
    } catch (err) {
      setDriveError(errorMessage(err));
    } finally {
      setDriveSaving(false);
    }
  };


  // ==========================================================
  // GOOGLE DRIVE - SINCRONIZACIÓN MANUAL
  // ==========================================================

  const handleSyncDrive = async (reprocess = false) => {
    if (syncLoading || !savedDriveFolder) {
      return;
    }

    setSyncLoading(true);
    setSyncResult(null);
    setSyncError(null);
    setError(null);

    try {
      const result = await invoke('syncDriveMarkdown', {
        reprocess,
      });

      if (!result?.success) {
        throw new Error(
          'No fue posible completar la sincronización.'
        );
      }

      setSyncResult(result);
      await refreshCandidates();
    } catch (err) {
      setSyncError(errorMessage(err));
    } finally {
      setSyncLoading(false);
    }
  };


  // ==========================================================
  // IMPORTAR MARKDOWN
  // ==========================================================

  const handleFileChange = (files) => {
    const file = Array.isArray(files) ? files[0] : files;
    setSelectedFile(file || null);
    setImportResult(null);
  };

  const handleImport = async () => {
    if (!selectedFile) return;

    setBusy(true);
    setError(null);
    setImportResult(null);

    try {
      let data;

      if (typeof selectedFile === 'string') {
        data = selectedFile;
      } else {
        data = selectedFile.base64 || selectedFile.data;
      }

      if (!data) {
        throw new Error('No se pudo leer el archivo Markdown.');
      }

      const result = await invoke('processMarkdown', {
        data,
        sourceFile: selectedFile.name || 'minuta.md',
      });

      if (!result?.success) {
        throw new Error('No se pudo procesar la minuta.');
      }

      setImportResult(result);
      await refreshCandidates();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // ==========================================================
  // CREAR CANDIDATO
  // ==========================================================

  const handleCreateManual = async () => {
    if (
      !manualForm.title.trim() ||
      !manualForm.decision.trim()
    ) {
      setError('Título y decisión son obligatorios.');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await invoke(
        'createManualCandidate',
        manualForm
      );

      if (!result?.success) {
        throw new Error('No se pudo crear el candidato.');
      }

      setManualForm(EMPTY_FORM);
      setNotice('Candidato creado correctamente.');
      setView('decisions');
      await refreshCandidates();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // ==========================================================
  // REVISAR
  // ==========================================================

  const handleReview = async (id, reviewStatus) => {
    setBusy(true);
    setError(null);

    try {
      const result = await invoke(
        'updateReviewStatus',
        { id, reviewStatus }
      );

      if (!result?.success) {
        throw new Error('No se pudo actualizar la revisión.');
      }

      setNotice(`Decisión marcada como ${reviewStatus}.`);
      await refreshCandidates();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // ==========================================================
  // EDITAR
  // ==========================================================

  const handleStartEdit = (candidate) => {
    setExpandedId(candidate.id);
    setEditingId(candidate.id);

    setEditForm({
      title: candidate.title || '',
      decision: candidate.decision || '',
      context: candidate.context || '',
      job: candidate.job || '',
      decision_owner: candidate.decision_owner || '',
      status: candidate.status || 'Propuesto',
      review_status:
        candidate.review_status || 'Pendiente de revisión',
    });
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    setBusy(true);
    setError(null);

    try {
      const result = await invoke(
        'updateCandidate',
        { id: editingId, ...editForm }
      );

      if (!result?.success) {
        throw new Error('No se pudo actualizar la decisión.');
      }

      setEditingId(null);
      setEditForm(EMPTY_EDIT);
      setNotice('Decisión actualizada correctamente.');
      await refreshCandidates();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // ==========================================================
  // ARCHIVAR / RESTAURAR / ELIMINAR
  // ==========================================================

  const handleAction = async (resolverName, id, message) => {
    setBusy(true);
    setError(null);

    try {
      const result = await invoke(
        resolverName,
        { id }
      );

      if (!result?.success) {
        throw new Error('No se pudo completar la operación.');
      }

      setNotice(message);
      setConfirmDeleteId(null);
      setExpandedId(null);
      await refreshCandidates();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // ==========================================================
  // ESTADÍSTICAS Y PAGINACIÓN
  // ==========================================================

  const pendingCount = candidates.filter(
    (c) => c.review_status === 'Pendiente de revisión'
  ).length;

  const validatedCount = candidates.filter(
    (c) => c.review_status === 'Validado'
  ).length;

  const discardedCount = candidates.filter(
    (c) => c.review_status === 'Descartado'
  ).length;

  const sourceCandidates =
    activeView === 'active'
      ? candidates
      : archivedCandidates;

  const filteredCandidates = sourceCandidates.filter(
    (c) =>
      reviewFilter === 'all' ||
      c.review_status === reviewFilter
  );

  const totalPages = Math.max(
    1,
    Math.ceil(filteredCandidates.length / PAGE_SIZE)
  );

  const safePage = Math.min(currentPage, totalPages);

  const visibleCandidates = filteredCandidates.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  // ==========================================================
  // FORMULARIO DE EDICIÓN
  // ==========================================================

  const renderEditForm = () => (
    <Stack space="space.200">

      <Heading size="small">Editar decisión</Heading>

      <Field
        label="Título"
        value={editForm.title}
        onChange={(value) =>
          setEditForm((p) => ({ ...p, title: value }))
        }
      />

      <Field
        label="Decisión"
        value={editForm.decision}
        multiline
        onChange={(value) =>
          setEditForm((p) => ({ ...p, decision: value }))
        }
      />

      <Field
        label="Contexto"
        value={editForm.context}
        multiline
        onChange={(value) =>
          setEditForm((p) => ({ ...p, context: value }))
        }
      />

      <Field
        label="Proyecto"
        value={editForm.job}
        onChange={(value) =>
          setEditForm((p) => ({ ...p, job: value }))
        }
      />

      <Field
        label="Responsable"
        value={editForm.decision_owner}
        onChange={(value) =>
          setEditForm((p) => ({
            ...p,
            decision_owner: value,
          }))
        }
      />

      <Stack space="space.050">
        <Text weight="semibold">Estado de decisión</Text>
        <Select
          options={DECISION_STATUSES}
          value={
            DECISION_STATUSES.find(
              (o) => o.value === editForm.status
            ) || DECISION_STATUSES[0]
          }
          onChange={(option) =>
            setEditForm((p) => ({
              ...p,
              status: option?.value || 'Propuesto',
            }))
          }
        />
      </Stack>

      <Stack space="space.050">
        <Text weight="semibold">Estado de revisión</Text>
        <Select
          options={REVIEW_STATUSES}
          value={
            REVIEW_STATUSES.find(
              (o) => o.value === editForm.review_status
            ) || REVIEW_STATUSES[0]
          }
          onChange={(option) =>
            setEditForm((p) => ({
              ...p,
              review_status:
                option?.value || 'Pendiente de revisión',
            }))
          }
        />
      </Stack>

      <Inline space="space.100">
        <Button
          appearance="primary"
          isDisabled={busy}
          onClick={handleSaveEdit}
        >
          Guardar cambios
        </Button>

        <Button
          appearance="subtle"
          onClick={() => setEditingId(null)}
        >
          Cancelar
        </Button>
      </Inline>

    </Stack>
  );

  // ==========================================================
  // TARJETA ADR COMPACTA
  // ==========================================================


  // ==========================================================
  // TARJETA ADR - DISEÑO CON CONTENEDORES Y COLORES
  // ==========================================================


  // ==========================================================
  // TARJETA ADR - DISEÑO DE ALTO CONTRASTE
  // ==========================================================

  const renderCandidate = (candidate) => {
    const expanded = expandedId === candidate.id;
    const editing = editingId === candidate.id;
    const archived = activeView === 'archived';

    const isValidated =
      candidate.review_status === 'Validado';

    const isDiscarded =
      candidate.review_status === 'Descartado';

    return (
      <Box
        key={candidate.id}
        padding="space.400"
        backgroundColor="color.background.neutral"
        borderRadius="large"
      >
        <Stack space="space.300">

          {/* ================================================ */}
          {/* CABECERA */}
          {/* ================================================ */}

          <Stack space="space.150">

            <Heading size="medium">
              {candidate.title || 'Sin título'}
            </Heading>

            <Inline space="space.100" shouldWrap>

              <Lozenge
                appearance={reviewAppearance(
                  candidate.review_status
                )}
              >
                {candidate.review_status ||
                  'Pendiente de revisión'}
              </Lozenge>

              <Lozenge
                appearance={decisionAppearance(
                  candidate.status
                )}
              >
                {candidate.status || 'Propuesto'}
              </Lozenge>

              {archived && (
                <Lozenge appearance="default">
                  Archivada
                </Lozenge>
              )}

            </Inline>

          </Stack>

          {/* ================================================ */}
          {/* METADATOS */}
          {/* ================================================ */}

          <Box
            padding="space.200"
            backgroundColor="elevation.surface.raised"
            borderRadius="medium"
          >
            <Inline space="space.300" shouldWrap>

              {candidate.job && (
                <Text size="small">
                  Proyecto: {candidate.job}
                </Text>
              )}

              {candidate.decision_owner && (
                <Text size="small">
                  Responsable: {candidate.decision_owner}
                </Text>
              )}

              {candidate.meeting_date && (
                <Text size="small">
                  Fecha: {formatDate(candidate.meeting_date)}
                </Text>
              )}

            </Inline>
          </Box>

          
          {/* ORIGEN DE LA DECISIÓN */}

          {(candidate.source_reference ||
            candidate.source_file) && (
            <Box
              padding="space.150"
              backgroundColor="elevation.surface.raised"
              borderRadius="medium"
            >
              <Stack space="space.050">
                <Text weight="semibold" size="small">
                  Origen de la minuta
                </Text>

                <Text size="small">
                  {candidate.source_reference ||
                    candidate.source_file}
                </Text>
              </Stack>
            </Box>
          )}


          {/* ================================================ */}
          {/* RESUMEN */}
          {/* ================================================ */}

          {!expanded && (
            <Stack space="space.100">

              <Text weight="semibold">
                Resumen de la decisión
              </Text>

              <Text>
                {candidate.decision
                  ? candidate.decision.length > 200
                    ? `${candidate.decision.slice(0, 200)}...`
                    : candidate.decision
                  : 'Sin descripción'}
              </Text>

            </Stack>
          )}

          {/* ================================================ */}
          {/* ACCIONES PRINCIPALES */}
          {/* ================================================ */}

          <Inline
            space="space.100"
            alignBlock="center"
            shouldWrap
          >

            {/* AZUL - VER DETALLES */}

            <Button
              appearance="primary"
              onClick={() => {
                setExpandedId(
                  expanded ? null : candidate.id
                );

                if (expanded) {
                  setEditingId(null);
                  setConfirmDeleteId(null);
                }
              }}
            >
              {expanded
                ? 'Ocultar detalles'
                : 'Ver detalles'}
            </Button>

            {/* VERDE - VALIDAR */}

            {!archived && !isValidated && (
              <Box
                backgroundColor="color.background.success"
                borderRadius="medium"
              >
                <Button
                  appearance="subtle"
                  isDisabled={busy}
                  onClick={() =>
                    handleReview(
                      candidate.id,
                      'Validado'
                    )
                  }
                >
                  Validar
                </Button>
              </Box>
            )}

            {/* AMARILLO - DESCARTAR */}

            {!archived && !isDiscarded && (
              <Box
                backgroundColor="color.background.warning"
                borderRadius="medium"
              >
                <Button
                  appearance="subtle"
                  isDisabled={busy}
                  onClick={() =>
                    handleReview(
                      candidate.id,
                      'Descartado'
                    )
                  }
                >
                  Descartar
                </Button>
              </Box>
            )}

          </Inline>

          {/* ================================================ */}
          {/* CONTENIDO EXPANDIDO */}
          {/* ================================================ */}

          {expanded && (
            <Stack space="space.300">

              {editing ? (

                <Box
                  padding="space.300"
                  backgroundColor="elevation.surface.raised"
                  borderRadius="medium"
                >
                  {renderEditForm()}
                </Box>

              ) : (

                <Stack space="space.300">

                  {/* DECISIÓN */}

                  <Box
                    padding="space.300"
                    backgroundColor="elevation.surface.raised"
                    borderRadius="medium"
                  >
                    <Stack space="space.100">

                      <Heading size="small">
                        Decisión
                      </Heading>

                      <Text>
                        {candidate.decision ||
                          'Sin descripción'}
                      </Text>

                    </Stack>
                  </Box>

                  {/* CONTEXTO */}

                  {candidate.context && (
                    <Box
                      padding="space.300"
                      backgroundColor="elevation.surface.raised"
                      borderRadius="medium"
                    >
                      <Stack space="space.100">

                        <Heading size="small">
                          Contexto
                        </Heading>

                        <Text>
                          {candidate.context}
                        </Text>

                      </Stack>
                    </Box>
                  )}

                  {/* ORIGEN */}

                  {(candidate.source_file ||
                    candidate.source_reference) && (
                    <Box
                      padding="space.200"
                      backgroundColor="elevation.surface.raised"
                      borderRadius="medium"
                    >
                      <Stack space="space.050">

                        <Text weight="semibold">
                          Origen
                        </Text>

                        <Text size="small">
                          {candidate.source_file ||
                            candidate.source_reference}
                        </Text>

                      </Stack>
                    </Box>
                  )}

                  {/* ====================================== */}
                  {/* ACCIONES SECUNDARIAS */}
                  {/* ====================================== */}

                  <Inline
                    space="space.100"
                    alignBlock="center"
                    shouldWrap
                  >

                    {!archived ? (
                      <>

                        {/* EDITAR - AZUL */}

                        <Box
                          backgroundColor="color.background.information"
                          borderRadius="medium"
                        >
                          <Button
                            appearance="subtle"
                            isDisabled={busy}
                            onClick={() =>
                              handleStartEdit(candidate)
                            }
                          >
                            Editar
                          </Button>
                        </Box>

                        {/* ARCHIVAR - GRIS */}

                        <Box
                          backgroundColor="color.background.neutral"
                          borderRadius="medium"
                        >
                          <Button
                            appearance="subtle"
                            isDisabled={busy}
                            onClick={() =>
                              handleAction(
                                'archiveCandidate',
                                candidate.id,
                                'Candidato archivado.'
                              )
                            }
                          >
                            Archivar
                          </Button>
                        </Box>

                      </>
                    ) : (

                      /* RESTAURAR - VERDE */

                      <Box
                        backgroundColor="color.background.success"
                        borderRadius="medium"
                      >
                        <Button
                          appearance="subtle"
                          isDisabled={busy}
                          onClick={() =>
                            handleAction(
                              'restoreCandidate',
                              candidate.id,
                              'Candidato restaurado.'
                            )
                          }
                        >
                          Restaurar
                        </Button>
                      </Box>

                    )}

                  </Inline>

                  {/* ====================================== */}
                  {/* ELIMINACIÓN */}
                  {/* ====================================== */}

                  {confirmDeleteId === candidate.id ? (

                    <Box
                      padding="space.300"
                      backgroundColor="color.background.danger"
                      borderRadius="medium"
                    >
                      <Stack space="space.200">

                        <Text weight="semibold">
                          Confirmar eliminación
                        </Text>

                        <Text>
                          Esta decisión será eliminada
                          permanentemente de la base de datos.
                          Esta acción no se puede deshacer.
                        </Text>

                        <Inline
                          space="space.100"
                          shouldWrap
                        >

                          <Button
                            appearance="danger"
                            isDisabled={busy}
                            onClick={() =>
                              handleAction(
                                'deleteCandidate',
                                candidate.id,
                                'Candidato eliminado.'
                              )
                            }
                          >
                            Eliminar definitivamente
                          </Button>

                          <Button
                            appearance="default"
                            onClick={() =>
                              setConfirmDeleteId(null)
                            }
                          >
                            Cancelar
                          </Button>

                        </Inline>

                      </Stack>
                    </Box>

                  ) : (

                    <Inline space="space.100">

                      {/* ELIMINAR - ROJO */}

                      <Button
                        appearance="danger"
                        isDisabled={busy}
                        onClick={() =>
                          setConfirmDeleteId(candidate.id)
                        }
                      >
                        Eliminar
                      </Button>

                    </Inline>

                  )}

                </Stack>

              )}

            </Stack>
          )}

        </Stack>
      </Box>
    );
  };

  // ==========================================================
  // VISTA: DECISIONES
  // ==========================================================

  const renderDecisions = () => (
    <Stack space="space.300">

      <Inline
        space="space.200"
        alignBlock="center"
        shouldWrap
      >
        <Heading size="medium">
          Decisiones arquitectónicas
        </Heading>

        <Button
          appearance="subtle"
          isDisabled={busy}
          onClick={refreshCandidates}
        >
          Actualizar
        </Button>
      </Inline>

      {/* INDICADORES */}

      <Inline space="space.200" shouldWrap>
        <Lozenge appearance="default">
          Total: {candidates.length}
        </Lozenge>

        <Lozenge appearance="inprogress">
          Pendientes: {pendingCount}
        </Lozenge>

        <Lozenge appearance="success">
          Validadas: {validatedCount}
        </Lozenge>

        <Lozenge appearance="removed">
          Descartadas: {discardedCount}
        </Lozenge>
      </Inline>

      {/* ACTIVAS / ARCHIVADAS */}

      <Inline space="space.100">
        <Button
          appearance={
            activeView === 'active' ? 'primary' : 'default'
          }
          onClick={() => {
            setActiveView('active');
            setCurrentPage(1);
            setExpandedId(null);
            setEditingId(null);
          }}
        >
          Activas ({candidates.length})
        </Button>

        <Button
          appearance={
            activeView === 'archived' ? 'primary' : 'default'
          }
          onClick={() => {
            setActiveView('archived');
            setCurrentPage(1);
            setExpandedId(null);
            setEditingId(null);
          }}
        >
          Archivadas ({archivedCandidates.length})
        </Button>
      </Inline>

      {/* FILTRO */}

      <Stack space="space.050">
        <Text weight="semibold">Estado de revisión</Text>
        <Select
          options={FILTERS}
          value={
            FILTERS.find((o) => o.value === reviewFilter) ||
            FILTERS[0]
          }
          onChange={(option) => {
            setReviewFilter(option?.value || 'all');
            setCurrentPage(1);
          }}
        />
      </Stack>

      {/* LISTADO */}

      {loading ? (
        <Spinner size="medium" />
      ) : visibleCandidates.length === 0 ? (
        <SectionMessage appearance="information">
          <Text>
            No hay decisiones que coincidan con este filtro.
          </Text>
        </SectionMessage>
      ) : (
        <Stack space="space.200">
          {visibleCandidates.map(renderCandidate)}
        </Stack>
      )}

      {/* PAGINACIÓN */}

      <Inline
        space="space.200"
        alignBlock="center"
        shouldWrap
      >
        <Button
          isDisabled={safePage <= 1}
          onClick={() => setCurrentPage(safePage - 1)}
        >
          Anterior
        </Button>

        <Text>
          Página {safePage} de {totalPages}
        </Text>

        <Button
          isDisabled={safePage >= totalPages}
          onClick={() => setCurrentPage(safePage + 1)}
        >
          Siguiente
        </Button>
      </Inline>

      <Text size="small">
        Mostrando {visibleCandidates.length} de{' '}
        {filteredCandidates.length} decisiones.
      </Text>

    </Stack>
  );

  // ==========================================================
  // VISTA: INCORPORAR
  // ==========================================================

  const renderImport = () => (
    <Stack space="space.400">

      <Heading size="medium">
        Incorporar decisiones
      </Heading>

      <Text>
        Importa una minuta Markdown o registra una decisión
        manualmente.
      </Text>

      {/* IMPORTACIÓN */}

      <Box
        padding="space.300"
        backgroundColor="elevation.surface.raised"
        borderRadius="medium"
      >
        <Stack space="space.200">

          <Heading size="small">
            Importar minuta Markdown
          </Heading>

          <Text>
            Selecciona un archivo .md para extraer
            automáticamente candidatos ADR.
          </Text>

          <FilePicker
            onChange={handleFileChange}
            accept=".md,text/markdown,text/plain"
          />

          {selectedFile && (
            <Text size="small">
              {selectedFile.name || 'Archivo seleccionado'}
            </Text>
          )}

          <Inline space="space.100">
            <Button
              appearance="primary"
              isDisabled={!selectedFile || busy}
              onClick={handleImport}
            >
              Procesar minuta
            </Button>
          </Inline>

          {importResult && (
            <SectionMessage appearance="success">
              <Stack space="space.050">
                <Text>Minuta procesada correctamente.</Text>
                <Text>
                  Candidatos: {importResult.total_candidates}
                </Text>
                <Text>
                  Nuevos: {importResult.inserted}
                </Text>
                <Text>
                  Duplicados: {importResult.duplicates}
                </Text>
              </Stack>
            </SectionMessage>
          )}

        </Stack>
      </Box>

      {/* CREACIÓN MANUAL */}

      <Box
        padding="space.300"
        backgroundColor="elevation.surface.raised"
        borderRadius="medium"
      >
        <Stack space="space.200">

          <Heading size="small">
            Crear candidato manual
          </Heading>

          <Field
            label="Título"
            value={manualForm.title}
            onChange={(value) =>
              setManualForm((p) => ({ ...p, title: value }))
            }
          />

          <Field
            label="Decisión"
            multiline
            value={manualForm.decision}
            onChange={(value) =>
              setManualForm((p) => ({ ...p, decision: value }))
            }
          />

          <Field
            label="Contexto"
            multiline
            value={manualForm.context}
            onChange={(value) =>
              setManualForm((p) => ({ ...p, context: value }))
            }
          />

          <Field
            label="Proyecto"
            value={manualForm.job}
            onChange={(value) =>
              setManualForm((p) => ({ ...p, job: value }))
            }
          />

          <Field
            label="Responsable"
            value={manualForm.decision_owner}
            onChange={(value) =>
              setManualForm((p) => ({
                ...p,
                decision_owner: value,
              }))
            }
          />

          <Field
            label="Fecha (YYYY-MM-DD)"
            value={manualForm.meeting_date}
            onChange={(value) =>
              setManualForm((p) => ({
                ...p,
                meeting_date: value,
              }))
            }
          />

          <Field
            label="Referencia de origen"
            value={manualForm.source_reference}
            onChange={(value) =>
              setManualForm((p) => ({
                ...p,
                source_reference: value,
              }))
            }
          />

          <Inline space="space.100">
            <Button
              appearance="primary"
              isDisabled={busy}
              onClick={handleCreateManual}
            >
              Crear candidato
            </Button>

            <Button
              appearance="subtle"
              onClick={() => setManualForm(EMPTY_FORM)}
            >
              Limpiar formulario
            </Button>
          </Inline>

        </Stack>
      </Box>

    </Stack>
  );

  // ==========================================================
  // VISTA: CONFIGURACIÓN
  // ==========================================================

  const renderSettings = () => (
    <Stack space="space.300">

      <Heading size="medium">
        Configuración
      </Heading>

      <Box
        padding="space.300"
        backgroundColor="elevation.surface.raised"
        borderRadius="medium"
      >
        <Stack space="space.300">

          <Heading size="small">
            Fuente de minutas
          </Heading>

          {googleLoading || driveConfigLoading ? (
            <Inline space="space.100" alignBlock="center">
              <Spinner size="small" />
              <Text>Cargando configuración...</Text>
            </Inline>
          ) : (
            <Stack space="space.200">

              {/* ESTADO DE CONEXIÓN */}

              <Inline
                space="space.100"
                alignBlock="center"
                shouldWrap
              >
                <Lozenge
                  appearance={
                    googleAccount ? 'success' : 'default'
                  }
                >
                  {googleAccount
                    ? 'Conectado'
                    : 'Desconectado'}
                </Lozenge>

                <Text>
                  {googleAccount?.displayName ||
                    'Google Drive'}
                </Text>
              </Inline>

              {!googleAccount ? (
                <Button
                  appearance="primary"
                  isDisabled={googleConnecting}
                  onClick={handleConnectGoogle}
                >
                  {googleConnecting
                    ? 'Conectando...'
                    : 'Conectar Google Drive'}
                </Button>
              ) : (
                <Stack space="space.200">

                  {/* CARPETA CONFIGURADA */}

                  <Box
                    padding="space.200"
                    backgroundColor="elevation.surface.sunken"
                    borderRadius="medium"
                  >
                    <Stack space="space.100">
                      <Text weight="semibold">
                        Carpeta activa
                      </Text>

                      {savedDriveFolder ? (
                        <Inline
                          space="space.100"
                          alignBlock="center"
                        >
                          <Lozenge appearance="success">
                            Guardada
                          </Lozenge>

                          <Text>{savedDriveFolder.name}</Text>
                        </Inline>
                      ) : (
                        <Text>
                          No hay una carpeta configurada.
                        </Text>
                      )}
                    </Stack>
                  </Box>

                  <Inline space="space.100">
                    <Button
                      appearance="subtle"
                      onClick={handleToggleDriveSettings}
                    >
                      {showDriveSettings
                        ? 'Ocultar configuración'
                        : 'Cambiar carpeta'}
                    </Button>
                  </Inline>


                    {/* ================================================ */}
                    {/* SINCRONIZACIÓN DE MINUTAS */}
                    {/* ================================================ */}

                    <Box
                      padding="space.300"
                      backgroundColor="color.background.neutral"
                      borderRadius="medium"
                    >
                      <Stack space="space.200">

                        <Heading size="small">
                          Sincronización de minutas
                        </Heading>

                        <Text>
                          Importa los archivos Markdown nuevos o
                          modificados de la carpeta configurada.
                        </Text>

                        <Inline
                          space="space.100"
                          alignBlock="center"
                          shouldWrap
                        >
                          <Button
                            appearance="primary"
                            isDisabled={
                              syncLoading ||
                              !savedDriveFolder ||
                              driveSaving
                            }
                            onClick={() => handleSyncDrive(false)}
                          >
                            {syncLoading
                              ? 'Sincronizando...'
                              : 'Sincronizar ahora'}
                          </Button>

                          <Button
                            appearance="default"
                            isDisabled={
                              syncLoading ||
                              !savedDriveFolder ||
                              driveSaving
                            }
                            onClick={() => handleSyncDrive(true)}
                          >
                            Reprocesar archivos
                          </Button>

                          {syncLoading && (
                            <Spinner size="small" />
                          )}
                        </Inline>

                        {syncLoading && (
                          <Text size="small">
                            Revisando carpetas, descargando minutas
                            y extrayendo decisiones...
                          </Text>
                        )}

                        {/* RESULTADO */}

                        {syncResult && (
                          <SectionMessage
                            appearance={
                              syncResult.errors?.length > 0
                                ? 'warning'
                                : 'success'
                            }
                          >
                            <Stack space="space.150">

                              <Text weight="semibold">
                                Sincronización finalizada
                              </Text>

                              <Text>
                                Carpeta: {syncResult.folder}
                              </Text>

                              <Inline space="space.100" shouldWrap>
                                <Lozenge appearance="default">
                                  Carpetas: {syncResult.foldersScanned}
                                </Lozenge>

                                <Lozenge appearance="default">
                                  Procesados: {syncResult.filesProcessed}
                                </Lozenge>

                                <Lozenge appearance="success">
                                  Nuevos ADR: {syncResult.inserted}
                                </Lozenge>

                                <Lozenge appearance="default">
                                  Duplicados: {syncResult.duplicates}
                                </Lozenge>
                              </Inline>

                              <Text size="small">
                                Archivos sin cambios: {syncResult.filesUnchanged}
                              </Text>

                              <Text size="small">
                                Candidatos detectados: {syncResult.candidatesFound}
                              </Text>

                              {syncResult.truncated && (
                                <Text>
                                  La exploración alcanzó un límite.
                                  Puedes repetir la sincronización
                                  para continuar revisando los archivos.
                                </Text>
                              )}

                              {syncResult.errors?.length > 0 && (
                                <Stack space="space.100">

                                  <Text weight="semibold">
                                    Errores ({syncResult.errors.length})
                                  </Text>

                                  {syncResult.errors.map((item, index) => (
                                    <Box
                                      key={`${item.file}-${index}`}
                                      padding="space.100"
                                      backgroundColor="elevation.surface.raised"
                                      borderRadius="small"
                                    >
                                      <Stack space="space.050">
                                        <Text weight="semibold">
                                          {item.file}
                                        </Text>
                                        <Text size="small">
                                          {item.message}
                                        </Text>
                                      </Stack>
                                    </Box>
                                  ))}

                                </Stack>
                              )}

                            </Stack>
                          </SectionMessage>
                        )}

                        {syncError && (
                          <SectionMessage appearance="error">
                            <Text>{syncError}</Text>
                          </SectionMessage>
                        )}

                      </Stack>
                    </Box>

                  {/* CONFIGURACIÓN EXPANDIDA */}

                  {showDriveSettings && (
                    <Stack space="space.300">

                      <Heading size="small">
                        Seleccionar carpeta
                      </Heading>

                      {/* CARPETAS RECOMENDADAS */}

                      {preferredLoading ? (
                        <Spinner size="small" />
                      ) : (
                        <Stack space="space.100">

                          <Text weight="semibold">
                            Carpetas recomendadas
                          </Text>

                          {preferredFolders.length > 0 ? (
                            <Inline
                              space="space.100"
                              shouldWrap
                            >
                              {preferredFolders.map((folder) => (
                                <Button
                                  key={folder.id}
                                  appearance={
                                    selectedDriveFolder?.id === folder.id
                                      ? 'primary'
                                      : 'default'
                                  }
                                  isDisabled={drivePreviewLoading}
                                  onClick={() =>
                                    handleSelectFolder(folder)
                                  }
                                >
                                  {folder.name}
                                </Button>
                              ))}
                            </Inline>
                          ) : (
                            <Text size="small">
                              No se encontraron carpetas Minerva.
                            </Text>
                          )}

                        </Stack>
                      )}

                      {/* BUSCADOR */}

                      <Stack space="space.100">
                        <Text weight="semibold">
                          Buscar otra carpeta
                        </Text>

                        <Textfield
                          value={driveQuery}
                          placeholder="Nombre de la carpeta"
                          onChange={(event) =>
                            setDriveQuery(event.target.value)
                          }
                        />

                        <Inline space="space.100">
                          <Button
                            isDisabled={
                              driveSearching ||
                              driveQuery.trim().length < 2
                            }
                            onClick={handleSearchFolders}
                          >
                            {driveSearching
                              ? 'Buscando...'
                              : 'Buscar'}
                          </Button>
                        </Inline>

                        {driveMatches.map((folder) => (
                          <Inline
                            key={folder.id}
                            space="space.100"
                            alignBlock="center"
                          >
                            <Button
                              appearance={
                                selectedDriveFolder?.id === folder.id
                                  ? 'primary'
                                  : 'default'
                              }
                              onClick={() =>
                                handleSelectFolder(folder)
                              }
                            >
                              {folder.name}
                            </Button>
                          </Inline>
                        ))}
                      </Stack>

                      {/* VISTA PREVIA */}

                      {selectedDriveFolder && (
                        <Box
                          padding="space.200"
                          backgroundColor="elevation.surface.sunken"
                          borderRadius="medium"
                        >
                          <Stack space="space.200">

                            <Text weight="semibold">
                              {selectedDriveFolder.name}
                            </Text>

                            {drivePreviewLoading && (
                              <Inline space="space.100">
                                <Spinner size="small" />
                                <Text>
                                  Explorando archivos...
                                </Text>
                              </Inline>
                            )}

                            {drivePreview && (
                              <Stack space="space.100">

                                <Inline space="space.100">
                                  <Lozenge appearance="default">
                                    {drivePreview.foldersScanned} carpetas
                                  </Lozenge>

                                  <Lozenge appearance="success">
                                    {drivePreview.totalMarkdown} Markdown
                                  </Lozenge>
                                </Inline>

                                {drivePreview.truncated && (
                                  <SectionMessage appearance="warning">
                                    <Text>
                                      La exploración es parcial.
                                    </Text>
                                  </SectionMessage>
                                )}

                                {drivePreview.files?.map((file) => (
                                  <Text key={file.id} size="small">
                                    {file.path}
                                  </Text>
                                ))}

                              </Stack>
                            )}

                            <Button
                              appearance="primary"
                              isDisabled={
                                driveSaving ||
                                drivePreviewLoading ||
                                !drivePreview ||
                                selectedDriveFolder.id ===
                                  savedDriveFolder?.id
                              }
                              onClick={handleSaveFolder}
                            >
                              {driveSaving
                                ? 'Guardando...'
                                : selectedDriveFolder.id ===
                                    savedDriveFolder?.id
                                  ? 'Carpeta guardada'
                                  : 'Guardar esta carpeta'}
                            </Button>

                          </Stack>
                        </Box>
                      )}

                    </Stack>
                  )}

                  {driveNotice && (
                    <SectionMessage appearance="success">
                      <Text>{driveNotice}</Text>
                    </SectionMessage>
                  )}

                  {driveError && (
                    <SectionMessage appearance="error">
                      <Text>{driveError}</Text>
                    </SectionMessage>
                  )}

                </Stack>
              )}

              {googleError && (
                <SectionMessage appearance="error">
                  <Text>{googleError}</Text>
                </SectionMessage>
              )}

            </Stack>
          )}

        </Stack>
      </Box>

    </Stack>
  );

  // ==========================================================
  // INTERFAZ PRINCIPAL
  // ==========================================================

  return (
    <Box padding="space.400">
      <Stack space="space.400">

        {/* CABECERA */}

        <Stack space="space.100">
          <Heading size="large">Minerva ADR</Heading>
          <Text>
            Gestión de decisiones arquitectónicas
            extraídas desde minutas de reuniones.
          </Text>
        </Stack>

        {/* NAVEGACIÓN */}

        <Inline space="space.100" shouldWrap>

          <Button
            appearance={
              view === 'decisions' ? 'primary' : 'default'
            }
            onClick={() => setView('decisions')}
          >
            Decisiones
          </Button>

          <Button
            appearance={
              view === 'import' ? 'primary' : 'default'
            }
            onClick={() => setView('import')}
          >
            Incorporar
          </Button>

          <Button
            appearance={
              view === 'settings' ? 'primary' : 'default'
            }
            onClick={() => setView('settings')}
          >
            Configuración
          </Button>

        </Inline>

        {/* MENSAJES */}

        {error && (
          <SectionMessage appearance="error">
            <Inline space="space.100" shouldWrap>
              <Text>{error}</Text>
              <Button
                appearance="subtle"
                onClick={() => setError(null)}
              >
                Cerrar
              </Button>
            </Inline>
          </SectionMessage>
        )}

        {notice && (
          <SectionMessage appearance="success">
            <Inline space="space.100" shouldWrap>
              <Text>{notice}</Text>
              <Button
                appearance="subtle"
                onClick={() => setNotice(null)}
              >
                Cerrar
              </Button>
            </Inline>
          </SectionMessage>
        )}

        {/* CONTENIDO */}

        {view === 'decisions' && renderDecisions()}
        {view === 'import' && renderImport()}
        {view === 'settings' && renderSettings()}

      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
