import { CloseIcon } from "./Icons";

export function MockBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <aside className="mock-banner" aria-label="Demo mode">
      <p>
        <strong>Demo mode:</strong> no TypeSafe key is set, so these rulings are simulated.
        Consistent, not correct. <a href="#about-mock">What's this?</a>
      </p>
      <button
        type="button"
        className="icon-button mock-banner__close"
        aria-label="Hide the demo mode notice"
        onClick={onDismiss}
      >
        <CloseIcon />
      </button>
    </aside>
  );
}
