import { useCallback, useEffect, useState } from 'react';
import type { ChatSession, Project } from '@kalio/types';
import { assignSessionProject } from '../../services/apiClient';
import { getLaunchProjectPath } from './launch/launchContext';

export function useChatProjectSelection({
  activeSession,
  activeSessionId,
  updateSession,
  onError,
}: {
  activeSession: ChatSession | null;
  activeSessionId: string | null;
  updateSession: (sessionId: string, patch: Partial<ChatSession>) => void;
  onError: (message: string) => void;
}): {
  projectPath: string;
  setProjectPath: (value: string) => void;
  projectId: string;
  handleProjectChange: (project: Project) => Promise<void>;
} {
  const [projectPath, setProjectPath] = useState('');
  const [projectId, setProjectId] = useState('system:none');

  useEffect(() => {
    setProjectPath(getLaunchProjectPath(activeSession?.runtimeContext));
    setProjectId(activeSession?.projectId ?? 'system:none');
  }, [activeSession?.runtimeContext, activeSession?.projectId, activeSessionId]);

  const handleProjectChange = useCallback(async (project: Project) => {
    setProjectId(project.id);
    setProjectPath(project.path ?? '');
    if (!activeSessionId || activeSession?.projectId === project.id) return;
    try {
      const response = await assignSessionProject(activeSessionId, {
        projectId: project.id,
        pathOverride: project.path,
      });
      updateSession(response.id, response);
    } catch (error: unknown) {
      console.error('[ChatInterface] project assignment failed', error instanceof Error ? error : new Error(String(error)));
      onError('Nie udało się przypisać projektu do tego chatu.');
    }
  }, [activeSession?.projectId, activeSessionId, onError, updateSession]);

  return { projectPath, setProjectPath, projectId, handleProjectChange };
}
