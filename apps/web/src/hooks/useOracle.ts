import { type CubeResult, precheckItem, toCubeResult } from "@cube/core";
import { useCallback, useRef, useState } from "react";
import { type Classified, cachedClassified, classify, RulingError } from "../lib/api";

// "typed" rulings move focus to the result. "link" rulings come from a URL someone else wrote,
// so they neither steal focus nor echo the food until Jev has cleared it.
export type Origin = "typed" | "link" | "history";

interface Base {
  readonly id: number;
  readonly item: string;
  readonly origin: Origin;
}

export type OracleState =
  | { readonly status: "idle" }
  | (Base & { readonly status: "loading" })
  | (Base & {
      readonly status: "done";
      readonly result: CubeResult;
      readonly meta: Classified | null;
    })
  | (Base & { readonly status: "error"; readonly error: RulingError });

export type ActiveState = Exclude<OracleState, { status: "idle" }>;

// A deep link's text is shown only once Jev has cleared it. Text with no letters never reaches
// Jev (so is_abusive never saw it), so a link to it is never shown at all.
export function canEcho(state: ActiveState): boolean {
  if (state.origin !== "link") return true;
  return (
    state.status === "done" && state.result.kind !== "declined" && state.result.model !== "precheck"
  );
}

function settle(base: Base, meta: Classified): OracleState {
  try {
    return { ...base, status: "done", result: toCubeResult(base.item, meta.response), meta };
  } catch {
    return { ...base, status: "error", error: new RulingError("internal") };
  }
}

export function useOracle() {
  const [state, setState] = useState<OracleState>({ status: "idle" });
  const nextId = useRef(0);
  const currentId = useRef(0);
  const wanted = useRef<AbortController | null>(null);

  // Tells api.ts the previous ruling is no longer wanted, so a check it started can be dropped.
  const drop = useCallback((next: AbortController | null) => {
    const previous = wanted.current;
    wanted.current = next;
    previous?.abort();
  }, []);

  const rule = useCallback(
    (item: string, origin: Origin) => {
      const id = ++nextId.current;
      currentId.current = id;
      const base = { id, item, origin };
      const nonsense = precheckItem(item);
      if (nonsense) {
        drop(null);
        setState({ ...base, status: "done", result: nonsense, meta: null });
        return;
      }
      const cached = cachedClassified(item);
      if (cached) {
        drop(null);
        setState(settle(base, cached));
        return;
      }
      setState({ ...base, status: "loading" });
      const controller = new AbortController();
      const pending = classify(item, controller.signal);
      drop(controller);
      pending.then(
        (meta) => {
          if (currentId.current !== id) return;
          setState(settle(base, meta));
        },
        (error: unknown) => {
          if (currentId.current !== id) return;
          const failure = error instanceof RulingError ? error : new RulingError("internal");
          setState({ ...base, status: "error", error: failure });
        },
      );
    },
    [drop],
  );

  const reset = useCallback(() => {
    currentId.current = ++nextId.current;
    drop(null);
    setState({ status: "idle" });
  }, [drop]);

  return { state, rule, reset };
}
