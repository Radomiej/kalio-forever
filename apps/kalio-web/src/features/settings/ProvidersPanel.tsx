import { LLMPanel } from './LLMPanel';
import { DecisionProviderCredentials } from './DecisionProviderCredentials';

export function ProvidersPanel() {
  return <div className="space-y-6"><LLMPanel mode="providers" /><DecisionProviderCredentials /></div>;
}
