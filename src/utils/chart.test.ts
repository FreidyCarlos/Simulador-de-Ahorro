import { describe, expect, it } from "vitest";
import { filterAroundLatestReal, shiftMonth } from "./chart";

const rows = [
  "2026-08",
  "2026-09",
  "2026-10",
  "2026-11",
].map((fullDate) => ({ fullDate }));

describe("ventana temporal de la gráfica de Panorama", () => {
  it("muestra el mes anterior, el último real y el siguiente", () => {
    expect(
      filterAroundLatestReal(rows, "2026-10", "context").map(
        (row) => row.fullDate,
      ),
    ).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("mantiene el plan completo cuando se selecciona esa vista", () => {
    expect(filterAroundLatestReal(rows, "2026-10", "full")).toEqual(rows);
    expect(filterAroundLatestReal(rows, undefined, "context")).toEqual(rows);
  });

  it("cambia correctamente de diciembre a enero", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2027-01", -1)).toBe("2026-12");
  });
});
