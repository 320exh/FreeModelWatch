import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import * as queries from "@/lib/queries";
import { getAllModels } from "@/lib/queries";

function modelRequest(id: string): NextRequest {
  return new NextRequest(`https://example.com/api/models/${id}`, { method: "GET" });
}

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/models/[id]", () => {
  it("returns 200 with the existing response shape for a valid model", async () => {
    const { GET } = await import("@/app/api/models/[id]/route");
    const id = getAllModels()[0].id;
    const res = await GET(modelRequest(id), ctx(id));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(id);
    expect(Array.isArray(json.routes)).toBe(true);
    expect(typeof json.score).toBe("object");
    expect(json.score).toHaveProperty("total");
    expect(Array.isArray(json.harnessCompat)).toBe(true);
    expect(Array.isArray(json.sources)).toBe(true);
    expect(Array.isArray(json.changes)).toBe(true);
  });

  it("returns 404 for an unknown model", async () => {
    const { GET } = await import("@/app/api/models/[id]/route");
    const res = await GET(modelRequest("this-model-does-not-exist"), ctx("this-model-does-not-exist"));
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Model not found");
  });

  it("returns a generic 500 with no `detail` when getModelView throws", async () => {
    const { GET } = await import("@/app/api/models/[id]/route");
    const spy = vi.spyOn(queries, "getModelView").mockImplementation(() => {
      throw new Error("simulated internal failure");
    });
    try {
      const res = await GET(modelRequest("x"), ctx("x"));
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe("Failed to load model");
      expect(json).not.toHaveProperty("detail");
    } finally {
      spy.mockRestore();
    }
  });
});
