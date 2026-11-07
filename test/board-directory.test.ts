import { afterEach, describe, expect, it, vi } from "vitest";
import { BoardDirectory } from "../worker/board-directory.ts";
import type { Env } from "../worker/env.ts";
import { INDEX_KEY, indexJson } from "../worker/layout.ts";
import type { BoardEntry } from "../worker/rpc.ts";
import { MemoryBucket } from "./support/bucket.ts";
import { FakeState } from "./support/durable-objects.ts";

const entry = (id: string, updatedAt = "2026-11-08T00:00:00.000Z"): BoardEntry => ({
  id,
  name: `Board ${id}`,
  createdAt: "2026-11-08T00:00:00.000Z",
  createdBy: "ada@example.com",
  updatedAt,
});

function setup(bucket = new MemoryBucket()) {
  const env = { STORAGE_TYPE: "local-r2", LOCAL_BUCKET: bucket } as unknown as Env;
  return { bucket, directory: new BoardDirectory(new FakeState() as unknown as DurableObjectState, env) };
}

const listed = (bucket: MemoryBucket) => bucket.json<{ boards: BoardEntry[] }>(INDEX_KEY).boards.map((board) => board.id);

afterEach(() => vi.useRealTimers());

describe("BoardDirectory", () => {
  it("starts empty in a bucket without index.json, and writes it on the first board", async () => {
    const { bucket, directory } = setup();
    await expect(directory.list()).resolves.toEqual([]);
    await directory.create(entry("board00000000001"));
    expect(listed(bucket)).toEqual(["board00000000001"]);
  });

  it("reads the list that the bucket keeps", async () => {
    const bucket = new MemoryBucket();
    await bucket.put(INDEX_KEY, indexJson([entry("board00000000001")]), {});
    const { directory } = setup(bucket);
    await expect(directory.get("board00000000001")).resolves.toMatchObject({ name: "Board board00000000001" });
  });

  it("keeps every board when people create boards at the same moment", async () => {
    const { bucket, directory } = setup();
    await Promise.all(["board00000000001", "board00000000002", "board00000000003"].map((id) => directory.create(entry(id))));
    expect(listed(bucket).sort()).toEqual(["board00000000001", "board00000000002", "board00000000003"]);
  });

  it("renames and removes boards in the bucket too", async () => {
    const { bucket, directory } = setup();
    await directory.create(entry("board00000000001"));
    await directory.create(entry("board00000000002"));
    await expect(directory.rename("board00000000001", "Roadmap")).resolves.toMatchObject({ name: "Roadmap" });
    await expect(directory.rename("board00000000009", "Nothing")).resolves.toBeNull();
    await expect(directory.remove("board00000000002")).resolves.toBe(true);
    expect(bucket.json<{ boards: BoardEntry[] }>(INDEX_KEY).boards).toEqual([{ ...entry("board00000000001"), name: "Roadmap" }]);
  });

  it("refuses a second board with the same ID", async () => {
    const { directory } = setup();
    await directory.create(entry("board00000000001"));
    await expect(directory.create(entry("board00000000001"))).rejects.toThrow(/already exists/);
  });

  it("writes the time of a change a moment later, once for changes close together", async () => {
    vi.useFakeTimers();
    const { bucket, directory } = setup();
    await directory.create(entry("board00000000001", "2026-11-08T00:00:00.000Z"));
    await directory.touch("board00000000001", "2026-11-08T01:00:00.000Z");
    await directory.touch("board00000000001", "2026-11-08T02:00:00.000Z");
    expect(bucket.json<{ boards: BoardEntry[] }>(INDEX_KEY).boards[0]?.updatedAt).toBe("2026-11-08T00:00:00.000Z");
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.waitFor(() => expect(bucket.json<{ boards: BoardEntry[] }>(INDEX_KEY).boards[0]?.updatedAt).toBe("2026-11-08T02:00:00.000Z"));
  });
});
