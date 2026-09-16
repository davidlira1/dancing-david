import { FilesetResolver } from "@mediapipe/tasks-vision";

const WASM_PATH =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";

/** MediaPipe does not export WasmFileset, so derive it from the resolver. */
type VisionFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

let pending: Promise<VisionFileset> | null = null;

/**
 * Resolved once and shared by every vision task. Each task still instantiates
 * its own wasm runtime — the tasks API has no shared graph runner across task
 * types — but the loader is only fetched once.
 */
export function visionFileset(): Promise<VisionFileset> {
  if (!pending) {
    pending = FilesetResolver.forVisionTasks(WASM_PATH);
  }
  return pending;
}

let creationQueue: Promise<unknown> = Promise.resolve();

/**
 * Creates a vision task, one at a time.
 *
 * Task creation is NOT concurrency safe: MediaPipe injects the wasm loader
 * script, which publishes the Emscripten factory as the global
 * `self.ModuleFactory`, then reads that global and clears it. Two creations in
 * flight together race on it, and the losers can end up sharing one wasm heap
 * between two different graphs. That corrupts the heap, and the symptom is a
 * later `Out of bounds memory access` from `_malloc` in whichever task happens
 * to allocate next — including one that had been working for minutes.
 */
export function createVisionTask<T>(
  create: (fileset: VisionFileset) => Promise<T>,
): Promise<T> {
  const run = creationQueue.then(async () => create(await visionFileset()));
  // A failed creation must not poison the queue for the next task.
  creationQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** VIDEO mode rejects a timestamp that is not strictly greater than the last. */
export function nextVideoTimestamp(lastMs: number, nowMs: number): number {
  return nowMs > lastMs ? nowMs : lastMs + 1;
}

export function isWasmFault(error: unknown): boolean {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  return (
    name === "RuntimeError" ||
    message.includes("Out of bounds memory access") ||
    message.includes("_waitUntilIdle") ||
    message.includes("_malloc")
  );
}
