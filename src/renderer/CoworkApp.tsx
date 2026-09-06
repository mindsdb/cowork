// Mount the workspace after renderer onboarding gates. Import its token stylesheet here so views
// receive their theme independently of shell styles.
import './cowork/styles/globals.css';
import CoworkRoot from './cowork/App';

export default function CoworkApp() {
  return <CoworkRoot />;
}
