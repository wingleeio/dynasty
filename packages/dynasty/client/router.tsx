"use client";

import React, {
  type PropsWithChildren,
  startTransition,
  use,
  useContext,
  useEffect,
  useState,
  createContext,
} from "react";
// @ts-expect-error - no typings yet
import { createFromFetch } from "react-server-dom-webpack/client.browser";

const initialCache = new Map();

export const RouterContext = createContext<{
  location: string;
  // refresh: (response: Response) => void
  navigate: (nextLocation: string) => void;
}>({ location: "", navigate: () => {} });

export default function Router() {
  const [cache] = useState(initialCache);
  const [location, setLocation] = useState(window.location.pathname);

  let content = cache.get(location);

  if (!content) {
    content = createFromFetch(
      fetch(`/__dynasty__?location=${encodeURIComponent(location)}`),
    );
    cache.set(location, content);
  }

  function navigate(nextLocation: string) {
    window.history.pushState(null, "", nextLocation);
    startTransition(() => {
      setLocation(nextLocation);
    });
  }

  useEffect(() => {
    function handlePopState(e: PopStateEvent) {
      startTransition(() => {
        setLocation(window.location.pathname);
      });
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return (
    <RouterContext.Provider value={{ location, navigate }}>
      {use(content)}
    </RouterContext.Provider>
  );
}

export function useRouter() {
  return useContext(RouterContext);
}

export function Link({ children, href }: PropsWithChildren<{ href: string }>) {
  const { navigate } = useRouter();
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        navigate(href);
      }}
    >
      {children}
    </a>
  );
}
