import { describe, expect, it } from "vitest";
import { resolveTheme } from "./theme";

describe("preferencia de tema", () => {
  it("conserva el modo oscuro elegido por el usuario", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("conserva el modo claro aunque el sistema prefiera oscuro", () => {
    expect(resolveTheme("light", true)).toBe("light");
  });

  it("usa la preferencia del sistema cuando no existe una elección guardada", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });
});
