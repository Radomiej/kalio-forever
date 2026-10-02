import { useState } from 'react';
import { LLMPanel } from './LLMPanel';
import { DecisionSettingsPanel } from './DecisionSettingsPanel';

export function AgentSettingsPanel() {
  const [section, setSection] = useState<'llm' | 'decision'>('llm');
  return <div className="space-y-5">
    <h2 className="text-lg font-semibold">Agent Settings</h2>
    <div className="flex flex-wrap gap-2" role="group" aria-label="Agent settings sections">
      <button type="button" aria-pressed={section === 'llm'} className={`btn btn-sm ${section === 'llm' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSection('llm')}>LLM Settings</button>
      <button type="button" aria-pressed={section === 'decision'} className={`btn btn-sm ${section === 'decision' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setSection('decision')}>Decision Settings</button>
    </div>
    {section === 'llm' ? <LLMPanel mode="runtime" /> : <DecisionSettingsPanel />}
  </div>;
}
