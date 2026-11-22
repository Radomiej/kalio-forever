import type { ArchitectureSchema } from '@kalio/types';

const roles = [
  ['analyst', 'Context Analyst', 'agent-researcher', 'participant', 'Map the current project and its acceptance criteria. Search current project context, verify file paths against source, and identify user changes to preserve.'],
  ['orchestrator', 'Orchestrator', 'agent-orchestrator', 'router', 'Prioritize work and assign a bounded next action. At final review, return to the responsible role if any current acceptance check fails or evidence is missing.'],
  ['designer', 'Game Designer', 'designer', 'participant', 'Define the existing game loop and explicit player acceptance criteria for start, play, result, progression, and replay. Preserve the game identity.'],
  ['senior', 'Senior Developer', 'agent-reviewer', 'critic', 'Review the implementation plan and integration risks, dependencies, save compatibility, and overlapping changes. Never discard existing work.'],
  ['core', 'Core Loop Developer', 'agent-implementer', 'tool_executor', 'Implement the agreed playable loop and state transitions. Keep changes scoped and add focused regressions.'],
  ['ux', 'Game UX Developer', 'agent-implementer', 'tool_executor', 'Improve menus, HUD and feedback. Preserve the agreed core loop and verify keyboard, pointer and supported touch controls.'],
  ['input-qa', 'Input and Visual QA', 'agent-qa', 'tool_executor', 'Use the running preview and Playwright. Verify navigation, menus, keyboard and pointer, supported touch, visual layout, screenshot evidence and browser errors. Record blocked capabilities explicitly.'],
  ['loop-qa', 'Core Loop QA', 'agent-qa', 'tool_executor', 'Independently play a complete session including result, progression, save/reload and replay. Verify tests and build and record their actual exit codes.'],
  ['finalizer', 'Game Readiness Report', 'agent-synthesizer', 'finalizer', 'Report accepted only with current successful build, independent review and both QA receipts. Include files, screenshots, remaining defects and reproducible play instructions.'],
] as const;

const reads = ['fs_list', 'fs_read', 'search_project_context'];
const terminal = ['terminal_spawn', 'terminal_list', 'terminal_output'];
const browser = [
  'mcp_toml_mcp-playwright-orchestrator_browser_session_cr_dc3f126f',
  'mcp_toml_mcp-playwright-orchestrator_browser_page_new_5bd3a08e',
  'mcp_toml_mcp-playwright-orchestrator_browser_page_navig_181cd832',
  'mcp_toml_mcp-playwright-orchestrator_browser_snapshot_22722cdb',
  'mcp_toml_mcp-playwright-orchestrator_browser_click_e993a421',
  'mcp_toml_mcp-playwright-orchestrator_browser_press_key_5dbce85f',
  'mcp_toml_mcp-playwright-orchestrator_browser_wait_for_91d3c8d3',
  'mcp_toml_mcp-playwright-orchestrator_audit_visual_layou_63cb5173',
  'mcp_toml_mcp-playwright-orchestrator_take_snapshot_3959a244',
  'mcp_toml_mcp-playwright-orchestrator_browser_session_cl_73f1e1da',
];

function edge(fromNodeId: string, toNodeId: string, selection?: ArchitectureSchema['edges'][number]['selection'], label?: string) {
  return { id: `${fromNodeId}-to-${toNodeId}`, fromNodeId, toNodeId, selection, label };
}

export const GAME_DEVELOPMENT_2: ArchitectureSchema = {
  id: 'game-development-2',
  name: 'Game Development 2',
  version: '1.0.2',
  description: 'Game design, implementation, independent playtest, and an evidence-led correction loop.',
  roleSlots: roles.map(([id, label, defaultPersonaId, slotType, description]) => ({
    id, label, defaultPersonaId, slotType, description, allowedPersonaTags: [],
    required: true, canOverrideAtRunStart: true,
  })),
  nodes: [
    ...roles.slice(0, 6).map(([id, label], index): ArchitectureSchema['nodes'][number] => ({
      id, label, kind: id === 'orchestrator' ? 'router' : 'role', roleSlotId: id, x: 360, y: index * 150,
      ...(id === 'orchestrator' ? { behavior: { mode: 'choose_one' as const, fanOut: 'sequential' as const } } : {}),
      toolOverride: { allowedToolNames: id === 'core' || id === 'ux' ? [...reads, 'fs_write', ...terminal] : [...reads] },
    })),
    { id: 'readiness', label: 'Jev · Ready for QA?', kind: 'auto_router', x: 360, y: 900,
      autoRouting: { confidenceThreshold: 0.95, instructions: 'Select independent QA only when the current implementation and senior review cover the requested change. Select rework for missing or stale evidence. Never infer a successful playtest from an implementer report.' } },
    { id: 'input-qa', label: 'Input and Visual QA', kind: 'role', roleSlotId: 'input-qa', x: 360, y: 1050,
      toolOverride: { allowedToolNames: [...reads, ...terminal, ...browser] } },
    { id: 'loop-qa', label: 'Core Loop QA', kind: 'role', roleSlotId: 'loop-qa', x: 360, y: 1200,
      toolOverride: { allowedToolNames: [...reads, ...terminal, ...browser] } },
    { id: 'release', label: 'Orchestrator · Release Review', kind: 'router', roleSlotId: 'orchestrator', x: 360, y: 1350,
      behavior: { mode: 'choose_one', fanOut: 'sequential', description: 'Require both QA reports, a successful current build and an independent review. Route to the responsible developer on any missing, failed or stale proof.' },
      toolOverride: { allowedToolNames: [...reads] } },
    { id: 'finalizer', label: 'Game Readiness Report', kind: 'artifact', roleSlotId: 'finalizer', x: 360, y: 1500,
      behavior: { mode: 'finalize' }, toolOverride: { allowedToolNames: [] } },
  ],
  edges: [
    edge('analyst', 'orchestrator'), edge('orchestrator', 'designer', 'default'),
    edge('orchestrator', 'core', 'choice', 'Retry implementation after reviewing failure'),
    edge('designer', 'core'), edge('core', 'ux', 'default'),
    edge('core', 'orchestrator', 'continuation', 'Recover after implementation timeout'),
    edge('ux', 'senior'), edge('senior', 'readiness'),
    edge('readiness', 'core', 'default', 'Rework · insufficient evidence'),
    edge('readiness', 'input-qa', 'choice', 'Ready for independent QA'),
    edge('input-qa', 'loop-qa'), edge('loop-qa', 'release'),
    edge('release', 'core', 'default', 'Rework · gameplay or missing evidence'),
    edge('release', 'ux', 'continuation', 'Rework · UX or input'),
    edge('release', 'finalizer', 'choice', 'Both QA checks passed'),
  ],
  routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
  contextPolicy: {
    includeUserTask: true, includeProjectMemory: true, includeBrowserSession: false,
    includePriorDecisions: true, includeOtherAgentOutputs: true, includeToolResults: true,
  },
  memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true },
  outputArtifactSchema: 'CodeReviewArtifact',
};
