import { describe, expect, it } from "vitest";
import {
  createDefaultActualTracking,
  createEmptyActualRecord,
} from "../data/defaultActualTracking";
import { cloneDefaults } from "../data/defaultConfiguration";
import {
  analyzeConfirmedActualTimeline,
  buildPlanActualComparison,
  buildUpdatedProjectionDetails,
  calculateContributionCompliance,
  calculateActualDraftPreview,
  calculateActualTracking,
  metricVariation,
  summarizeActual,
  validateActualRecord,
} from "./actualTracking";
import {
  minimumSavingsRate,
  simulate,
  validateSettings,
} from "./simulation";
import type {
  ActualMonthlyRecord,
  ActualTrackingState,
  Settings,
  StoredApplicationData,
} from "./types";
import {
  loadApplicationDataWithStatus,
  parseApplicationData,
  serializeApplicationData,
  STORAGE_KEY,
  STORAGE_KEY_V1,
  STORAGE_RECOVERY_KEY,
} from "../utils/storage";
import {
  actualTrackingCsvRows,
  neutralizeCsvFormula,
  toCsv,
} from "../utils/csv";

const actual = (
  month: string,
  patch: Partial<ActualMonthlyRecord> = {},
): ActualMonthlyRecord => ({
  ...createEmptyActualRecord(month),
  ...patch,
  id: patch.id ?? `actual-${month}`,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const state = (
  records: ActualMonthlyRecord[] = [],
  initialNuBalance = 0,
  initialExternalBalance = 0,
): ActualTrackingState => ({
  ...createDefaultActualTracking(),
  records,
  initialNuBalance,
  initialExternalBalance,
  deviceId: "audit-regression",
});

const plan = (endDate = "2026-10"): Settings => {
  const settings = cloneDefaults();
  settings.startDate = "2026-09";
  settings.endDate = endDate;
  settings.tuitionEvents = [];
  settings.bonus.enabled = false;
  settings.yieldsEnabled = false;
  settings.taxes.gmfEnabled = false;
  settings.scenarios[0].savingsRate = 0;
  return settings;
};

describe("regresiones F-01: borradores y cadena definitiva", () => {
  it("un borrador aislado no cambia patrimonio ni acumulados", () => {
    const tracking = state([
      actual("2026-09", {
        status: "draft",
        actualRegularContribution: 1_000_000,
      }),
    ]);
    expect(calculateActualTracking(tracking)).toEqual([]);
    expect(summarizeActual(tracking).finalTotalBalance).toBe(0);
    expect(summarizeActual(tracking).totalContributions).toBe(0);
  });

  it("un borrador anterior no cambia un confirmado posterior", () => {
    const timeline = calculateActualTracking(state([
      actual("2026-09", {
        status: "draft",
        actualRegularContribution: 1_000_000,
      }),
      actual("2026-10", {
        status: "confirmed",
        actualRegularContribution: 500_000,
      }),
    ]));
    expect(timeline).toHaveLength(1);
    expect(timeline[0].calculatedNuBalance).toBe(500_000);
  });

  it("un borrador futuro no aparece como dato real", () => {
    const details = buildUpdatedProjectionDetails(plan(), state([
      actual("2026-09", { status: "confirmed", actualRegularContribution: 100 }),
      actual("2026-10", { status: "draft", actualRegularContribution: 900 }),
    ]));
    expect(details.series[1].actual).toBeNull();
  });

  it("un borrador sí produce previsualización local sin persistir", () => {
    const tracking = state([]);
    const draft = actual("2026-09", {
      status: "draft",
      actualRegularContribution: 1_000_000,
    });
    expect(calculateActualDraftPreview(tracking, draft).totalBalance).toBe(1_000_000);
    expect(calculateActualTracking(tracking)).toEqual([]);
  });

  it("confirmar incorpora una vez y volver a borrador elimina el movimiento", () => {
    const confirmed = actual("2026-09", {
      status: "confirmed",
      actualRegularContribution: 1_000_000,
    });
    expect(summarizeActual(state([confirmed])).finalTotalBalance).toBe(1_000_000);
    expect(summarizeActual(state([{ ...confirmed, status: "draft" }])).finalTotalBalance).toBe(0);
  });
});

describe("regresiones F-02/F-06/F-07: cierres elegibles", () => {
  it("sin confirmados o con solo borradores usa el plan sin inventar realidad", () => {
    for (const tracking of [
      state([]),
      state([actual("2026-09", { status: "draft", actualRegularContribution: 1 })]),
    ]) {
      const details = buildUpdatedProjectionDetails(plan(), tracking);
      expect(details.closingMonth).toBeUndefined();
      expect(details.series.every((point) => point.actual === null)).toBe(true);
      expect(details.series.every((point) => point.updated === point.ideal)).toBe(true);
    }
  });

  it("confirmado válido inicia exactamente en el mes siguiente", () => {
    const details = buildUpdatedProjectionDetails(plan(), state([
      actual("2026-09", {
        status: "confirmed",
        actualRegularContribution: 2_000_000,
      }),
    ]));
    expect(details.closingMonth).toBe("2026-09");
    expect(details.series[0].updated).toBe(2_000_000);
    expect(details.series[1].actual).toBeNull();
    expect(details.series[1].updated).not.toBeNull();
  });

  it("diferencia pendiente o conciliada vigente no es cierre elegible", () => {
    for (const reconciliationStatus of ["pending", "reconciled"] as const) {
      const details = buildUpdatedProjectionDetails(plan(), state([
        actual("2026-09", {
          status: "confirmed",
          actualRegularContribution: 1_000_000,
          reportedNuBalance: 900_000,
          reconciliationStatus,
        }),
      ]));
      expect(details.closingMonth).toBeUndefined();
      expect(details.blockers[0].month).toBe("2026-09");
    }
  });

  it("conciliado sin diferencia sí es elegible y diferencia vigente manda en el estado", () => {
    const tracking = state([
      actual("2026-09", {
        status: "confirmed",
        actualRegularContribution: 1_000_000,
        reportedNuBalance: 1_000_000,
        reconciliationStatus: "reconciled",
      }),
    ]);
    expect(buildUpdatedProjectionDetails(plan(), tracking).closingMonth).toBe("2026-09");
    const withDifference = calculateActualTracking(
      state([actual("2026-09", {
        status: "confirmed",
        actualRegularContribution: 1_000_000,
        reportedNuBalance: 900_000,
        reconciliationStatus: "reconciled",
      })]),
    )[0];
    expect(withDifference.displayStatus).toBe("Con diferencia");
    expect(withDifference.nuDifference).toBe(-100_000);
  });

  it("un mes duplicado no se aplica y bloquea la proyección", () => {
    const tracking = state([
      actual("2026-09", { id: "a", status: "confirmed", actualRegularContribution: 100 }),
      actual("2026-09", { id: "b", status: "confirmed", actualRegularContribution: 200 }),
    ]);
    expect(calculateActualTracking(tracking)).toEqual([]);
    expect(analyzeConfirmedActualTimeline(tracking).excluded).toHaveLength(2);
    const details = buildUpdatedProjectionDetails(plan(), tracking);
    expect(details.closingMonth).toBeUndefined();
    expect(details.blockers.some((blocker) => blocker.reason.includes("duplicado"))).toBe(true);
  });

  it.each([
    [
      "dos borradores",
      [
        actual("2026-09", { id: "a", status: "draft" }),
        actual("2026-09", { id: "b", status: "draft" }),
      ],
    ],
    [
      "borrador y confirmado",
      [
        actual("2026-09", { id: "a", status: "draft" }),
        actual("2026-09", { id: "b", status: "confirmed" }),
      ],
    ],
  ])("bloquea el conflicto de %s sin sumar registros", (_name, records) => {
    const tracking = state(records);
    expect(calculateActualTracking(tracking)).toEqual([]);
    expect(
      buildUpdatedProjectionDetails(plan(), tracking).blockers.some((blocker) =>
        blocker.reason.includes("duplicado"),
      ),
    ).toBe(true);
  });

  it("rechaza un confirmado fuera del rango y recalcula tras una edición retroactiva", () => {
    const outOfRange = buildUpdatedProjectionDetails(
      plan(),
      state([
        actual("2027-01", {
          status: "confirmed",
          actualRegularContribution: 100,
        }),
      ]),
    );
    expect(outOfRange.closingMonth).toBeUndefined();
    expect(outOfRange.blockers[0].reason).toContain("fuera del rango");

    const before = calculateActualTracking(
      state([
        actual("2026-09", {
          status: "confirmed",
          actualRegularContribution: 100,
        }),
        actual("2026-10", {
          status: "confirmed",
          actualRegularContribution: 200,
        }),
      ]),
    );
    const after = calculateActualTracking(
      state([
        actual("2026-09", {
          status: "confirmed",
          actualRegularContribution: 300,
        }),
        actual("2026-10", {
          status: "confirmed",
          actualRegularContribution: 200,
        }),
      ]),
    );
    expect(before[1].totalBalance).toBe(300);
    expect(after[1].totalBalance).toBe(500);
  });

  it("retención superior al rendimiento es inválida", () => {
    const record = actual("2026-09", {
      actualNuGrossYield: 10_000,
      actualWithholding: 20_000,
    });
    expect(validateActualRecord(record, 1_000_000, 0).join(" ")).toContain(
      "no puede superar",
    );
  });
});

describe("regresiones F-03/F-05: matrículas y retryLater", () => {
  const retryPlan = (endDate = "2026-10") => {
    const settings = plan(endDate);
    settings.failureMode = "retryLater";
    settings.scenarios[0].savingsRate = 100;
    settings.tuitionEvents = [{
      id: "tuition-a",
      date: "2026-09",
      label: "Matrícula A",
      amount: 2_000_000,
      enabled: true,
      note: "",
    }];
    return settings;
  };

  it("falla en septiembre, queda pendiente y se paga una sola vez en octubre", () => {
    const rows = simulate(retryPlan()).monthly;
    expect(rows[0].tuitionPaymentStatus).toBe("pending_retry");
    expect(rows[0].tuitionPaidAmount).toBe(0);
    expect(rows[1].tuitionPaymentStatus).toBe("paid");
    expect(rows[1].tuitionPaidAmount).toBe(2_000_000);
    expect(rows[1].tuitionAttemptCount).toBe(2);
    expect(rows.reduce((sum, row) => sum + row.tuitionPaidAmount, 0)).toBe(2_000_000);
    expect(rows[1].tuitionOriginalMonths).toEqual(["2026-09"]);
  });

  it("reintenta varios meses y conserva pendiente al terminar si nunca alcanza", () => {
    const settings = retryPlan("2026-11");
    settings.scenarios[0].savingsRate = 0;
    const rows = simulate(settings).monthly;
    expect(rows.map((row) => row.tuitionPaymentStatus)).toEqual([
      "pending_retry",
      "pending_retry",
      "pending_retry",
    ]);
    expect(rows.at(-1)?.pendingTuitionCount).toBe(1);
  });

  it("procesa dos obligaciones por prioridad original sin duplicarlas", () => {
    const settings = retryPlan();
    settings.tuitionEvents.push({
      id: "tuition-b",
      date: "2026-09",
      label: "Matrícula B",
      amount: 500_000,
      enabled: true,
      note: "",
    });
    settings.scenarios[0].initialNuBalance = 2_000_000;
    const rows = simulate(settings).monthly;
    expect(rows[0].tuitionPaidAmount).toBe(2_000_000);
    expect(rows[0].pendingTuitionCount).toBe(1);
    expect(rows[1].tuitionPaidAmount).toBe(500_000);
    expect(rows.reduce((sum, row) => sum + row.tuitionPaidAmount, 0)).toBe(2_500_000);
  });

  it("paga primero la obligación pendiente y después una matrícula nueva", () => {
    const settings = retryPlan();
    settings.tuitionEvents.push({
      id: "tuition-new",
      date: "2026-10",
      label: "Matrícula nueva",
      amount: 500_000,
      enabled: true,
      note: "",
    });
    const rows = simulate(settings).monthly;
    expect(rows[1].tuitionAttempts.map((attempt) => attempt.eventId)).toEqual([
      "tuition-a",
      "tuition-new",
    ]);
    expect(rows[1].tuitionPaidAmount).toBe(2_500_000);
    expect(rows[1].pendingTuitionCount).toBe(0);
  });

  it("cobra GMF una sola vez al pagar efectivamente", () => {
    const settings = retryPlan();
    settings.taxes.gmfEnabled = true;
    const rows = simulate(settings).monthly;
    expect(rows[0].tuitionGmfAmount).toBe(0);
    expect(rows[1].tuitionGmfAmount).toBe(8_000);
  });

  it("stopFuturePayments nunca muestra eventos posteriores como pagados", () => {
    const settings = plan("2026-10");
    settings.failureMode = "stopFuturePayments";
    settings.tuitionEvents = [
      { id: "a", date: "2026-09", label: "A", amount: 2_000_000, enabled: true, note: "" },
      { id: "b", date: "2026-10", label: "B", amount: 1, enabled: true, note: "" },
    ];
    const rows = simulate(settings).monthly;
    expect(rows[0].tuitionPaymentStatus).toBe("failed");
    expect(rows[1].tuitionPaymentStatus).toBe("skipped_after_failure");
    expect(rows[1].tuitionPaid).toBe(false);
    expect(rows[1].tuitionPaidAmount).toBe(0);
  });
});

describe("regresiones F-09/F-10/F-11/F-21/F-24", () => {
  it("rechaza años duplicados y bloquea años faltantes sin saldos aparentes", () => {
    const duplicate = plan();
    duplicate.incomes.push({ ...duplicate.incomes[0], id: "duplicate" });
    expect(validateSettings(duplicate).some((issue) => issue.message.includes("duplicados"))).toBe(true);
    expect(simulate(duplicate).monthly).toEqual([]);

    const missing = plan();
    missing.incomes = [];
    expect(simulate(missing).monthly).toEqual([]);
    expect(simulate(missing).blockingIssues?.[0].message).toContain("Falta");
  });

  it("permite varias matrículas distintas en el mismo mes", () => {
    const settings = plan("2026-09");
    settings.scenarios[0].initialNuBalance = 3_000_000;
    settings.tuitionEvents = [
      { id: "a", date: "2026-09", label: "A", amount: 1_000_000, enabled: true, note: "" },
      { id: "b", date: "2026-09", label: "B", amount: 2_000_000, enabled: true, note: "" },
    ];
    expect(validateSettings(settings)).toEqual([]);
    expect(simulate(settings).monthly[0].tuitionPaidAmount).toBe(3_000_000);
  });

  it("procesa todos los traslados confirmados del mismo mes en orden", () => {
    const settings = plan("2026-09");
    settings.scenarios[0].initialNuBalance = 10_000_000;
    settings.transfers = [1, 2].map((id) => ({
      id: String(id),
      scenarioId: settings.scenarios[0].id,
      date: "2026-09",
      amount: 1_000_000,
      status: "confirmed" as const,
      note: "",
      createdAt: `2026-09-0${id}`,
    }));
    const row = simulate(settings).monthly[0];
    expect(row.confirmedExternalTransfer).toBe(2_000_000);
    expect(row.appliedTransfers.map((item) => item.nuBalanceBefore)).toEqual([
      10_000_000,
      9_000_000,
    ]);
  });

  it("mantiene visible un traslado confirmado que ya no es financiable", () => {
    const settings = plan("2026-09");
    settings.transfers = [{
      id: "too-large",
      scenarioId: settings.scenarios[0].id,
      date: "2026-09",
      amount: 1,
      status: "confirmed",
      note: "",
      createdAt: "2026-09-01",
    }];
    const row = simulate(settings).monthly[0];
    expect(row.appliedTransfers[0].status).toBe("invalid");
    expect(row.transferIssues[0]).toContain("no es financiable");
  });

  it("respeta la fecha de una propuesta pospuesta", () => {
    const settings = plan("2026-10");
    settings.concentration.enabled = true;
    settings.concentration.alertThreshold = 1;
    settings.concentration.referenceLimit = 2;
    settings.concentration.fixedTransferAmount = 1;
    settings.concentration.suggestionMode = "fixedAmount";
    settings.scenarios[0].initialNuBalance = 10;
    settings.transfers = [{
      id: "postponed",
      scenarioId: settings.scenarios[0].id,
      date: "2026-09",
      postponedTo: "2026-10",
      amount: 1,
      status: "postponed",
      note: "",
      createdAt: "2026-09-01",
    }];
    const rows = simulate(settings).monthly;
    expect(rows[0].suggestedExternalTransfer).toBe(0);
    expect(rows[1].suggestedExternalTransfer).toBe(1);
  });

  it("devuelve ahorro mínimo exactamente cero cuando basta", () => {
    const settings = plan("2026-09");
    settings.scenarios[0].initialNuBalance = 10_000_000;
    expect(minimumSavingsRate(settings, settings.scenarios[0])).toBe(0);
  });
});

describe("regresiones F-08/F-13/F-22: cumplimiento, variaciones y precisión", () => {
  it("incluye meses ideales omitidos y solo aportes confirmados en el cumplimiento", () => {
    const ideal = [
      { date: "2026-09", totalContribution: 100 },
      { date: "2026-10", totalContribution: 100 },
      { date: "2026-11", totalContribution: 100 },
    ] as any;
    const confirmed = calculateActualTracking(
      state([
        actual("2026-10", {
          status: "confirmed",
          actualRegularContribution: 100,
        }),
        actual("2026-11", {
          status: "draft",
          actualRegularContribution: 10_000,
        }),
      ]),
    );
    expect(calculateContributionCompliance(ideal, confirmed)).toBe(50);
    expect(
      calculateContributionCompliance(
        ideal.map((row: any) => ({ ...row, totalContribution: 0 })),
        confirmed,
      ),
    ).toBeNull();
  });

  it("calcula variación exacta y usa interpretación inversa para costos", () => {
    expect(metricVariation(100, 120, true)).toMatchObject({
      amount: 20,
      percentage: 0.2,
      label: "Costo superior al esperado",
    });
    expect(metricVariation(100, 80, true).label).toBe(
      "Costo inferior al esperado",
    );
    expect(metricVariation(0, 10).label).toBe("Nuevo movimiento");
  });

  it("expone variaciones completas para todas las métricas comparadas", () => {
    const settings = plan("2026-09");
    const ideal = simulate(settings).monthly;
    const real = calculateActualTracking(
      state([
        actual("2026-09", {
          status: "confirmed",
          actualIncome: 1,
          actualRegularContribution: 1,
        }),
      ]),
    );
    const metrics = buildPlanActualComparison(ideal, real)[0].metrics;
    expect(Object.keys(metrics)).toEqual([
      "income",
      "bonusContribution",
      "contribution",
      "yield",
      "withholding",
      "tuition",
      "gmf",
      "nuBalance",
      "externalBalance",
      "totalBalance",
    ]);
    expect(metrics.income.amount).toBe(1 - ideal[0].monthlyIncome);
  });
});

describe("regresiones de persistencia, importación y CSV", () => {
  const completeData = (): StoredApplicationData => ({
    version: 2,
    planConfiguration: cloneDefaults(),
    actualTracking: state([]),
  });

  it.each([
    ["plan sin fechas", (data: any) => delete data.planConfiguration.startDate, "planConfiguration.startDate"],
    ["plan sin tasas", (data: any) => delete data.planConfiguration.yieldRates, "planConfiguration.yieldRates"],
    ["plan sin impuestos", (data: any) => delete data.planConfiguration.taxes, "planConfiguration.taxes"],
    ["porcentaje inválido", (data: any) => data.planConfiguration.scenarios[0].savingsRate = 101, "savingsRate"],
    ["mes inválido", (data: any) => data.actualTracking.startMonth = "2026-13", "actualTracking.startMonth"],
    ["texto numérico", (data: any) => data.planConfiguration.incomes[0].monthlyIncome = "100", "monthlyIncome"],
    ["NaN", (data: any) => data.planConfiguration.incomes[0].monthlyIncome = Number.NaN, "monthlyIncome"],
    ["Infinity", (data: any) => data.planConfiguration.incomes[0].monthlyIncome = Number.POSITIVE_INFINITY, "monthlyIncome"],
    ["revisión incompleta", (data: any) => data.actualTracking.revisions = [{ id: "x" }], "recordId"],
  ])("rechaza %s indicando la ruta", (_name, mutate, path) => {
    const data: any = completeData();
    mutate(data);
    expect(() => parseApplicationData(JSON.stringify(data))).toThrow(path);
  });

  it("rechaza versión desconocida y registro confirmado con errores", () => {
    const unknown: any = completeData();
    unknown.version = 999;
    expect(() => parseApplicationData(JSON.stringify(unknown))).toThrow("version");

    const invalid = completeData();
    invalid.actualTracking.records = [actual("2026-09", {
      status: "confirmed",
      actualNuGrossYield: 10,
      actualWithholding: 20,
    })];
    expect(() => parseApplicationData(JSON.stringify(invalid))).toThrow(
      "actualTracking.records[0]",
    );
  });

  it("acepta campos adicionales y JSON completo válido", () => {
    const data: any = completeData();
    data.extra = { future: true };
    expect(parseApplicationData(serializeApplicationData(data))).toEqual(data);
  });

  it("conserva la fuente, valor proyectado e historial anual en JSON", () => {
    const data = completeData();
    const income = data.planConfiguration.incomes[0];
    income.projectedMonthlyIncome = income.monthlyIncome;
    income.monthlyIncome += 100_000;
    income.source = "manual";
    data.planConfiguration.annualValueRevisions = [{
      id: "annual-revision-1",
      field: "monthlyIncome",
      year: income.year,
      previousValue: income.projectedMonthlyIncome,
      newValue: income.monthlyIncome,
      source: "manual",
      reason: "Ajuste contractual",
      changedAt: "2026-07-26T15:00:00.000Z",
    }];
    const restored = parseApplicationData(serializeApplicationData(data));
    expect(restored.planConfiguration.incomes[0]).toMatchObject({
      projectedMonthlyIncome: income.projectedMonthlyIncome,
      monthlyIncome: income.monthlyIncome,
      source: "manual",
    });
    expect(restored.planConfiguration.annualValueRevisions).toEqual(
      data.planConfiguration.annualValueRevisions,
    );
  });

  it("migra v1 a v2 inmediatamente y conserva seguimiento en cero", () => {
    const memory = new Map<string, string>([
      [STORAGE_KEY_V1, JSON.stringify(cloneDefaults())],
    ]);
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    };
    const loaded = loadApplicationDataWithStatus(storage);
    expect(loaded.recovery.source).toBe("v1");
    expect(memory.has(STORAGE_KEY)).toBe(true);
    expect(loaded.data.actualTracking.records).toEqual([]);
  });

  it("conserva v2 corrupto y comunica recuperación", () => {
    const memory = new Map<string, string>([[STORAGE_KEY, "{corrupto"]]);
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    };
    const loaded = loadApplicationDataWithStatus(storage);
    expect(loaded.recovery.source).toBe("defaults");
    expect(loaded.recovery.corruptV2).toBe("{corrupto");
    expect(memory.get(STORAGE_KEY)).toBe("{corrupto");
    expect(memory.get(STORAGE_RECOVERY_KEY)).toBe("{corrupto");
  });

  it("neutraliza fórmulas y exporta BOM, CRLF y columnas seguras", () => {
    for (const prefix of ["=", "+", "-", "@"]) {
      expect(neutralizeCsvFormula(`${prefix}SUM(A1)`)).toBe(`'${prefix}SUM(A1)`);
    }
    const csv = toCsv([{ nota: "=2+2", valor: 1 }]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\"'=2+2\"");
    expect(csv).toContain("\r\n");
  });

  it("exporta todos los movimientos necesarios del seguimiento real", () => {
    const months = calculateActualTracking(state([
      actual("2026-09", {
        status: "confirmed",
        actualRegularContribution: 1_000,
        otherWithdrawalFromNu: 100,
        actualAdjustmentNu: 10,
        note: "=NO_EJECUTAR()",
      }),
    ], 1_000));
    const row = actualTrackingCsvRows(months)[0];
    expect(row).toMatchObject({
      aporte_regular: 1_000,
      otros_retiros_nu: 100,
      ajuste_nu: 10,
      estado_conciliacion: "not_required",
      creado: "2026-09-01T00:00:00.000Z",
    });
    expect(toCsv([row])).toContain("\"'=NO_EJECUTAR()\"");
  });
});

describe("presupuesto de rendimiento F-18", () => {
  it("calcula 20 escenarios por 360 meses y 500 registros reales sin bloquear", () => {
    const settings = cloneDefaults();
    settings.startDate = "2026-01";
    settings.endDate = "2055-12";
    settings.bonus.enabled = false;
    settings.yieldsEnabled = false;
    settings.taxes.gmfEnabled = false;
    settings.incomes = Array.from({ length: 30 }, (_, index) => ({
      id: `income-${2026 + index}`,
      year: 2026 + index,
      monthlyIncome: 1,
      note: "",
    }));
    settings.yieldRates = Array.from({ length: 30 }, (_, index) => ({
      id: `rate-${2026 + index}`,
      year: 2026 + index,
      effectiveAnnualRate: 0,
    }));
    settings.scenarios = Array.from({ length: 20 }, (_, index) => ({
      ...settings.scenarios[0],
      id: `scenario-${index}`,
      name: `Escenario ${index}`,
      initialNuBalance: 1_000_000,
    }));
    settings.tuitionEvents = Array.from({ length: 500 }, (_, index) => ({
      id: `tuition-${index}`,
      date: `${2026 + Math.floor(index / 12) % 30}-${String((index % 12) + 1).padStart(2, "0")}`,
      label: `Matrícula ${index}`,
      amount: 1,
      enabled: true,
      note: "",
    }));

    const realRecords = Array.from({ length: 500 }, (_, index) => {
      const absoluteMonth = 2026 * 12 + index;
      const year = Math.floor(absoluteMonth / 12);
      const month = (absoluteMonth % 12) + 1;
      return actual(`${year}-${String(month).padStart(2, "0")}`, {
        id: `actual-${index}`,
        status: "confirmed",
        actualRegularContribution: 1,
      });
    });
    const started = performance.now();
    const simulation = simulate(settings);
    const real = calculateActualTracking(state(realRecords));
    const elapsed = performance.now() - started;

    expect(simulation.monthly).toHaveLength(20 * 360);
    expect(real).toHaveLength(500);
    expect(real.at(-1)?.totalBalance).toBe(500);
    expect(elapsed).toBeLessThan(5_000);
  });
});
