// Popup と設定画面のフッターに出す版表示。
// 版番号は実行時の manifest から取る。package.json の version を上げてビルドすると表示も変わる。

import { browser } from 'wxt/browser';

const VERSION_DISPLAY_PREFIX = 'v';

export function extensionVersionLabel() {
  return `${VERSION_DISPLAY_PREFIX}${browser.runtime.getManifest().version}`;
}
