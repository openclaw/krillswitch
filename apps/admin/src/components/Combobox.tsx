import { useEffect, useId, useRef, useState } from "react";
import { ChevronDownIcon, CrossIcon } from "./brand";

export type ComboboxOption = { value: string; label: string; hint?: string };

/**
 * Editable combobox: free text plus a filtered dropdown of real options.
 * Follows the ARIA combobox pattern (focus stays on the input;
 * aria-activedescendant tracks the highlighted option), so the options
 * themselves carry no keyboard handlers.
 */
export function Combobox({
  value,
  onChange,
  options,
  ariaLabel,
  placeholder,
  disabled = false,
  emptyLabel = "No matches",
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const q = value.trim().toLowerCase();
  const isExact = options.some((option) => option.value.toLowerCase() === q);
  const filtered =
    q === "" || isExact
      ? options
      : options.filter(
          (option) =>
            option.value.toLowerCase().includes(q) ||
            option.label.toLowerCase().includes(q),
        );

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  function select(option: ComboboxOption) {
    onChange(option.value);
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
      } else {
        setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const option = open ? filtered[activeIndex] : undefined;
      if (option) {
        event.preventDefault();
        select(option);
      }
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  const activeId =
    open && activeIndex >= 0 && activeIndex < filtered.length
      ? `${listId}-opt-${activeIndex}`
      : undefined;

  return (
    <div className="combobox" ref={wrapRef}>
      <input
        ref={inputRef}
        className="input combobox-input"
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        autoComplete="off"
        disabled={disabled}
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />
      {value !== "" && !disabled ? (
        <button
          type="button"
          className="combobox-clear"
          aria-label={`Clear ${ariaLabel}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange("");
            setOpen(true);
            setActiveIndex(-1);
            inputRef.current?.focus();
          }}
        >
          <CrossIcon className="combobox-icon" />
        </button>
      ) : (
        <span className="combobox-caret" aria-hidden="true">
          <ChevronDownIcon className="combobox-icon" />
        </span>
      )}
      {open && (
        <div className="combobox-list" role="listbox" id={listId}>
          {filtered.length === 0 ? (
            <div className="combobox-empty">{emptyLabel}</div>
          ) : (
            filtered.map((option, index) => (
              <div
                key={option.value}
                id={`${listId}-opt-${index}`}
                role="option"
                tabIndex={-1}
                aria-selected={option.value === value}
                className={`combobox-option ${index === activeIndex ? "is-active" : ""}`}
                title={
                  option.hint
                    ? `${option.label} — ${option.hint}`
                    : option.label
                }
                // Select on mousedown so it fires before the input blur, and
                // keep focus on the input (ARIA combobox pattern).
                onMouseDown={(event) => {
                  event.preventDefault();
                  select(option);
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="combobox-option-label">{option.label}</span>
                {option.hint && (
                  <span className="combobox-option-hint">{option.hint}</span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
