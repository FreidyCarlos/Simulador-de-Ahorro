import Decimal from "decimal.js";
import type {
  ActualCalculatedMonth,
  ActualMonthlyRecord,
  ActualSummary,
  ActualTrackingState,
  MonthlyResult,
  PlanActualComparison,
  Settings,
} from "./types";
import { simulate } from "./simulation";

Decimal.set({ precision: 24, rounding: Decimal.ROUND_HALF_UP });
const D = (value: Decimal.Value | undefined) => new Decimal(value ?? 0);
const n = (value: Decimal) => value.toNumber();
const isDefined = (value: number | undefined) =>
  value !== undefined && Number.isFinite(value);

export const nextMonth = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  return monthNumber === 12
    ? `${year + 1}-01`
    : `${year}-${String(monthNumber + 1).padStart(2, "0")}`;
};

export const monthlyNuYieldFromCumulative = (
  currentCumulative: number,
  previousCumulative: number,
) => D(currentCumulative).minus(previousCumulative).toNumber();

export const validateActualRecord = (
  record: ActualMonthlyRecord,
  openingNu: number,
  openingExternal: number,
  settings?: Settings,
) => {
  const errors: string[] = [];
  const nonNegativeFields: Array<[keyof ActualMonthlyRecord, string]> = [
    ["actualIncome", "El ingreso real"],
    ["actualBonus", "La prima real"],
    ["actualRegularContribution", "El aporte regular"],
    ["actualBonusContribution", "El aporte desde prima"],
    ["actualNuGrossYield", "El rendimiento Nu"],
    ["actualWithholding", "La retención"],
    ["actualExternalYield", "El rendimiento externo"],
    ["actualTuitionPayment", "La matrícula"],
    ["actualTuitionGmf", "El GMF de matrícula"],
    ["actualTransferToExternal", "El traslado"],
    ["actualTransferGmf", "El costo del traslado"],
    ["otherWithdrawalFromNu", "El retiro desde Nu"],
    ["otherWithdrawalFromExternal", "El retiro externo"],
  ];
  nonNegativeFields.forEach(([field, label]) => {
    if (Number(record[field]) < 0) errors.push(`${label} no puede ser negativo.`);
  });
  if (record.reportedNuBalance !== undefined && record.reportedNuBalance < 0) {
    errors.push("El saldo Nu reportado no puede ser negativo.");
  }
  if (
    record.actualNuCumulativeYield !== undefined &&
    record.actualNuCumulativeYield < 0
  ) {
    errors.push("El acumulado verde de Nu no puede ser negativo.");
  }
  if (
    record.reportedExternalBalance !== undefined &&
    record.reportedExternalBalance < 0
  ) {
    errors.push("El saldo externo reportado no puede ser negativo.");
  }
  if (
    record.actualNuGrossYield > 0 &&
    openingNu <= 0 &&
    record.actualRegularContribution + record.actualBonusContribution <= 0
  ) {
    errors.push("Hay rendimiento Nu sin un saldo base registrado.");
  }
  if (record.actualExternalYield > 0 && openingExternal <= 0 && record.actualTransferToExternal <= 0) {
    errors.push("Hay rendimiento externo sin un saldo base registrado.");
  }
  if (record.actualWithholding > record.actualNuGrossYield) {
    errors.push("La retención no puede superar el rendimiento bruto de Nu.");
  }
  if (record.tuitionFundingSource === "split") {
    const allocated = D(record.tuitionFromNu).plus(record.tuitionFromExternal);
    if (!allocated.eq(record.actualTuitionPayment)) {
      errors.push("La distribución de la matrícula no coincide con el pago total.");
    }
  }
  const tuitionFromNu =
    record.tuitionFundingSource === "nu"
      ? record.actualTuitionPayment
      : record.tuitionFundingSource === "external"
        ? 0
        : record.tuitionFromNu;
  const tuitionFromExternal =
    record.tuitionFundingSource === "external"
      ? record.actualTuitionPayment
      : record.tuitionFundingSource === "nu"
        ? 0
        : record.tuitionFromExternal;
  const tuitionGmfFromNu =
    record.tuitionFundingSource === "external"
      ? D(0)
      : record.tuitionFundingSource === "split" &&
          record.actualTuitionPayment > 0
        ? D(record.actualTuitionGmf)
            .times(record.tuitionFromNu)
            .div(record.actualTuitionPayment)
        : D(record.actualTuitionGmf);
  const tuitionGmfFromExternal = D(record.actualTuitionGmf).minus(
    tuitionGmfFromNu,
  );
  const availableNu = D(openingNu)
    .plus(record.actualRegularContribution)
    .plus(record.actualBonusContribution)
    .plus(record.actualNuGrossYield)
    .minus(record.actualWithholding);
  if (
    D(record.actualTransferToExternal)
      .plus(record.actualTransferGmf)
      .greaterThan(availableNu)
  ) {
    errors.push("El traslado y su costo superan el saldo Nu disponible.");
  }
  const availableTotal = availableNu
    .plus(openingExternal)
    .plus(record.actualExternalYield);
  if (
    D(record.actualTuitionPayment)
      .plus(record.actualTuitionGmf)
      .greaterThan(availableTotal)
  ) {
    errors.push("La matrícula y sus costos superan el patrimonio disponible.");
  }
  if (D(tuitionFromNu).plus(tuitionGmfFromNu).greaterThan(availableNu)) {
    errors.push("El pago asignado a Nu supera su saldo disponible.");
  }
  if (
    D(tuitionFromExternal).plus(tuitionGmfFromExternal).greaterThan(
      D(openingExternal)
        .plus(record.actualTransferToExternal)
        .plus(record.actualExternalYield),
    )
  ) {
    errors.push("El pago asignado al fondo externo supera su saldo disponible.");
  }
  const projectedNu = availableNu
    .minus(tuitionFromNu)
    .minus(tuitionGmfFromNu)
    .minus(record.actualTransferToExternal)
    .minus(record.actualTransferGmf)
    .minus(record.otherWithdrawalFromNu)
    .plus(record.actualAdjustmentNu);
  const projectedExternal = D(openingExternal)
    .plus(record.actualTransferToExternal)
    .plus(record.actualExternalYield)
    .minus(tuitionFromExternal)
    .minus(tuitionGmfFromExternal)
    .minus(record.otherWithdrawalFromExternal)
    .plus(record.actualAdjustmentExternal);
  if (projectedNu.lessThan(0)) {
    errors.push("Los movimientos dejarían el saldo Nu negativo.");
  }
  if (projectedExternal.lessThan(0)) {
    errors.push("Los movimientos dejarían el saldo externo negativo.");
  }
  if (settings && (record.month < settings.startDate || record.month > settings.endDate)) {
    errors.push("El mes está fuera del rango del Ahorro ideal.");
  }
  return errors;
};

const calculateRecordInternal = (
  record: ActualMonthlyRecord,
  openingNuValue: Decimal.Value,
  openingExternalValue: Decimal.Value,
  settings?: Settings,
) => {
  const openingNu = D(openingNuValue);
  const openingExternal = D(openingExternalValue);
  const tuitionFromNu =
    record.tuitionFundingSource === "nu"
      ? D(record.actualTuitionPayment)
      : record.tuitionFundingSource === "external"
        ? D(0)
        : D(record.tuitionFromNu);
  const tuitionFromExternal =
    record.tuitionFundingSource === "external"
      ? D(record.actualTuitionPayment)
      : record.tuitionFundingSource === "nu"
        ? D(0)
        : D(record.tuitionFromExternal);
  const tuitionGmfFromNu =
    record.tuitionFundingSource === "external"
      ? D(0)
      : record.tuitionFundingSource === "split" && record.actualTuitionPayment > 0
        ? D(record.actualTuitionGmf)
            .times(record.tuitionFromNu)
            .div(record.actualTuitionPayment)
        : D(record.actualTuitionGmf);
  const tuitionGmfFromExternal = D(record.actualTuitionGmf).minus(tuitionGmfFromNu);

  const closingNu = openingNu
    .plus(record.actualRegularContribution)
    .plus(record.actualBonusContribution)
    .plus(record.actualNuGrossYield)
    .minus(record.actualWithholding)
    .minus(tuitionFromNu)
    .minus(tuitionGmfFromNu)
    .minus(record.actualTransferToExternal)
    .minus(record.actualTransferGmf)
    .minus(record.otherWithdrawalFromNu)
    .plus(record.actualAdjustmentNu);
  const closingExternal = openingExternal
    .plus(record.actualTransferToExternal)
    .plus(record.actualExternalYield)
    .minus(tuitionFromExternal)
    .minus(tuitionGmfFromExternal)
    .minus(record.otherWithdrawalFromExternal)
    .plus(record.actualAdjustmentExternal);
  const nuDifference = isDefined(record.reportedNuBalance)
    ? D(record.reportedNuBalance).minus(closingNu).toNumber()
    : null;
  const externalDifference = isDefined(record.reportedExternalBalance)
    ? D(record.reportedExternalBalance).minus(closingExternal).toNumber()
    : null;
  const hasDifference =
    (nuDifference !== null && !D(nuDifference).eq(0)) ||
    (externalDifference !== null && !D(externalDifference).eq(0));
  const displayStatus =
    record.status === "draft"
      ? "En edición"
      : hasDifference
          ? "Con diferencia"
          : record.reconciliationStatus === "reconciled"
            ? "Conciliado"
            : "Confirmado";
  const month: ActualCalculatedMonth = {
    record,
    openingNuBalance: n(openingNu),
    openingExternalBalance: n(openingExternal),
    calculatedNuBalance: n(closingNu),
    calculatedExternalBalance: n(closingExternal),
    totalBalance: n(closingNu.plus(closingExternal)),
    nuDifference,
    externalDifference,
    totalContributions: D(record.actualRegularContribution)
      .plus(record.actualBonusContribution)
      .toNumber(),
    totalGrossYield: D(record.actualNuGrossYield)
      .plus(record.actualExternalYield)
      .toNumber(),
    totalCosts: D(record.actualWithholding)
      .plus(record.actualTuitionGmf)
      .plus(record.actualTransferGmf)
      .toNumber(),
    displayStatus,
    errors: validateActualRecord(
      record,
      openingNu.toNumber(),
      openingExternal.toNumber(),
      settings,
    ),
  };
  return { month, closingNu, closingExternal };
};

const calculateRecord = (
  record: ActualMonthlyRecord,
  openingNuValue: Decimal.Value,
  openingExternalValue: Decimal.Value,
  settings?: Settings,
) =>
  calculateRecordInternal(
    record,
    openingNuValue,
    openingExternalValue,
    settings,
  ).month;

export const calculateActualTracking = (
  tracking: ActualTrackingState,
  settings?: Settings,
) => analyzeConfirmedActualTimeline(tracking, settings).months;

export interface ExcludedActualRecord {
  record: ActualMonthlyRecord;
  reasons: string[];
}

export const analyzeConfirmedActualTimeline = (
  tracking: ActualTrackingState,
  settings?: Settings,
) => {
  const counts = new Map<string, number>();
  tracking.records.forEach((record) =>
    counts.set(record.month, (counts.get(record.month) ?? 0) + 1),
  );
  let nu = D(tracking.initialNuBalance);
  let external = D(tracking.initialExternalBalance);
  let cumulativeNuYield = D(0);
  const excluded: ExcludedActualRecord[] = [];
  const months: ActualCalculatedMonth[] = [];
  [...tracking.records]
    .sort((a, b) => a.month.localeCompare(b.month))
    .forEach((record) => {
      if (record.status !== "confirmed") return;
      if ((counts.get(record.month) ?? 0) > 1) {
        excluded.push({ record, reasons: [`El mes ${record.month} está duplicado.`] });
        return;
      }
      const normalizedRecord = isDefined(record.actualNuCumulativeYield)
        ? {
            ...record,
            actualNuGrossYield: monthlyNuYieldFromCumulative(
              record.actualNuCumulativeYield!,
              cumulativeNuYield.toNumber(),
            ),
          }
        : record;
      const internal = calculateRecordInternal(
        normalizedRecord,
        nu,
        external,
        settings,
      );
      const calculated = internal.month;
      if (calculated.errors.length) {
        excluded.push({ record, reasons: calculated.errors });
        return;
      }
      if (
        !Number.isFinite(calculated.calculatedNuBalance) ||
        !Number.isFinite(calculated.calculatedExternalBalance) ||
        calculated.calculatedNuBalance < 0 ||
        calculated.calculatedExternalBalance < 0
      ) {
        excluded.push({ record, reasons: ["El cierre calculado no es finito o es negativo."] });
        return;
      }
      nu = internal.closingNu;
      external = internal.closingExternal;
      cumulativeNuYield = isDefined(record.actualNuCumulativeYield)
        ? D(record.actualNuCumulativeYield)
        : cumulativeNuYield.plus(record.actualNuGrossYield);
      months.push(calculated);
    });
  return {
    months,
    excluded,
    duplicateMonths: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([month]) => month),
  };
};

export const calculateActualDraftPreview = (
  tracking: ActualTrackingState,
  draft: ActualMonthlyRecord,
  settings?: Settings,
) => {
  const priorTracking: ActualTrackingState = {
    ...tracking,
    records: tracking.records.filter(
      (record) => record.month < draft.month && record.status === "confirmed",
    ),
  };
  const prior = analyzeConfirmedActualTimeline(priorTracking, settings).months;
  const last = prior.at(-1);
  const priorCumulativeNuYield = prior.reduce(
    (total, month) => total.plus(month.record.actualNuGrossYield),
    D(0),
  );
  const normalizedDraft = isDefined(draft.actualNuCumulativeYield)
    ? {
        ...draft,
        actualNuGrossYield: monthlyNuYieldFromCumulative(
          draft.actualNuCumulativeYield!,
          priorCumulativeNuYield.toNumber(),
        ),
      }
    : draft;
  return calculateRecord(
    { ...normalizedDraft, status: "draft" },
    last?.calculatedNuBalance ?? tracking.initialNuBalance,
    last?.calculatedExternalBalance ?? tracking.initialExternalBalance,
    settings,
  );
};

export const validateActualTrackingState = (
  tracking: ActualTrackingState,
  settings?: Settings,
) => {
  const errors: string[] = [];
  const seen = new Set<string>();
  let previous = "";
  tracking.records.forEach((record) => {
    if (seen.has(record.month)) {
      errors.push(`El mes ${record.month} está duplicado.`);
    }
    if (previous && record.month < previous) {
      errors.push("Los registros mensuales están fuera de orden.");
    }
    if (
      settings &&
      (record.month < settings.startDate || record.month > settings.endDate)
    ) {
      errors.push(`El mes ${record.month} está fuera del rango del Ahorro ideal.`);
    }
    seen.add(record.month);
    previous = record.month;
  });
  const analysis = analyzeConfirmedActualTimeline(tracking, settings);
  analysis.excluded.forEach(({ record, reasons }) =>
    reasons.forEach((reason) => errors.push(`${record.month}: ${reason}`)),
  );
  return errors;
};

export const saveActualRecord = (
  tracking: ActualTrackingState,
  record: ActualMonthlyRecord,
  changedAt = new Date().toISOString(),
  reason = "Edición manual de un mes confirmado",
): ActualTrackingState => {
  const previous = tracking.records.find((item) => item.month === record.month);
  return {
    ...tracking,
    records: [
      ...tracking.records.filter((item) => item.month !== record.month),
      {
        ...record,
        createdAt: previous?.createdAt ?? changedAt,
        updatedAt: changedAt,
      },
    ].sort((a, b) => a.month.localeCompare(b.month)),
    revisions:
      previous?.status === "confirmed"
        ? [
            ...tracking.revisions,
            {
              id: `revision-${changedAt}-${previous.id}`,
              recordId: previous.id,
              month: previous.month,
              changedAt,
              reason,
              previousValues: structuredClone(previous),
            },
          ]
        : tracking.revisions,
  };
};

export const summarizeActual = (
  tracking: ActualTrackingState,
  calculated = calculateActualTracking(tracking),
): ActualSummary => {
  const last = calculated.at(-1);
  const confirmed = calculated.filter((month) => month.record.status === "confirmed");
  const sum = (selector: (month: ActualCalculatedMonth) => Decimal.Value) =>
    calculated.reduce(
      (total, month) => total.plus(selector(month)),
      D(0),
    ).toNumber();
  return {
    finalNuBalance: last?.calculatedNuBalance ?? tracking.initialNuBalance,
    finalExternalBalance:
      last?.calculatedExternalBalance ?? tracking.initialExternalBalance,
    finalTotalBalance:
      last?.totalBalance ??
      D(tracking.initialNuBalance).plus(tracking.initialExternalBalance).toNumber(),
    totalContributions: sum((month) => month.totalContributions),
    totalGrossYield: sum((month) => month.totalGrossYield),
    totalWithholding: sum((month) => month.record.actualWithholding),
    totalTuition: sum((month) => month.record.actualTuitionPayment),
    totalGmf: sum((month) =>
      D(month.record.actualTuitionGmf).plus(month.record.actualTransferGmf),
    ),
    confirmedMonths: confirmed.length,
    registeredMonths: calculated.length,
    lastConfirmedMonth: confirmed.at(-1)?.record.month,
    pendingReconciliations: calculated.filter(
      (month) =>
        month.displayStatus === "Con diferencia" &&
        month.record.reconciliationStatus !== "reconciled",
    ).length,
  };
};

export const variation = (ideal: number, actual: number | null) => {
  if (actual === null) return { amount: null, percentage: null, label: "Sin registrar" };
  const rawAmount = D(actual).minus(ideal);
  const amount = rawAmount.abs().lessThan(0.5) ? 0 : rawAmount.toNumber();
  if (D(ideal).eq(0)) {
    return {
      amount,
      percentage: null,
      label: amount === 0 ? "Sin base de comparación" : "Nuevo movimiento",
    };
  }
  return {
    amount,
    percentage: amount === 0 ? 0 : D(actual).div(ideal).minus(1).toNumber(),
    label: amount === 0
      ? "Según el plan"
      : amount > 0
        ? "Por encima del plan"
        : "Por debajo del plan",
  };
};

export const metricVariation = (
  ideal: number,
  actual: number | null,
  cost = false,
) => {
  const result = variation(ideal, actual);
  if (result.amount === null) return { ideal, actual, ...result };
  const label =
    result.amount === 0
      ? cost
        ? "Costo según el plan"
        : "Según el plan"
      : cost
        ? result.amount > 0
          ? "Costo superior al esperado"
          : "Costo inferior al esperado"
        : result.label;
  return { ideal, actual, ...result, label };
};

export const buildPlanActualComparison = (
  idealRows: MonthlyResult[],
  actualMonths: ActualCalculatedMonth[],
): PlanActualComparison[] => {
  const actualMap = new Map(actualMonths.map((month) => [month.record.month, month]));
  return idealRows.map((ideal) => {
    const actual = actualMap.get(ideal.date);
    const actualTotal = actual?.totalBalance ?? null;
    const totalVar = variation(ideal.closingTotalBalance, actualTotal);
    const actualContribution = actual?.totalContributions ?? null;
    const actualYield = actual?.totalGrossYield ?? null;
    const actualGmf = actual
      ? actual.record.actualTuitionGmf + actual.record.actualTransferGmf
      : null;
    return {
      month: ideal.date,
      idealIncome: ideal.monthlyIncome,
      actualIncome: actual?.record.actualIncome ?? null,
      idealBonusContribution: ideal.bonusSavings,
      actualBonusContribution:
        actual?.record.actualBonusContribution ?? null,
      idealContribution: ideal.totalContribution,
      actualContribution,
      idealYield: ideal.grossYield + ideal.externalYield,
      actualYield,
      idealWithholding: ideal.withholding,
      actualWithholding: actual?.record.actualWithholding ?? null,
      idealTuition: ideal.tuitionAmount,
      actualTuition: actual?.record.actualTuitionPayment ?? null,
      idealGmf: ideal.tuitionGmfAmount + ideal.externalTransferGmf,
      actualGmf,
      idealNuBalance: ideal.closingNuBalance,
      actualNuBalance: actual?.calculatedNuBalance ?? null,
      idealExternalBalance: ideal.closingExternalBalance,
      actualExternalBalance: actual?.calculatedExternalBalance ?? null,
      idealTotalBalance: ideal.closingTotalBalance,
      actualTotalBalance: actualTotal,
      totalVariation: totalVar.amount,
      totalVariationPercentage: totalVar.percentage,
      metrics: {
        income: metricVariation(ideal.monthlyIncome, actual?.record.actualIncome ?? null),
        bonusContribution: metricVariation(
          ideal.bonusSavings,
          actual?.record.actualBonusContribution ?? null,
        ),
        contribution: metricVariation(ideal.totalContribution, actualContribution),
        yield: metricVariation(ideal.grossYield + ideal.externalYield, actualYield),
        withholding: metricVariation(
          ideal.withholding,
          actual?.record.actualWithholding ?? null,
          true,
        ),
        tuition: metricVariation(
          ideal.tuitionAmount,
          actual?.record.actualTuitionPayment ?? null,
          true,
        ),
        gmf: metricVariation(
          ideal.tuitionGmfAmount + ideal.externalTransferGmf,
          actualGmf,
          true,
        ),
        nuBalance: metricVariation(ideal.closingNuBalance, actual?.calculatedNuBalance ?? null),
        externalBalance: metricVariation(
          ideal.closingExternalBalance,
          actual?.calculatedExternalBalance ?? null,
        ),
        totalBalance: metricVariation(ideal.closingTotalBalance, actualTotal),
      },
    };
  });
};

export const buildUpdatedProjectionDetails = (
  settings: Settings,
  tracking: ActualTrackingState,
  precomputedIdeal = simulate(settings),
) => {
  const ideal = precomputedIdeal;
  const primary = settings.scenarios.find((scenario) => scenario.enabled);
  const idealRows = ideal.monthly.filter((row) => row.scenarioId === primary?.id);
  const analysis = analyzeConfirmedActualTimeline(tracking, settings);
  const actual = analysis.months;
  const blockers = analysis.excluded.map((item) => ({
    month: item.record.month,
    reason: item.reasons.join(" "),
  }));
  analysis.duplicateMonths.forEach((month) => {
    if (!blockers.some((blocker) => blocker.month === month && blocker.reason.includes("duplicado"))) {
      blockers.push({
        month,
        reason: `El mes ${month} tiene registros duplicados que deben resolverse.`,
      });
    }
  });
  const earliestExcludedMonth = [
    ...analysis.excluded.map((item) => item.record.month),
    ...analysis.duplicateMonths,
  ]
    .sort()[0];
  let chainBroken = false;
  const eligible = actual.filter((month) => {
    if (earliestExcludedMonth && month.record.month >= earliestExcludedMonth) {
      blockers.push({
        month: month.record.month,
        reason: `Existe un registro no elegible desde ${earliestExcludedMonth}.`,
      });
      return false;
    }
    const hasDifference =
      (month.nuDifference !== null && !D(month.nuDifference).eq(0)) ||
      (month.externalDifference !== null && !D(month.externalDifference).eq(0));
    const pendingDifference =
      month.record.reconciliationStatus === "pending" && hasDifference;
    if (hasDifference || pendingDifference) {
      blockers.push({
        month: month.record.month,
        reason: "La diferencia de conciliación está pendiente o continúa vigente.",
      });
      chainBroken = true;
      return false;
    }
    if (chainBroken) {
      blockers.push({
        month: month.record.month,
        reason: "Existe un cierre anterior no elegible en la cadena.",
      });
      return false;
    }
    return true;
  });
  const last = eligible.at(-1);
  if (!last || !primary) {
    const actualMap = new Map(
      actual.map((month) => [month.record.month, month.totalBalance]),
    );
    return {
      series: idealRows.map((row) => ({
        month: row.date,
        ideal: row.closingTotalBalance,
        actual: actualMap.get(row.date) ?? null,
        updated: row.closingTotalBalance,
      })),
      blockers,
    };
  }
  const futureStart = nextMonth(last.record.month);
  const futureSettings: Settings = {
    ...settings,
    startDate: futureStart,
    scenarios: [
      {
        ...primary,
        initialNuBalance: last.calculatedNuBalance,
        initialExternalBalance: last.calculatedExternalBalance,
      },
    ],
    transfers: settings.transfers.filter((transfer) => transfer.date >= futureStart),
  };
  const future =
    futureStart <= settings.endDate ? simulate(futureSettings).monthly : [];
  const futureMap = new Map(future.map((row) => [row.date, row.closingTotalBalance]));
  const actualMap = new Map(actual.map((month) => [month.record.month, month.totalBalance]));
  return {
    series: idealRows.map((row) => ({
      month: row.date,
      ideal: row.closingTotalBalance,
      actual: actualMap.get(row.date) ?? null,
      updated:
        row.date <= last.record.month
          ? actualMap.get(row.date) ?? null
          : futureMap.get(row.date) ?? null,
    })),
    closingMonth: last.record.month,
    blockers,
  };
};

export const buildUpdatedProjection = (
  settings: Settings,
  tracking: ActualTrackingState,
) => buildUpdatedProjectionDetails(settings, tracking).series;

export const calculateContributionCompliance = (
  idealRows: MonthlyResult[],
  actualMonths: ActualCalculatedMonth[],
) => {
  const lastMonth = actualMonths.at(-1)?.record.month;
  if (!lastMonth) return null;
  const ideal = idealRows
    .filter((row) => row.date <= lastMonth)
    .reduce((sum, row) => sum.plus(row.totalContribution), D(0));
  if (D(ideal).eq(0)) return null;
  const actual = actualMonths.reduce(
    (sum, month) => sum.plus(month.totalContributions),
    D(0),
  );
  return actual.div(ideal).times(100).toNumber();
};
