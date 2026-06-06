import { HelpCircle, PanelLeftOpen, Search, Trash2, Workflow } from 'lucide-react';
import type { ArchitectSchema } from './architect.types';

interface ArchitectRegistryPanelProps {
  schemas: ArchitectSchema[];
  selectedSchemaId: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onSelectSchema: (schemaId: string) => void;
  deletingSchemaId: string | null;
  onDeleteSchema: (schemaId: string) => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

function schemaMatchesQuery(schema: ArchitectSchema, normalizedQuery: string): boolean {
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return true;
  }

  const haystack = `${schema.id} ${schema.name} ${schema.description ?? ''}`.toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

function isVariantSchema(schemaId: string): boolean {
  return /-variant-\d+$/.test(schemaId);
}

export function ArchitectRegistryPanel({
  schemas,
  selectedSchemaId,
  query,
  onQueryChange,
  onSelectSchema,
  deletingSchemaId,
  onDeleteSchema,
  collapsed = false,
  onCollapsedChange,
}: ArchitectRegistryPanelProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSchemas = schemas.filter((schema) => schemaMatchesQuery(schema, normalizedQuery));

  if (collapsed) {
    return (
      <aside
        className="flex h-full w-11 shrink-0 flex-col items-center border-r border-base-300/80 bg-base-100/95 py-2"
        data-testid="architect-registry-panel"
        data-collapsed="true"
      >
        <button
          type="button"
          className="btn btn-ghost btn-xs btn-square h-8 min-h-8 w-8"
          aria-label="Show presets"
          title="Show presets"
          onClick={() => onCollapsedChange?.(false)}
          data-testid="architect-registry-expand"
        >
          <Workflow size={14} className="text-sky-400" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-base-300/80 bg-base-100/95" data-testid="architect-registry-panel">
      <div className="border-b border-base-300/80 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-base-content/70">
          <span className="flex items-center gap-2">
            <Workflow size={14} className="text-sky-400" />
            Presets
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] normal-case tracking-normal text-base-content/65" data-testid="architect-registry-count">
              {filteredSchemas.length}/{schemas.length}
            </span>
            {onCollapsedChange && (
              <button
                type="button"
                className="btn btn-ghost btn-xs btn-square h-7 min-h-7 w-7"
                aria-label="Hide presets"
                title="Hide presets"
                onClick={() => onCollapsedChange(true)}
                data-testid="architect-registry-collapse"
              >
                <PanelLeftOpen size={13} />
              </button>
            )}
          </div>
        </div>
        <label className="input input-bordered input-sm mt-2 flex h-8 min-h-8 items-center gap-2 bg-base-200/60">
          <Search size={14} className="text-base-content/60" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-label="Search architecture presets"
            className="grow text-xs"
            placeholder="Search schemas"
            data-testid="architect-registry-search"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {filteredSchemas.map((schema) => {
          return (
            <div
              key={schema.id}
              className={`group flex w-full items-center gap-1 px-3 py-1.5 transition-colors ${
                selectedSchemaId === schema.id
                  ? 'bg-sky-500/10 text-sky-200'
                  : 'text-base-content/70 hover:bg-base-200/70 hover:text-base-content'
              }`}
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => onSelectSchema(schema.id)}
                data-testid={`architect-schema-${schema.id}`}
              >
                <div className="flex min-h-8 items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold">{schema.name}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {schema.description && (
                      <span
                        className="tooltip tooltip-left inline-flex h-6 w-6 items-center justify-center rounded-md text-base-content/45 hover:bg-base-200 hover:text-sky-200"
                        data-tip={schema.description}
                        aria-label={`Preset description: ${schema.description}`}
                        data-testid={`architect-schema-description-${schema.id}`}
                      >
                        <HelpCircle size={12} />
                      </span>
                    )}
                    <span className="badge badge-ghost badge-xs shrink-0">{schema.nodes.length}</span>
                  </span>
                </div>
              </button>
              {isVariantSchema(schema.id) && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs mt-0.5 h-6 min-h-6 w-6 p-0 text-base-content/60 hover:text-error"
                  onClick={() => onDeleteSchema(schema.id)}
                  disabled={deletingSchemaId === schema.id}
                  aria-label={`Delete schema ${schema.name}`}
                  data-testid={`architect-delete-schema-${schema.id}`}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}

        {filteredSchemas.length === 0 && (
          <p className="px-4 py-6 text-center text-xs text-base-content/60">
            No schemas match this filter.
          </p>
        )}
      </div>
    </aside>
  );
}
