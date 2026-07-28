import { createDefaultActualTracking } from "../data/defaultActualTracking";
import { cloneDefaults } from "../data/defaultConfiguration";
import {
  calculateActualDraftPreview,
  validateActualTrackingState,
} from "../domain/actualTracking";
import { validateSettings } from "../domain/simulation";
import type {
  ActualMonthlyRecord,
  ActualTrackingState,
  Settings,
  StorageRecovery,
  StoredApplicationData,
} from "../domain/types";

export const STORAGE_KEY_V1 = "ahorro-u-settings-v1";
export const STORAGE_KEY = "ahorro-u-data-v2";
export const STORAGE_RECOVERY_KEY = "ahorro-u-data-v2-recovery";
export const STORAGE_VERSION = 2;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const objectAt = (value: unknown, path: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} debe ser un objeto.`);
  }
  return value as Record<string, unknown>;
};
const arrayAt = (value: unknown, path: string) => {
  if (!Array.isArray(value)) throw new Error(`${path} debe ser un arreglo.`);
  return value;
};
const stringAt = (value: unknown, path: string) => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${path} debe ser un texto no vacío.`);
  }
  return value;
};
const numberAt = (value: unknown, path: string) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} no es un número finito válido.`);
  }
  return value;
};
const booleanAt = (value: unknown, path: string) => {
  if (typeof value !== "boolean") throw new Error(`${path} debe ser booleano.`);
  return value;
};
const monthAt = (value: unknown, path: string) => {
  const month = stringAt(value, path);
  if (!MONTH.test(month)) throw new Error(`${path} debe tener formato YYYY-MM válido.`);
  return month;
};
const enumAt = <T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
) => {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new Error(`${path} debe ser uno de: ${allowed.join(", ")}.`);
  }
  return value as T;
};
const unique = (values: string[], path: string) => {
  if (new Set(values).size !== values.length) {
    throw new Error(`${path} contiene valores duplicados.`);
  }
};

const validatePlanStructure = (value: unknown): Settings => {
  const plan = objectAt(value, "planConfiguration");
  monthAt(plan.startDate, "planConfiguration.startDate");
  monthAt(plan.endDate, "planConfiguration.endDate");
  enumAt(plan.depositTiming, "planConfiguration.depositTiming", ["startOfMonth", "endOfMonth"]);
  enumAt(plan.failureMode, "planConfiguration.failureMode", ["stopFuturePayments", "retryLater"]);
  booleanAt(plan.yieldsEnabled, "planConfiguration.yieldsEnabled");

  const incomes = arrayAt(plan.incomes, "planConfiguration.incomes");
  const incomeYears = incomes.map((entry, index) => {
    const item = objectAt(entry, `planConfiguration.incomes[${index}]`);
    const year = numberAt(item.year, `planConfiguration.incomes[${index}].year`);
    if (!Number.isInteger(year)) throw new Error(`planConfiguration.incomes[${index}].year debe ser entero.`);
    if (numberAt(item.monthlyIncome, `planConfiguration.incomes[${index}].monthlyIncome`) < 0) {
      throw new Error(`planConfiguration.incomes[${index}].monthlyIncome no puede ser negativo.`);
    }
    if (typeof item.note !== "string") throw new Error(`planConfiguration.incomes[${index}].note debe ser texto.`);
    if (item.projectedMonthlyIncome !== undefined) numberAt(item.projectedMonthlyIncome, `planConfiguration.incomes[${index}].projectedMonthlyIncome`);
    if (item.source !== undefined) enumAt(item.source, `planConfiguration.incomes[${index}].source`, ["projection", "manual", "import"]);
    return String(year);
  });
  unique(incomeYears, "planConfiguration.incomes.year");

  const rates = arrayAt(plan.yieldRates, "planConfiguration.yieldRates");
  const rateYears = rates.map((entry, index) => {
    const item = objectAt(entry, `planConfiguration.yieldRates[${index}]`);
    const year = numberAt(item.year, `planConfiguration.yieldRates[${index}].year`);
    if (!Number.isInteger(year)) throw new Error(`planConfiguration.yieldRates[${index}].year debe ser entero.`);
    const rate = numberAt(item.effectiveAnnualRate, `planConfiguration.yieldRates[${index}].effectiveAnnualRate`);
    if (rate < -100) throw new Error(`planConfiguration.yieldRates[${index}].effectiveAnnualRate no puede ser inferior a -100.`);
    if (item.projectedEffectiveAnnualRate !== undefined) numberAt(item.projectedEffectiveAnnualRate, `planConfiguration.yieldRates[${index}].projectedEffectiveAnnualRate`);
    if (item.source !== undefined) enumAt(item.source, `planConfiguration.yieldRates[${index}].source`, ["projection", "manual", "import"]);
    return String(year);
  });
  unique(rateYears, "planConfiguration.yieldRates.year");

  const bonus = objectAt(plan.bonus, "planConfiguration.bonus");
  booleanAt(bonus.enabled, "planConfiguration.bonus.enabled");
  const bonusMonth = numberAt(bonus.month, "planConfiguration.bonus.month");
  if (!Number.isInteger(bonusMonth) || bonusMonth < 1 || bonusMonth > 12) throw new Error("planConfiguration.bonus.month debe estar entre 1 y 12.");
  enumAt(bonus.mode, "planConfiguration.bonus.mode", ["incomePercentage", "fixed"]);
  const bonusPercentage = numberAt(bonus.percentage, "planConfiguration.bonus.percentage");
  if (bonusPercentage < 0 || bonusPercentage > 100) throw new Error("planConfiguration.bonus.percentage debe estar entre 0 y 100.");
  if (numberAt(bonus.fixedAmount, "planConfiguration.bonus.fixedAmount") < 0) throw new Error("planConfiguration.bonus.fixedAmount no puede ser negativo.");

  const taxes = objectAt(plan.taxes, "planConfiguration.taxes");
  booleanAt(taxes.withholdingEnabled, "planConfiguration.taxes.withholdingEnabled");
  booleanAt(taxes.gmfEnabled, "planConfiguration.taxes.gmfEnabled");
  booleanAt(taxes.gmfExempt, "planConfiguration.taxes.gmfExempt");
  for (const field of ["withholdingRate", "gmfRate"] as const) {
    const rate = numberAt(taxes[field], `planConfiguration.taxes.${field}`);
    if (rate < 0 || rate > 100) throw new Error(`planConfiguration.taxes.${field} debe estar entre 0 y 100.`);
  }

  const concentration = objectAt(plan.concentration, "planConfiguration.concentration");
  booleanAt(concentration.enabled, "planConfiguration.concentration.enabled");
  booleanAt(concentration.requireConfirmation, "planConfiguration.concentration.requireConfirmation");
  booleanAt(concentration.applyGmfToExternalTransfer, "planConfiguration.concentration.applyGmfToExternalTransfer");
  for (const field of ["referenceLimit", "alertThreshold", "fixedTransferAmount", "targetNuBalance", "safetyMargin"] as const) {
    if (numberAt(concentration[field], `planConfiguration.concentration.${field}`) < 0) {
      throw new Error(`planConfiguration.concentration.${field} no puede ser negativo.`);
    }
  }
  const externalRate = numberAt(concentration.externalAnnualYieldRate, "planConfiguration.concentration.externalAnnualYieldRate");
  if (externalRate < -100) throw new Error("planConfiguration.concentration.externalAnnualYieldRate no puede ser inferior a -100.");
  stringAt(concentration.externalAccountName, "planConfiguration.concentration.externalAccountName");
  enumAt(concentration.suggestionMode, "planConfiguration.concentration.suggestionMode", ["fixedAmount", "reduceToTarget", "keepSafetyMargin"]);
  enumAt(concentration.tuitionFundingOrder, "planConfiguration.concentration.tuitionFundingOrder", ["externalFirst", "nuFirst"]);

  const scenarios = arrayAt(plan.scenarios, "planConfiguration.scenarios");
  const scenarioIds = scenarios.map((entry, index) => {
    const item = objectAt(entry, `planConfiguration.scenarios[${index}]`);
    const id = stringAt(item.id, `planConfiguration.scenarios[${index}].id`);
    stringAt(item.name, `planConfiguration.scenarios[${index}].name`);
    stringAt(item.color, `planConfiguration.scenarios[${index}].color`);
    booleanAt(item.enabled, `planConfiguration.scenarios[${index}].enabled`);
    const savings = numberAt(item.savingsRate, `planConfiguration.scenarios[${index}].savingsRate`);
    if (savings < 0 || savings > 100) throw new Error(`planConfiguration.scenarios[${index}].savingsRate debe estar entre 0 y 100.`);
    for (const field of ["initialNuBalance", "initialExternalBalance"] as const) {
      if (numberAt(item[field], `planConfiguration.scenarios[${index}].${field}`) < 0) throw new Error(`planConfiguration.scenarios[${index}].${field} no puede ser negativo.`);
    }
    return id;
  });
  unique(scenarioIds, "planConfiguration.scenarios.id");

  const tuition = arrayAt(plan.tuitionEvents, "planConfiguration.tuitionEvents");
  unique(tuition.map((entry, index) => {
    const item = objectAt(entry, `planConfiguration.tuitionEvents[${index}]`);
    const id = stringAt(item.id, `planConfiguration.tuitionEvents[${index}].id`);
    monthAt(item.date, `planConfiguration.tuitionEvents[${index}].date`);
    stringAt(item.label, `planConfiguration.tuitionEvents[${index}].label`);
    numberAt(item.amount, `planConfiguration.tuitionEvents[${index}].amount`);
    booleanAt(item.enabled, `planConfiguration.tuitionEvents[${index}].enabled`);
    if (typeof item.note !== "string") throw new Error(`planConfiguration.tuitionEvents[${index}].note debe ser texto.`);
    return id;
  }), "planConfiguration.tuitionEvents.id");

  const transfers = arrayAt(plan.transfers, "planConfiguration.transfers");
  unique(transfers.map((entry, index) => {
    const item = objectAt(entry, `planConfiguration.transfers[${index}]`);
    const id = stringAt(item.id, `planConfiguration.transfers[${index}].id`);
    stringAt(item.scenarioId, `planConfiguration.transfers[${index}].scenarioId`);
    monthAt(item.date, `planConfiguration.transfers[${index}].date`);
    if (numberAt(item.amount, `planConfiguration.transfers[${index}].amount`) < 0) throw new Error(`planConfiguration.transfers[${index}].amount no puede ser negativo.`);
    enumAt(item.status, `planConfiguration.transfers[${index}].status`, ["pending", "confirmed", "postponed", "dismissed"]);
    if (typeof item.note !== "string") throw new Error(`planConfiguration.transfers[${index}].note debe ser texto.`);
    stringAt(item.createdAt, `planConfiguration.transfers[${index}].createdAt`);
    if (item.postponedTo !== undefined) monthAt(item.postponedTo, `planConfiguration.transfers[${index}].postponedTo`);
    return id;
  }), "planConfiguration.transfers.id");

  if (plan.annualValueRevisions !== undefined) {
    const revisions = arrayAt(
      plan.annualValueRevisions,
      "planConfiguration.annualValueRevisions",
    );
    unique(revisions.map((entry, index) => {
      const item = objectAt(entry, `planConfiguration.annualValueRevisions[${index}]`);
      const id = stringAt(item.id, `planConfiguration.annualValueRevisions[${index}].id`);
      stringAt(item.field, `planConfiguration.annualValueRevisions[${index}].field`);
      const year = numberAt(item.year, `planConfiguration.annualValueRevisions[${index}].year`);
      if (!Number.isInteger(year)) throw new Error(`planConfiguration.annualValueRevisions[${index}].year debe ser entero.`);
      numberAt(item.previousValue, `planConfiguration.annualValueRevisions[${index}].previousValue`);
      numberAt(item.newValue, `planConfiguration.annualValueRevisions[${index}].newValue`);
      enumAt(item.source, `planConfiguration.annualValueRevisions[${index}].source`, ["projection", "manual", "import"]);
      stringAt(item.changedAt, `planConfiguration.annualValueRevisions[${index}].changedAt`);
      if (item.reason !== undefined && typeof item.reason !== "string") throw new Error(`planConfiguration.annualValueRevisions[${index}].reason debe ser texto.`);
      return id;
    }), "planConfiguration.annualValueRevisions.id");
  }

  const validated = {
    ...plan,
    incomes: (plan.incomes as Settings["incomes"]).map((item) => ({
      ...item,
      id: item.id ?? `income-${item.year}`,
      projectedMonthlyIncome:
        item.projectedMonthlyIncome ?? item.monthlyIncome,
      source: item.source ?? "import",
    })),
    yieldRates: (plan.yieldRates as Settings["yieldRates"]).map((item) => ({
      ...item,
      id: item.id ?? `rate-${item.year}`,
      projectedEffectiveAnnualRate:
        item.projectedEffectiveAnnualRate ?? item.effectiveAnnualRate,
      source: item.source ?? "import",
    })),
    annualValueRevisions:
      (plan.annualValueRevisions as Settings["annualValueRevisions"]) ?? [],
  } as unknown as Settings;
  const issues = validateSettings(validated);
  if (issues.length) throw new Error(`planConfiguration: ${issues.map((issue) => issue.message).join(" ")}`);
  return validated;
};

const actualNumericFields = [
    "actualIncome",
    "actualBonus",
    "actualRegularContribution",
    "actualBonusContribution",
    "actualNuGrossYield",
    "actualWithholding",
    "actualExternalYield",
    "actualTuitionPayment",
    "actualTuitionGmf",
    "tuitionFromNu",
    "tuitionFromExternal",
    "actualTransferToExternal",
    "actualTransferGmf",
    "otherWithdrawalFromNu",
    "otherWithdrawalFromExternal",
    "actualAdjustmentNu",
    "actualAdjustmentExternal",
  ] as const;

const validateActualRecordStructure = (
  value: unknown,
  path: string,
): ActualMonthlyRecord => {
  const record = objectAt(value, path);
  stringAt(record.id, `${path}.id`);
  monthAt(record.month, `${path}.month`);
  enumAt(record.status, `${path}.status`, ["draft", "confirmed"]);
  enumAt(record.tuitionFundingSource, `${path}.tuitionFundingSource`, ["nu", "external", "split"]);
  enumAt(record.reconciliationStatus, `${path}.reconciliationStatus`, ["not_required", "pending", "reconciled"]);
  actualNumericFields.forEach((field) => {
    const value = numberAt(record[field], `${path}.${field}`);
    if (!field.startsWith("actualAdjustment") && value < 0) {
      throw new Error(`${path}.${field} no puede ser negativo.`);
    }
  });
  for (const field of ["reportedNuBalance", "reportedExternalBalance"] as const) {
    if (record[field] !== undefined && numberAt(record[field], `${path}.${field}`) < 0) {
      throw new Error(`${path}.${field} no puede ser negativo.`);
    }
  }
  if (
    record.actualNuCumulativeYield !== undefined &&
    numberAt(
      record.actualNuCumulativeYield,
      `${path}.actualNuCumulativeYield`,
    ) < 0
  ) {
    throw new Error(`${path}.actualNuCumulativeYield no puede ser negativo.`);
  }
  if (typeof record.note !== "string") throw new Error(`${path}.note debe ser texto.`);
  stringAt(record.createdAt, `${path}.createdAt`);
  stringAt(record.updatedAt, `${path}.updatedAt`);
  return record as unknown as ActualMonthlyRecord;
};

const validateTrackingStructure = (
  value: unknown,
  settings: Settings,
): ActualTrackingState => {
  const tracking = objectAt(value, "actualTracking");
  monthAt(tracking.startMonth, "actualTracking.startMonth");
  if (numberAt(tracking.initialNuBalance, "actualTracking.initialNuBalance") < 0) throw new Error("actualTracking.initialNuBalance no puede ser negativo.");
  if (numberAt(tracking.initialExternalBalance, "actualTracking.initialExternalBalance") < 0) throw new Error("actualTracking.initialExternalBalance no puede ser negativo.");
  stringAt(tracking.deviceId, "actualTracking.deviceId");
  const records = arrayAt(tracking.records, "actualTracking.records").map((record, index) =>
    validateActualRecordStructure(record, `actualTracking.records[${index}]`),
  );
  unique(records.map((record) => record.id), "actualTracking.records.id");
  unique(records.map((record) => record.month), "actualTracking.records.month");
  const revisions = arrayAt(tracking.revisions, "actualTracking.revisions");
  unique(revisions.map((revision, index) => {
    const item = objectAt(revision, `actualTracking.revisions[${index}]`);
    const id = stringAt(item.id, `actualTracking.revisions[${index}].id`);
    stringAt(item.recordId, `actualTracking.revisions[${index}].recordId`);
    monthAt(item.month, `actualTracking.revisions[${index}].month`);
    stringAt(item.changedAt, `actualTracking.revisions[${index}].changedAt`);
    stringAt(item.reason, `actualTracking.revisions[${index}].reason`);
    validateActualRecordStructure(item.previousValues, `actualTracking.revisions[${index}].previousValues`);
    return id;
  }), "actualTracking.revisions.id");
  const validated = { ...tracking, records } as unknown as ActualTrackingState;
  records.forEach((record, index) => {
    const preview = calculateActualDraftPreview(validated, record, settings);
    if (preview.errors.length) {
      throw new Error(`actualTracking.records[${index}]: ${preview.errors.join(" ")}`);
    }
    if (
      record.reconciliationStatus === "reconciled" &&
      ((preview.nuDifference !== null && preview.nuDifference !== 0) ||
        (preview.externalDifference !== null &&
          preview.externalDifference !== 0))
    ) {
      throw new Error(
        `actualTracking.records[${index}].reconciliationStatus no puede ser reconciled mientras exista una diferencia.`,
      );
    }
  });
  const stateErrors = validateActualTrackingState(validated, settings);
  if (stateErrors.length) throw new Error(`actualTracking: ${stateErrors.join(" ")}`);
  return validated;
};

export const createDefaultApplicationData = (): StoredApplicationData => ({
  version: STORAGE_VERSION,
  planConfiguration: cloneDefaults(),
  actualTracking: createDefaultActualTracking(),
});

export const parseApplicationData = (raw: string): StoredApplicationData => {
  const parsed = JSON.parse(raw) as Partial<StoredApplicationData>;
  if (parsed.version !== STORAGE_VERSION) {
    throw new Error(`version debe ser ${STORAGE_VERSION}; se recibió ${String(parsed.version)}.`);
  }
  const planConfiguration = validatePlanStructure(parsed.planConfiguration);
  const actualTracking = validateTrackingStructure(parsed.actualTracking, planConfiguration);
  return { ...parsed, version: STORAGE_VERSION, planConfiguration, actualTracking } as StoredApplicationData;
};

export const serializeApplicationData = (data: StoredApplicationData) =>
  JSON.stringify(data, null, 2);

export const loadApplicationData = (
  storage: StorageLike,
): StoredApplicationData => loadApplicationDataWithStatus(storage).data;

export const loadApplicationDataWithStatus = (
  storage: StorageLike,
): { data: StoredApplicationData; recovery: StorageRecovery } => {
  const current = storage.getItem(STORAGE_KEY);
  if (current) {
    try {
      return { data: parseApplicationData(current), recovery: { source: "v2" } };
    } catch {
      // Conserva una copia separada antes de cualquier migración o guardado posterior.
      try {
        if (!storage.getItem(STORAGE_RECOVERY_KEY)) {
          storage.setItem(STORAGE_RECOVERY_KEY, current);
        }
      } catch {
        // Si no hay espacio, la clave v2 original permanece intacta en este punto.
      }
    }
  }
  const legacy = storage.getItem(STORAGE_KEY_V1);
  if (legacy) {
    try {
      const plan = validatePlanStructure(JSON.parse(legacy));
      if (plan) {
        const migrated = {
          version: STORAGE_VERSION,
          planConfiguration: plan,
          actualTracking: createDefaultActualTracking(),
        };
        let migrationPersisted = true;
        try {
          storage.setItem(STORAGE_KEY, serializeApplicationData(migrated));
        } catch {
          migrationPersisted = false;
        }
        return {
          data: migrated,
          recovery: {
            source: "v1",
            message: !migrationPersisted
              ? "Se recuperó el respaldo v1, pero no fue posible escribir la copia v2. El original se conservó."
              : current
                ? "Los datos v2 son inválidos. Se recuperó y migró el respaldo v1."
                : "El respaldo v1 fue migrado correctamente a v2.",
            corruptV2: current ?? undefined,
          },
        };
      }
    } catch {
      // Se usan valores iniciales sin borrar el archivo previo.
    }
  }
  return {
    data: createDefaultApplicationData(),
    recovery: {
      source: "defaults",
      message: current
        ? "Los datos v2 son inválidos y no existe un respaldo v1 válido. Se cargaron valores predeterminados sin borrar el contenido corrupto."
        : undefined,
      corruptV2: current ?? undefined,
    },
  };
};

export const saveApplicationData = (
  storage: StorageLike,
  data: StoredApplicationData,
) => storage.setItem(STORAGE_KEY, serializeApplicationData(data));
