import { useState, useRef, useEffect } from "react";

/* ─── DESIGN TOKENS (from HardwareTycoonR DS) ─── */
const DS = {
  primary:      "#0ea5e9",
  primaryDark:  "#0284c7",
  blueDeep:     "#0d47a1",
  blueBorder:   "#1A4E96",
  blue950:      "#172554",
  secondary:    "#f1913c",
  accent:       "#fbbf24",
  success:      "#4ade80",
  successDark:  "#00D535",
  danger:       "#D50000",
  bg:           "#0b1a3a",
  shadowInset:  "inset 0 -5px 0 rgba(0,0,0,0.25)",
  shadowFrame:  "0px 4px 10px 0px rgba(0,0,0,1)",
  shadowCard:   "3px 9px 4.7px 0px rgba(0,0,0,0.36)",
  fontMain:     "'Montserrat', sans-serif",
  fontAlt:      "'Montserrat Alternates', sans-serif",
};

/* ─── OUTLINED TEXT (paint-order stroke fill) ─── */
function OT({ children, stroke = 3, color = "#1A4E96", size = 14, bold = true, className = "", style = {} }) {
  return (
    <span style={{
      fontFamily: DS.fontAlt,
      fontWeight: bold ? 700 : 400,
      fontSize: size,
      color: "white",
      WebkitTextStroke: `${stroke}px ${color}`,
      paintOrder: "stroke fill",
      ...style,
    }} className={className}>{children}</span>
  );
}

/* ─── GAME BUTTON ─── */
function GameBtn({ children, variant = "primary", onClick, style = {}, small = false }) {
  const bgs = {
    primary: DS.primary,
    secondary: DS.secondary,
    confirm: DS.successDark,
    reject: DS.danger,
    accent: DS.accent,
    disabled: "#9ca3af",
  };
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      padding: small ? "5px 10px" : "8px 16px",
      borderRadius: 6,
      border: `1px solid ${DS.blue950}`,
      background: bgs[variant] || DS.primary,
      boxShadow: DS.shadowInset,
      cursor: "pointer",
      fontFamily: DS.fontMain,
      fontWeight: 700,
      fontSize: small ? 12 : 14,
      color: "white",
      WebkitTextStroke: variant === "accent" ? "1px rgba(0,0,0,0.3)" : `2px ${DS.blueBorder}`,
      paintOrder: "stroke fill",
      transition: "filter 0.1s, transform 0.1s",
      ...style,
    }}
    onMouseEnter={e => e.currentTarget.style.filter = "brightness(1.1)"}
    onMouseLeave={e => e.currentTarget.style.filter = ""}
    onMouseDown={e => e.currentTarget.style.transform = "translateY(2px)"}
    onMouseUp={e => e.currentTarget.style.transform = ""}
    >{children}</button>
  );
}

/* ─── ICON BUTTON (footer nav style) ─── */
function IconBtn({ children, orange = false, active = false, title = "", onClick }) {
  return (
    <div title={title} onClick={onClick} style={{
      width: 56, height: 56, borderRadius: 12,
      background: active ? DS.secondary : (orange ? DS.secondary : DS.primary),
      border: `1px solid ${DS.blueBorder}`,
      boxShadow: `${DS.shadowInset}, ${DS.shadowFrame}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer", fontSize: 22,
      transition: "filter 0.1s, transform 0.1s",
      flexShrink: 0,
    }}
    onMouseEnter={e => { e.currentTarget.style.filter = "brightness(1.15)"; e.currentTarget.style.transform = "scale(1.05)"; }}
    onMouseLeave={e => { e.currentTarget.style.filter = ""; e.currentTarget.style.transform = ""; }}
    >{children}</div>
  );
}

/* ─── RESOURCE PILL ─── */
function ResourcePill({ icon, value, delta }) {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: DS.primary,
      border: `1px solid ${DS.blueBorder}`,
      borderRadius: 6, padding: "3px 10px", height: 30,
    }}>
      <span style={{ fontSize: 14 }}>{icon}</span>
      <OT size={12} stroke={1.5}>{value}</OT>
      {delta && <span style={{ fontSize: 10, fontWeight: 700, color: DS.successDark, fontFamily: DS.fontMain }}>{delta}</span>}
    </div>
  );
}

/* ─── INFO CARD BAR (edge-to-edge, top+bottom border only) ─── */
function InfoCardBar({ icon, title }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
      width: "100%", background: DS.primary, height: 52,
      borderTop: `2px solid ${DS.blue950}`,
      borderBottom: `2px solid ${DS.blue950}`,
      boxShadow: DS.shadowInset,
    }}>
      <span style={{ fontSize: 24 }}>{icon}</span>
      <OT size={18} stroke={3}>{title}</OT>
    </div>
  );
}

/* ─── BOOKMARK TABS ─── */
function BookmarkTabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "center", gap: 2 }}>
      {tabs.map((tab, i) => (
        <div key={tab} onClick={() => onChange(i)} style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "0 14px",
          borderRadius: "0 0 6px 6px",
          border: `1px solid ${DS.blue950}`,
          cursor: "pointer",
          fontFamily: DS.fontAlt, fontWeight: 700, fontSize: 11,
          color: "white",
          WebkitTextStroke: `1.5px ${DS.blueBorder}`,
          paintOrder: "stroke fill",
          boxShadow: DS.shadowInset,
          background: i === active ? DS.secondary : DS.primary,
          height: i === active ? 40 : 28,
          marginTop: i === active ? 0 : 4,
          whiteSpace: "nowrap",
          transition: "background 0.15s, height 0.15s",
        }}
        onMouseEnter={e => { if (i !== active) e.currentTarget.style.filter = "brightness(1.1)"; }}
        onMouseLeave={e => e.currentTarget.style.filter = ""}
        >{tab}</div>
      ))}
    </div>
  );
}

/* ─── TAG ─── */
function Tag({ children, color = "blue" }) {
  const styles = {
    blue:   { bg: "rgba(14,165,233,0.2)", border: DS.primary, color: "#7dd3fc" },
    orange: { bg: "rgba(241,145,60,0.2)", border: DS.secondary, color: "#fed7aa" },
    green:  { bg: "rgba(74,222,128,0.2)", border: DS.success, color: "#86efac" },
    red:    { bg: "rgba(213,0,0,0.2)", border: DS.danger, color: "#fca5a5" },
    gold:   { bg: "rgba(251,191,36,0.2)", border: DS.accent, color: "#fde68a" },
  };
  const s = styles[color] || styles.blue;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center",
      padding: "2px 9px", borderRadius: 99,
      fontSize: 10, fontWeight: 700,
      background: s.bg, border: `1px solid ${s.border}`, color: s.color,
      fontFamily: DS.fontMain,
    }}>{children}</span>
  );
}

/* ─── PROGRESS BAR ─── */
function ProgressBar({ value, max, color = "blue" }) {
  const pct = Math.min(100, (value / max) * 100);
  const fills = {
    blue:   `linear-gradient(90deg, ${DS.primaryDark}, ${DS.primary})`,
    orange: `linear-gradient(90deg, #c85e10, ${DS.secondary})`,
    green:  `linear-gradient(90deg, #16a34a, ${DS.success})`,
  };
  return (
    <div style={{
      height: 12, background: "rgba(0,0,0,0.3)", borderRadius: 99,
      border: `1px solid ${DS.blueBorder}`, overflow: "hidden",
    }}>
      <div style={{
        height: "100%", borderRadius: 99,
        background: fills[color],
        boxShadow: `0 0 8px rgba(14,165,233,0.6)`,
        width: `${pct}%`,
        transition: "width 0.4s ease",
      }} />
    </div>
  );
}

/* ─── STATE DOT ─── */
function StateDot({ status }) {
  const c = { done: "#4ade80", running: "#fbbf24", pending: "#6b7280", error: DS.danger };
  return (
    <div style={{
      width: 9, height: 9, borderRadius: "50%",
      background: c[status] || c.pending,
      boxShadow: status !== "pending" ? `0 0 5px ${c[status]}` : "none",
      flexShrink: 0,
      animation: status === "running" ? "pulse 1s infinite" : "none",
    }} />
  );
}

/* ─── AGENT BADGE ─── */
function AgentBadge({ name, status, icon }) {
  const borderC = { done: DS.success, running: DS.accent, pending: "#374151" };
  const bgC = {
    done: "rgba(74,222,128,0.15)",
    running: "rgba(251,191,36,0.15)",
    pending: "rgba(55,65,81,0.3)",
  };
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
      padding: "8px 14px",
      borderRadius: 10,
      border: `2px solid ${borderC[status] || borderC.pending}`,
      background: bgC[status] || bgC.pending,
      minWidth: 70,
    }}>
      <span style={{ fontSize: 18 }}>{icon}</span>
      <OT size={11} stroke={1.5} color={borderC[status]}>{name}</OT>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <StateDot status={status} />
        <span style={{ fontSize: 9, fontFamily: DS.fontMain, fontWeight: 700, color: borderC[status] || "#6b7280" }}>
          {status.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

/* ─── TOOL RESULT CARD ─── */
function ToolCard({ tool, file, lines, status }) {
  return (
    <div style={{
      background: "rgba(14,165,233,0.12)",
      border: `1px solid ${DS.blueBorder}`,
      borderRadius: 8,
      padding: "10px 14px",
      display: "flex", alignItems: "center", gap: 12,
      boxShadow: DS.shadowCard,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 8, flexShrink: 0,
        background: DS.blueDeep,
        border: `1px solid ${DS.primary}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 18,
      }}>🔧</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <OT size={13} stroke={2}>{tool}</OT>
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "#7dd3fc", marginTop: 1 }}>{file}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontFamily: DS.fontMain, marginTop: 1 }}>{lines} lines</div>
      </div>
      <Tag color="green">✅ DONE</Tag>
    </div>
  );
}

/* ─── PIPELINE CARD ─── */
function PipelineCard({ agents, task }) {
  return (
    <div style={{
      background: "rgba(13,71,161,0.5)",
      border: `1px solid ${DS.blueBorder}`,
      borderRadius: 8,
      padding: "12px 14px",
      boxShadow: DS.shadowCard,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 16 }}>🤖</span>
        <OT size={13} stroke={2}>Orchestrator Pipeline</OT>
        <div style={{ flex: 1 }} />
        <Tag color="orange">RUNNING</Tag>
      </div>
      <div style={{ fontFamily: "monospace", fontSize: 10, color: "rgba(255,255,255,0.4)", marginBottom: 10 }}>⚡ {task}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {agents.map(a => <AgentBadge key={a.name} {...a} />)}
      </div>
      <ProgressBar value={55} max={100} color="blue" />
    </div>
  );
}

/* ─── MESSAGE BUBBLE ─── */
function Message({ msg }) {
  if (msg.role === "user") return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
      <div style={{
        maxWidth: "72%",
        background: `linear-gradient(135deg, ${DS.blueDeep} 0%, #1e40af 100%)`,
        border: `1px solid ${DS.blueBorder}`,
        borderRadius: "10px 10px 2px 10px",
        padding: "10px 14px",
        boxShadow: DS.shadowCard,
      }}>
        <p style={{ fontFamily: DS.fontMain, fontSize: 13, color: "rgba(255,255,255,0.9)", lineHeight: 1.5 }}>{msg.content}</p>
        <p style={{ textAlign: "right", marginTop: 4, fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: DS.fontMain }}>{msg.time}</p>
      </div>
    </div>
  );

  if (msg.role === "pipeline") return <div style={{ marginBottom: 12 }}><PipelineCard agents={msg.agents} task={msg.task} /></div>;
  if (msg.role === "tool") return <div style={{ marginBottom: 12 }}><ToolCard {...msg} /></div>;

  if (msg.role === "assistant") {
    const parts = msg.content.split(/(\*\*[^*]+\*\*)/g);
    return (
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 8, flexShrink: 0, marginTop: 2,
          background: DS.blueDeep, border: `1px solid ${DS.primary}`,
          boxShadow: `0 0 12px rgba(14,165,233,0.4)`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 13, fontFamily: DS.fontAlt, fontWeight: 900, color: "white",
          WebkitTextStroke: `2px ${DS.blueBorder}`, paintOrder: "stroke fill",
        }}>K</div>
        <div style={{
          maxWidth: "78%",
          background: "rgba(13,71,161,0.35)",
          border: `1px solid ${DS.blueBorder}`,
          borderRadius: "2px 10px 10px 10px",
          padding: "10px 14px",
          boxShadow: DS.shadowCard,
        }}>
          <p style={{ fontFamily: DS.fontMain, fontSize: 13, color: "#f0f6ff", lineHeight: 1.55 }}>
            {parts.map((p, i) =>
              p.startsWith("**") ? (
                <OT key={i} size={13} stroke={2} color={DS.blueBorder}>{p.slice(2,-2)}</OT>
              ) : p
            )}
          </p>
          <p style={{ marginTop: 6, fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: DS.fontMain }}>{msg.time}</p>
        </div>
      </div>
    );
  }
}

/* ─── VFS FILE BROWSER PANEL ─── */
function VFSPanel({ onClose }) {
  const files = [
    { name: "BVHTree.ts", path: "/src/collision/", size: "4.2 KB", type: "TS", isNew: true },
    { name: "AABB.ts", path: "/src/collision/", size: "1.8 KB", type: "TS" },
    { name: "combat-hud-v2.html", path: "/design/", size: "12 KB", type: "HTML" },
    { name: "perf-report.json", path: "/output/", size: "890 B", type: "JSON" },
  ];
  const typeColor = { TS: DS.primary, HTML: DS.secondary, JSON: DS.accent };
  return (
    <div style={{
      position: "absolute", right: 0, top: 0, bottom: 0, width: 240,
      background: "rgba(11,26,58,0.97)",
      borderLeft: `2px solid ${DS.primary}`,
      display: "flex", flexDirection: "column",
      zIndex: 20,
      boxShadow: "-4px 0 20px rgba(0,0,0,0.6)",
    }}>
      <InfoCardBar icon="📁" title="VFS Files" />
      <div style={{ flex: 1, overflowY: "auto", padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>

        {files.map((f, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "8px 10px", borderRadius: 6,
            background: f.isNew ? "rgba(74,222,128,0.1)" : "rgba(14,165,233,0.07)",
            border: `1px solid ${f.isNew ? DS.success : DS.blueBorder}`,
            cursor: "pointer",
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 6, flexShrink: 0,
              background: DS.blueDeep,
              border: `1px solid ${typeColor[f.type] || DS.primary}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <span style={{ fontSize: 8, fontWeight: 900, fontFamily: "monospace", color: typeColor[f.type] || "white" }}>{f.type}</span>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#f0f6ff", fontFamily: DS.fontMain, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
              <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>{f.path} · {f.size}</div>
            </div>
            {f.isNew && <Tag color="green">NEW</Tag>}
          </div>
        ))}
      </div>
      <div style={{ padding: 8, borderTop: `1px solid ${DS.blueBorder}`, display: "flex", gap: 6 }}>
        <GameBtn variant="primary" style={{ flex: 1, fontSize: 11 }}>⬇ ZIP</GameBtn>
        <GameBtn variant="reject" onClick={onClose} style={{ fontSize: 11 }}>✕</GameBtn>
      </div>
    </div>
  );
}



/* ─── SIDEBAR ─── */
const WORKSPACES = [
  { id: 1, name: "NAWIA Game Dev", color: DS.secondary, threads: ["Combat System", "AI Pathfinding"] },
  { id: 2, name: "Portal MK", color: DS.primary, threads: ["Sprint #7 QA", "Search BLOCKER"] },
  { id: 3, name: "Kalio Core", color: "#a78bfa", threads: [] },
];

function Sidebar({ collapsed, setCollapsed }) {
  const [expanded, setExpanded] = useState({ 1: true, 2: false });
  const toggleWS = id => setExpanded(e => ({ ...e, [id]: !e[id] }));

  return (
    <div style={{
      width: collapsed ? 52 : 220,
      flexShrink: 0,
      background: "rgba(13,71,161,0.75)",
      backdropFilter: "blur(12px)",
      borderRight: `1px solid rgba(14,165,233,0.25)`,
      display: "flex", flexDirection: "column",
      transition: "width 0.25s",
      overflow: "hidden",
    }}>
      {/* Logo */}
      <div style={{
        display: "flex", alignItems: "center",
        padding: "0 12px", height: 52,
        borderBottom: `1px solid ${DS.blueBorder}`,
        gap: 8,
      }}>
        {!collapsed && (
          <>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: DS.blueDeep,
              border: `1px solid ${DS.primary}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}>
              <OT size={13} stroke={2}>K</OT>
            </div>
            <OT size={15} stroke={2} style={{ flex: 1, letterSpacing: "0.08em" }}>KALIO</OT>
            <span style={{
              fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 99,
              background: "rgba(241,145,60,0.25)", border: `1px solid ${DS.secondary}`,
              color: DS.secondary, fontFamily: DS.fontMain,
            }}>MVP</span>
          </>
        )}
        {collapsed && <OT size={15} stroke={2} style={{ margin: "0 auto" }}>K</OT>}
        <div onClick={() => setCollapsed(!collapsed)} style={{
          width: 20, height: 20, cursor: "pointer",
          color: "rgba(255,255,255,0.4)", fontSize: 12, fontWeight: 700,
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0, marginLeft: "auto",
        }}>{collapsed ? "›" : "‹"}</div>
      </div>

      {!collapsed && (
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {/* New thread */}
          <div style={{ padding: "0 10px 8px" }}>
            <GameBtn variant="primary" style={{ width: "100%", fontSize: 12, padding: "6px 0" }}>＋ New Thread</GameBtn>
          </div>

          {/* Pinned */}
          <div style={{ padding: "0 0 8px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 16px 4px" }}>📌 Pinned</div>
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "7px 16px", cursor: "pointer",
              background: "rgba(14,165,233,0.15)",
              borderLeft: `3px solid ${DS.secondary}`,
            }}>
              <StateDot status="running" />
              <span style={{ fontSize: 12, fontWeight: 600, color: "white", fontFamily: DS.fontMain }}>Combat System</span>
            </div>
          </div>

          {/* Workspaces */}
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,0.35)", letterSpacing: "0.1em", textTransform: "uppercase", padding: "4px 16px 4px" }}>📂 Workspaces</div>
            {WORKSPACES.map(ws => (
              <div key={ws.id}>
                <div onClick={() => toggleWS(ws.id)} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 16px", cursor: "pointer",
                  borderLeft: "3px solid transparent",
                }}
                onMouseEnter={e => { e.currentTarget.style.background = "rgba(14,165,233,0.08)"; e.currentTarget.style.borderLeftColor = ws.color; }}
                onMouseLeave={e => { e.currentTarget.style.background = ""; e.currentTarget.style.borderLeftColor = "transparent"; }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: ws.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.7)", fontFamily: DS.fontMain, flex: 1 }}>{ws.name}</span>
                  <span style={{ fontSize: 10, color: "rgba(255,255,255,0.3)" }}>{expanded[ws.id] ? "▾" : "▸"}</span>
                </div>
                {expanded[ws.id] && ws.threads.map(t => (
                  <div key={t} style={{
                    padding: "5px 16px 5px 30px",
                    display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                    background: t === "Combat System" ? "rgba(241,145,60,0.12)" : "transparent",
                    borderLeft: t === "Combat System" ? `3px solid ${DS.secondary}` : "3px solid transparent",
                  }}
                  onMouseEnter={e => { if (t !== "Combat System") e.currentTarget.style.background = "rgba(14,165,233,0.08)"; }}
                  onMouseLeave={e => { if (t !== "Combat System") e.currentTarget.style.background = ""; }}>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>›</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: t === "Combat System" ? "#fed7aa" : "rgba(255,255,255,0.55)", fontFamily: DS.fontMain }}>{t}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ padding: "6px 16px" }}>
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", cursor: "pointer", fontFamily: DS.fontMain, fontWeight: 600 }}>＋ New Workspace</span>
            </div>
          </div>
        </div>
      )}

      {/* Settings */}
      <div style={{ padding: 10, borderTop: `1px solid rgba(14,165,233,0.2)` }}>
        {collapsed
          ? <IconBtn title="Settings">⚙️</IconBtn>
          : <GameBtn variant="secondary" style={{ width: "100%", fontSize: 12 }}>⚙️ Settings</GameBtn>
        }
      </div>
    </div>
  );
}

/* ─── MESSAGES DATA ─── */
const MESSAGES = [
  { id: 1, role: "user", content: "Implement a BVH tree for collision detection. Warrior needs shield bash detection within 80ms.", time: "14:32" },
  { id: 2, role: "pipeline", agents: [
    { name: "Planner", status: "done", icon: "🗺️" },
    { name: "Coder", status: "running", icon: "⚙️" },
    { name: "Evaluator", status: "pending", icon: "🔍" },
  ], task: "BVH collision tree implementation", time: "14:32" },
  { id: 3, role: "tool", tool: "fs_write", file: "/src/collision/BVHTree.ts", lines: 147, status: "done", time: "14:33" },
  { id: 4, role: "assistant", content: "BVH tree is up. Broad phase runs in **O(log n)** — 12ms on 200 colliders. Shield bash detection is at **68ms** ✅ under your 80ms threshold.\n\nNext: wire to CombatSystem.update() or run as a worker thread?", time: "14:33" },
];

/* ─── MAIN APP ─── */
export default function KalioTycoon() {
  const [collapsed, setCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState(0);
  const [showVFS, setShowVFS] = useState(false);
  const [input, setInput] = useState("");
  const feedRef = useRef(null);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, []);

  return (
    <div style={{
      display: "flex", height: "100vh", width: "100%", overflow: "hidden",
      background: DS.bg,
      fontFamily: DS.fontMain,
      position: "relative",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;900&family=Montserrat+Alternates:wght@400;600;700&display=swap');
        @keyframes pulse { 0%,100%{opacity:1}50%{opacity:0.35} }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #f1913c; border-radius: 3px; }
        * { box-sizing: border-box; }
        textarea { resize: none; }
      `}</style>

      {/* BG radial glow — same as DS */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        background: `
          radial-gradient(ellipse 80% 60% at 50% 0%, rgba(14,165,233,0.18) 0%, transparent 70%),
          radial-gradient(ellipse 60% 40% at 90% 100%, rgba(241,145,60,0.10) 0%, transparent 60%)
        `,
      }} />

      <div style={{ display: "flex", width: "100%", position: "relative", zIndex: 1 }}>
        <Sidebar collapsed={collapsed} setCollapsed={setCollapsed} />

        {/* Main column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>

          {/* InfoCardBar = thread header */}
          <InfoCardBar icon="⚔️" title="Combat System" />

          {/* Bookmark tabs below the bar */}
          <BookmarkTabs
            tabs={["Chat", "Tools", "VFS", "Settings"]}
            active={activeTab}
            onChange={setActiveTab}
          />

          {/* Resource + action strip */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 14px",
            background: "rgba(13,71,161,0.5)",
            backdropFilter: "blur(8px)",
            borderBottom: `1px solid ${DS.blueBorder}`,
            flexWrap: "wrap",
          }}>
            <ResourcePill icon="🏢" value="NAWIA" />
            <ResourcePill icon="🧠" value="claude-sonnet-4" />
            <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 6, background: "rgba(74,222,128,0.15)", border: `1px solid ${DS.success}`, height: 30 }}>
              <StateDot status="running" />
              <span style={{ fontSize: 11, fontWeight: 700, color: DS.success, fontFamily: DS.fontMain }}>pipeline running</span>
            </div>
            <div style={{ flex: 1 }} />
            <GameBtn variant="secondary" small onClick={() => setShowVFS(v => !v)} style={{ opacity: showVFS ? 1 : 0.8 }}>📁 VFS</GameBtn>
            <GameBtn variant="reject" small>⏹ Stop</GameBtn>
          </div>

          {/* Message feed */}
          <div ref={feedRef} style={{ flex: 1, overflowY: "auto", padding: "14px 14px 6px" }}>
            {MESSAGES.map(msg => <Message key={msg.id} msg={msg} />)}

            {/* Typing dots */}
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8 }}>
              <div style={{
                width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                background: DS.blueDeep,
                border: `1px solid ${DS.primary}`,
                boxShadow: `0 0 12px rgba(14,165,233,0.5)`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontFamily: DS.fontAlt, fontWeight: 900, color: "white",
                WebkitTextStroke: `2px ${DS.blueBorder}`, paintOrder: "stroke fill",
              }}>K</div>
              <div style={{
                display: "flex", gap: 5, padding: "8px 12px",
                borderRadius: 8, border: `1px solid ${DS.blueBorder}`,
                background: "rgba(13,71,161,0.3)",
              }}>
                {[0,1,2].map(i => (
                  <div key={i} style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: DS.primary,
                    animation: `pulse ${0.6 + i * 0.2}s infinite`,
                    animationDelay: `${i * 0.15}s`,
                  }} />
                ))}
              </div>
            </div>
          </div>

          {/* Input area */}
          <div style={{
            padding: "10px 14px 12px",
            borderTop: `1px solid ${DS.blueBorder}`,
            background: "rgba(13,71,161,0.4)",
            backdropFilter: "blur(8px)",
          }}>
            <div style={{
              display: "flex", alignItems: "flex-end", gap: 8,
              background: "rgba(255,255,255,0.08)",
              border: `1px solid ${DS.blueBorder}`,
              borderRadius: 8,
              padding: "8px 10px",
              boxShadow: DS.shadowCard,
            }}>
              <button style={{
                width: 32, height: 32, borderRadius: 6, flexShrink: 0,
                background: DS.blueDeep, border: `1px solid ${DS.blueBorder}`,
                color: "white", fontSize: 16, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                marginBottom: 2,
              }}>📎</button>

              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask anything, run agents, build apps..."
                rows={2}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  color: "#f0f6ff", fontFamily: DS.fontMain, fontSize: 13,
                  lineHeight: 1.5, caretColor: DS.secondary,
                  minHeight: 36, maxHeight: 100,
                }}
              />

              {/* Sprite-style send button */}
              <button style={{
                position: "relative", display: "inline-flex",
                alignItems: "center", justifyContent: "center",
                width: 52, height: 42,
                border: "none", background: "none",
                cursor: "pointer", flexShrink: 0, marginBottom: 2,
              }}
              onMouseEnter={e => e.currentTarget.style.transform = "scale(1.04)"}
              onMouseLeave={e => e.currentTarget.style.transform = ""}
              onMouseDown={e => e.currentTarget.style.transform = "scale(0.97)"}
              onMouseUp={e => e.currentTarget.style.transform = ""}
              >
                <div style={{
                  position: "absolute", inset: 0,
                  borderRadius: 10,
                  background: `linear-gradient(180deg, #5dcff8 0%, ${DS.primary} 45%, #0777b0 100%)`,
                  border: `2px solid ${DS.blueBorder}`,
                  boxShadow: "0 5px 0 #0b4d7a, 0 7px 12px rgba(0,0,0,0.5)",
                }} />
                <span style={{
                  position: "relative",
                  fontFamily: DS.fontAlt, fontWeight: 700, fontSize: 18,
                  color: "white",
                  WebkitTextStroke: `2px #083ac5`, paintOrder: "stroke fill",
                  filter: "drop-shadow(0 2px 2px rgba(0,0,0,0.5))",
                }}>▶</span>
              </button>
            </div>

            <div style={{ textAlign: "center", marginTop: 5, fontSize: 9, color: "rgba(255,255,255,0.2)", fontFamily: DS.fontMain }}>
              Enter to send · Shift+Enter newline · <span style={{ color: DS.accent }}>/tools</span> for tool list
            </div>
          </div>

          {/* VFS panel overlay */}
          {showVFS && (
            <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 10 }}>
              <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, pointerEvents: "all" }}>
                <VFSPanel onClose={() => setShowVFS(false)} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Version badge */}
      <div style={{
        position: "fixed", bottom: 14, right: 14,
        background: "rgba(13,71,161,0.85)",
        border: `1px solid rgba(14,165,233,0.3)`,
        borderRadius: 6, padding: "5px 10px",
        fontSize: 10, color: "rgba(255,255,255,0.4)",
        fontWeight: 700, backdropFilter: "blur(8px)", zIndex: 200,
        fontFamily: DS.fontMain,
      }}>v1.0 · KALIO MVP</div>
    </div>
  );
}
