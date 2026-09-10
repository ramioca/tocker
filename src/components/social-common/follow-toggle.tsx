"use client";

/**
 * Spectrum `follow-button` wired to the `toggleFollow` server action.
 *
 * Optimistic by design: following is a low-stakes toggle and the spring width morph
 * is the feedback. If the action fails for a real reason we revert; while foundation's
 * action still throws "not implemented" we keep the optimistic state so the UI is
 * reviewable in mock mode.
 */
import { useState, useTransition } from "react";
import { FollowButton } from "@/components/spectrumui/follow-button";
import { toggleFollow } from "@/server/actions/social";

export function FollowToggle({
  targetType,
  targetId,
  defaultFollowing = false,
  size = "sm",
  label,
  className,
}: {
  targetType: "user" | "agent";
  targetId: string;
  defaultFollowing?: boolean;
  size?: "sm" | "md" | "lg";
  label?: string;
  className?: string;
}) {
  const [following, setFollowing] = useState(defaultFollowing);
  const [, startTransition] = useTransition();

  function onChange(next: boolean) {
    setFollowing(next);
    startTransition(async () => {
      try {
        const result = await toggleFollow(targetType, targetId);
        if (result.ok) setFollowing(result.data.following);
        else setFollowing(!next);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("not implemented")) setFollowing(!next);
      }
    });
  }

  return (
    <FollowButton
      following={following}
      onFollowingChange={onChange}
      size={size}
      followLabel={label ?? "Follow"}
      className={className}
    />
  );
}
