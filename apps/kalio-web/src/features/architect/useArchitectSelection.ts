import { useCallback, useMemo, useState } from 'react';
import type { ArchitectSchema, PersonaOverrideMap } from './architect.types';
import { chooseInitialSchema } from './ArchitectPage.graph';

export function useArchitectSelection(schemas: ArchitectSchema[]) {
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [personaOverrides, setPersonaOverrides] = useState<PersonaOverrideMap>({});
  const selectedSchema = useMemo(
    () => schemas.find((schema) => schema.id === selectedSchemaId) ?? null,
    [schemas, selectedSchemaId],
  );
  const selectInitialSchema = useCallback((nextSchemas: ArchitectSchema[]) => {
    const id = chooseInitialSchema(nextSchemas);
    const schema = nextSchemas.find((candidate) => candidate.id === id) ?? null;
    setSelectedSchemaId(id);
    setSelectedNodeId(schema?.nodes[0]?.id ?? null);
    setSelectedSlotId(null);
    setPersonaOverrides({});
  }, []);

  const selectSchema = (schemaId: string) => {
    const schema = schemas.find((candidate) => candidate.id === schemaId) ?? null;
    setSelectedSchemaId(schemaId);
    setSelectedNodeId(schema?.nodes[0]?.id ?? null);
    setSelectedSlotId(null);
    setPersonaOverrides({});
  };

  const selectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setSelectedSlotId(null);
  };

  const setPersonaOverride = (nodeId: string, personaId: string) => {
    setPersonaOverrides((current) => {
      const next = { ...current };
      if (personaId) next[nodeId] = personaId;
      else delete next[nodeId];
      return next;
    });
  };

  return {
    selectedSchemaId,
    setSelectedSchemaId,
    selectedNodeId,
    setSelectedNodeId,
    selectedSlotId,
    setSelectedSlotId,
    personaOverrides,
    setPersonaOverrides,
    selectedSchema,
    selectInitialSchema,
    selectSchema,
    selectNode,
    setPersonaOverride,
  };
}
