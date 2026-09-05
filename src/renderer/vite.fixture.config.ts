// Fixture-only Vite config: the base renderer config plus a keycloak-js
// alias to a no-op stub, so visual fixtures (e.g. datavault-fixture.html)
// mount without the app's onLoad:'login-required' auth redirect firing at
// import time. Used only for local screenshot runs — never for a shipped build.
import path from 'path';
import base from './vite.config';

const cfg = base as any;
cfg.resolve = cfg.resolve || {};
cfg.resolve.alias = {
  ...(cfg.resolve.alias || {}),
  'keycloak-js': path.resolve(__dirname, 'visual-fixtures/_keycloak-stub.ts'),
};
export default cfg;
