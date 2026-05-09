import { useState, useRef, useEffect, useMemo } from 'react';
import { ChevronDown, X } from 'lucide-react';

interface Props {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  disabled?: boolean;
  loading?: boolean;
  placeholder?: string;
  'data-testid'?: string;
}

function fuzzyFilter(query: string, items: string[]): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.toLowerCase().includes(q));
}

export function ModelCombobox({
  value,
  options,
  onChange,
  disabled,
  loading,
  placeholder,
  'data-testid': testId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [typedSinceOpen, setTypedSinceOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  const openDropdown = () => {
    setQuery('');
    setTypedSinceOpen(false);
    setOpen(true);
  };

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [open]);

  const filtered = useMemo(() => {
    if (!typedSinceOpen) return options;
    return fuzzyFilter(query, options);
  }, [typedSinceOpen, query, options]);

  const displayValue = open && typedSinceOpen ? query : value;

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex items-center">
        <input
          ref={inputRef}
          type="text"
          className="input input-bordered input-sm w-full font-mono pr-16"
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            setTypedSinceOpen(true);
            onChange(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            openDropdown();
            inputRef.current?.select();
          }}
          disabled={disabled || loading}
          placeholder={loading ? 'Loading models…' : placeholder}
          data-testid={testId}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <div className="absolute right-1 flex items-center gap-0.5">
          {value && (
            <button
              type="button"
              className="btn btn-ghost btn-xs px-1 text-base-content/40"
              onClick={() => {
                setQuery('');
                setTypedSinceOpen(false);
                onChange('');
                inputRef.current?.focus();
              }}
              tabIndex={-1}
              aria-label="Clear"
            >
              <X size={12} />
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-xs px-1 text-base-content/40"
            onClick={() => {
              if (disabled || loading) return;
              if (open) {
                setOpen(false);
              } else {
                openDropdown();
              }
            }}
            tabIndex={-1}
            aria-label="Toggle options"
          >
            <ChevronDown
              size={14}
              className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {open && (
        <div className="absolute z-10 mt-1 w-full max-h-60 overflow-auto rounded-md border border-base-300 bg-base-100 shadow-lg" role="listbox">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-base-content/40 italic">
              No matches — press Enter or click Save to use “{query}”
            </div>
          ) : (
            <ul className="py-1">
              {filtered.map((item) => {
                const active = item === value;
                return (
                  <li key={item} role="option" aria-selected={active}>
                    <button
                      type="button"
                      className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-base-200 ${
                        active ? 'bg-base-200 font-semibold' : ''
                      }`}
                      onClick={() => {
                        onChange(item);
                        setQuery(item);
                        setOpen(false);
                      }}
                    >
                      {highlightMatch(item, query)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function highlightMatch(text: string, query: string) {
  if (!query.trim()) return text;
  const q = query.trim().toLowerCase();
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text;
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);
  return (
    <>{before}<span className="underline decoration-primary decoration-2">{match}</span>{after}</>
  );
}
