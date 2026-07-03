import { BadRequestException } from '@nestjs/common';
import type { ArchitectureSchema, CreateArchitectureRunDto } from '@kalio/types';
import { describe, expect, it } from 'vitest';
import {
  cloneArchitectureRuntimeSchema,
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
});
