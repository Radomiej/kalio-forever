import { describe, it, expect, beforeEach } from 'vitest';
import { EntityStore } from './entity-store';

describe('EntityStore', () => {
  let store: EntityStore;

  beforeEach(() => {
    store = new EntityStore();
  });

  // ─── Globals ──────────────────────────────────────────────────────────────

  describe('globals', () => {
    it('initGlobals sets defaults from definitions', () => {
      store.initGlobals({
        score: { type: 'number', default: 0 },
        name: { type: 'string', default: 'Hero' },
        flag: { type: 'boolean' },
      });
      expect(store.getGlobal('score')).toBe(0);
      expect(store.getGlobal('name')).toBe('Hero');
      expect(store.getGlobal('flag')).toBeNull();
    });

    it('setGlobal / getGlobal round-trips a value', () => {
      store.setGlobal('hp', 100);
      expect(store.getGlobal('hp')).toBe(100);
    });

    it('getGlobals returns a shallow copy', () => {
      store.setGlobal('x', 1);
      const snapshot = store.getGlobals();
      snapshot['x'] = 99;
      expect(store.getGlobal('x')).toBe(1); // original unchanged
    });

    describe('setGlobalPath', () => {
      it('sets top-level key', () => {
        store.setGlobalPath('result', 42);
        expect(store.getGlobal('result')).toBe(42);
      });

      it('sets nested key creating intermediate objects', () => {
        store.setGlobalPath('output.result', 7);
        expect((store.getGlobal('output') as Record<string, unknown>)['result']).toBe(7);
      });

      it('sets deeply nested key', () => {
        store.setGlobalPath('a.b.c', 'deep');
        const a = store.getGlobal('a') as Record<string, unknown>;
        const b = a['b'] as Record<string, unknown>;
        expect(b['c']).toBe('deep');
      });

      it('overwrites existing nested value', () => {
        store.setGlobalPath('output.score', 10);
        store.setGlobalPath('output.score', 20);
        const output = store.getGlobal('output') as Record<string, unknown>;
        expect(output['score']).toBe(20);
      });
    });
  });

  // ─── Entities ─────────────────────────────────────────────────────────────

  describe('entities', () => {
    it('createEntity registers an entity with empty components', () => {
      const e = store.createEntity('player');
      expect(e.id).toBe('player');
      expect(e.components).toEqual({});
      expect(store.getEntity('player')).toBe(e);
    });

    it('getAllEntities returns all created entities', () => {
      store.createEntity('a');
      store.createEntity('b');
      const all = store.getAllEntities();
      expect(all).toHaveLength(2);
      expect(all.map((e) => e.id)).toEqual(expect.arrayContaining(['a', 'b']));
    });

    it('deleteEntity removes entity and returns true', () => {
      store.createEntity('npc');
      expect(store.deleteEntity('npc')).toBe(true);
      expect(store.getEntity('npc')).toBeUndefined();
    });

    it('deleteEntity returns false for unknown entity', () => {
      expect(store.deleteEntity('ghost')).toBe(false);
    });
  });

  // ─── Components ───────────────────────────────────────────────────────────

  describe('components', () => {
    it('setComponentField initialises component and sets field', () => {
      store.createEntity('p');
      store.setComponentField('p', 'Position', 'x', 10);
      store.setComponentField('p', 'Position', 'y', 20);
      expect(store.getComponentField('p', 'Position', 'x')).toBe(10);
      expect(store.getComponentField('p', 'Position', 'y')).toBe(20);
    });

    it('setComponentField throws for unknown entity', () => {
      expect(() => store.setComponentField('nobody', 'HP', 'current', 0)).toThrow('Entity not found');
    });

    it('getComponentField returns undefined for missing component', () => {
      store.createEntity('e');
      expect(store.getComponentField('e', 'Missing', 'field')).toBeUndefined();
    });

    it('multiple components coexist on same entity', () => {
      store.createEntity('hero');
      store.setComponentField('hero', 'Health', 'max', 100);
      store.setComponentField('hero', 'Speed', 'value', 5);
      expect(store.getComponentField('hero', 'Health', 'max')).toBe(100);
      expect(store.getComponentField('hero', 'Speed', 'value')).toBe(5);
    });
  });

  // ─── Queries ──────────────────────────────────────────────────────────────

  describe('queryEntities', () => {
    beforeEach(() => {
      // hero: Position + Health
      store.createEntity('hero');
      store.setComponentField('hero', 'Position', 'x', 0);
      store.setComponentField('hero', 'Health', 'hp', 100);

      // enemy: Position + Enemy (no Health)
      store.createEntity('enemy');
      store.setComponentField('enemy', 'Position', 'x', 50);
      store.setComponentField('enemy', 'Enemy', 'damage', 10);

      // static: no components
      store.createEntity('wall');
    });

    it('returns entities with all required components', () => {
      const withPos = store.queryEntities(['Position']);
      expect(withPos.map((e) => e.id)).toEqual(expect.arrayContaining(['hero', 'enemy']));
      expect(withPos).toHaveLength(2);
    });

    it('all-or-nothing: requires ALL components', () => {
      const withPosAndHealth = store.queryEntities(['Position', 'Health']);
      expect(withPosAndHealth).toHaveLength(1);
      expect(withPosAndHealth[0].id).toBe('hero');
    });

    it('returns empty array when no entity matches', () => {
      expect(store.queryEntities(['Invisible'])).toHaveLength(0);
    });

    it('returns all entities for empty query', () => {
      expect(store.queryEntities([])).toHaveLength(3);
    });
  });

  // ─── Snapshot ─────────────────────────────────────────────────────────────

  describe('getSnapshot', () => {
    it('snapshot contains globals and entities', () => {
      store.setGlobal('turn', 1);
      store.createEntity('e1');
      store.setComponentField('e1', 'HP', 'current', 80);

      const snap = store.getSnapshot();
      expect(snap.globals['turn']).toBe(1);
      expect(snap.entities).toHaveLength(1);
      expect(snap.entities[0].id).toBe('e1');
      expect(snap.entities[0].components['HP']?.['current']).toBe(80);
    });
  });

  // ─── Reset ────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('clears entities and globals', () => {
      store.setGlobal('x', 1);
      store.createEntity('obj');
      store.reset();
      expect(store.getAllEntities()).toHaveLength(0);
      expect(store.getGlobal('x')).toBeUndefined();
    });
  });
});
