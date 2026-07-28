export type FundingOrder = "externalFirst" | "nuFirst";
export type SuggestionMode = "fixedAmount" | "reduceToTarget" | "keepSafetyMargin";
export type ReminderStatus = "pending" | "confirmed" | "postponed" | "dismissed";

export interface YearlyIncome {
  id?: string;
  year: number;
  monthlyIncome: number;
  note: string;
  projectedMonthlyIncome?: number;
  source?: "projection" | "manual" | "import";
  createdAt?: string;
  updatedAt?: string;
}

export interface YieldRate {
  id?: string;
  year: number;
  effectiveAnnualRate: number;
  projectedEffectiveAnnualRate?: number;
  source?: "projection" | "manual" | "import";
  createdAt?: string;
  updatedAt?: string;
}

export interface TuitionEvent {
  id: string;
  date: string;
  label: string;
  amount: number;
  enabled: boolean;
  note: string;
}

export interface SavingsScenario {
  id: string;
  name: string;
  savingsRate: number;
  initialNuBalance: number;
  initialExternalBalance: number;
  enabled: boolean;
  color: string;
}

export interface TransferEvent {
  id: string;
  scenarioId: string;
  date: string;
  amount: number;
  status: ReminderStatus;
  note: string;
  createdAt: string;
  updatedAt?: string;
  postponedTo?: string;
}

export interface AnnualValueRevision {
  id: string;
  field: string;
  year: number;
  previousValue: number;
  newValue: number;
  source: "projection" | "manual" | "import";
  reason?: string;
  changedAt: string;
}

export interface Settings {
  startDate: string;
  endDate: string;
  depositTiming: "startOfMonth" | "endOfMonth";
  failureMode: "stopFuturePayments" | "retryLater";
  incomes: YearlyIncome[];
  yieldsEnabled: boolean;
  yieldRates: YieldRate[];
  bonus: {
    enabled: boolean;
    month: number;
    mode: "incomePercentage" | "fixed";
    percentage: number;
    fixedAmount: number;
  };
  taxes: {
    withholdingEnabled: boolean;
    withholdingRate: number;
    gmfEnabled: boolean;
    gmfRate: number;
    gmfExempt: boolean;
  };
  concentration: {
    enabled: boolean;
    referenceLimit: number;
    alertThreshold: number;
    suggestionMode: SuggestionMode;
    fixedTransferAmount: number;
    targetNuBalance: number;
    safetyMargin: number;
    requireConfirmation: boolean;
    applyGmfToExternalTransfer: boolean;
    externalAnnualYieldRate: number;
    externalAccountName: string;
    tuitionFundingOrder: FundingOrder;
  };
  tuitionEvents: TuitionEvent[];
  scenarios: SavingsScenario[];
  transfers: TransferEvent[];
  annualValueRevisions?: AnnualValueRevision[];
}

export type TuitionPaymentStatus =
  | "paid"
  | "failed"
  | "pending_retry"
  | "skipped_after_failure"
  | "disabled"
  | "not_due";

export interface AppliedTransferResult {
  id: string;
  amount: number;
  cost: number;
  nuBalanceBefore: number;
  nuBalanceAfter: number;
  externalBalanceAfter: number;
  status: "applied" | "invalid";
  issue?: string;
}

export interface TuitionAttemptResult {
  eventId: string;
  originalMonth: string;
  attemptMonth: string;
  attemptNumber: number;
  amount: number;
  gmfCharged: number;
  status: "paid" | "failed" | "pending_retry";
}

export interface MonthlyResult {
  scenarioId: string;
  scenarioName: string;
  date: string;
  openingNuBalance: number;
  openingExternalBalance: number;
  openingTotalBalance: number;
  monthlyIncome: number;
  bonusIncome: number;
  regularSavings: number;
  bonusSavings: number;
  totalContribution: number;
  grossYield: number;
  externalYield: number;
  withholding: number;
  netYield: number;
  tuitionLabel: string;
  tuitionAmount: number;
  tuitionPaidAmount: number;
  tuitionPaidFromNu: number;
  tuitionPaidFromExternal: number;
  tuitionGmfAmount: number;
  totalWithdrawal: number;
  suggestedExternalTransfer: number;
  confirmedExternalTransfer: number;
  externalTransferGmf: number;
  closingNuBalance: number;
  closingExternalBalance: number;
  closingTotalBalance: number;
  tuitionPaid: boolean;
  tuitionPaymentStatus: TuitionPaymentStatus;
  tuitionOriginalMonths: string[];
  tuitionAttemptCount: number;
  tuitionAttempts: TuitionAttemptResult[];
  pendingTuitionCount: number;
  failure: boolean;
  missing: number;
  appliedTransfers: AppliedTransferResult[];
  transferIssues: string[];
}

export interface ScenarioSummary {
  scenario: SavingsScenario;
  finalNu: number;
  finalExternal: number;
  finalTotal: number;
  totalContributions: number;
  grossYield: number;
  externalYield: number;
  withholding: number;
  tuitionPaid: number;
  tuitionGmf: number;
  semestersPaid: number;
  firstFailure?: MonthlyResult;
  minimumBalance: number;
  minimumDate: string;
  pendingTransfer?: MonthlyResult;
}

export interface SimulationResult {
  monthly: MonthlyResult[];
  summaries: ScenarioSummary[];
  blockingIssues?: ValidationIssue[];
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export type ActualFundingSource = "nu" | "external" | "split";
export type ActualRecordStatus = "draft" | "confirmed";
export type ReconciliationStatus = "not_required" | "pending" | "reconciled";

export interface ActualMonthlyRecord {
  id: string;
  month: string;
  actualIncome: number;
  actualBonus: number;
  actualRegularContribution: number;
  actualBonusContribution: number;
  actualNuCumulativeYield?: number;
  actualNuGrossYield: number;
  actualWithholding: number;
  actualExternalYield: number;
  actualTuitionPayment: number;
  actualTuitionGmf: number;
  tuitionFundingSource: ActualFundingSource;
  tuitionFromNu: number;
  tuitionFromExternal: number;
  actualTransferToExternal: number;
  actualTransferGmf: number;
  otherWithdrawalFromNu: number;
  otherWithdrawalFromExternal: number;
  actualAdjustmentNu: number;
  actualAdjustmentExternal: number;
  reportedNuBalance?: number;
  reportedExternalBalance?: number;
  reconciliationStatus: ReconciliationStatus;
  status: ActualRecordStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActualRecordRevision {
  id: string;
  recordId: string;
  month: string;
  changedAt: string;
  reason: string;
  previousValues: ActualMonthlyRecord;
}

export interface ActualTrackingState {
  startMonth: string;
  initialNuBalance: number;
  initialExternalBalance: number;
  records: ActualMonthlyRecord[];
  revisions: ActualRecordRevision[];
  deviceId: string;
}

export interface ActualCalculatedMonth {
  record: ActualMonthlyRecord;
  openingNuBalance: number;
  openingExternalBalance: number;
  calculatedNuBalance: number;
  calculatedExternalBalance: number;
  totalBalance: number;
  nuDifference: number | null;
  externalDifference: number | null;
  totalContributions: number;
  totalGrossYield: number;
  totalCosts: number;
  displayStatus:
    | "En edición"
    | "Confirmado"
    | "Con diferencia"
    | "Conciliado";
  errors: string[];
}

export interface ActualSummary {
  finalNuBalance: number;
  finalExternalBalance: number;
  finalTotalBalance: number;
  totalContributions: number;
  totalGrossYield: number;
  totalWithholding: number;
  totalTuition: number;
  totalGmf: number;
  confirmedMonths: number;
  registeredMonths: number;
  lastConfirmedMonth?: string;
  pendingReconciliations: number;
}

export interface PlanActualComparison {
  month: string;
  idealIncome: number;
  actualIncome: number | null;
  idealBonusContribution: number;
  actualBonusContribution: number | null;
  idealContribution: number;
  actualContribution: number | null;
  idealYield: number;
  actualYield: number | null;
  idealWithholding: number;
  actualWithholding: number | null;
  idealTuition: number;
  actualTuition: number | null;
  idealGmf: number;
  actualGmf: number | null;
  idealNuBalance: number;
  actualNuBalance: number | null;
  idealExternalBalance: number;
  actualExternalBalance: number | null;
  idealTotalBalance: number;
  actualTotalBalance: number | null;
  totalVariation: number | null;
  totalVariationPercentage: number | null;
  metrics: {
    income: MetricVariation;
    bonusContribution: MetricVariation;
    contribution: MetricVariation;
    yield: MetricVariation;
    withholding: MetricVariation;
    tuition: MetricVariation;
    gmf: MetricVariation;
    nuBalance: MetricVariation;
    externalBalance: MetricVariation;
    totalBalance: MetricVariation;
  };
}

export interface MetricVariation {
  ideal: number;
  actual: number | null;
  amount: number | null;
  percentage: number | null;
  label: string;
}

export interface ProjectionBlocker {
  month?: string;
  reason: string;
}

export interface UpdatedProjectionPoint {
  month: string;
  ideal: number;
  actual: number | null;
  updated: number | null;
}

export interface UpdatedProjectionResult {
  series: UpdatedProjectionPoint[];
  closingMonth?: string;
  blockers: ProjectionBlocker[];
}

export interface StorageRecovery {
  source: "v2" | "v1" | "defaults";
  message?: string;
  corruptV2?: string;
}

export interface StoredApplicationData {
  version: number;
  planConfiguration: Settings;
  actualTracking: ActualTrackingState;
}
