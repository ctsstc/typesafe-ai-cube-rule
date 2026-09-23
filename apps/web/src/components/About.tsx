import { RICE_CLAUSE } from "@cube/core";

export function About() {
  return (
    <section id="about" className="about container" aria-labelledby="about-title">
      <div className="section-head">
        <h2 id="about-title">About the Oracle</h2>
        <p>An unofficial fan app. Not affiliated with cuberule.com, its creators, or TypeSafe.</p>
      </div>

      <div className="about__grid">
        <article>
          <h3>What's the Cube Rule?</h3>
          <p>
            A food taxonomy that ignores ingredients and asks one question: where is the structural
            starch? Picture the food inside a cube, mark the faces made of bread, tortilla, pastry,
            or pasta, and the pattern tells you what it is. A hot dog has starch on the bottom and
            both sides, so it's a taco.
          </p>
          <p>
            The Cube Rule was created by{" "}
            <a href="https://twitter.com/Phosphatide" rel="noopener">
              @Phosphatide
            </a>{" "}
            and lives at <a href="https://cuberule.com/">cuberule.com</a>, built by{" "}
            <a href="https://twitter.com/indirect" rel="noopener">
              @indirect
            </a>
            . Go read the original. It's better than this app.
          </p>
        </article>

        <article>
          <h3>Who decides?</h3>
          <p>
            Jev, a System One model from <a href="https://typesafe.ai/">TypeSafe</a>. Jev doesn't
            write sentences. We describe the nine cubes, hand it the name you typed, and it returns
            a probability for each one, plus a few yes or no judgments like "is this food?" and "is
            it served in liquid?"
          </p>
          <p>Every word on this page was written by people. The numbers are Jev's.</p>
        </article>

        <article>
          <h3>Why Jev might be wrong</h3>
          <p>
            Jev only sees the name, never a photo. Foods come in many forms: a pizza slice is toast,
            and deep-dish is a quiche. When cuberule.com has already ruled on a food, the canon wins
            and Jev's own opinion shows up as a dissent if it disagrees.
          </p>
          <p>Some questions stay open by design. In the words of the site: "{RICE_CLAUSE}"</p>
        </article>

        <article>
          <h3>What gets sent where</h3>
          <ul>
            <li>
              The food name you type goes from your browser to this site's server, which runs on
              Cloudflare Pages. If nobody has asked about that food before, the server sends the
              name, and only the name, to TypeSafe's API.
            </li>
            <li>
              Each ruling is stored by food name in Cloudflare, so the next person who asks gets the
              same answer instantly and Jev usually isn't asked twice. Who asked is not stored.
            </li>
            <li>
              Asking Jev about a new food costs real money, so before the first one, Turnstile by
              Cloudflare checks that a person is asking. It usually runs unseen and now and then
              asks for a click. It loads from Cloudflare only at that moment, never when the page
              opens, and foods someone already asked about usually don't trigger it.
            </li>
            <li>
              Passing the check sets one cookie, <code>cube_session</code>, for an hour. It holds a
              random ID and its start and end times, signed so it can't be forged, and it is only
              sent to this site's <code>/api</code>. It covers up to 60 new foods.
            </li>
            <li>
              To keep the bill in check, the server counts Jev calls per day (a date and a number),
              per session (the random ID, until it expires), and per IP address per day. That last
              count is filed under a keyed hash of your IP address and the date, so the address
              itself is never stored, and it is deleted once the day is over. No count holds what
              you typed.
            </li>
            <li>
              Your IP address is held in the server's memory to slow down floods of requests. It is
              dropped at the first request after its one minute window ends, or when that server
              instance stops. It is also passed to Cloudflare when you take the check. Our code
              doesn't log it or what you typed.
            </li>
            <li>No accounts and no analytics scripts. The session cookie is the only cookie.</li>
            <li>Your theme choice stays in your browser's local storage.</li>
            <li>Cloudflare and TypeSafe handle each request under their own privacy policies.</li>
          </ul>
        </article>

        <article id="about-mock">
          <h3>Demo mode</h3>
          <p>
            When the server has no TypeSafe key, it answers with simulated rulings instead of asking
            Jev. They are consistent for a given food and shaped exactly like the real thing, but
            they are not real rulings. Every simulated ruling is stamped "Simulated".
          </p>
        </article>

        <article>
          <h3>Credits</h3>
          <p>
            The Cube Rule by{" "}
            <a href="https://twitter.com/Phosphatide" rel="noopener">
              @Phosphatide
            </a>
            . <a href="https://cuberule.com/">cuberule.com</a> by{" "}
            <a href="https://twitter.com/indirect" rel="noopener">
              @indirect
            </a>
            . Rulings by Jev from TypeSafe. The cube drawings on this page are our own. Display type
            is Fraunces by Undercase Type.
          </p>
        </article>
      </div>
    </section>
  );
}
