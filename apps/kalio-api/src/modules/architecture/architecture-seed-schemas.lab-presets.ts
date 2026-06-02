import type { ArchitectureSchema } from '@kalio/types';

type LabPresetNode = { id: string; x: number; y: number; c?: number[]; m?: string };
type LabPresetDefinition = { id: string; name: string; cat: string; desc: string; tier?: string; source?: string; nodes: LabPresetNode[] };

const BASE_CONTEXT_POLICY: ArchitectureSchema['contextPolicy'] = {
  includeUserTask: true,
  includeProjectMemory: true,
  includeBrowserSession: false,
  includePriorDecisions: true,
  includeOtherAgentOutputs: true,
  includeToolResults: true,
};

export const LAB_PRESET_IDS = [
  'lab_solo',
  'lab_quick_fix',
  'lab_recon',
  'lab_trio',
  'lab_reflect',
  'lab_bug_hunt',
  'lab_content',
  'lab_plan_exec',
  'lab_perf_boost',
  'lab_startup',
  'lab_cascade',
  'lab_test_suite',
  'lab_a11y',
  'lab_ab_test_lab',
  'lab_tech_writing_pipe',
  'lab_perf_squad',
  'lab_security',
  'lab_review',
  'lab_design_sys',
  'lab_api_modern',
  'lab_ui_overhaul',
  'lab_feature_sprint',
  'lab_standard',
  'lab_data_pipe',
  'lab_research',
  'lab_legacy',
  'lab_saas',
  'lab_deep_research_swarm_pro',
  'lab_migration_crew',
  'lab_fullstack_premium',
  'lab_security_multi_vector',
  'lab_prd_to_launch',
  'lab_kb_constructor',
  'lab_soc2_sweep',
  'lab_data_analysis_pipe',
  'lab_incident_war_room',
  'lab_microservices',
  'lab_full',
  'lab_deep',
  'lab_five_minds',
  'lab_deep_five_minds',
  'lab_five_minds_strategic',
] as const;

const LAB_PRESETS: LabPresetDefinition[] = [
  {"id":"solo","name":"Solo + Walidator","cat":"MICRO (2-3)","desc":"Orkiestrator + worker z petla.","nodes":[{"id":"orchestrator","x":400,"y":100,"c":[1]},{"id":"backend","x":400,"y":260}]},
  {"id":"quick_fix","name":"Szybka Naprawa","cat":"MICRO (2-3)","desc":"Cykl fix-test-fix z ciagle petla.","nodes":[{"id":"orchestrator","x":400,"y":60,"c":[1]},{"id":"backend","x":400,"y":200,"c":[2]},{"id":"qa_quality","x":400,"y":340,"c":[0]}]},
  {"id":"recon","name":"Recon Squad","cat":"MICRO (2-3)","desc":"Orkiestrator + researcher + builder.","nodes":[{"id":"orchestrator","x":400,"y":60,"c":[1,2]},{"id":"res_tech","x":260,"y":200,"c":[2]},{"id":"backend","x":540,"y":200}]},
  {"id":"trio","name":"Classic Trio","cat":"MICRO (2-3)","desc":"Backend + Frontend + QA.","nodes":[{"id":"backend","x":250,"y":100,"c":[2,1]},{"id":"frontend","x":550,"y":100,"c":[2]},{"id":"qa_quality","x":400,"y":270}]},
  {"id":"reflect","name":"Reflective Loop","cat":"MICRO (2-3)","desc":"Research Analiza Krytyka.","nodes":[{"id":"res_tech","x":400,"y":60,"c":[1]},{"id":"analyst","x":400,"y":210,"c":[2]},{"id":"res_critic","x":400,"y":360,"c":[0]}]},
  {"id":"bug_hunt","name":"Bug Hunter","cat":"SREDNIE (4-8)","desc":"Orkiestrator + builder + 2x QA.","nodes":[{"id":"orchestrator","x":400,"y":50,"c":[1]},{"id":"backend","x":400,"y":180,"c":[2,3]},{"id":"qa_security","x":250,"y":320,"c":[0]},{"id":"qa_quality","x":550,"y":320,"c":[0]}]},
  {"id":"content","name":"Content Pipeline","cat":"SREDNIE (4-8)","desc":"2 researcherow redaktor QA.","nodes":[{"id":"res_forums","x":240,"y":60,"c":[2]},{"id":"res_tech","x":560,"y":60,"c":[2]},{"id":"writer","x":400,"y":220,"c":[3]},{"id":"qa_quality","x":400,"y":370}]},
  {"id":"plan_exec","name":"Plan & Execute","cat":"SREDNIE (4-8)","desc":"Plan harmonogram build walidacja.","nodes":[{"id":"analyst","x":400,"y":40,"c":[1]},{"id":"planner","x":400,"y":170,"c":[2]},{"id":"backend","x":400,"y":300,"c":[3]},{"id":"qa_quality","x":400,"y":430,"c":[0]}]},
  {"id":"perf_boost","name":"Performance Boost","cat":"SREDNIE (4-8)","desc":"Analiza backend + audyt perf.","nodes":[{"id":"analyst","x":400,"y":50,"c":[1,2]},{"id":"backend","x":250,"y":190,"c":[3]},{"id":"qa_perf","x":550,"y":190,"c":[3]},{"id":"integrator","x":400,"y":340}]},
  {"id":"startup","name":"Startup MVP","cat":"SREDNIE (4-8)","desc":"Orkiestrator + analityk + researcher + builder + QA.","nodes":[{"id":"orchestrator","x":400,"y":40,"c":[1,2,3]},{"id":"analyst","x":400,"y":150},{"id":"res_tech","x":240,"y":270,"c":[3]},{"id":"backend","x":560,"y":270,"c":[4]},{"id":"qa_quality","x":400,"y":400}]},
  {"id":"cascade","name":"Cascade Cost","cat":"SREDNIE (4-8)","desc":"Haiku Sonnet Opus. 70-80% tanio.","nodes":[{"id":"res_tech","x":220,"y":60,"c":[2]},{"id":"res_docs","x":580,"y":60,"c":[3]},{"id":"backend","x":280,"y":210,"c":[4]},{"id":"qa_quality","x":520,"y":210,"c":[4]},{"id":"orchestrator","x":400,"y":370}]},
  {"id":"test_suite","name":"Testing Suite","cat":"SREDNIE (4-8)","desc":"Orkiestrator + 3x QA + Manager.","nodes":[{"id":"orchestrator","x":400,"y":40,"c":[1,2,3]},{"id":"qa_security","x":200,"y":180,"c":[4]},{"id":"qa_quality","x":400,"y":180,"c":[4]},{"id":"qa_perf","x":600,"y":180,"c":[4]},{"id":"qa_manager","x":400,"y":330}]},
  {"id":"a11y","name":"Accessibility Sprint","cat":"SREDNIE (4-8)","desc":"UX research designer + FE QA docs.","nodes":[{"id":"res_ux","x":400,"y":40,"c":[1,2]},{"id":"designer","x":250,"y":180,"c":[3]},{"id":"frontend","x":550,"y":180,"c":[3]},{"id":"qa_quality","x":400,"y":320,"c":[4]},{"id":"writer","x":400,"y":450}]},
  {"id":"ab_test_lab","name":"A/B Test Lab","cat":"SREDNIE (4-8)","desc":"Power calc + variants + p-hacking red team + stat sign-off.","tier":"new","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1,2],"m":"opus"},{"id":"statistician","x":240,"y":130,"c":[4,5],"m":"opus"},{"id":"analyst","x":560,"y":130,"c":[3],"m":"sonnet"},{"id":"res_ux","x":240,"y":240,"c":[4],"m":"haiku"},{"id":"designer","x":560,"y":240,"c":[5],"m":"sonnet"},{"id":"expert_devil","x":400,"y":360,"c":[6],"m":"opus"},{"id":"decision_presenter","x":400,"y":480,"c":[0],"m":"sonnet"}]},
  {"id":"tech_writing_pipe","name":"Tech Writing Pipeline","cat":"SREDNIE (4-8)","desc":"Outline+research writer+diagrams+SEO critic.","tier":"new","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1,2],"m":"sonnet"},{"id":"res_docs","x":240,"y":140,"c":[3],"m":"haiku"},{"id":"res_github","x":560,"y":140,"c":[3],"m":"haiku"},{"id":"analyst","x":400,"y":250,"c":[4],"m":"sonnet"},{"id":"writer","x":400,"y":360,"c":[5,6,7],"m":"opus"},{"id":"designer","x":200,"y":470,"m":"sonnet"},{"id":"res_critic","x":400,"y":470,"m":"sonnet"},{"id":"feature","x":600,"y":470,"c":[0],"m":"haiku"}]},
  {"id":"perf_squad","name":"Performance Squad","cat":"SREDNIE (4-8)","desc":"Five Minds adversarial + 3 parallel diagnostic specialists.","tier":"new","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1],"m":"opus"},{"id":"analyst","x":400,"y":130,"c":[2,3,4],"m":"sonnet"},{"id":"db_architect","x":160,"y":240,"c":[5],"m":"sonnet"},{"id":"frontend","x":400,"y":240,"c":[5],"m":"sonnet"},{"id":"backend","x":640,"y":240,"c":[5],"m":"sonnet"},{"id":"expert_devil","x":280,"y":360,"c":[6],"m":"opus"},{"id":"qa_perf","x":520,"y":360,"c":[7],"m":"sonnet"},{"id":"synthesizer","x":400,"y":480,"c":[0],"m":"opus"}]},
  {"id":"security","name":"Security Hardening","cat":"DUZE (9-12)","desc":"Builder + 3x QA + Manager GO/NO-GO.","nodes":[{"id":"orchestrator","x":400,"y":30,"c":[1]},{"id":"backend","x":400,"y":150,"c":[2,3,4]},{"id":"qa_security","x":200,"y":290,"c":[5]},{"id":"qa_quality","x":400,"y":290,"c":[5]},{"id":"qa_perf","x":600,"y":290,"c":[5]},{"id":"qa_manager","x":400,"y":430,"c":[0]}]},
  {"id":"review","name":"Code Review","cat":"DUZE (9-12)","desc":"Analiza build review.","nodes":[{"id":"orchestrator","x":400,"y":30,"c":[1]},{"id":"analyst","x":400,"y":140,"c":[2,3]},{"id":"backend","x":250,"y":260,"c":[4]},{"id":"frontend","x":550,"y":260,"c":[5]},{"id":"qa_security","x":250,"y":400,"c":[0]},{"id":"qa_quality","x":550,"y":400,"c":[0]}]},
  {"id":"design_sys","name":"Design System","cat":"DUZE (9-12)","desc":"UX + docs research designer + FE docs.","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1,2]},{"id":"res_ux","x":250,"y":140,"c":[3]},{"id":"res_docs","x":550,"y":140,"c":[4]},{"id":"designer","x":250,"y":280,"c":[5]},{"id":"frontend","x":550,"y":280,"c":[5]},{"id":"writer","x":400,"y":420}]},
  {"id":"api_modern","name":"API Modernization","cat":"DUZE (9-12)","desc":"Analiza research backend + integrator QA.","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1]},{"id":"analyst","x":400,"y":130,"c":[2]},{"id":"res_tech","x":400,"y":240,"c":[3,4]},{"id":"backend","x":250,"y":360,"c":[5]},{"id":"integrator","x":550,"y":360,"c":[5]},{"id":"qa_quality","x":400,"y":490}]},
  {"id":"ui_overhaul","name":"UI/UX Overhaul","cat":"DUZE (9-12)","desc":"2x research analiza designer + FE QA.","nodes":[{"id":"orchestrator","x":400,"y":10,"c":[1,2]},{"id":"res_ux","x":230,"y":120,"c":[3]},{"id":"res_docs","x":570,"y":120,"c":[3]},{"id":"analyst","x":400,"y":230,"c":[4,5]},{"id":"designer","x":230,"y":350,"c":[6]},{"id":"frontend","x":570,"y":350,"c":[6]},{"id":"qa_quality","x":400,"y":470}]},
  {"id":"feature_sprint","name":"Feature Sprint","cat":"DUZE (9-12)","desc":"Analiza research build QA.","nodes":[{"id":"orchestrator","x":400,"y":10,"c":[1]},{"id":"analyst","x":400,"y":110,"c":[2,3]},{"id":"res_tech","x":230,"y":220,"c":[4]},{"id":"res_ux","x":570,"y":220,"c":[5]},{"id":"backend","x":230,"y":350,"c":[6]},{"id":"frontend","x":570,"y":350,"c":[6]},{"id":"qa_quality","x":400,"y":470}]},
  {"id":"standard","name":"Standard Dev","cat":"DUZE (9-12)","desc":"Orkiestrator + planowanie + research + build + QA.","nodes":[{"id":"orchestrator","x":400,"y":15,"c":[1,2,3,4]},{"id":"analyst","x":280,"y":110},{"id":"planner","x":520,"y":110},{"id":"res_tech","x":220,"y":220,"c":[5]},{"id":"res_ux","x":580,"y":220,"c":[6]},{"id":"backend","x":260,"y":340,"c":[7]},{"id":"frontend","x":540,"y":340,"c":[7]},{"id":"qa_security","x":400,"y":460}]},
  {"id":"data_pipe","name":"Data Pipeline","cat":"DUZE (9-12)","desc":"Planowanie + research backend + feature integrator.","nodes":[{"id":"orchestrator","x":400,"y":10,"c":[1,2]},{"id":"analyst","x":280,"y":110,"c":[3]},{"id":"planner","x":520,"y":110,"c":[4]},{"id":"res_tech","x":230,"y":220,"c":[5]},{"id":"res_docs","x":570,"y":220,"c":[6]},{"id":"backend","x":230,"y":340,"c":[7]},{"id":"feature","x":570,"y":340,"c":[7]},{"id":"integrator","x":400,"y":460}]},
  {"id":"research","name":"Research Swarm","cat":"DUZE (9-12)","desc":"6 researcherow + krytyk + syntetyk.","nodes":[{"id":"orchestrator","x":400,"y":10,"c":[1,2,3,4,5,6]},{"id":"res_tech","x":120,"y":130,"c":[7]},{"id":"res_reddit","x":240,"y":130,"c":[7]},{"id":"res_github","x":360,"y":130,"c":[7]},{"id":"res_forums","x":480,"y":130,"c":[7]},{"id":"res_docs","x":600,"y":130,"c":[7]},{"id":"res_x","x":720,"y":130,"c":[7]},{"id":"res_critic","x":400,"y":280,"c":[8]},{"id":"synthesizer","x":400,"y":420,"c":[0]}]},
  {"id":"legacy","name":"Legacy Refactor","cat":"DUZE (9-12)","desc":"Analiza + research 3x build 2x QA.","nodes":[{"id":"orchestrator","x":400,"y":10,"c":[1]},{"id":"analyst","x":400,"y":105,"c":[2,3]},{"id":"res_tech","x":230,"y":200,"c":[4]},{"id":"res_github","x":570,"y":200,"c":[5]},{"id":"backend","x":180,"y":310,"c":[6]},{"id":"frontend","x":400,"y":310,"c":[6]},{"id":"integrator","x":620,"y":310,"c":[7,8]},{"id":"qa_security","x":300,"y":430},{"id":"qa_quality","x":500,"y":430}]},
  {"id":"saas","name":"Full-Stack SaaS","cat":"DUZE (9-12)","desc":"Research build (3 role) integracja QA.","nodes":[{"id":"orchestrator","x":400,"y":10,"c":[1]},{"id":"analyst","x":400,"y":100,"c":[2,3]},{"id":"res_tech","x":230,"y":200,"c":[4]},{"id":"res_ux","x":570,"y":200,"c":[5,6]},{"id":"backend","x":180,"y":310,"c":[7]},{"id":"frontend","x":400,"y":310,"c":[7]},{"id":"designer","x":620,"y":310,"c":[7]},{"id":"integrator","x":400,"y":420,"c":[8,9]},{"id":"qa_security","x":280,"y":530},{"id":"qa_quality","x":520,"y":530}]},
  {"id":"deep_research_swarm_pro","name":"Deep Research Swarm Pro","cat":"DUZE (9-12)","desc":"Anthropic-style 7 researcherow + critic + synthesizer.","tier":"new","source":"anthropic.com/engineering/multi-agent-research-system","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1,2,3,4,5,6,7],"m":"opus"},{"id":"res_tech","x":80,"y":160,"c":[8],"m":"sonnet"},{"id":"res_ux","x":200,"y":160,"c":[8],"m":"sonnet"},{"id":"res_reddit","x":320,"y":160,"c":[8],"m":"sonnet"},{"id":"res_x","x":440,"y":160,"c":[8],"m":"sonnet"},{"id":"res_github","x":560,"y":160,"c":[8],"m":"sonnet"},{"id":"res_forums","x":680,"y":160,"c":[8],"m":"sonnet"},{"id":"res_docs","x":380,"y":280,"c":[8],"m":"sonnet"},{"id":"res_critic","x":400,"y":400,"c":[9],"m":"opus"},{"id":"synthesizer","x":400,"y":520,"c":[0],"m":"opus"}]},
  {"id":"migration_crew","name":"Migration Crew","cat":"DUZE (9-12)","desc":"Migracja legacy z 3 parallel explorers + HITL gate.","tier":"new","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1,2],"m":"opus"},{"id":"analyst","x":260,"y":130,"c":[3,4,5],"m":"sonnet"},{"id":"planner","x":540,"y":130,"c":[6],"m":"opus"},{"id":"res_github","x":160,"y":240,"c":[6],"m":"sonnet"},{"id":"res_tech","x":400,"y":240,"c":[6],"m":"sonnet"},{"id":"res_docs","x":640,"y":240,"c":[6],"m":"sonnet"},{"id":"decision_presenter","x":400,"y":350,"c":[7,8],"m":"sonnet"},{"id":"backend","x":280,"y":460,"c":[9],"m":"sonnet"},{"id":"integrator","x":520,"y":460,"c":[9],"m":"sonnet"},{"id":"qa_quality","x":400,"y":570,"c":[0],"m":"haiku"}]},
  {"id":"fullstack_premium","name":"Full-Stack Premium","cat":"DUZE (9-12)","desc":"wshobson 7-agent fullstack + UX research + observability + db architect.","tier":"new","source":"github.com/wshobson/agents","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1,2],"m":"opus"},{"id":"analyst","x":260,"y":120,"c":[3,4],"m":"sonnet"},{"id":"planner","x":540,"y":120,"c":[5],"m":"sonnet"},{"id":"res_ux","x":200,"y":220,"c":[6],"m":"haiku"},{"id":"res_docs","x":600,"y":220,"c":[6],"m":"haiku"},{"id":"db_architect","x":400,"y":320,"c":[7,8],"m":"sonnet"},{"id":"designer","x":140,"y":430,"c":[9],"m":"sonnet"},{"id":"backend","x":300,"y":430,"c":[9],"m":"sonnet"},{"id":"frontend","x":500,"y":430,"c":[9],"m":"sonnet"},{"id":"integrator","x":660,"y":430,"c":[10,11],"m":"sonnet"},{"id":"qa_security","x":280,"y":540,"c":[0],"m":"opus"},{"id":"observability_engineer","x":520,"y":540,"c":[0],"m":"sonnet"}]},
  {"id":"security_multi_vector","name":"Multi-Vector Security","cat":"DUZE (9-12)","desc":"5 parallel scanners + STRIDE + release gate.","tier":"new","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1],"m":"opus"},{"id":"analyst","x":400,"y":130,"c":[2,3,4,5,6],"m":"opus"},{"id":"qa_security","x":120,"y":240,"c":[7],"m":"opus"},{"id":"qa_quality","x":280,"y":240,"c":[7],"m":"haiku"},{"id":"qa_perf","x":440,"y":240,"c":[7],"m":"sonnet"},{"id":"res_github","x":600,"y":240,"c":[7],"m":"haiku"},{"id":"expert_devil","x":280,"y":360,"c":[7],"m":"sonnet"},{"id":"qa_manager","x":480,"y":360,"c":[8],"m":"opus"},{"id":"decision_presenter","x":400,"y":480,"c":[0],"m":"sonnet"}]},
  {"id":"prd_to_launch","name":"PRD to Launch","cat":"DUZE (9-12)","desc":"JTBDPRDtickets+designs+copy+GTM.","tier":"new","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1],"m":"opus"},{"id":"analyst","x":400,"y":130,"c":[2,3],"m":"sonnet"},{"id":"res_ux","x":240,"y":240,"c":[4],"m":"haiku"},{"id":"res_reddit","x":560,"y":240,"c":[4],"m":"haiku"},{"id":"writer","x":400,"y":340,"c":[5,6,7,8],"m":"opus"},{"id":"planner","x":120,"y":450,"c":[9],"m":"sonnet"},{"id":"designer","x":280,"y":450,"c":[9],"m":"sonnet"},{"id":"feature","x":440,"y":450,"c":[9],"m":"sonnet"},{"id":"gtm_strategist","x":600,"y":450,"c":[9],"m":"opus"},{"id":"res_critic","x":300,"y":560,"c":[10],"m":"sonnet"},{"id":"decision_presenter","x":500,"y":560,"c":[0],"m":"sonnet"}]},
  {"id":"kb_constructor","name":"KB Constructor","cat":"DUZE (9-12)","desc":"4 ingesters + dedup + writer + critic + integrator.","tier":"new","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1,2,3,4],"m":"opus"},{"id":"res_forums","x":120,"y":140,"c":[5],"m":"haiku"},{"id":"res_docs","x":280,"y":140,"c":[5],"m":"haiku"},{"id":"res_tech","x":440,"y":140,"c":[5],"m":"haiku"},{"id":"res_github","x":600,"y":140,"c":[5],"m":"haiku"},{"id":"analyst","x":400,"y":260,"c":[6,7],"m":"opus"},{"id":"feature","x":200,"y":380,"c":[7],"m":"haiku"},{"id":"writer","x":400,"y":380,"c":[8,9],"m":"sonnet"},{"id":"res_critic","x":600,"y":380,"m":"sonnet"},{"id":"integrator","x":400,"y":500,"c":[0],"m":"haiku"}]},
  {"id":"soc2_sweep","name":"SOC2 Sweep","cat":"DUZE (9-12)","desc":"Policy + control mapping + evidence + gap analysis + CISO sign-off.","tier":"new","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1,2,3],"m":"opus"},{"id":"res_docs","x":200,"y":140,"c":[4],"m":"haiku"},{"id":"control_mapper","x":400,"y":140,"c":[4],"m":"sonnet"},{"id":"res_github","x":600,"y":140,"c":[4],"m":"haiku"},{"id":"analyst","x":240,"y":260,"c":[5,6],"m":"opus"},{"id":"qa_security","x":560,"y":260,"c":[7],"m":"opus"},{"id":"writer","x":240,"y":380,"c":[7],"m":"sonnet"},{"id":"res_critic","x":560,"y":380,"c":[8],"m":"sonnet"},{"id":"decision_presenter","x":400,"y":500,"c":[0],"m":"sonnet"}]},
  {"id":"data_analysis_pipe","name":"Data Analysis Pipeline","cat":"DUZE (9-12)","desc":"Collect clean EDA+SQL model report+charts.","tier":"new","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1],"m":"opus"},{"id":"analyst","x":200,"y":140,"c":[2],"m":"haiku"},{"id":"backend","x":400,"y":140,"c":[3,4],"m":"haiku"},{"id":"eda_analyst","x":600,"y":140,"c":[5],"m":"sonnet"},{"id":"integrator","x":200,"y":260,"c":[5],"m":"sonnet"},{"id":"feature","x":600,"y":260,"c":[6,7],"m":"opus"},{"id":"writer","x":240,"y":380,"c":[8],"m":"sonnet"},{"id":"designer","x":560,"y":380,"c":[8],"m":"sonnet"},{"id":"res_critic","x":400,"y":500,"c":[0],"m":"opus"}]},
  {"id":"incident_war_room","name":"Incident War Room","cat":"DUZE (9-12)","desc":"Telemetry+logs+diff parallel Devil rollback gate postmortem.","tier":"new","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1,2,3],"m":"opus"},{"id":"telemetry_surfer","x":160,"y":140,"c":[4,5],"m":"haiku"},{"id":"qa_quality","x":400,"y":140,"c":[4,5],"m":"haiku"},{"id":"res_github","x":640,"y":140,"c":[4,5],"m":"sonnet"},{"id":"qa_perf","x":240,"y":260,"c":[6],"m":"sonnet"},{"id":"qa_security","x":560,"y":260,"c":[6],"m":"sonnet"},{"id":"expert_devil","x":400,"y":360,"c":[7],"m":"opus"},{"id":"decision_presenter","x":400,"y":460,"c":[8,9],"m":"opus"},{"id":"feature","x":280,"y":560,"m":"sonnet"},{"id":"writer","x":520,"y":560,"c":[0],"m":"sonnet"}]},
  {"id":"microservices","name":"Microservices","cat":"ENTERPRISE (13+)","desc":"Planowanie 4x build 3x QA.","nodes":[{"id":"orchestrator","x":400,"y":5,"c":[1,2]},{"id":"analyst","x":280,"y":90,"c":[3]},{"id":"planner","x":520,"y":90},{"id":"res_tech","x":400,"y":180,"c":[4,5,6,7]},{"id":"backend","x":160,"y":280,"c":[8]},{"id":"feature","x":320,"y":280,"c":[8]},{"id":"integrator","x":480,"y":280,"c":[9]},{"id":"frontend","x":640,"y":280,"c":[9]},{"id":"qa_security","x":230,"y":400,"c":[10]},{"id":"qa_quality","x":400,"y":400,"c":[10]},{"id":"qa_manager","x":570,"y":400,"c":[0]}]},
  {"id":"full","name":"Full Hierarchy","cat":"ENTERPRISE (13+)","desc":"5-poziomowa hierarchia. Gold Standard.","nodes":[{"id":"orchestrator","x":400,"y":10,"c":[1,2,3,4,5]},{"id":"analyst","x":290,"y":100},{"id":"planner","x":510,"y":100},{"id":"res_tech","x":170,"y":200,"c":[6]},{"id":"res_ux","x":400,"y":200,"c":[7]},{"id":"res_docs","x":630,"y":200,"c":[8]},{"id":"backend","x":150,"y":310,"c":[9]},{"id":"frontend","x":310,"y":310,"c":[9]},{"id":"designer","x":490,"y":310,"c":[9]},{"id":"integrator","x":650,"y":310,"c":[10,11]},{"id":"qa_security","x":240,"y":420,"c":[12]},{"id":"qa_quality","x":420,"y":420,"c":[12]},{"id":"qa_manager","x":600,"y":420,"c":[0]}]},
  {"id":"deep","name":"Deep Research+Build","cat":"ENTERPRISE (13+)","desc":"6 researcherow + krytyk + syntetyk + 4 build + 3 QA.","nodes":[{"id":"orchestrator","x":420,"y":5,"c":[1,2,3]},{"id":"analyst","x":240,"y":85,"c":[4,5,6,7,8,9]},{"id":"planner","x":450,"y":85},{"id":"synthesizer","x":620,"y":85,"c":[11,12,13]},{"id":"res_reddit","x":100,"y":175,"c":[10]},{"id":"res_x","x":220,"y":175,"c":[10]},{"id":"res_ux","x":340,"y":175,"c":[10]},{"id":"res_github","x":460,"y":175,"c":[10]},{"id":"res_forums","x":580,"y":175,"c":[10]},{"id":"res_docs","x":700,"y":175,"c":[10]},{"id":"res_critic","x":420,"y":270,"c":[3]},{"id":"backend","x":190,"y":365,"c":[14]},{"id":"frontend","x":370,"y":365,"c":[14]},{"id":"feature","x":530,"y":365,"c":[14]},{"id":"integrator","x":680,"y":365,"c":[15,16]},{"id":"qa_security","x":260,"y":460,"c":[17]},{"id":"qa_quality","x":440,"y":460,"c":[17]},{"id":"qa_manager","x":610,"y":460,"c":[0]}]},
  {"id":"five_minds","name":"Five Minds Protocol","cat":"ENTERPRISE (13+)","desc":"4 ekspertow + Devil's Advocate debatuja.","nodes":[{"id":"orchestrator","x":400,"y":5,"c":[1,2,3,4]},{"id":"res_tech","x":150,"y":100,"c":[5]},{"id":"res_ux","x":320,"y":100,"c":[5]},{"id":"res_github","x":480,"y":100,"c":[5]},{"id":"res_forums","x":650,"y":100,"c":[5]},{"id":"synthesizer","x":400,"y":200,"c":[6,7,8]},{"id":"analyst","x":200,"y":310,"c":[9]},{"id":"designer","x":400,"y":310,"c":[9]},{"id":"frontend","x":600,"y":310,"c":[10]},{"id":"backend","x":300,"y":420,"c":[11]},{"id":"integrator","x":500,"y":420,"c":[12]},{"id":"qa_security","x":300,"y":530,"c":[13]},{"id":"qa_quality","x":500,"y":530,"c":[13]},{"id":"qa_manager","x":400,"y":640,"c":[0]}]},
  {"id":"deep_five_minds","name":"Deep Five Minds","cat":"ENTERPRISE (13+)","desc":"Deep Research + 2x debata Five Minds + 3 bramy HITL. Maksymalny preset.","nodes":[{"id":"orchestrator","x":400,"y":5,"c":[1,2,3]},{"id":"analyst","x":250,"y":80},{"id":"planner","x":400,"y":80},{"id":"synthesizer","x":550,"y":80,"c":[12,13,14,15,16,17]},{"id":"decision_presenter","x":420,"y":135,"c":[5,6,7,8,9,10]},{"id":"res_tech","x":100,"y":200,"c":[11]},{"id":"res_reddit","x":230,"y":200,"c":[11]},{"id":"res_ux","x":360,"y":200,"c":[11]},{"id":"res_github","x":490,"y":200,"c":[11]},{"id":"res_forums","x":620,"y":200,"c":[11]},{"id":"res_x","x":750,"y":200,"c":[11]},{"id":"res_critic","x":250,"y":300,"c":[3]},{"id":"expert_pragmatist","x":400,"y":300,"c":[3]},{"id":"expert_innovator","x":550,"y":300,"c":[3]},{"id":"expert_analyst","x":250,"y":380,"c":[3]},{"id":"expert_user","x":400,"y":380,"c":[3]},{"id":"expert_devil","x":550,"y":380,"c":[3]},{"id":"decision_presenter","x":420,"y":435,"c":[18,19,20,21,22]},{"id":"backend","x":150,"y":500,"c":[23]},{"id":"frontend","x":300,"y":500,"c":[23]},{"id":"feature","x":450,"y":500,"c":[23]},{"id":"designer","x":600,"y":500,"c":[23]},{"id":"integrator","x":750,"y":500,"c":[23]},{"id":"decision_presenter","x":420,"y":565,"c":[24,25]},{"id":"qa_security","x":300,"y":630,"c":[26]},{"id":"qa_quality","x":500,"y":630,"c":[26]},{"id":"qa_manager","x":400,"y":730,"c":[0]}]},
  {"id":"five_minds_strategic","name":"Five Minds Strategic","cat":"ENTERPRISE (13+)","desc":"4 parallel research 5 ekspertow + Devil debata HITL.","tier":"new","nodes":[{"id":"orchestrator","x":400,"y":20,"c":[1,2,3,4],"m":"opus"},{"id":"res_tech","x":120,"y":130,"c":[5],"m":"sonnet"},{"id":"res_reddit","x":300,"y":130,"c":[5],"m":"sonnet"},{"id":"res_forums","x":480,"y":130,"c":[5],"m":"sonnet"},{"id":"res_docs","x":660,"y":130,"c":[5],"m":"sonnet"},{"id":"analyst","x":400,"y":240,"c":[6,7,8,9,10],"m":"opus"},{"id":"expert_innovator","x":100,"y":360,"c":[11],"m":"opus"},{"id":"expert_pragmatist","x":250,"y":360,"c":[11],"m":"opus"},{"id":"expert_analyst","x":400,"y":360,"c":[11],"m":"opus"},{"id":"expert_user","x":550,"y":360,"c":[11],"m":"opus"},{"id":"expert_devil","x":700,"y":360,"c":[11],"m":"opus"},{"id":"synthesizer","x":400,"y":480,"c":[12],"m":"opus"},{"id":"decision_presenter","x":400,"y":600,"c":[0],"m":"sonnet"}]},
];

const TOOL_EXECUTOR_IDS = new Set(['backend', 'frontend', 'feature', 'integrator', 'db_architect', 'observability_engineer', 'eda_analyst', 'telemetry_surfer']);
const QA_IDS = new Set(['qa_security', 'qa_quality', 'qa_perf', 'qa_manager']);
const RESEARCH_IDS = new Set(['res_tech', 'res_ux', 'res_reddit', 'res_x', 'res_github', 'res_forums', 'res_docs', 'res_critic']);
const SYNTHESIS_IDS = new Set(['synthesizer', 'writer', 'decision_presenter']);
const LAB_AGENT_IDS = new Set([
  'orchestrator',
  'synthesizer',
  'analyst',
  'planner',
  'res_tech',
  'res_ux',
  'res_reddit',
  'res_x',
  'res_github',
  'res_forums',
  'res_docs',
  'res_critic',
  'backend',
  'frontend',
  'feature',
  'designer',
  'integrator',
  'writer',
  'qa_security',
  'qa_quality',
  'qa_perf',
  'qa_manager',
  'expert_pragmatist',
  'expert_innovator',
  'expert_analyst',
  'expert_user',
  'expert_devil',
  'decision_presenter',
  'db_architect',
  'observability_engineer',
  'gtm_strategist',
  'statistician',
  'eda_analyst',
  'control_mapper',
  'telemetry_surfer',
]);

function labelFromId(id: string): string {
  return id.split('_').map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`).join(' ');
}

function personaForLabAgent(agentId: string): string {
  if (LAB_AGENT_IDS.has(agentId)) return `lab-${agentId}`;
  if (agentId === 'orchestrator') return 'agent-orchestrator';
  if (agentId === 'planner' || agentId === 'analyst' || agentId === 'statistician') return 'agent-planner';
  if (RESEARCH_IDS.has(agentId)) return 'agent-researcher';
  if (QA_IDS.has(agentId)) return 'agent-qa';
  if (SYNTHESIS_IDS.has(agentId)) return 'agent-synthesizer';
  if (agentId === 'expert_devil' || agentId === 'control_mapper') return 'agent-reviewer';
  if (agentId === 'designer' || agentId === 'expert_user') return 'designer';
  if (agentId === 'gtm_strategist') return 'agent-release-guard';
  if (TOOL_EXECUTOR_IDS.has(agentId)) return 'agent-implementer';
  return 'agent-reviewer';
}

function slotTypeForLabAgent(agentId: string): ArchitectureSchema['roleSlots'][number]['slotType'] {
  if (agentId === 'orchestrator') return 'router';
  if (QA_IDS.has(agentId)) return 'tool_executor';
  if (agentId === 'expert_devil' || agentId === 'res_critic' || agentId === 'control_mapper') return 'critic';
  if (agentId === 'qa_manager' || agentId === 'decision_presenter' || agentId === 'gtm_strategist') return 'judge';
  if (SYNTHESIS_IDS.has(agentId)) return 'finalizer';
  if (TOOL_EXECUTOR_IDS.has(agentId)) return 'tool_executor';
  return 'participant';
}

function createLabPresetSchema(preset: LabPresetDefinition): ArchitectureSchema {
  const nodeIdByIndex = new Map<number, string>();
  const roleSlots = preset.nodes.map((node, index) => {
    const slotId = `${node.id}_${index}`;
    return {
      id: slotId,
      label: labelFromId(node.id),
      description: [preset.desc, node.m ? `Lab model override: ${node.m}` : undefined].filter(Boolean).join(' '),
      slotType: slotTypeForLabAgent(node.id),
      defaultPersonaId: personaForLabAgent(node.id),
      allowedPersonaTags: [preset.cat.toLowerCase(), node.id],
      required: true,
      canOverrideAtRunStart: true,
    };
  });
  const nodes = preset.nodes.map((node, index) => {
    const nodeId = `${node.id}-${index}`;
    nodeIdByIndex.set(index, nodeId);
    return { id: nodeId, label: labelFromId(node.id), kind: slotTypeForLabAgent(node.id) === 'router' ? 'router' as const : 'role' as const, roleSlotId: `${node.id}_${index}`, x: node.x, y: node.y };
  });
  const finalNode = { id: 'final-artifact', label: 'Lab Preset Result', kind: 'artifact' as const, roleSlotId: roleSlots.at(-1)?.id, x: 400, y: Math.max(...preset.nodes.map((node) => node.y)) + 160 };
  const connectedSources = new Set<number>();
  const edges = preset.nodes.flatMap((node, sourceIndex) => (node.c ?? []).map((targetIndex) => {
    connectedSources.add(sourceIndex);
    return { id: `${nodeIdByIndex.get(sourceIndex)}-${nodeIdByIndex.get(targetIndex)}`, fromNodeId: nodeIdByIndex.get(sourceIndex) ?? `${node.id}-${sourceIndex}`, toNodeId: nodeIdByIndex.get(targetIndex) ?? `${preset.nodes[targetIndex]?.id ?? 'node'}-${targetIndex}` };
  }));
  const terminalIndexes = preset.nodes.map((_, index) => index).filter((index) => !connectedSources.has(index));
  const terminalEdges = terminalIndexes.map((index) => ({ id: `${nodeIdByIndex.get(index)}-final`, fromNodeId: nodeIdByIndex.get(index) ?? `node-${index}`, toNodeId: finalNode.id }));
  return {
    id: `lab_${preset.id}`,
    name: `Lab: ${preset.name}`,
    description: `Agent-Architecture-Lab preset ${preset.id} (${preset.cat}). ${preset.desc}`,
    version: '0.1.0',
    roleSlots,
    nodes: [...nodes, finalNode],
    edges: [...edges, ...terminalEdges],
    routerPolicy: { mode: 'evidence_first', mustAddressCriticFindings: true, canReturnNeedsMoreResearch: true },
    contextPolicy: BASE_CONTEXT_POLICY,
    memoryPolicy: { persistFinalArtifact: true, persistRouterDecision: true },
    outputArtifactSchema: 'LabPresetArtifact',
  };
}
export const LAB_PRESET_SCHEMAS: ArchitectureSchema[] = LAB_PRESETS.map(createLabPresetSchema);
