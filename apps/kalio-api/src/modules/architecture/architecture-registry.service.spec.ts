import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ArchitectureSchema } from '@kalio/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LAB_PRESET_IDS } from './architecture-seed-schemas.lab-presets';
import { ArchitectureRegistryService } from './architecture-registry.service';

describe('ArchitectureRegistryService', () => {
  const tempDirs = new Set<string>();

  afterEach(async () => {
    await Promise.all([...tempDirs].map((dirPath) => rm(dirPath, { recursive: true, force: true })));
    tempDirs.clear();
  });

  it('returns the seeded architecture schemas', () => {
    const service = new ArchitectureRegistryService();

    const schemas = service.findAll();

    expect(schemas.map((schema) => schema.id)).toEqual([
      'strategic-decision-council',
      'five-minds-council',
      'five-minds-strategic',
      'goal-master-delivery-loop',
      'deep-five-minds',
      'architecture_debate',
      'coding_review',
      'deep_research',
      'release_guard',
      ...LAB_PRESET_IDS,
    ]);

    const strategic = service.findOne('strategic-decision-council');
    expect(strategic?.roleSlots.map((slot) => slot.id)).toEqual([
      'pragmatist',
      'innovator',
      'analyst',
      'user_advocate',
      'shadow',
      'router',
      'finalizer',
    ]);
    expect(strategic?.nodes.map((node) => node.kind)).toContain('parallel');
    expect(strategic?.nodes.map((node) => node.kind)).toContain('router');
    expect(strategic?.nodes.map((node) => node.kind)).toContain('artifact');
    expect(strategic?.edges.length).toBeGreaterThan(0);

    const fiveMinds = service.findOne('five-minds-council');
    expect(fiveMinds?.roleSlots.map((slot) => slot.id)).toEqual([
      'pragmatist',
      'innovator',
      'analyst',
      'user_advocate',
      'devil_advocate',
      'synthesizer',
      'finalizer',
    ]);
    expect(fiveMinds?.nodes.map((node) => node.kind)).toContain('parallel');
    expect(fiveMinds?.nodes.map((node) => node.kind)).toContain('router');
    expect(fiveMinds?.nodes.map((node) => node.kind)).toContain('artifact');
    expect(fiveMinds?.edges.length).toBeGreaterThan(0);

    const strategicFiveMinds = service.findOne('five-minds-strategic');
    expect(strategicFiveMinds?.roleSlots.map((slot) => slot.id)).toEqual([
      'tech_researcher',
      'ux_researcher',
      'docs_researcher',
      'pragmatist',
      'innovator',
      'analyst',
      'user_advocate',
      'devil_advocate',
      'synthesizer',
      'decision_presenter',
      'finalizer',
    ]);
    expect(strategicFiveMinds?.nodes.filter((node) => node.kind === 'parallel').map((node) => node.id)).toEqual([
      'research-fanout',
      'five-minds-debate',
    ]);
    expect(strategicFiveMinds?.edges.map((edge) => `${edge.fromNodeId}->${edge.toNodeId}`)).toContain(
      'decision-presenter->final-artifact',
    );

    const goalMaster = service.findOne('goal-master-delivery-loop');
    expect(goalMaster?.roleSlots.map((slot) => slot.id)).toEqual([
      'orchestrator',
      'implementer',
      'verifier',
      'tester',
      'goal_master',
      'finalizer',
    ]);
    expect(goalMaster?.edges.map((edge) => `${edge.fromNodeId}->${edge.toNodeId}`)).toEqual([
      'orchestrator->implementer',
      'implementer->verifier',
      'verifier->tester',
      'tester->goal-master',
      'goal-master->final-artifact',
      'goal-master->implementer',
    ]);

    const deepFiveMinds = service.findOne('deep-five-minds');
    expect(deepFiveMinds?.roleSlots.length).toBe(19);
    expect(deepFiveMinds?.nodes.filter((node) => node.kind === 'parallel').map((node) => node.id)).toEqual([
      'research-swarm',
      'five-minds-debate',
      'delivery-pod',
    ]);
    expect(deepFiveMinds?.edges.map((edge) => `${edge.fromNodeId}->${edge.toNodeId}`)).toContain('goal-master->delivery-pod');
    expect(deepFiveMinds?.contextPolicy.perSlotOverrides?.goal_master?.contextCompression).toBe('evidence_only');

    const labPresetIds = ['architecture_debate', 'coding_review', 'deep_research', 'release_guard'];
    for (const schemaId of labPresetIds) {
      const schema = service.findOne(schemaId);
      expect(schema?.roleSlots.length).toBeGreaterThan(0);
      expect(schema?.edges.length).toBeGreaterThan(0);
      expect(schema?.roleSlots.some((slot) => slot.defaultPersonaId.startsWith('agent-'))).toBe(true);
    }

    const labQuickFix = service.findOne('lab_quick_fix');
    expect(labQuickFix?.description).toContain('Agent-Architecture-Lab preset quick_fix');
    expect(labQuickFix?.roleSlots.map((slot) => slot.defaultPersonaId)).toEqual(expect.arrayContaining([
      'lab-orchestrator',
      'lab-backend',
      'lab-qa_quality',
    ]));
    expect(labQuickFix?.nodes.map((node) => node.id)).toEqual(expect.arrayContaining([
      'orchestrator-0',
      'backend-1',
      'qa_quality-2',
      'final-artifact',
    ]));
    expect(labQuickFix?.edges.map((edge) => `${edge.fromNodeId}->${edge.toNodeId}`)).toEqual(expect.arrayContaining([
      'orchestrator-0->backend-1',
      'backend-1->qa_quality-2',
      'qa_quality-2->orchestrator-0',
    ]));

    for (const schemaId of LAB_PRESET_IDS) {
      const schema = service.findOne(schemaId);
      expect(schema?.roleSlots.every((slot) => slot.defaultPersonaId.startsWith('lab-'))).toBe(true);
    }
  });

  it('documents the Goal Master delivery loop as an executor/verifier graph with CLI child-agent delegation', () => {
    const service = new ArchitectureRegistryService();
    const schema = service.findOne('goal-master-delivery-loop');
    if (!schema) throw new Error('Expected Goal Master schema');
    const slotsById = new Map(schema.roleSlots.map((slot) => [slot.id, slot]));

    expect(slotsById.get('orchestrator')?.description).toMatch(/sub-?agents?.*CLI|CLI.*sub-?agents?/i);
    expect(slotsById.get('orchestrator')?.defaultPersonaId).toBe('agent-orchestrator');
    expect(slotsById.get('implementer')?.defaultPersonaId).toBe('agent-implementer');
    expect(slotsById.get('implementer')?.description).toMatch(/CLI child/i);
    expect(slotsById.get('implementer')?.slotType).toBe('tool_executor');
    expect(slotsById.get('verifier')?.description).toMatch(/CLI child/i);
    expect(slotsById.get('verifier')?.defaultPersonaId).toBe('agent-qa');
    expect(slotsById.get('goal_master')?.description).toMatch(/routes back/i);
    expect(slotsById.get('goal_master')?.defaultPersonaId).toBe('agent-release-guard');
    expect(schema.contextPolicy.perSlotOverrides?.goal_master).toMatchObject({
      includeOtherAgentOutputs: true,
      includeToolResults: true,
      contextCompression: 'evidence_only',
    });
  });

  it('resolves goal_guard_delivery_loop as the two-agent Goal Guard flow alias', () => {
    const service = new ArchitectureRegistryService();

    const schema = service.findOne('goal_guard_delivery_loop');

    expect(schema?.id).toBe('goal-master-delivery-loop');
    expect(schema?.name).toContain('Goal Master');
    expect(schema?.nodes.map((node) => node.label)).toEqual(expect.arrayContaining([
      'Implementer',
      'Goal Master',
    ]));
    expect(schema?.edges.map((edge) => `${edge.fromNodeId}->${edge.toNodeId}`)).toContain('goal-master->implementer');
    expect(schema?.id).not.toContain('five-minds');
  });

  it('finds a schema by id and returns null for missing schemas', () => {
    const service = new ArchitectureRegistryService();

    expect(service.findOne('strategic-decision-council')?.name).toBe('Strategic Decision Council');
    expect(service.findOne('missing')).toBeNull();
  });

  it('creates versioned schema variants with persona and node kind overrides', async () => {
    const registryPath = await makeTempRegistryPath(tempDirs);
    const service = new ArchitectureRegistryService(makeConfig(registryPath));
    const baseSchema = serviceSeed();

    const variant = await service.createVariant('strategic-decision-council', {
      name: 'Security-heavy council',
      roleSlotPersonaOverrides: {
        shadow: 'persona.security_shadow',
        router: 'persona.security_router',
      },
      nodeKindOverrides: {
        router: 'artifact',
      },
      contextPolicy: {
        ...serviceSeed().contextPolicy,
        perSlotOverrides: {
          shadow: {
            includeOtherAgentOutputs: false,
            contextCompression: 'evidence_only',
          },
        },
      },
    });
    const baseAfter = service.findOne('strategic-decision-council');

    expect(variant?.id).toBe('strategic-decision-council-variant-1');
    expect(variant?.name).toBe('Security-heavy council');
    expect(variant?.version).toBe('0.1.0+variant.1');
    expect(variant?.roleSlots.find((slot) => slot.id === 'shadow')?.defaultPersonaId).toBe('persona.security_shadow');
    expect(variant?.roleSlots.find((slot) => slot.id === 'router')?.defaultPersonaId).toBe('persona.security_router');
    expect(variant?.nodes.find((node) => node.id === 'router')?.kind).toBe('artifact');
    expect(variant?.contextPolicy.perSlotOverrides?.shadow).toEqual({
      includeOtherAgentOutputs: false,
      contextCompression: 'evidence_only',
    });
    expect(baseAfter?.nodes.find((node) => node.id === 'router')?.kind).toBe('router');
    expect(baseAfter?.roleSlots.find((slot) => slot.id === 'router')?.defaultPersonaId)
      .toBe(baseSchema.roleSlots.find((slot) => slot.id === 'router')?.defaultPersonaId);
    expect(baseAfter?.contextPolicy).toEqual(baseSchema.contextPolicy);
    expect(service.findAll().map((schema) => schema.id)).toEqual([
      'strategic-decision-council',
      'five-minds-council',
      'five-minds-strategic',
      'goal-master-delivery-loop',
      'deep-five-minds',
      'architecture_debate',
      'coding_review',
      'deep_research',
      'release_guard',
      ...LAB_PRESET_IDS,
      'strategic-decision-council-variant-1',
    ]);
  });

  it('creates graph topology variants with node positions, added nodes, and edges', async () => {
    const registryPath = await makeTempRegistryPath(tempDirs);
    const service = new ArchitectureRegistryService(makeConfig(registryPath));
    const base = serviceSeed();

    const nodes = [
      ...base.nodes.map((node) => (
        node.id === 'router'
          ? { ...node, x: 720, y: 260 }
          : { ...node }
      )),
      { id: 'custom-review', label: 'Custom Review', kind: 'role' as const, roleSlotId: 'analyst', x: 520, y: 420 },
    ];
    const edges = [
      ...base.edges,
      { id: 'custom-review-router', fromNodeId: 'custom-review', toNodeId: 'router' },
    ];

    const variant = await service.createVariant('strategic-decision-council', {
      name: 'Topology council',
      nodes,
      edges,
    });

    expect(variant?.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'router', x: 720, y: 260 }),
      expect.objectContaining({ id: 'custom-review', label: 'Custom Review', kind: 'role', x: 520, y: 420 }),
    ]));
    expect(variant?.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'custom-review-router', fromNodeId: 'custom-review', toNodeId: 'router' }),
    ]));
  });

  it('returns null when creating a variant from a missing schema', async () => {
    const service = new ArchitectureRegistryService();

    await expect(service.createVariant('missing', { name: 'Missing variant' })).resolves.toBeNull();
  });

  it('rejects malformed variant inputs and unknown slot overrides', async () => {
    const service = new ArchitectureRegistryService();

    await expect(service.createVariant('strategic-decision-council', {
      roleSlotPersonaOverrides: { missing: 'persona.missing' },
    })).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      name: 123,
    } as never)).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      roleSlotPersonaOverrides: { shadow: '' },
    })).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      nodeKindOverrides: { missing: 'role' },
    })).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      nodeKindOverrides: { router: 'invalid' },
    } as never)).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      nodes: [{ id: 'duplicate', label: 'A', kind: 'role' }, { id: 'duplicate', label: 'B', kind: 'router' }],
    })).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      nodes: [{ id: 'custom-role', label: 'Custom Role', kind: 'role' }],
    })).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      nodes: [{ id: 'custom-router', label: 'Custom Router', kind: 'router' }],
    })).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      nodes: [{ id: 'custom-artifact', label: 'Custom Artifact', kind: 'artifact' }],
    })).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      nodes: [{ id: 'custom', label: 'Custom', kind: 'invalid' }],
    } as never)).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      nodes: [{ id: 'custom', label: 'Custom', kind: 'role', x: Number.NaN }],
    })).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      edges: [{ id: 'bad-edge', fromNodeId: 'missing', toNodeId: 'router' }],
    })).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      edges: [{ id: 'self-loop', fromNodeId: 'router', toNodeId: 'router' }],
    })).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', {
      contextPolicy: { includeUserTask: true },
    } as never)).rejects.toThrow(BadRequestException);
    await expect(service.createVariant('strategic-decision-council', undefined as never)).rejects.toThrow(BadRequestException);
  });

  it('rejects overrides for slots that cannot be overridden', async () => {
    const registryPath = await makeTempRegistryPath(tempDirs);
    const lockedSchema: ArchitectureSchema = {
      ...serviceSeed(),
      id: 'locked-council',
      name: 'Locked Council',
      roleSlots: serviceSeed().roleSlots.map((slot) => (
        slot.id === 'router'
          ? { ...slot, canOverrideAtRunStart: false }
          : { ...slot }
      )),
    };
    await writeFile(join(registryPath, 'schemas', 'locked-council.json'), JSON.stringify(lockedSchema), 'utf8');
    const service = new ArchitectureRegistryService(makeConfig(registryPath));
    await service.onModuleInit();

    await expect(service.createVariant('locked-council', {
      roleSlotPersonaOverrides: { router: 'persona.strict_router' },
    })).rejects.toThrow(BadRequestException);
  });

  it('persists variants and reloads the next variant counter from disk', async () => {
    const registryPath = await makeTempRegistryPath(tempDirs);
    const firstService = new ArchitectureRegistryService(makeConfig(registryPath));
    await firstService.onModuleInit();

    const variant = await firstService.createVariant('strategic-decision-council', {
      name: 'Persistent council',
      roleSlotPersonaOverrides: { shadow: 'persona.security_shadow' },
      nodeKindOverrides: { router: 'artifact' },
    });

    expect(variant?.id).toBe('strategic-decision-council-variant-1');
    const raw = await readFile(
      join(registryPath, 'schemas', 'strategic-decision-council-variant-1.json'),
      'utf8',
    );
    expect(JSON.parse(raw)).toMatchObject({
      id: 'strategic-decision-council-variant-1',
      nodes: expect.arrayContaining([
        expect.objectContaining({ id: 'router', kind: 'artifact' }),
      ]),
    });

    const reloadedService = new ArchitectureRegistryService(makeConfig(registryPath));
    await reloadedService.onModuleInit();

    expect(reloadedService.findOne('strategic-decision-council-variant-1')?.name).toBe('Persistent council');
    expect(reloadedService.findOne('strategic-decision-council-variant-1')?.nodes.find((node) => node.id === 'router')?.kind).toBe('artifact');

    const secondVariant = await reloadedService.createVariant('strategic-decision-council', {
      name: 'Second persistent council',
      roleSlotPersonaOverrides: { router: 'persona.security_router' },
    });

    expect(secondVariant?.id).toBe('strategic-decision-council-variant-2');
  });

  it('serializes concurrent variant writes so ids and files stay unique', async () => {
    const registryPath = await makeTempRegistryPath(tempDirs);
    const service = new ArchitectureRegistryService(makeConfig(registryPath));
    await service.onModuleInit();

    const variants = await Promise.all([
      service.createVariant('strategic-decision-council', {
        name: 'Concurrent shadow council',
        roleSlotPersonaOverrides: { shadow: 'persona.security_shadow' },
      }),
      service.createVariant('strategic-decision-council', {
        name: 'Concurrent router council',
        roleSlotPersonaOverrides: { router: 'persona.security_router' },
      }),
    ]);

    expect(variants.map((variant) => variant?.id).sort()).toEqual([
      'strategic-decision-council-variant-1',
      'strategic-decision-council-variant-2',
    ]);
    await expect(readFile(join(registryPath, 'schemas', 'strategic-decision-council-variant-1.json'), 'utf8')).resolves.toContain(
      'strategic-decision-council-variant-1',
    );
    await expect(readFile(join(registryPath, 'schemas', 'strategic-decision-council-variant-2.json'), 'utf8')).resolves.toContain(
      'strategic-decision-council-variant-2',
    );
  });

  it('continues a variant write queue after a previous queued promise rejects', async () => {
    const registryPath = await makeTempRegistryPath(tempDirs);
    const service = new ArchitectureRegistryService(makeConfig(registryPath));
    const internals = service as unknown as {
      variantWriteQueues: Map<string, Promise<void>>;
      logger: { warn: (message: string, error: unknown) => void };
    };
    const warnSpy = vi.spyOn(internals.logger, 'warn').mockImplementation(() => undefined);
    internals.variantWriteQueues.set('strategic-decision-council', Promise.reject(new Error('previous write failed')));

    const variant = await service.createVariant('strategic-decision-council', {
      name: 'Recovered queue council',
    });

    expect(variant?.id).toBe('strategic-decision-council-variant-1');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Previous architecture variant write failed'),
      expect.any(Error),
    );
  });

  it('ignores malformed persisted schema files while loading valid variants', async () => {
    const registryPath = await makeTempRegistryPath(tempDirs);
    const validSchema: ArchitectureSchema = {
      ...serviceSeed(),
      id: 'strategic-decision-council-variant-7',
      name: 'Loaded valid council',
      version: '0.1.0+variant.7',
    };
    await writeFile(join(registryPath, 'schemas', 'invalid.json'), '{', 'utf8');
    await writeFile(
      join(registryPath, 'schemas', 'strategic-decision-council-variant-7.json'),
      JSON.stringify(validSchema),
      'utf8',
    );

    const service = new ArchitectureRegistryService(makeConfig(registryPath));
    await service.onModuleInit();

    expect(service.findOne('strategic-decision-council-variant-7')?.name).toBe('Loaded valid council');
    const nextVariant = await service.createVariant('strategic-decision-council', {
      roleSlotPersonaOverrides: { shadow: 'persona.security_shadow' },
    });
    expect(nextVariant?.id).toBe('strategic-decision-council-variant-8');
  });

  it('deletes persisted variants from memory and disk without deleting base schemas', async () => {
    const registryPath = await makeTempRegistryPath(tempDirs);
    const service = new ArchitectureRegistryService(makeConfig(registryPath));
    await service.onModuleInit();

    const variant = await service.createVariant('strategic-decision-council', {
      name: 'Temporary variant',
      roleSlotPersonaOverrides: { shadow: 'persona.security_shadow' },
    });
    const filePath = join(registryPath, 'schemas', 'strategic-decision-council-variant-1.json');

    expect(variant?.id).toBe('strategic-decision-council-variant-1');
    await expect(access(filePath)).resolves.toBeUndefined();

    await expect(service.removeVariant('strategic-decision-council')).rejects.toThrow(BadRequestException);
    await expect(service.removeVariant('missing')).resolves.toBe(false);
    await expect(service.removeVariant('strategic-decision-council-variant-1')).resolves.toBe(true);

    expect(service.findOne('strategic-decision-council')).not.toBeNull();
    expect(service.findOne('strategic-decision-council-variant-1')).toBeNull();
    await expect(access(filePath)).rejects.toThrow();
  });
});

async function makeTempRegistryPath(tempDirs: Set<string>): Promise<string> {
  const dirPath = await mkdtemp(join(tmpdir(), 'kalio-architecture-registry-'));
  tempDirs.add(dirPath);
  await mkdir(join(dirPath, 'schemas'), { recursive: true });
  return dirPath;
}

function makeConfig(registryPath: string): ConfigService {
  return {
    get: (key: string, defaultValue?: string) => (key === 'ARCHITECTURE_REGISTRY_PATH' ? registryPath : defaultValue),
  } as ConfigService;
}

function serviceSeed(): ArchitectureSchema {
  const service = new ArchitectureRegistryService();
  const schema = service.findOne('strategic-decision-council');
  if (!schema) {
    throw new Error('Expected seeded schema');
  }
  return schema;
}
