import Decimal from "decimal.js";
import type {
  AppliedTransferResult,
  MonthlyResult,
  SavingsScenario,
  ScenarioSummary,
  Settings,
  SimulationResult,
  TuitionEvent,
  ValidationIssue,
} from "./types";

Decimal.set({ precision: 24, rounding: Decimal.ROUND_HALF_UP });
const D = (value: Decimal.Value) => new Decimal(value);
const n = (value: Decimal) => value.toNumber();
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const monthlyRateDecimal = (effectiveAnnualRate: number) =>
  D(effectiveAnnualRate)
    .div(100)
    .plus(1)
    .pow(D(1).div(12))
    .minus(1);

export const monthlyRate = (effectiveAnnualRate: number) =>
  monthlyRateDecimal(effectiveAnnualRate).toNumber();

export const withholdingOn = (grossYield: number, rate: number) =>
  D(grossYield).times(rate).div(100).toNumber();

export const gmfOn = (amount: number, rate: number) =>
  D(amount).times(rate).div(100).toNumber();

export const suggestedTransfer = (
  nuBalance: number,
  concentration: Settings["concentration"],
) => {
  if (concentration.suggestionMode === "fixedAmount") {
    return Math.max(0, Math.min(nuBalance, concentration.fixedTransferAmount));
  }
  const target =
    concentration.suggestionMode === "reduceToTarget"
      ? concentration.targetNuBalance
      : concentration.referenceLimit - concentration.safetyMargin;
  return Math.max(0, nuBalance - target);
};

const monthRange = (start: string, end: string) => {
  const [sy, sm] = start.split("-").map(Number);
  const [ey, em] = end.split("-").map(Number);
  const result: string[] = [];
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); ) {
    result.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m === 13) {
      y += 1;
      m = 1;
    }
  }
  return result;
};

export const validateSettings = (settings: Settings): ValidationIssue[] => {
  const issues: ValidationIssue[] = [];
  const validStart = MONTH_PATTERN.test(settings.startDate);
  const validEnd = MONTH_PATTERN.test(settings.endDate);
  if (!validStart) {
    issues.push({ field: "startDate", message: "La fecha inicial debe tener formato AAAA-MM." });
  }
  if (!validEnd) {
    issues.push({ field: "endDate", message: "La fecha final debe tener formato AAAA-MM." });
  }
  if (settings.startDate > settings.endDate) {
    issues.push({ field: "period", message: "La fecha final debe ser posterior al inicio." });
  }
  const neededYears =
    validStart && validEnd && settings.startDate <= settings.endDate
      ? [...new Set(monthRange(settings.startDate, settings.endDate).map((d) => +d.slice(0, 4)))]
      : [];
  const incomeYears = new Set(settings.incomes.map((i) => i.year));
  const rateYears = new Set(settings.yieldRates.map((i) => i.year));
  if (incomeYears.size !== settings.incomes.length) {
    issues.push({ field: "incomes", message: "Hay años de ingreso duplicados." });
  }
  if (rateYears.size !== settings.yieldRates.length) {
    issues.push({ field: "yields", message: "Hay años de tasa Nu duplicados." });
  }
  neededYears.forEach((year) => {
    if (!incomeYears.has(year)) {
      issues.push({ field: "incomes", message: `Falta el ingreso mensual de ${year}.` });
    }
    if (settings.yieldsEnabled && !rateYears.has(year)) {
      issues.push({ field: "yields", message: `Falta la tasa E.A. de ${year}.` });
    }
  });
  settings.scenarios.forEach((scenario) => {
    if (
      !Number.isFinite(scenario.savingsRate) ||
      scenario.savingsRate < 0 ||
      scenario.savingsRate > 100
    ) {
      issues.push({ field: "scenarios", message: `${scenario.name}: el ahorro debe estar entre 0 % y 100 %.` });
    }
    if (
      !Number.isFinite(scenario.initialNuBalance) ||
      !Number.isFinite(scenario.initialExternalBalance) ||
      scenario.initialNuBalance < 0 ||
      scenario.initialExternalBalance < 0
    ) {
      issues.push({ field: "scenarios", message: `${scenario.name}: los saldos iniciales no pueden ser negativos.` });
    }
  });
  settings.incomes.forEach((income) => {
    if (!Number.isInteger(income.year) || !Number.isFinite(income.monthlyIncome) || income.monthlyIncome < 0) {
      issues.push({ field: "incomes", message: `El ingreso de ${income.year} no es válido.` });
    }
  });
  settings.yieldRates.forEach((rate) => {
    if (
      !Number.isInteger(rate.year) ||
      !Number.isFinite(rate.effectiveAnnualRate) ||
      rate.effectiveAnnualRate < -100
    ) {
      issues.push({ field: "yields", message: `La tasa de ${rate.year} no es válida.` });
    }
  });
  settings.tuitionEvents.forEach((event) => {
    if (event.amount <= 0 && event.enabled) issues.push({ field: "tuition", message: `${event.label || "Una matrícula"} no tiene un valor válido.` });
    if (!MONTH_PATTERN.test(event.date)) issues.push({ field: "tuition", message: `${event.label || "Una matrícula"} tiene un mes inválido.` });
  });
  const tuitionIds = settings.tuitionEvents.map((event) => event.id);
  if (new Set(tuitionIds).size !== tuitionIds.length) {
    issues.push({ field: "tuition", message: "Hay matrículas con identificadores duplicados." });
  }
  if (settings.concentration.alertThreshold > settings.concentration.referenceLimit) {
    issues.push({ field: "concentration", message: "El umbral no puede superar el límite de referencia." });
  }
  const percentageValues = [
    ["prima", settings.bonus.percentage],
    ["retención", settings.taxes.withholdingRate],
    ["GMF", settings.taxes.gmfRate],
  ] as const;
  percentageValues.forEach(([label, value]) => {
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      issues.push({
        field: "percentages",
        message: `El porcentaje de ${label} debe estar entre 0 % y 100 %.`,
      });
    }
  });
  const finiteConfiguration = [
    ["monto fijo de prima", settings.bonus.fixedAmount, 0],
    ["límite de referencia", settings.concentration.referenceLimit, 0],
    ["umbral", settings.concentration.alertThreshold, 0],
    ["monto fijo de traslado", settings.concentration.fixedTransferAmount, 0],
    ["saldo objetivo", settings.concentration.targetNuBalance, 0],
    ["margen de seguridad", settings.concentration.safetyMargin, 0],
    ["tasa externa", settings.concentration.externalAnnualYieldRate, -100],
  ] as const;
  finiteConfiguration.forEach(([label, value, minimum]) => {
    if (!Number.isFinite(value) || value < minimum) {
      issues.push({
        field: "configuration",
        message: `El valor de ${label} no es válido.`,
      });
    }
  });
  if (
    settings.concentration.suggestionMode === "reduceToTarget" &&
    settings.concentration.targetNuBalance >= settings.concentration.alertThreshold
  ) {
    issues.push({ field: "concentration", message: "El saldo objetivo debe ser menor que el umbral." });
  }
  const transferIds = settings.transfers.map((transfer) => transfer.id);
  if (new Set(transferIds).size !== transferIds.length) {
    issues.push({ field: "transfers", message: "Hay traslados con identificadores duplicados." });
  }
  settings.transfers.forEach((transfer) => {
    if (!MONTH_PATTERN.test(transfer.date) || (transfer.postponedTo && !MONTH_PATTERN.test(transfer.postponedTo))) {
      issues.push({ field: "transfers", message: `El traslado ${transfer.id || "sin ID"} tiene un mes inválido.` });
    }
    if (!Number.isFinite(transfer.amount) || transfer.amount < 0) {
      issues.push({ field: "transfers", message: `El traslado ${transfer.id || "sin ID"} tiene un monto inválido.` });
    }
  });
  return issues;
};

interface PendingTuitionObligation {
  eventId: string;
  originalMonth: string;
  attempts: number;
}

interface SimulationIndexes {
  incomes: Map<number, number>;
  rates: Map<number, number>;
  tuitionByMonth: Map<string, TuitionEvent[]>;
  tuitionById: Map<string, TuitionEvent>;
  transfersByScenarioMonth: Map<string, Settings["transfers"]>;
}

const createIndexes = (settings: Settings): SimulationIndexes => {
  const tuitionByMonth = new Map<string, TuitionEvent[]>();
  settings.tuitionEvents.forEach((event) => {
    const list = tuitionByMonth.get(event.date) ?? [];
    list.push(event);
    tuitionByMonth.set(event.date, list);
  });
  const transfersByScenarioMonth = new Map<string, Settings["transfers"]>();
  settings.transfers.forEach((transfer) => {
    const key = `${transfer.scenarioId}|${transfer.date}`;
    const list = transfersByScenarioMonth.get(key) ?? [];
    list.push(transfer);
    transfersByScenarioMonth.set(key, list);
  });
  transfersByScenarioMonth.forEach((events) =>
    events.sort((a, b) =>
      `${a.createdAt}|${a.id}`.localeCompare(`${b.createdAt}|${b.id}`),
    ),
  );
  return {
    incomes: new Map(settings.incomes.map((item) => [item.year, item.monthlyIncome])),
    rates: new Map(settings.yieldRates.map((item) => [item.year, item.effectiveAnnualRate])),
    tuitionByMonth,
    tuitionById: new Map(settings.tuitionEvents.map((event) => [event.id, event])),
    transfersByScenarioMonth,
  };
};

const allocatePayment = (
  required: Decimal,
  nu: Decimal,
  external: Decimal,
  order: Settings["concentration"]["tuitionFundingOrder"],
) => {
  if (order === "nuFirst") {
    const fromNu = Decimal.min(nu, required);
    return { fromNu, fromExternal: required.minus(fromNu) };
  }
  const fromExternal = Decimal.min(external, required);
  return { fromExternal, fromNu: required.minus(fromExternal) };
};

function simulateScenario(
  settings: Settings,
  scenario: SavingsScenario,
  indexes: SimulationIndexes,
): MonthlyResult[] {
  let nu = D(scenario.initialNuBalance);
  let external = D(scenario.initialExternalBalance);
  let tuitionPaymentsEnabled = true;
  let pendingTuition: PendingTuitionObligation[] = [];
  const results: MonthlyResult[] = [];
  for (const date of monthRange(settings.startDate, settings.endDate)) {
    const year = +date.slice(0, 4);
    const month = +date.slice(5, 7);
    const openingNu = nu;
    const openingExternal = external;
    const openingTotal = nu.plus(external);
    let confirmedExternalTransfer = D(0);
    let externalTransferGmf = D(0);
    const appliedTransfers: AppliedTransferResult[] = [];
    const transferIssues: string[] = [];
    const transfers = (
      indexes.transfersByScenarioMonth.get(`${scenario.id}|${date}`) ?? []
    ).filter((item) => item.status === "confirmed");
    transfers.forEach((transfer) => {
      const amount = D(transfer.amount);
      const cost =
        settings.concentration.applyGmfToExternalTransfer && settings.taxes.gmfEnabled
          ? amount.times(settings.taxes.gmfRate).div(100)
          : D(0);
      const nuBefore = nu;
      if (nu.greaterThanOrEqualTo(amount.plus(cost))) {
        nu = nu.minus(amount).minus(cost);
        external = external.plus(amount);
        confirmedExternalTransfer = confirmedExternalTransfer.plus(amount);
        externalTransferGmf = externalTransferGmf.plus(cost);
        appliedTransfers.push({
          id: transfer.id,
          amount: n(amount),
          cost: n(cost),
          nuBalanceBefore: n(nuBefore),
          nuBalanceAfter: n(nu),
          externalBalanceAfter: n(external),
          status: "applied",
        });
      } else {
        const issue = `El traslado confirmado ${transfer.id} no es financiable en ${date}.`;
        transferIssues.push(issue);
        appliedTransfers.push({
          id: transfer.id,
          amount: n(amount),
          cost: n(cost),
          nuBalanceBefore: n(nuBefore),
          nuBalanceAfter: n(nu),
          externalBalanceAfter: n(external),
          status: "invalid",
          issue,
        });
      }
    });

    pendingTuition = pendingTuition.filter(
      (obligation) => indexes.tuitionById.get(obligation.eventId)?.enabled,
    );
    (indexes.tuitionByMonth.get(date) ?? [])
      .filter((event) => event.enabled)
      .forEach((event) => {
        if (!pendingTuition.some((item) => item.eventId === event.id)) {
          pendingTuition.push({ eventId: event.id, originalMonth: date, attempts: 0 });
        }
      });
    pendingTuition.sort((a, b) =>
      `${a.originalMonth}|${a.eventId}`.localeCompare(
        `${b.originalMonth}|${b.eventId}`,
      ),
    );

    let tuitionAmount = D(0);
    let tuitionPaidAmount = D(0);
    let tuitionGmf = D(0);
    let totalWithdrawal = D(0);
    const tuitionLabels: string[] = [];
    const tuitionOriginalMonths: string[] = [];
    const tuitionAttempts: MonthlyResult["tuitionAttempts"] = [];
    let fromNu = D(0);
    let fromExternal = D(0);
    let tuitionPaid = false;
    let failure = false;
    let missing = D(0);
    let attempted = 0;
    const paidIds = new Set<string>();
    let tuitionPaymentStatus: MonthlyResult["tuitionPaymentStatus"] = "not_due";

    if (pendingTuition.length && tuitionPaymentsEnabled) {
      for (const obligation of pendingTuition) {
        const event = indexes.tuitionById.get(obligation.eventId);
        if (!event?.enabled) continue;
        attempted += 1;
        obligation.attempts += 1;
        const amount = D(event.amount);
        const cost =
          settings.taxes.gmfEnabled && !settings.taxes.gmfExempt
            ? amount.times(settings.taxes.gmfRate).div(100)
            : D(0);
        const required = amount.plus(cost);
        tuitionAmount = tuitionAmount.plus(amount);
        tuitionLabels.push(event.label);
        tuitionOriginalMonths.push(obligation.originalMonth);
        if (nu.plus(external).greaterThanOrEqualTo(required)) {
          const allocation = allocatePayment(
            required,
          nu,
          external,
          settings.concentration.tuitionFundingOrder,
        );
          fromNu = fromNu.plus(allocation.fromNu);
          fromExternal = fromExternal.plus(allocation.fromExternal);
          nu = nu.minus(allocation.fromNu);
          external = external.minus(allocation.fromExternal);
          tuitionPaidAmount = tuitionPaidAmount.plus(amount);
          tuitionGmf = tuitionGmf.plus(cost);
          totalWithdrawal = totalWithdrawal.plus(required);
          paidIds.add(obligation.eventId);
          tuitionAttempts.push({
            eventId: obligation.eventId,
            originalMonth: obligation.originalMonth,
            attemptMonth: date,
            attemptNumber: obligation.attempts,
            amount: n(amount),
            gmfCharged: n(cost),
            status: "paid",
          });
        } else {
        failure = true;
          missing = missing.plus(required.minus(nu.plus(external)));
          if (settings.failureMode === "stopFuturePayments") {
            tuitionPaymentsEnabled = false;
            tuitionPaymentStatus = "failed";
          } else {
            tuitionPaymentStatus = "pending_retry";
          }
          tuitionAttempts.push({
            eventId: obligation.eventId,
            originalMonth: obligation.originalMonth,
            attemptMonth: date,
            attemptNumber: obligation.attempts,
            amount: n(amount),
            gmfCharged: 0,
            status:
              settings.failureMode === "stopFuturePayments"
                ? "failed"
                : "pending_retry",
          });
          break;
        }
      }
      pendingTuition = pendingTuition.filter(
        (obligation) => !paidIds.has(obligation.eventId),
      );
      tuitionPaid = attempted > 0 && !failure && pendingTuition.length === 0;
      if (tuitionPaid) tuitionPaymentStatus = "paid";
    } else if (pendingTuition.length && !tuitionPaymentsEnabled) {
      tuitionPaymentStatus = "skipped_after_failure";
      tuitionAmount = pendingTuition.reduce(
        (sum, item) =>
          sum.plus(indexes.tuitionById.get(item.eventId)?.amount ?? 0),
        D(0),
      );
      tuitionLabels.push(
        ...pendingTuition
          .map((item) => indexes.tuitionById.get(item.eventId)?.label)
          .filter((label): label is string => Boolean(label)),
      );
      tuitionOriginalMonths.push(...pendingTuition.map((item) => item.originalMonth));
    }

    const income = D(indexes.incomes.get(year)!);
    const regularSavings = income.times(scenario.savingsRate).div(100);
    const bonusIncome =
      settings.bonus.enabled && month === settings.bonus.month
        ? settings.bonus.mode === "fixed"
          ? D(settings.bonus.fixedAmount)
          : income.times(settings.bonus.percentage).div(100)
        : D(0);
    const bonusSavings = bonusIncome.times(scenario.savingsRate).div(100);
    const contribution = regularSavings.plus(bonusSavings);
    if (settings.depositTiming === "startOfMonth") nu = nu.plus(contribution);

    const yearRate = indexes.rates.get(year)!;
    const grossYield = settings.yieldsEnabled
      ? nu.times(monthlyRateDecimal(yearRate))
      : D(0);
    const withholding = settings.taxes.withholdingEnabled
      ? grossYield.times(settings.taxes.withholdingRate).div(100)
      : D(0);
    const netYield = grossYield.minus(withholding);
    nu = nu.plus(netYield);
    const externalYield = external.times(
      monthlyRateDecimal(settings.concentration.externalAnnualYieldRate),
    );
    external = external.plus(externalYield);
    if (settings.depositTiming === "endOfMonth") nu = nu.plus(contribution);

    const projectedNu = nu.plus(regularSavings);
    const crossesThreshold =
      settings.concentration.enabled &&
      (nu.greaterThanOrEqualTo(settings.concentration.alertThreshold) ||
        projectedNu.greaterThanOrEqualTo(settings.concentration.alertThreshold));
    const suppressedUntilLater = settings.transfers.some(
      (item) =>
        item.scenarioId === scenario.id &&
        ((item.date === date && item.status === "dismissed") ||
          (item.status === "postponed" &&
            item.postponedTo !== undefined &&
            date < item.postponedTo)),
    );
    const suggestion =
      crossesThreshold && !suppressedUntilLater
        ? D(suggestedTransfer(nu.toNumber(), settings.concentration))
        : D(0);

    results.push({
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      date,
      openingNuBalance: n(openingNu),
      openingExternalBalance: n(openingExternal),
      openingTotalBalance: n(openingTotal),
      monthlyIncome: n(income),
      bonusIncome: n(bonusIncome),
      regularSavings: n(regularSavings),
      bonusSavings: n(bonusSavings),
      totalContribution: n(contribution),
      grossYield: n(grossYield),
      externalYield: n(externalYield),
      withholding: n(withholding),
      netYield: n(netYield),
      tuitionLabel: tuitionLabels.join(", "),
      tuitionAmount: n(tuitionAmount),
      tuitionPaidAmount: n(tuitionPaidAmount),
      tuitionPaidFromNu: n(fromNu),
      tuitionPaidFromExternal: n(fromExternal),
      tuitionGmfAmount: n(tuitionGmf),
      totalWithdrawal: n(totalWithdrawal),
      suggestedExternalTransfer: n(suggestion),
      confirmedExternalTransfer: n(confirmedExternalTransfer),
      externalTransferGmf: n(externalTransferGmf),
      closingNuBalance: n(nu),
      closingExternalBalance: n(external),
      closingTotalBalance: n(nu.plus(external)),
      tuitionPaid,
      tuitionPaymentStatus,
      tuitionOriginalMonths,
      tuitionAttemptCount: tuitionAttempts.reduce(
        (maximum, attempt) => Math.max(maximum, attempt.attemptNumber),
        0,
      ),
      tuitionAttempts,
      pendingTuitionCount: pendingTuition.length,
      failure,
      missing: n(missing),
      appliedTransfers,
      transferIssues,
    });
  }
  return results;
}

const summarize = (
  scenario: SavingsScenario,
  monthly: MonthlyResult[],
): ScenarioSummary => {
  const last = monthly.at(-1)!;
  const minimum = monthly.reduce(
    (result, row) => (row.closingTotalBalance < result.closingTotalBalance ? row : result),
    monthly[0],
  );
  return {
    scenario,
    finalNu: last?.closingNuBalance ?? scenario.initialNuBalance,
    finalExternal: last?.closingExternalBalance ?? scenario.initialExternalBalance,
    finalTotal: last?.closingTotalBalance ?? scenario.initialNuBalance + scenario.initialExternalBalance,
    totalContributions: monthly.reduce((sum, row) => sum + row.totalContribution, 0),
    grossYield: monthly.reduce((sum, row) => sum + row.grossYield, 0),
    externalYield: monthly.reduce((sum, row) => sum + row.externalYield, 0),
    withholding: monthly.reduce((sum, row) => sum + row.withholding, 0),
    tuitionPaid: monthly.reduce((sum, row) => sum + row.tuitionPaidAmount, 0),
    tuitionGmf: monthly.reduce((sum, row) => sum + row.tuitionGmfAmount, 0),
    semestersPaid: monthly.reduce(
      (sum, row) =>
        sum + row.tuitionAttempts.filter((attempt) => attempt.status === "paid").length,
      0,
    ),
    firstFailure: monthly.find((row) => row.failure),
    minimumBalance: minimum?.closingTotalBalance ?? 0,
    minimumDate: minimum?.date ?? settingsFallbackDate(monthly),
    pendingTransfer: monthly.find((row) => row.suggestedExternalTransfer > 0),
  };
};

const settingsFallbackDate = (monthly: MonthlyResult[]) => monthly[0]?.date ?? "";

export const simulate = (settings: Settings): SimulationResult => {
  const blockingIssues = validateSettings(settings);
  if (blockingIssues.length) {
    return { monthly: [], summaries: [], blockingIssues };
  }
  const indexes = createIndexes(settings);
  const enabledScenarios = settings.scenarios.filter((scenario) => scenario.enabled);
  const grouped = enabledScenarios.map((scenario) => {
    const monthly = simulateScenario(settings, scenario, indexes);
    return { monthly, summary: summarize(scenario, monthly) };
  });
  return {
    monthly: grouped.flatMap((group) => group.monthly),
    summaries: grouped.map((group) => group.summary),
  };
};

export const minimumSavingsRate = (settings: Settings, scenario: SavingsScenario) => {
  if (validateSettings(settings).length) return null;
  let low = 0;
  let high = 100;
  const testSettings = { ...settings, scenarios: [{ ...scenario }] };
  if (!simulate({ ...testSettings, scenarios: [{ ...scenario, savingsRate: 0 }] }).summaries[0]?.firstFailure) {
    return 0;
  }
  if (simulate({ ...testSettings, scenarios: [{ ...scenario, savingsRate: 100 }] }).summaries[0]?.firstFailure) {
    return null;
  }
  for (let i = 0; i < 18; i += 1) {
    const mid = (low + high) / 2;
    testSettings.scenarios = [{ ...scenario, savingsRate: mid }];
    if (simulate(testSettings).summaries[0]?.firstFailure) low = mid;
    else high = mid;
  }
  return high;
};
