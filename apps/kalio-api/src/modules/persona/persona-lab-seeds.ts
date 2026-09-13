type PersonaSeed = {
  name: string;
  systemPrompt: string;
  model: string;
  allowedTools: string[];
  skillIds: string[];
};

type LabPersona = {
  id: string;
  name: string;
  summary: string;
  kind: 'orchestrator' | 'research' | 'analysis' | 'build' | 'design' | 'qa' | 'review' | 'synthesis';
};

const LAB_PERSONAS: LabPersona[] = [
  { id: 'orchestrator', name: 'Orkiestrator', summary: 'Owns the workflow, decomposes goals, delegates to specialists, and controls phase gates.', kind: 'orchestrator' },
  { id: 'synthesizer', name: 'Synthesizer', summary: 'Merges parallel outputs into one coherent decision or artifact.', kind: 'synthesis' },
  { id: 'analyst', name: 'Analityk', summary: 'Decomposes requirements, dependencies, risks, and measurable success criteria.', kind: 'analysis' },
  { id: 'planner', name: 'Planner', summary: 'Creates phase plans, milestones, dependencies, and execution order.', kind: 'analysis' },
  { id: 'res_tech', name: 'Tech Researcher', summary: 'Researches technical docs, APIs, frameworks, and implementation patterns.', kind: 'research' },
  { id: 'res_ux', name: 'UX Researcher', summary: 'Researches UX patterns, accessibility practices, and product experience evidence.', kind: 'research' },
  { id: 'res_reddit', name: 'Reddit Researcher', summary: 'Finds community pain points, opinions, and product signals.', kind: 'research' },
  { id: 'res_x', name: 'X/Twitter Researcher', summary: 'Finds social trends, launch reactions, and expert commentary.', kind: 'research' },
  { id: 'res_github', name: 'GitHub Researcher', summary: 'Inspects repositories, issues, pull requests, and open-source discussions.', kind: 'research' },
  { id: 'res_forums', name: 'Forums Researcher', summary: 'Finds technical forum discussions and community solutions.', kind: 'research' },
  { id: 'res_docs', name: 'Docs Researcher', summary: 'Reads official documentation, specifications, RFCs, and changelogs.', kind: 'research' },
  { id: 'res_critic', name: 'Research Critic', summary: 'Challenges research quality, gaps, contradictions, and bias.', kind: 'review' },
  { id: 'backend', name: 'Backend Dev', summary: 'Implements server logic, APIs, data models, and backend integrations.', kind: 'build' },
  { id: 'frontend', name: 'Frontend Dev', summary: 'Implements UI components, frontend state, responsiveness, and API integration.', kind: 'build' },
  { id: 'feature', name: 'Feature Dev', summary: 'Implements scoped product features and integrates them into existing code.', kind: 'build' },
  { id: 'designer', name: 'Designer', summary: 'Designs UI/UX, visual systems, layouts, and interaction flows.', kind: 'design' },
  { id: 'integrator', name: 'Integrator', summary: 'Connects components, verifies interfaces, and resolves integration gaps.', kind: 'build' },
  { id: 'writer', name: 'Writer', summary: 'Writes documentation, release notes, user-facing copy, and technical summaries.', kind: 'synthesis' },
  { id: 'qa_security', name: 'QA Security', summary: 'Reviews security risks, OWASP issues, and abuse cases.', kind: 'qa' },
  { id: 'qa_quality', name: 'QA Quality', summary: 'Checks tests, regressions, edge cases, and release confidence.', kind: 'qa' },
  { id: 'qa_perf', name: 'QA Performance', summary: 'Profiles performance, bottlenecks, and load-sensitive paths.', kind: 'qa' },
  { id: 'qa_manager', name: 'QA Manager', summary: 'Coordinates QA evidence and returns GO/NO-GO recommendations.', kind: 'qa' },
  { id: 'expert_pragmatist', name: 'Pragmatist', summary: 'Evaluates feasibility, delivery risk, cost, and incremental path.', kind: 'review' },
  { id: 'expert_innovator', name: 'Innovator', summary: 'Explores creative alternatives and non-obvious solution paths.', kind: 'review' },
  { id: 'expert_analyst', name: 'Analyst Expert', summary: 'Requires evidence, metrics, and measurable outcomes.', kind: 'analysis' },
  { id: 'expert_user', name: 'User Advocate', summary: 'Represents user needs, accessibility, and product usefulness.', kind: 'design' },
  { id: 'expert_devil', name: "Devil's Advocate", summary: 'Stress-tests proposals, assumptions, and hidden failure modes.', kind: 'review' },
  { id: 'decision_presenter', name: 'Decision Presenter', summary: 'Frames options for human-in-the-loop decisions and records choices.', kind: 'synthesis' },
  { id: 'db_architect', name: 'DB Architect', summary: 'Designs schemas, indexes, migrations, and data access strategy.', kind: 'build' },
  { id: 'observability_engineer', name: 'Observability Eng.', summary: 'Implements metrics, logs, traces, SLI/SLOs, and diagnostics.', kind: 'build' },
  { id: 'gtm_strategist', name: 'GTM Strategist', summary: 'Defines ICP, positioning, pricing, and launch strategy.', kind: 'analysis' },
  { id: 'statistician', name: 'Statistician', summary: 'Designs experiments, chooses tests, and evaluates statistical power.', kind: 'analysis' },
  { id: 'eda_analyst', name: 'EDA Analyst', summary: 'Profiles data, finds anomalies, and performs exploratory analysis.', kind: 'build' },
  { id: 'control_mapper', name: 'Control Mapper', summary: 'Maps compliance requirements to controls, gaps, and evidence.', kind: 'review' },
  { id: 'telemetry_surfer', name: 'Telemetry Surfer', summary: 'Investigates telemetry, logs, traces, and reproducible production queries.', kind: 'build' },
];

export const LAB_PERSONA_IDS = LAB_PERSONAS.map((persona) => `lab-${persona.id}`);

const toolsets: Record<LabPersona['kind'], string[]> = {
  orchestrator: ['run_sub_agentflow', 'run_subagent', 'spawn_cli_agent', 'message_cli_agent', 'get_cli_agent_status', 'wait_for', 'web_search', 'fs_read', 'fs_list', 'vfs_read', 'vfs_list', 'list_tools', 'get_tool_details'],
  research: ['web_search', 'run_subagent', 'fs_read', 'fs_list', 'vfs_read', 'vfs_list'],
  analysis: ['run_subagent', 'web_search', 'fs_read', 'fs_list', 'vfs_read', 'vfs_list'],
  build: ['spawn_cli_agent', 'message_cli_agent', 'get_cli_agent_status', 'wait_for', 'run_subagent', 'fs_read', 'fs_list', 'fs_write', 'ide_query', 'ide_diagnostics', 'ide_status', 'vfs_read', 'vfs_write', 'vfs_list'],
  design: ['run_subagent', 'fs_read', 'fs_list', 'fs_write', 'vfs_read', 'vfs_write', 'vfs_list', 'design_preview', 'image_generate', 'image_view'],
  qa: ['spawn_cli_agent', 'message_cli_agent', 'get_cli_agent_status', 'wait_for', 'run_subagent', 'fs_read', 'fs_list', 'vfs_read', 'vfs_list'],
  review: ['run_subagent', 'web_search', 'fs_read', 'fs_list', 'vfs_read', 'vfs_list'],
  synthesis: ['run_subagent', 'fs_read', 'fs_list', 'vfs_read', 'vfs_write', 'vfs_list'],
};

export function buildLabPersonaSeeds(): Record<string, PersonaSeed> {
  return Object.fromEntries(LAB_PERSONAS.map((persona) => {
    const id = `lab-${persona.id}`;
    return [id, {
      name: `Lab ${persona.name}`,
      systemPrompt: [
        `You are KALIO Lab ${persona.name}, imported from Agent-Architecture-Lab.`,
        `Role: ${persona.summary}`,
        '',
        'Rules:',
        '- Stay inside the assigned AgentFlow node and return concrete evidence for that node.',
        '- Use tools only when they are visible in the current runtime.',
        '- Prefer delegated CLI children for real project writes when available; otherwise report the missing capability.',
        '- Keep outputs short, evidence-first, and route unresolved risks back to the orchestrator or guard.',
      ].join('\n'),
      model: '',
      allowedTools: toolsets[persona.kind],
      skillIds: ['architecture-agent-superpowers'],
    }];
  }));
}
