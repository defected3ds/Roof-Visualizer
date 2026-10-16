import { createContext, useContext, useEffect, useState } from 'react';
import { textLookup } from '../texts';
import type { Texts } from '../types';

const TextsContext = createContext<(key: string) => string>(textLookup({}));
const ReadyContext = createContext(false);

/** Loads the admin-edited app texts and makes them available through useT(). */
export function TextsProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<Texts>({});
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fetch('/api/texts')
      .then((r) => (r.ok ? r.json() : {}))
      .then(setOverrides)
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);
  return (
    <ReadyContext.Provider value={ready}>
      <TextsContext.Provider value={textLookup(overrides)}>{children}</TextsContext.Provider>
    </ReadyContext.Provider>
  );
}

export const useT = () => useContext(TextsContext);
/** False until the admin-edited texts have loaded; use it to avoid flashing default content (e.g. the start photo). */
export const useTextsReady = () => useContext(ReadyContext);
