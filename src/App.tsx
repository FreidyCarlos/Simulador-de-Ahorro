import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileJson,
  FileCheck2,
  GraduationCap,
  Info,
  Landmark,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  Moon,
  PiggyBank,
  Plus,
  RefreshCcw,
  Save,
  Scale,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  TrendingUp,
  Upload,
  WalletCards,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ActualTrackingView } from "./components/ActualTrackingView";
import { PlanActualComparisonView } from "./components/PlanActualComparisonView";
import { cloneDefaults } from "./data/defaultConfiguration";
import {
  buildPlanActualComparison,
  buildUpdatedProjectionDetails,
  calculateContributionCompliance,
  calculateActualTracking,
  nextMonth,
  summarizeActual,
} from "./domain/actualTracking";
import {
  simulate,
  validateSettings,
} from "./domain/simulation";
import type {
  MonthlyResult,
  SavingsScenario,
  Settings,
  StoredApplicationData,
  TuitionEvent,
} from "./domain/types";
import { currency, downloadFile, monthLabel, numberValue } from "./utils/format";
import { actualTrackingCsvRows, toCsv } from "./utils/csv";
import {
  filterChartForView,
  getChartMonthNeighbors,
  moveActualChartWindow,
  type ChartView,
} from "./utils/chart";
import {
  resolveTheme,
  THEME_STORAGE_KEY,
  type Theme,
} from "./utils/theme";
import {
  createDefaultApplicationData,
  parseApplicationData,
  serializeApplicationData,
} from "./utils/storage";
import {
  createServerBackup,
  getServerHealth,
  getServerState,
  RevisionConflictApiError,
  saveServerState,
  StateApiError,
  type ServerState,
} from "./services/stateApi";
import {
  completeLegacyMigration,
  readLegacyMigrationCandidate,
  statesAreEqual,
} from "./services/migration";
import {
  AUTO_SAVE_DELAY_MS,
  decideRemoteRevisionAction,
  HEALTH_POLL_INTERVAL_MS,
} from "./services/syncPolicy";

type MainTab =
  | "overview"
  | "ideal"
  | "tracking"
  | "actualSummary"
  | "actualResults"
  | "comparison"
  | "plan"
  | "results";
type PlanSection = "scenario" | "income" | "tuition" | "rates" | "protection";
type ResultSection = "annual" | "semester" | "monthly" | "transfers";

const initialTheme = (): Theme => {
  return resolveTheme(
    localStorage.getItem(THEME_STORAGE_KEY),
    Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches),
  );
};

const palette = ["#1f9d78", "#7c5ce7", "#e68b32", "#2f7ed8", "#d44f72"];
const tuitionStatusText = {
  paid: "Pagado",
  failed: "No financiado",
  pending_retry: "Pendiente de reintento",
  skipped_after_failure: "Omitido tras fallo",
  disabled: "Desactivado",
  not_due: "Sin vencimiento",
} as const;
const tuitionStatusClass = (status: MonthlyResult["tuitionPaymentStatus"]) =>
  status === "paid"
    ? "success"
    : status === "failed" || status === "skipped_after_failure"
      ? "danger"
      : status === "pending_retry"
        ? "warning"
        : "neutral";

const inputMoney = (value: number, onChange: (value: number) => void, label: string) => (
  <div className="money-input">
    <span>$</span>
    <input
      aria-label={label}
      type="number"
      min="0"
      step="1000"
      value={value}
      onChange={(event) => onChange(numberValue(event.target.value))}
    />
  </div>
);

const FieldHelp = ({ text }: { text: string }) => (
  <span className="field-help" title={text} aria-label={text}>
    <Info size={14} />
  </span>
);

const Switch = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={`switch ${checked ? "active" : ""}`}
    onClick={() => onChange(!checked)}
  >
    <span />
  </button>
);

const EmptyState = ({ children }: { children: React.ReactNode }) => (
  <div className="empty-state">
    <Sparkles size={22} />
    <p>{children}</p>
  </div>
);

const ChartTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ color: string; name: string; value: number | string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <div key={item.name}>
          <span style={{ background: item.color }} />
          {item.name}{" "}
          <b>{typeof item.value === "number" ? currency(item.value) : item.value}</b>
        </div>
      ))}
    </div>
  );
};

type SaveStatus =
  | "clean"
  | "pending"
  | "saving"
  | "saved"
  | "error"
  | "conflict"
  | "disconnected"
  | "synced";

const saveStatusText: Record<SaveStatus, string> = {
  clean: "Sin cambios",
  pending: "Cambios pendientes",
  saving: "Guardando",
  saved: "Guardado",
  error: "Error al guardar",
  conflict: "Conflicto",
  disconnected: "Servidor desconectado",
  synced: "Sincronizado",
};

function App() {
  const [initialState, setInitialState] = useState<ServerState | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadError("");
    getServerState(controller.signal)
      .then(setInitialState)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(
          error instanceof Error
            ? error.message
            : "No fue posible conectarse con el servidor local.",
        );
      });
    return () => controller.abort();
  }, [loadAttempt]);

  if (!initialState && !loadError) {
    return (
      <div className="server-gate" role="status" aria-live="polite">
        <div className="server-gate-card">
          <Database size={30} />
          <h1>Cargando datos</h1>
          <p>Consultando el estado compartido en SQLite.</p>
        </div>
      </div>
    );
  }

  if (!initialState) {
    return (
      <div className="server-gate" role="alert">
        <div className="server-gate-card error">
          <AlertCircle size={30} />
          <h1>Servidor desconectado</h1>
          <p>{loadError}</p>
          <small>
            Verifica que <code>npm run dev</code> continúe ejecutándose.
          </small>
          <button
            className="button button-primary"
            onClick={() => setLoadAttempt((value) => value + 1)}
          >
            <RefreshCcw size={16} /> Reintentar
          </button>
        </div>
      </div>
    );
  }

  return <FinancialApp initialServerState={initialState} />;
}

function FinancialApp({
  initialServerState,
}: {
  initialServerState: ServerState;
}) {
  const [applicationData, setApplicationData] = useState<StoredApplicationData>(
    () => initialServerState.data,
  );
  const [confirmedData, setConfirmedData] = useState<StoredApplicationData>(
    () => initialServerState.data,
  );
  const [revision, setRevision] = useState(initialServerState.revision);
  const [updatedAt, setUpdatedAt] = useState(initialServerState.updatedAt);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("clean");
  const [serverConnected, setServerConnected] = useState(true);
  const [saveError, setSaveError] = useState("");
  const [remoteRevision, setRemoteRevision] = useState<number | null>(null);
  const [rescheduleSave, setRescheduleSave] = useState(0);
  const [migrationCandidate, setMigrationCandidate] =
    useState<StoredApplicationData | null>(() =>
      readLegacyMigrationCandidate(
        localStorage,
        initialServerState.isInitialState,
      ),
    );
  const [migrationBusy, setMigrationBusy] = useState(false);
  const settings = applicationData.planConfiguration;
  const actualTracking = applicationData.actualTracking;
  const [mainTab, setMainTab] = useState<MainTab>("overview");
  const [planSection, setPlanSection] = useState<PlanSection>("scenario");
  const [resultSection, setResultSection] = useState<ResultSection>("annual");
  const [actualResultSection, setActualResultSection] =
    useState<ResultSection>("annual");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [transferRow, setTransferRow] = useState<MonthlyResult | null>(null);
  const [transferAmount, setTransferAmount] = useState(0);
  const [monthlyFilter, setMonthlyFilter] = useState("all");
  const [onlyEvents, setOnlyEvents] = useState(false);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const importRef = useRef<HTMLInputElement>(null);
  const applicationDataRef = useRef(applicationData);
  const confirmedDataRef = useRef(confirmedData);
  const revisionRef = useRef(revision);
  const dirtyRef = useRef(dirty);
  const saveStatusRef = useRef(saveStatus);
  const editSequenceRef = useRef(0);
  const savingRef = useRef(false);

  useEffect(() => {
    applicationDataRef.current = applicationData;
    confirmedDataRef.current = confirmedData;
    revisionRef.current = revision;
    dirtyRef.current = dirty;
    saveStatusRef.current = saveStatus;
  }, [applicationData, confirmedData, dirty, revision, saveStatus]);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  const setSettings = (next: Settings | ((previous: Settings) => Settings)) => {
    setApplicationData((previous) => {
      const value =
        typeof next === "function" ? next(previous.planConfiguration) : next;
      return { ...previous, planConfiguration: value };
    });
    editSequenceRef.current += 1;
    setDirty(true);
    setSaveStatus("pending");
    setSaveError("");
  };

  const setActualTracking = (
    next:
      | StoredApplicationData["actualTracking"]
      | ((
          previous: StoredApplicationData["actualTracking"],
        ) => StoredApplicationData["actualTracking"]),
  ) => {
    setApplicationData((previous) => {
      const value =
        typeof next === "function" ? next(previous.actualTracking) : next;
      return { ...previous, actualTracking: value };
    });
    editSequenceRef.current += 1;
    setDirty(true);
    setSaveStatus("pending");
    setSaveError("");
  };

  const result = useMemo(() => simulate(settings), [settings]);
  const issues = useMemo(() => validateSettings(settings), [settings]);
  const transferIssues = useMemo(
    () => result.monthly.flatMap((row) => row.transferIssues),
    [result.monthly],
  );
  const primaryScenario = settings.scenarios.find((scenario) => scenario.enabled);
  const primaryRows = useMemo(
    () => result.monthly.filter((row) => row.scenarioId === primaryScenario?.id),
    [result.monthly, primaryScenario],
  );
  const actualCalculated = useMemo(
    () => calculateActualTracking(actualTracking, settings),
    [actualTracking, settings],
  );
  const actualSummary = useMemo(
    () => summarizeActual(actualTracking, actualCalculated),
    [actualTracking, actualCalculated],
  );
  const comparison = useMemo(
    () => buildPlanActualComparison(primaryRows, actualCalculated),
    [primaryRows, actualCalculated],
  );
  const updatedProjection = useMemo(
    () => buildUpdatedProjectionDetails(settings, actualTracking, result),
    [settings, actualTracking, result],
  );
  const scenarioColor = (id: string) =>
    settings.scenarios.find((scenario) => scenario.id === id)?.color ?? "#1f9d78";

  const chartData = useMemo(
    () =>
      primaryRows.map((row) => ({
        date: monthLabel(row.date, true),
        fullDate: row.date,
        "Patrimonio total": row.closingTotalBalance,
        "Saldo Nu": row.closingNuBalance,
        [settings.concentration.externalAccountName]: row.closingExternalBalance,
        event: row.tuitionAmount > 0,
      })),
    [primaryRows, settings.concentration.externalAccountName],
  );

  const tuitionRows = result.monthly
    .filter((row) => row.tuitionAmount > 0)
    .map((row) => ({
      ...row,
      required: row.tuitionAmount + (row.tuitionPaid ? row.tuitionGmfAmount : 0),
      margin: row.tuitionPaid
        ? row.openingTotalBalance - row.tuitionAmount - row.tuitionGmfAmount
        : -row.missing,
    }));

  const annualRows = useMemo(() => {
    const map = new Map<string, {
      key: string;
      year: number;
      scenarioId: string;
      scenario: string;
      openingNu: number;
      openingExternal: number;
      contributions: number;
      yields: number;
      withholding: number;
      tuition: number;
      gmf: number;
      transfers: number;
      finalNu: number;
      finalExternal: number;
      finalTotal: number;
    }>();
    result.monthly.forEach((row) => {
      const year = +row.date.slice(0, 4);
      const key = `${row.scenarioId}-${year}`;
      const current = map.get(key) ?? {
        key,
        year,
        scenarioId: row.scenarioId,
        scenario: row.scenarioName,
        openingNu: row.openingNuBalance,
        openingExternal: row.openingExternalBalance,
        contributions: 0,
        yields: 0,
        withholding: 0,
        tuition: 0,
        gmf: 0,
        transfers: 0,
        finalNu: 0,
        finalExternal: 0,
        finalTotal: 0,
      };
      current.contributions += row.totalContribution;
      current.yields += row.netYield + row.externalYield;
      current.withholding += row.withholding;
      current.tuition += row.tuitionPaidAmount;
      current.gmf += row.tuitionGmfAmount + row.externalTransferGmf;
      current.transfers += row.confirmedExternalTransfer;
      current.finalNu = row.closingNuBalance;
      current.finalExternal = row.closingExternalBalance;
      current.finalTotal = row.closingTotalBalance;
      map.set(key, current);
    });
    return [...map.values()];
  }, [result.monthly]);

  const monthlyRows = result.monthly.filter(
    (row) =>
      (monthlyFilter === "all" || row.scenarioId === monthlyFilter) &&
      (!onlyEvents || row.tuitionAmount > 0 || row.failure || row.confirmedExternalTransfer > 0),
  );

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  };

  const applyServerState = useCallback((state: ServerState) => {
    setApplicationData(state.data);
    setConfirmedData(state.data);
    setRevision(state.revision);
    setUpdatedAt(state.updatedAt);
    setDirty(false);
    setRemoteRevision(null);
    setSaveError("");
    setServerConnected(true);
  }, []);

  const performSave = useCallback(
    async (manual = false) => {
      if (savingRef.current) return;
      if (!dirtyRef.current) {
        if (manual) {
          setSaveStatus("clean");
          notify("No hay cambios pendientes.");
        }
        return;
      }
      if (issues.length > 0 || transferIssues.length > 0) {
        setSaveStatus("error");
        setSaveError(
          "Corrige los errores financieros indicados antes de guardar.",
        );
        return;
      }
      savingRef.current = true;
      setSaveStatus("saving");
      setSaveError("");
      const snapshot = applicationDataRef.current;
      const sequence = editSequenceRef.current;
      try {
        const response = await saveServerState(
          snapshot,
          revisionRef.current,
        );
        setRevision(response.revision);
        revisionRef.current = response.revision;
        setUpdatedAt(response.updatedAt);
        setConfirmedData(snapshot);
        confirmedDataRef.current = snapshot;
        setServerConnected(true);
        setRemoteRevision(null);
        if (sequence === editSequenceRef.current) {
          setDirty(false);
          dirtyRef.current = false;
          setSaveStatus("saved");
        } else {
          setDirty(true);
          setSaveStatus("pending");
          setRescheduleSave((value) => value + 1);
        }
      } catch (error) {
        setDirty(true);
        dirtyRef.current = true;
        if (error instanceof RevisionConflictApiError) {
          setRemoteRevision(error.currentRevision);
          setUpdatedAt(error.updatedAt);
          setSaveStatus("conflict");
          setSaveError(error.message);
        } else if (
          error instanceof StateApiError &&
          error.code === "network_error"
        ) {
          setServerConnected(false);
          setSaveStatus("disconnected");
          setSaveError(
            "No fue posible conectarse con el servidor local. Los cambios siguen pendientes.",
          );
        } else if (error instanceof StateApiError) {
          setSaveStatus("error");
          setSaveError(
            error.path
              ? `${error.path}: ${error.detail ?? error.message}`
              : error.message,
          );
        } else {
          setSaveStatus("error");
          setSaveError("No fue posible guardar el estado compartido.");
        }
      } finally {
        savingRef.current = false;
      }
    },
    [issues.length, transferIssues.length],
  );

  useEffect(() => {
    if (
      !dirty ||
      saveStatus === "conflict" ||
      saveStatus === "error" ||
      saveStatus === "disconnected"
    ) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void performSave();
    }, AUTO_SAVE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [applicationData, dirty, performSave, rescheduleSave, saveStatus]);

  useEffect(() => {
    let stopped = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const health = await getServerHealth();
        if (stopped) return;
        setServerConnected(true);
        const remoteAction = decideRemoteRevisionAction(
          revisionRef.current,
          health.revision,
          dirtyRef.current || savingRef.current,
        );
        if (remoteAction === "conflict") {
          setRemoteRevision(health.revision);
          setSaveStatus("conflict");
          setSaveError(
            "Hay una versión más reciente guardada desde otro dispositivo.",
          );
        } else if (remoteAction === "reload") {
          const state = await getServerState();
          if (stopped) return;
          applyServerState(state);
          setSaveStatus("synced");
          notify("Estado sincronizado desde otro dispositivo.");
        } else if (
          dirtyRef.current &&
          saveStatusRef.current === "disconnected"
        ) {
          setSaveStatus("pending");
          setRescheduleSave((value) => value + 1);
        }
      } catch {
        if (stopped) return;
        setServerConnected(false);
        if (dirtyRef.current) setSaveStatus("disconnected");
      } finally {
        polling = false;
      }
    };
    const interval = window.setInterval(
      () => void poll(),
      HEALTH_POLL_INTERVAL_MS,
    );
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [applyServerState]);

  const save = () => {
    void performSave(true);
  };

  const reloadFromServer = async () => {
    if (
      dirtyRef.current &&
      !window.confirm(
        "¿Descartar los cambios locales pendientes y recargar la versión compartida?",
      )
    ) {
      return;
    }
    try {
      const state = await getServerState();
      applyServerState(state);
      setSaveStatus("synced");
      notify("Estado recargado desde el servidor.");
    } catch (error) {
      setServerConnected(false);
      setSaveStatus("disconnected");
      setSaveError(
        error instanceof Error
          ? error.message
          : "No fue posible recargar el estado.",
      );
    }
  };

  const createBackup = async () => {
    try {
      const backup = await createServerBackup();
      notify(`Respaldo local creado: ${backup.file}`);
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "No fue posible crear el respaldo SQLite.",
      );
      setSaveStatus("error");
    }
  };

  const restore = () => {
    if (
      !window.confirm(
        "¿Restaurar únicamente la configuración del Ahorro ideal? El Ahorro real se conservará.",
      )
    )
      return;
    setSettings(cloneDefaults());
    notify("Ahorro ideal restaurado. El Ahorro real se conservó.");
  };

  const duplicateConfiguration = () => {
    const next = settings.scenarios.map((scenario, index) => ({
      ...scenario,
      id: `${scenario.id}-copy-${Date.now()}-${index}`,
      name: `${scenario.name} — copia`,
      color: palette[(index + 1) % palette.length],
    }));
    setSettings({ ...settings, scenarios: [...settings.scenarios, ...next] });
    notify("Escenarios duplicados.");
  };

  const clearConfiguration = () => {
    if (
      !window.confirm(
        "¿Restaurar el Ahorro ideal y borrar todo el Ahorro real compartido? Exporta una copia antes si deseas conservarlo.",
      )
    )
      return;
    setApplicationData(createDefaultApplicationData());
    editSequenceRef.current += 1;
    setDirty(true);
    setSaveStatus("pending");
    notify("Estado inicial preparado; aún debe guardarse en el servidor.");
  };

  const downloadJson = (
    data: StoredApplicationData,
    suffix = "copia-completa",
  ) =>
    downloadFile(
      `ahorro-u-${suffix}-${new Date().toISOString().slice(0, 10)}.json`,
      serializeApplicationData(data),
      "application/json",
    );

  const exportJson = () => {
    if (
      dirtyRef.current &&
      !window.confirm(
        "Hay cambios locales sin guardar. La exportación incluirá únicamente la última versión confirmada en SQLite. ¿Continuar?",
      )
    ) {
      return;
    }
    downloadJson(confirmedDataRef.current);
  };

  const exportLocalJson = () =>
    downloadJson(applicationDataRef.current, "edicion-local-no-guardada");

  const csv = toCsv;

  const exportMonthly = () => {
    downloadFile(
      "ahorro-u-resultados-mensuales.csv",
      csv(result.monthly.map((row) => ({
        fecha: row.date,
        escenario: row.scenarioName,
        saldo_inicial_nu: row.openingNuBalance,
        saldo_inicial_externo: row.openingExternalBalance,
        ingreso: row.monthlyIncome,
        prima: row.bonusIncome,
        aporte: row.totalContribution,
        rendimiento_bruto: row.grossYield,
        retencion: row.withholding,
        matricula: row.tuitionAmount,
        matricula_pagada: row.tuitionPaidAmount,
        matricula_meses_originales: row.tuitionOriginalMonths.join("|"),
        matricula_intentos: row.tuitionAttempts
          .map((attempt) => `${attempt.eventId}:${attempt.attemptNumber}:${attempt.status}`)
          .join("|"),
        gmf: row.tuitionGmfAmount,
        traslado: row.confirmedExternalTransfer,
        saldo_nu: row.closingNuBalance,
        saldo_externo: row.closingExternalBalance,
        patrimonio: row.closingTotalBalance,
        estado: row.tuitionPaymentStatus,
      }))),
      "text/csv;charset=utf-8",
    );
  };

  const exportSection = (section: ResultSection) => {
    if (section === "monthly") {
      exportMonthly();
      return;
    }
    if (section === "annual") {
      downloadFile("ahorro-u-resumen-anual.csv", csv(annualRows), "text/csv;charset=utf-8");
      return;
    }
    if (section === "semester") {
      downloadFile(
        "ahorro-u-pagos-semestrales.csv",
        csv(tuitionRows.map((row) => ({
          escenario: row.scenarioName,
          semestre: row.tuitionLabel,
          fecha: row.date,
          valor: row.tuitionAmount,
          gmf: row.tuitionGmfAmount,
          total_necesario: row.required,
          saldo_antes: row.openingTotalBalance,
          saldo_despues: row.closingTotalBalance,
          estado: row.tuitionPaymentStatus,
          faltante: row.missing,
        }))),
        "text/csv;charset=utf-8",
      );
      return;
    }
    downloadFile(
      "ahorro-u-historial-traslados.csv",
      csv(result.monthly.flatMap((row) =>
        row.appliedTransfers.map((transfer) => ({
          id: transfer.id,
          fecha: row.date,
          escenario: row.scenarioName,
          saldo_nu_antes: transfer.nuBalanceBefore,
          monto: transfer.amount,
          costo: transfer.cost,
          saldo_nu_despues: transfer.nuBalanceAfter,
          saldo_externo_despues: transfer.externalBalanceAfter,
          patrimonio_despues:
            transfer.nuBalanceAfter + transfer.externalBalanceAfter,
          estado: transfer.status,
          observacion: transfer.issue ?? "",
        })),
      )),
      "text/csv;charset=utf-8",
    );
  };

  const exportActual = () =>
    downloadFile(
      "ahorro-u-ahorro-real.csv",
      csv(actualTrackingCsvRows(actualCalculated)),
      "text/csv;charset=utf-8",
    );

  const exportComparison = () =>
    downloadFile(
      "ahorro-u-ideal-vs-real.csv",
      csv(comparison.map((row) => ({
        mes: row.month,
        ...Object.fromEntries(
          Object.entries(row.metrics).flatMap(([concept, metric]) => [
            [`${concept}_ideal`, metric.ideal],
            [`${concept}_real`, metric.actual ?? ""],
            [`${concept}_variacion_pesos`, metric.amount ?? ""],
            [`${concept}_variacion_porcentual`, metric.percentage ?? ""],
            [`${concept}_interpretacion`, metric.label],
          ]),
        ),
      }))),
      "text/csv;charset=utf-8",
    );

  const exportReconciliations = () =>
    downloadFile(
      "ahorro-u-conciliaciones.csv",
      csv(
        actualCalculated
          .filter(
            (month) =>
              month.nuDifference !== null ||
              month.externalDifference !== null,
          )
          .map((month) => ({
            mes: month.record.month,
            estado: month.record.reconciliationStatus,
            saldo_nu_calculado: month.calculatedNuBalance,
            saldo_nu_reportado: month.record.reportedNuBalance ?? "",
            diferencia_nu: month.nuDifference ?? "",
            saldo_externo_calculado: month.calculatedExternalBalance,
            saldo_externo_reportado: month.record.reportedExternalBalance ?? "",
            diferencia_externa: month.externalDifference ?? "",
            ajuste_nu: month.record.actualAdjustmentNu,
            ajuste_externo: month.record.actualAdjustmentExternal,
            nota: month.record.note,
          })),
      ),
      "text/csv;charset=utf-8",
    );

  const importJson = async (file?: File) => {
    if (!file) return;
    let writeAccepted = false;
    try {
      const text = await file.text();
      let parsed: StoredApplicationData;
      try {
        parsed = parseApplicationData(text);
      } catch (currentError) {
        const legacy = JSON.parse(text) as Settings;
        try {
          parsed = parseApplicationData(JSON.stringify({
            version: 2,
            planConfiguration: legacy,
            actualTracking,
          }));
        } catch {
          throw currentError;
        }
      }
      const importedIssues = validateSettings(parsed.planConfiguration);
      if (importedIssues.length) {
        throw new Error(
          importedIssues.map((issue) => issue.message).join(" "),
        );
      }
      const summary = [
        `${parsed.planConfiguration.scenarios.length} escenarios`,
        `${parsed.planConfiguration.tuitionEvents.length} matrículas`,
        `${parsed.actualTracking.records.length} meses reales`,
        `${parsed.actualTracking.revisions.length} revisiones`,
      ].join(", ");
      if (
        !window.confirm(
          `La importación reemplazará el estado compartido (${summary}). Se creará un respaldo SQLite antes de continuar. ¿Importar?`,
        )
      ) {
        return;
      }
      await createServerBackup();
      const saved = await saveServerState(parsed, revisionRef.current);
      writeAccepted = true;
      revisionRef.current = saved.revision;
      setRevision(saved.revision);
      setUpdatedAt(saved.updatedAt);
      setApplicationData(parsed);
      setConfirmedData(parsed);
      setDirty(false);
      const reloaded = await getServerState();
      applyServerState(reloaded);
      setSaveStatus("saved");
      notify(
        "Ahorro ideal, Ahorro real, conciliaciones e historial importados.",
      );
    } catch (error) {
      const message = `${
        writeAccepted
          ? "El servidor aceptó la importación, pero no fue posible completar la verificación: "
          : "No se pudo importar: "
      }${
        error instanceof StateApiError && error.path
          ? `${error.path}: ${error.detail ?? error.message}`
          : error instanceof Error
            ? error.message
            : "estructura inválida"
      }${
        writeAccepted
          ? " Recarga desde el servidor antes de continuar."
          : " Tus datos actuales no fueron modificados."
      }`;
      setSaveError(message);
      setSaveStatus(
        error instanceof RevisionConflictApiError ? "conflict" : "error",
      );
      notify(message);
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  };

  const migrateLegacyData = async () => {
    if (!migrationCandidate || migrationBusy) return;
    setMigrationBusy(true);
    setSaveError("");
    let writeAccepted = false;
    try {
      await createServerBackup();
      const saved = await saveServerState(
        migrationCandidate,
        revisionRef.current,
      );
      writeAccepted = true;
      revisionRef.current = saved.revision;
      setRevision(saved.revision);
      setUpdatedAt(saved.updatedAt);
      setApplicationData(migrationCandidate);
      setConfirmedData(migrationCandidate);
      setDirty(false);
      const reloaded = await getServerState();
      if (!statesAreEqual(reloaded.data, migrationCandidate)) {
        throw new Error(
          "La comprobación posterior no coincide con los datos migrados.",
        );
      }
      completeLegacyMigration(localStorage, migrationCandidate);
      applyServerState(reloaded);
      setMigrationCandidate(null);
      setSaveStatus("saved");
      notify("Datos del navegador migrados y verificados en SQLite.");
    } catch (error) {
      if (error instanceof RevisionConflictApiError) {
        setRemoteRevision(error.currentRevision);
        setSaveStatus("conflict");
      } else {
        setSaveStatus("error");
      }
      setSaveError(
        `${
          writeAccepted
            ? "El servidor aceptó la migración, pero su verificación quedó pendiente: "
            : "No fue posible migrar: "
        }${
          error instanceof Error ? error.message : "error desconocido"
        }. Los datos del navegador se conservaron.`,
      );
    } finally {
      setMigrationBusy(false);
    }
  };

  const confirmTransfer = () => {
    if (!transferRow || transferAmount <= 0) return;
    const gmf =
      settings.concentration.applyGmfToExternalTransfer && settings.taxes.gmfEnabled
        ? transferAmount * settings.taxes.gmfRate / 100
        : 0;
    if (transferAmount + gmf > transferRow.closingNuBalance) {
      notify("El traslado y su costo superan el saldo disponible en Nu.");
      return;
    }
    setSettings({
      ...settings,
      transfers: [
        ...settings.transfers,
        {
          id: `transfer-${Date.now()}`,
          scenarioId: transferRow.scenarioId,
          date: transferRow.date,
          amount: transferAmount,
          status: "confirmed",
          note: "Registrado por el usuario",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    setTransferRow(null);
    notify("Traslado registrado. El patrimonio fue reclasificado.");
  };

  const postponeTransfer = () => {
    if (!transferRow) return;
    setSettings({
      ...settings,
      transfers: [
        ...settings.transfers,
        {
          id: `transfer-${Date.now()}`,
          scenarioId: transferRow.scenarioId,
          date: transferRow.date,
          amount: transferAmount,
          status: "postponed",
          note: "Recordatorio pospuesto",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          postponedTo: nextMonth(transferRow.date),
        },
      ],
    });
    setTransferRow(null);
    notify("Recordatorio pospuesto; los saldos no cambiaron.");
  };

  const dismissTransfer = () => {
    if (!transferRow) return;
    setSettings({
      ...settings,
      transfers: [
        ...settings.transfers,
        {
          id: `transfer-${Date.now()}`,
          scenarioId: transferRow.scenarioId,
          date: transferRow.date,
          amount: transferAmount,
          status: "dismissed",
          note: "Descartado por ahora",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    setTransferRow(null);
    notify("Propuesta descartada para ese mes; los saldos no cambiaron.");
  };

  const openTransfer = (row: MonthlyResult) => {
    setTransferRow(row);
    setTransferAmount(row.suggestedExternalTransfer);
  };

  const idealNavigationActive =
    mainTab === "plan" || mainTab === "ideal" || mainTab === "results";
  const realNavigationActive =
    mainTab === "tracking" ||
    mainTab === "actualSummary" ||
    mainTab === "actualResults";

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Abrir menú">
            <Menu size={21} />
          </button>
          <button className="brand" onClick={() => setMainTab("overview")}>
            <span className="brand-mark"><GraduationCap size={20} /></span>
            <span>Ahorro<span>U</span></span>
          </button>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-button theme-toggle"
              onClick={() =>
                setTheme((current) => (current === "light" ? "dark" : "light"))
              }
              aria-label={
                theme === "light" ? "Activar modo oscuro" : "Activar modo claro"
              }
              title={
                theme === "light" ? "Activar modo oscuro" : "Activar modo claro"
              }
            >
              {theme === "light" ? <Moon size={18} /> : <Sun size={18} />}
            </button>
            <span
              className={`save-state ${
                saveStatus === "saved" ||
                saveStatus === "clean" ||
                saveStatus === "synced"
                  ? "saved"
                  : saveStatus
              }`}
            >
              <span /> {saveStatusText[saveStatus]}
            </span>
            <button
              className="button button-secondary compact"
              onClick={save}
              disabled={saveStatus === "saving"}
            >
              <Save size={16} /> Guardar ahora
            </button>
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
          <div className="sidebar-mobile-head">
            <span>Explorar</span>
            <button className="icon-button" onClick={() => setSidebarOpen(false)} aria-label="Cerrar menú"><X size={20} /></button>
          </div>
          <p className="eyebrow">Navegación</p>
          <button className={mainTab === "overview" ? "active" : ""} onClick={() => { setMainTab("overview"); setSidebarOpen(false); }}>
            <LayoutDashboard size={18} /> Panorama
          </button>
          <button
            className={idealNavigationActive ? "active nav-group-button" : "nav-group-button"}
            onClick={() => { setMainTab("ideal"); setSidebarOpen(false); }}
            aria-expanded={idealNavigationActive}
          >
            <Sparkles size={18} /> Ahorro ideal
            <ChevronDown className="nav-group-chevron" size={15} />
          </button>
          {idealNavigationActive && (
            <div className="subnav nav-group-subnav">
              <button
                className={mainTab === "plan" ? "active" : ""}
                onClick={() => { setMainTab("plan"); setSidebarOpen(false); }}
              >
                Configuración
              </button>
              {mainTab === "plan" && (
                <div className="subnav nested-subnav">
                  {[
                    ["scenario", "Escenarios"],
                    ["income", "Ingresos y prima"],
                    ["tuition", "Matrículas"],
                    ["rates", "Tasas e impuestos"],
                    ["protection", "Protección del fondo"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={planSection === id ? "active" : ""}
                      onClick={() => { setPlanSection(id as PlanSection); setSidebarOpen(false); }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <button
                className={mainTab === "ideal" ? "active" : ""}
                onClick={() => { setMainTab("ideal"); setSidebarOpen(false); }}
              >
                Resumen
              </button>
              <button
                className={mainTab === "results" ? "active" : ""}
                onClick={() => { setMainTab("results"); setSidebarOpen(false); }}
              >
                Explora resultados
              </button>
              {mainTab === "results" && (
                <div className="subnav nested-subnav">
                  {[
                    ["annual", "Resumen anual"],
                    ["semester", "Pagos semestrales"],
                    ["monthly", "Detalle mensual"],
                    ["transfers", "Historial de traslados"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={resultSection === id ? "active" : ""}
                      onClick={() => { setResultSection(id as ResultSection); setSidebarOpen(false); }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button
            className={realNavigationActive ? "active nav-group-button" : "nav-group-button"}
            onClick={() => { setMainTab("tracking"); setSidebarOpen(false); }}
            aria-expanded={realNavigationActive}
          >
            <FileCheck2 size={18} /> Ahorro real
            <ChevronDown className="nav-group-chevron" size={15} />
          </button>
          {realNavigationActive && (
            <div className="subnav nav-group-subnav">
              <button
                className={mainTab === "tracking" ? "active" : ""}
                onClick={() => { setMainTab("tracking"); setSidebarOpen(false); }}
              >
                Aporte mensual
              </button>
              <button
                className={mainTab === "actualSummary" ? "active" : ""}
                onClick={() => { setMainTab("actualSummary"); setSidebarOpen(false); }}
              >
                Resumen
              </button>
              <button
                className={mainTab === "actualResults" ? "active" : ""}
                onClick={() => { setMainTab("actualResults"); setSidebarOpen(false); }}
              >
                Explora resultados
              </button>
              {mainTab === "actualResults" && (
                <div className="subnav nested-subnav">
                  {[
                    ["annual", "Resumen anual"],
                    ["semester", "Pagos semestrales"],
                    ["monthly", "Detalle mensual"],
                    ["transfers", "Historial de traslados"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={actualResultSection === id ? "active" : ""}
                      onClick={() => { setActualResultSection(id as ResultSection); setSidebarOpen(false); }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <button className={mainTab === "comparison" ? "active" : ""} onClick={() => { setMainTab("comparison"); setSidebarOpen(false); }}>
            <Scale size={18} /> Ideal vs Real
          </button>

          <div className="sidebar-card">
            <div><ShieldCheck size={18} /> <strong>Simulación segura</strong></div>
            <p>No se conecta a ninguna entidad ni mueve dinero real.</p>
          </div>
          <div className="server-card" aria-label="Estado del servidor">
            <div>
              <Database size={17} />
              <strong>Servidor: {serverConnected ? "conectado" : "desconectado"}</strong>
            </div>
            <small>Base de datos: {dirty ? "cambios pendientes" : "guardada"}</small>
            <small>
              Última actualización:{" "}
              {new Date(updatedAt).toLocaleString("es-CO")}
            </small>
            <small>Revisión: {revision}</small>
            <div className="server-card-actions">
              <button onClick={() => void reloadFromServer()}>
                <RefreshCcw size={14} /> Recargar
              </button>
              <button onClick={() => void createBackup()}>
                <Database size={14} /> Crear respaldo local
              </button>
            </div>
          </div>
          <div className="sidebar-footer">
            <button onClick={exportJson}><FileJson size={16} /> Copia completa JSON</button>
            <button onClick={exportActual}><Download size={16} /> Ahorro real CSV</button>
            <button onClick={exportComparison}><Download size={16} /> Ideal vs Real CSV</button>
            <button onClick={exportReconciliations}><Download size={16} /> Conciliaciones CSV</button>
          </div>
        </aside>
        {sidebarOpen && <div className="backdrop sidebar-backdrop" onClick={() => setSidebarOpen(false)} />}

        <main className="content">
          {migrationCandidate && (
            <div className="migration-banner" role="status">
              <Database size={20} />
              <div>
                <strong>
                  Se encontraron datos financieros guardados en este navegador.
                </strong>
                <p>
                  ¿Deseas migrarlos a la base de datos compartida? El proceso
                  creará un respaldo SQLite y verificará el resultado.
                </p>
              </div>
              <div className="banner-actions">
                <button
                  onClick={() => void migrateLegacyData()}
                  disabled={migrationBusy}
                >
                  {migrationBusy ? "Migrando…" : "Migrar al servidor"}
                </button>
                <button onClick={() => downloadJson(migrationCandidate, "respaldo-previo-migracion")}>
                  Descargar respaldo JSON
                </button>
                <button onClick={() => setMigrationCandidate(null)}>
                  Ignorar por ahora
                </button>
              </div>
            </div>
          )}
          {remoteRevision !== null && (
            <div className="validation-banner conflict-banner" role="alert">
              <AlertCircle size={20} />
              <div>
                <strong>
                  Hay una versión más reciente guardada desde otro dispositivo.
                </strong>
                <p>
                  Revisión local {revision}; revisión del servidor{" "}
                  {remoteRevision}. No se sobrescribieron tus cambios.
                </p>
              </div>
              <div className="banner-actions">
                <button onClick={() => void reloadFromServer()}>
                  Recargar desde el servidor
                </button>
                <button
                  onClick={() =>
                    notify(
                      "La edición local se conserva. Expórtala o recarga antes de volver a guardar.",
                    )
                  }
                >
                  Mantener edición local
                </button>
                <button onClick={exportLocalJson}>
                  Exportar edición local
                </button>
              </div>
            </div>
          )}
          {saveError && remoteRevision === null && (
            <div className="validation-banner" role="alert">
              <AlertCircle size={20} />
              <div>
                <strong>{saveStatusText[saveStatus]}</strong>
                <p>{saveError}</p>
              </div>
              {!serverConnected && (
                <button onClick={() => void performSave(true)}>
                  Reintentar guardado
                </button>
              )}
            </div>
          )}
          {issues.length > 0 && (
            <div className="validation-banner" role="alert">
              <AlertCircle size={20} />
              <div>
                <strong>{issues.length === 1 ? "Hay un dato por revisar" : `Hay ${issues.length} datos por revisar`}</strong>
                <p>{issues.slice(0, 2).map((issue) => issue.message).join(" · ")}</p>
              </div>
              <button onClick={() => { setMainTab("plan"); setPlanSection(issues[0].field === "tuition" ? "tuition" : "income"); }}>
                Revisar <ArrowRight size={15} />
              </button>
            </div>
          )}
          {transferIssues.length > 0 && (
            <div className="validation-banner" role="alert">
              <AlertCircle size={20} />
              <div>
                <strong>Hay traslados confirmados que requieren revisión</strong>
                <p>{transferIssues.slice(0, 2).join(" · ")}</p>
              </div>
            </div>
          )}

          {mainTab === "overview" && (
            <Overview
              settings={settings}
              result={result}
              projection={updatedProjection.series}
              actualSummary={actualSummary}
              actualCalculated={actualCalculated}
              comparison={comparison}
              openTransfer={openTransfer}
              onEdit={() => { setMainTab("plan"); setPlanSection("scenario"); }}
            />
          )}

          {mainTab === "ideal" && (
            <IdealPlanView
              settings={settings}
              result={result}
              chartData={chartData}
              onConfigure={() => {
                setMainTab("plan");
                setPlanSection("scenario");
              }}
              onResults={() => setMainTab("results")}
            />
          )}

          {mainTab === "tracking" && (
            <ActualTrackingView
              settings={settings}
              tracking={actualTracking}
              idealRows={primaryRows}
              onChange={setActualTracking}
              notify={notify}
            />
          )}

          {mainTab === "actualSummary" && (
            <ActualSummaryView
              settings={settings}
              calculated={actualCalculated}
              summary={actualSummary}
            />
          )}

          {mainTab === "actualResults" && (
            <ActualResults
              settings={settings}
              calculated={actualCalculated}
              summary={actualSummary}
              section={actualResultSection}
              setSection={setActualResultSection}
              onExport={exportActual}
            />
          )}

          {mainTab === "comparison" && (
            <PlanActualComparisonView
              comparison={comparison}
              projectionBlockers={updatedProjection.blockers}
              actualSummary={actualSummary}
            />
          )}

          {mainTab === "plan" && (
            <Plan
              settings={settings}
              setSettings={setSettings}
              section={planSection}
              setSection={setPlanSection}
              restore={restore}
              duplicateConfiguration={duplicateConfiguration}
              clearConfiguration={clearConfiguration}
              exportJson={exportJson}
              importRef={importRef}
              importJson={importJson}
              notify={notify}
            />
          )}

          {mainTab === "results" && (
            <Results
              settings={settings}
              result={result}
              section={resultSection}
              setSection={setResultSection}
              annualRows={annualRows}
              tuitionRows={tuitionRows}
              monthlyRows={monthlyRows}
              monthlyFilter={monthlyFilter}
              setMonthlyFilter={setMonthlyFilter}
              onlyEvents={onlyEvents}
              setOnlyEvents={setOnlyEvents}
              scenarioColor={scenarioColor}
              exportSection={exportSection}
            />
          )}
        </main>
      </div>

      {transferRow && (
        <TransferModal
          row={transferRow}
          amount={transferAmount}
          setAmount={setTransferAmount}
          settings={settings}
          onClose={() => setTransferRow(null)}
          onPostpone={postponeTransfer}
          onDismiss={dismissTransfer}
          onConfirm={confirmTransfer}
        />
      )}
      {toast && <div className="toast" role="status" aria-live="polite"><Check size={17} /> {toast}</div>}
    </div>
  );
}

function IdealPlanView({
  settings,
  result,
  chartData,
  onConfigure,
  onResults,
}: {
  settings: Settings;
  result: ReturnType<typeof simulate>;
  chartData: Array<Record<string, string | number | boolean>>;
  onConfigure: () => void;
  onResults: () => void;
}) {
  const summary = result.summaries[0];
  if (!summary) {
    return <EmptyState>Activa al menos un escenario para ver el Ahorro ideal.</EmptyState>;
  }
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow green">
            <Sparkles size={14} /> Proyección original
          </div>
          <h1>Resumen del Ahorro ideal</h1>
          <p>
            Esta es la simulación automática original. Nunca se sobrescribe con
            los registros reales.
          </p>
        </div>
        <button className="button button-primary" onClick={onConfigure}>
          <Settings2 size={16} /> Ajustar supuestos
        </button>
      </section>
      <section className="ideal-summary-grid">
        <article className="ideal-primary">
          <span>Patrimonio ideal al final</span>
          <strong>{currency(summary.finalTotal)}</strong>
          <small>{monthLabel(settings.endDate)}</small>
        </article>
        <article>
          <span>Saldo ideal Nu</span>
          <strong>{currency(summary.finalNu)}</strong>
        </article>
        <article>
          <span>Saldo ideal externo</span>
          <strong>{currency(summary.finalExternal)}</strong>
        </article>
        <article>
          <span>Aportes ideales</span>
          <strong>{currency(summary.totalContributions)}</strong>
        </article>
        <article>
          <span>Semestres proyectados</span>
          <strong>{summary.semestersPaid}</strong>
        </article>
      </section>
      <section className="panel chart-panel ideal-chart">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Proyección mensual</span>
            <h2>Evolución del patrimonio ideal</h2>
          </div>
          <button className="text-button" onClick={onResults}>
            Ver resultados detallados <ArrowRight size={15} />
          </button>
        </div>
          <div className="chart-wrap medium" role="img" aria-label="Evolución mensual del patrimonio del Ahorro ideal; los valores exactos están disponibles en Resultados">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="var(--chart-grid)" />
              <XAxis dataKey="date" interval="preserveStartEnd" tickLine={false} axisLine={false} />
              <YAxis tickFormatter={(value) => currency(value, true)} tickLine={false} axisLine={false} width={72} />
              <Tooltip content={<ChartTooltip />} />
              <Line type="monotone" dataKey="Patrimonio total" stroke="#16785e" strokeWidth={3} dot={false} />
              <Line type="monotone" dataKey="Saldo Nu" stroke="#71c5ad" strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey={settings.concentration.externalAccountName} stroke="#7c5ce7" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </>
  );
}

function Overview({
  settings,
  result,
  projection,
  actualSummary,
  actualCalculated,
  comparison,
  openTransfer,
  onEdit,
}: {
  settings: Settings;
  result: ReturnType<typeof simulate>;
  projection: Array<{
    month: string;
    ideal: number;
    actual: number | null;
    updated: number | null;
  }>;
  actualSummary: ReturnType<typeof summarizeActual>;
  actualCalculated: ReturnType<typeof calculateActualTracking>;
  comparison: ReturnType<typeof buildPlanActualComparison>;
  openTransfer: (row: MonthlyResult) => void;
  onEdit: () => void;
}) {
  const summary = result.summaries[0];
  const lastRealMonth = actualSummary.lastConfirmedMonth;
  const defaultActualChartEndMonth = lastRealMonth
    ? nextMonth(lastRealMonth)
    : settings.startDate;
  const [summaryView, setSummaryView] = useState<"ideal" | "actual">(
    actualSummary.registeredMonths ? "actual" : "ideal",
  );
  const [chartView, setChartView] = useState<ChartView>(
    lastRealMonth ? "actual" : "ideal",
  );
  const [selectedChartMonth, setSelectedChartMonth] = useState(
    lastRealMonth ?? settings.startDate,
  );
  const [actualChartEndMonth, setActualChartEndMonth] = useState(
    defaultActualChartEndMonth,
  );
  const [showUpdatedProjection, setShowUpdatedProjection] = useState(false);
  const [buttonChartTooltip, setButtonChartTooltip] = useState<
    "hidden" | "visible" | "fading"
  >("hidden");
  const buttonTooltipFadeTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const buttonTooltipHideTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const clearButtonTooltipTimers = useCallback(() => {
    if (buttonTooltipFadeTimer.current) {
      clearTimeout(buttonTooltipFadeTimer.current);
      buttonTooltipFadeTimer.current = null;
    }
    if (buttonTooltipHideTimer.current) {
      clearTimeout(buttonTooltipHideTimer.current);
      buttonTooltipHideTimer.current = null;
    }
  }, []);
  const hideButtonChartTooltip = useCallback(() => {
    clearButtonTooltipTimers();
    setButtonChartTooltip("hidden");
  }, [clearButtonTooltipTimers]);
  const showButtonChartTooltip = useCallback(() => {
    clearButtonTooltipTimers();
    setButtonChartTooltip("visible");
    buttonTooltipFadeTimer.current = setTimeout(() => {
      setButtonChartTooltip("fading");
    }, 2200);
    buttonTooltipHideTimer.current = setTimeout(() => {
      setButtonChartTooltip("hidden");
    }, 3000);
  }, [clearButtonTooltipTimers]);
  useEffect(
    () => () => {
      clearButtonTooltipTimers();
    },
    [clearButtonTooltipTimers],
  );
  const previousLastRealMonth = useRef(lastRealMonth);
  useEffect(() => {
    if (lastRealMonth && previousLastRealMonth.current !== lastRealMonth) {
      setChartView("actual");
      setSelectedChartMonth(lastRealMonth);
      setActualChartEndMonth(defaultActualChartEndMonth);
      hideButtonChartTooltip();
    } else if (!lastRealMonth) {
      setChartView("ideal");
      setSelectedChartMonth(settings.startDate);
      setActualChartEndMonth(settings.startDate);
      hideButtonChartTooltip();
    }
    previousLastRealMonth.current = lastRealMonth;
  }, [
    defaultActualChartEndMonth,
    hideButtonChartTooltip,
    lastRealMonth,
    settings.startDate,
  ]);
  const projectionChartData = useMemo(
    () =>
      projection.map((row) => ({
        fullDate: row.month,
        date: monthLabel(row.month, true),
        "Ahorro ideal": row.ideal,
        "Patrimonio real": row.actual,
        "Proyección actualizada": row.updated,
      })),
    [projection],
  );
  const visibleChartData = useMemo(
    () =>
      filterChartForView(
        projectionChartData,
        actualChartEndMonth,
        chartView,
      ),
    [projectionChartData, actualChartEndMonth, chartView],
  );
  const selectedChartRow = projectionChartData.find(
    (row) => row.fullDate === selectedChartMonth,
  );
  const chartMonthNeighbors = getChartMonthNeighbors(
    projectionChartData,
    selectedChartMonth,
  );
  const selectChartMonth = (month: string) => {
    setSelectedChartMonth(month);
    if (chartView === "actual") {
      setActualChartEndMonth((current) =>
        moveActualChartWindow(projectionChartData, current, month),
      );
    }
    showButtonChartTooltip();
  };
  const selectedVisibleIndex = visibleChartData.findIndex(
    (row) => row.fullDate === selectedChartMonth,
  );
  const selectedPointPosition =
    selectedVisibleIndex < 0
      ? 50
      : visibleChartData.length <= 1
        ? 50
        : (selectedVisibleIndex / (visibleChartData.length - 1)) * 100;
  const selectedPointAlignment =
    selectedVisibleIndex <= 0
      ? "start"
      : selectedVisibleIndex >= visibleChartData.length - 1
        ? "end"
        : "center";
  const selectedChartTooltipPayload = selectedChartRow
    ? [
        {
          color: "#8ea19a",
          name: "Ahorro ideal",
          value: selectedChartRow["Ahorro ideal"],
        },
        {
          color: "#1f9d78",
          name: "Ahorro real",
          value:
            selectedChartRow["Patrimonio real"] === null
              ? "Sin datos"
              : selectedChartRow["Patrimonio real"],
        },
        ...(showUpdatedProjection
          ? [
              {
                color: "#7c5ce7",
                name: "Actualizada",
                value:
                  selectedChartRow["Proyección actualizada"] === null
                    ? "Sin datos"
                    : selectedChartRow["Proyección actualizada"],
              },
            ]
          : []),
      ]
    : [];
  const pending = summary?.pendingTransfer;
  const finalMonth = result.monthly.filter((row) => row.scenarioId === summary?.scenario.id).at(-1);
  const nextIdealTuition = result.monthly.find(
    (row) => row.scenarioId === summary?.scenario.id && row.tuitionAmount > 0,
  );
  const primaryResultRows = result.monthly.filter(
    (row) => row.scenarioId === summary?.scenario.id,
  );
  const idealTuitionAttempts = primaryResultRows.flatMap(
    (row) => row.tuitionAttempts,
  );
  const tuitionStages = settings.tuitionEvents
    .filter((event) => event.enabled)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((event) => ({
      ...event,
      latestAttempt: idealTuitionAttempts
        .filter((attempt) => attempt.eventId === event.id)
        .at(-1),
    }));
  const enabledTuitionCount = tuitionStages.length;
  const idealCoveragePercentage = enabledTuitionCount
    ? Math.round(
        ((summary?.semestersPaid ?? 0) / enabledTuitionCount) * 100,
      )
    : 0;
  const actualTuitionPayments = actualCalculated.filter(
    (month) => month.record.actualTuitionPayment > 0,
  );
  const actualCoveragePercentage = enabledTuitionCount
    ? Math.min(
        100,
        Math.round(
          (actualTuitionPayments.length / enabledTuitionCount) * 100,
        ),
      )
    : 0;
  const lastCompared = comparison
    .filter((row) => row.actualTotalBalance !== null)
    .at(-1);
  const realCompliance = calculateContributionCompliance(
    primaryResultRows,
    actualCalculated,
  );
  if (!summary) return <EmptyState>Activa al menos un escenario para ver el panorama.</EmptyState>;
  return (
    <>
      <section className="page-heading overview-heading">
        <div>
          <h1>Panorama</h1>
        </div>
        <button className="button button-primary" onClick={onEdit}>
          <Settings2 size={17} /> Ajustar mi ahorro
        </button>
      </section>

      <section className="dual-overview">
        <article className="dual-group ideal">
          <div className="dual-title">
            <span className="icon-soft"><Sparkles size={17} /></span>
            <div>
              <span>Ahorro ideal</span>
              <strong>Proyección automática</strong>
            </div>
          </div>
          <div><span>Patrimonio</span><strong>{currency(summary.finalTotal)}</strong></div>
          <div><span>Saldo Nu</span><strong>{currency(summary.finalNu)}</strong></div>
          <div><span>Saldo externo</span><strong>{currency(summary.finalExternal)}</strong></div>
          <div><span>Aportes</span><strong>{currency(summary.totalContributions)}</strong></div>
          <div><span>Rendimientos</span><strong>{currency(summary.grossYield + summary.externalYield - summary.withholding)}</strong></div>
          <div><span>Próxima matrícula</span><strong>{nextIdealTuition ? monthLabel(nextIdealTuition.date, true) : "Sin pagos"}</strong></div>
          <div><span>Semestres</span><strong>{summary.semestersPaid}</strong></div>
        </article>
        <article className="dual-group actual">
          <div className="dual-title">
            <span className="icon-soft mint"><FileCheck2 size={17} /></span>
            <div>
              <span>Ahorro real</span>
              <strong>{actualSummary.registeredMonths ? `${actualSummary.registeredMonths} meses registrados` : "Aún sin registros"}</strong>
            </div>
          </div>
          <div><span>Patrimonio</span><strong>{currency(actualSummary.finalTotalBalance)}</strong></div>
          <div><span>Saldo Nu</span><strong>{currency(actualSummary.finalNuBalance)}</strong></div>
          <div><span>Saldo externo</span><strong>{currency(actualSummary.finalExternalBalance)}</strong></div>
          <div><span>Aportes</span><strong>{currency(actualSummary.totalContributions)}</strong></div>
          <div><span>Rendimientos</span><strong>{currency(actualSummary.totalGrossYield - actualSummary.totalWithholding)}</strong></div>
          <div><span>Meses registrados</span><strong>{actualSummary.registeredMonths}</strong></div>
          <div><span>Cumplimiento</span><strong>{realCompliance === null ? "No aplica" : `${realCompliance.toFixed(1)}%`}</strong></div>
        </article>
        <article className="dual-difference">
          <span>Diferencia al último registro</span>
          <strong className={(lastCompared?.totalVariation ?? 0) < 0 ? "negative-number" : "positive-number"}>
            {lastCompared?.totalVariation == null ? "Sin datos reales" : currency(lastCompared.totalVariation)}
          </strong>
          <small>
            {actualSummary.lastConfirmedMonth
              ? `Último confirmado: ${monthLabel(actualSummary.lastConfirmedMonth, true)}`
              : "Registra y confirma un mes para comparar"}
          </small>
        </article>
      </section>

      <section className="overview-chart-section">
        <article className="panel chart-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Ahorro ideal y real</span>
              <h2>Patrimonio ideal, real y proyección actualizada</h2>
            </div>
            <div className="chart-toolbar">
              <div
                className="chart-range-toggle"
                role="group"
                aria-label="Vista mostrada en la gráfica"
              >
                <button
                  type="button"
                  className={chartView === "actual" ? "active" : ""}
                  onClick={() => {
                    setChartView("actual");
                    setSelectedChartMonth(
                      lastRealMonth ?? projectionChartData.at(0)?.fullDate ?? settings.startDate,
                    );
                    setActualChartEndMonth(
                      lastRealMonth
                        ? nextMonth(lastRealMonth)
                        : projectionChartData.at(0)?.fullDate ?? settings.startDate,
                    );
                  }}
                  disabled={!lastRealMonth}
                  aria-pressed={chartView === "actual"}
                >
                  Ahorro real
                </button>
                <button
                  type="button"
                  className={chartView === "ideal" ? "active" : ""}
                  onClick={() => setChartView("ideal")}
                  aria-pressed={chartView === "ideal"}
                >
                  Ahorro ideal
                </button>
              </div>
              <button
                type="button"
                className={`projection-visibility-toggle ${
                  showUpdatedProjection ? "active" : ""
                }`}
                onClick={() => setShowUpdatedProjection((visible) => !visible)}
                aria-pressed={showUpdatedProjection}
              >
                <Sparkles size={13} />
                {showUpdatedProjection
                  ? "Ocultar proyección actualizada"
                  : "Mostrar proyección actualizada"}
              </button>
              <div className="chart-legend">
                <span><i className="dot ideal-line" /> Ahorro ideal</span>
                <span><i className="dot real-line" /> Real</span>
                {showUpdatedProjection && (
                  <span><i className="dot updated-line" /> Actualizada</span>
                )}
              </div>
            </div>
          </div>
          <div className="chart-month-navigation">
            <button
              type="button"
              className="chart-month-step"
              aria-label={
                chartMonthNeighbors.previous
                  ? `Ver ${monthLabel(chartMonthNeighbors.previous.fullDate, true)}`
                  : "No hay un mes anterior"
              }
              disabled={!chartMonthNeighbors.previous}
              onClick={() =>
                chartMonthNeighbors.previous &&
                selectChartMonth(chartMonthNeighbors.previous.fullDate)
              }
            >
              <ChevronLeft size={15} />
              <span>
                <small>Ver</small>
                <strong>
                  {chartMonthNeighbors.previous
                    ? monthLabel(chartMonthNeighbors.previous.fullDate, true)
                    : "Inicio"}
                </strong>
              </span>
            </button>
            <div className="chart-current-month" aria-live="polite">
              <small>Mes seleccionado</small>
              <strong>
                {selectedChartRow
                  ? monthLabel(selectedChartRow.fullDate, true)
                  : "Sin mes"}
              </strong>
            </div>
            <button
              type="button"
              className="chart-month-step next"
              aria-label={
                chartMonthNeighbors.next
                  ? `Ver ${monthLabel(chartMonthNeighbors.next.fullDate, true)}`
                  : "No hay un mes siguiente"
              }
              disabled={!chartMonthNeighbors.next}
              onClick={() =>
                chartMonthNeighbors.next &&
                selectChartMonth(chartMonthNeighbors.next.fullDate)
              }
            >
              <span>
                <small>Ver</small>
                <strong>
                  {chartMonthNeighbors.next
                    ? monthLabel(chartMonthNeighbors.next.fullDate, true)
                    : "Fin"}
                </strong>
              </span>
              <ChevronRight size={15} />
            </button>
          </div>
          <div
            className="chart-wrap"
            role="img"
            onMouseEnter={hideButtonChartTooltip}
            aria-label={`Evolución del patrimonio en la vista de ${
              chartView === "actual" ? "Ahorro real" : "Ahorro ideal"
            }, con ${
              selectedChartRow
                ? monthLabel(selectedChartRow.fullDate, true)
                : "ningún mes"
            } seleccionado; consulte Resultados para los valores exactos`}
          >
            {buttonChartTooltip !== "hidden" &&
              selectedChartRow &&
              selectedVisibleIndex >= 0 && (
                <div
                  className={`chart-selected-tooltip ${selectedPointAlignment} ${buttonChartTooltip}`}
                  style={{ left: `${selectedPointPosition}%` }}
                >
                  <ChartTooltip
                    active
                    label={selectedChartRow.date}
                    payload={selectedChartTooltipPayload}
                  />
                </div>
              )}
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={visibleChartData}
                margin={{ top: 12, right: 8, left: -4, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 4" vertical={false} stroke="var(--chart-grid)" />
                <XAxis dataKey="date" interval="preserveStartEnd" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} />
                <YAxis padding={{ top: 10, bottom: 10 }} tickFormatter={(value) => currency(value, true)} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 11 }} width={72} />
                <Tooltip content={<ChartTooltip />} />
                {selectedChartRow && (
                  <ReferenceLine
                    x={selectedChartRow.date}
                    stroke="var(--green)"
                    strokeDasharray="2 4"
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="Ahorro ideal"
                  stroke="#8ea19a"
                  strokeDasharray="5 4"
                  strokeWidth={2}
                  dot={chartView === "actual" ? { r: 3 } : false}
                />
                {showUpdatedProjection && (
                  <Line
                    type="monotone"
                    dataKey="Proyección actualizada"
                    stroke="#7c5ce7"
                    strokeWidth={2.5}
                    dot={chartView === "actual" ? { r: 3 } : false}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="Patrimonio real"
                  stroke="#1f9d78"
                  strokeWidth={3}
                  connectNulls={false}
                  dot={chartView === "actual" ? { r: 4 } : false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="chart-note">
            <Info size={14} />
            <span>
              La serie real termina en el último mes confirmado.{" "}
              {showUpdatedProjection
                ? "La Proyección actualizada se dibuja detrás de la serie real y continúa desde ese cierre."
                : "Activa la Proyección actualizada cuando quieras consultar la estimación futura."}
            </span>
          </div>
        </article>

      </section>

      <section className="overview-summary-section">
        <div className="overview-summary-head">
          <div>
            <span className="eyebrow">Detalle rápido</span>
            <h2>
              {summaryView === "ideal"
                ? "Resumen del Ahorro ideal"
                : "Resumen del Ahorro real"}
            </h2>
          </div>
          <div
            className="segmented overview-summary-toggle"
            role="group"
            aria-label="Resumen mostrado"
          >
            <button
              type="button"
              className={summaryView === "ideal" ? "active" : ""}
              onClick={() => setSummaryView("ideal")}
              aria-pressed={summaryView === "ideal"}
            >
              Ahorro ideal
            </button>
            <button
              type="button"
              className={summaryView === "actual" ? "active" : ""}
              onClick={() => setSummaryView("actual")}
              aria-pressed={summaryView === "actual"}
            >
              Ahorro real
            </button>
          </div>
        </div>

        <div className="hero-grid" aria-live="polite">
          {summaryView === "ideal" ? (
            <>
              <article className="total-card">
                <div className="card-label">
                  <span className="icon-soft"><WalletCards size={18} /></span>
                  Patrimonio proyectado
                  <FieldHelp text="Suma del saldo proyectado en Nu y el fondo externo." />
                </div>
                <div className="hero-value">{currency(summary.finalTotal)}</div>
                <div className="hero-date">
                  al cierre de {monthLabel(finalMonth?.date ?? settings.endDate)}
                </div>
                <div className="composition-bar">
                  <span style={{ width: `${summary.finalTotal ? (summary.finalNu / summary.finalTotal) * 100 : 0}%` }} />
                </div>
                <div className="composition-legend">
                  <div><i className="dot nu" /><span>En Cajita Nu</span><strong>{currency(summary.finalNu)}</strong></div>
                  <div><i className="dot external" /><span>{settings.concentration.externalAccountName}</span><strong>{currency(summary.finalExternal)}</strong></div>
                </div>
              </article>
              <article className="metric-card">
                <div className="metric-top"><span className="icon-soft mint"><PiggyBank size={19} /></span><span className="trend positive">ahorro ideal</span></div>
                <span>Aportes proyectados</span>
                <strong>{currency(summary.totalContributions)}</strong>
                <p>{summary.scenario.savingsRate}% de los ingresos y primas</p>
              </article>
              <article className="metric-card">
                <div className="metric-top"><span className="icon-soft lavender"><TrendingUp size={19} /></span><span className="trend">estimado</span></div>
                <span>Rendimiento neto proyectado</span>
                <strong>{currency(summary.grossYield + summary.externalYield - summary.withholding)}</strong>
                <p>Después de {currency(summary.withholding)} de retención</p>
              </article>
              <article className="metric-card">
                <div className="metric-top"><span className="icon-soft sand"><BookOpen size={19} /></span><span className={`trend ${summary.firstFailure ? "negative" : "positive"}`}>{summary.firstFailure ? "por ajustar" : "cubiertos"}</span></div>
                <span>Semestres financiados</span>
                <strong>{summary.semestersPaid}<small> / {settings.tuitionEvents.filter((event) => event.enabled).length}</small></strong>
                <p>{currency(summary.tuitionPaid)} en matrículas</p>
              </article>
            </>
          ) : (
            <>
              <article className="total-card actual-total-card">
                <div className="card-label">
                  <span className="icon-soft"><FileCheck2 size={18} /></span>
                  Patrimonio real
                  <FieldHelp text="Suma del saldo real calculado en Nu y el fondo externo." />
                </div>
                <div className="hero-value">{currency(actualSummary.finalTotalBalance)}</div>
                <div className="hero-date">
                  {lastRealMonth
                    ? `al cierre de ${monthLabel(lastRealMonth)}`
                    : "sin meses confirmados"}
                </div>
                <div className="composition-bar">
                  <span style={{ width: `${actualSummary.finalTotalBalance ? (actualSummary.finalNuBalance / actualSummary.finalTotalBalance) * 100 : 0}%` }} />
                </div>
                <div className="composition-legend">
                  <div><i className="dot nu" /><span>En Cajita Nu</span><strong>{currency(actualSummary.finalNuBalance)}</strong></div>
                  <div><i className="dot external" /><span>{settings.concentration.externalAccountName}</span><strong>{currency(actualSummary.finalExternalBalance)}</strong></div>
                </div>
              </article>
              <article className="metric-card">
                <div className="metric-top"><span className="icon-soft mint"><PiggyBank size={19} /></span><span className="trend positive">real</span></div>
                <span>Aportes realizados</span>
                <strong>{currency(actualSummary.totalContributions)}</strong>
                <p>{actualSummary.registeredMonths} meses registrados</p>
              </article>
              <article className="metric-card">
                <div className="metric-top"><span className="icon-soft lavender"><TrendingUp size={19} /></span><span className="trend">real</span></div>
                <span>Rendimiento neto recibido</span>
                <strong>{currency(actualSummary.totalGrossYield - actualSummary.totalWithholding)}</strong>
                <p>Después de {currency(actualSummary.totalWithholding)} de retención</p>
              </article>
              <article className="metric-card">
                <div className="metric-top"><span className="icon-soft sand"><BookOpen size={19} /></span><span className="trend positive">pagado</span></div>
                <span>Matrículas pagadas</span>
                <strong>{currency(actualSummary.totalTuition)}</strong>
                <p>{currency(actualSummary.totalGmf)} en GMF y costos</p>
              </article>
            </>
          )}
        </div>

        <div className="quick-detail-grid">
          <article className="panel coverage-card">
            <div className="coverage-copy">
              <span className="eyebrow">
                {summaryView === "ideal" ? "Cobertura proyectada" : "Avance real"}
              </span>
              <h3>
                {summaryView === "ideal"
                  ? "¿Cuánto de la universidad cubre el ahorro?"
                  : "¿Cuántas etapas ya tienen un pago registrado?"}
              </h3>
              <p>
                {summaryView === "ideal"
                  ? `${summary.semestersPaid} de ${enabledTuitionCount} matrículas tienen cobertura en el ahorro ideal.`
                  : `${actualTuitionPayments.length} de ${enabledTuitionCount} matrículas tienen un pago real confirmado.`}
              </p>
            </div>
            <div
              className="coverage-ring"
              style={{
                background: `conic-gradient(var(--green) 0 ${
                  summaryView === "ideal"
                    ? idealCoveragePercentage
                    : actualCoveragePercentage
                }%, var(--chart-grid) ${
                  summaryView === "ideal"
                    ? idealCoveragePercentage
                    : actualCoveragePercentage
                }% 100%)`,
              }}
              aria-label={`${
                summaryView === "ideal"
                  ? idealCoveragePercentage
                  : actualCoveragePercentage
              } por ciento`}
            >
              <span>
                {summaryView === "ideal"
                  ? idealCoveragePercentage
                  : actualCoveragePercentage}
                <small>%</small>
              </span>
            </div>
          </article>

          <article className="panel tuition-stages-card">
            <div className="tuition-stages-head">
              <div>
                <span className="eyebrow">Pagos por etapa</span>
                <h3>
                  {summaryView === "ideal"
                    ? "Cobertura de cada semestre"
                    : "Pagos reales por semestre"}
                </h3>
              </div>
              <small>
                {summaryView === "ideal"
                  ? "Según la simulación actual"
                  : "Los pagos confirmados se asignan en orden"}
              </small>
            </div>

            {tuitionStages.length ? (
              <div className="tuition-stage-list">
                {tuitionStages.map((stage, index) => {
                  const actualPayment = actualTuitionPayments[index];
                  const isIdealPaid = stage.latestAttempt?.status === "paid";
                  const isActualPaid = Boolean(actualPayment);
                  const isPastDue =
                    Boolean(lastRealMonth) && stage.date <= lastRealMonth!;
                  const statusClass =
                    summaryView === "ideal"
                      ? isIdealPaid
                        ? "success"
                        : stage.latestAttempt?.status === "pending_retry"
                          ? "warning"
                          : stage.latestAttempt?.status === "failed"
                            ? "danger"
                            : "neutral"
                      : isActualPaid
                        ? "success"
                        : isPastDue
                          ? "warning"
                          : "neutral";
                  const statusLabel =
                    summaryView === "ideal"
                      ? isIdealPaid
                        ? "Con cobertura"
                        : stage.latestAttempt
                          ? tuitionStatusText[stage.latestAttempt.status]
                          : "Pendiente"
                      : isActualPaid
                        ? "Pago registrado"
                        : isPastDue
                          ? "Sin pago registrado"
                          : "Pendiente";
                  return (
                    <div
                      className="tuition-stage"
                      key={stage.id}
                    >
                      <div className={`tuition-stage-marker ${statusClass}`}>
                        {statusClass === "success"
                          ? <Check size={14} />
                          : index + 1}
                      </div>
                      <span>{stage.label}</span>
                      <strong>
                        {summaryView === "ideal"
                          ? currency(stage.amount)
                          : actualPayment
                            ? currency(actualPayment.record.actualTuitionPayment)
                            : currency(stage.amount)}
                      </strong>
                      <small>
                        {summaryView === "actual" && actualPayment
                          ? monthLabel(actualPayment.record.month, true)
                          : monthLabel(stage.date, true)}
                      </small>
                      <em className={`status-pill ${statusClass}`}>
                        {statusLabel}
                      </em>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="tuition-stages-empty">
                No hay matrículas activas configuradas.
              </div>
            )}
          </article>
        </div>
      </section>

      {pending && (
        <div className="concentration-alert">
          <div className="alert-icon"><Bell size={22} /></div>
          <div className="alert-copy">
            <span className="status-pill warning">Acción sugerida</span>
            <h3>Tu saldo en Nu se acerca al umbral que definiste</h3>
            <p>
              En {monthLabel(pending.date)} el saldo proyectado es {currency(pending.closingNuBalance)}.
              Puedes registrar un traslado de {currency(pending.suggestedExternalTransfer)} al fondo externo.
            </p>
          </div>
          <div className="alert-metrics">
            <span>Después del traslado</span>
            <strong>{currency(pending.closingNuBalance - pending.suggestedExternalTransfer)}</strong>
            <small>Patrimonio no cambia, salvo costos.</small>
          </div>
          <button className="button button-dark" onClick={() => openTransfer(pending)}>
            Revisar traslado <ArrowRight size={16} />
          </button>
        </div>
      )}

      {summary.firstFailure && (
        <div className="failure-alert" role="alert">
          <AlertCircle size={22} />
          <div>
            <strong>{summary.firstFailure.tuitionLabel} no alcanzaría a financiarse</strong>
            <p>
              En {monthLabel(summary.firstFailure.date)} faltarían {currency(summary.firstFailure.missing)}.
              El fondo nunca se lleva a saldo negativo.
            </p>
          </div>
          <button onClick={onEdit}>Ajustar ahorro</button>
        </div>
      )}

      <p className="disclaimer">
        <Info size={15} /> Esta herramienta presenta una simulación basada en los valores ingresados. Las tasas,
        impuestos, ingresos y matrículas reales pueden cambiar.
      </p>
    </>
  );
}

function Plan({
  settings,
  setSettings,
  section,
  setSection,
  restore,
  duplicateConfiguration,
  clearConfiguration,
  exportJson,
  importRef,
  importJson,
  notify,
}: {
  settings: Settings;
  setSettings: (settings: Settings | ((previous: Settings) => Settings)) => void;
  section: PlanSection;
  setSection: (section: PlanSection) => void;
  restore: () => void;
  duplicateConfiguration: () => void;
  clearConfiguration: () => void;
  exportJson: () => void;
  importRef: React.RefObject<HTMLInputElement>;
  importJson: (file?: File) => void;
  notify: (message: string) => void;
}) {
  const updateScenario = (id: string, patch: Partial<SavingsScenario>) =>
    setSettings({ ...settings, scenarios: settings.scenarios.map((item) => item.id === id ? { ...item, ...patch } : item) });
  const addScenario = () => {
    const index = settings.scenarios.length;
    setSettings({
      ...settings,
      scenarios: [...settings.scenarios, {
        id: `scenario-${Date.now()}`,
        name: `Ahorro alternativo ${index}`,
        savingsRate: 40,
        initialNuBalance: 0,
        initialExternalBalance: 0,
        enabled: true,
        color: palette[index % palette.length],
      }],
    });
  };
  const addYear = () => {
    const lastYear = Math.max(...settings.incomes.map((item) => item.year));
    const lastIncome = settings.incomes.find((item) => item.year === lastYear)?.monthlyIncome ?? 0;
    setSettings({
      ...settings,
      incomes: [...settings.incomes, {
        id: `income-${Date.now()}`,
        year: lastYear + 1,
        monthlyIncome: lastIncome,
        projectedMonthlyIncome: lastIncome,
        source: "manual",
        note: "",
      }],
      yieldRates: [...settings.yieldRates, {
        id: `rate-${Date.now()}`,
        year: lastYear + 1,
        effectiveAnnualRate: 8.75,
        projectedEffectiveAnnualRate: 8.75,
        source: "manual",
      }],
    });
  };
  const recordAnnualChange = (
    field: string,
    year: number,
    previousValue: number,
    newValue: number,
    source: "projection" | "manual" | "import",
    reason: string,
  ) => ({
    id: `annual-revision-${Date.now()}-${field}-${year}`,
    field,
    year,
    previousValue,
    newValue,
    source,
    reason,
    changedAt: new Date().toISOString(),
  });
  const updateIncome = (
    index: number,
    patch: Partial<Settings["incomes"][number]>,
  ) => {
    const current = settings.incomes[index];
    const nextValue = patch.monthlyIncome ?? current.monthlyIncome;
    setSettings({
      ...settings,
      incomes: settings.incomes.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              ...patch,
              source:
                patch.monthlyIncome !== undefined ? "manual" : item.source,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
      annualValueRevisions:
        patch.monthlyIncome !== undefined &&
        patch.monthlyIncome !== current.monthlyIncome
          ? [
              ...(settings.annualValueRevisions ?? []),
              recordAnnualChange(
                "monthlyIncome",
                current.year,
                current.monthlyIncome,
                nextValue,
                "manual",
                "Edición manual",
              ),
            ]
          : settings.annualValueRevisions ?? [],
    });
  };
  const updateYieldRate = (index: number, value: number) => {
    const current = settings.yieldRates[index];
    setSettings({
      ...settings,
      yieldRates: settings.yieldRates.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              effectiveAnnualRate: value,
              source: "manual",
              updatedAt: new Date().toISOString(),
            }
          : item,
      ),
      annualValueRevisions:
        value !== current.effectiveAnnualRate
          ? [
              ...(settings.annualValueRevisions ?? []),
              recordAnnualChange(
                "effectiveAnnualRate",
                current.year,
                current.effectiveAnnualRate,
                value,
                "manual",
                "Edición manual",
              ),
            ]
          : settings.annualValueRevisions ?? [],
    });
  };
  const projectIncomes = () => {
    const raw = window.prompt("Porcentaje anual para proyectar los años siguientes:", "5");
    if (raw == null) return;
    const rate = numberValue(raw);
    const sorted = [...settings.incomes].sort((a, b) => a.year - b.year);
    const revisions = [...(settings.annualValueRevisions ?? [])];
    const next = sorted.reduce<typeof sorted>((projected, item, index) => {
      const nextValue =
        index === 0
          ? item.monthlyIncome
          : Math.round(projected[index - 1].monthlyIncome * (1 + rate / 100));
      if (nextValue !== item.monthlyIncome) {
        revisions.push(
          recordAnnualChange(
            "monthlyIncome",
            item.year,
            item.monthlyIncome,
            nextValue,
            "projection",
            `Proyección anual de ${rate}%`,
          ),
        );
      }
      projected.push(index === 0 ? item : {
        ...item,
        monthlyIncome: nextValue,
        projectedMonthlyIncome: nextValue,
        source: "projection",
        updatedAt: new Date().toISOString(),
      });
      return projected;
    }, []);
    setSettings({ ...settings, incomes: next, annualValueRevisions: revisions });
    notify("Proyección aplicada. Cada año sigue siendo editable.");
  };
  const addTuition = () => {
    const last = [...settings.tuitionEvents].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
    const [year, month] = (last?.date ?? "2028-01").split("-").map(Number);
    const nextMonth = month === 1 ? 7 : 1;
    const nextYear = month === 1 ? year : year + 1;
    setSettings({
      ...settings,
      tuitionEvents: [...settings.tuitionEvents, {
        id: `tuition-${Date.now()}`,
        date: `${nextYear}-${String(nextMonth).padStart(2, "0")}`,
        label: `Semestre ${settings.tuitionEvents.length + 1}`,
        amount: last?.amount ?? 7_000_000,
        enabled: true,
        note: "",
      }],
    });
  };
  const updateTuition = (id: string, patch: Partial<TuitionEvent>) =>
    setSettings({ ...settings, tuitionEvents: settings.tuitionEvents.map((event) => event.id === id ? { ...event, ...patch } : event) });

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow green"><Settings2 size={14} /> Construye tu escenario</div>
          <h1>Configura tu Ahorro ideal</h1>
          <p>Cada dato es editable. Los resultados se recalculan al instante y se guardan en este navegador.</p>
        </div>
        <div className="heading-actions">
          <button className="button button-secondary" onClick={restore}><RefreshCcw size={16} /> Restaurar</button>
          <button className="button button-secondary" onClick={exportJson}><Download size={16} /> Exportar</button>
          <button className="button button-secondary" onClick={() => importRef.current?.click()}><Upload size={16} /> Importar</button>
          <button className="button button-secondary danger-button" onClick={clearConfiguration}><Trash2 size={16} /> Borrar datos</button>
          <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={(event) => importJson(event.target.files?.[0])} />
        </div>
      </section>

      <div className="mobile-tabs">
        <select value={section} onChange={(event) => setSection(event.target.value as PlanSection)} aria-label="Sección de configuración">
          <option value="scenario">Escenarios</option>
          <option value="income">Ingresos y prima</option>
          <option value="tuition">Matrículas</option>
          <option value="rates">Tasas e impuestos</option>
          <option value="protection">Protección del fondo</option>
        </select>
        <ChevronDown size={17} />
      </div>

      {section === "scenario" && (
        <section className="panel configuration-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Comparación flexible</span>
              <h2>Escenarios de ahorro</h2>
              <p>Activa varios escenarios de ahorro para comparar cómo cambia la cobertura.</p>
            </div>
            <button className="button button-primary" onClick={addScenario}><Plus size={16} /> Nuevo escenario</button>
          </div>
          <div className="scenario-list">
            {settings.scenarios.map((scenario, index) => (
              <article className={`scenario-card ${!scenario.enabled ? "disabled" : ""}`} key={scenario.id}>
                <div className="scenario-head">
                  <span className="scenario-color" style={{ background: scenario.color }} />
                  <div>
                    <small>{index === 0 ? "Escenario principal" : "Escenario comparativo"}</small>
                    <input aria-label="Nombre del escenario" value={scenario.name} onChange={(event) => updateScenario(scenario.id, { name: event.target.value })} />
                  </div>
                  <Switch checked={scenario.enabled} onChange={(enabled) => updateScenario(scenario.id, { enabled })} label={`Activar ${scenario.name}`} />
                  {index > 0 && (
                    <button className="icon-button danger" aria-label={`Eliminar ${scenario.name}`} onClick={() => setSettings({ ...settings, scenarios: settings.scenarios.filter((item) => item.id !== scenario.id) })}>
                      <Trash2 size={17} />
                    </button>
                  )}
                </div>
                <div className="scenario-fields">
                  <label>
                    <span>Porcentaje de ahorro</span>
                    <div className="range-value">
                      <input type="range" min="0" max="100" step="1" value={scenario.savingsRate} onChange={(event) => updateScenario(scenario.id, { savingsRate: numberValue(event.target.value) })} />
                      <div><input aria-label="Porcentaje de ahorro" type="number" min="0" max="100" value={scenario.savingsRate} onChange={(event) => updateScenario(scenario.id, { savingsRate: numberValue(event.target.value) })} /><span>%</span></div>
                    </div>
                  </label>
                  <label>
                    <span>Saldo inicial en Nu</span>
                    {inputMoney(scenario.initialNuBalance, (value) => updateScenario(scenario.id, { initialNuBalance: value }), "Saldo inicial en Nu")}
                  </label>
                  <label>
                    <span>Saldo inicial externo</span>
                    {inputMoney(scenario.initialExternalBalance, (value) => updateScenario(scenario.id, { initialExternalBalance: value }), "Saldo inicial externo")}
                  </label>
                </div>
              </article>
            ))}
          </div>
          <div className="panel-footer">
            <button className="text-button" onClick={duplicateConfiguration}><Copy size={15} /> Duplicar configuración</button>
            <span>El color se asigna automáticamente para las gráficas.</span>
          </div>
        </section>
      )}

      {section === "income" && (
        <div className="stack">
          <section className="panel configuration-panel">
            <div className="panel-head">
              <div><span className="eyebrow">Editable año a año</span><h2>Ingresos mensuales</h2><p>El valor escrito en cada fila es siempre la fuente definitiva.</p></div>
              <div className="heading-actions"><button className="button button-secondary" onClick={projectIncomes}><TrendingUp size={16} /> Proyectar años</button><button className="button button-primary" onClick={addYear}><Plus size={16} /> Agregar año</button></div>
            </div>
            <div className="editable-table-wrap">
              <table className="editable-table">
                <thead><tr><th>Año</th><th>Ingreso mensual</th><th>Observación</th><th aria-label="Acciones" /></tr></thead>
                <tbody>
                  {settings.incomes.map((income, index) => (
                    <tr key={income.id ?? `income-row-${index}`}>
                      <td><input className="year-input" aria-label={`Año de la fila ${index + 1}`} type="number" value={income.year} onChange={(event) => updateIncome(index, { year: numberValue(event.target.value) })} /></td>
                      <td>
                        {inputMoney(income.monthlyIncome, (value) => updateIncome(index, { monthlyIncome: value }), `Ingreso mensual de ${income.year}`)}
                        <small>{income.source === "manual" ? "Modificado manualmente" : "Valor proyectado"}{income.projectedMonthlyIncome !== undefined && income.projectedMonthlyIncome !== income.monthlyIncome ? ` · variación ${currency(income.monthlyIncome - income.projectedMonthlyIncome)}` : ""}</small>
                      </td>
                      <td><input aria-label={`Observación de ${income.year}`} placeholder="Opcional" value={income.note} onChange={(event) => updateIncome(index, { note: event.target.value })} /></td>
                      <td><button className="icon-button danger" aria-label={`Eliminar ${income.year}`} onClick={() => setSettings({ ...settings, incomes: settings.incomes.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={16} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel settings-grid-panel">
            <div className="panel-head"><div><span className="eyebrow">Ingreso extraordinario</span><h2>Prima</h2><p>El porcentaje de ahorro del escenario también se aplica a la prima.</p></div><Switch checked={settings.bonus.enabled} onChange={(enabled) => setSettings({ ...settings, bonus: { ...settings.bonus, enabled } })} label="Activar prima" /></div>
            <div className="form-grid">
              <label><span>Mes de la prima</span><select value={settings.bonus.month} onChange={(event) => setSettings({ ...settings, bonus: { ...settings.bonus, month: numberValue(event.target.value) } })}>{Array.from({ length: 12 }, (_, index) => <option value={index + 1} key={index}>{monthLabel(`2026-${String(index + 1).padStart(2, "0")}`).split(" de ")[0]}</option>)}</select></label>
              <label><span>Forma de cálculo <FieldHelp text="Puedes usar un porcentaje del ingreso o un monto fijo." /></span><select value={settings.bonus.mode} onChange={(event) => setSettings({ ...settings, bonus: { ...settings.bonus, mode: event.target.value as Settings["bonus"]["mode"] } })}><option value="incomePercentage">Porcentaje del ingreso</option><option value="fixed">Valor fijo</option></select></label>
              {settings.bonus.mode === "incomePercentage" ? (
                <label><span>Porcentaje de prima</span><div className="suffix-input"><input type="number" min="0" value={settings.bonus.percentage} onChange={(event) => setSettings({ ...settings, bonus: { ...settings.bonus, percentage: numberValue(event.target.value) } })} /><span>%</span></div></label>
              ) : <label><span>Valor fijo</span>{inputMoney(settings.bonus.fixedAmount, (value) => setSettings({ ...settings, bonus: { ...settings.bonus, fixedAmount: value } }), "Valor fijo de prima")}</label>}
            </div>
          </section>
        </div>
      )}

      {section === "tuition" && (
        <section className="panel configuration-panel">
          <div className="panel-head">
            <div><span className="eyebrow">Calendario de la carrera</span><h2>Eventos de matrícula</h2><p>Edita, agrega, pausa o aplaza cada semestre de forma independiente.</p></div>
            <button className="button button-primary" onClick={addTuition}><Plus size={16} /> Agregar pago</button>
          </div>
          <div className="editable-table-wrap">
            <table className="editable-table tuition-edit-table">
              <thead><tr><th>Activo</th><th>Fecha</th><th>Concepto</th><th>Valor</th><th>Observación</th><th /></tr></thead>
              <tbody>
                {settings.tuitionEvents.map((event) => (
                  <tr key={event.id} className={!event.enabled ? "muted-row" : ""}>
                    <td><Switch checked={event.enabled} onChange={(enabled) => updateTuition(event.id, { enabled })} label={`Activar ${event.label}`} /></td>
                    <td><input aria-label={`Fecha de ${event.label}`} type="month" value={event.date} onChange={(e) => updateTuition(event.id, { date: e.target.value })} /></td>
                    <td><input aria-label="Concepto" value={event.label} onChange={(e) => updateTuition(event.id, { label: e.target.value })} /></td>
                    <td>{inputMoney(event.amount, (value) => updateTuition(event.id, { amount: value }), `Valor de ${event.label}`)}</td>
                    <td><input aria-label={`Observación de ${event.label}`} placeholder="Beca, recargo..." value={event.note} onChange={(e) => updateTuition(event.id, { note: e.target.value })} /></td>
                    <td><button className="icon-button danger" aria-label={`Eliminar ${event.label}`} onClick={() => setSettings({ ...settings, tuitionEvents: settings.tuitionEvents.filter((item) => item.id !== event.id) })}><Trash2 size={16} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="callout"><CalendarDays size={18} /><div><strong>Consejo</strong><p>Para aplazar un semestre, cambia su fecha. Para pausarlo sin perderlo, apaga el interruptor.</p></div></div>
        </section>
      )}

      {section === "rates" && (
        <div className="stack">
          <section className="panel configuration-panel">
            <div className="panel-head"><div><span className="eyebrow">No garantizado</span><h2>Rendimiento de la Cajita Nu</h2><p>La tasa E.A. se convierte a su equivalente mensual.</p></div><Switch checked={settings.yieldsEnabled} onChange={(enabled) => setSettings({ ...settings, yieldsEnabled: enabled })} label="Activar rendimientos" /></div>
            <div className="rate-grid">
              {settings.yieldRates.map((rate, index) => (
                <label key={rate.id ?? `rate-row-${index}`}><span>{rate.year} · {rate.source === "manual" ? "Manual" : "Proyectada"}{rate.projectedEffectiveAnnualRate !== undefined && rate.projectedEffectiveAnnualRate !== rate.effectiveAnnualRate ? ` · Δ ${(rate.effectiveAnnualRate - rate.projectedEffectiveAnnualRate).toFixed(2)} pp` : ""}</span><div className="suffix-input"><input aria-label={`Tasa EA de ${rate.year}`} type="number" min="-100" step="0.01" value={rate.effectiveAnnualRate} onChange={(event) => updateYieldRate(index, numberValue(event.target.value))} /><span>% E.A.</span></div></label>
              ))}
            </div>
          </section>
          <section className="panel configuration-panel">
            <div className="panel-head"><div><span className="eyebrow">Costos configurables</span><h2>Impuestos y movimientos</h2></div></div>
            <div className="tax-cards">
              <article>
                <div className="tax-head"><span className="icon-soft"><ArrowDownToLine size={18} /></span><div><strong>Retención</strong><small>Solo sobre rendimientos</small></div><Switch checked={settings.taxes.withholdingEnabled} onChange={(enabled) => setSettings({ ...settings, taxes: { ...settings.taxes, withholdingEnabled: enabled } })} label="Activar retención" /></div>
                <label><span>Porcentaje ilustrativo</span><div className="suffix-input"><input type="number" min="0" value={settings.taxes.withholdingRate} onChange={(event) => setSettings({ ...settings, taxes: { ...settings.taxes, withholdingRate: numberValue(event.target.value) } })} /><span>%</span></div></label>
              </article>
              <article>
                <div className="tax-head"><span className="icon-soft sand"><Landmark size={18} /></span><div><strong>GMF / 4×1.000</strong><small>Sobre retiros de matrícula</small></div><Switch checked={settings.taxes.gmfEnabled} onChange={(enabled) => setSettings({ ...settings, taxes: { ...settings.taxes, gmfEnabled: enabled } })} label="Activar GMF" /></div>
                <label><span>Tasa</span><div className="suffix-input"><input type="number" min="0" step="0.01" value={settings.taxes.gmfRate} onChange={(event) => setSettings({ ...settings, taxes: { ...settings.taxes, gmfRate: numberValue(event.target.value) } })} /><span>%</span></div></label>
                <label className="check-row"><input type="checkbox" checked={settings.taxes.gmfExempt} onChange={(event) => setSettings({ ...settings, taxes: { ...settings.taxes, gmfExempt: event.target.checked } })} /> Marcar escenario como exento</label>
              </article>
            </div>
          </section>
        </div>
      )}

      {section === "protection" && (
        <section className="panel configuration-panel">
          <div className="panel-head"><div><span className="eyebrow">Patrimonio distribuido</span><h2>Protección y concentración</h2><p>Recibe una alerta antes del límite. La aplicación nunca mueve dinero por sí sola.</p></div><Switch checked={settings.concentration.enabled} onChange={(enabled) => setSettings({ ...settings, concentration: { ...settings.concentration, enabled } })} label="Activar control de concentración" /></div>
          <div className="form-grid three">
            <label><span>Límite de referencia <FieldHelp text="Valor de planeación editable; no es una restricción técnica." /></span>{inputMoney(settings.concentration.referenceLimit, (value) => setSettings({ ...settings, concentration: { ...settings.concentration, referenceLimit: value } }), "Límite de referencia")}</label>
            <label><span>Umbral de alerta</span>{inputMoney(settings.concentration.alertThreshold, (value) => setSettings({ ...settings, concentration: { ...settings.concentration, alertThreshold: value } }), "Umbral de alerta")}</label>
            <label><span>Modo de sugerencia</span><select value={settings.concentration.suggestionMode} onChange={(e) => setSettings({ ...settings, concentration: { ...settings.concentration, suggestionMode: e.target.value as Settings["concentration"]["suggestionMode"] } })}><option value="reduceToTarget">Reducir hasta objetivo</option><option value="fixedAmount">Monto fijo</option><option value="keepSafetyMargin">Mantener margen</option></select></label>
            {settings.concentration.suggestionMode === "reduceToTarget" && <label><span>Saldo objetivo en Nu</span>{inputMoney(settings.concentration.targetNuBalance, (value) => setSettings({ ...settings, concentration: { ...settings.concentration, targetNuBalance: value } }), "Saldo objetivo")}</label>}
            {settings.concentration.suggestionMode === "fixedAmount" && <label><span>Monto fijo sugerido</span>{inputMoney(settings.concentration.fixedTransferAmount, (value) => setSettings({ ...settings, concentration: { ...settings.concentration, fixedTransferAmount: value } }), "Monto fijo")}</label>}
            {settings.concentration.suggestionMode === "keepSafetyMargin" && <label><span>Margen frente al límite</span>{inputMoney(settings.concentration.safetyMargin, (value) => setSettings({ ...settings, concentration: { ...settings.concentration, safetyMargin: value } }), "Margen de seguridad")}</label>}
            <label><span>Nombre del fondo externo</span><input value={settings.concentration.externalAccountName} onChange={(e) => setSettings({ ...settings, concentration: { ...settings.concentration, externalAccountName: e.target.value } })} /></label>
            <label><span>Rendimiento externo</span><div className="suffix-input"><input type="number" step="0.01" value={settings.concentration.externalAnnualYieldRate} onChange={(e) => setSettings({ ...settings, concentration: { ...settings.concentration, externalAnnualYieldRate: numberValue(e.target.value) } })} /><span>% E.A.</span></div></label>
            <label><span>Fondos para matrícula</span><select value={settings.concentration.tuitionFundingOrder} onChange={(e) => setSettings({ ...settings, concentration: { ...settings.concentration, tuitionFundingOrder: e.target.value as Settings["concentration"]["tuitionFundingOrder"] } })}><option value="externalFirst">Externo primero</option><option value="nuFirst">Nu primero</option></select></label>
          </div>
          <div className="option-rows">
            <label><span><strong>Confirmación manual obligatoria</strong><small>Una propuesta pendiente nunca modifica los saldos.</small></span><Switch checked={settings.concentration.requireConfirmation} onChange={(checked) => setSettings({ ...settings, concentration: { ...settings.concentration, requireConfirmation: checked } })} label="Requerir confirmación" /></label>
            <label><span><strong>Aplicar GMF al traslado externo</strong><small>Reduce el patrimonio únicamente por el costo configurado.</small></span><Switch checked={settings.concentration.applyGmfToExternalTransfer} onChange={(checked) => setSettings({ ...settings, concentration: { ...settings.concentration, applyGmfToExternalTransfer: checked } })} label="Aplicar GMF a traslado" /></label>
          </div>
          <div className="callout"><ShieldCheck size={19} /><div><strong>Regla fundamental</strong><p>Trasladar dinero entre Nu y el fondo externo es una reclasificación interna: no cuenta como aporte, rendimiento ni gasto.</p></div></div>
        </section>
      )}
      {(section === "income" || section === "rates") &&
        (settings.annualValueRevisions?.length ?? 0) > 0 && (
          <section className="panel revisions-panel">
            <div className="panel-head">
              <div>
                <span className="eyebrow">Trazabilidad anual</span>
                <h2>Cambios de supuestos</h2>
              </div>
              <span>{settings.annualValueRevisions!.length} cambios</span>
            </div>
            <div className="revision-list">
              {[...settings.annualValueRevisions!]
                .reverse()
                .slice(0, 12)
                .map((revision) => (
                  <div key={revision.id}>
                    <span className="icon-soft"><TrendingUp size={16} /></span>
                    <div>
                      <strong>{revision.year} · {revision.field}</strong>
                      <small>
                        {revision.previousValue} → {revision.newValue} · {revision.source}
                        {revision.reason ? ` · ${revision.reason}` : ""}
                      </small>
                    </div>
                    <time>{new Date(revision.changedAt).toLocaleString("es-CO")}</time>
                  </div>
                ))}
            </div>
          </section>
        )}
    </>
  );
}

function Results({
  settings,
  result,
  section,
  setSection,
  annualRows,
  tuitionRows,
  monthlyRows,
  monthlyFilter,
  setMonthlyFilter,
  onlyEvents,
  setOnlyEvents,
  scenarioColor,
  exportSection,
}: {
  settings: Settings;
  result: ReturnType<typeof simulate>;
  section: ResultSection;
  setSection: (section: ResultSection) => void;
  annualRows: Array<Record<string, string | number>>;
  tuitionRows: Array<MonthlyResult & { required: number; margin: number }>;
  monthlyRows: MonthlyResult[];
  monthlyFilter: string;
  setMonthlyFilter: (value: string) => void;
  onlyEvents: boolean;
  setOnlyEvents: (value: boolean) => void;
  scenarioColor: (id: string) => string;
  exportSection: (section: ResultSection) => void;
}) {
  const annualChart = annualRows.map((row) => ({
    name: `${row.year}`,
    escenario: row.scenario,
    Aportes: row.contributions,
    Rendimientos: row.yields,
    Matrículas: row.tuition,
    "Saldo final": row.finalTotal,
  }));
  const transferRows = result.monthly.flatMap((row) =>
    row.appliedTransfers.map((transfer) => ({ row, transfer })),
  );
  return (
    <>
      <section className="page-heading">
        <div><div className="eyebrow green"><TrendingUp size={14} /> Datos proyectados</div><h1>Explora resultados ideales</h1><p>Compara años, pagos y movimientos de la simulación. Cada cifra puede rastrearse hasta el detalle mensual.</p></div>
        <button className="button button-primary" onClick={() => exportSection(section)}><Download size={16} /> Exportar {section === "monthly" ? "detalle" : "tabla"}</button>
      </section>
      <div className="mobile-tabs">
        <select value={section} onChange={(event) => setSection(event.target.value as ResultSection)} aria-label="Tabla de resultados">
          <option value="annual">Resumen anual</option><option value="semester">Pagos semestrales</option><option value="monthly">Detalle mensual</option><option value="transfers">Historial de traslados</option>
        </select><ChevronDown size={17} />
      </div>
      {section === "annual" && (
        <div className="stack">
          <section className="panel chart-panel">
            <div className="panel-head"><div><span className="eyebrow">Comparación anual</span><h2>Aportes, pagos y saldo al cierre</h2></div></div>
            <div className="chart-wrap medium" role="img" aria-label="Comparación anual de aportes, rendimientos y matrículas; la tabla siguiente contiene los valores exactos">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={annualChart} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(value) => currency(value, true)} tickLine={false} axisLine={false} width={74} />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend iconType="circle" />
                  <Bar dataKey="Aportes" fill="#71c5ad" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Rendimientos" fill="#7c5ce7" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="Matrículas" fill="#e6a154" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <DataTable headers={["Año", "Escenario", "Aportes", "Rendimientos netos", "Matrículas", "GMF y costos", "Saldo Nu", "Saldo externo", "Patrimonio final"]}>
            {annualRows.map((row) => (
              <tr key={row.key}>
                <td><strong>{row.year}</strong></td><td><span className="scenario-tag"><i style={{ background: scenarioColor(String(row.scenarioId)) }} />{row.scenario}</span></td>
                <td>{currency(Number(row.contributions))}</td><td className="positive-number">{currency(Number(row.yields))}</td><td>{currency(Number(row.tuition))}</td><td>{currency(Number(row.gmf))}</td><td>{currency(Number(row.finalNu))}</td><td>{currency(Number(row.finalExternal))}</td><td><strong>{currency(Number(row.finalTotal))}</strong></td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
      {section === "semester" && (
        <div className="stack">
          <section className="panel chart-panel">
            <div className="panel-head"><div><span className="eyebrow">Capacidad de pago</span><h2>Margen disponible por semestre</h2></div></div>
            <div className="chart-wrap medium" role="img" aria-label="Margen disponible por semestre; la tabla siguiente contiene los valores exactos">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={tuitionRows.map((row) => ({ name: row.tuitionLabel, Margen: row.margin, Necesario: row.required }))}>
                  <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
                  <XAxis dataKey="name" tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(value) => currency(value, true)} tickLine={false} axisLine={false} width={74} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0} stroke="#253c35" />
                  <Bar dataKey="Margen" radius={[5, 5, 0, 0]}>{tuitionRows.map((row) => <Cell key={row.date} fill={row.margin >= 0 ? "#1f9d78" : "#d85d57"} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
          <DataTable headers={["Semestre", "Fecha", "Valor", "GMF", "Total necesario", "Saldo antes", "Saldo después", "Estado", "Faltante"]}>
            {tuitionRows.map((row) => (
              <tr key={`${row.scenarioId}-${row.date}`}>
                <td><strong>{row.tuitionLabel}</strong><small>{row.scenarioName}</small></td><td>{monthLabel(row.date, true)}</td><td>{currency(row.tuitionAmount)}</td><td>{currency(row.tuitionGmfAmount)}</td><td>{currency(row.required)}</td><td>{currency(row.openingTotalBalance)}</td><td>{currency(row.closingTotalBalance)}</td><td><span className={`status-pill ${tuitionStatusClass(row.tuitionPaymentStatus)}`}>{tuitionStatusText[row.tuitionPaymentStatus]}</span></td><td className={row.missing ? "negative-number" : ""}>{row.missing ? currency(row.missing) : "—"}</td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
      {section === "monthly" && (
        <div className="stack">
          <section className="panel filter-bar">
            <label><span>Escenario</span><select value={monthlyFilter} onChange={(e) => setMonthlyFilter(e.target.value)}><option value="all">Todos</option>{settings.scenarios.filter((s) => s.enabled).map((s) => <option value={s.id} key={s.id}>{s.name}</option>)}</select></label>
            <label className="check-row"><input type="checkbox" checked={onlyEvents} onChange={(e) => setOnlyEvents(e.target.checked)} /> Solo meses con movimientos importantes</label>
            <span>{monthlyRows.length} filas</span>
          </section>
          <DataTable headers={["Mes", "Escenario", "Patrimonio inicial", "Ingreso", "Prima", "Aporte", "Rendimiento bruto", "Retención", "Matrícula", "GMF", "Traslado", "Saldo Nu", "Saldo externo", "Patrimonio final", "Estado"]}>
            {monthlyRows.map((row) => (
              <tr key={`${row.scenarioId}-${row.date}`}>
                <td><strong>{monthLabel(row.date, true)}</strong></td><td><span className="scenario-tag"><i style={{ background: scenarioColor(row.scenarioId) }} />{row.scenarioName}</span></td><td>{currency(row.openingTotalBalance)}</td><td>{currency(row.monthlyIncome)}</td><td>{row.bonusIncome ? currency(row.bonusIncome) : "—"}</td><td className="positive-number">{currency(row.totalContribution)}</td><td>{currency(row.grossYield)}</td><td>{currency(row.withholding)}</td><td>{row.tuitionAmount ? currency(row.tuitionAmount) : "—"}</td><td>{row.tuitionGmfAmount ? currency(row.tuitionGmfAmount) : "—"}</td><td>{row.confirmedExternalTransfer ? currency(row.confirmedExternalTransfer) : "—"}</td><td>{currency(row.closingNuBalance)}</td><td>{currency(row.closingExternalBalance)}</td><td><strong>{currency(row.closingTotalBalance)}</strong></td><td><span className={`status-pill ${tuitionStatusClass(row.tuitionPaymentStatus)}`}>{row.tuitionPaymentStatus === "not_due" ? "Ahorro" : tuitionStatusText[row.tuitionPaymentStatus]}</span></td>
              </tr>
            ))}
          </DataTable>
        </div>
      )}
      {section === "transfers" && (
        <div className="stack">
          <div className="callout"><ExternalLink size={18} /><div><strong>Trazabilidad completa</strong><p>Un traslado confirmado nunca se elimina silenciosamente y no se contabiliza como aporte ni como gasto.</p></div></div>
          {transferRows.length ? (
            <DataTable headers={["Fecha", "Escenario", "Nu antes", "Monto trasladado", "GMF / costo", "Nu después", "Externo después", "Patrimonio después", "Estado"]}>
              {transferRows.map(({ row, transfer }) => (
                <tr key={`${row.scenarioId}-${row.date}-${transfer.id}`}>
                  <td>{monthLabel(row.date, true)}</td>
                  <td>{row.scenarioName}</td>
                  <td>{currency(transfer.nuBalanceBefore)}</td>
                  <td>{currency(transfer.amount)}</td>
                  <td>{currency(transfer.cost)}</td>
                  <td>{currency(transfer.nuBalanceAfter)}</td>
                  <td>{currency(transfer.externalBalanceAfter)}</td>
                  <td><strong>{currency(transfer.nuBalanceAfter + transfer.externalBalanceAfter)}</strong></td>
                  <td>
                    <span className={`status-pill ${transfer.status === "applied" ? "success" : "danger"}`}>
                      {transfer.status === "applied" ? "Aplicado" : "Requiere revisión"}
                    </span>
                    {transfer.issue && <small>{transfer.issue}</small>}
                  </td>
                </tr>
              ))}
            </DataTable>
          ) : <EmptyState>Aún no hay traslados confirmados. Las propuestas pendientes no modifican los saldos.</EmptyState>}
        </div>
      )}
    </>
  );
}

function ActualSummaryView({
  settings,
  calculated,
  summary,
}: {
  settings: Settings;
  calculated: ReturnType<typeof calculateActualTracking>;
  summary: ReturnType<typeof summarizeActual>;
}) {
  const latest = calculated.at(-1);
  const recentMonths = calculated.slice(-6);
  const chartData = calculated.map((month) => ({
    date: monthLabel(month.record.month),
    "Patrimonio total": month.totalBalance,
    "Saldo Nu": month.calculatedNuBalance,
    [settings.concentration.externalAccountName]:
      month.calculatedExternalBalance,
  }));
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow green">
            <WalletCards size={14} /> Estado confirmado
          </div>
          <h1>Resumen del Ahorro real</h1>
          <p>
            Una vista rápida de los aportes, rendimientos, pagos y saldos que
            realmente has confirmado.
          </p>
        </div>
      </section>

      <section className="ideal-summary-grid actual-summary-grid">
        <article className="ideal-primary">
          <span>Patrimonio real</span>
          <strong>{currency(summary.finalTotalBalance)}</strong>
          <small>
            {latest
              ? `Cierre de ${monthLabel(latest.record.month, true)}`
              : "Sin meses confirmados"}
          </small>
        </article>
        <article>
          <span>Saldo Nu</span>
          <strong>{currency(summary.finalNuBalance)}</strong>
          <small>Saldo calculado al último cierre</small>
        </article>
        <article>
          <span>{settings.concentration.externalAccountName}</span>
          <strong>{currency(summary.finalExternalBalance)}</strong>
          <small>Saldo externo real</small>
        </article>
        <article>
          <span>Aportes realizados</span>
          <strong>{currency(summary.totalContributions)}</strong>
          <small>Regular más aporte desde prima</small>
        </article>
        <article>
          <span>Rendimiento neto</span>
          <strong>
            {currency(summary.totalGrossYield - summary.totalWithholding)}
          </strong>
          <small>Después de retención</small>
        </article>
        <article>
          <span>Matrículas pagadas</span>
          <strong>{currency(summary.totalTuition)}</strong>
          <small>{currency(summary.totalGmf)} en GMF y costos</small>
        </article>
      </section>

      <section className="panel chart-panel ideal-chart">
        <div className="panel-head">
          <div>
            <span className="eyebrow">Seguimiento mensual</span>
            <h2>Evolución del patrimonio real</h2>
          </div>
          <small className="panel-head-note">
            {calculated.length
              ? `${calculated.length} meses confirmados`
              : "Aún sin meses confirmados"}
          </small>
        </div>
        {chartData.length ? (
          <div
            className="chart-wrap medium"
            role="img"
            aria-label="Evolución mensual del patrimonio del Ahorro real; los valores exactos están disponibles en la tabla"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid
                  strokeDasharray="3 4"
                  vertical={false}
                  stroke="var(--chart-grid)"
                />
                <XAxis
                  dataKey="date"
                  interval="preserveStartEnd"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tickFormatter={(value) => currency(value, true)}
                  tickLine={false}
                  axisLine={false}
                  width={72}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="Patrimonio total"
                  stroke="#16785e"
                  strokeWidth={3}
                  dot={calculated.length < 13 ? { r: 3 } : false}
                />
                <Line
                  type="monotone"
                  dataKey="Saldo Nu"
                  stroke="#71c5ad"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey={settings.concentration.externalAccountName}
                  stroke="#7c5ce7"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState>
            Confirma tu primer aporte mensual para comenzar esta gráfica.
          </EmptyState>
        )}
      </section>

      <div className="callout">
        <ShieldCheck size={18} />
        <div>
          <strong>Solo información real confirmada</strong>
          <p>
            Los borradores, meses duplicados y registros con errores no entran
            en este resumen.
          </p>
        </div>
      </div>

      {recentMonths.length ? (
        <div className="stack actual-summary-recent">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Actividad reciente</span>
              <h2>Últimos meses confirmados</h2>
            </div>
          </div>
          <DataTable
            headers={[
              "Mes",
              "Aportes",
              "Rendimiento bruto",
              "Retención",
              "Matrícula",
              "Saldo Nu",
              "Saldo externo",
              "Patrimonio",
              "Estado",
            ]}
          >
            {recentMonths.map((month) => (
              <tr key={month.record.id}>
                <td><strong>{monthLabel(month.record.month, true)}</strong></td>
                <td className="positive-number">{currency(month.totalContributions)}</td>
                <td>{currency(month.totalGrossYield)}</td>
                <td>{currency(month.record.actualWithholding)}</td>
                <td>{currency(month.record.actualTuitionPayment)}</td>
                <td>{currency(month.calculatedNuBalance)}</td>
                <td>{currency(month.calculatedExternalBalance)}</td>
                <td><strong>{currency(month.totalBalance)}</strong></td>
                <td>
                  <span className={`status-pill ${month.displayStatus === "Con diferencia" ? "warning" : "success"}`}>
                    {month.displayStatus}
                  </span>
                </td>
              </tr>
            ))}
          </DataTable>
        </div>
      ) : (
        <EmptyState>
          Confirma tu primer aporte mensual para construir el resumen real.
        </EmptyState>
      )}
    </>
  );
}

function ActualResults({
  settings,
  calculated,
  summary,
  section,
  setSection,
  onExport,
}: {
  settings: Settings;
  calculated: ReturnType<typeof calculateActualTracking>;
  summary: ReturnType<typeof summarizeActual>;
  section: ResultSection;
  setSection: (section: ResultSection) => void;
  onExport: () => void;
}) {
  const annualMap = new Map<
    string,
    {
      year: string;
      contributions: number;
      yields: number;
      tuition: number;
      costs: number;
      finalNu: number;
      finalExternal: number;
      finalTotal: number;
    }
  >();
  calculated.forEach((month) => {
    const year = month.record.month.slice(0, 4);
    const current = annualMap.get(year) ?? {
      year,
      contributions: 0,
      yields: 0,
      tuition: 0,
      costs: 0,
      finalNu: 0,
      finalExternal: 0,
      finalTotal: 0,
    };
    current.contributions += month.totalContributions;
    current.yields +=
      month.totalGrossYield - month.record.actualWithholding;
    current.tuition += month.record.actualTuitionPayment;
    current.costs +=
      month.record.actualTuitionGmf + month.record.actualTransferGmf;
    current.finalNu = month.calculatedNuBalance;
    current.finalExternal = month.calculatedExternalBalance;
    current.finalTotal = month.totalBalance;
    annualMap.set(year, current);
  });
  const annualRows = [...annualMap.values()].sort((a, b) =>
    a.year.localeCompare(b.year),
  );
  const tuitionPayments = calculated.filter(
    (month) => month.record.actualTuitionPayment > 0,
  );
  const tuitionEvents = settings.tuitionEvents
    .filter((event) => event.enabled)
    .sort((a, b) => a.date.localeCompare(b.date));
  const transferRows = calculated.filter(
    (month) => month.record.actualTransferToExternal > 0,
  );
  const fundingSourceLabel = {
    nu: "Nu",
    external: settings.concentration.externalAccountName,
    split: "Pago dividido",
  };

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow green">
            <FileCheck2 size={14} /> Datos confirmados
          </div>
          <h1>Explora resultados reales</h1>
          <p>
            Consulta únicamente movimientos confirmados del Ahorro real,
            organizados por año, matrícula, mes y traslado.
          </p>
        </div>
        <button className="button button-primary" onClick={onExport}>
          <Download size={16} /> Exportar Ahorro real
        </button>
      </section>

      <div className="mobile-tabs">
        <select
          value={section}
          onChange={(event) =>
            setSection(event.target.value as ResultSection)
          }
          aria-label="Resultados del Ahorro real"
        >
          <option value="annual">Resumen anual</option>
          <option value="semester">Pagos semestrales</option>
          <option value="monthly">Detalle mensual</option>
          <option value="transfers">Historial de traslados</option>
        </select>
        <ChevronDown size={17} />
      </div>

      {section === "annual" && (
        <div className="stack">
          <section className="comparison-summary-grid actual-results-summary">
            <article className="comparison-main-card">
              <span>Patrimonio real</span>
              <strong>{currency(summary.finalTotalBalance)}</strong>
              <p>
                {summary.registeredMonths} meses confirmados y elegibles.
              </p>
            </article>
            <article className="comparison-mini-card">
              <span>Aportes realizados</span>
              <strong>{currency(summary.totalContributions)}</strong>
              <small>Regular más aporte desde prima</small>
            </article>
            <article className="comparison-mini-card">
              <span>Rendimiento neto</span>
              <strong>
                {currency(
                  summary.totalGrossYield - summary.totalWithholding,
                )}
              </strong>
              <small>Después de retención</small>
            </article>
            <article className="comparison-mini-card">
              <span>Matrículas pagadas</span>
              <strong>{currency(summary.totalTuition)}</strong>
              <small>{currency(summary.totalGmf)} en GMF y costos</small>
            </article>
          </section>
          {annualRows.length ? (
            <DataTable
              headers={[
                "Año",
                "Aportes",
                "Rendimientos netos",
                "Matrículas",
                "GMF y costos",
                "Saldo Nu",
                "Saldo externo",
                "Patrimonio final",
              ]}
            >
              {annualRows.map((row) => (
                <tr key={row.year}>
                  <td><strong>{row.year}</strong></td>
                  <td>{currency(row.contributions)}</td>
                  <td className="positive-number">{currency(row.yields)}</td>
                  <td>{currency(row.tuition)}</td>
                  <td>{currency(row.costs)}</td>
                  <td>{currency(row.finalNu)}</td>
                  <td>{currency(row.finalExternal)}</td>
                  <td><strong>{currency(row.finalTotal)}</strong></td>
                </tr>
              ))}
            </DataTable>
          ) : (
            <EmptyState>
              Confirma al menos un mes para construir el resumen anual real.
            </EmptyState>
          )}
        </div>
      )}

      {section === "semester" && (
        tuitionPayments.length ? (
          <DataTable
            headers={[
              "Etapa",
              "Mes real",
              "Valor pagado",
              "Fuente",
              "GMF",
              "Saldo Nu",
              "Saldo externo",
              "Patrimonio final",
            ]}
          >
            {tuitionPayments.map((month, index) => (
              <tr key={month.record.id}>
                <td>
                  <strong>
                    {tuitionEvents[index]?.label ?? `Pago ${index + 1}`}
                  </strong>
                  <small>
                    {tuitionEvents[index]
                      ? `Previsto ${monthLabel(tuitionEvents[index].date, true)}`
                      : "Sin etapa ideal asociada"}
                  </small>
                </td>
                <td>{monthLabel(month.record.month, true)}</td>
                <td>{currency(month.record.actualTuitionPayment)}</td>
                <td>{fundingSourceLabel[month.record.tuitionFundingSource]}</td>
                <td>{currency(month.record.actualTuitionGmf)}</td>
                <td>{currency(month.calculatedNuBalance)}</td>
                <td>{currency(month.calculatedExternalBalance)}</td>
                <td><strong>{currency(month.totalBalance)}</strong></td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState>
            Todavía no hay pagos de matrícula confirmados en el Ahorro real.
          </EmptyState>
        )
      )}

      {section === "monthly" && (
        calculated.length ? (
          <DataTable
            headers={[
              "Mes",
              "Ingreso",
              "Prima",
              "Aportes",
              "Rendimiento bruto",
              "Retención",
              "Matrícula",
              "GMF y costos",
              "Traslado",
              "Saldo Nu",
              "Saldo externo",
              "Patrimonio",
              "Estado",
            ]}
          >
            {calculated.map((month) => (
              <tr key={month.record.id}>
                <td><strong>{monthLabel(month.record.month, true)}</strong></td>
                <td>{currency(month.record.actualIncome)}</td>
                <td>{currency(month.record.actualBonus)}</td>
                <td className="positive-number">{currency(month.totalContributions)}</td>
                <td>{currency(month.totalGrossYield)}</td>
                <td>{currency(month.record.actualWithholding)}</td>
                <td>{currency(month.record.actualTuitionPayment)}</td>
                <td>{currency(month.totalCosts)}</td>
                <td>{currency(month.record.actualTransferToExternal)}</td>
                <td>{currency(month.calculatedNuBalance)}</td>
                <td>{currency(month.calculatedExternalBalance)}</td>
                <td><strong>{currency(month.totalBalance)}</strong></td>
                <td>
                  <span className={`status-pill ${month.displayStatus === "Con diferencia" ? "warning" : "success"}`}>
                    {month.displayStatus}
                  </span>
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState>
            Todavía no hay meses confirmados para mostrar.
          </EmptyState>
        )
      )}

      {section === "transfers" && (
        <div className="stack">
          <div className="callout">
            <ExternalLink size={18} />
            <div>
              <strong>Movimientos internos reales</strong>
              <p>
                Los traslados cambian la distribución entre Nu y el fondo
                externo, pero no cuentan como aportes.
              </p>
            </div>
          </div>
          {transferRows.length ? (
            <DataTable
              headers={[
                "Fecha",
                "Nu inicial",
                "Monto trasladado",
                "GMF o costo",
                "Nu al cierre",
                "Externo al cierre",
                "Patrimonio al cierre",
              ]}
            >
              {transferRows.map((month) => (
                <tr key={month.record.id}>
                  <td>{monthLabel(month.record.month, true)}</td>
                  <td>{currency(month.openingNuBalance)}</td>
                  <td>{currency(month.record.actualTransferToExternal)}</td>
                  <td>{currency(month.record.actualTransferGmf)}</td>
                  <td>{currency(month.calculatedNuBalance)}</td>
                  <td>{currency(month.calculatedExternalBalance)}</td>
                  <td><strong>{currency(month.totalBalance)}</strong></td>
                </tr>
              ))}
            </DataTable>
          ) : (
            <EmptyState>
              Aún no hay traslados reales confirmados.
            </EmptyState>
          )}
        </div>
      )}
    </>
  );
}

function DataTable({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <section className="panel data-table-panel">
      <div className="data-table-wrap">
        <table className="data-table">
          <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </section>
  );
}

function TransferModal({
  row,
  amount,
  setAmount,
  settings,
  onClose,
  onPostpone,
  onDismiss,
  onConfirm,
}: {
  row: MonthlyResult;
  amount: number;
  setAmount: (amount: number) => void;
  settings: Settings;
  onClose: () => void;
  onPostpone: () => void;
  onDismiss: () => void;
  onConfirm: () => void;
}) {
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () =>
      [...(modalRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [onClose]);
  const gmf =
    settings.concentration.applyGmfToExternalTransfer && settings.taxes.gmfEnabled
      ? amount * settings.taxes.gmfRate / 100
      : 0;
  const nextNu = row.closingNuBalance - amount - gmf;
  const nextExternal = row.closingExternalBalance + amount;
  return (
    <div className="modal-backdrop" role="presentation">
      <div ref={modalRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="transfer-title" tabIndex={-1}>
        <div className="modal-head">
          <div className="alert-icon"><ShieldCheck size={22} /></div>
          <div><span className="eyebrow">Confirmación manual</span><h2 id="transfer-title">Registrar traslado preventivo</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
        </div>
        <p>Esta confirmación solo registra una acción que realizaste por fuera de la aplicación. No mueve dinero real.</p>
        <label className="modal-amount"><span>Monto a trasladar</span>{inputMoney(amount, setAmount, "Monto a trasladar")}</label>
        <div className="before-after">
          <div><span>Saldo actual en Nu</span><strong>{currency(row.closingNuBalance)}</strong></div>
          <ArrowRight size={20} />
          <div><span>Saldo Nu después</span><strong className={nextNu < 0 ? "negative-number" : ""}>{currency(nextNu)}</strong></div>
        </div>
        <div className="transfer-summary">
          <div><span>{settings.concentration.externalAccountName} después</span><strong>{currency(nextExternal)}</strong></div>
          <div><span>GMF / costo</span><strong>{currency(gmf)}</strong></div>
          <div className="total"><span>Patrimonio después</span><strong>{currency(nextNu + nextExternal)}</strong></div>
        </div>
        <div className="modal-note"><Info size={16} /> Registra esta confirmación únicamente después de realizar el traslado en la entidad financiera correspondiente.</div>
        <div className="modal-actions">
          <button className="text-button dismiss-button" onClick={onDismiss}>Descartar por ahora</button>
          <button className="button button-secondary" onClick={onPostpone}>Recordar después</button>
          <button className="button button-primary" onClick={onConfirm} disabled={amount <= 0 || nextNu < 0}><Check size={16} /> Confirmar traslado</button>
        </div>
      </div>
    </div>
  );
}

export default App;
