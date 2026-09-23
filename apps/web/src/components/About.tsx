import { RICE_CLAUSE } from "@cube/core";
import { MadeBy } from "./MadeBy";

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
          <p>
            The words are templates in our code, filled in from Jev's numbers, and the site was
            built with Claude Code. <a href="#how-jev-rules">How Jev rules</a> has the details and
            the test scores.
          </p>
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
              The food you type goes to this site's server on Cloudflare Pages. If nobody has asked
              about it before, the server sends the name, and only the name, to TypeSafe's API.
            </li>
            <li>
              Foods also go in the page address (<code>/?food=</code>), so they land in your browser
              history and links you share, and your browser may cache rulings for a year.
            </li>
            <li>
              Rulings are stored by food name in Cloudflare with no expiry date, so Jev usually
              isn't asked twice. Who asked is not stored.
            </li>
            <li>
              Once a food has been asked about at least twice, which usually means from two
              different browsers, it may show up in the public lists on this page. The server notes
              when each food was first asked, but the lists show only foods and rulings: never who
              asked, and no times. Pattern rules and Jev's own reading screen out names of private
              people, phone numbers, email addresses, links and anything flagged as abusive. No
              screen catches everything, so anything that slips through can be hidden by hand.
            </li>
            <li>
              A new food costs real money, so first Turnstile by Cloudflare checks that a person is
              asking, usually unseen. It loads only when a new food needs the check, which can be
              the moment you open a shared link to one. It sees your IP address, your browser and
              the page address, food included. Cloudflare's{" "}
              <a href="https://www.cloudflare.com/turnstile-privacy-policy/" rel="noopener">
                Turnstile privacy addendum
              </a>{" "}
              says it may also use signals like your IP address and browser to improve its bot
              detection.
            </li>
            <li>
              Passing the check sets one cookie, <code>cube_session</code>, for an hour: a random ID
              and its start and end times, signed and sent only to this site's <code>/api</code>. It
              covers up to 60 new foods. It's the only cookie this site sets, though Turnstile's
              frame may keep its own on Cloudflare's domain.
            </li>
            <li>
              To cap the bill, the server counts Jev calls per day, per session and per IP address
              per day, the last under a keyed hash so the address itself is never stored. Expired
              counts are deleted the next time anyone passes the check, though Cloudflare's database
              restore can bring them back for up to 30 days. No count holds what you typed.
            </li>
            <li>
              A new food or a check also holds your IP address in the server's memory to slow floods
              of requests, until that server instance next checks the limit after its one minute
              window, or stops. Our code logs neither it nor what you typed. Cloudflare's live log
              shows both while we have it open, and that log isn't saved.
            </li>
            <li>
              No accounts and no ads. Cloudflare Web Analytics counts page views without cookies. It
              strips <code>?food=</code> before reporting, so your foods never reach it. It sends
              the page path, the referring page, browser and OS versions and load timings.
              Cloudflare says it collects no personal data.
            </li>
            <li>Your theme choice, if you pick one, stays in your browser's local storage.</li>
            <li>
              Cloudflare and TypeSafe handle what they receive under their own policies:{" "}
              <a href="https://www.cloudflare.com/privacypolicy/" rel="noopener">
                Cloudflare's privacy policy
              </a>{" "}
              and{" "}
              <a href="https://typesafe.ai/legal/privacy-policy" rel="noopener">
                TypeSafe's privacy policy
              </a>
              . TypeSafe says it doesn't train its models on what we send but may keep it.
            </li>
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
          <MadeBy />
        </article>
      </div>
    </section>
  );
}
