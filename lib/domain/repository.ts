import { buildState, type NexusState } from "./state";
import { DEMO_SEED } from "./seed";

// ---------------------------------------------------------------------------
// StateRepository: the seam between NEXUS's in-process working set and
// wherever that set is kept durable. The agents, the tool layer and the
// read-side queries are synchronous and operate on one NexusState; a
// repository owns that object, knows how to rebuild it from the seed, and
// (for durable backends) how to hydrate it on start and flush it after a
// mutation. The in-memory implementation below is the default and is
// behaviourally identical to the original single-object store.
// ---------------------------------------------------------------------------

export type StateBackend = "memory" | "postgres";

export interface StateRepository {
  /** Which backend this repository talks to; surfaced in health output. */
  readonly backend: StateBackend;
  /** The current working set. Synchronous: tools and agents mutate it in place. */
  getState(): NexusState;
  /** Discard the working set and rebuild it deterministically from `seed`. */
  resetState(seed?: number): NexusState;
  /**
   * Hydrate the working set from durable storage. Idempotent; a no-op for
   * the in-memory backend. Call once per request before reading or mutating.
   */
  load(): Promise<NexusState>;
  /**
   * Flush the working set to durable storage. A no-op for the in-memory
   * backend. Call after a mutation boundary (a Server Action, an API call).
   */
  persist(): Promise<void>;
}

export class InMemoryStateRepository implements StateRepository {
  readonly backend = "memory" as const;
  private state: NexusState;

  constructor(seed: number = DEMO_SEED) {
    this.state = buildState(seed);
  }

  getState(): NexusState {
    return this.state;
  }

  resetState(seed: number = DEMO_SEED): NexusState {
    this.state = buildState(seed);
    return this.state;
  }

  async load(): Promise<NexusState> {
    return this.state;
  }

  async persist(): Promise<void> {
    // Nothing to do: the working set is the storage.
  }
}
