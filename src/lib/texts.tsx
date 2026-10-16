import { createContext, useContext, useEffect, useState } from 'react';
import { textLookup } from '../texts';
import type { Texts } from '../types';

const TextsContext = createContext<(key: string) => string>(textLookup({}));

/** Loads the admin-edited app texts and makes them available through useT(). */
export function TextsProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<Texts>({});
  useEffect(() => {
    fetch('/api/texts')
      .then((r) => (r.ok ? r.json() : {}))
      .then(setOverrides)
      .catch(() => {});
  }, []);
  return <TextsContext.Provider value={textLookup(overrides)}>{children}</TextsContext.Provider>;
}

export const useT = () => useContext(TextsContext);
