import { describe, expect, it } from "vitest";
import { cloneDefaults } from "../data/defaultConfiguration";
import { gmfOn, monthlyRate, simulate, suggestedTransfer, withholdingOn } from "./simulation";

describe("fórmulas financieras", () => {
  it("calcula retención únicamente sobre el rendimiento", () => {
    expect(withholdingOn(70_000, 7)).toBe(4_900);
    expect(70_000 - withholdingOn(70_000, 7)).toBe(65_100);
  });

  it("calcula GMF", () => {
    expect(gmfOn(7_000_000, 0.4)).toBe(28_000);
  });

  it("convierte 8,75 % EA a tasa mensual", () => {
    expect(monthlyRate(8.75) * 100).toBeCloseTo(0.70146, 4);
  });
});

describe("motor mensual", () => {
  it("acumula el escenario base sin rendimientos", () => {
    const settings = cloneDefaults();
    settings.endDate = "2027-12";
    settings.yieldsEnabled = false;
    settings.taxes.gmfEnabled = false;
    settings.taxes.withholdingEnabled = false;
    settings.tuitionEvents = [];
    const result = simulate(settings);
    expect(result.summaries[0].finalTotal).toBe(23_018_250);
  });

  it("no paga ni deja saldo negativo cuando falta dinero", () => {
    const settings = cloneDefaults();
    settings.startDate = "2028-01";
    settings.endDate = "2028-01";
    settings.yieldsEnabled = false;
    settings.bonus.enabled = false;
    settings.taxes.gmfEnabled = false;
    settings.scenarios[0].initialNuBalance = 6_900_000;
    settings.scenarios[0].savingsRate = 0;
    settings.tuitionEvents = [settings.tuitionEvents[0]];
    const row = simulate(settings).monthly[0];
    expect(row.tuitionPaid).toBe(false);
    expect(row.missing).toBe(100_000);
    expect(row.closingTotalBalance).toBe(6_900_000);
  });

  it("sugiere traslado sin modificar el patrimonio", () => {
    const settings = cloneDefaults();
    const suggestion = suggestedTransfer(40_000_000, settings.concentration);
    expect(suggestion).toBe(10_000_000);
  });

  it("confirma traslado sin costo conservando el patrimonio", () => {
    const settings = cloneDefaults();
    settings.startDate = "2026-09";
    settings.endDate = "2026-09";
    settings.yieldsEnabled = false;
    settings.bonus.enabled = false;
    settings.taxes.gmfEnabled = false;
    settings.scenarios[0].savingsRate = 0;
    settings.scenarios[0].initialNuBalance = 40_000_000;
    settings.transfers = [{
      id: "x-no-cost",
      scenarioId: "scenario-50",
      date: "2026-09",
      amount: 10_000_000,
      status: "confirmed",
      note: "",
      createdAt: "2026-09",
    }];
    const row = simulate(settings).monthly[0];
    expect(row.closingNuBalance).toBe(30_000_000);
    expect(row.closingExternalBalance).toBe(10_000_000);
    expect(row.closingTotalBalance).toBe(40_000_000);
    expect(row.totalContribution).toBe(0);
  });

  it("aplica traslado confirmado con GMF y conserva trazabilidad", () => {
    const settings = cloneDefaults();
    settings.startDate = "2026-09";
    settings.endDate = "2026-09";
    settings.yieldsEnabled = false;
    settings.bonus.enabled = false;
    settings.scenarios[0].savingsRate = 0;
    settings.scenarios[0].initialNuBalance = 40_000_000;
    settings.concentration.applyGmfToExternalTransfer = true;
    settings.transfers = [{
      id: "x",
      scenarioId: "scenario-50",
      date: "2026-09",
      amount: 10_000_000,
      status: "confirmed",
      note: "",
      createdAt: "2026-09",
    }];
    const row = simulate(settings).monthly[0];
    expect(row.externalTransferGmf).toBe(40_000);
    expect(row.closingNuBalance).toBe(29_960_000);
    expect(row.closingExternalBalance).toBe(10_000_000);
    expect(row.closingTotalBalance).toBe(39_960_000);
  });

  it("calcula el rendimiento Nu solo sobre el saldo Nu", () => {
    const settings = cloneDefaults();
    settings.startDate = "2026-09";
    settings.endDate = "2026-09";
    settings.bonus.enabled = false;
    settings.taxes.withholdingEnabled = false;
    settings.scenarios[0].savingsRate = 0;
    settings.scenarios[0].initialNuBalance = 30_000_000;
    settings.scenarios[0].initialExternalBalance = 10_000_000;
    settings.concentration.externalAnnualYieldRate = 0;
    const row = simulate(settings).monthly[0];
    expect(row.grossYield).toBeCloseTo(30_000_000 * monthlyRate(8.75), 6);
    expect(row.externalYield).toBe(0);
    expect(row.openingTotalBalance).toBe(40_000_000);
  });
});
