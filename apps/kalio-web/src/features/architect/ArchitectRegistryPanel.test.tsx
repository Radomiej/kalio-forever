import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ArchitectRegistryPanel } from './ArchitectRegistryPanel';
import type { ArchitectSchema } from './architect.types';

const schemas: ArchitectSchema[] = [
  {
    id: 'strategic-decision-council',
    name: 'Strategic Decision Council',
    description: 'Decision preset',
    version: '1',
    roleSlots: [],
    nodes: [],
    edges: [],
    routerPolicy: {
      mode: 'rank_then_merge',
      mustAddressCriticFindings: false,
      canReturnNeedsMoreResearch: false,
    },
    contextPolicy: {
      includeUserTask: true,
      includeProjectMemory: false,
      includeBrowserSession: false,
      includePriorDecisions: false,
    },
    memoryPolicy: {
      persistFinalArtifact: false,
      persistRouterDecision: false,
    },
    outputArtifactSchema: 'Artifact',
  },
];

describe('ArchitectRegistryPanel', () => {
  it('exposes preset search with an accessible name', () => {
    render(
      <ArchitectRegistryPanel
        deletingSchemaId={null}
        onDeleteSchema={vi.fn()}
        onQueryChange={vi.fn()}
        onSelectSchema={vi.fn()}
        query=""
        schemas={schemas}
        selectedSchemaId={null}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Search architecture presets' })).toBeInTheDocument();
  });

  it('keeps preset descriptions behind a help tooltip instead of rendering list paragraphs', () => {
    render(
      <ArchitectRegistryPanel
        deletingSchemaId={null}
        onDeleteSchema={vi.fn()}
        onQueryChange={vi.fn()}
        onSelectSchema={vi.fn()}
        query=""
        schemas={schemas}
        selectedSchemaId="strategic-decision-council"
      />,
    );

    expect(screen.getByTestId('architect-schema-description-strategic-decision-council')).toHaveAttribute(
      'aria-label',
      'Preset description: Decision preset',
    );
    expect(screen.getByTestId('architect-schema-strategic-decision-council')).not.toHaveTextContent('Decision preset');
  });

  it('collapses presets to a narrow restore control', () => {
    const onCollapsedChange = vi.fn();
    render(
      <ArchitectRegistryPanel
        collapsed
        deletingSchemaId={null}
        onCollapsedChange={onCollapsedChange}
        onDeleteSchema={vi.fn()}
        onQueryChange={vi.fn()}
        onSelectSchema={vi.fn()}
        query=""
        schemas={schemas}
        selectedSchemaId={null}
      />,
    );

    expect(screen.getByTestId('architect-registry-panel')).toHaveAttribute('data-collapsed', 'true');
    expect(screen.queryByRole('textbox', { name: 'Search architecture presets' })).toBeNull();

    screen.getByTestId('architect-registry-expand').click();

    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it('exposes a collapse action when visibility is controlled by the page', () => {
    const onCollapsedChange = vi.fn();
    render(
      <ArchitectRegistryPanel
        deletingSchemaId={null}
        onCollapsedChange={onCollapsedChange}
        onDeleteSchema={vi.fn()}
        onQueryChange={vi.fn()}
        onSelectSchema={vi.fn()}
        query=""
        schemas={schemas}
        selectedSchemaId={null}
      />,
    );

    screen.getByTestId('architect-registry-collapse').click();

    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });
});
