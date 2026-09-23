import { normalizeItem, precheckItem } from "@cube/core";
import { type FormEvent, type MouseEvent, type RefObject, useRef, useState } from "react";
import { classify } from "../lib/api";
import { HERO_CHIPS } from "../lib/foods";
import { foodHref } from "../lib/url";
import { DiceIcon } from "./Icons";

const PREFETCH_DELAY_MS = 150;

interface FoodFormProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (item: string) => void;
  readonly onSurprise: () => void;
  readonly inputRef: RefObject<HTMLInputElement | null>;
}

export function isPlainClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function usePrefetch() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = (item: string) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!precheckItem(item)) classify(item).catch(() => {});
    }, PREFETCH_DELAY_MS);
  };
  const cancel = () => clearTimeout(timer.current);
  return { start, cancel };
}

export function FoodLink({
  item,
  label = item,
  onPick,
}: {
  readonly item: string;
  readonly label?: string;
  readonly onPick: (item: string) => void;
}) {
  const prefetch = usePrefetch();
  return (
    <a
      className="food-chip"
      href={foodHref(item)}
      onClick={(event) => {
        if (!isPlainClick(event)) return;
        event.preventDefault();
        onPick(item);
      }}
      onMouseEnter={() => prefetch.start(item)}
      onFocus={() => prefetch.start(item)}
      onMouseLeave={prefetch.cancel}
      onBlur={prefetch.cancel}
    >
      {label}
    </a>
  );
}

export function FoodForm({ value, onChange, onSubmit, onSurprise, inputRef }: FoodFormProps) {
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.trim() === "") {
      setError("Type a food first.");
      inputRef.current?.focus();
      return;
    }
    const item = normalizeItem(value);
    if (item === "") {
      setError("That needs at least one letter.");
      inputRef.current?.focus();
      return;
    }
    setError(null);
    inputRef.current?.blur();
    onSubmit(item);
  };

  return (
    <form className="food-form" onSubmit={submit} noValidate>
      <label id="food-label" className="food-form__label" htmlFor="food-input">
        Name a food
      </label>
      <div className="food-form__row">
        <input
          ref={inputRef}
          id="food-input"
          className="food-form__input"
          name="food"
          type="text"
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            if (error) setError(null);
          }}
          placeholder="hot dog, lasagna, pop-tart…"
          enterKeyHint="go"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={80}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "food-hint food-error" : "food-hint"}
        />
        <button type="submit" className="button button--primary food-form__submit">
          Cube it
        </button>
      </div>
      <p id="food-hint" className="food-form__hint">
        Singular works best. Jev only sees the name.
      </p>
      {error && (
        <p id="food-error" className="food-form__error">
          {error}
        </p>
      )}
      <div className="food-form__try">
        <span className="food-form__try-label" id="try-label">
          Or try
        </span>
        <ul className="food-form__chips" aria-labelledby="try-label">
          {HERO_CHIPS.map((item) => (
            <li key={item}>
              <FoodLink item={item} onPick={onSubmit} />
            </li>
          ))}
          <li>
            <button type="button" className="food-chip food-chip--surprise" onClick={onSurprise}>
              <DiceIcon />
              Surprise me
            </button>
          </li>
        </ul>
      </div>
    </form>
  );
}
