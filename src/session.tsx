// The signed-in person, loaded once when the app starts and shared by every page.

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Me } from "../shared/api.ts";
import { api } from "./api.ts";

const SessionContext = createContext<Me | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .getMe()
      .then(({ me: loaded }) => setMe(loaded))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error !== "") {
    return (
      <main className="mx-auto max-w-[640px] p-4">
        <p className="error-box">{error}</p>
      </main>
    );
  }
  // The pages need to know who is signed in, so they wait for it. The request is quick.
  if (me === null) return null;
  return <SessionContext.Provider value={me}>{children}</SessionContext.Provider>;
}

export function useMe(): Me {
  const me = useContext(SessionContext);
  if (me === null) throw new Error("useMe needs a SessionProvider around the page.");
  return me;
}
