import type { Persona, Project } from '@kalio/types';
import type { ArchitectSchema } from '../../architect/architect.types';
import { NewChatScreen } from '../launch/NewChatScreen';

type GraphLaunchStateProps = {
  architectures: ArchitectSchema[];
  graphSurfaceClassName: string;
  heading: string;
  error?: string | null;
  isBusy: boolean;
  onArchitectureChange: (schemaId: string) => void;
  onDraftChange: (content: string) => void;
  onPersonaChange: (personaId: string) => void;
  onProjectPathChange: (projectPath: string) => void;
  onProjectChange?: (project: Project) => void;
  onRunPrompt: (content: string) => void;
  personas: Persona[];
  projectPath: string;
  projectId?: string;
  screenKey: string;
  selectedPersonaId: string;
  selectedArchitectureId: string;
};

function GraphLaunchState({
  architectures,
  graphSurfaceClassName,
  heading,
  error,
  isBusy,
  onArchitectureChange,
  onDraftChange,
  onPersonaChange,
  onProjectPathChange,
  onProjectChange,
  onRunPrompt,
  personas,
  projectPath,
  projectId,
  screenKey,
  selectedPersonaId,
  selectedArchitectureId,
}: GraphLaunchStateProps) {
  return (
    <div className={graphSurfaceClassName}>
      <NewChatScreen
        key={screenKey}
        architectures={architectures}
        error={error}
        heading={heading}
        isBusy={isBusy}
        onArchitectureChange={onArchitectureChange}
        onDraftChange={onDraftChange}
        onPersonaChange={onPersonaChange}
        onProjectPathChange={onProjectPathChange}
        onProjectChange={onProjectChange}
        onRunPrompt={onRunPrompt}
        personas={personas}
        projectPath={projectPath}
        projectId={projectId}
        selectedPersonaId={selectedPersonaId}
        selectedArchitectureId={selectedArchitectureId}
        subtitle="AI assistant - build apps, query data, generate images, run tools"
        testIdPrefix="graph-empty"
      />
    </div>
  );
}

export function ExecutionGraphNoSessionState(props: GraphLaunchStateProps) {
  return <GraphLaunchState {...props} />;
}

export function ExecutionGraphNoNodesState(props: GraphLaunchStateProps) {
  return <GraphLaunchState {...props} />;
}
