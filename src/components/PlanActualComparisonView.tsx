import {
  ArrowDown,
  ArrowUp,
  Equal,
  Info,
  Scale,
} from "lucide-react";
import { metricVariation } from "../domain/actualTracking";
import type {
  ActualSummary,
  PlanActualComparison,
} from "../domain/types";
import { currency, monthLabel } from "../utils/format";

const VariationBadge = ({
  ideal,
  actual,
  inverse = false,
}: {
  ideal: number;
  actual: number | null;
  inverse?: boolean;
}) => {
  const result = metricVariation(ideal, actual, inverse);
  if (result.amount === null) {
    return <span className="variation-badge neutral">Sin registrar</span>;
  }
  const favorable = inverse ? result.amount < 0 : result.amount > 0;
  const equal = result.amount === 0;
  return (
    <span
      className={`variation-badge ${
        equal ? "neutral" : favorable ? "favorable" : "unfavorable"
      }`}
    >
      {equal ? (
        <Equal size={12} />
      ) : result.amount > 0 ? (
        <ArrowUp size={12} />
      ) : (
        <ArrowDown size={12} />
      )}
      {result.label}
      {result.amount !== null && (
        <small>
          {currency(result.amount)}
          {result.percentage === null
            ? ""
            : ` · ${(result.percentage * 100).toFixed(1)}%`}
        </small>
      )}
    </span>
  );
};

export function PlanActualComparisonView({
  comparison,
  projectionBlockers,
  actualSummary,
}: {
  comparison: PlanActualComparison[];
  projectionBlockers: Array<{ month?: string; reason: string }>;
  actualSummary: ActualSummary;
}) {
  const registered = comparison.filter((row) => row.actualTotalBalance !== null);
  const last = registered.at(-1);
  const idealContributions = comparison
    .filter((row) => !last || row.month <= last.month)
    .reduce(
    (sum, row) => sum + row.idealContribution,
    0,
  );
  const contributionCompliance =
    idealContributions > 0
      ? (actualSummary.totalContributions / idealContributions) * 100
      : null;
  return (
    <>
      <section className="page-heading">
        <div>
          <div className="eyebrow green">
            <Scale size={14} /> Desviaciones visibles
          </div>
          <h1>Ideal vs Real</h1>
          <p>
            Compara lo que debía ocurrir con lo que registraste. Los meses
            futuros permanecen sin dato real.
          </p>
        </div>
      </section>

      <section className="comparison-summary-grid">
        <article className="comparison-main-card">
          <span>Cumplimiento de aportes</span>
          <strong>
            {contributionCompliance === null
              ? "No aplica"
              : `${contributionCompliance.toFixed(1)}%`}
          </strong>
          <div className="compliance-track">
            <span
              style={{
                width: `${Math.min(100, contributionCompliance ?? 0)}%`,
              }}
            />
          </div>
          <p>
            Aportes reales frente a los aportes ideales transcurridos. No
            garantiza el pago de la carrera.
          </p>
        </article>
        <article className="comparison-mini-card">
          <span>Patrimonio ideal al último registro</span>
          <strong>{currency(last?.idealTotalBalance ?? 0)}</strong>
          <small>Referencia del Ahorro ideal</small>
        </article>
        <article className="comparison-mini-card">
          <span>Patrimonio real</span>
          <strong>{currency(actualSummary.finalTotalBalance)}</strong>
          <small>{actualSummary.registeredMonths} meses registrados</small>
        </article>
        <article className="comparison-mini-card">
          <span>Diferencia acumulada</span>
          <strong
            className={
              (last?.totalVariation ?? 0) < 0
                ? "negative-number"
                : "positive-number"
            }
          >
            {last?.totalVariation == null
              ? "Sin datos"
              : currency(last.totalVariation)}
          </strong>
          <small>
            {last?.totalVariation == null
              ? "Registra un mes para comparar"
              : last.totalVariation >= 0
                ? "Por encima del plan"
                : "Por debajo del plan"}
          </small>
        </article>
      </section>
      {projectionBlockers.length > 0 && (
        <div className="validation-banner" role="alert">
          <Info size={18} />
          <div>
            <strong>La proyección actualizada omitió cierres no elegibles</strong>
            <p>
              {projectionBlockers
                .slice(0, 3)
                .map((item) => `${item.month ?? "Seguimiento"}: ${item.reason}`)
                .join(" · ")}
            </p>
          </div>
        </div>
      )}

      <section className="panel data-table-panel comparison-table">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Mes</th>
                <th>Ingreso</th>
                <th>Aporte de prima</th>
                <th>Aportes</th>
                <th>Rendimientos</th>
                <th>Retención</th>
                <th>Matrícula</th>
                <th>GMF</th>
                <th>Saldo Nu</th>
                <th>Saldo externo</th>
                <th>Patrimonio</th>
                <th>Variación</th>
                <th>Interpretación</th>
              </tr>
            </thead>
            <tbody>
              {comparison.map((row) => (
                <tr key={row.month}>
                  <td>
                    <strong>{monthLabel(row.month, true)}</strong>
                  </td>
                  <td>
                    <span className="ideal-real-cell">
                      <small>Ideal {currency(row.idealIncome)}</small>
                      <strong>
                        Real{" "}
                        {row.actualIncome === null
                          ? "—"
                          : currency(row.actualIncome)}
                      </strong>
                      <VariationBadge ideal={row.idealIncome} actual={row.actualIncome} />
                    </span>
                  </td>
                  <td>
                    <span className="ideal-real-cell">
                      <small>Ideal {currency(row.idealBonusContribution)}</small>
                      <strong>
                        Real{" "}
                        {row.actualBonusContribution === null
                          ? "—"
                          : currency(row.actualBonusContribution)}
                      </strong>
                      <VariationBadge
                        ideal={row.idealBonusContribution}
                        actual={row.actualBonusContribution}
                      />
                    </span>
                  </td>
                  <td>
                    <span className="ideal-real-cell">
                      <small>Ideal {currency(row.idealContribution)}</small>
                      <strong>
                        Real{" "}
                        {row.actualContribution === null
                          ? "—"
                          : currency(row.actualContribution)}
                      </strong>
                      <VariationBadge ideal={row.idealContribution} actual={row.actualContribution} />
                    </span>
                  </td>
                  <td>
                    <span className="ideal-real-cell">
                      <small>Ideal {currency(row.idealYield)}</small>
                      <strong>
                        Real{" "}
                        {row.actualYield === null
                          ? "—"
                          : currency(row.actualYield)}
                      </strong>
                      <VariationBadge ideal={row.idealYield} actual={row.actualYield} />
                    </span>
                  </td>
                  <td>
                    <span className="ideal-real-cell">
                      <small>Ideal {currency(row.idealWithholding)}</small>
                      <strong>
                        Real{" "}
                        {row.actualWithholding === null
                          ? "—"
                          : currency(row.actualWithholding)}
                      </strong>
                      <VariationBadge
                        ideal={row.idealWithholding}
                        actual={row.actualWithholding}
                        inverse
                      />
                    </span>
                  </td>
                  <td>
                    <span className="ideal-real-cell">
                      <small>Ideal {currency(row.idealTuition)}</small>
                      <strong>
                        Real{" "}
                        {row.actualTuition === null
                          ? "—"
                          : currency(row.actualTuition)}
                      </strong>
                      <VariationBadge
                        ideal={row.idealTuition}
                        actual={row.actualTuition}
                        inverse
                      />
                    </span>
                  </td>
                  <td>
                    <span className="ideal-real-cell">
                      <small>Ideal {currency(row.idealGmf)}</small>
                      <strong>
                        Real{" "}
                        {row.actualGmf === null
                          ? "—"
                          : currency(row.actualGmf)}
                      </strong>
                      <VariationBadge
                        ideal={row.idealGmf}
                        actual={row.actualGmf}
                        inverse
                      />
                    </span>
                  </td>
                  <td>
                    <span className="ideal-real-cell">
                      <small>Ideal {currency(row.idealNuBalance)}</small>
                      <strong>
                        Real{" "}
                        {row.actualNuBalance === null
                          ? "—"
                          : currency(row.actualNuBalance)}
                      </strong>
                      <VariationBadge ideal={row.idealNuBalance} actual={row.actualNuBalance} />
                    </span>
                  </td>
                  <td>
                    <span className="ideal-real-cell">
                      <small>Ideal {currency(row.idealExternalBalance)}</small>
                      <strong>
                        Real{" "}
                        {row.actualExternalBalance === null
                          ? "—"
                          : currency(row.actualExternalBalance)}
                      </strong>
                      <VariationBadge ideal={row.idealExternalBalance} actual={row.actualExternalBalance} />
                    </span>
                  </td>
                  <td>
                    <span className="ideal-real-cell">
                      <small>Ideal {currency(row.idealTotalBalance)}</small>
                      <strong>
                        Real{" "}
                        {row.actualTotalBalance === null
                          ? "Sin registrar"
                          : currency(row.actualTotalBalance)}
                      </strong>
                      <VariationBadge ideal={row.idealTotalBalance} actual={row.actualTotalBalance} />
                    </span>
                  </td>
                  <td
                    className={
                      (row.totalVariation ?? 0) < 0
                        ? "negative-number"
                        : "positive-number"
                    }
                  >
                    {row.totalVariation === null
                      ? "—"
                      : currency(row.totalVariation)}
                  </td>
                  <td>
                    <VariationBadge
                      ideal={row.idealTotalBalance}
                      actual={row.actualTotalBalance}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="callout comparison-callout">
        <Info size={18} />
        <div>
          <strong>Cómo leer los costos</strong>
          <p>
            Para ingresos, aportes, rendimientos y patrimonio, estar por encima
            suele ser favorable. Para matrícula, GMF y retención, un valor
            superior al esperado se marca como costo desfavorable.
          </p>
        </div>
      </div>
    </>
  );
}
