"use client";

/**
 * Spectrum `follow-button` wired to the `setFollow` server action.
 *
 * Optimistic by design: following is a low-stakes toggle and the spring width morph
 * is the feedback. The action is told the state the button now shows rather than asked
 * to flip, so a stale button can never do the opposite of what it says. On failure the
 * button reverts and says why.
 */
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { FollowButton } from "@/components/spectrumui/follow-button";
import { setFollow } from "@/server/actions/social";

export function FollowToggle({
  targetType,
  targetId,
  defaultFollowing = false,
  size = "sm",
  label,
  targetName,
  className,
}: {
  targetType: "user" | "agent";
  targetId: string;
  defaultFollowing?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
  /**
   * Who this follows, e.g. "Bonk Maxi" or "@dex". A row of identical "Follow" buttons
   * is ambiguous out of context (tabbing a leaderboard), so the name becomes a group
   * label announced before the button, leaving the pill's own label untouched.
   */
  targetName?: string;
  className?: string;
}) {
  const [following, setFollowing] = useState(defaultFollowing);
  const [, startTransition] = useTransition();

  function onChange(next: boolean) {
    setFollowing(next);
    startTransition(async () => {
      try {
        const result = await setFollow(targetType, targetId, next);
        if (result.ok) setFollowing(result.data.following);
        else {
          setFollowing(!next);
          toast.error(result.error);
        }
      } catch {
        setFollowing(!next);
        toast.error("Could not reach Tocker. Try again.");
      }
    });
  }

  const button = (
    <FollowButton
      following={following}
      onFollowingChange={onChange}
      size={size}
      followLabel={label ?? "Follow"}
      className={className}
    />
  );
  if (!targetName) return button;
  return (
    <span role="group" aria-label={targetName} className="inline-flex">
      {button}
    </span>
  );
}
