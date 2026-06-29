import { afterEach, describe, expect, it, vi } from "vitest";
import { readTextFile } from "./api";

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
