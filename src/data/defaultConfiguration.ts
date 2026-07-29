import type { Settings } from "../domain/types";

const incomes = [
  [2026, 2_612_000],
  [2027, 2_742_600],
  [2028, 2_879_730],
  [2029, 3_023_717],
  [2030, 3_174_902],
  [2031, 3_333_647],
  [2032, 3_500_330],
].map(([year, monthlyIncome]) => ({
  year,
  id: `income-${year}`,
  monthlyIncome,
  projectedMonthlyIncome: monthlyIncome,
  source: "projection" as const,
  note: "",
}));

const tuitionByYear: Record<number, number> = {
  2028: 7_000_000,
  2029: 7_350_000,
  2030: 7_717_500,
  2031: 8_103_375,
  2032: 8_508_544,
};

const tuitionEvents = Object.entries(tuitionByYear).flatMap(([year, amount], index) => [
  {
    id: `tuition-${year}-01`,
    date: `${year}-01`,
    label: `Semestre ${index * 2 + 1}`,
    amount,
    enabled: true,
    note: "",
  },
  {
    id: `tuition-${year}-07`,
    date: `${year}-07`,
    label: `Semestre ${index * 2 + 2}`,
    amount,
    enabled: true,
    note: "",
  },
]);

export const defaultSettings: Settings = {
  startDate: "2026-09",
  endDate: "2032-12",
  depositTiming: "endOfMonth",
  failureMode: "stopFuturePayments",
  incomes,
  yieldsEnabled: true,
  yieldRates: incomes.map(({ year }) => ({
    year,
    id: `rate-${year}`,
    effectiveAnnualRate: 8.75,
    projectedEffectiveAnnualRate: 8.75,
    source: "projection",
  })),
  bonus: {
    enabled: true,
    month: 11,
    mode: "incomePercentage",
    percentage: 50,
    fixedAmount: 0,
  },
  taxes: {
    withholdingEnabled: true,
    withholdingRate: 7,
    gmfEnabled: true,
    gmfRate: 0.4,
    gmfExempt: false,
  },
  concentration: {
    enabled: true,
    referenceLimit: 50_000_000,
    alertThreshold: 40_000_000,
    suggestionMode: "reduceToTarget",
    fixedTransferAmount: 10_000_000,
    targetNuBalance: 30_000_000,
    safetyMargin: 10_000_000,
    requireConfirmation: true,
    applyGmfToExternalTransfer: false,
    externalAnnualYieldRate: 0,
    externalAccountName: "Fondo externo",
    tuitionFundingOrder: "externalFirst",
  },
  tuitionEvents,
  scenarios: [
    {
      id: "scenario-50",
      name: "Ahorro base",
      savingsRate: 50,
      initialNuBalance: 0,
      initialExternalBalance: 0,
      enabled: true,
      color: "#1f9d78",
    },
  ],
  transfers: [],
  annualValueRevisions: [],
};

export const cloneDefaults = (): Settings => JSON.parse(JSON.stringify(defaultSettings));
