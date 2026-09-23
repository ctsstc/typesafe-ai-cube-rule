import { normalizeItem } from "@cube/core";
import {
  type ComponentType,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AnnouncerProvider } from "./components/Announcer";
import { DocketSlot } from "./components/DocketSlot";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FoodForm } from "./components/FoodForm";
import { Footer } from "./components/Footer";
import { Gallery } from "./components/Gallery";
import { Header } from "./components/Header";
import { HeroArt } from "./components/HeroArt";
import { MockBanner } from "./components/MockBanner";
import { RulingCard } from "./components/RulingCard";
import { canEcho, type OracleState, useOracle } from "./hooks/useOracle";
import { prefersReducedMotion } from "./hooks/useReducedMotion";
import { APP_NAME, HOME_TITLE, heroQuestion, resultTitle } from "./lib/copy";
import { surpriseFood } from "./lib/foods";
import { sentenceCase } from "./lib/format";
import { foodFromSearch, foodHref } from "./lib/url";

interface ShownProps {
  readonly onShown: () => void;
}

function announceShown(Section: ComponentType): ComponentType<ShownProps> {
  return function Shown({ onShown }: ShownProps) {
    useEffect(() => onShown(), [onShown]);
    return <Section />;
  };
}

// Below the fold and mostly text, so they stay out of the initial bundle.
const HowJevRules = lazy(() =>
  import("./components/HowJevRules").then(
    (m) => ({ default: announceShown(m.HowJevRules) }),
    () => ({ default: announceShown(() => null) }),
  ),
);
const About = lazy(
  (): Promise<{ default: ComponentType }> =>
    import("./components/About").then(
      (m) => ({ default: m.About }),
      () => ({ default: () => null }),
    ),
);

function titleFor(state: OracleState): string {
  if (state.status === "idle") return HOME_TITLE;
  const echo = canEcho(state);
  if (state.status === "done" && (echo || state.result.kind === "declined")) {
    return resultTitle(state.result);
  }
  return echo ? `${sentenceCase(state.item)} | ${APP_NAME}` : `Ruling | ${APP_NAME}`;
}

// Entries this tab pushed for a food the person picked carry this state. Anything else, including
// the entry a deep link opened, is replayed as a link so its text stays hidden until Jev clears it.
const TYPED = { typed: true } as const;

function isTyped(state: unknown): boolean {
  return (
    typeof state === "object" && state !== null && (state as { typed?: unknown }).typed === true
  );
}

function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}

export function App() {
  const { state, rule, reset } = useOracle();
  const [query, setQuery] = useState("");
  const [mockSeen, setMockSeen] = useState(false);
  const [bannerHidden, setBannerHidden] = useState(false);
  const [model, setModel] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rulingRef = useRef<HTMLDivElement>(null);
  const hero = useRef(heroQuestion()).current;
  const heroItem = normalizeItem(hero.food);
  const shown = useRef({ search: location.search, typed: false });
  const pendingHash = useRef(foodFromSearch(location.search) ? "" : location.hash);
  const [sectionsShown, setSectionsShown] = useState(false);
  const showSections = useCallback(() => setSectionsShown(true), []);

  const submit = useCallback(
    (item: string) => {
      setQuery(item);
      const href = foodHref(item);
      if (`${location.pathname}${location.search}` === href) history.replaceState(TYPED, "");
      else history.pushState(TYPED, "", href);
      shown.current = { search: location.search, typed: true };
      rule(item, "typed");
      requestAnimationFrame(() =>
        rulingRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }),
      );
    },
    [rule],
  );

  useEffect(() => {
    const fromUrl = foodFromSearch(location.search);
    if (fromUrl) rule(fromUrl, "link");
    const onPop = () => {
      const typed = isTyped(history.state);
      // In-page anchors fire popstate too. They keep the search, so the ruling stays as it is.
      if (location.search === shown.current.search) {
        if (shown.current.typed && !typed) history.replaceState(TYPED, "");
        return;
      }
      shown.current = { search: location.search, typed };
      const item = foodFromSearch(location.search);
      if (!item) {
        setQuery("");
        reset();
      } else if (typed) {
        setQuery(item);
        rule(item, "history");
      } else {
        setQuery("");
        rule(item, "link");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [rule, reset]);

  // How Jev rules and About render late, and the display font can still move things. Browsers
  // without scroll anchoring keep the old offset, so a hash in the first URL waits for all of them.
  useEffect(() => {
    const hash = pendingHash.current;
    if (!sectionsShown || !hash) return;
    pendingHash.current = "";
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (location.hash !== hash || foodFromSearch(location.search)) return;
      document.getElementById(hash.slice(1))?.scrollIntoView();
    });
  }, [sectionsShown]);

  useEffect(() => {
    document.title = titleFor(state);
    if (state.status !== "done") return;
    if (state.meta?.response.mock) setMockSeen(true);
    if (state.meta) setModel(state.meta.response.model);
    if (state.result.kind === "declined" || !canEcho(state)) {
      // Never leave abusive text in the address bar or the input of a shared link.
      history.replaceState(null, "", "/");
      shown.current = { search: "", typed: false };
      if (state.origin !== "typed") setQuery("");
    } else if (state.origin === "link") {
      setQuery(state.item);
    }
  }, [state]);

  const focusInput = useCallback(() => {
    inputRef.current?.focus();
    inputRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  }, []);

  const cubeAnother = useCallback(() => {
    setQuery("");
    focusInput();
  }, [focusInput]);

  const active = state.status === "idle" ? null : state;

  return (
    <AnnouncerProvider>
      <a className="skip-link" href="#food-input">
        Skip to the oracle
      </a>
      {mockSeen && !bannerHidden && <MockBanner onDismiss={() => setBannerHidden(true)} />}
      <Header />
      <ErrorBoundary>
        <main id="main">
          <section
            id="oracle"
            className="hero container"
            data-compact={active ? true : undefined}
            aria-labelledby={active ? "food-label" : "hero-title"}
          >
            {active ? (
              active.item === heroItem && <p className="hero__title">{hero.question}</p>
            ) : (
              <div className="hero__top">
                <div className="hero__text">
                  <h1 id="hero-title" className="hero__title">
                    {hero.question}
                  </h1>
                  <p className="hero__sub">
                    Name any food. Jev finds the structural starch, and the cube rules.
                  </p>
                </div>
                <HeroArt hero={hero} onPick={submit} />
              </div>
            )}
            <FoodForm
              value={query}
              onChange={setQuery}
              onSubmit={submit}
              onSurprise={() => submit(surpriseFood(active?.item ?? null))}
              inputRef={inputRef}
            />
          </section>
          <div ref={rulingRef} className="container ruling-slot">
            {active && (
              <RulingCard
                key={active.id}
                state={active}
                level={1}
                onRetry={() => rule(active.item, active.origin)}
                onEdit={focusInput}
                onCubeAnother={cubeAnother}
              />
            )}
          </div>
          <Gallery onPick={submit} />
          <DocketSlot onPick={submit} />
          {/* One boundary, so onShown fires only once About has rendered too. */}
          <Suspense
            fallback={
              <>
                <section id="how-jev-rules" className="jev container" />
                <section id="about" className="about container" />
              </>
            }
          >
            <HowJevRules onShown={showSections} />
            <About />
          </Suspense>
        </main>
      </ErrorBoundary>
      <Footer model={model} />
    </AnnouncerProvider>
  );
}
