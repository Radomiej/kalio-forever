import { BadRequestException } from '@nestjs/common';
import type { ArchitectureSchema, CreateArchitectureRunDto } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import {
  cloneArchitectureRuntimeSchema,
  isArchitectureRuntimeSchema,
  validateArchitectureCreateRunDto,
  validateArchitectureCreateRunSlotOverrides,
} from './architecture-runtime-schema.utils';

const validSchema: ArchitectureSchema = {
  id: 'test-schema',
  name: 'Test Schema',
  description: 'Schema used by runtime validation tests.',
  version: '0.1.0',
  roleSlots: [
    {
      id: 'router',
      label: 'Router',
      description: 'Routes work.',
      slotType: 'router',
      defaultPersonaId: 'orchestrator',
      allowedPersonaTags: [],
      required: true,
      canOverrideAtRunStart: true,
    },
    {
      id: 'finalizer',
      label: 'Finalizer',
      description: 'Finalizes output.',
      slotType: 'finalizer',
      defaultPersonaId: 'dev',
      allowedPersonaTags: [],
      required: true,
      canOverrideAtRunStart: false,
    },
  ],
  nodes: [
    {
      id: 'router-node',
      label: 'Router',
      kind: 'router',
      behavior: { mode: 'choose_one' },
    },
    {
      id: 'final-node',
      label: 'Final Artifact',
      kind: 'artifact',
      roleSlotId: 'finalizer',
      behavior: { mode: 'finalize' },
    },
  ],
  edges: [
    {
      id: 'router-to-final',
      fromNodeId: 'router-node',
      toNodeId: 'final-node',
      selection: 'default',
    },
  ],
  routerPolicy: {
    mode: 'rank_then_merge',
    mustAddressCriticFindings: true,
    canReturnNeedsMoreResearch: false,
  },
  contextPolicy: {
    includeUserTask: true,
    includeProjectMemory: false,
    includeBrowserSession: false,
    includePriorDecisions: false,
    perSlotOverrides: {
      finalizer: {
        includeToolResults: true,
        contextCompression: 'summary',
      },
    },
  },
  memoryPolicy: {
    persistFinalArtifact: true,
    persistRouterDecision: true,
  },
  outputArtifactSchema: 'markdown',
};

describe('architecture runtime schema utils', () => {
  const autoSchema = (): ArchitectureSchema => ({
    ...validSchema,
    nodes: [
      { id: 'auto', label: 'Auto', kind: 'auto_router', autoRouting: { confidenceThreshold: 0.7, instructions: 'Choose the best route.' } },
      ...validSchema.nodes.map((node) => ({ ...node })),
    ],
    edges: [
      { id: 'choice', fromNodeId: 'auto', toNodeId: 'router-node', selection: 'choice' },
      { id: 'fallback', fromNodeId: 'auto', toNodeId: 'final-node', selection: 'default' },
      ...validSchema.edges,
    ],
  });

  it('accepts auto-routing schemas and independently clones their metadata', () => {
    const schema = autoSchema();
    expect(isArchitectureRuntimeSchema(schema)).toBe(true);
    const clone = cloneArchitectureRuntimeSchema(schema);
    expect(clone.nodes[0]?.autoRouting).toEqual(schema.nodes[0]?.autoRouting);
    expect(clone.nodes[0]?.autoRouting).not.toBe(schema.nodes[0]?.autoRouting);
  });

  it.each([0, 1])('accepts threshold boundary %s and 2000 instruction characters', (threshold) => {
    const schema = autoSchema();
    schema.nodes[0]!.autoRouting = { confidenceThreshold: threshold, instructions: 'a'.repeat(2000) };
    expect(isArchitectureRuntimeSchema(schema)).toBe(true);
  });

  it('accepts multiple choices and omitted optional settings', () => {
    const schema = autoSchema();
    delete schema.nodes[0]!.autoRouting;
    schema.edges.push({ id: 'choice2', fromNodeId: 'auto', toNodeId: 'final-node', selection: 'choice' });
    expect(isArchitectureRuntimeSchema(schema)).toBe(true);
  });

  it.each([-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid threshold %s', (threshold) => {
    const schema = autoSchema();
    schema.nodes[0]!.autoRouting!.confidenceThreshold = threshold;
    expect(isArchitectureRuntimeSchema(schema)).toBe(false);
  });

  it('rejects overlong instructions, role ownership and misplaced configuration', () => {
    const schema = autoSchema();
    schema.nodes[0]!.autoRouting!.instructions = 'a'.repeat(2001);
    expect(isArchitectureRuntimeSchema(schema)).toBe(false);
    schema.nodes[0]!.autoRouting!.instructions = '';
    schema.nodes[0]!.roleSlotId = 'router';
    expect(isArchitectureRuntimeSchema(schema)).toBe(false);
    delete schema.nodes[0]!.roleSlotId;
    schema.nodes[1]!.autoRouting = schema.nodes[0]!.autoRouting;
    expect(isArchitectureRuntimeSchema(schema)).toBe(false);
  });

  it('requires choices and exactly one default, and rejects other outgoing roles', () => {
    for (const selection of [undefined, 'converge', 'continuation'] as const) {
      const schema = autoSchema();
      schema.edges[0]!.selection = selection;
      expect(isArchitectureRuntimeSchema(schema)).toBe(false);
    }
    const schema = autoSchema();
    schema.edges = schema.edges.filter((edge) => edge.id !== 'fallback');
    expect(isArchitectureRuntimeSchema(schema)).toBe(false);
    schema.edges[0]!.selection = 'default';
    expect(isArchitectureRuntimeSchema(schema)).toBe(false);
    const duplicate = autoSchema();
    duplicate.edges.push({ id: 'second-default', fromNodeId: 'auto', toNodeId: 'router-node', selection: 'default' });
    expect(isArchitectureRuntimeSchema(duplicate)).toBe(false);
  });

  it('validates and clones inline run schemas without sharing nested mutable policy objects', () => {
    const dto: CreateArchitectureRunDto = {
      schemaId: validSchema.id,
      prompt: 'Review the project architecture.',
      schema: validSchema,
      context: { projectPath: 'C:\\Projects\\Demo' },
      slotOverrides: { router: 'orchestrator' },
      executionMode: 'session_branches',
    };

    expect(validateArchitectureCreateRunDto(dto)).toBe(dto);
    expect(() => validateArchitectureCreateRunSlotOverrides(validSchema, dto.slotOverrides)).not.toThrow();

    const clone = cloneArchitectureRuntimeSchema(validSchema);
    expect(clone).toEqual(validSchema);
    expect(clone).not.toBe(validSchema);
    expect(clone.contextPolicy).not.toBe(validSchema.contextPolicy);
    expect(clone.contextPolicy.perSlotOverrides?.finalizer).not.toBe(
      validSchema.contextPolicy.perSlotOverrides?.finalizer,
    );
  });

  it('rejects malformed topology and non-overridable slot overrides', () => {
    const invalidSchema: ArchitectureSchema = {
      ...validSchema,
      edges: [
        {
          id: 'edge-to-missing-node',
          fromNodeId: 'router-node',
          toNodeId: 'missing-node',
        },
      ],
    };

    expect(() => validateArchitectureCreateRunDto({
      schemaId: invalidSchema.id,
      prompt: 'Review the project architecture.',
      schema: invalidSchema,
    })).toThrow(BadRequestException);

    expect(() => validateArchitectureCreateRunSlotOverrides(validSchema, {
      finalizer: 'dev',
    })).toThrow(BadRequestException);
  });

  it('rejects inline schemas whose nodes reference missing role slots', () => {
    const invalidSchema: ArchitectureSchema = {
      ...validSchema,
      nodes: [
        ...validSchema.nodes,
        {
          id: 'ghost-role',
          label: 'Ghost Role',
          kind: 'role',
          roleSlotId: 'missing-slot',
        },
      ],
      edges: [
        ...validSchema.edges,
        {
          id: 'router-to-ghost-role',
          fromNodeId: 'router-node',
          toNodeId: 'ghost-role',
        },
      ],
    };

    expect(() => validateArchitectureCreateRunDto({
      schemaId: invalidSchema.id,
      prompt: 'Review the project architecture.',
      schema: invalidSchema,
    })).toThrow(BadRequestException);
  });

  it('rejects invalid inline schema node behavior and topology contracts', () => {
    const cases: Array<[string, ArchitectureSchema]> = [
      [
        'role node with router behavior',
        {
          ...validSchema,
          nodes: [
            ...validSchema.nodes,
            {
              id: 'role-with-behavior',
              label: 'Role With Behavior',
              kind: 'role',
              roleSlotId: 'finalizer',
              behavior: { mode: 'rank_then_merge' },
            },
          ],
        },
      ],
      [
        'artifact node with routing behavior',
        {
          ...validSchema,
          nodes: validSchema.nodes.map((node) => (
            node.id === 'final-node'
              ? { ...node, behavior: { mode: 'choose_one' } }
              : node
          )),
        },
      ],
      [
        'router node with finalize behavior',
        {
          ...validSchema,
          nodes: validSchema.nodes.map((node) => (
            node.id === 'router-node'
              ? { ...node, behavior: { mode: 'finalize' } }
              : node
          )),
        },
      ],
      [
        'duplicate node id',
        {
          ...validSchema,
          nodes: [
            ...validSchema.nodes,
            { id: 'router-node', label: 'Duplicate Router', kind: 'router' },
          ],
        },
      ],
      [
        'duplicate edge id',
        {
          ...validSchema,
          edges: [
            ...validSchema.edges,
            { ...validSchema.edges[0] },
          ],
        },
      ],
      [
        'self-loop edge',
        {
          ...validSchema,
          edges: [
            {
              id: 'router-self-loop',
              fromNodeId: 'router-node',
              toNodeId: 'router-node',
            },
          ],
        },
      ],
      [
        'duplicate role slot id',
        {
          ...validSchema,
          roleSlots: [
            ...validSchema.roleSlots,
            { ...validSchema.roleSlots[0], label: 'Duplicate Router Slot' },
          ],
        },
      ],
    ];

    for (const [name, schema] of cases) {
      expect(() => validateArchitectureCreateRunDto({
        schemaId: schema.id,
        prompt: `Review ${name}.`,
        schema,
      }), name).toThrow(BadRequestException);
    }
  });
});
