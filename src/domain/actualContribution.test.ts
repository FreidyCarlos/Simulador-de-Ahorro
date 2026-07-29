import { describe, expect, it } from "vitest";
import {
  actualContributionTotal,
  changeActualBonusContribution,
  changeActualContributionTotal,
  foldActualBonusIntoRegular,
} from "./actualContribution";

describe("desglose del aporte real", () => {
  it("muestra como aporte realizado la suma del aporte regular y el de prima", () => {
    expect(actualContributionTotal(800_000, 200_000)).toBe(1_000_000);
  });

  it("cambia el total sin volver a sumar el aporte de prima", () => {
    expect(changeActualContributionTotal(1_200_000, 200_000)).toEqual({
      regular: 1_000_000,
      bonus: 200_000,
    });
  });

  it("limita el desglose de prima cuando el total se reduce", () => {
    expect(changeActualContributionTotal(100_000, 200_000)).toEqual({
      regular: 0,
      bonus: 100_000,
    });
  });

  it("separa la prima conservando el total cuando es posible", () => {
    expect(changeActualBonusContribution(800_000, 200_000, 300_000)).toEqual({
      regular: 700_000,
      bonus: 300_000,
    });
  });

  it("incorpora la prima al aporte regular al desactivar el desglose", () => {
    expect(foldActualBonusIntoRegular(800_000, 200_000)).toEqual({
      regular: 1_000_000,
      bonus: 0,
    });
  });
});
