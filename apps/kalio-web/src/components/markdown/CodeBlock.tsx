import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { tomorrow } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, Code2, Terminal, FileCode2, Database } from 'lucide-react';

const LANG_LABELS: Record<string, { icon: 'code' | 'terminal' | 'file' | 'db'; color: string }> = {
  javascript: { icon: 'file', color: 'text-yellow-400' },
  js: { icon: 'file', color: 'text-yellow-400' },
  typescript: { icon: 'file', color: 'text-blue-500' },
  ts: { icon: 'file', color: 'text-blue-500' },
  tsx: { icon: 'file', color: 'text-blue-500' },
  jsx: { icon: 'file', color: 'text-yellow-400' },
  python: { icon: 'code', color: 'text-blue-400' },
  java: { icon: 'code', color: 'text-red-500' },
  rust: { icon: 'code', color: 'text-orange-500' },
  go: { icon: 'code', color: 'text-cyan-500' },
  html: { icon: 'file', color: 'text-orange-500' },
  css: { icon: 'file', color: 'text-blue-500' },
  json: { icon: 'file', color: 'text-yellow-500' },
  yaml: { icon: 'file', color: 'text-green-400' },
  yml: { icon: 'file', color: 'text-green-400' },
  sql: { icon: 'db', color: 'text-blue-400' },
  bash: { icon: 'terminal', color: 'text-green-400' },
  sh: { icon: 'terminal', color: 'text-green-400' },
  shell: { icon: 'terminal', color: 'text-green-400' },
  powershell: { icon: 'terminal', color: 'text-blue-600' },
  markdown: { icon: 'file', color: 'text-base-content/70' },
  md: { icon: 'file', color: 'text-base-content/70' },
  xml: { icon: 'file', color: 'text-orange-400' },
};

function LangIcon({ lang }: { lang: string }) {
  const meta = LANG_LABELS[lang.toLowerCase()];
  const colorClass = meta?.color ?? 'text-base-content/70';
  const icon = meta?.icon ?? 'code';
  const size = 14;
  switch (icon) {
    case 'terminal': return <Terminal size={size} className={colorClass} />;
    case 'file': return <FileCode2 size={size} className={colorClass} />;
    case 'db': return <Database size={size} className={colorClass} />;
    default: return <Code2 size={size} className={colorClass} />;
  }
}

interface CodeBlockProps {
  language?: string;
  value: string;
}

const COPY_TIMEOUT = 2000;

export function CodeBlock({ language = 'text', value }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), COPY_TIMEOUT);
    } catch (err) {
      console.error('[CodeBlock] copy failed:', err);
    }
  };

  return (
    <div className="not-prose my-3 overflow-hidden rounded-lg border border-base-300 bg-base-200">
      <div className="flex items-center justify-between bg-base-300/80 px-3 py-1.5 border-b border-base-300">
        <div className="flex items-center gap-1.5">
          <LangIcon lang={language} />
          <span className="font-mono text-xs font-semibold text-base-content/80">{language}</span>
        </div>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-md transition-colors hover:bg-base-100/50"
          title={copied ? 'Copied!' : 'Copy to clipboard'}
        >
          {copied
            ? <><Check size={13} className="text-success" /><span className="text-success">Copied</span></>
            : <><Copy size={13} className="text-base-content/60" /><span className="text-base-content/60">Copy</span></>
          }
        </button>
      </div>
      <div className="overflow-x-auto">
        <SyntaxHighlighter
          language={language}
          style={tomorrow}
          wrapLongLines
          customStyle={{
            margin: 0,
            padding: '0.75rem 1rem',
            background: 'transparent',
            fontSize: '0.8125rem',
            lineHeight: '1.5',
          }}
          codeTagProps={{ className: 'font-mono' }}
        >
          {value}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
