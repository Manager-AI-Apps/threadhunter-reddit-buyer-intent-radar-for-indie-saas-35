import { describe, it, expect } from "vitest";
import { getTableName } from "drizzle-orm";
import {
  workspaces,
  threads,
  digestRuns,
  digestRunThreads,
} from "@/lib/db/schema";

describe("app schema tables", () => {
  it("workspaces table is defined", () => {
    expect(workspaces).toBeDefined();
    expect(getTableName(workspaces)).toBe("workspaces");
  });

  it("threads table is defined", () => {
    expect(threads).toBeDefined();
    expect(getTableName(threads)).toBe("threads");
  });

  it("digestRuns table is defined", () => {
    expect(digestRuns).toBeDefined();
    expect(getTableName(digestRuns)).toBe("digest_runs");
  });

  it("digestRunThreads table is defined", () => {
    expect(digestRunThreads).toBeDefined();
    expect(getTableName(digestRunThreads)).toBe("digest_run_threads");
  });

  it("threads table has workspaceId and redditPostId columns", () => {
    expect(threads.workspaceId).toBeDefined();
    expect(threads.redditPostId).toBeDefined();
  });
});
