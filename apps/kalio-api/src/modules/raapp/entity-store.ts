// ─── Entity / Component types ─────────────────────────────────────────────────

export interface ComponentDefinition {
  name: string;
  fields: Record<string, { type: string; default?: unknown }>;
}

export interface Entity {
  id: string;
  components: Record<string, Record<string, unknown>>;
}

export type GlobalState = Record<string, unknown>;

// ─── EntityStore ─────────────────────────────────────────────────────────────

/**
 * Per-execution Entity-Component System (ECS) state container.
 *
 * Not an @Injectable — instantiate with `new EntityStore()` for each
 * RA-App execution so state never leaks between runs.
 *
 * Ported from ra-kingdom-stack/kalio-backend/src/core/EntityStore.ts
 */
export class EntityStore {
  private readonly entities = new Map<string, Entity>();
  private globals: GlobalState = {};

  // ─── Globals ──────────────────────────────────────────────────────────────

  /**
   * Initialise globals from a `components.yml` definition block.
   * Each key gets its declared `default` value (or `null` if absent).
   */
  initGlobals(definitions: Record<string, { type: string; default?: unknown }>): void {
    for (const [key, def] of Object.entries(definitions)) {
      this.globals[key] = def.default ?? null;
    }
  }

  setGlobal(key: string, value: unknown): void {
    this.globals[key] = value;
  }

  /**
   * Set a value at a dot-path, creating intermediate objects as needed.
   * e.g. `setGlobalPath('player.inventory.slot_0', sword)`.
   */
  setGlobalPath(dotPath: string, value: unknown): void {
    const parts = dotPath.split('.');
    if (parts.length === 1) {
      this.globals[dotPath] = value;
      return;
    }
    const root = parts[0];
    if (this.globals[root] === null || typeof this.globals[root] !== 'object') {
      this.globals[root] = {};
    }
    let obj = this.globals[root] as Record<string, unknown>;
    for (let i = 1; i < parts.length - 1; i++) {
      const part = parts[i];
      if (obj[part] === null || typeof obj[part] !== 'object') {
        obj[part] = {};
      }
      obj = obj[part] as Record<string, unknown>;
    }
    obj[parts[parts.length - 1]] = value;
  }

  getGlobal(key: string): unknown {
    return this.globals[key];
  }

  getGlobals(): GlobalState {
    return { ...this.globals };
  }

  // ─── Entities ─────────────────────────────────────────────────────────────

  createEntity(id: string): Entity {
    const entity: Entity = { id, components: {} };
    this.entities.set(id, entity);
    return entity;
  }

  getEntity(id: string): Entity | undefined {
    return this.entities.get(id);
  }

  getAllEntities(): Entity[] {
    return Array.from(this.entities.values());
  }

  deleteEntity(id: string): boolean {
    return this.entities.delete(id);
  }

  // ─── Components ───────────────────────────────────────────────────────────

  setComponentField(entityId: string, component: string, field: string, value: unknown): void {
    const entity = this.entities.get(entityId);
    if (!entity) throw new Error(`Entity not found: ${entityId}`);
    if (!entity.components[component]) entity.components[component] = {};
    entity.components[component][field] = value;
  }

  getComponentField(entityId: string, component: string, field: string): unknown {
    return this.entities.get(entityId)?.components[component]?.[field];
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  /**
   * Return all entities that have **all** of the specified component names.
   * All-or-nothing matching — an entity missing even one component is excluded.
   */
  queryEntities(requiredComponents: string[]): Entity[] {
    return this.getAllEntities().filter((e) =>
      requiredComponents.every((c) => c in e.components),
    );
  }

  // ─── Snapshot ─────────────────────────────────────────────────────────────

  getSnapshot(): { globals: GlobalState; entities: Entity[] } {
    return {
      globals: this.getGlobals(),
      entities: this.getAllEntities(),
    };
  }

  reset(): void {
    this.entities.clear();
    this.globals = {};
  }
}
