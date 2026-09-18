import { defineContentScript } from '#imports';
import { start as startFillUi } from '../../lib/fill-ui.js';
import './autofill.css';

export default defineContentScript({
  matches: [
    'https://*.teamspirit.co.jp/*',
    'https://*.teamspirit.com/*',
    'https://*.force.com/*',
    'https://*.lightning.force.com/*',
    'https://*.visual.force.com/*',
    'https://*.visualforce.com/*',
    'https://*.salesforce.com/*',
    'https://*.my.salesforce.com/*',
    'https://*.my.site.com/*',
    'https://*.cloudforce.com/*'
  ],
  allFrames: true,
  matchAboutBlank: true,
  runAt: 'document_idle',
  cssInjectionMode: 'manifest',
  main() {
    startFillUi();
  }
});
