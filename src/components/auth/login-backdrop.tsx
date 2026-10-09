import { LoginSilk } from "./login-silk";
import "./auth.css";

/**
 * The ground behind the sign-in card, back to front: poster, silk (when it loads),
 * scrim. The grain is a pseudo-element.
 *
 * /login is the only page that draws it (`login-shell.tsx`): the first-run card a new
 * account sees next opens over the app instead. It imports the stylesheet itself, so it
 * is styled wherever it is drawn.
 */
export function LoginBackdrop() {
  return (
    <div className="auth-bg" aria-hidden>
      <div className="auth-bg-poster" />
      <LoginSilk />
      <div className="auth-bg-scrim" />
    </div>
  );
}
