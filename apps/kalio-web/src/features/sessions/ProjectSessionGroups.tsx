import { ChevronDown, Folder } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Project } from '@kalio/types';
import type { ProjectSessionGroup } from './projectSessionListModel';

export interface ProjectSessionGroupsProps {
  groups: ProjectSessionGroup[];
  children: (entries: ProjectSessionGroup['entries'], project: Project) => ReactNode;
}

export function ProjectSessionGroups({ groups, children }: ProjectSessionGroupsProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const activeGroup = groups.find((group) => group.isExpanded);
    setExpandedIds((current) => {
      if (activeGroup) {
        return current.has(activeGroup.project.id)
          ? current
          : new Set([...current, activeGroup.project.id]);
      }

      if (current.size > 0) return current;
      return new Set(groups.filter((group) => group.entries.length > 0).map((group) => group.project.id));
    });
  }, [groups]);

  return (
    <div className="space-y-1 p-1" data-testid="project-session-groups">
      {groups.map((group) => {
        const expanded = expandedIds.has(group.project.id) || group.isExpanded;
        return (
          <section key={group.project.id} className="overflow-hidden rounded-lg border border-base-300/70">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-base-200/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              aria-expanded={expanded}
              onClick={() => setExpandedIds((current) => {
                const next = new Set(current);
                if (next.has(group.project.id)) next.delete(group.project.id); else next.add(group.project.id);
                return next;
              })}
              data-testid={`project-group-${group.project.id}`}
            >
              <ChevronDown size={13} className={`shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />
              <Folder size={14} className="shrink-0 text-base-content/50" />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold">{group.project.name}</span>
              <span className="text-[10px] text-base-content/40">{group.entries.length}</span>
            </button>
            {expanded && children(group.entries, group.project)}
          </section>
        );
      })}
    </div>
  );
}
