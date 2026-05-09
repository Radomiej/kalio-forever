import { memo, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { CodeBlock } from './CodeBlock';

/**
 * Convert `<think>...</think>` reasoning blocks into collapsible `<details>` elements.
 */
function convertThinkToDetails(text: string): string {
  let result = text.replace(
    /<think>([\s\S]*?)<\/think>/gi,
    (_match, inner: string) => {
      const trimmed = inner.trim();
      if (!trimmed) return '';
      return `<details class="think-block"><summary>💭 Thinking…</summary>\n\n${trimmed}\n\n</details>\n\n`;
    },
  );
  result = result.replace(/<think>([\s\S]*)$/i, (_match, inner: string) => {
    const trimmed = inner.trim();
    if (!trimmed) return '<details open class="think-block"><summary>💭 Thinking…</summary>\n\n⏳\n\n</details>\n\n';
    return `<details open class="think-block"><summary>💭 Thinking…</summary>\n\n${trimmed}\n\n</details>\n\n`;
  });
  return result;
}

interface MarkdownViewerProps {
  content: string;
  className?: string;
  compact?: boolean;
}

export const MarkdownViewer = memo(function MarkdownViewer({ content, className = '', compact = false }: MarkdownViewerProps) {
  const sanitizedContent = useMemo(() => convertThinkToDetails(content), [content]);

  const components: Components = useMemo(() => ({
    code({ className: cn, children, ...rest }) {
      const lang = /language-(\w+)/.exec(cn ?? '')?.[1];
      const value = String(children).replace(/\n$/, '');
      if (lang) return <CodeBlock language={lang} value={value} />;
      if (!cn && value.includes('\n')) return <CodeBlock language="text" value={value} />;
      return (
        <code className="px-1 py-0.5 rounded bg-base-200 border border-base-300/50 text-sm font-mono break-words" {...rest}>
          {children}
        </code>
      );
    },
    h1: (props) => <h1 className="text-2xl font-bold mt-6 mb-3" {...props} />,
    h2: (props) => <h2 className="text-xl font-bold mt-5 mb-2" {...props} />,
    h3: (props) => <h3 className="text-lg font-semibold mt-4 mb-2" {...props} />,
    h4: (props) => <h4 className="text-base font-semibold mt-3 mb-1" {...props} />,
    p: (props) => <p className="my-2 leading-relaxed" {...props} />,
    a: (props) => (
      <a className="text-primary hover:text-primary/80 underline underline-offset-2" target="_blank" rel="noopener noreferrer" {...props} />
    ),
    ul: (props) => <ul className="list-disc pl-6 my-2 space-y-1" {...props} />,
    ol: (props) => <ol className="list-decimal pl-6 my-2 space-y-1" {...props} />,
    blockquote: (props) => (
      <blockquote className="border-l-4 border-primary/30 pl-4 italic text-base-content/70 my-3" {...props} />
    ),
    table: (props) => (
      <div className="overflow-x-auto my-3">
        <table className="table table-xs table-zebra w-full" {...props} />
      </div>
    ),
    thead: (props) => <thead className="bg-base-200" {...props} />,
    th: (props) => <th className="px-3 py-2 text-left text-xs font-semibold text-base-content/80 uppercase tracking-wider" {...props} />,
    td: (props) => <td className="px-3 py-2 text-sm text-base-content/90" {...props} />,
    tr: (props) => <tr className="border-b border-base-300/50" {...props} />,
  }), []);

  const proseClass = compact
    ? 'prose prose-xs max-w-none text-xs text-base-content/70 [&_p]:my-0.5 [&_ul]:my-0.5 [&_li]:my-0 [&_h1]:text-sm [&_h2]:text-xs [&_h3]:text-xs'
    : `prose prose-sm dark:prose-invert max-w-none ${className}`;

  return (
    <div className={proseClass}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
        {sanitizedContent}
      </ReactMarkdown>
    </div>
  );
});
