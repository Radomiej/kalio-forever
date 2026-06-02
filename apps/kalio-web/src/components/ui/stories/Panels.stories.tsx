import type { Meta, StoryObj } from '@storybook/react-vite';
import { Activity, CheckCircle2, FileText, Settings2, Terminal, Wrench } from 'lucide-react';
import { Badge } from '../Badge';
import { Panel } from '../Panel';
import { Spinner } from '../Spinner';

const meta = {
  title: 'UI/Panels',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function PanelHeader({ title, icon: Icon }: { title: string; icon: typeof Activity }) {
  return (
    <div className="flex items-center gap-2 border-b border-base-300 px-4 py-2">
      <Icon size={14} className="text-primary" />
      <span className="text-sm font-semibold">{title}</span>
    </div>
  );
}

export const WorkspacePanels: Story = {
  render: () => (
    <div className="min-h-screen bg-base-100 p-6 text-base-content">
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel className="min-h-80 overflow-hidden">
          <PanelHeader title="Execution graph" icon={Activity} />
          <div className="grid h-full grid-cols-4 gap-3 p-4">
            {['Goal', 'Delegate', 'Review', 'Verify'].map((step, index) => (
              <div
                key={step}
                className={`grid min-h-28 place-items-center rounded-lg border text-xs font-semibold ${
                  index === 1
                    ? 'border-primary/70 bg-primary/10 text-primary'
                    : 'border-base-300 bg-base-100 text-base-content/70'
                }`}
              >
                {step}
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="min-h-80 overflow-hidden">
          <PanelHeader title="Tool activity" icon={Wrench} />
          <div className="space-y-2 p-4">
            {[
              ['read_file', '120ms', 'success'],
              ['grep_search', '98ms', 'success'],
              ['render_video', '3.2s', 'warning'],
            ].map(([name, time, variant]) => (
              <div key={name} className="flex items-center justify-between rounded-lg border border-base-300 bg-base-100 px-3 py-2">
                <span className="font-mono text-xs text-base-content/80">{name}</span>
                <Badge label={time} variant={variant as 'success' | 'warning'} />
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Terminal output" icon={Terminal} />
          <pre className="m-4 rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300">
            {['$ pnpm build', 'info  compiling workspace', 'success  verified artifact'].join('\n')}
          </pre>
        </Panel>

        <Panel className="overflow-hidden">
          <PanelHeader title="Files and settings" icon={FileText} />
          <div className="grid gap-3 p-4">
            <div className="flex items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2">
              <CheckCircle2 size={14} className="text-success" />
              <span className="text-xs">dist artifact attached</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2">
              <Settings2 size={14} className="text-primary" />
              <span className="text-xs">provider config locked</span>
              <Spinner size="xs" />
            </div>
          </div>
        </Panel>
      </div>
    </div>
  ),
};
