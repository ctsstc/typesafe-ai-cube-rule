import { AUTHOR, CLAUDE_CODE_URL, SOURCE_URL } from "../lib/links";

export function MadeBy({ className }: { className?: string }) {
  return (
    <p className={className}>
      Made by {AUTHOR.name} (
      <a href={AUTHOR.github} rel="noopener" aria-label={`${AUTHOR.name} on GitHub`}>
        GitHub
      </a>
      ,{" "}
      <a href={AUTHOR.linkedin} rel="noopener" aria-label={`${AUTHOR.name} on LinkedIn`}>
        LinkedIn
      </a>
      ). Built with{" "}
      <a href={CLAUDE_CODE_URL} rel="noopener">
        Claude Code
      </a>
      .{" "}
      <a href={SOURCE_URL} rel="noopener">
        Source code on GitHub
      </a>
      .
    </p>
  );
}
