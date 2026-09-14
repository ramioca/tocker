"use client";

import { useRouter } from "next/navigation";
import { Rss, UserPlus } from "lucide-react";
import { ShareButton } from "@/components/spectrumui/share-button";

export function ProfileShare({ handle }: { handle: string }) {
  const router = useRouter();
  const url = typeof window === "undefined" ? `/u/${handle}` : `${window.location.origin}/u/${handle}`;

  return (
    <ShareButton
      label={`Share @${handle}`}
      copyValue={url}
      size="sm"
      direction="left"
      actions={[
        {
          icon: <Rss className="size-4" aria-hidden />,
          label: "Open the feed",
          onSelect: () => {
            router.push("/feed");
          },
        },
        {
          icon: <UserPlus className="size-4" aria-hidden />,
          label: "Invite someone",
          onSelect: () => {
            void navigator.clipboard?.writeText(`Follow @${handle} on Tocker: ${url}`);
          },
        },
      ]}
    />
  );
}
