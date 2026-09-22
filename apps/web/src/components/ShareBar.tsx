import { useEffect, useRef, useState } from "react";
import { APP_NAME } from "../lib/copy";
import { shareUrl } from "../lib/url";
import { useAnnouncer } from "./Announcer";
import { LinkIcon, PencilIcon, ShareIcon } from "./Icons";

interface ShareBarProps {
  readonly item: string;
  readonly text: string | null;
  readonly onCubeAnother: () => void;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareBar({ item, text, onCubeAnother }: ShareBarProps) {
  const { toast } = useAnnouncer();
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLInputElement>(null);
  const url = shareUrl(item);

  useEffect(() => {
    if (fallbackUrl) fallbackRef.current?.select();
  }, [fallbackUrl]);

  const copyLink = async () => {
    if (await copyText(url)) {
      setFallbackUrl(null);
      toast("Link copied.");
    } else {
      setFallbackUrl(url);
      toast("Couldn't copy. Here's the link:");
    }
  };

  const share = async () => {
    if (typeof navigator.share !== "function" || !text) {
      await copyLink();
      return;
    }
    try {
      await navigator.share({ title: APP_NAME, text, url });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      await copyLink();
    }
  };

  return (
    <div className="share">
      <div className="share__buttons">
        {text && (
          <button type="button" className="button button--primary" onClick={share}>
            <ShareIcon />
            Share ruling
          </button>
        )}
        <button type="button" className="button button--secondary" onClick={copyLink}>
          <LinkIcon />
          Copy link
        </button>
        <button type="button" className="button button--ghost" onClick={onCubeAnother}>
          <PencilIcon />
          Cube another
        </button>
      </div>
      {fallbackUrl && (
        <label className="share__fallback">
          <span>Link to this ruling</span>
          <input
            ref={fallbackRef}
            readOnly
            value={fallbackUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </div>
  );
}
