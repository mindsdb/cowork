import { afterEach, describe, expect, it, vi } from "vitest";
import { diagnostic } from "./diagnostics";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("safe diagnostic events", () => {
  it("defaults to warnings and accepts a temporary detail override", () => {
    vi.stubEnv("LOG_LEVEL", "");
    const output = vi.spyOn(console, "log").mockImplementation(() => {});
    diagnostic("test", "INFO", "ordinary_success");
    expect(output).not.toHaveBeenCalled();
    vi.stubGlobal("localStorage", { getItem: () => "DEBUG" });
    diagnostic("test", "DEBUG", "investigation");
    expect(JSON.parse(String(output.mock.calls[0][0])).event).toBe(
      "investigation",
    );
  });
  it("keeps types and stack locations but excludes values and getters", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new TypeError("private-message");
    error.stack =
      "TypeError: private-message\n at fail (https://example.com/app.js?token=private-query:12:4)";
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("private-proxy");
        },
      },
    );
    const values = {
      status: 503,
      token: "private-token",
      get body() {
        throw new Error("must not inspect body");
      },
    };
    diagnostic(
      "test",
      "ERROR",
      "request_failed",
      "private-string",
      error,
      hostile,
      values,
    );
    const raw = String(output.mock.calls[0][0]);
    const event = JSON.parse(raw);
    expect(event.error_type).toBe("TypeError");
    expect(event.status_code).toBe(503);
    expect(event.exception_frames).toEqual([
      { file: "app.js", line: 12, column: 4 },
    ]);
    expect(raw).not.toContain("private-");
  });
});
