import { LogoCube } from "./Icons";
import { ThemeToggle } from "./ThemeToggle";

export function Header() {
  return (
    <header className="site-header">
      <div className="container container--wide site-header__inner">
        <a className="wordmark" href="/">
          <LogoCube />
          <span>Cube Rule Oracle</span>
        </a>
        <nav className="site-nav" aria-label="Sections">
          <a href="#oracle">Rule</a>
          <a href="#gallery">Cubes</a>
          <a href="#about">About</a>
        </nav>
        <ThemeToggle />
      </div>
    </header>
  );
}
