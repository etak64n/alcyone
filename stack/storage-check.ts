// Before `pnpm stack:deploy` changes anything, it checks that the access key of the bucket
// can do what alcyone does with it. The Worker and the Durable Objects read and write the
// boards and their images, list the files of a board that someone deletes, and delete
// them. The check does each of these on keys under alcyone-check/, and deletes what it
// writes.

import type { ObjectStore } from "../worker/storage.ts";

/** What the access key must be allowed to do in the bucket. */
export type StoragePermission = "delete objects" | "write objects" | "read objects" | "list objects";

export interface MissingPermission {
  permission: StoragePermission;
  /** What the storage service answered. */
  reason: string;
}

const CHECK_BODY = "alcyone checks the access key of the bucket.";

/**
 * Returns the permissions that the access key lacks, one entry each, by the requests that the
 * bucket refuses. Deleting comes first, on a key that holds no object, so that a key that may
 * not delete stops the check before it writes anything that it could not remove.
 */
export async function missingStoragePermissions(store: ObjectStore, checkId: string): Promise<MissingPermission[]> {
  const prefix = `alcyone-check/${checkId}/`;
  const key = `${prefix}object`;
  const missing: MissingPermission[] = [];
  const attempt = async (permission: StoragePermission, action: () => Promise<void>): Promise<boolean> => {
    try {
      await action();
      return true;
    } catch (error) {
      if (!missing.some((item) => item.permission === permission)) {
        missing.push({ permission, reason: error instanceof Error ? error.message : String(error) });
      }
      return false;
    }
  };

  if (!(await attempt("delete objects", () => store.delete(`${prefix}none`)))) return missing;
  const written = await attempt("write objects", () => store.put(key, CHECK_BODY, "text/plain"));
  if (written) {
    await attempt("read objects", async () => {
      if ((await store.getText(key)) !== CHECK_BODY) throw new Error("A read returned other bytes than the write sent.");
    });
    await attempt("list objects", async () => {
      if (!(await store.list(prefix, 10)).includes(key)) throw new Error("A list of the bucket left out the object that the check wrote.");
    });
    await attempt("delete objects", () => store.delete(key));
  }
  return missing;
}

/** The error that stops the deploy, with the permissions to give and what the bucket answered. */
export function missingPermissionsMessage(bucket: string, missing: readonly MissingPermission[]): string {
  const names = missing.map((item) => item.permission);
  const list = names.length === 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
  return [
    `Please give the access key in .env.production permission to ${list} in the bucket ${bucket}, then deploy again. The deploy stopped before it changed anything.`,
    ...missing.map((item) => `  ${item.permission}: ${item.reason}`),
  ].join("\n");
}
