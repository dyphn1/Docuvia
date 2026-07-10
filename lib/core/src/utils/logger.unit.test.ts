import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("logger pino-pretty fail-soft behavior", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
    vi.doUnmock("module");
  });

  it("does not throw when DOCUVIA_PRETTY_LOGS is unset and NODE_ENV is not production", async () => {
    delete process.env.DOCUVIA_PRETTY_LOGS;
    delete process.env.NODE_ENV;

    await expect(import("./logger.js")).resolves.toBeDefined();
  });

  it("falls back to plain logging if pino-pretty resolution fails", async () => {
    process.env.DOCUVIA_PRETTY_LOGS = "1";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.doMock("module", async (importOriginal) => {
      const actual = (await importOriginal()) as any;
      return {
        ...actual,
        createRequire: (...args: unknown[]) => {
          const realRequire = actual.createRequire(...args);
          const fakeRequire: any = (id: string) => realRequire(id);
          fakeRequire.resolve = () => {
            throw new Error("Cannot find module 'pino-pretty'");
          };
          return fakeRequire;
        },
      };
    });

    await expect(import("./logger.js")).resolves.toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("pino-pretty unavailable"));
  });
});
