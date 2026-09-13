import { NativeCliIntegrationsPanel } from './NativeCliIntegrationsPanel';
import { CodeIntelligencePanel } from './CodeIntelligencePanel';

export function IntegrationsPanel() {
  return <div className="flex flex-col gap-5"><NativeCliIntegrationsPanel /><div className="divider my-0" /><CodeIntelligencePanel /></div>;
}
