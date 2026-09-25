"use client";

import { Link2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { ShareButton } from "@/components/spectrumui/share-button";
import { copyLink } from "@/components/common/copy-link";

/**
 * Copy link, plus a ready-to-paste invite. Only share actions belong in the fan —
 * "open the feed" used to sit here, and it is navigation.
 *
 * The fan opens leftwards, so the header renders this before the Follow pill: it
 * spreads over empty space rather than across the button beside it.
 */
export function ProfileShare({ handle }: { handle: string }) {
  const url = typeof window === "undefined" ? `/u/${handle}` : `${window.location.origin}/u/${handle}`;

  function copyInvite() {
    const failed = () => toast.error("Could not copy the invite. Your browser blocked the clipboard.");
    // Absent outside a secure context. It used to fail silently behind `?.`.
    if (!navigator.clipboard) {
      failed();
      return;
    }
    navigator.clipboard
      .writeText(`Follow @${handle} on Tocker: ${url}`)
      .then(() => toast.success("Invite copied"), failed);
  }

  return (
    <ShareButton
      label={`Share @${handle}`}
      size="sm"
      direction="left"
      actions={[
        {
          icon: <Link2 className="size-4" aria-hidden />,
          label: "Copy link",
          onSelect: () => copyLink(url),
        },
        {
          icon: <UserPlus className="size-4" aria-hidden />,
          label: "Copy an invite",
          onSelect: copyInvite,
        },
      ]}
    />
  );
}
