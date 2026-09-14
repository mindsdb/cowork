// Mounts the cowork React UI inside antontron. Antontron's renderer owns
// terms/install/onboarding gating; this component is rendered after those
// pass, in place of the old <Terminal /> page.
//
// Cowork's globals.css ships its own theme tokens (--surface-*, --primary-*,
// --frost-*, etc.). It's loaded here so cowork views render correctly
// regardless of antontron's own styles.
import type { ReactElement } from 'react';
import './cowork/styles/globals.css';
import CoworkRootUntyped from './cowork/App';

// cowork/App.jsx is untyped (plain JS) — TS otherwise infers it takes no
// props at all and rejects the pass-through below.
const CoworkRoot = CoworkRootUntyped as (props: { autoOpenSettingsSection?: string }) => ReactElement;

export default function CoworkApp({ autoOpenSettingsSection }: { autoOpenSettingsSection?: string }) {
  return <CoworkRoot autoOpenSettingsSection={autoOpenSettingsSection} />;
}
