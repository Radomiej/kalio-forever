import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

interface PersonaOption {
  id: string;
  label: string;
}

interface PersonaComboboxProps {
  id: string;
  options: PersonaOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  testId?: string;
}

export function PersonaCombobox({
  id,
  options,
  value,
  onChange,
  disabled = false,
  testId,
}: PersonaComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = `${id}-listbox`;
  const selected = options.find((option) => option.id === value) ?? options[0] ?? null;
  const filteredOptions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return normalized
      ? options.filter((option) => option.label.toLowerCase().includes(normalized))
      : options;
  }, [options, query]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;

    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    setHighlightedIndex(0);
  };

  const selectOption = (option: PersonaOption) => {
    onChange(option.id);
    close();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label="Persona"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        className="select select-bordered select-sm flex w-full items-center justify-between gap-3 text-left text-sm"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        data-testid={testId}
      >
        <span className="truncate">{selected?.label ?? 'Select persona'}</span>
        <ChevronDown size={14} className={`shrink-0 text-base-content/55 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-xl">
          <label className="flex items-center gap-2 border-b border-base-300/70 px-3 py-2">
            <Search size={14} className="shrink-0 text-base-content/45" />
            <input
              ref={searchRef}
              type="search"
              aria-label="Search personas"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-base-content/40"
              placeholder="Search personas"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  close();
                  return;
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setHighlightedIndex((current) => filteredOptions.length > 0 ? (current + 1) % filteredOptions.length : 0);
                  return;
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setHighlightedIndex((current) => filteredOptions.length > 0 ? (current - 1 + filteredOptions.length) % filteredOptions.length : 0);
                  return;
                }
                if (event.key === 'Enter') {
                  event.preventDefault();
                  const option = filteredOptions[highlightedIndex];
                  if (option) selectOption(option);
                }
              }}
            />
          </label>
          <div id={listboxId} role="listbox" aria-label="Personas" className="max-h-64 overflow-y-auto p-1.5">
            {filteredOptions.map((option, index) => (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={option.id === value}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm ${
                  index === highlightedIndex ? 'bg-base-200 text-base-content' : 'text-base-content/75 hover:bg-base-200/70'
                }`}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => selectOption(option)}
              >
                <span className="truncate">{option.label}</span>
                {option.id === value && <Check size={14} className="shrink-0 text-primary" />}
              </button>
            ))}
            {filteredOptions.length === 0 && (
              <p className="px-3 py-5 text-center text-sm text-base-content/50">No personas match this search.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
