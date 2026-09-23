import {
  type ComponentType,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

interface DocketProps {
  readonly onPick: (item: string) => void;
  readonly hold?: boolean;
  readonly onShown?: () => void;
}

const Docket = lazy(
  (): Promise<{ default: ComponentType<DocketProps> }> =>
    import("./Docket").then(
      (m) => ({ default: m.Docket }),
      () => ({ default: () => null }),
    ),
);

// From mid-viewport to 600px below it. Inserting the docket while its slot sits higher would push
// what the reader is looking at, such as a section a hash link scrolled to, out of view.
const BAND = "-50% 0px 600px 0px";

/** Loads the docket once the reader nears it, and shows it only while it lands below them. */
export function DocketSlot({ onPick }: Pick<DocketProps, "onPick">) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [below, setBelow] = useState(false);
  const [shown, setShown] = useState(false);
  const onShown = useCallback(() => setShown(true), []);

  useEffect(() => {
    const slot = ref.current;
    if (shown || !slot || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const bandTop = entry.rootBounds?.top ?? window.innerHeight / 2;
          setBelow(entry.boundingClientRect.top >= bandTop);
          if (entry.isIntersecting) setNear(true);
        }
      },
      { rootMargin: BAND },
    );
    observer.observe(slot);
    return () => observer.disconnect();
  }, [shown]);

  return (
    <div ref={ref}>
      {near && (
        <Suspense fallback={null}>
          <Docket onPick={onPick} hold={!below} onShown={onShown} />
        </Suspense>
      )}
    </div>
  );
}
