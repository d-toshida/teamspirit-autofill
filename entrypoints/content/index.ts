import { defineContentScript } from '#imports';
import { TEAMSPIRIT_HOST_MATCHES } from '../../lib/hosts.js';
import { start as startFillUi } from '../../lib/fill-ui.js';
import './autofill.css';

export default defineContentScript({
  matches: TEAMSPIRIT_HOST_MATCHES,
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',
  cssInjectionMode: 'manifest',
  main() {
    startFillUi();
  }
});
