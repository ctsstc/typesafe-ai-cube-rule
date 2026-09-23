import { type ComponentType, lazy, Suspense, useEffect, useRef, useState } from "react";

interface DocketProps {
  readonly onPick: (item: string) => void;
}

const Docket = lazy(
  (): Promise<{ default: ComponentType<DocketProps> }> =>
    import("./Docket").then(
      (m) => ({ default: m.Docket }),
      () => ({ default: () => null }),
    ),
);

// Below only. Loading while the slot sits above the viewport would push a section that a hash
// link scrolled to out of view in browsers without scroll anchoring.
const NEAR_BELOW = "0px 0px 600px 0px";

/** Loads and fetches the docket only once the reader scrolls near it. */
export function DocketSlot({ onPick }: DocketProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const slot = ref.current;
    if (near || !slot || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: NEAR_BELOW },
    );
    observer.observe(slot);
    return () => observer.disconnect();
  }, [near]);

  return (
    <div ref={ref}>
      {near && (
        <Suspense fallback={null}>
          <Docket onPick={onPick} />
        </Suspense>
      )}
    </div>
  );
}
