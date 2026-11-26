"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Option = { id: string; name: string; state: string; city: string | null };
type PageResult = { colleges: Option[]; hasMore: boolean; nextOffset: number | null };

const PAGE_SIZE = 20;

/**
 * Searchable select dropdown with scroll-to-load pagination and client-side page caching.
 * Picking a college links the profile to that College; free text is kept for organizer mapping.
 */
export function CollegePicker({
  defaultValue,
  defaultId,
  invalid,
  describedBy,
  inputId = "college",
  label,
}: {
  defaultValue: string;
  defaultId: string | null;
  invalid: boolean;
  describedBy?: string;
  /** Unique per page when there are several pickers. */
  inputId?: string;
  /** An accessible name when there is no visible <label for>. */
  label?: string;
}) {
  const [text, setText] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [picked, setPicked] = useState<Option | null>(
    defaultId ? { id: defaultId, name: defaultValue, state: "", city: null } : null,
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const cacheRef = useRef<Map<string, PageResult>>(new Map());
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const query = text.trim();
  const effectiveQuery = picked?.name === text ? "" : query;

  const fetchPage = useCallback(async (q: string, offset: number, append: boolean) => {
    const cacheKey = `${q.toLowerCase()}::${offset}`;
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      setOptions((prev) => (append ? [...prev, ...cached.colleges] : cached.colleges));
      setHasMore(cached.hasMore);
      setNextOffset(cached.nextOffset);
      if (!append) setActiveIndex(-1);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const reqId = ++requestRef.current;
    setLoading(true);

    try {
      const url = `/api/v1/colleges?q=${encodeURIComponent(q)}&limit=${PAGE_SIZE}&offset=${offset}`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return;
      const body = (await response.json()) as PageResult;
      cacheRef.current.set(cacheKey, body);
      if (reqId !== requestRef.current) return;
      setOptions((prev) => (append ? [...prev, ...body.colleges] : body.colleges));
      setHasMore(body.hasMore);
      setNextOffset(body.nextOffset);
      if (!append) setActiveIndex(-1);
    } catch {
      // Aborted or network error: typing free text still works.
    } finally {
      if (reqId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const delay = effectiveQuery.length === 0 ? 0 : 250;
    const timer = setTimeout(() => {
      void fetchPage(effectiveQuery, 0, false);
    }, delay);
    return () => clearTimeout(timer);
  }, [effectiveQuery, open, fetchPage]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const selectOption = (option: Option) => {
    setPicked(option);
    setText(option.name);
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleScroll = (event: React.UIEvent<HTMLUListElement>) => {
    if (loading || !hasMore || nextOffset === null) return;
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) {
      void fetchPage(effectiveQuery, nextOffset, true);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === "Escape") {
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(options.length - 1, prev + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(0, prev - 1));
    } else if (event.key === "Enter" && activeIndex >= 0 && options[activeIndex]) {
      event.preventDefault();
      selectOption(options[activeIndex]);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          id={inputId}
          name="college"
          aria-label={label}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${inputId}-options`}
          aria-autocomplete="list"
          placeholder="Search or select your college..."
          value={text}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            if (picked && event.target.value !== picked.name) setPicked(null);
          }}
          aria-invalid={invalid}
          aria-describedby={describedBy}
          className="pr-14"
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-1">
          {text && (
            <button
              type="button"
              aria-label="Clear college"
              className="rounded px-1.5 py-0.5 text-xs text-(color:--muted) hover:text-(color:--text)"
              onClick={() => {
                setText("");
                setPicked(null);
                setOpen(true);
              }}
            >
              ×
            </button>
          )}
          <button
            type="button"
            aria-label="Toggle college list"
            className="rounded px-1.5 py-0.5 text-xs text-(color:--muted) hover:text-(color:--text)"
            onClick={() => setOpen((prev) => !prev)}
          >
            ▾
          </button>
        </div>
      </div>

      <input type="hidden" name="collegeId" value={picked?.id ?? ""} />

      {open && (
        <ul
          id={`${inputId}-options`}
          role="listbox"
          onScroll={handleScroll}
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 list-none overflow-auto rounded-xl border border-(color:--border-strong) bg-(color:--bg) p-1 shadow-lg"
        >
          {options.map((option, index) => (
            <li key={option.id} role="option" aria-selected={picked?.id === option.id}>
              <button
                type="button"
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  index === activeIndex || picked?.id === option.id
                    ? "bg-(color:--ice-soft)"
                    : "hover:bg-(color:--ice-soft)"
                }`}
                onClick={() => selectOption(option)}
              >
                <span className="block font-medium">{option.name}</span>
                <span className="block text-xs text-(color:--muted)">
                  {[option.city, option.state].filter(Boolean).join(", ")}
                </span>
              </button>
            </li>
          ))}

          {loading && (
            <li className="px-3 py-2 text-xs text-(color:--muted)" aria-live="polite">
              Loading colleges…
            </li>
          )}

          {!loading && options.length === 0 && (
            <li className="px-3 py-2 text-xs text-(color:--muted)">
              No matching college found. Keep what you typed and we&apos;ll match it later.
            </li>
          )}

          {!loading && hasMore && (
            <li className="px-3 py-1.5 text-center text-[11px] text-(color:--dim)">
              Scroll for more…
            </li>
          )}
        </ul>
      )}

      {!picked && query.length >= 2 && !open && options.length === 0 && (
        <p className="field-hint">Not in the list? Keep what you typed; we&apos;ll match it to your college.</p>
      )}
    </div>
  );
}
