import { describe, expect, it } from "vitest";
import { createDefaultRepository, selectedBackend } from "@/lib/domain/store";

describe("state backend selection", () => {
  it("defaults to the in-memory backend", () => {
    expect(selectedBackend({})).toBe("memory");
    expect(createDefaultRepository({}).backend).toBe("memory");
  });

  it("selects Postgres only when the flag says so", () => {
    expect(selectedBackend({ NEXUS_STATE_BACKEND: "postgres" })).toBe("postgres");
    // The pool is lazy: constructing the repository never opens a connection.
    const repo = createDefaultRepository({
      NEXUS_STATE_BACKEND: "postgres",
      DATABASE_URL: "postgres://nexus:nexus@127.0.0.1:1/unused",
    });
    expect(repo.backend).toBe("postgres");
    expect(() => repo.getState()).toThrow(/loadState/);
  });

  it("rejects an unknown backend name instead of silently falling back", () => {
    expect(() => selectedBackend({ NEXUS_STATE_BACKEND: "sqlite" })).toThrow(/Unknown NEXUS_STATE_BACKEND/);
  });

  it("requires DATABASE_URL for the Postgres backend", () => {
    expect(() => createDefaultRepository({ NEXUS_STATE_BACKEND: "postgres" })).toThrow(/DATABASE_URL/);
  });
});
