"use client";

import { useEffect, useRef, useState } from "react";

type Option = { id: string; name: string; state: string; city: string | null };

/**
 * A text field that suggests colleges from the curated list (F-08). Picking one links the profile
 * to that college; anything else is kept as typed, for an organizer to map later.
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
  const [options, setOptions] = useState<Option[]>([]);
  const [picked, setPicked] = useState<Option | null>(
    defaultId ? { id: defaultId, name: defaultValue, state: "", city: null } : null,
  );
  const request = useRef(0);

  const query = text.trim();
  // No suggestions for a short query, or once a college has been picked.
  const searching = query.length >= 2 && picked?.name !== text;
  const visible = searching ? options : [];

  useEffect(() => {
    // Bumping the id also discards a response still in flight for an earlier query.
    const id = ++request.current;
    if (!searching) return;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/v1/colleges?q=${encodeURIComponent(query)}`);
        const body = (await response.json()) as { colleges: Option[] };
        if (id === request.current) setOptions(body.colleges);
      } catch {
        // The list is a convenience; typing still works without it.
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query, searching]);

  return (
    <div className="relative">
      <input
        id={inputId}
        name="college"
        aria-label={label}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible.length > 0}
        aria-controls={`${inputId}-options`}
        aria-autocomplete="list"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          if (picked && event.target.value !== picked.name) setPicked(null);
        }}
        aria-invalid={invalid}
        aria-describedby={describedBy}
      />
      <input type="hidden" name="collegeId" value={picked?.id ?? ""} />
      {visible.length > 0 && (
        <ul
          id={`${inputId}-options`}
          role="listbox"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 list-none overflow-auto rounded-xl border border-(color:--border-strong) bg-(color:--bg) p-1 shadow-lg"
        >
          {visible.map((option) => (
            <li key={option.id} role="option" aria-selected={false}>
              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-(color:--ice-soft)"
                onClick={() => {
                  setPicked(option);
                  setText(option.name);
                  setOptions([]);
                }}
              >
                <span className="block font-medium">{option.name}</span>
                <span className="block text-xs text-(color:--muted)">
                  {[option.city, option.state].filter(Boolean).join(", ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!picked && searching && visible.length === 0 && (
        <p className="field-hint">Not in the list? Keep what you typed; we&apos;ll match it to your college.</p>
      )}
    </div>
  );
}
