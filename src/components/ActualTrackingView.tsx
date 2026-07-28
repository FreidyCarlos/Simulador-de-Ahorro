import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CalendarPlus,
  Check,
  ChevronDown,
  CircleDollarSign,
  Copy,
  FileCheck2,
  Info,
  Landmark,
  LockKeyhole,
  Plus,
  RotateCcw,
  Save,
  Scale,
  ShieldCheck,
  Sparkles,
  WalletCards,
} from "lucide-react";
import { createEmptyActualRecord } from "../data/defaultActualTracking";
import {
  calculateActualDraftPreview,
  calculateActualTracking,
  monthlyNuYieldFromCumulative,
  nextMonth,
} from "../domain/actualTracking";
import type {
  ActualMonthlyRecord,
  ActualTrackingState,
  MonthlyResult,
  Settings,
} from "../domain/types";
import { currency, monthLabel, numberValue } from "../utils/format";

const MoneyField = ({
  label,
  value,
  ideal,
  onChange,
  allowNegative = false,
}: {
  label: string;
  value: number | undefined;
  ideal?: number;
  onChange: (value: number | undefined) => void;
  allowNegative?: boolean;
}) => (
  <label className="actual-field">
    <span>{label}</span>
    <div className="actual-input-row">
      <div className="money-input">
        <span>$</span>
        <input
          aria-label={label}
          aria-describedby="actual-record-errors"
          type="number"
          min={allowNegative ? undefined : "0"}
          step="1000"
          placeholder="Sin registrar"
          value={value ?? ""}
          onChange={(event) =>
            onChange(
              event.target.value === ""
                ? undefined
                : numberValue(event.target.value),
            )
          }
        />
      </div>
      {ideal !== undefined && (
        <small title={`Valor del Ahorro ideal: ${currency(ideal)}`}>
          Ideal <strong>{currency(ideal, true)}</strong>
        </small>
      )}
    </div>
  </label>
);

const statusClass = (status: string) =>
  status === "Confirmado" || status === "Conciliado"
    ? "success"
    : status === "Con diferencia"
      ? "danger"
      : "warning";

export function ActualTrackingView({
  settings,
  tracking,
  idealRows,
  onChange,
  notify,
}: {
  settings: Settings;
  tracking: ActualTrackingState;
  idealRows: MonthlyResult[];
  onChange: (tracking: ActualTrackingState) => void;
  notify: (message: string) => void;
}) {
  const calculated = useMemo(
    () => calculateActualTracking(tracking, settings),
    [tracking, settings],
  );
  const defaultMonth =
    tracking.records.at(-1)?.month ?? tracking.startMonth ?? settings.startDate;
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const storedRecord = tracking.records.find(
    (record) => record.month === selectedMonth,
  );
  const [draft, setDraft] = useState<ActualMonthlyRecord>(
    storedRecord
      ? structuredClone(storedRecord)
      : createEmptyActualRecord(selectedMonth),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showGettingStarted, setShowGettingStarted] = useState(
    tracking.records.length === 0,
  );

  useEffect(() => {
    const found = tracking.records.find(
      (record) => record.month === selectedMonth,
    );
    setDraft(
      found
        ? structuredClone(found)
        : createEmptyActualRecord(selectedMonth),
    );
  }, [selectedMonth, tracking.records]);

  const ideal = idealRows.find((row) => row.date === selectedMonth);
  const previousCumulativeNuYield = useMemo(
    () =>
      calculated
        .filter((month) => month.record.month < selectedMonth)
        .reduce(
          (total, month) => total + month.record.actualNuGrossYield,
          0,
        ),
    [calculated, selectedMonth],
  );
  const derivedMonthlyNuYield =
    draft.actualNuCumulativeYield === undefined
      ? null
      : monthlyNuYieldFromCumulative(
          draft.actualNuCumulativeYield,
          previousCumulativeNuYield,
        );
  const cumulativeYieldError =
    derivedMonthlyNuYield !== null && derivedMonthlyNuYield < 0
      ? "El acumulado verde actual es menor que el acumulado anterior. Revisa el valor o usa el rendimiento mensual manual."
      : null;
  const preview = useMemo(
    () => calculateActualDraftPreview(tracking, draft, settings),
    [tracking, draft, settings],
  );
  const hasReportedBalance =
    preview !== null &&
    (preview.nuDifference !== null || preview.externalDifference !== null);
  const hasReconciliationDifference =
    preview !== null &&
    ((preview.nuDifference !== null && preview.nuDifference !== 0) ||
      (preview.externalDifference !== null &&
        preview.externalDifference !== 0));

  const update = <K extends keyof ActualMonthlyRecord>(
    field: K,
    value: ActualMonthlyRecord[K] | undefined,
  ) => setDraft((current) => ({ ...current, [field]: value }));

  const updateCumulativeNuYield = (value: number | undefined) =>
    setDraft((current) => ({
      ...current,
      actualNuCumulativeYield: value,
      actualNuGrossYield:
        value === undefined
          ? 0
          : Math.max(
              0,
              monthlyNuYieldFromCumulative(
                value,
                previousCumulativeNuYield,
              ),
            ),
    }));

  const saveRecord = (status: "draft" | "confirmed") => {
    if (!preview) return;
    if (
      status === "confirmed" &&
      (preview.errors.length || cumulativeYieldError)
    ) {
      notify("Corrige las validaciones antes de confirmar el mes.");
      return;
    }
    const prior = tracking.records.find(
      (record) => record.month === selectedMonth,
    );
    if (
      prior?.status === "confirmed" &&
      !window.confirm(
        "Este mes ya estaba confirmado. Al guardarlo se recalcularán todos los meses reales posteriores y se conservará la versión anterior. ¿Continuar?",
      )
    ) {
      return;
    }
    const now = new Date().toISOString();
    const nextRecord: ActualMonthlyRecord = {
      ...draft,
      actualNuGrossYield:
        derivedMonthlyNuYield === null
          ? draft.actualNuGrossYield
          : Math.max(0, derivedMonthlyNuYield),
      status,
      reconciliationStatus: hasReconciliationDifference
        ? "pending"
        : "not_required",
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
    };
    onChange({
      ...tracking,
      records: [
        ...tracking.records.filter(
          (record) => record.month !== selectedMonth,
        ),
        nextRecord,
      ].sort((a, b) => a.month.localeCompare(b.month)),
      revisions:
        prior?.status === "confirmed"
          ? [
              ...tracking.revisions,
              {
                id: `revision-${Date.now()}`,
                recordId: prior.id,
                month: prior.month,
                changedAt: now,
                reason: "Edición manual de un mes confirmado",
                previousValues: structuredClone(prior),
              },
            ]
          : tracking.revisions,
    });
    notify(
      status === "confirmed"
        ? "Mes confirmado y meses posteriores recalculados."
        : "Borrador guardado.",
    );
  };

  const copyIdeal = () => {
    if (!ideal) {
      notify("Este mes no tiene una referencia dentro del Ahorro ideal.");
      return;
    }
    const idealRequired =
      ideal.tuitionAmount + ideal.tuitionGmfAmount;
    const idealNuTuition = Math.round(
      idealRequired > 0
        ? ideal.tuitionAmount *
          (ideal.tuitionPaidFromNu / idealRequired)
        : 0,
    );
    const idealExternalTuition = Math.max(
      0,
      ideal.tuitionAmount - idealNuTuition,
    );
    setDraft((current) => ({
      ...current,
      actualIncome: ideal.monthlyIncome,
      actualBonus: ideal.bonusIncome,
      actualRegularContribution: ideal.regularSavings,
      actualBonusContribution: ideal.bonusSavings,
      actualNuCumulativeYield: undefined,
      actualNuGrossYield: ideal.grossYield,
      actualWithholding: ideal.withholding,
      actualExternalYield: ideal.externalYield,
      actualTuitionPayment: ideal.tuitionAmount,
      actualTuitionGmf: ideal.tuitionGmfAmount,
      tuitionFundingSource:
        ideal.tuitionPaidFromExternal > 0 && ideal.tuitionPaidFromNu > 0
          ? "split"
          : ideal.tuitionPaidFromExternal > 0
            ? "external"
            : "nu",
      tuitionFromNu: idealNuTuition,
      tuitionFromExternal: idealExternalTuition,
    }));
    notify(
      "Valores ideales copiados al borrador. No serán reales hasta que guardes o confirmes.",
    );
  };

  const reconcile = () => {
    if (!storedRecord) return;
    if (
      hasReconciliationDifference
    ) {
      notify("La conciliación solo puede confirmarse cuando ambas diferencias sean cero.");
      return;
    }
    if (
      !window.confirm(
        "¿Confirmar que revisaste y explicaste la diferencia? Esta acción no modifica automáticamente los saldos.",
      )
    ) {
      return;
    }
    const now = new Date().toISOString();
    onChange({
      ...tracking,
      records: tracking.records.map((record) =>
        record.id === storedRecord.id
          ? {
              ...record,
              reconciliationStatus: "reconciled",
              updatedAt: now,
            }
          : record,
      ),
      revisions: [
        ...tracking.revisions,
        {
          id: `revision-${Date.now()}`,
          recordId: storedRecord.id,
          month: storedRecord.month,
          changedAt: now,
          reason: "Confirmación de conciliación",
          previousValues: structuredClone(storedRecord),
        },
      ],
    });
    notify("Conciliación confirmada sin alterar los movimientos.");
  };

  const addAdjustmentSuggestion = () => {
    if (!preview) return;
    setDraft((current) => ({
      ...current,
      actualAdjustmentNu:
        current.actualAdjustmentNu + (preview.nuDifference ?? 0),
      actualAdjustmentExternal:
        current.actualAdjustmentExternal +
        (preview.externalDifference ?? 0),
      note:
        current.note ||
        "Ajuste propuesto para conciliar con los saldos reportados.",
    }));
    if (storedRecord) {
      const now = new Date().toISOString();
      onChange({
        ...tracking,
        revisions: [
          ...tracking.revisions,
          {
            id: `revision-${Date.now()}-adjustment`,
            recordId: storedRecord.id,
            month: storedRecord.month,
            changedAt: now,
            reason: "Preparación de ajuste de conciliación",
            previousValues: structuredClone(storedRecord),
          },
        ],
      });
    }
    notify(
      "El ajuste quedó en el borrador. Revísalo antes de guardar; no se aplicó automáticamente.",
    );
  };

  const newMonth = () => {
    const latest =
      [...tracking.records].sort((a, b) => a.month.localeCompare(b.month)).at(-1)
        ?.month ?? tracking.startMonth;
    setSelectedMonth(nextMonth(latest));
  };

  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow green">
            <FileCheck2 size={14} /> Ahorro real
          </div>
          <h1>Aporte mensual</h1>
          <p>
            Registra únicamente lo que ocurrió. Ningún valor ideal se guarda
            automáticamente como real.
          </p>
        </div>
        <button className="button button-primary" onClick={newMonth}>
          <CalendarPlus size={16} /> Registrar siguiente mes
        </button>
      </section>

      <section className={`getting-started ${showGettingStarted ? "open" : ""}`}>
        <button
          className="getting-started-toggle"
          type="button"
          aria-expanded={showGettingStarted}
          aria-controls="actual-getting-started-content"
          onClick={() => setShowGettingStarted((current) => !current)}
        >
          <span className="getting-started-title">
            <span className="getting-started-icon">
              <Info size={18} />
            </span>
            <span>
              <small>Guía inicial</small>
              <strong>Cómo registrar tu primer aporte mensual</strong>
            </span>
          </span>
          <span className="getting-started-action">
            {showGettingStarted ? "Ocultar instrucciones" : "Ver instrucciones"}
            <ChevronDown size={18} />
          </span>
        </button>
        {showGettingStarted && (
          <div
            className="getting-started-content"
            id="actual-getting-started-content"
          >
            <div className="getting-started-intro">
              <strong>Hazlo una sola vez para comenzar</strong>
              <p>
                Define desde qué mes llevarás el seguimiento y escribe los
                saldos que ya tenías justo antes de ese mes. Si comenzaste sin
                ahorros, deja ambos saldos iniciales en cero.
              </p>
            </div>
            <ol className="getting-started-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Configura el punto de partida</strong>
                  <p>
                    En “Inicio del seguimiento” elige el primer mes real. En
                    “Saldo inicial Nu” y “Saldo inicial externo” registra lo que
                    tenías antes de recibir o aportar dinero durante ese mes.
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Selecciona el mes que vas a registrar</strong>
                  <p>
                    Comprueba el mes en “Registro mensual”. Para continuar en
                    orden después, usa “Registrar siguiente mes”; así el
                    acumulado y los saldos parten del cierre anterior.
                  </p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Escribe únicamente lo que ocurrió</strong>
                  <p>
                    “Ingreso recibido” es lo que ganaste; “Aporte realizado” es
                    solo lo que realmente enviaste al ahorro. El ingreso no
                    aumenta el saldo por sí solo. Si pagaste matrícula, registra
                    el valor y selecciona de dónde salió.
                  </p>
                </div>
              </li>
              <li>
                <span>4</span>
                <div>
                  <strong>Registra el rendimiento de Nu</strong>
                  <p>
                    Abre “Detalles avanzados” y copia el número verde “Plata que
                    ha crecido”. La aplicación resta el acumulado anterior y
                    obtiene el rendimiento de ese mes. Escribe aparte cualquier
                    retención que aparezca.
                  </p>
                </div>
              </li>
              <li>
                <span>5</span>
                <div>
                  <strong>Revisa los saldos y confirma</strong>
                  <p>
                    Los saldos reportados sirven para comparar el cálculo con
                    Nu o con el fondo externo; no representan aportes nuevos.
                    Revisa la vista previa, corrige las alertas y confirma el
                    mes cuando los datos sean definitivos.
                  </p>
                </div>
              </li>
            </ol>
            <div className="getting-started-tip">
              <ShieldCheck size={17} />
              <p>
                <strong>Consejo:</strong> puedes guardar un borrador si todavía
                te falta un dato. Solo los meses confirmados aparecen en el
                Resumen del Ahorro real.
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="actual-zero-strip">
        <div>
          <span>Inicio del seguimiento</span>
          <input
            type="month"
            aria-label="Fecha inicial real"
            value={tracking.startMonth}
            onChange={(event) =>
              onChange({ ...tracking, startMonth: event.target.value })
            }
          />
        </div>
        <div>
          <span>Saldo inicial Nu</span>
          <div className="money-input">
            <span>$</span>
            <input
              type="number"
              min="0"
              aria-label="Saldo real inicial en Nu"
              value={tracking.initialNuBalance}
              onChange={(event) =>
                onChange({
                  ...tracking,
                  initialNuBalance: numberValue(event.target.value),
                })
              }
            />
          </div>
        </div>
        <div>
          <span>Saldo inicial externo</span>
          <div className="money-input">
            <span>$</span>
            <input
              type="number"
              min="0"
              aria-label="Saldo real inicial externo"
              value={tracking.initialExternalBalance}
              onChange={(event) =>
                onChange({
                  ...tracking,
                  initialExternalBalance: numberValue(event.target.value),
                })
              }
            />
          </div>
        </div>
        <div className="zero-message">
          <ShieldCheck size={18} />
          <span>
            El Ahorro real inicia en cero y permanece separado del Ahorro ideal.
          </span>
        </div>
      </section>

      <div className="tracking-layout">
        <aside className="month-rail panel">
          <div className="month-rail-head">
            <div>
              <span className="eyebrow">Meses reales</span>
              <strong>{tracking.records.length} registrados</strong>
            </div>
            <button className="icon-button" onClick={newMonth} aria-label="Nuevo mes">
              <Plus size={18} />
            </button>
          </div>
          <button
            className={`month-item ${!storedRecord ? "active" : ""}`}
            onClick={() => setSelectedMonth(selectedMonth)}
          >
            <span className="month-icon">
              <Plus size={15} />
            </span>
            <span>
              <strong>{monthLabel(selectedMonth, true)}</strong>
              <small>{storedRecord ? "Registro existente" : "Nuevo registro"}</small>
            </span>
          </button>
          {[...tracking.records]
            .sort((a, b) => a.month.localeCompare(b.month))
            .reverse()
            .map((record) => {
              const month =
                calculated.find((item) => item.record.id === record.id) ??
                calculateActualDraftPreview(tracking, record, settings);
              return (
              <button
                key={record.id}
                className={`month-item ${
                  record.month === selectedMonth ? "active" : ""
                }`}
                onClick={() => setSelectedMonth(record.month)}
                aria-label={`${monthLabel(record.month, true)}, ${
                  record.status === "draft" ? "En edición" : month.displayStatus
                }, patrimonio ${currency(month.totalBalance)}`}
              >
                <span className="month-icon">
                  {record.status === "confirmed" ? (
                    <LockKeyhole size={14} />
                  ) : (
                    <CircleDollarSign size={14} />
                  )}
                </span>
                <span>
                  <strong>{monthLabel(record.month, true)}</strong>
                  <small>{currency(month.totalBalance)}</small>
                </span>
                <i
                  className={`status-dot ${statusClass(month.displayStatus)}`}
                  title={record.status === "draft" ? "En edición" : month.displayStatus}
                />
              </button>
              );
            })}
          {!tracking.records.length && (
            <p className="rail-empty">Todavía no hay meses guardados.</p>
          )}
        </aside>

        <section className="panel actual-editor">
          <div className="actual-editor-head">
            <div>
              <span className="eyebrow">Registro mensual</span>
              <div className="month-title-row">
                <input
                  type="month"
                  value={selectedMonth}
                  aria-label="Mes del registro"
                  onChange={(event) => setSelectedMonth(event.target.value)}
                />
                {preview && (
                  <span
                    className={`status-pill ${
                      storedRecord
                        ? statusClass(preview.displayStatus)
                        : "neutral"
                    }`}
                  >
                    {storedRecord ? preview.displayStatus : "Pendiente"}
                  </span>
                )}
              </div>
            </div>
            <button className="button button-secondary" onClick={copyIdeal}>
              <Copy size={15} /> Usar ideal como referencia
            </button>
          </div>

          {storedRecord?.status === "confirmed" && (
            <div className="confirmed-warning">
              <LockKeyhole size={17} />
              <div>
                <strong>Este mes está confirmado</strong>
                <p>
                  Si lo modificas, se guardará la versión anterior y se
                  recalcularán todos los meses posteriores.
                </p>
              </div>
            </div>
          )}

          <div className="section-caption">
            <span>Datos principales</span>
            <small>
              Los valores ideales son únicamente una referencia visual.
            </small>
          </div>
          <div className="actual-form-grid actual-primary-fields">
            <MoneyField
              label="Ingreso recibido"
              value={draft.actualIncome}
              ideal={ideal?.monthlyIncome}
              onChange={(value) => update("actualIncome", value ?? 0)}
            />
            <MoneyField
              label="Prima recibida"
              value={draft.actualBonus}
              ideal={ideal?.bonusIncome}
              onChange={(value) => update("actualBonus", value ?? 0)}
            />
            <MoneyField
              label="Aporte realizado"
              value={draft.actualRegularContribution}
              ideal={ideal?.regularSavings}
              onChange={(value) =>
                update("actualRegularContribution", value ?? 0)
              }
            />
            <MoneyField
              label="Matrícula pagada"
              value={draft.actualTuitionPayment}
              ideal={ideal?.tuitionAmount}
              onChange={(value) => update("actualTuitionPayment", value ?? 0)}
            />
          </div>

          {draft.actualTuitionPayment > 0 && (
            <div className="funding-box">
              <div>
                <span className="eyebrow">Origen del pago</span>
                <div className="segmented">
                  {[
                    ["nu", "Desde Nu"],
                    ["external", "Desde externo"],
                    ["split", "Dividido"],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      className={
                        draft.tuitionFundingSource === value ? "active" : ""
                      }
                      onClick={() =>
                        update(
                          "tuitionFundingSource",
                          value as ActualMonthlyRecord["tuitionFundingSource"],
                        )
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {draft.tuitionFundingSource === "split" && (
                <div className="split-fields">
                  <MoneyField
                    label="Pagado desde Nu"
                    value={draft.tuitionFromNu}
                    onChange={(value) => update("tuitionFromNu", value ?? 0)}
                  />
                  <MoneyField
                    label="Pagado desde externo"
                    value={draft.tuitionFromExternal}
                    onChange={(value) =>
                      update("tuitionFromExternal", value ?? 0)
                    }
                  />
                </div>
              )}
            </div>
          )}

          <button
            className={`advanced-toggle ${showAdvanced ? "open" : ""}`}
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <span>
              <Sparkles size={16} />
              <span>
                <strong>Detalles avanzados</strong>
                <small>
                  Rendimientos, retención, traslados, ajustes y notas
                </small>
              </span>
            </span>
            <ChevronDown size={18} />
          </button>
          {showAdvanced && (
            <div className="advanced-content">
              <section className="nu-yield-automation">
                <div className="nu-yield-automation-head">
                  <div className="icon-soft mint">
                    <CircleDollarSign size={18} />
                  </div>
                  <div>
                    <strong>Rendimiento Nu automático</strong>
                    <small>
                      Escribe el número verde “Plata que ha crecido” que muestra
                      Nu. La aplicación resta el acumulado anterior.
                    </small>
                  </div>
                  <span className="status-pill success">Recomendado</span>
                </div>
                <div className="nu-yield-automation-grid">
                  <MoneyField
                    label="Plata que ha crecido (acumulado Nu)"
                    value={draft.actualNuCumulativeYield}
                    onChange={updateCumulativeNuYield}
                  />
                  {derivedMonthlyNuYield === null ? (
                    <MoneyField
                      label="O escribir rendimiento bruto del mes"
                      value={draft.actualNuGrossYield}
                      ideal={ideal?.grossYield}
                      onChange={(value) =>
                        update("actualNuGrossYield", value ?? 0)
                      }
                    />
                  ) : (
                    <div
                      className={`nu-yield-result ${
                        cumulativeYieldError ? "invalid" : ""
                      }`}
                    >
                      <span>Rendimiento calculado del mes</span>
                      <strong>
                        {currency(Math.max(0, derivedMonthlyNuYield))}
                      </strong>
                      <small>
                        {currency(draft.actualNuCumulativeYield ?? 0)} −{" "}
                        {currency(previousCumulativeNuYield)}
                      </small>
                    </div>
                  )}
                </div>
                <p>
                  Acumulado anterior usado:{" "}
                  <strong>{currency(previousCumulativeNuYield)}</strong>. La
                  retención que muestre Nu se registra por separado.
                </p>
              </section>
              <div className="actual-form-grid">
                <MoneyField
                  label="Aporte desde prima"
                  value={draft.actualBonusContribution}
                  ideal={ideal?.bonusSavings}
                  onChange={(value) =>
                    update("actualBonusContribution", value ?? 0)
                  }
                />
                <MoneyField
                  label="Retención real"
                  value={draft.actualWithholding}
                  ideal={ideal?.withholding}
                  onChange={(value) =>
                    update("actualWithholding", value ?? 0)
                  }
                />
                <MoneyField
                  label="Rendimiento externo"
                  value={draft.actualExternalYield}
                  ideal={ideal?.externalYield}
                  onChange={(value) =>
                    update("actualExternalYield", value ?? 0)
                  }
                />
                <MoneyField
                  label="GMF de matrícula"
                  value={draft.actualTuitionGmf}
                  ideal={ideal?.tuitionGmfAmount}
                  onChange={(value) =>
                    update("actualTuitionGmf", value ?? 0)
                  }
                />
                <MoneyField
                  label="Traslado a fondo externo"
                  value={draft.actualTransferToExternal}
                  ideal={ideal?.confirmedExternalTransfer}
                  onChange={(value) =>
                    update("actualTransferToExternal", value ?? 0)
                  }
                />
                <MoneyField
                  label="GMF o costo del traslado"
                  value={draft.actualTransferGmf}
                  ideal={ideal?.externalTransferGmf}
                  onChange={(value) =>
                    update("actualTransferGmf", value ?? 0)
                  }
                />
                <MoneyField
                  label="Otros retiros desde Nu"
                  value={draft.otherWithdrawalFromNu}
                  onChange={(value) =>
                    update("otherWithdrawalFromNu", value ?? 0)
                  }
                />
                <MoneyField
                  label="Otros retiros externos"
                  value={draft.otherWithdrawalFromExternal}
                  onChange={(value) =>
                    update("otherWithdrawalFromExternal", value ?? 0)
                  }
                />
                <MoneyField
                  label="Ajuste de conciliación Nu"
                  value={draft.actualAdjustmentNu}
                  allowNegative
                  onChange={(value) =>
                    update("actualAdjustmentNu", value ?? 0)
                  }
                />
                <MoneyField
                  label="Ajuste externo"
                  value={draft.actualAdjustmentExternal}
                  allowNegative
                  onChange={(value) =>
                    update("actualAdjustmentExternal", value ?? 0)
                  }
                />
              </div>
              <label className="note-field">
                <span>Observación y explicación</span>
                <textarea
                  value={draft.note}
                  placeholder="Describe movimientos atípicos o diferencias de conciliación…"
                  onChange={(event) => update("note", event.target.value)}
                />
              </label>
            </div>
          )}

          <section
            className="reported-balances-section"
            aria-labelledby="reported-balances-title"
          >
            <div className="reported-balances-head">
              <div className="icon-soft sand">
                <Scale size={18} />
              </div>
              <div>
                <strong id="reported-balances-title">
                  Saldos reportados para conciliación
                </strong>
                <small>
                  Son opcionales: permiten comparar con las entidades, pero no
                  cuentan como aportes ni cambian los saldos calculados.
                </small>
              </div>
              <span className="status-pill neutral">Opcional</span>
            </div>
            <div className="reported-balances-grid">
              <MoneyField
                label="Saldo mostrado por Nu al cierre"
                value={draft.reportedNuBalance}
                onChange={(value) => update("reportedNuBalance", value)}
              />
              <MoneyField
                label="Saldo externo mostrado al cierre"
                value={draft.reportedExternalBalance}
                onChange={(value) => update("reportedExternalBalance", value)}
              />
            </div>
            <p>
              Si todavía no conoces alguno, déjalo vacío. Escribir cero
              significa que la entidad realmente mostraba un saldo de $0.
            </p>
          </section>

          {preview && (
            <div className="actual-balance-preview">
              <div>
                <span>Saldo Nu calculado</span>
                <strong>{currency(preview.calculatedNuBalance)}</strong>
              </div>
              <div>
                <span>Saldo externo calculado</span>
                <strong>{currency(preview.calculatedExternalBalance)}</strong>
              </div>
              <div className="primary">
                <span>Patrimonio real calculado</span>
                <strong>{currency(preview.totalBalance)}</strong>
              </div>
            </div>
          )}

          {preview && (preview.errors.length || cumulativeYieldError) ? (
            <div className="actual-errors" role="alert" id="actual-record-errors">
              <AlertCircle size={18} />
              <div>
                <strong>Revisa este registro</strong>
                {cumulativeYieldError && <p>{cumulativeYieldError}</p>}
                {preview.errors.map((error) => (
                  <p key={error}>{error}</p>
                ))}
              </div>
            </div>
          ) : null}

          {preview && hasReportedBalance && (
            <div className="reconciliation-card">
                <div className="reconciliation-head">
                  <div className="icon-soft sand">
                    <Scale size={19} />
                  </div>
                  <div>
                    <span className="eyebrow">Conciliación</span>
                    <h3>Calculado vs reportado</h3>
                  </div>
                  <span
                    className={`status-pill ${
                      hasReconciliationDifference ? "warning" : "success"
                    }`}
                  >
                    {hasReconciliationDifference
                      ? "Pendiente"
                      : "Sin diferencia"}
                  </span>
                </div>
                <div className="reconciliation-grid">
                  <div>
                    <span>Diferencia Nu</span>
                    <strong
                      className={
                        (preview.nuDifference ?? 0) !== 0
                          ? "negative-number"
                          : ""
                      }
                    >
                      {preview.nuDifference === null
                        ? "Sin reportar"
                        : currency(preview.nuDifference)}
                    </strong>
                  </div>
                  <div>
                    <span>Diferencia externa</span>
                    <strong
                      className={
                        (preview.externalDifference ?? 0) !== 0
                          ? "negative-number"
                          : ""
                      }
                    >
                      {preview.externalDifference === null
                        ? "Sin reportar"
                        : currency(preview.externalDifference)}
                    </strong>
                  </div>
                </div>
                <p>
                  {hasReconciliationDifference
                    ? "La diferencia nunca se ajusta sola. Puedes explicarla, trasladarla a los campos de ajuste o dejarla pendiente."
                    : "Los saldos reportados coinciden con el cálculo. Los campos que dejaste vacíos permanecen sin evaluar."}
                </p>
                <div className="reconciliation-actions">
                  {hasReconciliationDifference && (
                    <button
                      className="button button-secondary"
                      onClick={addAdjustmentSuggestion}
                    >
                      <RotateCcw size={15} /> Preparar ajuste
                    </button>
                  )}
                  {storedRecord?.status === "confirmed" && (
                    <button
                      className="button button-secondary"
                      onClick={reconcile}
                      disabled={hasReconciliationDifference}
                    >
                      <Check size={15} /> Confirmar conciliación
                    </button>
                  )}
                </div>
            </div>
          )}

          <div className="actual-editor-actions">
            <p>
              <Info size={14} /> Guardar conserva un borrador. Confirmar fija el
              mes y habilita su uso en la proyección actualizada.
            </p>
            <button
              className="button button-secondary"
              onClick={() => saveRecord("draft")}
            >
              <Save size={16} /> Guardar borrador
            </button>
            <button
              className="button button-primary"
              onClick={() => saveRecord("confirmed")}
            >
              <FileCheck2 size={16} /> Confirmar mes
            </button>
          </div>
        </section>
      </div>

      {tracking.revisions.length > 0 && (
        <section className="panel revisions-panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">Trazabilidad</span>
              <h2>Historial de modificaciones</h2>
            </div>
            <span>{tracking.revisions.length} versiones conservadas</span>
          </div>
          <div className="revision-list">
            {[...tracking.revisions].reverse().slice(0, 8).map((revision) => (
              <div key={revision.id}>
                <span className="icon-soft">
                  <FileCheck2 size={16} />
                </span>
                <div>
                  <strong>{monthLabel(revision.month, true)}</strong>
                  <small>{revision.reason}</small>
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
