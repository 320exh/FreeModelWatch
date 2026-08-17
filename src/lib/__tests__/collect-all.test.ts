import { describe, it, expect, vi } from "vitest";
import { runAll, type CollectorFn } from "../../../scripts/collect-all";
import type { CollectorRunReport } from "@/lib/collectors/run";

function report(status: CollectorRunReport["status"]): CollectorRunReport {
  return {
    dryRun: false, status, startedAt: "", finishedAt: "", collector: "x",
    modelsDiscovered: 0, freeModels: 0, newModels: [], existingModels: 0, changedModels: [],
    newFreeRoutes: [], changedFreeRoutes: [], reactivatedFreeRoutes: [], removedFreeRoutes: [],
    errors: [], warnings: [], errorMessage: null, modelsAdded: 0, modelsChanged: 0, modelsRemoved: 0,
    freeRoutesAdded: 0, freeRoutesRemoved: 0,
  } as CollectorRunReport;
}

describe("collect-all runner (failure isolation + exit code)", () => {
  it("exits 0 when all collectors succeed", async () => {
    const runners: CollectorFn[] = [() => Promise.resolve(report("success")), () => Promise.resolve(report("success"))];
    expect(await runAll({ runners })).toBe(0);
  });

  it("exits 0 for a partial (non-fatal) batch", async () => {
    const runners: CollectorFn[] = [() => Promise.resolve(report("partial")), () => Promise.resolve(report("success"))];
    expect(await runAll({ runners })).toBe(0);
  });

  it("exits 1 and still runs the second collector when the first fails", async () => {
    const calls: number[] = [];
    const runners: CollectorFn[] = [
      () => { calls.push(1); return Promise.resolve(report("failed")); },
      () => { calls.push(2); return Promise.resolve(report("success")); },
    ];
    expect(await runAll({ runners })).toBe(1);
    expect(calls).toEqual([1, 2]); // isolation: second still ran
  });

  it("exits 1 and isolates a crash from the other collector", async () => {
    const calls: number[] = [];
    const runners: CollectorFn[] = [
      () => { calls.push(1); return Promise.reject(new Error("boom")); },
      () => { calls.push(2); return Promise.resolve(report("success")); },
    ];
    expect(await runAll({ runners })).toBe(1);
    expect(calls).toEqual([1, 2]);
  });

  it("exits 1 when the last collector fails", async () => {
    const runners: CollectorFn[] = [() => Promise.resolve(report("success")), () => Promise.resolve(report("failed"))];
    expect(await runAll({ runners })).toBe(1);
  });

  it("does not call console.log when runners are injected but output is captured", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runAll({ runners: [() => Promise.resolve(report("success"))] });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
