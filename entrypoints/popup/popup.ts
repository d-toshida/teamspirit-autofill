// popup.ts - 拡張機能のアイコンを押したときの画面（ポップアップ）の動作

import { browser } from 'wxt/browser';

const statusEl = document.getElementById('status') as HTMLElement;

function setStatus(text: string) {
  statusEl.textContent = text;
}

function isTsPage(url: string | undefined) {
  return /teamspirit|force\.com|salesforce\.com|visualforce\.com|my\.site\.com|cloudforce\.com/.test(url || '');
}

async function getCurrentTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

document.getElementById('openOptions')!.addEventListener('click', (e) => {
  e.preventDefault();
  browser.runtime.openOptionsPage();
});

(async () => {
  const tab = await getCurrentTab();
  if (!tab || !isTsPage(tab.url)) {
    setStatus('TeamSpirit の勤務表画面を開いてください');
    return;
  }
  setStatus('勤務表の各行、申請ボタンの左の「入力」から1日分を自動入力できます');
})();
