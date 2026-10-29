import { beforeEach, describe, expect, it, vi } from "vitest";

const { factory } = vi.hoisted(() => ({ factory: vi.fn() }));

vi.mock("@openmeteo/file-format-wasm", () => ({ default: factory }));

describe("WASM initialization caching", () => {
  beforeEach(() => {
    vi.resetModules();
    factory.mockReset();
  });

  it("shares one initialization and completed module across callers", async () => {
    const { initWasm, getWasmModule } = await import("../lib/wasm");
    const rawModule = { HEAPU8: new Uint8Array(16) };
    let complete!: (value: typeof rawModule) => void;
    factory.mockReturnValue(new Promise<typeof rawModule>((resolve) => (complete = resolve)));

    expect(getWasmModule).toThrow("WASM module not initialized");
    const first = initWasm();
    const second = initWasm();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    expect(getWasmModule).toThrow("WASM module not initialized");
    expect(initWasm()).toBe(first);

    complete(rawModule);
    const [module, concurrentModule] = await Promise.all([first, second]);
    expect(concurrentModule).toBe(module);
    expect(module.HEAPU8).toBe(rawModule.HEAPU8);
    expect(getWasmModule()).toBe(module);
    expect(await initWasm()).toBe(module);
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it("shares initialization failures and allows a subsequent retry", async () => {
    const { initWasm, getWasmModule } = await import("../lib/wasm");
    const cause = new Error("Initialization failed");
    factory.mockRejectedValueOnce(cause).mockResolvedValueOnce({ HEAPU8: new Uint8Array(16) });

    const first = initWasm();
    const second = initWasm();
    const results = await Promise.allSettled([first, second]);
    expect(results[0]).toMatchObject({
      status: "rejected",
      reason: { message: "Failed to initialize WASM module", cause },
    });
    expect(results[1]).toEqual(results[0]);
    expect(factory).toHaveBeenCalledTimes(1);
    expect(getWasmModule).toThrow("WASM module not initialized");

    const retry = initWasm();
    expect(retry).not.toBe(first);
    expect(initWasm()).toBe(retry);
    const module = await retry;
    expect(getWasmModule()).toBe(module);
    expect(await initWasm()).toBe(module);
    expect(factory).toHaveBeenCalledTimes(2);
  });
});
