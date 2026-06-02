import {
  Activity,
  Boxes,
  Bot,
  CheckCircle2,
  Code2,
  FileText,
  GitBranch,
  MessageSquareText,
  MonitorPlay,
  Settings2,
  Sparkles,
  TerminalSquare,
  Wrench,
} from 'lucide-react';

const capabilities = [
  { label: 'Chat', detail: 'Conversation-first workspace with agent turns and artifacts.', icon: MessageSquareText },
  { label: 'Tools', detail: 'Inspectable tool calls, terminal output, confirmations, and results.', icon: Wrench },
  { label: 'Files', detail: 'Virtual file context for generated apps, docs, and review evidence.', icon: FileText },
  { label: 'Observability', detail: 'Truth boards and execution traces for verified progress.', icon: Activity },
];

const components = [
  { name: 'Badge', state: 'primary / warning / ghost' },
  { name: 'Panel', state: 'bordered base surface' },
  { name: 'CodeBlock', state: 'copyable syntax frame' },
  { name: 'MarkdownViewer', state: 'GFM and tool-safe rendering' },
  { name: 'AppTile', state: 'RA-App catalog preview' },
];

const graphSteps = ['Goal', 'Delegate', 'Review', 'Verify'];

export function App() {
  const videoSrc = `${import.meta.env.BASE_URL}kalio-overview.mp4`;

  return (
    <main className="demo-shell">
      <nav className="top-nav" aria-label="Kalio demo navigation">
        <a className="brand" href="#top" aria-label="Kalio home">
          <span className="brand-mark">K</span>
          <span>KALIO</span>
        </a>
        <div className="nav-links">
          <a href="#overview">Overview</a>
          <a href="#components">Components</a>
          <a href="#storybook">Storybook</a>
        </div>
      </nav>

      <section id="top" className="hero-section">
        <div className="hero-copy">
          <div className="status-row">
            <span className="status-dot" />
            Static GitHub Pages demo
          </div>
          <h1>Build with agentic workflows</h1>
          <p>
            Kalio brings chat, tools, files, settings, and verification into one compact workspace for
            building with supervised agents.
          </p>
          <div className="hero-actions">
            <a className="primary-action" href="#overview">
              <MonitorPlay size={18} />
              Watch overview
            </a>
            <a className="secondary-action" href="#components">
              <Boxes size={18} />
              Browse components
            </a>
          </div>
        </div>

        <section className="video-card" aria-label="Kalio overview video">
          <div className="video-toolbar">
            <div>
              <strong>KALIO Overview</strong>
              <span>Remotion product trailer</span>
            </div>
            <span className="video-time">00:06</span>
          </div>
          <video className="overview-video" controls muted playsInline preload="none" poster={`${import.meta.env.BASE_URL}poster.svg`}>
            <source src={videoSrc} type="video/mp4" />
          </video>
          <div className="mock-frame" aria-hidden="true">
            <div className="mock-chat">
              <span>Agent turn</span>
              <strong>Draft app shell and verify build evidence.</strong>
            </div>
            <div className="mock-graph">
              {graphSteps.map((step) => (
                <span key={step}>{step}</span>
              ))}
            </div>
          </div>
        </section>
      </section>

      <section id="overview" className="capability-grid" aria-label="Product overview">
        {capabilities.map(({ label, detail, icon: Icon }) => (
          <article className="capability-card" key={label}>
            <Icon size={20} />
            <h2>{label}</h2>
            <p>{detail}</p>
          </article>
        ))}
      </section>

      <section id="components" className="component-section">
        <div className="section-heading">
          <span className="section-icon">
            <Code2 size={18} />
          </span>
          <div>
            <h2>Component gallery</h2>
            <p>Reusable frontend pieces documented in Storybook without extracting a package in v1.</p>
          </div>
        </div>
        <div className="component-board">
          {components.map((component) => (
            <article className="component-row" key={component.name}>
              <CheckCircle2 size={18} />
              <div>
                <strong>{component.name}</strong>
                <span>{component.state}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="storybook" className="storybook-callout">
        <div>
          <h2>Storybook keeps Kalio UI reusable</h2>
          <p>
            The first pass covers the clean shared components: badges, panels, loading states,
            friendly IDs, markdown, and code blocks.
          </p>
        </div>
        <div className="callout-stack">
          <span><Bot size={16} /> Agent UI</span>
          <span><TerminalSquare size={16} /> Tool output</span>
          <span><GitBranch size={16} /> Execution trace</span>
          <span><Settings2 size={16} /> Settings cards</span>
          <span><Sparkles size={16} /> Sky primary</span>
        </div>
      </section>
    </main>
  );
}
