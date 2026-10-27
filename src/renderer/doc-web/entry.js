// Build entry for the shared-page editor: styles first, so they extract to
// doc-editor.css (loaded at runtime, owner only), then the boot. main.jsx only
// defines boot(), so its tests import it without it running.
import './doc-web.css';
import { boot } from './main.jsx';

boot();
