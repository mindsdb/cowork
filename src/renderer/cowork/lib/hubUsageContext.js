import { createContext, useContext } from 'react';

// Usage state for the surfaces that show it (composer notice, Settings → Usage).
// App owns the single poll and provides `{ usage, providerType, refresh }`;
// consumers read it here instead of threading a prop through every view that
// mounts a Composer. Default null = nothing known, render nothing.
export const HubUsageContext = createContext(null);

export function useHubUsageContext() {
  return useContext(HubUsageContext);
}
