import { afterEach, describe, expect, it, vi } from "vitest";
import { mockDataForced, mockDataRequested, withMock } from "./data";

afterEach(() => {
  vi.unstubAllEnvs();
});

const real = vi.fn(async () => "real");
const mock = vi.fn(() => "mock");

afterEach(() => {
  real.mockClear();
  mock.mockClear();
});

describe("withMock", () => {
  it("answers with the real implementation when MOCK_DATA is unset", async () => {
    vi.stubEnv("MOCK_DATA", "");
    expect(await withMock(real, mock)).toBe("real");
    expect(mock).not.toHaveBeenCalled();
  });

  it("answers with the mock outside production when MOCK_DATA=1, without calling the real one", async () => {
    vi.stubEnv("MOCK_DATA", "1");
    vi.stubEnv("NODE_ENV", "development");
    expect(await withMock(real, mock)).toBe("mock");
    expect(real).not.toHaveBeenCalled();
  });

  /** The mocks include a signed-in session and write bridges that report an invented success. */
  it("ignores MOCK_DATA=1 in production", async () => {
    vi.stubEnv("MOCK_DATA", "1");
    vi.stubEnv("NODE_ENV", "production");
    expect(await withMock(real, mock)).toBe("real");
    expect(mock).not.toHaveBeenCalled();
    // Still reported as set, which is what the health endpoint tells the operator.
    expect(mockDataRequested()).toBe(true);
    expect(mockDataForced()).toBe(false);
  });

  it("falls back to the mock for a not-implemented stub, outside production only", async () => {
    vi.stubEnv("MOCK_DATA", "");
    const stub = async (): Promise<string> => {
      throw new Error("not implemented: getThing");
    };

    vi.stubEnv("NODE_ENV", "development");
    expect(await withMock(stub, mock)).toBe("mock");

    vi.stubEnv("NODE_ENV", "production");
    await expect(withMock(stub, mock)).rejects.toThrow("not implemented: getThing");
  });

  it("re-throws any other failure everywhere", async () => {
    vi.stubEnv("MOCK_DATA", "");
    const broken = async (): Promise<string> => {
      throw new Error("connection refused");
    };
    await expect(withMock(broken, mock)).rejects.toThrow("connection refused");
    expect(mock).not.toHaveBeenCalled();
  });
});
