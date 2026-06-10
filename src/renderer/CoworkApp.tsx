// Mounts the cowork React UI inside the Electron shell. The shell's
// renderer owns terms/install/onboarding gating; this component is
// rendered after those pass, in place of the old <Terminal /> page.
//
// Cowork's globals.css ships its own theme tokens (--surface-*, --primary-*,
// --frost-*, etc.). It's loaded here so cowork views render correctly
// regardless of the shell's own styles.
import './cowork/styles/globals.css';
import CoworkRoot from './cowork/App';

export default function CoworkApp() {
  return <CoworkRoot />;
}
