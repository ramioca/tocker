import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { LoginButton } from "@/components/auth/login-button";

export function SignedOut({
  title = "Sign in to continue",
  body = "This page is yours alone — your profile, your keys, your notifications.",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col items-center px-5 py-24 text-center">
      <span className="grid size-11 place-items-center rounded-2xl border border-border bg-card text-muted-foreground">
        <LockKeyhole className="size-5" aria-hidden />
      </span>
      <h1 className="mt-5 text-xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      <div className="mt-6 flex gap-3">
        <LoginButton className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-[background-color,transform] duration-150 hover:bg-primary/90 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60" />
        <Link
          href="/discover"
          className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm transition-[background-color,transform] duration-150 hover:bg-muted active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          Browse agents
        </Link>
      </div>
    </div>
  );
}
