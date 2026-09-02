// Mounts the cowork React UI inside antontron. Antontron's renderer owns
// terms/install/onboarding gating; this component is rendered after those
// pass, in place of the old <Terminal /> page.
//
// Cowork's globals.css ships its own theme tokens (--surface-*, --primary-*,
// --frost-*, etc.). It's loaded here so cowork views render correctly
// regardless of antontron's own styles.
import { useEffect } from 'react';
import './cowork/styles/globals.css';
import CoworkRoot from './cowork/App';
import { ensureUserNameMemory } from './lib/userIdentity';

export default function CoworkApp() {
  // First time the signed-in user reaches the app, record their name in shared
  // profile memory so the agent can greet them personally. Idempotent and best-effort.
  useEffect(() => {
    ensureUserNameMemory();
  }, []);

  return <CoworkRoot />;
}
