import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import vm from 'node:vm';
import { ConfigService } from '@nestjs/config';
import { EffectsProcessorService } from './effects-processor.service';
import { NativeSystemRegistry } from './native/native-system-registry.service';
import { AuditService } from '../chat/audit.service';
import type { NativeSessionContext } from './native/native-system-registry.service';

const makeAuditService = () => ({
  log: vi.fn().mockResolvedValue(undefined),
});

async function createEffectsProcessorFixture(timeoutMs = 1000) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EffectsProcessorService,
      NativeSystemRegistry,
      { provide: AuditService, useFactory: makeAuditService },
      { provide: ConfigService, useValue: { get: vi.fn().mockReturnValue(timeoutMs) } },
    ],
  }).compile();

  return {
    service: module.get(EffectsProcessorService),
    registry: module.get(NativeSystemRegistry),
    audit: module.get(AuditService) as unknown as ReturnType<typeof makeAuditService>,
  };
}

describe('EffectsProcessorService', () => {
  let service: EffectsProcessorService;
  let registry: NativeSystemRegistry;
  let audit: ReturnType<typeof makeAuditService>;
  const ctx: NativeSessionContext = { sessionId: 'sess-123' };

  beforeEach(async () => {
    ({ service, registry, audit } = await createEffectsProcessorFixture());
  });

  describe('empty / null systems.yml', () => {
    it('returns empty output for empty YAML string', async () => {
      const { output, pendingApprovals } = await service.processSystemsYaml('', {}, ctx);
      expect(output).toEqual({});
      expect(pendingApprovals).toHaveLength(0);
    });

    it('returns empty output for YAML with no systems key', async () => {
      const { output } = await service.processSystemsYaml('other_key: 1', {}, ctx);
      expect(output).toEqual({});
    });

    it('handles YAML with empty systems array', async () => {
      const { output, pendingApprovals } = await service.processSystemsYaml('systems: []', {}, ctx);
      expect(output).toEqual({});
      expect(pendingApprovals).toHaveLength(0);
    });
  });

  describe('assign effect', () => {
    it('evaluates an expression and stores result in output', async () => {
      const yaml = `
systems:
  - id: s1
    effects:
      - assign:
          target: output.result
          expression: "input.value * 2"
`;
      const { output } = await service.processSystemsYaml(yaml, { value: 5 }, ctx);
      expect(output['result']).toBe(10);
    });

    it('stores undefined for a failing expression (no throw)', async () => {
      const yaml = `
systems:
  - id: s1
    effects:
      - assign:
          target: output.result
          expression: "input.nonexistent.deep.thing"
`;
      const { output } = await service.processSystemsYaml(yaml, {}, ctx);
      // Should not throw — result is undefined
      expect(output['result']).toBeUndefined();
    });

    it('uses VM timeout from config', async () => {
      const timedFixture = await createEffectsProcessorFixture(7);
      const runSpy = vi.spyOn(vm, 'runInContext');
      const yaml = `
systems:
  - id: s1
    effects:
      - assign:
          target: output.result
          expression: "1 + 1"
`;

      try {
        await timedFixture.service.processSystemsYaml(yaml, {}, ctx);

        expect(runSpy).toHaveBeenCalledWith(
          '__result = (1 + 1)',
          expect.any(Object),
          expect.objectContaining({ timeout: 7 }),
        );
      } finally {
        runSpy.mockRestore();
      }
    });

    it('caps oversized VM timeouts from config to a safe maximum', async () => {
      const timedFixture = await createEffectsProcessorFixture(999_999_999);
      const runSpy = vi.spyOn(vm, 'runInContext');
      const yaml = `
systems:
  - id: s1
    effects:
      - assign:
          target: output.result
          expression: "1 + 1"
`;

      try {
        await timedFixture.service.processSystemsYaml(yaml, {}, ctx);

        expect(runSpy).toHaveBeenCalledWith(
          '__result = (1 + 1)',
          expect.any(Object),
          expect.objectContaining({ timeout: 30_000 }),
        );
      } finally {
        runSpy.mockRestore();
      }
    });
  });

  describe('set effect', () => {
    it('sets a literal value', async () => {
      const yaml = `
systems:
  - id: s1
    effects:
      - type: set
        target: output.greeting
        value: hello
`;
      const { output } = await service.processSystemsYaml(yaml, {}, ctx);
      expect(output['greeting']).toBe('hello');
    });

    it('sets nested path', async () => {
      const yaml = `
systems:
  - id: s1
    effects:
      - type: set
        target: output.a.b
        value: 42
`;
      const { output } = await service.processSystemsYaml(yaml, {}, ctx);
      expect((output['a'] as Record<string, unknown>)['b']).toBe(42);
    });
  });

  describe('if effect', () => {
    it('executes then-branch when condition is truthy', async () => {
      const yaml = `
systems:
  - id: s1
    effects:
      - if:
          condition: "input.x > 5"
          then:
            - type: set
              target: output.branch
              value: "then"
          else:
            - type: set
              target: output.branch
              value: "else"
`;
      const { output } = await service.processSystemsYaml(yaml, { x: 10 }, ctx);
      expect(output['branch']).toBe('then');
    });

    it('executes else-branch when condition is falsy', async () => {
      const yaml = `
systems:
  - id: s1
    effects:
      - if:
          condition: "input.x > 5"
          then:
            - type: set
              target: output.branch
              value: "then"
          else:
            - type: set
              target: output.branch
              value: "else"
`;
      const { output } = await service.processSystemsYaml(yaml, { x: 3 }, ctx);
      expect(output['branch']).toBe('else');
    });

    it('skips else when not provided and condition is falsy', async () => {
      const yaml = `
systems:
  - id: s1
    effects:
      - if:
          condition: "false"
          then:
            - type: set
              target: output.x
              value: 1
`;
      const { output } = await service.processSystemsYaml(yaml, {}, ctx);
      expect(output['x']).toBeUndefined();
    });
  });

  describe('system condition', () => {
    it('skips system when condition is falsy', async () => {
      const yaml = `
systems:
  - id: s1
    condition: "input.enabled"
    effects:
      - type: set
        target: output.ran
        value: true
`;
      const { output } = await service.processSystemsYaml(yaml, { enabled: false }, ctx);
      expect(output['ran']).toBeUndefined();
    });

    it('runs system when condition is truthy', async () => {
      const yaml = `
systems:
  - id: s1
    condition: "input.enabled"
    effects:
      - type: set
        target: output.ran
        value: true
`;
      const { output } = await service.processSystemsYaml(yaml, { enabled: true }, ctx);
      expect(output['ran']).toBe(true);
    });
  });

  describe('call_native effect', () => {
    it('executes auto-approve system and stores result at output path', async () => {
      registry.register({
        id: 'test_echo',
        description: 'echo',
        approval_required: false,
        input_schema: {},
        handler: async (args) => ({ echoed: args['msg'] }),
      });

      const yaml = `
systems:
  - id: s1
    effects:
      - call_native:
          system: test_echo
          args:
            msg: "'hello'"
          output: output.result
`;
      const { output, pendingApprovals } = await service.processSystemsYaml(yaml, {}, ctx);
      expect(output['result']).toEqual({ echoed: 'hello' });
      expect(pendingApprovals).toHaveLength(0);
    });

    it('queues pending approval for approval_required system', async () => {
      registry.register({
        id: 'risky_op',
        description: 'dangerous write',
        approval_required: true,
        input_schema: {},
        handler: async () => ({ done: true }),
      });

      const yaml = `
systems:
  - id: s1
    effects:
      - call_native:
          system: risky_op
          args:
            path: "'some/file.txt'"
`;
      const { pendingApprovals } = await service.processSystemsYaml(yaml, {}, ctx);
      expect(pendingApprovals).toHaveLength(1);
      expect(pendingApprovals[0].system).toBe('risky_op');
      expect(pendingApprovals[0].args['path']).toBe('some/file.txt');
      expect(pendingApprovals[0].displayLabel).toBe('dangerous write');
    });

    it('stores error in output when system throws and outputPath is set', async () => {
      registry.register({
        id: 'failing_op',
        description: 'fails',
        approval_required: false,
        input_schema: {},
        handler: async () => { throw new Error('boom'); },
      });

      const yaml = `
systems:
  - id: s1
    effects:
      - call_native:
          system: failing_op
          output: output.error_result
`;
      const { output } = await service.processSystemsYaml(yaml, {}, ctx);
      expect((output['error_result'] as { error: string }).error).toBe('boom');
    });

    it('throws when system is not found', async () => {
      const yaml = `
systems:
  - id: s1
    effects:
      - call_native:
          system: totally_unknown
`;
      // system not found throws from registry.execute, error is caught and logged
      const { output } = await service.processSystemsYaml(yaml, {}, ctx);
      // No output path given — nothing stored but no throw
      expect(output).toEqual({});
    });

    it('resolves args from expressions using input context', async () => {
      const capturedArgs: Record<string, unknown> = {};
      registry.register({
        id: 'capture_args',
        description: 'capture',
        approval_required: false,
        input_schema: {},
        handler: async (args) => { Object.assign(capturedArgs, args); return {}; },
      });

      const yaml = `
systems:
  - id: s1
    effects:
      - call_native:
          system: capture_args
          args:
            x: "input.num + 1"
            literal: 42
`;
      await service.processSystemsYaml(yaml, { num: 9 }, ctx);
      expect(capturedArgs['x']).toBe(10);
      expect(capturedArgs['literal']).toBe(42);
    });

    it('logs audit entry for each call_native execution', async () => {
      registry.register({
        id: 'audit_test',
        description: 'test',
        approval_required: false,
        input_schema: {},
        handler: async () => ({}),
      });

      const yaml = `
systems:
  - id: s1
    effects:
      - call_native:
          system: audit_test
`;
      await service.processSystemsYaml(yaml, {}, ctx);
      expect(audit.log).toHaveBeenCalled();
      const call = (audit.log as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
      expect(call['sessionId']).toBe('sess-123');
      expect(call['type']).toBe('raapp_native_call');
    });
  });

  describe('unknown effect type', () => {
    it('logs debug and continues without throwing', async () => {
      const yaml = `
systems:
  - id: s1
    effects:
      - unknown_effect_key: value
      - type: set
        target: output.ok
        value: true
`;
      const { output } = await service.processSystemsYaml(yaml, {}, ctx);
      // The set effect after unknown should still execute
      expect(output['ok']).toBe(true);
    });
  });

  // ── ECS effects ─────────────────────────────────────────────────────────────

  describe('ECS — create_entity / set_field / delete_entity', () => {
    it('creates an entity and includes it in the entities snapshot', async () => {
      const yaml = `
systems:
  - id: s1
    effects:
      - create_entity:
          id: player
          components:
            stats:
              hp: 100
              attack: 15
`;
      const entityStore = new (await import('./entity-store').then((m) => m.EntityStore))();
      const { entities } = await service.processSystemsYaml(yaml, {}, ctx, entityStore);
      expect(entities).toHaveLength(1);
      expect(entities[0].id).toBe('player');
      expect(entities[0].components['stats']['hp']).toBe(100);
    });

    it('set_field updates a component field on an existing entity', async () => {
      const yaml = `
systems:
  - id: setup
    effects:
      - create_entity:
          id: dragon
          components:
            stats:
              hp: 200
  - id: damage
    effects:
      - set_field:
          entity_id: dragon
          component: stats
          field: hp
          value: 183
`;
      const entityStore = new (await import('./entity-store').then((m) => m.EntityStore))();
      const { entities } = await service.processSystemsYaml(yaml, {}, ctx, entityStore);
      const dragon = entities.find((e) => e.id === 'dragon');
      expect(dragon?.components['stats']['hp']).toBe(183);
    });

    it('delete_entity removes the entity', async () => {
      const yaml = `
systems:
  - id: setup
    effects:
      - create_entity:
          id: goblin
  - id: remove
    effects:
      - delete_entity:
          id: goblin
`;
      const entityStore = new (await import('./entity-store').then((m) => m.EntityStore))();
      const { entities } = await service.processSystemsYaml(yaml, {}, ctx, entityStore);
      expect(entities.find((e) => e.id === 'goblin')).toBeUndefined();
    });

    it('query loop runs effects once per matching entity', async () => {
      const yaml = `
systems:
  - id: setup
    effects:
      - create_entity:
          id: warrior
          components:
            combat: {}
      - create_entity:
          id: mage
          components:
            combat: {}
      - create_entity:
          id: merchant
          components:
            shop: {}
  - id: buff-fighters
    query: [combat]
    effects:
      - set_field:
          entity_id: entity_id
          component: combat
          field: buffed
          value: true
`;
      const entityStore = new (await import('./entity-store').then((m) => m.EntityStore))();
      const { entities } = await service.processSystemsYaml(yaml, {}, ctx, entityStore);
      const warrior = entities.find((e) => e.id === 'warrior');
      const mage = entities.find((e) => e.id === 'mage');
      const merchant = entities.find((e) => e.id === 'merchant');
      // warrior and mage have combat — should be buffed
      expect(warrior?.components['combat']['buffed']).toBe(true);
      expect(mage?.components['combat']['buffed']).toBe(true);
      // merchant has no combat component — query should not match
      expect(merchant?.components['combat']).toBeUndefined();
    });

    it('VM_MATH is available in expressions — floor, max, min', async () => {
      const yaml = `
systems:
  - id: s1
    effects:
      - assign:
          target: output.damage
          expression: "max(1, 15 - 8)"
      - assign:
          target: output.floored
          expression: "floor(3.9)"
`;
      const { output } = await service.processSystemsYaml(yaml, {}, ctx);
      expect(output['damage']).toBe(7);
      expect(output['floored']).toBe(3);
    });
  });
});
