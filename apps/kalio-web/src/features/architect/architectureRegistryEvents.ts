export const ARCHITECTURE_REGISTRY_CHANGED_EVENT = 'kalio:architecture-registry-changed';

export function notifyArchitectureRegistryChanged(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.dispatchEvent(new Event(ARCHITECTURE_REGISTRY_CHANGED_EVENT));
}
