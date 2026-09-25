import { toast } from "sonner";

/**
 * Copy a link and say what happened, for the "Copy link" action in a share fan.
 *
 * The Spectrum share button's own copy swallows a refused clipboard (permission denied,
 * an insecure origin, some in-app browsers) and confirms success only with an
 * aria-hidden tooltip, so neither outcome reached a screen reader and a failure looked
 * like nothing happened. Sonner's toasts are a live region; a failure carries the URL so
 * it can still be copied by hand.
 */
export function copyLink(url: string): void {
  const failed = () => {
    toast.error("Couldn't copy the link", { description: url });
  };
  // Absent outside a secure context, rather than rejecting.
  if (!navigator.clipboard) {
    failed();
    return;
  }
  navigator.clipboard.writeText(url).then(() => {
    toast.success("Link copied");
  }, failed);
}
