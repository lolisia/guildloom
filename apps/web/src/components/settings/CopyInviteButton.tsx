/**
 * Copy button for an invite link.
 *
 * The API stores a relative URL (`/invite/<code>`); the clipboard receives the
 * absolute URL built from `window.location.origin`. The button reports success
 * and failure inline so the action works without a toast system.
 */
import { useState } from "react";

import { inviteAbsoluteUrl } from "../../api/invites";
import { ko } from "../../i18n/ko";

export interface CopyInviteButtonProps {
  /** Relative invite route returned by the API. */
  url: string;
}

/** Copies `window.location.origin + url` and shows the copied state. */
export function CopyInviteButton({ url }: CopyInviteButtonProps) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  const handleCopy = async () => {
    try {
      const clipboard = navigator.clipboard;
      if (!clipboard || typeof clipboard.writeText !== "function") {
        throw new Error("Clipboard API unavailable");
      }
      await clipboard.writeText(inviteAbsoluteUrl(url));
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void handleCopy()}
        className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-300 transition-colors hover:border-emerald-500/60 hover:text-emerald-300"
      >
        {status === "copied" ? ko.settings.copied : ko.settings.copyInvite}
      </button>
      {status === "failed" ? (
        <span role="alert" className="text-xs text-rose-300">
          {ko.settings.copyFailed}
        </span>
      ) : null}
    </span>
  );
}

export default CopyInviteButton;
