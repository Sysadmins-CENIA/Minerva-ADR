import React, { useCallback, useEffect, useState } from 'react';

import ForgeReconciler, {
  useProductContext,
  Box,
  Button,
  Checkbox,
  DatePicker,
  DynamicTable,
  EmptyState,
  FilePicker,
  Heading,
  Inline,
  LoadingButton,
  Lozenge,
  Modal,
  Pressable,
  ModalBody,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTransition,
  SectionMessage,
  Select,
  Spinner,
  Stack,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  TextArea,
  Textfield,
  xcss,
} from '@forge/react';

import { invoke, showFlag } from '@forge/bridge';
import writeExcelFile from 'write-excel-file/browser';

import {
  REVIEW,
  TABS,
  EXPORT_COLUMNS,
  countByTab,
  exportRows,
  filterDecisions,
  formatDate,
  toggleAll,
  toggleId,
} from './decisions.js';

// ============================================================
// CONSTANTES
// ============================================================

const PAGE_SIZE = 10;

const REVIEW_OPTIONS = Object.values(REVIEW).map((v) => ({ label: v, value: v }));

const DECISION_STATUSES = ['Propuesto', 'En discusión', 'Aprobada', 'Rechazada', 'Obsoleta']
  .map((v) => ({ label: v, value: v }));

const EMPTY_FORM = {
  title: '',
  decision: '',
  context: '',
  job: '',
  decision_owner: '',
  meeting_date: '',
  source_reference: '',
};

const errorMessage = (error) => error?.message || 'Ocurrió un error desconocido.';

const reviewAppearance = (value) => {
  if (value === REVIEW.validated) return 'success';
  if (value === REVIEW.discarded) return 'removed';
  return 'inprogress';
};

const decisionAppearance = (value) => {
  if (value === 'Aprobada') return 'success';
  if (value === 'Rechazada') return 'removed';
  if (value === 'En discusión') return 'inprogress';
  return 'default';
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Título de fila clicable con aspecto de enlace (un Button se ve como botón gris centrado).
const titleStyle = xcss({ textAlign: 'left', width: '100%' });

// Sin esto, con pocas filas la tabla y el buscador se encogen al ancho del contenido.
const fullWidth = xcss({ width: '100%' });

const subtitle = (d) => [d.job, formatDate(d.meeting_date)].filter(Boolean).join(' · ');

// Llama a un resolver y lanza error si no responde success.
const call = async (name, payload, failMessage) => {
  const result = await invoke(name, payload);
  if (!result?.success) throw new Error(failMessage);
  return result;
};

// Campo con etiqueta (UI Kit no trae label integrado en Textfield).
const Field = ({ label, required, value, onChange, multiline, placeholder }) => (
  <Stack space="space.050">
    <Text weight="semibold">
      {label}
      {required ? ' *' : ''}
    </Text>
    {multiline ? (
      <TextArea
        value={value || ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    ) : (
      <Textfield
        value={value || ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    )}
  </Stack>
);

const SelectField = ({ label, options, value, onChange }) => (
  <Stack space="space.050">
    <Text weight="semibold">{label}</Text>
    <Select
      options={options}
      value={options.find((o) => o.value === value) || options[0]}
      onChange={(o) => onChange(o?.value || options[0].value)}
    />
  </Stack>
);

const Meta = ({ label, value }) =>
  value ? (
    <Stack space="space.025">
      <Text size="small" color="color.text.subtlest">{label}</Text>
      <Text>{value}</Text>
    </Stack>
  ) : null;

// ============================================================
// APP
// ============================================================

const App = () => {
  const productContext = useProductContext();
  const spaceKey = productContext?.extension?.space?.key || 'espacio';

  // ---------------- datos ----------------
  const [active, setActive] = useState([]);
  const [archived, setArchived] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // ---------------- vista ----------------
  const [tabIndex, setTabIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(new Set());
  const [keep, setKeep] = useState(new Set()); // revisadas que siguen en su fila hasta cambiar de vista
  const [rowBusy, setRowBusy] = useState({}); // id -> acción en curso
  const [bulkBusy, setBulkBusy] = useState(null); // 'archive' | 'delete' | null
  const [exporting, setExporting] = useState(false);
  const [banner, setBanner] = useState(null); // respaldo si showFlag no está disponible

  // ---------------- modales ----------------
  const [detailId, setDetailId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { ids: [] }
  const [showImport, setShowImport] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  // ---------------- importar / crear ----------------
  const [selectedFile, setSelectedFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [manualForm, setManualForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);

  // ---------------- Google Drive ----------------
  const [googleAccount, setGoogleAccount] = useState(null);
  const [googleLoading, setGoogleLoading] = useState(true);
  const [googleConnecting, setGoogleConnecting] = useState(false);
  const [savedFolder, setSavedFolder] = useState(null);
  const [driveError, setDriveError] = useState(null);
  const [preferredFolders, setPreferredFolders] = useState([]);
  const [preferredLoading, setPreferredLoading] = useState(false);
  const [driveQuery, setDriveQuery] = useState('');
  const [driveMatches, setDriveMatches] = useState([]);
  const [driveSearching, setDriveSearching] = useState(false);
  const [candidateFolder, setCandidateFolder] = useState(null);
  const [folderPreview, setFolderPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [folderSaving, setFolderSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncReport, setSyncReport] = useState(null);

  // ============================================================
  // NOTIFICACIONES
  // ============================================================

  // Flag nativo de Atlassian (abajo a la izquierda, visible sin importar el scroll).
  const notify = useCallback((type, title, description) => {
    try {
      showFlag({
        id: `${Date.now()}-${Math.random()}`,
        title,
        description,
        type,
        appearance: type === 'error' ? 'error' : undefined,
        isAutoDismiss: type !== 'error',
      });
    } catch {
      setBanner({ type, title, description });
    }
  }, []);

  const fail = useCallback((err) => notify('error', 'No se pudo completar', errorMessage(err)), [notify]);

  // ============================================================
  // CARGA
  // ============================================================

  const loadDecisions = useCallback(async () => {
    try {
      const [a, z] = await Promise.all([
        call('getCandidates', undefined, 'No se pudieron cargar las decisiones.'),
        call('getArchivedCandidates', undefined, 'No se pudieron cargar las decisiones.'),
      ]);
      setActive(a.candidates || []);
      setArchived(z.candidates || []);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGoogle = useCallback(async () => {
    setGoogleLoading(true);
    try {
      const [account, folder] = await Promise.all([
        invoke('getGoogleAccount'),
        invoke('getDriveFolderConfig'),
      ]);
      setGoogleAccount(account?.connected ? account.account : null);
      setSavedFolder(folder?.success && folder.configured ? folder.folder : null);
    } catch (err) {
      setDriveError(errorMessage(err));
    } finally {
      setGoogleLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDecisions();
    loadGoogle();
  }, [loadDecisions, loadGoogle]);

  // ============================================================
  // DERIVADOS
  // ============================================================

  const tab = TABS[tabIndex];
  const counts = countByTab(active, archived);
  const visible = filterDecisions(active, archived, tab.id, query, keep);
  const visibleIds = visible.map((d) => d.id);
  const selectedIds = [...selected];
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = !allSelected && visibleIds.some((id) => selected.has(id));
  const detail = [...active, ...archived].find((d) => d.id === detailId) || null;
  const isArchivedTab = tab.id === 'archived';

  const changeTab = (index) => {
    setTabIndex(index);
    setSelected(new Set());
    setKeep(new Set());
  };

  const changeQuery = (value) => {
    setQuery(value);
    setSelected(new Set());
    setKeep(new Set());
  };

  // ============================================================
  // ACCIONES POR FILA (sin recargar todo: se actualiza el estado local)
  // ============================================================

  const setReview = async (decision, reviewStatus) => {
    setRowBusy((b) => ({ ...b, [decision.id]: reviewStatus }));
    try {
      await call('updateReviewStatus', { id: decision.id, reviewStatus }, 'No se pudo actualizar la revisión.');
      setActive((list) =>
        list.map((d) => (d.id === decision.id ? { ...d, review_status: reviewStatus } : d))
      );
      setKeep((k) => new Set(k).add(decision.id));
      notify(
        'success',
        reviewStatus === REVIEW.validated ? 'Decisión validada' : 'Decisión descartada',
        decision.title
      );
    } catch (err) {
      fail(err);
    } finally {
      setRowBusy(({ [decision.id]: _, ...rest }) => rest);
    }
  };

  const restore = async (decision) => {
    setRowBusy((b) => ({ ...b, [decision.id]: 'restore' }));
    try {
      await call('restoreCandidate', { id: decision.id }, 'No se pudo restaurar la decisión.');
      setArchived((list) => list.filter((d) => d.id !== decision.id));
      setActive((list) => [{ ...decision, archived_at: null }, ...list]);
      notify('success', 'Decisión restaurada', decision.title);
    } catch (err) {
      fail(err);
    } finally {
      setRowBusy(({ [decision.id]: _, ...rest }) => rest);
    }
  };

  // ============================================================
  // ACCIONES MASIVAS (también usadas para una sola decisión)
  // ============================================================

  const archiveIds = async (ids) => {
    setBulkBusy('archive');
    try {
      await call('archiveCandidates', { ids }, 'No se pudieron archivar las decisiones.');
      const moved = active.filter((d) => ids.includes(d.id));
      const now = new Date().toISOString();
      setActive((list) => list.filter((d) => !ids.includes(d.id)));
      setArchived((list) => [...moved.map((d) => ({ ...d, archived_at: now })), ...list]);
      setSelected(new Set());
      setDetailId(null);
      notify('success', `${plural(moved.length, 'decisión archivada', 'decisiones archivadas')}`);
    } catch (err) {
      fail(err);
    } finally {
      setBulkBusy(null);
    }
  };

  const deleteIds = async (ids) => {
    setBulkBusy('delete');
    try {
      await call('deleteCandidates', { ids }, 'No se pudieron eliminar las decisiones.');
      setActive((list) => list.filter((d) => !ids.includes(d.id)));
      setArchived((list) => list.filter((d) => !ids.includes(d.id)));
      setSelected(new Set());
      setDetailId(null);
      setConfirmDelete(null);
      notify('success', `${plural(ids.length, 'decisión eliminada', 'decisiones eliminadas')}`);
    } catch (err) {
      fail(err);
    } finally {
      setBulkBusy(null);
    }
  };

  // ============================================================
  // EXPORTAR A EXCEL
  // ============================================================

  const exportExcel = async (decisions, label) => {
    setExporting(true);
    try {
      const [header, ...body] = exportRows(decisions);
      const sheetData = [
        header.map((value) => ({ value, fontWeight: 'bold', backgroundColor: '#DEEBFF' })),
        ...body.map((row) => row.map((value) => ({ value }))),
      ];
      const today = new Date().toISOString().slice(0, 10);
      await writeExcelFile(sheetData, {
        sheet: 'Decisiones',
        stickyRowsCount: 1,
        columns: EXPORT_COLUMNS.map((c) => ({ width: c.width })),
      }).toFile(`minerva-adr-${spaceKey}-${label}-${today}.xlsx`);
      notify('success', 'Excel generado', plural(decisions.length, 'decisión exportada', 'decisiones exportadas'));
    } catch (err) {
      fail(err);
    } finally {
      setExporting(false);
    }
  };

  // ============================================================
  // EDITAR (desde el detalle)
  // ============================================================

  const startEdit = (d) =>
    setEditForm({
      title: d.title || '',
      decision: d.decision || '',
      context: d.context || '',
      job: d.job || '',
      decision_owner: d.decision_owner || '',
      status: d.status || 'Propuesto',
      review_status: d.review_status || REVIEW.pending,
    });

  const saveEdit = async () => {
    setSavingEdit(true);
    try {
      await call('updateCandidate', { id: detailId, ...editForm }, 'No se pudo guardar la decisión.');
      setActive((list) => list.map((d) => (d.id === detailId ? { ...d, ...editForm } : d)));
      setEditForm(null);
      notify('success', 'Cambios guardados');
    } catch (err) {
      fail(err);
    } finally {
      setSavingEdit(false);
    }
  };

  const closeDetail = () => {
    setDetailId(null);
    setEditForm(null);
  };

  // ============================================================
  // IMPORTAR / CREAR
  // ============================================================

  const handleImport = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const file = Array.isArray(selectedFile) ? selectedFile[0] : selectedFile;
      const data = typeof file === 'string' ? file : file?.base64 || file?.data;
      if (!data) throw new Error('No se pudo leer el archivo Markdown.');
      const result = await call(
        'processMarkdown',
        { data, sourceFile: file?.name || 'minuta.md' },
        'No se pudo procesar la minuta.'
      );
      setImportResult(result);
      await loadDecisions();
    } catch (err) {
      fail(err);
    } finally {
      setImporting(false);
    }
  };

  const handleCreate = async () => {
    if (!manualForm.title.trim() || !manualForm.decision.trim()) {
      notify('warning', 'Faltan datos', 'Título y decisión son obligatorios.');
      return;
    }
    setCreating(true);
    try {
      await call('createManualCandidate', manualForm, 'No se pudo crear la decisión.');
      setManualForm(EMPTY_FORM);
      setShowCreate(false);
      changeTab(0);
      await loadDecisions();
      notify('success', 'Decisión creada', 'Quedó pendiente de revisión.');
    } catch (err) {
      fail(err);
    } finally {
      setCreating(false);
    }
  };

  // ============================================================
  // GOOGLE DRIVE
  // ============================================================

  const connectGoogle = async () => {
    setGoogleConnecting(true);
    setDriveError(null);
    try {
      const result = await invoke('connectGoogle');
      if (result?.connected && result.account) setGoogleAccount(result.account);
      else await loadGoogle();
    } catch (err) {
      if (err?.name === 'NEEDS_AUTHENTICATION_ERR') throw err; // Forge muestra el consentimiento OAuth
      setDriveError(errorMessage(err));
    } finally {
      setGoogleConnecting(false);
    }
  };

  const openSettings = async () => {
    setShowSettings(true);
    if (googleAccount && preferredFolders.length === 0) {
      setPreferredLoading(true);
      try {
        const result = await call('getPreferredDriveFolders', undefined, 'No se encontraron carpetas.');
        setPreferredFolders(result.folders || []);
      } catch (err) {
        setDriveError(errorMessage(err));
      } finally {
        setPreferredLoading(false);
      }
    }
  };

  const searchFolders = async () => {
    setDriveSearching(true);
    setDriveMatches([]);
    setDriveError(null);
    try {
      const result = await call('searchDriveFolders', { query: driveQuery.trim() }, 'No se pudo buscar la carpeta.');
      setDriveMatches(result.folders || []);
    } catch (err) {
      setDriveError(errorMessage(err));
    } finally {
      setDriveSearching(false);
    }
  };

  const previewFolder = async (folder) => {
    setCandidateFolder(folder);
    setFolderPreview(null);
    setDriveError(null);
    setPreviewLoading(true);
    try {
      setFolderPreview(await call('previewDriveFolder', { folderId: folder.id }, 'No se pudo explorar la carpeta.'));
    } catch (err) {
      setDriveError(errorMessage(err));
    } finally {
      setPreviewLoading(false);
    }
  };

  const saveFolder = async () => {
    setFolderSaving(true);
    try {
      const result = await call('saveDriveFolderConfig', { folderId: candidateFolder.id }, 'No se pudo guardar la carpeta.');
      setSavedFolder(result.folder);
      setCandidateFolder(null);
      setFolderPreview(null);
      notify('success', 'Carpeta guardada', result.folder?.name);
    } catch (err) {
      setDriveError(errorMessage(err));
    } finally {
      setFolderSaving(false);
    }
  };

  const syncDrive = async (reprocess = false) => {
    if (!savedFolder) {
      openSettings();
      return;
    }
    setSyncing(true);
    setSyncReport(null);
    try {
      const result = await call('syncDriveMarkdown', { reprocess }, 'No fue posible completar la sincronización.');
      await loadDecisions();
      if (result.errors?.length || result.truncated) setSyncReport(result);
      notify(
        result.errors?.length ? 'warning' : 'success',
        'Sincronización terminada',
        `${plural(result.inserted || 0, 'decisión nueva', 'decisiones nuevas')} · ${plural(result.filesProcessed || 0, 'minuta leída', 'minutas leídas')}`
      );
    } catch (err) {
      fail(err);
    } finally {
      setSyncing(false);
    }
  };

  // ============================================================
  // TABLA
  // ============================================================

  // En Pendientes/Validadas/Descartadas la pestaña ya dice el estado: la columna sobra.
  const showReview = tab.id === 'all' || tab.id === 'archived';

  const head = {
    cells: [
      { key: 'select', content: '', width: 4 },
      { key: 'title', content: 'Decisión', isSortable: true, width: showReview ? 40 : 52 },
      { key: 'owner', content: 'Responsable', isSortable: true, width: showReview ? 18 : 20 },
      ...(showReview ? [{ key: 'review', content: 'Revisión', width: 14 }] : []),
      { key: 'actions', content: '', width: 24 },
    ],
  };

  // Validar y Descartar siempre ocupan el mismo lugar: el del estado actual queda
  // deshabilitado en vez de desaparecer, así un doble clic no revierte la acción.
  const rowActions = (d) => {
    const busy = rowBusy[d.id];
    if (isArchivedTab) {
      return (
        <LoadingButton spacing="compact" iconBefore="undo" isLoading={busy === 'restore'} onClick={() => restore(d)}>
          Restaurar
        </LoadingButton>
      );
    }
    const review = d.review_status || REVIEW.pending;
    return (
      <Inline space="space.050" alignBlock="center">
        <LoadingButton
          spacing="compact"
          iconBefore="check"
          isLoading={busy === REVIEW.validated}
          isDisabled={Boolean(busy) || review === REVIEW.validated}
          onClick={() => setReview(d, REVIEW.validated)}
        >
          Validar
        </LoadingButton>
        <LoadingButton
          spacing="compact"
          appearance="subtle"
          iconBefore="cross"
          isLoading={busy === REVIEW.discarded}
          isDisabled={Boolean(busy) || review === REVIEW.discarded}
          onClick={() => setReview(d, REVIEW.discarded)}
        >
          Descartar
        </LoadingButton>
        {/* Después de los botones, para no desplazarlos bajo el cursor. */}
        {!showReview && keep.has(d.id) && (
          <Lozenge appearance={reviewAppearance(review)}>
            {review === REVIEW.validated ? 'Validada' : review === REVIEW.discarded ? 'Descartada' : 'Pendiente'}
          </Lozenge>
        )}
      </Inline>
    );
  };

  const rows = visible.map((d) => ({
    key: d.id,
    isHighlighted: selected.has(d.id),
    cells: [
      {
        key: 'select',
        content: (
          <Checkbox
            isChecked={selected.has(d.id)}
            onChange={() => setSelected((s) => toggleId(s, d.id))}
          />
        ),
      },
      {
        key: (d.title || '').toLowerCase(),
        content: (
          <Pressable
            onClick={() => setDetailId(d.id)}
            backgroundColor="color.background.neutral.subtle"
            padding="space.0"
            xcss={titleStyle}
          >
            <Stack space="space.025">
              <Text weight="semibold" color="color.link" maxLines={2}>{d.title || 'Sin título'}</Text>
              {subtitle(d) ? <Text size="small" color="color.text.subtlest">{subtitle(d)}</Text> : null}
            </Stack>
          </Pressable>
        ),
      },
      { key: (d.decision_owner || '').toLowerCase(), content: <Text maxLines={2}>{d.decision_owner || '—'}</Text> },
      ...(showReview
        ? [{
          key: 'review',
          content: (
            <Lozenge appearance={reviewAppearance(d.review_status)}>
              {d.review_status || REVIEW.pending}
            </Lozenge>
          ),
        }]
        : []),
      { key: 'actions', content: rowActions(d) },
    ],
  }));

  // ============================================================
  // BLOQUES DE PANTALLA
  // ============================================================

  const toolbar = (
    <Inline space="space.100" alignBlock="center" spread="space-between" shouldWrap>
      <Inline space="space.100" shouldWrap>
        <LoadingButton appearance="primary" iconBefore="refresh" isLoading={syncing} onClick={() => syncDrive(false)}>
          {savedFolder || googleLoading ? 'Sincronizar Drive' : 'Conectar Drive'}
        </LoadingButton>
        <Button iconBefore="upload" onClick={() => { setImportResult(null); setShowImport(true); }}>
          Importar minuta
        </Button>
        <Button iconBefore="add" onClick={() => setShowCreate(true)}>
          Nueva decisión
        </Button>
      </Inline>
      <Inline space="space.100" shouldWrap>
        <LoadingButton
          iconBefore="download"
          isLoading={exporting}
          isDisabled={visible.length === 0}
          onClick={() => exportExcel(visible, tab.id)}
        >
          Exportar Excel
        </LoadingButton>
        <Button appearance="subtle" iconBefore="settings" onClick={openSettings}>
          Configuración
        </Button>
      </Inline>
    </Inline>
  );

  const selectionBar = (
    <Inline space="space.200" alignBlock="center" shouldWrap>
      <Checkbox
        label={selected.size > 0 ? plural(selected.size, 'seleccionada', 'seleccionadas') : `Seleccionar todas (${visible.length})`}
        isChecked={allSelected}
        isIndeterminate={someSelected}
        isDisabled={visible.length === 0}
        onChange={() => setSelected((s) => toggleAll(s, visibleIds))}
      />
      {selected.size > 0 && (
        <Inline space="space.100" shouldWrap>
          {!isArchivedTab && (
            <LoadingButton
              spacing="compact"
              iconBefore="archive"
              isLoading={bulkBusy === 'archive'}
              isDisabled={Boolean(bulkBusy)}
              onClick={() => archiveIds(selectedIds)}
            >
              Archivar
            </LoadingButton>
          )}
          <Button
            spacing="compact"
            iconBefore="trash"
            isDisabled={Boolean(bulkBusy)}
            onClick={() => setConfirmDelete({ ids: selectedIds })}
          >
            Eliminar
          </Button>
          <LoadingButton
            spacing="compact"
            iconBefore="download"
            isLoading={exporting}
            onClick={() => exportExcel(visible.filter((d) => selected.has(d.id)), 'seleccion')}
          >
            Exportar selección
          </LoadingButton>
          <Button spacing="compact" appearance="subtle" onClick={() => setSelected(new Set())}>
            Quitar selección
          </Button>
        </Inline>
      )}
    </Inline>
  );

  const isEmptyApp = !loading && active.length === 0 && archived.length === 0;

  const tablePanel = isEmptyApp ? (
    <EmptyState
      header="Aún no hay decisiones en este espacio"
      description="Sincroniza la carpeta de minutas en Google Drive o importa un archivo Markdown para extraer decisiones."
      primaryAction={
        <Button appearance="primary" onClick={() => syncDrive(false)}>
          {savedFolder || googleLoading ? 'Sincronizar Drive' : 'Conectar Drive'}
        </Button>
      }
      secondaryAction={<Button onClick={() => setShowImport(true)}>Importar minuta</Button>}
    />
  ) : (
    <Stack space="space.200">
      <Textfield
        value={query}
        placeholder="Buscar por título, proyecto, responsable o texto de la decisión"
        onChange={(e) => changeQuery(e.target.value)}
      />
      {selectionBar}
      <DynamicTable
        head={head}
        rows={rows}
        rowsPerPage={PAGE_SIZE}
        isFixedSize
        isLoading={loading}
        emptyView={<Text>{query ? 'Ninguna decisión coincide con la búsqueda.' : 'No hay decisiones en esta vista.'}</Text>}
      />
    </Stack>
  );

  // ============================================================
  // MODALES
  // ============================================================

  const detailModal = detail && (
    <Modal onClose={closeDetail} width="large">
      <ModalHeader>
        <ModalTitle>{editForm ? 'Editar decisión' : detail.title || 'Sin título'}</ModalTitle>
      </ModalHeader>
      <ModalBody>
        {editForm ? (
          <Stack space="space.200">
            <Field label="Título" required value={editForm.title} onChange={(v) => setEditForm((f) => ({ ...f, title: v }))} />
            <Field label="Decisión" required multiline value={editForm.decision} onChange={(v) => setEditForm((f) => ({ ...f, decision: v }))} />
            <Field label="Contexto" multiline value={editForm.context} onChange={(v) => setEditForm((f) => ({ ...f, context: v }))} />
            <Inline space="space.200" grow="fill">
              <Field label="Proyecto" value={editForm.job} onChange={(v) => setEditForm((f) => ({ ...f, job: v }))} />
              <Field label="Responsable" value={editForm.decision_owner} onChange={(v) => setEditForm((f) => ({ ...f, decision_owner: v }))} />
            </Inline>
            <Inline space="space.200" grow="fill">
              <SelectField label="Estado de la decisión" options={DECISION_STATUSES} value={editForm.status} onChange={(v) => setEditForm((f) => ({ ...f, status: v }))} />
              <SelectField label="Revisión" options={REVIEW_OPTIONS} value={editForm.review_status} onChange={(v) => setEditForm((f) => ({ ...f, review_status: v }))} />
            </Inline>
          </Stack>
        ) : (
          <Stack space="space.300">
            <Inline space="space.100" shouldWrap>
              <Lozenge appearance={reviewAppearance(detail.review_status)}>{`Revisión: ${detail.review_status || REVIEW.pending}`}</Lozenge>
              <Lozenge appearance={decisionAppearance(detail.status)}>{`Estado: ${detail.status || 'Propuesto'}`}</Lozenge>
              {detail.archived_at && <Lozenge>Archivada</Lozenge>}
            </Inline>
            <Inline space="space.400" shouldWrap>
              <Meta label="Proyecto" value={detail.job} />
              <Meta label="Responsable" value={detail.decision_owner} />
              <Meta label="Fecha de reunión" value={formatDate(detail.meeting_date)} />
            </Inline>
            <Stack space="space.075">
              <Heading size="xsmall">Decisión</Heading>
              <Text>{detail.decision || 'Sin descripción'}</Text>
            </Stack>
            {detail.context && detail.context !== detail.decision && (
              <Stack space="space.075">
                <Heading size="xsmall">Contexto</Heading>
                <Text>{detail.context}</Text>
              </Stack>
            )}
            <Meta label="Minuta de origen" value={detail.source_reference || detail.source_file} />
          </Stack>
        )}
      </ModalBody>
      <ModalFooter>
        {editForm ? (
          <Inline space="space.100">
            <Button appearance="subtle" onClick={() => setEditForm(null)}>Cancelar</Button>
            <LoadingButton
              appearance="primary"
              isLoading={savingEdit}
              isDisabled={!editForm.title.trim() || !editForm.decision.trim()}
              onClick={saveEdit}
            >
              Guardar cambios
            </LoadingButton>
          </Inline>
        ) : (
          <Inline space="space.100" shouldWrap>
            <Button appearance="subtle" iconBefore="trash" onClick={() => setConfirmDelete({ ids: [detail.id] })}>
              Eliminar
            </Button>
            {detail.archived_at ? (
              <LoadingButton iconBefore="undo" isLoading={rowBusy[detail.id] === 'restore'} onClick={async () => { await restore(detail); closeDetail(); }}>
                Restaurar
              </LoadingButton>
            ) : (
              <>
                <LoadingButton iconBefore="archive" isLoading={bulkBusy === 'archive'} onClick={() => archiveIds([detail.id])}>
                  Archivar
                </LoadingButton>
                <Button iconBefore="edit" onClick={() => startEdit(detail)}>Editar</Button>
              </>
            )}
            <Button appearance="primary" onClick={closeDetail}>Cerrar</Button>
          </Inline>
        )}
      </ModalFooter>
    </Modal>
  );

  const confirmModal = confirmDelete && (
    <Modal onClose={() => setConfirmDelete(null)} width="small">
      <ModalHeader>
        <ModalTitle appearance="danger">
          {`¿Eliminar ${plural(confirmDelete.ids.length, 'decisión', 'decisiones')}?`}
        </ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Text>
          Se borran definitivamente de Minerva. Las que vienen de Google Drive se pueden recuperar con
          «Releer todas las minutas» en Configuración.
        </Text>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={() => setConfirmDelete(null)}>Cancelar</Button>
        <LoadingButton appearance="danger" isLoading={bulkBusy === 'delete'} onClick={() => deleteIds(confirmDelete.ids)}>
          Eliminar
        </LoadingButton>
      </ModalFooter>
    </Modal>
  );

  const importModal = showImport && (
    <Modal onClose={() => setShowImport(false)}>
      <ModalHeader>
        <ModalTitle>Importar minuta Markdown</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.200">
          <Text>Sube un archivo .md y Minerva extraerá las decisiones que encuentre.</Text>
          <FilePicker accept=".md,text/markdown,text/plain" onChange={(f) => { setSelectedFile(f); setImportResult(null); }} />
          {importResult && (
            <SectionMessage appearance="success" title="Minuta procesada">
              <Text>
                {`${plural(importResult.inserted, 'decisión nueva', 'decisiones nuevas')} · ${plural(importResult.duplicates, 'ya existía', 'ya existían')}`}
              </Text>
            </SectionMessage>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={() => setShowImport(false)}>Cerrar</Button>
        <LoadingButton appearance="primary" isLoading={importing} isDisabled={!selectedFile} onClick={handleImport}>
          Procesar minuta
        </LoadingButton>
      </ModalFooter>
    </Modal>
  );

  const setManual = (key) => (value) => setManualForm((f) => ({ ...f, [key]: value }));

  const createModal = showCreate && (
    <Modal onClose={() => setShowCreate(false)} width="large">
      <ModalHeader>
        <ModalTitle>Nueva decisión</ModalTitle>
      </ModalHeader>
      <ModalBody>
        <Stack space="space.200">
          <Field label="Título" required value={manualForm.title} onChange={setManual('title')} placeholder="Ej.: Usar scratch temporal en nodos de cómputo" />
          <Field label="Decisión" required multiline value={manualForm.decision} onChange={setManual('decision')} />
          <Field label="Contexto" multiline value={manualForm.context} onChange={setManual('context')} placeholder="Por qué se tomó, alternativas, restricciones" />
          <Inline space="space.200" grow="fill">
            <Field label="Proyecto" value={manualForm.job} onChange={setManual('job')} />
            <Field label="Responsable" value={manualForm.decision_owner} onChange={setManual('decision_owner')} />
          </Inline>
          <Inline space="space.200" grow="fill">
            <Stack space="space.050">
              <Text weight="semibold">Fecha de reunión</Text>
              <DatePicker
                value={manualForm.meeting_date}
                locale="es-CL"
                placeholder="Selecciona una fecha"
                onChange={(value) => setManual('meeting_date')(value || '')}
              />
            </Stack>
            <Field label="Referencia de origen" value={manualForm.source_reference} onChange={setManual('source_reference')} placeholder="Minuta, acta o enlace" />
          </Inline>
        </Stack>
      </ModalBody>
      <ModalFooter>
        <Button appearance="subtle" onClick={() => setShowCreate(false)}>Cancelar</Button>
        <LoadingButton
          appearance="primary"
          isLoading={creating}
          isDisabled={!manualForm.title.trim() || !manualForm.decision.trim()}
          onClick={handleCreate}
        >
          Crear decisión
        </LoadingButton>
      </ModalFooter>
    </Modal>
  );

  const folderButton = (folder) => (
    <Button
      key={folder.id}
      iconBefore="folder"
      isSelected={candidateFolder?.id === folder.id}
      onClick={() => previewFolder(folder)}
    >
      {folder.name}
    </Button>
  );

  const settingsModal = showSettings && (
    <Modal onClose={() => setShowSettings(false)} width="large">
      <ModalHeader>
        <ModalTitle>Configuración de minutas</ModalTitle>
      </ModalHeader>
      <ModalBody>
        {googleLoading ? (
          <Inline space="space.100" alignBlock="center"><Spinner size="small" /><Text>Cargando…</Text></Inline>
        ) : (
          <Stack space="space.300">
            <Stack space="space.100">
              <Heading size="xsmall">Cuenta de Google Drive</Heading>
              {googleAccount ? (
                <Inline space="space.100" alignBlock="center">
                  <Lozenge appearance="success">Conectada</Lozenge>
                  <Text>{googleAccount.displayName}</Text>
                </Inline>
              ) : (
                <Inline space="space.100" alignBlock="center">
                  <LoadingButton appearance="primary" iconBefore="googledrive" isLoading={googleConnecting} onClick={connectGoogle}>
                    Conectar Google Drive
                  </LoadingButton>
                  <Text size="small" color="color.text.subtle">Sólo lectura. Cada persona conecta su propia cuenta.</Text>
                </Inline>
              )}
            </Stack>

            {googleAccount && (
              <Stack space="space.150">
                <Heading size="xsmall">Carpeta de minutas</Heading>
                <Text>
                  {savedFolder ? `Carpeta actual: ${savedFolder.name}` : 'Todavía no hay una carpeta configurada.'}
                </Text>
                {preferredLoading ? (
                  <Spinner size="small" />
                ) : (
                  preferredFolders.length > 0 && (
                    <Inline space="space.100" shouldWrap>{preferredFolders.map(folderButton)}</Inline>
                  )
                )}
                <Inline space="space.100" alignBlock="center">
                  <Textfield
                    value={driveQuery}
                    placeholder="Buscar otra carpeta por nombre"
                    onChange={(e) => setDriveQuery(e.target.value)}
                  />
                  <LoadingButton isLoading={driveSearching} isDisabled={driveQuery.trim().length < 2} onClick={searchFolders}>
                    Buscar
                  </LoadingButton>
                </Inline>
                {driveMatches.length > 0 && <Inline space="space.100" shouldWrap>{driveMatches.map(folderButton)}</Inline>}

                {candidateFolder && (
                  <Box padding="space.200" backgroundColor="color.background.neutral" borderRadius="medium">
                    <Stack space="space.100">
                      <Text weight="semibold">{candidateFolder.name}</Text>
                      {previewLoading ? (
                        <Inline space="space.100"><Spinner size="small" /><Text>Explorando archivos…</Text></Inline>
                      ) : (
                        folderPreview && (
                          <Text>
                            {`${plural(folderPreview.totalMarkdown, 'minuta Markdown', 'minutas Markdown')} en ${plural(folderPreview.foldersScanned, 'carpeta', 'carpetas')}${folderPreview.truncated ? ' (exploración parcial)' : ''}`}
                          </Text>
                        )
                      )}
                      <Inline space="space.100">
                        <LoadingButton
                          appearance="primary"
                          isLoading={folderSaving}
                          isDisabled={!folderPreview || candidateFolder.id === savedFolder?.id}
                          onClick={saveFolder}
                        >
                          {candidateFolder.id === savedFolder?.id ? 'Ya es la carpeta actual' : 'Usar esta carpeta'}
                        </LoadingButton>
                      </Inline>
                    </Stack>
                  </Box>
                )}
              </Stack>
            )}

            {savedFolder && (
              <Stack space="space.100">
                <Heading size="xsmall">Releer todas las minutas</Heading>
                <Text size="small" color="color.text.subtle">
                  Vuelve a procesar también las minutas sin cambios. Sirve para recuperar decisiones eliminadas;
                  las que ya existen no se duplican.
                </Text>
                <Inline>
                  <LoadingButton iconBefore="retry" isLoading={syncing} onClick={() => syncDrive(true)}>
                    Releer todas las minutas
                  </LoadingButton>
                </Inline>
              </Stack>
            )}

            {driveError && <SectionMessage appearance="error"><Text>{driveError}</Text></SectionMessage>}
          </Stack>
        )}
      </ModalBody>
      <ModalFooter>
        <Button appearance="primary" onClick={() => setShowSettings(false)}>Listo</Button>
      </ModalFooter>
    </Modal>
  );

  // ============================================================
  // RENDER
  // ============================================================

  return (
    <Stack space="space.300">
      {toolbar}

      {banner && (
        <SectionMessage appearance={banner.type === 'error' ? 'error' : 'success'} title={banner.title}>
          <Inline space="space.100" alignBlock="center" shouldWrap>
            {banner.description && <Text>{banner.description}</Text>}
            <Button appearance="subtle" spacing="compact" onClick={() => setBanner(null)}>Cerrar</Button>
          </Inline>
        </SectionMessage>
      )}

      {loadError && (
        <SectionMessage appearance="error" title="No se pudieron cargar las decisiones">
          <Text>{loadError}</Text>
        </SectionMessage>
      )}

      {syncReport && (
        <SectionMessage appearance="warning" title="La sincronización terminó con observaciones">
          <Stack space="space.100">
            {syncReport.truncated && <Text>Se alcanzó el límite de exploración; sincroniza de nuevo para continuar.</Text>}
            {(syncReport.errors || []).map((e, i) => (
              <Text key={`${e.file}-${i}`} size="small">{`${e.file}: ${e.message}`}</Text>
            ))}
            <Inline>
              <Button appearance="subtle" spacing="compact" onClick={() => setSyncReport(null)}>Cerrar</Button>
            </Inline>
          </Stack>
        </SectionMessage>
      )}

      <Tabs id="minerva-tabs" selected={tabIndex} onChange={changeTab}>
        <TabList>
          {TABS.map((t) => (
            <Tab key={t.id}>{`${t.label} (${counts[t.id]})`}</Tab>
          ))}
        </TabList>
        {TABS.map((t, i) => (
          <TabPanel key={t.id}>
            <Box paddingBlockStart="space.200" xcss={fullWidth}>
              {i === tabIndex ? tablePanel : null}
            </Box>
          </TabPanel>
        ))}
      </Tabs>

      <ModalTransition>
        {detailModal}
        {confirmModal}
        {importModal}
        {createModal}
        {settingsModal}
      </ModalTransition>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
