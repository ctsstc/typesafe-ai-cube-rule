import { normalizeItem } from "@cube/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { About } from "./components/About";
import { AnnouncerProvider } from "./components/Announcer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { FoodForm } from "./components/FoodForm";
import { Footer } from "./components/Footer";
import { Gallery } from "./components/Gallery";
import { Header } from "./components/Header";
import { HeroArt } from "./components/HeroArt";
import { MockBanner } from "./components/MockBanner";
import { RulingCard } from "./components/RulingCard";
import { type OracleState, useOracle } from "./hooks/useOracle";
import { prefersReducedMotion } from "./hooks/useReducedMotion";
import { APP_NAME, HOME_TITLE, heroQuestion, resultTitle } from "./lib/copy";
import { surpriseFood } from "./lib/foods";
import { sentenceCase } from "./lib/format";
import { foodFromSearch, foodHref } from "./lib/url";

function titleFor(state: OracleState): string {
  if (state.status === "idle") return HOME_TITLE;
  if (state.status === "done") return resultTitle(state.result);
  return state.origin === "link"
    ? `Ruling | ${APP_NAME}`
    : `${sentenceCase(state.item)} | ${APP_NAME}`;
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

  const submit = useCallback(
    (item: string) => {
      setQuery(item);
      const href = foodHref(item);
      if (`${location.pathname}${location.search}` !== href) history.pushState(null, "", href);
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
      const item = foodFromSearch(location.search);
      if (item) {
        setQuery(item);
        rule(item, "history");
      } else {
        setQuery("");
        reset();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [rule, reset]);

  useEffect(() => {
    document.title = titleFor(state);
    if (state.status !== "done") return;
    if (state.meta?.response.mock) setMockSeen(true);
    if (state.meta) setModel(state.meta.response.model);
    if (state.result.kind === "declined") {
      // Never leave abusive text in the address bar or the input of a shared link.
      history.replaceState(null, "", "/");
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
          <About />
        </main>
      </ErrorBoundary>
      <Footer model={model} />
    </AnnouncerProvider>
  );
}
