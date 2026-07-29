import { describe, expect, it } from "vitest";
import {
  filterChartForView,
  getChartMonthNeighbors,
  moveActualChartWindow,
} from "./chart";

const rows = [
  "2026-09",
  "2026-10",
  "2026-11",
  "2026-12",
  "2027-01",
].map((fullDate) => ({ fullDate }));

describe("navegación mensual de la gráfica de Panorama", () => {
  it("muestra cuatro meses y deja al final el mes sin datos", () => {
    expect(
      filterChartForView(rows, "2026-12", "actual").map(
        (row) => row.fullDate,
      ),
    ).toEqual(["2026-09", "2026-10", "2026-11", "2026-12"]);
  });

  it("desplaza la ventana conservando cuatro meses visibles", () => {
    expect(
      filterChartForView(rows, "2027-01", "actual").map(
        (row) => row.fullDate,
      ),
    ).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"]);
  });

  it("no recorta la gráfica al seleccionar un mes que ya está visible", () => {
    expect(moveActualChartWindow(rows, "2026-12", "2026-11")).toBe("2026-12");
    expect(moveActualChartWindow(rows, "2026-12", "2026-09")).toBe("2026-12");
  });

  it("corre la ventana un mes al seleccionar enero", () => {
    expect(moveActualChartWindow(rows, "2026-12", "2027-01")).toBe("2027-01");
    expect(
      filterChartForView(
        rows,
        moveActualChartWindow(rows, "2026-12", "2027-01"),
        "actual",
      ).map((row) => row.fullDate),
    ).toEqual(["2026-10", "2026-11", "2026-12", "2027-01"]);
  });

  it("corre la ventana hacia atrás solo al superar el extremo izquierdo", () => {
    expect(moveActualChartWindow(rows, "2027-01", "2026-10")).toBe("2027-01");
    expect(moveActualChartWindow(rows, "2027-01", "2026-09")).toBe("2026-12");
  });

  it("muestra todo el ahorro ideal en su vista", () => {
    expect(filterChartForView(rows, "2026-11", "ideal")).toEqual(rows);
  });

  it("encuentra el mes exacto que mostrará cada botón", () => {
    expect(getChartMonthNeighbors(rows, "2026-11")).toEqual({
      previous: { fullDate: "2026-10" },
      next: { fullDate: "2026-12" },
    });
  });

  it("deshabilita la dirección que supera los extremos del ahorro", () => {
    expect(getChartMonthNeighbors(rows, "2026-09").previous).toBeUndefined();
    expect(getChartMonthNeighbors(rows, "2027-01").next).toBeUndefined();
  });
});
