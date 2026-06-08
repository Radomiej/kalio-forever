import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

const assistantText =
  'Got it. I am scanning the repo, composing the demo, rendering the Remotion trailer, and preparing the static GitHub Pages build.';

const toolRuns = [
  { name: 'read_file', detail: 'apps/kalio-web/src/components', start: 34, done: 74 },
  { name: 'rg search', detail: 'stories, panel, markdown, spinner', start: 58, done: 104 },
  { name: 'remotion still', detail: 'frame 30 + graph checkpoint', start: 92, done: 146 },
  { name: 'vite build', detail: 'apps/kalio-demo/dist', start: 128, done: 182 },
];

const graphNodes = [
  { label: 'Goal', sublabel: 'request', x: 90, y: 278, start: 150 },
  { label: 'Plan', sublabel: 'steps', x: 394, y: 128, start: 166 },
  { label: 'Chat Stream', sublabel: 'tokens', x: 704, y: 278, start: 184 },
  { label: 'Tool Calls', sublabel: 'evidence', x: 394, y: 458, start: 202 },
  { label: 'Review', sublabel: 'checks', x: 704, y: 536, start: 222 },
  { label: 'Demo Build', sublabel: 'artifact', x: 1014, y: 458, start: 242 },
];

const edges = [
  [0, 1],
  [1, 2],
  [1, 3],
  [3, 4],
  [2, 5],
  [4, 5],
] as const;

function visible(frame: number, start: number, end: number) {
  return interpolate(frame, [start, end], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
}

function ChatMessage() {
  const frame = useCurrentFrame();
  const typedCharacters = Math.floor(
    interpolate(frame, [16, 130], [0, assistantText.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const cursorVisible = Math.floor(frame / 10) % 2 === 0 && typedCharacters < assistantText.length;

  return (
    <div style={{ display: 'grid', gap: 18 }}>
      <div
        style={{
          justifySelf: 'end',
          maxWidth: 610,
          padding: '22px 26px',
          borderRadius: 18,
          background: 'rgba(14, 165, 233, 0.18)',
          border: '1px solid rgba(56, 189, 248, 0.42)',
          color: '#f8fafc',
          fontSize: 26,
          lineHeight: 1.28,
          fontWeight: 700,
        }}
      >
        Build a public Kalio demo and show how the agent works.
      </div>
      <div
        style={{
          maxWidth: 760,
          minHeight: 198,
          padding: '24px 28px',
          borderRadius: 20,
          background: 'rgba(15, 23, 42, 0.9)',
          border: '1px solid rgba(148, 163, 184, 0.22)',
          boxShadow: '0 24px 80px rgba(2, 6, 23, 0.42)',
        }}
      >
        <div style={{ color: '#7dd3fc', fontSize: 18, fontWeight: 900, marginBottom: 12 }}>KALIO AGENT</div>
        <div style={{ color: '#e2e8f0', fontSize: 28, lineHeight: 1.36, fontWeight: 650 }}>
          {assistantText.slice(0, typedCharacters)}
          <span style={{ color: '#38bdf8', opacity: cursorVisible ? 1 : 0 }}>|</span>
        </div>
      </div>
    </div>
  );
}

function ToolActivity() {
  const frame = useCurrentFrame();

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {toolRuns.map((tool) => {
        const rowOpacity = visible(frame, tool.start, tool.start + 12);
        const complete = frame >= tool.done;
        const progress = visible(frame, tool.start, tool.done);
        return (
          <div
            key={tool.name}
            style={{
              opacity: rowOpacity,
              transform: `translateX(${interpolate(rowOpacity, [0, 1], [28, 0])}px)`,
              padding: 18,
              borderRadius: 16,
              background: complete ? 'rgba(20, 184, 166, 0.11)' : 'rgba(2, 6, 23, 0.64)',
              border: `1px solid ${complete ? 'rgba(45, 212, 191, 0.42)' : 'rgba(56, 189, 248, 0.26)'}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center' }}>
              <div>
                <div style={{ color: '#f8fafc', fontSize: 23, fontWeight: 900 }}>{tool.name}</div>
                <div style={{ color: 'rgba(203, 213, 225, 0.72)', fontSize: 18, marginTop: 6 }}>{tool.detail}</div>
              </div>
              <div
                style={{
                  minWidth: 96,
                  textAlign: 'center',
                  padding: '9px 12px',
                  borderRadius: 999,
                  color: complete ? '#99f6e4' : '#bae6fd',
                  background: complete ? 'rgba(20, 184, 166, 0.16)' : 'rgba(14, 165, 233, 0.15)',
                  fontSize: 16,
                  fontWeight: 900,
                }}
              >
                {complete ? 'DONE' : 'RUNNING'}
              </div>
            </div>
            <div style={{ height: 5, marginTop: 14, borderRadius: 999, background: 'rgba(148, 163, 184, 0.16)' }}>
              <div
                style={{
                  width: `${Math.round(progress * 100)}%`,
                  height: '100%',
                  borderRadius: 999,
                  background: complete ? '#2dd4bf' : '#38bdf8',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ExecutionGraph() {
  const frame = useCurrentFrame();
  const graphOpacity = visible(frame, 138, 172);
  const graphScale = interpolate(graphOpacity, [0, 1], [0.94, 1]);
  const nodeWidth = 222;
  const nodeHeight = 92;
  const pinRadius = 8;

  return (
    <div
      style={{
        opacity: graphOpacity,
        transform: `scale(${graphScale})`,
        position: 'absolute',
        inset: 0,
        padding: 30,
      }}
    >
      <svg width="100%" height="100%" viewBox="0 0 1326 720" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <filter id="activeGlow" x="-40%" y="-60%" width="180%" height="220%">
            <feGaussianBlur stdDeviation="14" result="blur" />
            <feFlood floodColor="#0ea5e9" floodOpacity="0.38" />
            <feComposite in2="blur" operator="in" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="edgeGradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.72" />
          </linearGradient>
        </defs>
        {edges.map(([from, to]) => {
          const a = graphNodes[from];
          const b = graphNodes[to];
          const edgeOpacity = visible(frame, Math.max(a.start, b.start) - 10, Math.max(a.start, b.start) + 16);
          const startX = a.x + nodeWidth;
          const startY = a.y + nodeHeight / 2;
          const endX = b.x;
          const endY = b.y + nodeHeight / 2;
          const midX = startX + Math.max(80, (endX - startX) / 2);

          return (
            <path
              key={`${a.label}-${b.label}`}
              d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
              fill="none"
              stroke="url(#edgeGradient)"
              strokeLinecap="round"
              strokeWidth="4"
              opacity={edgeOpacity}
            />
          );
        })}
        {graphNodes.map((node, index) => {
          const nodeOpacity = visible(frame, node.start, node.start + 18);
          const active = frame >= node.start && frame < node.start + 44;
          const accent = index === graphNodes.length - 1 ? '#2dd4bf' : '#38bdf8';
          const fill = active ? 'rgba(14, 165, 233, 0.22)' : 'rgba(15, 23, 42, 0.92)';
          const stroke = active ? 'rgba(125, 211, 252, 0.95)' : 'rgba(148, 163, 184, 0.30)';
          const translateY = interpolate(nodeOpacity, [0, 1], [22, 0]);

          return (
            <g key={node.label} opacity={nodeOpacity} transform={`translate(0 ${translateY})`}>
              <rect
                x={node.x}
                y={node.y}
                width={nodeWidth}
                height={nodeHeight}
                rx="18"
                fill={fill}
                stroke={stroke}
                strokeWidth="2"
                filter={active ? 'url(#activeGlow)' : undefined}
              />
              <circle
                cx={node.x}
                cy={node.y + nodeHeight / 2}
                r={pinRadius}
                fill="#020617"
                stroke={accent}
                strokeWidth="4"
              />
              <circle
                cx={node.x + nodeWidth}
                cy={node.y + nodeHeight / 2}
                r={pinRadius}
                fill="#020617"
                stroke={accent}
                strokeWidth="4"
              />
              <text x={node.x + 26} y={node.y + 40} fill="#f8fafc" fontSize="25" fontWeight="900">
                {node.label}
              </text>
              <text x={node.x + 26} y={node.y + 66} fill="rgba(203, 213, 225, 0.68)" fontSize="17" fontWeight="800">
                {node.sublabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function KalioOverview() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const intro = spring({ frame, fps, config: { damping: 18, stiffness: 90 } });
  const chatShift = interpolate(frame, [130, 174], [0, -980], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const toolsShift = interpolate(frame, [138, 174], [0, 920], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const graphTitleOpacity = visible(frame, 156, 188);

  return (
    <AbsoluteFill
      style={{
        fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        background:
          'radial-gradient(circle at 10% 0%, rgba(14, 165, 233, 0.24), transparent 560px), linear-gradient(135deg, #07111c, #0f172a 58%, #081019)',
        color: '#e5edf8',
        padding: 62,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          opacity: intro,
          transform: `translateY(${interpolate(intro, [0, 1], [18, 0])}px)`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
        }}
      >
        <div>
          <div style={{ color: '#7dd3fc', fontSize: 26, fontWeight: 900 }}>KALIO LIVE RUN</div>
          <h1 style={{ margin: '14px 0 0', fontSize: 68, lineHeight: 0.96, color: '#f8fafc' }}>
            Streaming chat to execution graph
          </h1>
        </div>
        <div
          style={{
            padding: '14px 18px',
            borderRadius: 999,
            border: '1px solid rgba(56, 189, 248, 0.34)',
            background: 'rgba(14, 165, 233, 0.12)',
            color: '#bae6fd',
            fontSize: 20,
            fontWeight: 900,
          }}
        >
          00:{String(Math.min(10, Math.floor(frame / fps))).padStart(2, '0')}
        </div>
      </div>

      <div
        style={{
          position: 'relative',
          marginTop: 38,
          height: 780,
          borderRadius: 28,
          border: '1px solid rgba(148, 163, 184, 0.16)',
          background: 'rgba(2, 6, 23, 0.48)',
          boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: 34,
            top: 34,
            width: 840,
            transform: `translateX(${chatShift}px)`,
          }}
        >
          <div style={{ color: '#cbd5e1', fontSize: 20, fontWeight: 900, marginBottom: 18 }}>CHAT STREAM</div>
          <ChatMessage />
        </div>

        <div
          style={{
            position: 'absolute',
            right: 34,
            top: 34,
            width: 760,
            transform: `translateX(${toolsShift}px)`,
          }}
        >
          <div style={{ color: '#cbd5e1', fontSize: 20, fontWeight: 900, marginBottom: 18 }}>TOOL EXECUTION</div>
          <ToolActivity />
        </div>

        <div
          style={{
            position: 'absolute',
            left: 44,
            top: 28,
            opacity: graphTitleOpacity,
            color: '#cbd5e1',
            fontSize: 20,
            fontWeight: 900,
            letterSpacing: 0,
          }}
        >
          EXECUTION GRAPH
        </div>
        <ExecutionGraph />

        <div
          style={{
            position: 'absolute',
            left: 44,
            right: 44,
            bottom: 28,
            display: 'flex',
            justifyContent: 'space-between',
            gap: 18,
            opacity: visible(frame, 228, 258),
          }}
        >
          {['Traceable agent work', 'Tool evidence attached', 'Static demo ready'].map((item) => (
            <div
              key={item}
              style={{
                flex: 1,
                padding: '18px 20px',
                borderRadius: 16,
                background: 'rgba(20, 184, 166, 0.11)',
                border: '1px solid rgba(45, 212, 191, 0.35)',
                color: '#ccfbf1',
                fontSize: 22,
                fontWeight: 900,
                textAlign: 'center',
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
}
