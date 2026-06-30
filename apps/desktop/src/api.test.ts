import { afterEach, describe, expect, it, vi } from "vitest";
import { call, readTextFile, requireCurrentBackend, REQUIRED_API_SCHEMA_VERSION } from "./api";

function mockApiCallResult(result: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, method: "readTextFile", result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    )
  );
}

describe("readTextFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns plain text results unchanged", async () => {
    mockApiCallResult("0: object\n");

    await expect(readTextFile("D:\\Yolo\\ZZZ\\V1", "classes.txt")).resolves.toBe("0: object\n");
  });

  it("serializes normalized JSON results back to text", async () => {
    mockApiCallResult({
      version: 1,
      classDefs: [{ key: "agents", name: "Agents" }],
      tasks: {
        detect: { classKeys: [] },
        clf: { classKeys: ["agents"] },
      },
    });

    const text = await readTextFile("D:\\Yolo\\ZZZ\\V1", "workspace/classes.json");
    const parsed = JSON.parse(text) as { tasks: { clf: { classKeys: string[] } } };

    expect(parsed.tasks.clf.classKeys).toEqual(["agents"]);
  });
});

describe("api transport errors", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports stale backend schema clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            ok: true,
            app: "yoloworkbench",
            backend: "fastapi",
            apiSchemaVersion: REQUIRED_API_SCHEMA_VERSION - 1,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    await expect(requireCurrentBackend()).rejects.toThrow(
      `Backend is out of date (API schema ${REQUIRED_API_SCHEMA_VERSION - 1}; need ${REQUIRED_API_SCHEMA_VERSION})`
    );
  });

  it("handles empty non-ok api responses without JSON parse masking", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));

    await expect(call("readTextFile", ["D:\\Yolo\\ZZZ\\V1", "classes.txt"])).rejects.toThrow("HTTP 500");
  });
});
