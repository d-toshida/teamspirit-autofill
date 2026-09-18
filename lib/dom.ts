// ページ DOM の共通操作。探索・勤務表・実行がここを使う。

export const TOAST_ID = 'ts-toast';
export const MAX_LABEL_CHARS = 40;
export const MAX_OWN_TEXT_CHARS = 60;
export const MAX_OPTION_TEXT_CHARS = 240;
export const FIELD_ANCESTOR_LIMIT = 8;

export type DeepQueryRoot = ParentNode & { shadowRoot?: ShadowRoot | null };

export function cssEscape(s: string) {
  return (window.CSS && CSS.escape) ? CSS.escape(s) : s;
}

export function normalizeSpace(value: unknown) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function comparableText(value: unknown) {
  return normalizeSpace(value).normalize('NFKC');
}

export function shortText(value: unknown, maxChars: number) {
  const text = normalizeSpace(value);
  if (!text) return '';
  return text.slice(0, maxChars);
}

function compactText(value: unknown) {
  return normalizeSpace(value).replace(/\s+/g, '');
}

export function isDisplayed(el: Element | null | undefined): boolean {
  if (!el || typeof el.getBoundingClientRect !== 'function') return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  if (el.tagName === 'OPTION') {
    const select = el.closest('select');
    return !!(select && isDisplayed(select));
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function queryAllDeep(selector: string, root: DeepQueryRoot = document) {
  const results: Element[] = [];
  const visit = (node: DeepQueryRoot | null | undefined) => {
    if (!node || !node.querySelectorAll) return;
    results.push(...node.querySelectorAll(selector));
    for (const el of node.querySelectorAll('*')) {
      if (el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(root);
  if (root.shadowRoot) visit(root.shadowRoot);
  return results;
}

function joinedChildTexts(node: Element) {
  return [...node.children]
    .map((child) => normalizeSpace(child.textContent))
    .filter(Boolean);
}

function joinedControlTexts(node: Element) {
  return [...node.querySelectorAll('button, a[href], [role="button"], [role="tab"]')]
    .map((control) => normalizeSpace(control.textContent))
    .filter(Boolean);
}

function isConcatenatedCaption(text: unknown, node: Element) {
  const compact = compactText(text);
  if (!compact || compact.length < 4) return false;
  let current: Element | null = node;
  for (let depth = 0; depth < FIELD_ANCESTOR_LIMIT && current && current !== document.body; depth++) {
    const childJoined = compactText(joinedChildTexts(current).join(''));
    if (current.children.length >= 2 && childJoined && (childJoined === compact || childJoined.startsWith(compact))) {
      const firstChildText = compactText(current.children[0]!.textContent);
      if (firstChildText !== compact) return true;
    }
    const controlTexts = joinedControlTexts(current);
    if (controlTexts.length >= 2) {
      const controlJoined = compactText(controlTexts.join(''));
      if (controlJoined === compact || (compact.length >= 6 && controlJoined.startsWith(compact))) return true;
    }
    current = current.parentElement;
  }
  return false;
}

export function usableCaption(text: unknown, node: Element | null | undefined) {
  const caption = shortText(text, MAX_LABEL_CHARS);
  if (!caption) return '';
  if (node && isConcatenatedCaption(caption, node)) return '';
  return caption;
}

export function ownVisibleText(el: Element | null | undefined, maxChars = MAX_OWN_TEXT_CHARS) {
  if (!el || el.nodeType !== 1) return '';
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return '';
  if (el.matches('li, button, a, [role="option"], [role="menuitem"]')) {
    return shortText(el.textContent, maxChars);
  }
  const descendantCount = el.querySelectorAll('*').length;
  if (descendantCount > 8 && (tag === 'div' || tag === 'td' || tag === 'span')) {
    let raw = '';
    for (const child of el.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) raw += child.textContent;
    }
    const fromOwnNodes = shortText(raw, maxChars);
    if (fromOwnNodes) return fromOwnNodes;
  }
  return shortText(el.textContent, maxChars);
}

export function visibleElementText(el: Element, maxChars = MAX_OPTION_TEXT_CHARS) {
  if (el.tagName === 'OPTION') {
    const option = el as HTMLOptionElement;
    return option.text || option.value || '';
  }
  return ownVisibleText(el, maxChars) || String(el.textContent || '');
}

export function visibleTextEquals(el: Element, wanted: unknown, maxChars = MAX_OPTION_TEXT_CHARS) {
  const wantedCmp = comparableText(wanted);
  if (!wantedCmp) return false;
  if (el.tagName === 'OPTION') return comparableText(visibleElementText(el, maxChars)) === wantedCmp;
  return comparableText(ownVisibleText(el, maxChars)) === wantedCmp
    || comparableText(el.textContent) === wantedCmp;
}

export function isExtensionUi(el: Element | null | undefined) {
  return !!(el && el.closest && el.closest(`#${TOAST_ID}, [data-ts-autofill]`));
}

export function isDisplayedPageElement(el: Element | null | undefined): el is Element {
  return !!el && isDisplayed(el) && !isExtensionUi(el);
}
