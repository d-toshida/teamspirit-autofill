// TeamSpirit のページ内（iframe を含む）で動く。渡された要素への1操作の実行。
// fill-config の名前は参照しない。
// 勤務表画面は /apex/TimeAttendance iframe。

import { TOAST_ID } from './dom.js';
import { comboboxInnerControl } from './locate.js';

export type ElementAction = 'click' | 'set';

type ToastElement = HTMLElement & { _timer?: ReturnType<typeof setTimeout> };

const BUBBLING_EVENT = { bubbles: true, composed: true };

// 勤務パターン欄は combobox 本体ではなく内側の input/button をクリックする。
function innermostClickable(el: Element | null | undefined) {
  if (!el) return null;
  if (el.matches('[role="combobox"]')) return comboboxInnerControl(el);
  if (el.matches('a, button, [role="menuitem"], [role="option"], [role="button"]')) return el;
  const inner = el.querySelector('a, button, [role="menuitem"], [role="option"], [role="button"]');
  return inner || el;
}

function scrollAndFocus(el: HTMLElement) {
  el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  try {
    el.focus({ preventScroll: true });
  } catch (e) {
    try { el.focus(); } catch (ignored) { /* フォーカスできない要素は無視 */ }
  }
}

function assignNativeValue(el: Element, value: unknown) {
  const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype
    : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
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
  scrollAndFocus(target);
  const mouse = { bubbles: true, cancelable: true, composed: true, view: window, buttons: 1 };
  try {
    target.dispatchEvent(new PointerEvent('pointerdown', mouse));
  } catch (e) { /* PointerEvent が使えない環境は mousedown のみ */ }
  target.dispatchEvent(new MouseEvent('mousedown', mouse));
  try {
    target.dispatchEvent(new PointerEvent('pointerup', mouse));
  } catch (e) { /* 同上 */ }
  target.dispatchEvent(new MouseEvent('mouseup', mouse));
  // HTMLElement.click が無い要素は click イベントを送る。
  if (typeof target.click === 'function') target.click();
  else target.dispatchEvent(new MouseEvent('click', mouse));
  return true;
}

export function setNativeValue(el: Element, value: unknown) {
  assignNativeValue(el, value);
  el.dispatchEvent(new Event('input', BUBBLING_EVENT));
  el.dispatchEvent(new Event('change', BUBBLING_EVENT));
}

// フォーカスイン → 入力 → blur で画面側の時刻整形を発火する。
// 欄からフォーカスが外れると `09:30` のように整形される。この整形の前に保存すると反映されない。
export function commitTextField(el: Element, value: unknown) {
  const field = el as HTMLInputElement;
  scrollAndFocus(field);
  if (typeof field.select === 'function') {
    try { field.select(); } catch (e) { /* 全選択できない入力は上書きのみ */ }
  }
  assignNativeValue(field, value);
  field.dispatchEvent(new Event('input', BUBBLING_EVENT));
  try {
    field.dispatchEvent(new InputEvent('input', {
      ...BUBBLING_EVENT,
      inputType: 'insertReplacementText',
      data: String(value)
    }));
  } catch (e) { /* InputEvent を送れない環境は input のみ */ }
  field.blur();
  field.dispatchEvent(new Event('change', BUBBLING_EVENT));
}

export function applyElementOperation(el: Element, action: ElementAction, value?: unknown) {
  try {
    if (action === 'set') {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') commitTextField(el, value);
      else setNativeValue(el, value);
    } else if (action === 'click') activateClick(el);
    return true;
  } catch (e) {
    return false;
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

