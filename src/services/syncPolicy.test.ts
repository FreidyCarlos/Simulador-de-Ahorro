import { describe, expect, it } from "vitest";
import {
  AUTO_SAVE_DELAY_MS,
  decideRemoteRevisionAction,
  HEALTH_POLL_INTERVAL_MS,
} from "./syncPolicy";

describe("política de guardado y sincronización", () => {
  it("usa debounce de 800 ms", () => {
    expect(AUTO_SAVE_DELAY_MS).toBe(800);
  });

  it("consulta salud cada 5 segundos", () => {
    expect(HEALTH_POLL_INTERVAL_MS).toBe(5_000);
  });

  it("no actúa cuando la revisión no cambió", () => {
    expect(decideRemoteRevisionAction(4, 4, false)).toBe("none");
  });

  it("recarga una revisión nueva si no hay cambios locales", () => {
    expect(decideRemoteRevisionAction(4, 5, false)).toBe("reload");
  });

  it("protege cambios locales ante una revisión nueva", () => {
    expect(decideRemoteRevisionAction(4, 5, true)).toBe("conflict");
  });
});
