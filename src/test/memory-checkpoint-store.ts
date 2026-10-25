import type { Baseline, Checkpoint } from "@/lib/schemas/checkpoint";
import { StoreConflictError, type CheckpointStore } from "@/lib/checkpoints/service";

/** In-memory store with the same uniqueness rules as the database. */
export function memoryStore() {
  const baselines = new Map<string, Baseline>();
  const checkpoints: Checkpoint[] = [];
  let n = 0;
  const tick = () => Promise.resolve(); // lets concurrent calls interleave
  const store: CheckpointStore = {
    async getBaseline(projectId) {
      await tick();
      return baselines.get(projectId) ?? null;
    },
    async insertBaseline(b) {
      await tick();
      if (baselines.has(b.projectId)) throw new StoreConflictError();
      const row = { ...b, recordedAt: "2026-10-26T10:00:00+00:00" };
      baselines.set(b.projectId, row);
      return row;
    },
    async getCheckpoint(projectId, week) {
      await tick();
      return checkpoints.find((c) => c.projectId === projectId && c.weekNumber === week) ?? null;
    },
    async listCheckpoints(projectId) {
      await tick();
      return checkpoints.filter((c) => c.projectId === projectId);
    },
    async insertCheckpoint(c) {
      await tick();
      if (checkpoints.some((x) => x.projectId === c.projectId && x.weekNumber === c.weekNumber)) {
        throw new StoreConflictError();
      }
      const row: Checkpoint = {
        ...c,
        id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
        recordedAt: "2026-10-26T10:00:00+00:00",
      };
      checkpoints.push(row);
      return row;
    },
  };
  return { store, baselines, checkpoints };
}

