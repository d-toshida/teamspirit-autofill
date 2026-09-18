import { defineBackground } from '#imports';
import { browser } from 'wxt/browser';
import { onMessage } from '../lib/messaging.js';

// background.ts - 全フレームへの候補クリック指示
export default defineBackground(() => {
  onMessage('clickChoiceByText', async ({ data, sender }) => {
    const tabId = sender.tab?.id;
    if (!tabId) {
      throw new Error('タブが特定できません');
    }
    const results = await browser.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: (text) => globalThis.__tsAutofill?.clickChoiceByText?.(text) === true,
      args: [data]
    });
    const ok = (results || []).some((entry) => entry && entry.result === true);
    return { ok };
  });
});
