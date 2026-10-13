import { describe, expect, it } from "vitest";
import { backendBaseUrl, resolveBackendConfig } from "./backendConfig";

describe("backendConfig", () => {
  it("defaults to backend.config.json host and port", () => {
    const config = resolveBackendConfig();
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8765);
    expect(backendBaseUrl(config)).toBe("http://127.0.0.1:8765");
  });
});
