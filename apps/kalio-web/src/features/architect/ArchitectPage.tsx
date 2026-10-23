import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, RefreshCw, Save } from 'lucide-react';
import {
  deleteArchitectureSchema,
  getArchitectActiveCredentialId,
  getArchitectPersonas,
  getArchitectRuntimeConfig,
  getArchitectSessions,
  getArchitectureRunResult,
  getArchitectureSchemas,
  getGoalGuardAgentFlowRunResult,
  saveArchitectureVariant,
  startGoalGuardAgentFlowRun,
  startArchitectureRun,
  stopArchitectureRun,
  stopGoalGuardAgentFlowRun,
} from './architect.api';
import { resumeAgentFlowWithQualityGate, shouldContinueAgentFlowRun } from './ArchitectPage.agentFlowResume';
import { ArchitectGraphCanvas } from './ArchitectGraphCanvas';
import { ArchitectInspector } from './ArchitectInspector';
import { ArchitectRegistryPanel } from './ArchitectRegistryPanel';
import { ArchitectRunConfig } from './ArchitectRunConfig';
import { ArchitectRunProjection } from './ArchitectRunProjection';
import { ArchitectVariantDialog } from './ArchitectVariantDialog';
import { useArchitectRunOptions } from './useArchitectRunOptions';
import type {
  ArchitectPersona,
  ArchitectProjectionTab,
  ArchitectRunResult,
  ArchitectSchema,
  ExternalQualityGateInput,
} from './architect.types';
import type { LLMConfigWithSource } from '../settings/llm-panel.types';
import { chooseInitialSchema, EMPTY_GRAPH_DRAFT, findNode, toSchemaNodes } from './ArchitectPage.graph';
import { useArchitectGraphDraft } from './useArchitectGraphDraft';
import { useSessionStore } from '../../store/sessionStore';
import { activateConversationSession } from '../chat/activeConversationSession';

const RUN_POLL_INTERVAL_MS = 1000;
export function ArchitectPage() {
  const [schemas, setSchemas] = useState<ArchitectSchema[]>([]);
  const [personas, setPersonas] = useState<ArchitectPersona[]>([]);
  const [selectedSchemaId, setSelectedSchemaId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [projectionTab, setProjectionTab] = useState<ArchitectProjectionTab>('editor');
  const [run, setRun] = useState<ArchitectRunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [savingVariant, setSavingVariant] = useState(false);
  const [deletingSchemaId, setDeletingSchemaId] = useState<string | null>(null);
  const [showVariantDialog, setShowVariantDialog] = useState(false);
  const [variantName, setVariantName] = useState('');
  const [variantDescription, setVariantDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [registryCollapsed, setRegistryCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const runOptions = useArchitectRunOptions();
  const [llmConfig, setLlmConfig] = useState<LLMConfigWithSource | null>(null);
  const [activeCredentialId, setActiveCredentialId] = useState<string | null>(null);
  const setSessions = useSessionStore((state) => state.setSessions);
  const setActiveSession = useSessionStore((state) => state.setActiveSession);

  const selectedSchema = useMemo(
    () => schemas.find((schema) => schema.id === selectedSchemaId) ?? null,
    [schemas, selectedSchemaId],
  );
  const {
    editableSchema, hasVariantChanges, hasDraftSchemaChanges,
    personaOverrides, nodeKindOverrides,
    setPersonaOverrides, setPersonaOverride, selectNode,
    setNodeKindOverrides, setContextPolicyOverrides, setGraphDraft,
    setNodeKindOverride, setNodeBehaviorOverride, setAutoRoutingOverride,
    setNodeMaxToolAttemptsOverride, setNodeToolOverride, setContextPolicyOverride,
    moveGraphNode, addGraphNode, toggleGraphEdge, setGraphEdgeSelection, autoLayoutGraph,
  } = useArchitectGraphDraft(selectedSchema, setSelectedNodeId, setSelectedSlotId);
  const selectedNode = useMemo(
    () => findNode(editableSchema, selectedNodeId),
    [editableSchema, selectedNodeId],
  );
  const selectedSlot = useMemo(
    () => selectedNode?.slots.find((slot) => slot.id === selectedSlotId) ?? null,
    [selectedNode, selectedSlotId],
  );
  const showProjectionDetails = projectionTab !== 'editor' || run !== null || running;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextSchemas, nextPersonas, nextLlmConfig, nextActiveCredentialId] = await Promise.all([
        getArchitectureSchemas(),
        getArchitectPersonas(),
        getArchitectRuntimeConfig(),
        getArchitectActiveCredentialId(),
      ]);
      setSchemas(nextSchemas);
      setPersonas(nextPersonas);
      setLlmConfig(nextLlmConfig);
      setActiveCredentialId(nextActiveCredentialId);
      const nextSchemaId = chooseInitialSchema(nextSchemas);
      setSelectedSchemaId(nextSchemaId);
      const nextSchema = nextSchemas.find((schema) => schema.id === nextSchemaId) ?? null;
      setSelectedNodeId(nextSchema?.nodes[0]?.id ?? null);
      setSelectedSlotId(null);
      setPersonaOverrides({});
      setNodeKindOverrides({});
      setContextPolicyOverrides({});
      setGraphDraft(EMPTY_GRAPH_DRAFT);
      setRun(null);
      setProjectionTab('editor');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Architect data');
    } finally {
      setLoading(false);
    }
  }, [setContextPolicyOverrides, setGraphDraft, setNodeKindOverrides, setPersonaOverrides]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectSchema = (schemaId: string) => {
    const schema = schemas.find((candidate) => candidate.id === schemaId) ?? null;
    setSelectedSchemaId(schemaId);
    setSelectedNodeId(schema?.nodes[0]?.id ?? null);
    setSelectedSlotId(null);
    setPersonaOverrides({});
    setNodeKindOverrides({});
    setContextPolicyOverrides({});
    setGraphDraft(EMPTY_GRAPH_DRAFT);
    setRun(null);
    setProjectionTab('editor');
  };

  const startRun = async () => {
    if (!selectedSchema) {
      return;
    }
    await startSelectedSchemaRun();
  };

  const stopRun = async () => {
    if (!run?.run.id) {
      setRunning(false);
      return;
    }
    try {
      const result = run.agentFlowRunId
        ? await getGoalGuardAgentFlowRunResult(await stopGoalGuardAgentFlowRun(run.agentFlowRunId), runOptions.taskPrompt, runOptions.runContext())
        : await getArchitectureRunResult(await stopArchitectureRun(run.run.id));
      setRun(result);
      await refreshConversationSessions(result.run.rootSessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop architecture run');
    } finally {
      setRunning(false);
    }
  };

  const startGoalGuardFlow = async () => {
    if (runOptions.executionProfileId) { setError('Goal Guard cannot forward an explicit execution profile yet.'); return; }
    setRunning(true);
    setError(null);
    setProjectionTab('events');
    try {
      let result = await startGoalGuardAgentFlowRun(runOptions.taskPrompt, runOptions.runContext());
      setRun(result);
      setProjectionTab('events');
      await refreshConversationSessions(result.run.rootSessionId);
      while (shouldContinueAgentFlowRun(result)) {
        await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
        result = result.agentFlowRunId
          ? await getGoalGuardAgentFlowRunResult(result.agentFlowRunId, runOptions.taskPrompt, runOptions.runContext())
          : await getArchitectureRunResult(result.run);
        setRun(result);
        await refreshConversationSessions(result.run.rootSessionId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Goal Guard AgentFlow');
    } finally {
      setRunning(false);
    }
  };

  const startSelectedSchemaRun = async () => {
    if (!selectedSchema) {
      return;
    }
    if (selectedSchema.id === 'goal-master-delivery-loop' && runOptions.executionProfileId) { setError('Goal Guard cannot forward an explicit execution profile yet.'); return; }
    setRunning(true);
    setError(null);
    setProjectionTab('events');
    try {
      let result = selectedSchema.id === 'goal-master-delivery-loop'
        ? await startGoalGuardAgentFlowRun(runOptions.taskPrompt, runOptions.runContext())
        : await startArchitectureRun(
          selectedSchema.id,
          runOptions.taskPrompt,
          personaOverrides,
          runOptions.executionMode,
          hasDraftSchemaChanges ? editableSchema ?? undefined : undefined,
          runOptions.runContext(),
          undefined, runOptions.executionProfileId || undefined,
        );
      setRun(result);
      setProjectionTab('events');
      await refreshConversationSessions(result.run.rootSessionId);
      while (shouldContinueAgentFlowRun(result)) {
        await new Promise((resolve) => setTimeout(resolve, RUN_POLL_INTERVAL_MS));
        result = result.agentFlowRunId
          ? await getGoalGuardAgentFlowRunResult(result.agentFlowRunId, runOptions.taskPrompt, runOptions.runContext())
          : await getArchitectureRunResult(result.run);
        setRun(result);
        await refreshConversationSessions(result.run.rootSessionId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start architecture run');
    } finally {
      setRunning(false);
    }
  };

  const refreshConversationSessions = useCallback(async (rootSessionId?: string) => {
    const nextSessions = await getArchitectSessions();
    setSessions(nextSessions);
    if (rootSessionId && nextSessions.some((session) => session.id === rootSessionId)) {
      void activateConversationSession({
        sessionId: rootSessionId,
        sessions: nextSessions,
        setActiveSession,
        reason: 'graph',
      });
    }
  }, [setActiveSession, setSessions]);

  const resumeAgentFlowFromQualityGate = (gate: ExternalQualityGateInput) => {
    if (!run) {
      return;
    }
    void resumeAgentFlowWithQualityGate({
      gate,
      run,
      taskPrompt: runOptions.taskPrompt,
      context: runOptions.runContext(),
      maxSteps: runOptions.maxArchitectureSteps,
      pollIntervalMs: RUN_POLL_INTERVAL_MS,
      setError,
      setProjectionTab,
      setRun,
      setRunning,
      refreshConversationSessions,
    });
  };

  const openVariantDialog = () => {
    if (!selectedSchema || !hasVariantChanges) {
      return;
    }
    setVariantName(`${selectedSchema.name} Variant`);
    setVariantDescription('');
    setShowVariantDialog(true);
  };

  const saveVariant = async () => {
    if (!selectedSchema || !hasVariantChanges) {
      return;
    }
    setSavingVariant(true);
    setError(null);
    try {
      const variant = await saveArchitectureVariant(selectedSchema.id, {
        name: variantName,
        description: variantDescription,
        roleSlotPersonaOverrides: personaOverrides,
        nodeKindOverrides,
        contextPolicy: editableSchema?.contextPolicy,
        nodes: editableSchema ? toSchemaNodes(editableSchema) : undefined,
        edges: editableSchema?.edges,
      });
      setSchemas((current) => [...current, variant]);
      setSelectedSchemaId(variant.id);
      setSelectedNodeId(
        selectedNodeId && variant.nodes.some((node) => node.id === selectedNodeId)
          ? selectedNodeId
          : variant.nodes[0]?.id ?? null,
      );
      setSelectedSlotId(null);
      setPersonaOverrides({});
      setNodeKindOverrides({});
      setContextPolicyOverrides({});
      setGraphDraft(EMPTY_GRAPH_DRAFT);
      setRun(null);
      setProjectionTab('editor');
      setShowVariantDialog(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save architecture variant');
    } finally {
      setSavingVariant(false);
    }
  };

  const deleteSchema = async (schemaId: string) => {
    if (schemaId === 'strategic-decision-council') {
      return;
    }

    setDeletingSchemaId(schemaId);
    setError(null);
    try {
      await deleteArchitectureSchema(schemaId);
      setSchemas((current) => {
        const nextSchemas = current.filter((schema) => schema.id !== schemaId);
        if (selectedSchemaId !== schemaId) {
          return nextSchemas;
        }

        const nextSchemaId = chooseInitialSchema(nextSchemas);
        const nextSchema = nextSchemas.find((schema) => schema.id === nextSchemaId) ?? null;
        setSelectedSchemaId(nextSchemaId);
        setSelectedNodeId(nextSchema?.nodes[0]?.id ?? null);
        setSelectedSlotId(null);
        setPersonaOverrides({});
        setNodeKindOverrides({});
        setContextPolicyOverrides({});
        setGraphDraft(EMPTY_GRAPH_DRAFT);
        setRun(null);
        setProjectionTab('editor');
        return nextSchemas;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete architecture schema');
    } finally {
      setDeletingSchemaId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-base-content/50" data-testid="architect-page">
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-base-100" data-testid="architect-page">
      <header className="flex min-h-12 shrink-0 items-center gap-3 border-b border-base-300 bg-base-100/95 px-4">
        <div className="min-w-0 shrink-0">
          <h1 className="truncate text-sm font-semibold text-base-content">Architect</h1>
          <p className="truncate text-[11px] text-base-content/65">
            {selectedSchema ? `Architecture Graph: ${selectedSchema.name}` : 'Architecture Graph editor'}
          </p>
        </div>
        <ArchitectRunConfig
          executionProfileId={runOptions.executionProfileId} executionProfiles={runOptions.executionProfiles}
          profilesLoading={runOptions.profilesLoading} profilesError={runOptions.profilesError} onExecutionProfileChange={runOptions.setExecutionProfileId}
          activeCredentialId={activeCredentialId}
          llmConfig={llmConfig}
          maxNodeVisits={runOptions.maxArchitectureNodeVisits}
          maxSteps={runOptions.maxArchitectureSteps}
          maxSubagentIterations={runOptions.maxArchitectureSubagentIterations}
          executionMode={runOptions.executionMode}
          projectPath={runOptions.projectPath}
          requireGoalMasterLoopProof={runOptions.requireGoalMasterLoopProof}
          requireImplementerWriteProof={runOptions.requireImplementerWriteProof}
          autoApproveProjectWrites={runOptions.autoApproveProjectWrites}
          autoApproveTerminal={runOptions.autoApproveTerminal}
          allowOrchestratorSubagents={runOptions.allowOrchestratorSubagents}
          schema={selectedSchema}
          taskPrompt={runOptions.taskPrompt}
          personaOverrides={personaOverrides}
          running={running}
          onMaxNodeVisitsChange={runOptions.setMaxArchitectureNodeVisits}
          onMaxStepsChange={runOptions.setMaxArchitectureSteps}
          onMaxSubagentIterationsChange={runOptions.setMaxArchitectureSubagentIterations}
          onExecutionModeChange={runOptions.setExecutionMode}
          onProjectPathChange={runOptions.setProjectPath}
          onRequireGoalMasterLoopProofChange={runOptions.setRequireGoalMasterLoopProof}
          onRequireImplementerWriteProofChange={runOptions.setRequireImplementerWriteProof}
          onAutoApproveProjectWritesChange={runOptions.setAutoApproveProjectWrites}
          onAutoApproveTerminalChange={runOptions.setAutoApproveTerminal}
          onAllowOrchestratorSubagentsChange={runOptions.setAllowOrchestratorSubagents}
          onTaskPromptChange={runOptions.setTaskPrompt}
          onStartRun={() => void startRun()}
          onStartGoalGuardFlow={() => void startGoalGuardFlow()}
          onStopRun={() => void stopRun()}
          embedded
        />
        {error && (
          <div className="alert alert-error max-w-md py-1.5 text-xs">
            <AlertCircle size={14} />
            <span className="truncate">{error}</span>
          </div>
        )}
        <button type="button" className="btn btn-ghost btn-sm gap-2" onClick={() => void load()}>
          <RefreshCw size={14} />
          Refresh
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-2"
          onClick={openVariantDialog}
          disabled={!selectedSchema || !hasVariantChanges || savingVariant}
          data-testid="architect-save-variant"
        >
          <Save size={14} />
          Save variant
        </button>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden bg-[#080b12]">
        <ArchitectRegistryPanel
          schemas={schemas}
          selectedSchemaId={selectedSchemaId}
          query={query}
          onQueryChange={setQuery}
          onSelectSchema={selectSchema}
          deletingSchemaId={deletingSchemaId}
          onDeleteSchema={(schemaId) => void deleteSchema(schemaId)}
          collapsed={registryCollapsed}
          onCollapsedChange={setRegistryCollapsed}
        />
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <ArchitectGraphCanvas
              schema={editableSchema}
              selectedNodeId={selectedNodeId}
              selectedSlotId={selectedSlotId}
              onSelectNode={selectNode}
              onSelectSlot={(nodeId, slotId) => {
                setSelectedNodeId(nodeId);
                setSelectedSlotId(slotId);
              }}
              onMoveNode={moveGraphNode}
              onAddNode={addGraphNode}
              onToggleEdge={toggleGraphEdge}
              onAutoLayout={autoLayoutGraph}
              routeHops={run?.graph.routeHops}
              runtimeMode={running}
            />
          </div>
          <div
            className={`shrink-0 overflow-hidden border-t border-base-300/70 bg-base-100/95 ${
              showProjectionDetails ? 'max-h-[22rem]' : ''
            }`}
            data-testid="architect-projection-region"
          >
            <ArchitectRunProjection
              activeTab={projectionTab}
              onTabChange={setProjectionTab}
              run={run}
              schema={editableSchema}
              running={running}
              collapsed={!showProjectionDetails}
              onResumeWithQualityGate={run?.agentFlowStatus === 'waiting_on_orchestrator' ? resumeAgentFlowFromQualityGate : undefined}
            />
          </div>
        </div>
        <ArchitectInspector
          node={selectedNode}
          slot={selectedSlot}
          schema={editableSchema}
          personas={personas}
          personaOverrides={personaOverrides}
          nodeKindOverrides={nodeKindOverrides}
          collapsed={inspectorCollapsed}
          onPersonaOverride={setPersonaOverride}
          onNodeKindOverride={setNodeKindOverride}
          onNodeBehaviorOverride={setNodeBehaviorOverride}
          onAutoRoutingOverride={setAutoRoutingOverride}
          onNodeMaxToolAttemptsOverride={setNodeMaxToolAttemptsOverride}
          onNodeToolOverride={setNodeToolOverride}
          onEdgeSelectionOverride={setGraphEdgeSelection}
          onCollapsedChange={setInspectorCollapsed}
          onContextPolicyOverride={setContextPolicyOverride}
        />
      </div>

      {showVariantDialog && (
        <ArchitectVariantDialog
          description={variantDescription}
          name={variantName}
          saving={savingVariant}
          onCancel={() => setShowVariantDialog(false)}
          onDescriptionChange={setVariantDescription}
          onNameChange={setVariantName}
          onSave={() => void saveVariant()}
        />
      )}
    </div>
  );
}
