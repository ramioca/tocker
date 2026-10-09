/**
 * What an onboarding dialog puts between itself and the app. The first-run card
 * (`first-run.tsx`) and the key prompt (`key-prompt.tsx`) both open over whichever page
 * the person is on, and both use this one string, so the two cannot drift apart.
 *
 * The page is dimmed by 40% and blurred by 8px. The app is nearly black already, so a
 * deeper dim leaves little of it to see; at this one its bar, its cards and the colour of
 * a chart are still recognisably there, and the blur is what keeps them from competing
 * with the dialog or being read by mistake. It is margin, not what makes a dialog's
 * words readable: each dialog's own fill does that, over any page.
 *
 * Asked for less transparency or for more contrast, the blur goes and the dim deepens to
 * 80%, as the glass surfaces turn to paint (globals.css): a sharp page at more than half
 * its brightness would compete with the dialog in front of it.
 *
 * It is at z-100, with the dialog's viewport after it at the same level: over the top
 * bar (30), the phone tab bar (40) and the run and approvals islands (50). Toasts are
 * drawn above every dialog, on Sonner's own layer.
 *
 * It fades on the dialog's starting and ending styles. The caller says for how long, to
 * match its own panel. Class names are whole literals so Tailwind sees them.
 */
export const APP_BACKDROP = [
  "fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm",
  "[@media(prefers-reduced-transparency:reduce)]:bg-black/80",
  "[@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none",
  "contrast-more:bg-black/80 contrast-more:backdrop-blur-none",
  "transition-opacity ease-[var(--ease-out-strong)] data-ending-style:opacity-0 data-starting-style:opacity-0",
].join(" ");
