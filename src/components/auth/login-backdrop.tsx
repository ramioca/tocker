import { LoginSilk } from "./login-silk";
import "./auth.css";

/**
 * The ground behind the sign-in card, back to front: poster, silk (when it loads),
 * scrim. The grain is a pseudo-element.
 *
 * In a file of its own because two surfaces draw it: /login (`login-shell.tsx`) and the
 * first-run screen a new account lands on next (`onboarding/first-run-ground.tsx`). It is
 * one backdrop, not two that look alike, but each surface mounts its own: arriving from
 * /login the poster is the same and the silk's code is already loaded, while the silk
 * itself starts again and fades in over the poster as it did there. It imports the
 * stylesheet itself, so it is styled wherever it is drawn.
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
