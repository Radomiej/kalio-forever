import { Search, Trash2, Workflow } from 'lucide-react';
import type { ArchitectSchema } from './architect.types';

interface ArchitectRegistryPanelProps {
  schemas: ArchitectSchema[];
  selectedSchemaId: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onSelectSchema: (schemaId: string) => void;
  deletingSchemaId: string | null;
  onDeleteSchema: (schemaId: string) => void;
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
}: ArchitectRegistryPanelProps) {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredSchemas = schemas.filter((schema) => schemaMatchesQuery(schema, normalizedQuery));

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-base-300/80 bg-base-100/95">
      <div className="border-b border-base-300/80 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-base-content/70">
          <span className="flex items-center gap-2">
            <Workflow size={14} className="text-sky-400" />
            Presets
          </span>
          <span className="text-[11px] normal-case tracking-normal text-base-content/45" data-testid="architect-registry-count">
            {filteredSchemas.length}/{schemas.length}
          </span>
        </div>
        <label className="input input-bordered input-sm mt-2 flex h-8 min-h-8 items-center gap-2 bg-base-200/60">
          <Search size={14} className="text-base-content/40" />
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
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
              className={`group flex w-full items-start gap-1 px-3 py-2 transition-colors ${
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
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-semibold">{schema.name}</span>
                  <span className="badge badge-ghost badge-xs shrink-0">{schema.nodes.length}</span>
                </div>
                {schema.description && (
                  <p className="mt-0.5 text-[11px] leading-snug text-base-content/45">
                    {schema.description}
                  </p>
                )}
              </button>
              {isVariantSchema(schema.id) && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs mt-0.5 h-6 min-h-6 w-6 p-0 text-base-content/40 hover:text-error"
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
          <p className="px-4 py-6 text-center text-xs text-base-content/40">
            No schemas match this filter.
          </p>
        )}
      </div>
    </aside>
  );
}
