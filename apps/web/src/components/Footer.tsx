import { QUESTION_SET_VERSION } from "@cube/core";

export function Footer({ model }: { model: string | null }) {
  return (
    <footer className="site-footer">
      <div className="container container--wide">
        <p className="site-footer__credit">
          Unofficial fan app. The Cube Rule is by{" "}
          <a href="https://twitter.com/Phosphatide" rel="noopener">
            @Phosphatide
          </a>
          . <a href="https://cuberule.com/">cuberule.com</a> is by{" "}
          <a href="https://twitter.com/indirect" rel="noopener">
            @indirect
          </a>
          . Rulings by Jev from <a href="https://typesafe.ai/">TypeSafe</a>.
        </p>
        <p className="site-footer__meta">
          <span>v{__APP_VERSION__}</span>
          <span>question set {QUESTION_SET_VERSION}</span>
          {model && <span>{model}</span>}
          <a href="#about">About and privacy</a>
          <a href="#gallery">The nine cubes</a>
        </p>
      </div>
    </footer>
  );
}
