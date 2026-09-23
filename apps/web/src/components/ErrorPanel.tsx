import { useEffect, useState } from "react";
import { useOnline } from "../hooks/useOnline";
import type { RulingError } from "../lib/api";
import { errorCopy } from "../lib/copy";
import { AlertIcon, ClockIcon, OfflineIcon, PencilIcon, RefreshIcon } from "./Icons";

interface ErrorPanelProps {
  readonly error: RulingError;
  readonly onRetry: () => void;
  readonly onEdit: () => void;
}

function useCountdown(seconds: number | null): number {
  const [left, setLeft] = useState(seconds ?? 0);
  useEffect(() => {
    if (!seconds) return;
    const ends = Date.now() + seconds * 1000;
    const tick = setInterval(() => {
      const next = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
      setLeft(next);
      if (next === 0) clearInterval(tick);
    }, 250);
    return () => clearInterval(tick);
  }, [seconds]);
  return left;
}

export function ErrorPanel({ error, onRetry, onEdit }: ErrorPanelProps) {
  const online = useOnline();
  const waitSeconds = error.code === "rate_limited" ? error.retryAfter : null;
  const left = useCountdown(waitSeconds);
  const copy = errorCopy(error.code, error.retryAfter);
  const Icon =
    error.code === "offline" || error.code === "network"
      ? OfflineIcon
      : error.code === "timeout" ||
          error.code === "rate_limited" ||
          error.code === "daily_limit" ||
          error.code === "client_limit"
        ? ClockIcon
        : AlertIcon;
  const editLabel =
    error.code === "daily_limit" || error.code === "client_limit"
      ? "Try another food"
      : "Edit the food";

  const waitingForNetwork = error.code === "offline" && !online;
  const retryLabel =
    left > 0
      ? `Try again in ${left}s`
      : waitingForNetwork
        ? "Waiting for a connection"
        : "Try again";

  return (
    <div className="error-panel" data-code={error.code}>
      <span className="error-panel__icon">
        <Icon />
      </span>
      <h3 className="error-panel__title">{copy.title}</h3>
      <p className="error-panel__body">{copy.body}</p>
      {copy.action === "reload" ? (
        <button
          type="button"
          className="button button--secondary"
          onClick={() => window.location.reload()}
        >
          <RefreshIcon />
          Reload the page
        </button>
      ) : copy.action === "edit" ? (
        <button type="button" className="button button--secondary" onClick={onEdit}>
          <PencilIcon />
          {editLabel}
        </button>
      ) : (
        <button
          type="button"
          className="button button--secondary"
          onClick={onRetry}
          disabled={left > 0 || waitingForNetwork}
        >
          <RefreshIcon />
          {retryLabel}
        </button>
      )}
    </div>
  );
}
