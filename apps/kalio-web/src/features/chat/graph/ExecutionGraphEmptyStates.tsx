import type { ReactNode } from 'react';
import type { ArchitectSchema } from '../../architect/architect.types';
import type { Persona } from '@kalio/types';
import { ConversationLaunchScreen } from '../launch/ConversationLaunchScreen';

type GraphLaunchStateProps = {
  activePersonaId: string;
  architectures: ArchitectSchema[];
  graphSurfaceClassName: string;
  heading: string;
  error?: string | null;
  isBusy: boolean;
  liveActivitySidebar: ReactNode;
  onArchitectureChange: (schemaId: string) => void;
  onDraftChange: (content: string) => void;
  onPersonaChange: (personaId: string) => void;
  onProjectPathChange: (projectPath: string) => void;
  onRunPrompt: (content: string) => void;
  personas: Persona[];
  projectPath: string;
  selectedArchitectureId: string;
};

function GraphLaunchState({
  activePersonaId,
  architectures,
  graphSurfaceClassName,
  heading,
  error,
  isBusy,
  liveActivitySidebar,
  onArchitectureChange,
  onDraftChange,
  onPersonaChange,
  onProjectPathChange,
  onRunPrompt,
  personas,
  projectPath,
  selectedArchitectureId,
}: GraphLaunchStateProps) {
  return (
    <div className={graphSurfaceClassName}>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,760px)_auto]">
        <section className="w-full max-w-[760px] rounded-lg border border-sky-500/15 bg-[#101b2d]/92 px-4 py-4 text-sky-50 shadow-[0_18px_38px_rgba(2,12,27,0.28)]">
          <ConversationLaunchScreen
            activePersonaId={activePersonaId}
            architectures={architectures}
            error={error}
            heading={heading}
            isBusy={isBusy}
            onArchitectureChange={onArchitectureChange}
            onDraftChange={onDraftChange}
            onPersonaChange={onPersonaChange}
            onProjectPathChange={onProjectPathChange}
            onRunPrompt={onRunPrompt}
            personas={personas}
            projectPath={projectPath}
            selectedArchitectureId={selectedArchitectureId}
            subtitle="AI assistant - build apps, query data, generate images, run tools"
            testIdPrefix="graph-empty"
          />
        </section>

        {liveActivitySidebar}
      </div>
    </div>
  );
}

export function ExecutionGraphNoSessionState(props: GraphLaunchStateProps) {
  return <GraphLaunchState {...props} />;
}

export function ExecutionGraphNoNodesState(props: GraphLaunchStateProps) {
  return <GraphLaunchState {...props} />;
}
