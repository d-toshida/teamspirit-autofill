// TeamSpirit のページ内（iframe を含む）で動く。渡された要素への1操作の実行。
// fill-config の名前は参照しない。
// 勤務表画面は /apex/TimeAttendance iframe。

import { TOAST_ID } from './dom.js';
import { comboboxInnerControl } from './locate.js';

export type ElementAction = 'click' | 'set';

type ToastElement = HTMLElement & { _timer?: ReturnType<typeof setTimeout> };

// 勤務パターン欄は combobox 本体ではなく内側の input/button をクリックする。
function innermostClickable(el: Element | null | undefined) {
  if (!el) return null;
  if (el.matches('[role="combobox"]')) return comboboxInnerControl(el);
  if (el.matches('a, button, [role="menuitem"], [role="option"], [role="button"]')) return el;
  const inner = el.querySelector('a, button, [role="menuitem"], [role="option"], [role="button"]');
  return inner || el;
}

export function activateClick(el: Element | null | undefined) {
  if (!el) return false;
  if (el.tagName === 'OPTION') {
    const select = el.closest('select');
    if (!select) return false;
    setNativeValue(select, (el as HTMLOptionElement).value);
    return true;
  }
  const target = innermostClickable(el) as HTMLElement;
  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  try {
    if (typeof target.focus === 'function') target.focus({ preventScroll: true });
  } catch (e) {
    try { target.focus(); } catch (ignored) { /* フォーカスできない要素は無視 */ }
  }
  const mouse = { bubbles: true, cancelable: true, composed: true, view: window, buttons: 1 };
  try {
    target.dispatchEvent(new PointerEvent('pointerdown', mouse));
  } catch (e) { /* PointerEvent が使えない環境は mousedown のみ */ }
  target.dispatchEvent(new MouseEvent('mousedown', mouse));
  try {
    target.dispatchEvent(new PointerEvent('pointerup', mouse));
  } catch (e) { /* 同上 */ }
  target.dispatchEvent(new MouseEvent('mouseup', mouse));
  target.click();
  return true;
}

export function setNativeValue(el: Element, value: unknown) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
    : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

// フォーカスイン → 入力 → blur で画面側の時刻整形を発火する。
// 欄からフォーカスが外れると `09:30` のように整形される。この整形の前に保存すると反映されない。
export function commitTextField(el: Element, value: unknown) {
  const field = el as HTMLInputElement;
  if (typeof field.scrollIntoView === 'function') {
    field.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  try {
    field.focus({ preventScroll: true });
  } catch (e) {
    try { field.focus(); } catch (ignored) { /* フォーカスできない入力は値設定だけ行う */ }
  }
  if (typeof field.select === 'function') {
    try { field.select(); } catch (e) { /* 全選択できない入力は上書きのみ */ }
  }
  const proto = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  setter.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  try {
    field.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertReplacementText',
      data: String(value)
    }));
  } catch (e) { /* InputEvent を送れない環境は input のみ */ }
  field.blur();
  field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

export function applyElementOperation(el: Element, action: ElementAction, value?: unknown) {
  try {
    if (action === 'set') {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') commitTextField(el, value);
      else setNativeValue(el, value);
    } else if (action === 'click') activateClick(el);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as { message?: string }).message };
  }
}

export function notify(msg: string) {
  let t = document.getElementById(TOAST_ID) as ToastElement | null;
  if (!t) {
    t = document.createElement('div') as ToastElement;
    t.id = TOAST_ID;
    t.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);'
      + 'background:#1f6feb;color:#fff;padding:10px 16px;border-radius:8px;z-index:2147483647;'
      + 'font:14px sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.3)';
    (document.body || document.documentElement).appendChild(t);
  }
  t.textContent = 'TeamSpirit自動入力: ' + msg;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.remove(), 3000);
}

