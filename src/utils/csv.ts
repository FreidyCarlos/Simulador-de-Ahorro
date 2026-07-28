import type { ActualCalculatedMonth } from "../domain/types";

const FORMULA_PREFIX = /^[=+\-@]/;

export const neutralizeCsvFormula = (value: unknown) => {
  const text = String(value ?? "");
  return FORMULA_PREFIX.test(text) ? `'${text}` : text;
};

export const toCsv = (rows: Record<string, unknown>[], includeBom = true) => {
  if (!rows.length) return includeBom ? "\uFEFF" : "";
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const safe =
      typeof value === "string" ? neutralizeCsvFormula(value) : String(value ?? "");
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const body = [
    headers.map(escape).join(","),
    ...rows.map((row) => headers.map((header) => escape(row[header])).join(",")),
  ].join("\r\n");
  return includeBom ? `\uFEFF${body}` : body;
};

export const actualTrackingCsvRows = (months: ActualCalculatedMonth[]) =>
  months.map((month) => ({
    mes: month.record.month,
    estado: month.displayStatus,
    ingreso_real: month.record.actualIncome,
    prima_real: month.record.actualBonus,
    aporte_regular: month.record.actualRegularContribution,
    aporte_prima: month.record.actualBonusContribution,
    rendimiento_nu_acumulado:
      month.record.actualNuCumulativeYield ?? "",
    rendimiento_nu: month.record.actualNuGrossYield,
    retencion: month.record.actualWithholding,
    rendimiento_externo: month.record.actualExternalYield,
    matricula: month.record.actualTuitionPayment,
    origen_matricula: month.record.tuitionFundingSource,
    matricula_desde_nu: month.record.tuitionFromNu,
    matricula_desde_externo: month.record.tuitionFromExternal,
    gmf_matricula: month.record.actualTuitionGmf,
    traslado_externo: month.record.actualTransferToExternal,
    costo_traslado: month.record.actualTransferGmf,
    otros_retiros_nu: month.record.otherWithdrawalFromNu,
    otros_retiros_externos: month.record.otherWithdrawalFromExternal,
    ajuste_nu: month.record.actualAdjustmentNu,
    ajuste_externo: month.record.actualAdjustmentExternal,
    saldo_nu_calculado: month.calculatedNuBalance,
    saldo_nu_reportado: month.record.reportedNuBalance ?? "",
    diferencia_nu: month.nuDifference ?? "",
    saldo_externo_calculado: month.calculatedExternalBalance,
    saldo_externo_reportado: month.record.reportedExternalBalance ?? "",
    diferencia_externa: month.externalDifference ?? "",
    estado_conciliacion: month.record.reconciliationStatus,
    patrimonio_real: month.totalBalance,
    nota: month.record.note,
    creado: month.record.createdAt,
    actualizado: month.record.updatedAt,
  }));
