// A small router for the pages of alcyone, built on the History API.

import { useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { ID_PATTERN } from "../shared/board.ts";

export type Route = { name: "boards" } | { name: "board"; id: string } | { name: "not-found" };

export function matchRoute(pathname: string): Route {
  if (pathname === "/") return { name: "boards" };
  const id = /^\/boards\/([^/]+)$/.exec(pathname)?.[1];
  if (id !== undefined && ID_PATTERN.test(id)) return { name: "board", id };
  return { name: "not-found" };
}

export function navigate(to: string): void {
  window.history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname);
}

export function useRoute(): Route {
  return matchRoute(usePathname());
}

export function Link({ to, className, children, ariaLabel }: { to: string; className?: string; children: ReactNode; ariaLabel?: string }) {
  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    // Let the browser open new tabs and windows as usual.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(to);
  }
  return (
    <a href={to} onClick={handleClick} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  );
}
