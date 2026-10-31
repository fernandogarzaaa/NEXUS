import { DEMO_SEED } from "./seed";
import { InMemoryStateRepository, type StateRepository } from "./repository";
import type { NexusState } from "./state";

export type { NexusState } from "./state";

// Facade over the active StateRepository (see lib/domain/repository.ts).
// Everything else in lib/ keeps calling getState()/resetState() exactly as
// before; which backend sits behind them is decided once, here. `globalThis`
// caching keeps a single repository instance across Next.js dev-mode module
// reloads, which is what kept the original single-object store stable.

declare global {
  var __NEXUS_REPOSITORY__: StateRepository | undefined;
}

export function createDefaultRepository(): StateRepository {
  return new InMemoryStateRepository();
}

export function getRepository(): StateRepository {
  if (!globalThis.__NEXUS_REPOSITORY__) {
    globalThis.__NEXUS_REPOSITORY__ = createDefaultRepository();
  }
  return globalThis.__NEXUS_REPOSITORY__;
}

/** Swap the active repository (tests, or process start-up wiring). */
export function setRepository(repository: StateRepository): StateRepository {
  globalThis.__NEXUS_REPOSITORY__ = repository;
  return repository;
}

export function getState(): NexusState {
  return getRepository().getState();
}

export function resetState(seed: number = DEMO_SEED): NexusState {
  return getRepository().resetState(seed);
}

/** Hydrate the working set from the active backend (no-op in memory). */
export function loadState(): Promise<NexusState> {
  return getRepository().load();
}

/** Flush the working set to the active backend (no-op in memory). */
export function persistState(): Promise<void> {
  return getRepository().persist();
}

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
