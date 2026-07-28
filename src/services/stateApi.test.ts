import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultApplicationData } from "../utils/storage";
import {
  getServerState,
  RevisionConflictApiError,
  saveServerState,
  StateApiError,
} from "./stateApi";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("servicio centralizado de estado", () => {
  it("diferencia un backend no disponible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(getServerState()).rejects.toMatchObject({
      code: "network_error",
    });
  });

  it("permite reintentar después de una desconexión", async () => {
    const data = createDefaultApplicationData();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        jsonResponse({
          schemaVersion: 2,
          revision: 3,
          updatedAt: "2026-07-28T20:00:00.000Z",
          isInitialState: false,
          data,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(getServerState()).rejects.toBeInstanceOf(StateApiError);
    await expect(getServerState()).resolves.toMatchObject({ revision: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("el guardado manual usa ruta relativa y expectedRevision", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        saved: true,
        revision: 8,
        updatedAt: "2026-07-28T20:01:00.000Z",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const data = createDefaultApplicationData();
    await saveServerState(data, 7);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/state",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ expectedRevision: 7, data }),
      }),
    );
  });

  it("convierte HTTP 409 en un conflicto tipado", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: "revision_conflict",
            message: "El estado fue modificado desde otro dispositivo.",
            currentRevision: 9,
            updatedAt: "2026-07-28T20:02:00.000Z",
          },
          409,
        ),
      ),
    );
    const promise = saveServerState(createDefaultApplicationData(), 8);
    await expect(promise).rejects.toBeInstanceOf(RevisionConflictApiError);
    await expect(promise).rejects.toMatchObject({ currentRevision: 9 });
  });

  it("rechaza una respuesta API incompatible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ revision: "incorrecta" })),
    );
    await expect(getServerState()).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});
