"use client";

import React, {
  type PropsWithChildren,
  startTransition,
  // @ts-expect-error - no typings for "use" yet
  use,
  useContext,
  useEffect,
  useState,
  createContext,
} from "react";
// @ts-expect-error - no typings yet
import {
  createFromFetch,
  encodeReply,
} from "react-server-dom-webpack/client.browser";
// @ts-expect-error - no typings yet
import type { ReactServerValue } from "react-server-dom-webpack";

const initialCache = new Map();

export const RouterContext = createContext<{
  location: string;
  refresh: (response: Response) => void;
  navigate: (nextLocation: string) => void;
}>({ location: "", refresh: () => {}, navigate: () => {} });

export default function Router() {
  const [cache, setCache] = useState(initialCache);
  const [location, setLocation] = useState(window.location.pathname);

  let content = cache.get(location);
  if (!content) {
    content = createFromFetch(
      fetch(`/__dynasty__?location=${encodeURIComponent(location)}`),
    );
    console.log(content);
    cache.set(location, content);
  }

  function refresh(response: Response) {
    // startTransition(() => {
    // 	const nextCache = new Map()
    // 	if (response != null) {
    // 		const locationKey = response.headers.get("X-Location") ?? "{}"
    // 		const nextLocation = JSON.parse(locationKey)
    // 		const nextContent = createFromReadableStream(response.body)
    // 		nextCache.set(locationKey, nextContent)
    // 		navigate(nextLocation)
    // 	}
    // 	setCache(nextCache)
    // })
  }

  function navigate(nextLocation: string) {
    console.log("navigate", nextLocation);
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
    <RouterContext.Provider value={{ location, navigate, refresh }}>
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
    // biome-ignore lint/a11y/useValidAnchor: this is a progrssive enhancement link, if JS is enabled it will navigate without reloading the page by fetching and applying an RSC bundle. Otherwise it will navigate by reloading the page.
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

export async function callServer(
  id: string,
  args: ReactServerValue,
): Promise<unknown> {
  return createFromFetch(
    fetch(`/`, {
      method: `POST`,
      headers: { accept: `text/x-component`, "x-rsc-action": id },
      body: await encodeReply(args),
    }),
  );
}
