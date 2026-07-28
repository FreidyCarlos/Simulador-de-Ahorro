import type { ActualMonthlyRecord, ActualTrackingState } from "../domain/types";

export const createEmptyActualRecord = (month: string): ActualMonthlyRecord => {
  const now = new Date().toISOString();
  return {
    id: `actual-${month}-${Date.now()}`,
    month,
    actualIncome: 0,
    actualBonus: 0,
    actualRegularContribution: 0,
    actualBonusContribution: 0,
    actualNuCumulativeYield: undefined,
    actualNuGrossYield: 0,
    actualWithholding: 0,
    actualExternalYield: 0,
    actualTuitionPayment: 0,
    actualTuitionGmf: 0,
    tuitionFundingSource: "nu",
    tuitionFromNu: 0,
    tuitionFromExternal: 0,
    actualTransferToExternal: 0,
    actualTransferGmf: 0,
    otherWithdrawalFromNu: 0,
    otherWithdrawalFromExternal: 0,
    actualAdjustmentNu: 0,
    actualAdjustmentExternal: 0,
    reportedNuBalance: undefined,
    reportedExternalBalance: undefined,
    reconciliationStatus: "not_required",
    status: "draft",
    note: "",
    createdAt: now,
    updatedAt: now,
  };
};

export const createDefaultActualTracking = (): ActualTrackingState => ({
  startMonth: "2026-09",
  initialNuBalance: 0,
  initialExternalBalance: 0,
  records: [],
  revisions: [],
  deviceId: `local-${Math.random().toString(36).slice(2, 10)}`,
});
