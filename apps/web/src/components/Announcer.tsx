import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface AnnouncerApi {
  readonly announce: (message: string) => void;
  readonly toast: (message: string) => void;
}

const AnnouncerContext = createContext<AnnouncerApi>({ announce: () => {}, toast: () => {} });

export const useAnnouncer = () => useContext(AnnouncerContext);

const TOAST_MS = 2500;

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const [toastText, setToastText] = useState<string | null>(null);
  const frame = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Clearing first makes screen readers repeat an identical message.
  const announce = useCallback((next: string) => {
    setMessage("");
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setMessage(next));
  }, []);

  const toast = useCallback(
    (next: string) => {
      setToastText(next);
      announce(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setToastText(null), TOAST_MS);
    },
    [announce],
  );

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      clearTimeout(timer.current);
    },
    [],
  );

  const api = useMemo(() => ({ announce, toast }), [announce, toast]);

  return (
    <AnnouncerContext.Provider value={api}>
      {children}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
      {toastText && (
        <div className="toast" aria-hidden="true">
          {toastText}
        </div>
      )}
    </AnnouncerContext.Provider>
  );
}
