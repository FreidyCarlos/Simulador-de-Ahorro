import { describe, expect, it } from "vitest";
import {
  createDefaultActualTracking,
  createEmptyActualRecord,
} from "../data/defaultActualTracking";
import { cloneDefaults } from "../data/defaultConfiguration";
import {
  analyzeConfirmedActualTimeline,
  buildPlanActualComparison,
  buildUpdatedProjection,
  calculateActualTracking,
  monthlyNuYieldFromCumulative,
  saveActualRecord,
  summarizeActual,
  validateActualTrackingState,
  variation,
} from "./actualTracking";
import { simulate } from "./simulation";
import type {
  ActualMonthlyRecord,
  ActualTrackingState,
  StoredApplicationData,
} from "./types";
import {
  loadApplicationData,
  parseApplicationData,
  saveApplicationData,
  serializeApplicationData,
  STORAGE_KEY,
} from "../utils/storage";

const record = (
  month: string,
  patch: Partial<ActualMonthlyRecord> = {},
): ActualMonthlyRecord => ({
  ...createEmptyActualRecord(month),
  status: "confirmed",
  ...patch,
  id: `record-${month}`,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const tracking = (
  records: ActualMonthlyRecord[] = [],
  initialNuBalance = 0,
  initialExternalBalance = 0,
): ActualTrackingState => ({
  ...createDefaultActualTracking(),
  records,
  initialNuBalance,
  initialExternalBalance,
  deviceId: "test-device",
});

describe("seguimiento real", () => {
  it("1. inicia todos los saldos y acumulados en cero", () => {
    const state = createDefaultActualTracking();
    const summary = summarizeActual(state);
    expect(summary.finalNuBalance).toBe(0);
    expect(summary.finalExternalBalance).toBe(0);
    expect(summary.finalTotalBalance).toBe(0);
    expect(summary.totalContributions).toBe(0);
    expect(summary.totalGrossYield).toBe(0);
  });

  it("2. registra el primer aporte real", () => {
    const result = calculateActualTracking(
      tracking([
        record("2026-09", { actualRegularContribution: 1_000_000 }),
      ]),
    )[0];
    expect(result.calculatedNuBalance).toBe(1_000_000);
    expect(result.totalBalance).toBe(1_000_000);
  });

  it("3. registra prima y aporte real desde prima por separado", () => {
    const result = calculateActualTracking(
      tracking([
        record("2026-09", {
          actualBonus: 500_000,
          actualBonusContribution: 250_000,
        }),
      ]),
    )[0];
    expect(result.record.actualBonus).toBe(500_000);
    expect(result.totalContributions).toBe(250_000);
    expect(result.calculatedNuBalance).toBe(250_000);
  });

  it("4. agrega el rendimiento real de Nu", () => {
    const result = calculateActualTracking(
      tracking([record("2026-09", { actualNuGrossYield: 70_000 })], 10_000_000),
    )[0];
    expect(result.calculatedNuBalance).toBe(10_070_000);
  });

  it("4.1 convierte el acumulado verde de Nu en rendimiento mensual", () => {
    expect(monthlyNuYieldFromCumulative(18_386, 9_161)).toBe(9_225);
    const result = calculateActualTracking(
      tracking(
        [
          record("2026-09", { actualNuCumulativeYield: 9_161 }),
          record("2026-10", { actualNuCumulativeYield: 18_386 }),
        ],
        1_000_000,
      ),
    );

    expect(result[0].record.actualNuGrossYield).toBe(9_161);
    expect(result[1].record.actualNuGrossYield).toBe(9_225);
    expect(result[1].calculatedNuBalance).toBe(1_018_386);
  });

  it("5. descuenta la retención real", () => {
    const result = calculateActualTracking(
      tracking(
        [
          record("2026-09", {
            actualNuGrossYield: 70_000,
            actualWithholding: 4_900,
          }),
        ],
        10_000_000,
      ),
    )[0];
    expect(result.calculatedNuBalance).toBe(10_065_100);
  });

  it("6. conserva el patrimonio al trasladar sin costo", () => {
    const result = calculateActualTracking(
      tracking(
        [record("2026-09", { actualTransferToExternal: 10_000_000 })],
        40_000_000,
      ),
    )[0];
    expect(result.calculatedNuBalance).toBe(30_000_000);
    expect(result.calculatedExternalBalance).toBe(10_000_000);
    expect(result.totalBalance).toBe(40_000_000);
  });

  it("7. descuenta el GMF real del traslado", () => {
    const result = calculateActualTracking(
      tracking(
        [
          record("2026-09", {
            actualTransferToExternal: 10_000_000,
            actualTransferGmf: 40_000,
          }),
        ],
        40_000_000,
      ),
    )[0];
    expect(result.calculatedNuBalance).toBe(29_960_000);
    expect(result.calculatedExternalBalance).toBe(10_000_000);
    expect(result.totalBalance).toBe(39_960_000);
  });

  it("8. paga matrícula real desde Nu", () => {
    const result = calculateActualTracking(
      tracking(
        [
          record("2026-09", {
            actualTuitionPayment: 7_000_000,
            tuitionFundingSource: "nu",
          }),
        ],
        10_000_000,
      ),
    )[0];
    expect(result.calculatedNuBalance).toBe(3_000_000);
    expect(result.calculatedExternalBalance).toBe(0);
  });

  it("9. paga matrícula real desde el fondo externo", () => {
    const result = calculateActualTracking(
      tracking(
        [
          record("2026-09", {
            actualTuitionPayment: 7_000_000,
            tuitionFundingSource: "external",
          }),
        ],
        0,
        10_000_000,
      ),
    )[0];
    expect(result.calculatedNuBalance).toBe(0);
    expect(result.calculatedExternalBalance).toBe(3_000_000);
  });

  it("10. divide una matrícula entre ambos fondos", () => {
    const result = calculateActualTracking(
      tracking(
        [
          record("2026-09", {
            actualTuitionPayment: 7_000_000,
            tuitionFundingSource: "split",
            tuitionFromNu: 4_000_000,
            tuitionFromExternal: 3_000_000,
          }),
        ],
        5_000_000,
        5_000_000,
      ),
    )[0];
    expect(result.errors).toEqual([]);
    expect(result.calculatedNuBalance).toBe(1_000_000);
    expect(result.calculatedExternalBalance).toBe(2_000_000);
  });

  it("11. reconoce una conciliación sin diferencia", () => {
    const result = calculateActualTracking(
      tracking([
        record("2026-09", {
          actualRegularContribution: 1_000_000,
          reportedNuBalance: 1_000_000,
          status: "confirmed",
        }),
      ]),
    )[0];
    expect(result.nuDifference).toBe(0);
    expect(result.displayStatus).toBe("Confirmado");
  });

  it("12. identifica una diferencia de conciliación", () => {
    const result = calculateActualTracking(
      tracking([
        record("2026-09", {
          actualRegularContribution: 1_000_000,
          reportedNuBalance: 995_000,
          status: "confirmed",
          reconciliationStatus: "pending",
        }),
      ]),
    )[0];
    expect(result.nuDifference).toBe(-5_000);
    expect(result.displayStatus).toBe("Con diferencia");
    expect(result.totalContributions).toBe(1_000_000);
    expect(result.calculatedNuBalance).toBe(1_000_000);
  });

  it("13. aplica un ajuste de conciliación explícito", () => {
    const result = calculateActualTracking(
      tracking([
        record("2026-09", {
          actualRegularContribution: 1_000_000,
          actualAdjustmentNu: -5_000,
          reportedNuBalance: 995_000,
          status: "confirmed",
        }),
      ]),
    )[0];
    expect(result.calculatedNuBalance).toBe(995_000);
    expect(result.nuDifference).toBe(0);
  });

  it("14. conserva la versión anterior al modificar un mes confirmado", () => {
    const original = record("2026-09", {
      actualRegularContribution: 1_000_000,
      status: "confirmed",
    });
    const changed = { ...original, actualRegularContribution: 1_200_000 };
    const next = saveActualRecord(
      tracking([original]),
      changed,
      "2026-10-01T00:00:00.000Z",
    );
    expect(next.records[0].actualRegularContribution).toBe(1_200_000);
    expect(next.revisions).toHaveLength(1);
    expect(next.revisions[0].previousValues.actualRegularContribution).toBe(
      1_000_000,
    );
  });

  it("15. recalcula todos los meses posteriores", () => {
    const september = record("2026-09", {
      actualRegularContribution: 1_000_000,
      status: "confirmed",
    });
    const october = record("2026-10", {
      actualRegularContribution: 500_000,
      status: "confirmed",
    });
    const initial = tracking([september, october]);
    expect(calculateActualTracking(initial)[1].calculatedNuBalance).toBe(
      1_500_000,
    );
    const changed = saveActualRecord(initial, {
      ...september,
      actualRegularContribution: 2_000_000,
    });
    expect(calculateActualTracking(changed)[1].calculatedNuBalance).toBe(
      2_500_000,
    );
  });

  it("16. deja los meses futuros sin dato real", () => {
    const settings = cloneDefaults();
    const ideal = simulate(settings);
    const scenarioId = settings.scenarios[0].id;
    const rows = ideal.monthly.filter((row) => row.scenarioId === scenarioId);
    const actual = calculateActualTracking(
      tracking([
        record("2026-09", {
          actualRegularContribution: 1_000_000,
          status: "confirmed",
        }),
      ]),
    );
    const comparison = buildPlanActualComparison(rows, actual);
    expect(comparison.find((row) => row.month === "2026-10")?.actualTotalBalance)
      .toBeNull();
  });

  it("17. compara el Plan ideal con el valor real", () => {
    const settings = cloneDefaults();
    const idealRows = simulate(settings).monthly.filter(
      (row) => row.scenarioId === settings.scenarios[0].id,
    );
    const actual = calculateActualTracking(
      tracking([
        record("2026-09", {
          actualRegularContribution: 1_000_000,
          status: "confirmed",
        }),
      ]),
    );
    const september = buildPlanActualComparison(idealRows, actual)[0];
    expect(september.actualContribution).toBe(1_000_000);
    expect(september.totalVariation).toBe(
      1_000_000 - september.idealTotalBalance,
    );
  });

  it("compara como prima ideal únicamente el aporte ahorrado desde la prima", () => {
    const settings = cloneDefaults();
    settings.startDate = "2026-11";
    settings.endDate = "2026-11";
    settings.yieldsEnabled = false;
    settings.tuitionEvents = [];
    settings.bonus.enabled = true;
    settings.bonus.month = 11;
    settings.bonus.mode = "fixed";
    settings.bonus.fixedAmount = 1_000_000;
    settings.scenarios[0].savingsRate = 50;

    const idealRows = simulate(settings).monthly.filter(
      (row) => row.scenarioId === settings.scenarios[0].id,
    );
    const actual = calculateActualTracking(
      tracking([
        record("2026-11", {
          actualBonus: 1_000_000,
          actualBonusContribution: 500_000,
        }),
      ]),
      settings,
    );
    const comparison = buildPlanActualComparison(idealRows, actual)[0];

    expect(idealRows[0].bonusIncome).toBe(1_000_000);
    expect(comparison.idealBonusContribution).toBe(500_000);
    expect(comparison.actualBonusContribution).toBe(500_000);
    expect(comparison.metrics.bonusContribution.amount).toBe(0);
  });

  it("18. evita división por cero en una variación", () => {
    expect(variation(0, 50_000)).toEqual({
      amount: 50_000,
      percentage: null,
      label: "Nuevo movimiento",
    });
    expect(variation(0, 0).label).toBe("Sin base de comparación");
  });

  it("18.1 trata como iguales las diferencias que se muestran como cero pesos", () => {
    expect(variation(1_000_000, 999_999.999999)).toEqual({
      amount: 0,
      percentage: 0,
      label: "Según el plan",
    });
    expect(variation(1_000_000, 999_999)).toMatchObject({
      amount: -1,
      label: "Por debajo del plan",
    });
  });

  it("19. proyecta el futuro desde el último saldo real confirmado", () => {
    const settings = cloneDefaults();
    const state = tracking([
      record("2026-09", {
        actualRegularContribution: 2_000_000,
        status: "confirmed",
      }),
    ]);
    const projection = buildUpdatedProjection(settings, state);
    expect(projection[0].actual).toBe(2_000_000);
    expect(projection[1].actual).toBeNull();
    expect(projection[1].updated).not.toBeNull();
    expect(projection[1].updated).not.toBe(projection[1].ideal);
  });

  it("20. exporta e importa sin pérdida", () => {
    const data: StoredApplicationData = {
      version: 2,
      planConfiguration: cloneDefaults(),
      actualTracking: tracking([
        record("2026-09", {
          actualRegularContribution: 1_000_000,
          note: "Registro de prueba",
        }),
      ]),
    };
    expect(parseApplicationData(serializeApplicationData(data))).toEqual(data);
  });

  it("21. persiste después de recargar", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
      removeItem: (key: string) => void memory.delete(key),
    };
    const data: StoredApplicationData = {
      version: 2,
      planConfiguration: cloneDefaults(),
      actualTracking: tracking([
        record("2026-09", { actualRegularContribution: 1_000_000 }),
      ]),
    };
    saveApplicationData(storage, data);
    expect(memory.has(STORAGE_KEY)).toBe(true);
    expect(loadApplicationData(storage)).toEqual(data);
  });

  it("22. detecta registros fuera de orden", () => {
    const state = tracking([
      record("2026-10"),
      record("2026-09"),
    ]);
    expect(validateActualTrackingState(state)).toContain(
      "Los registros mensuales están fuera de orden.",
    );
  });

  it("23. detecta meses duplicados", () => {
    const state = tracking([
      record("2026-09"),
      { ...record("2026-09"), id: "duplicate" },
    ]);
    expect(validateActualTrackingState(state)).toContain(
      "El mes 2026-09 está duplicado.",
    );
    expect(calculateActualTracking(state)).toEqual([]);
    expect(analyzeConfirmedActualTimeline(state).excluded).toHaveLength(2);
  });

  it("24. conserva el patrimonio en un traslado real", () => {
    const before = 55_000_000;
    const result = calculateActualTracking(
      tracking(
        [record("2026-09", { actualTransferToExternal: 15_000_000 })],
        40_000_000,
        15_000_000,
      ),
    )[0];
    expect(result.totalBalance).toBe(before);
    expect(
      result.calculatedNuBalance + result.calculatedExternalBalance,
    ).toBe(before);
  });
});
