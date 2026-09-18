// 画面要素の特定。ロケータ型と findElement。

import {
  FIELD_ANCESTOR_LIMIT,
  MAX_LABEL_CHARS,
  MAX_OWN_TEXT_CHARS,
  MAX_OPTION_TEXT_CHARS,
  comparableText,
  cssEscape,
  isDisplayed,
  isDisplayedPageElement,
  isExtensionUi,
  normalizeSpace,
  ownVisibleText,
  queryAllDeep,
  shortText,
  type DeepQueryRoot,
  usableCaption,
  visibleElementText,
  visibleTextEquals
} from './dom.js';
import {
  cellAtVisualIndex,
  findColumnIndexByHeader,
  findRowByHeader,
  getTableContext,
  timesheetTable
} from './timesheet.js';

const CHOICE_VALUE_TEXT = /^\d{5,}|WPC-\d+/;
const LIST_SELECTOR = '[role="listbox"], [role="menu"], [role="grid"], ul, ol, [class*="autowhatever"], [class*="auto-suggest"], [class*="autosuggest"]';
const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, [role="button"], [role="tab"], [role="option"], [role="menuitem"], [role="combobox"]';
const HEADING_SELECTOR = 'h1, h2, h3, header, legend, .slds-modal__title, [class*="modal__title"], [class*="ModalTitle"]';
export const DIALOG_SELECTOR = '[role="dialog"], [role="alertdialog"], .slds-modal, .slds-modal__container, .uiModal, [class*="popup"], [class*="Popup"]';
const OVERLAY_SELECTOR = `${DIALOG_SELECTOR}, form`;


export type TableLocator = {
  columnHeader?: string;
  rowHeader?: string;
};

// ロケータと操作ステップの型の正。呼び出し側は import type。
export type StepLocator = {
  tag?: string;
  type?: string;
  placeholder?: string;
  text?: string;
  labelText?: string;
  role?: string;
  dialogTitle?: string;
  placeholderIndex?: number;
  dialogInputIndex?: number;
  table?: TableLocator;
};

function isNonNegativeIndex(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function looksLikeChoiceValue(text: unknown) {
  return CHOICE_VALUE_TEXT.test(normalizeSpace(text));
}

function locatorText(el: Element) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return '';
  if (el.matches('[role="combobox"]')) {
    return fieldNameNear(el, overlayRoot(el)) || ownVisibleText(el, MAX_OWN_TEXT_CHARS);
  }
  const maxChars = el.matches('li, [role="option"], [role="menuitem"]')
    ? MAX_OPTION_TEXT_CHARS
    : MAX_OWN_TEXT_CHARS;
  return ownVisibleText(el, maxChars);
}

export function isPageLevelNode(node: Node | null | undefined) {
  if (!node || node === document.body || node === document.documentElement) return true;
  const sheet = timesheetTable();
  return !!(sheet && node.contains(sheet));
}

function overlayHeadingText(heading: Element | null | undefined) {
  if (!heading) return '';
  const clone = heading.cloneNode(true) as Element;
  clone.querySelectorAll(INTERACTIVE_SELECTOR).forEach((node) => node.remove());
  return shortText(clone.textContent, MAX_LABEL_CHARS);
}

export function namedOverlayTitle(text: unknown) {
  const value = normalizeSpace(text);
  if (!value) return '';
  if (value.includes('工数実績サマリー')) return '工数実績サマリー';
  if (value.includes('勤務時間変更')) return '勤務時間変更';
  return '';
}

function descendantCount(el: Element) {
  return el.querySelectorAll('*').length;
}

function smallestElement(nodes: Element[]) {
  if (!nodes.length) return null;
  return nodes.slice().sort((a, b) => descendantCount(a) - descendantCount(b))[0];
}

function overlayRoot(el: Element | null | undefined) {
  if (!el) return null;
  const containing = [...document.querySelectorAll(DIALOG_SELECTOR)]
    .filter(isDisplayed)
    .filter((node) => node.contains(el) && !isPageLevelNode(node));
  const fromDialog = smallestElement(containing);
  if (fromDialog) return fromDialog;
  const form = el.closest('form');
  if (form && !isPageLevelNode(form)) return form;
  const headings = [...document.querySelectorAll(HEADING_SELECTOR)].filter(isDisplayed);
  for (const heading of headings) {
    const title = namedOverlayTitle(overlayHeadingText(heading) || heading.textContent);
    if (!title) continue;
    let root = heading.parentElement;
    for (let depth = 0; depth < 10 && root && !isPageLevelNode(root); depth++) {
      if (root.contains(el)) return root;
      root = root.parentElement;
    }
  }
  let node = el.parentElement;
  for (let depth = 0; depth < 12 && node && !isPageLevelNode(node); depth++) {
    const heading = node.querySelector(HEADING_SELECTOR);
    const title = namedOverlayTitle(
      overlayHeadingText(heading)
      || shortText([...node.children].slice(0, 4).map((child) => child.textContent).join(' '), 60)
    );
    if (title) return node;
    node = node.parentElement;
  }
  return null;
}

function alignedColumnHeader(el: Element, root: Element | null | undefined) {
  if (!root) return '';
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return '';
  const centerX = rect.left + rect.width / 2;
  const headers = [...root.querySelectorAll('[role="columnheader"], th')];
  if (!headers.length) {
    for (const node of root.querySelectorAll('div, span, label')) {
      if (!isDisplayed(node)) continue;
      if (node.querySelector('input, select, button, textarea, [role="combobox"]')) continue;
      if (node.querySelectorAll('*').length > 4) continue;
      const text = usableCaption(node.textContent, node);
      if (text && text.length <= 20) headers.push(node);
    }
  }
  let bestText = '';
  let bestGap = Infinity;
  for (const header of headers) {
    if (header.contains(el) || el.contains(header)) continue;
    const headerRect = header.getBoundingClientRect();
    if (headerRect.width === 0 || headerRect.bottom > rect.top + 8) continue;
    if (centerX < headerRect.left - 4 || centerX > headerRect.right + 4) continue;
    const gap = rect.top - headerRect.bottom;
    const text = usableCaption(header.textContent, header);
    if (!text || gap < 0 || gap >= bestGap || gap > 400) continue;
    bestText = text;
    bestGap = gap;
  }
  return bestText;
}

function fieldNameNear(el: Element, root: Element | null | undefined) {
  const labelled = labelledByText(el);
  if (labelled) return labelled;
  const aria = usableCaption(el.getAttribute('aria-label'), el);
  if (aria) return aria;
  const scope = root || el.parentElement;
  if (!scope) return '';
  const previous = previousSiblingLabel(el);
  if (previous) return previous;
  let node = el.parentElement;
  for (let depth = 0; depth < 4 && node && node !== document.body && (scope.contains(node) || node.contains(el)); depth++) {
    const fromChild = labelFromContainer(node);
    if (fromChild) return fromChild;
    node = node.parentElement;
  }
  return '';
}

function labelledByText(el: Element) {
  const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
  if (!ids.length) return '';
  const text = ids.map((id: string) => document.getElementById(id)?.textContent).join(' ');
  return usableCaption(text, el);
}

function previousSiblingLabel(el: Element) {
  let sibling = el.previousElementSibling;
  let hops = 0;
  while (sibling && hops < 3) {
    const skipInteractive = sibling.matches(INTERACTIVE_SELECTOR)
      || sibling.querySelector('button, input, select, textarea, [role="button"]');
    if (!skipInteractive) {
      const caption = usableCaption(sibling.textContent, sibling);
      if (caption) return caption;
    }
    sibling = sibling.previousElementSibling;
    hops++;
  }
  return '';
}

function sldsFormLabel(el: Element) {
  const block = el.closest('.slds-form-element, [class*="form-element"], [class*="FormElement"]');
  if (!block) return '';
  const label = block.querySelector('.slds-form-element__label, legend, :scope > label');
  if (!label || label.contains(el)) return '';
  return usableCaption(label.textContent, label);
}

function labelFromContainer(node: Element) {
  const explicit = node.querySelector(':scope > label, :scope > legend, :scope > dt, :scope > .label, :scope > .slds-form-element__label');
  const explicitText = usableCaption(explicit && explicit.textContent, explicit || node);
  if (explicitText) return explicitText;

  const first = node.firstElementChild;
  if (
    first
    && !first.matches('input, select, textarea, button, a, [role="button"]')
    && !first.querySelector('input, select, textarea, button, [role="button"]')
    && node.querySelector('input, select, textarea, button, [role="button"]')
  ) {
    return usableCaption(first.textContent, first);
  }
  return '';
}

function fieldLabelFromAncestors(el: Element) {
  let node = el.parentElement;
  for (let depth = 0; depth < FIELD_ANCESTOR_LIMIT && node && node !== document.body; depth++) {
    const fromChild = labelFromContainer(node);
    if (fromChild) return fromChild;
    node = node.parentElement;
  }
  return '';
}

function findLabelText(el: Element) {
  const overlay = overlayRoot(el);
  const table = getTableContext(el);
  const ownText = locatorText(el);
  const isButton = el.matches('button, [role="button"]');
  const isChoice = el.matches('[role="option"], [role="menuitem"], li');

  if (isButton && ownText) {
    if (table && table.columnHeader) return table.columnHeader;
    return findDialogTitle(el);
  }

  const captions: string[] = [];
  const pushCaption = (text: unknown, node?: Element | null) => {
    const caption = usableCaption(text, node || el);
    if (caption && !captions.includes(caption)) captions.push(caption);
  };
  try {
    pushCaption(labelledByText(el), el);
    pushCaption(el.getAttribute('aria-label'), el);
    if (el.id) {
      const forLabel = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      pushCaption(forLabel && forLabel.textContent, forLabel || el);
    }
    const wrap = el.closest('label');
    if (wrap) {
      const clone = wrap.cloneNode(true) as Element;
      clone.querySelectorAll('input, select, textarea, button').forEach((control) => control.remove());
      pushCaption(clone.textContent, wrap);
    }
    if (table) pushCaption(table.columnHeader, el);
    if (overlay) {
      pushCaption(alignedColumnHeader(el, overlay), el);
      pushCaption(fieldNameNear(el, overlay), el);
      pushCaption(sldsFormLabel(el), el);
    } else if (!table) {
      pushCaption(sldsFormLabel(el), el);
      if (ownText && !isChoice) pushCaption(ownText, el);
      pushCaption(fieldLabelFromAncestors(el), el);
      if (!isChoice) pushCaption(previousSiblingLabel(el), el);
    }
    if (isChoice) pushCaption(fieldNameNear(el, overlay), el);
    if (el.matches('[role="combobox"]') && ownText) pushCaption(ownText, el);
  } catch (e) { /* 無視 */ }
  const fieldCaptions = captions.filter((caption) => !looksLikeChoiceValue(caption));
  if (el.matches('input, select, textarea') && fieldCaptions.length) return fieldCaptions[0];
  return captions[0] || '';
}

export function headingTextFromRoot(root: Element | null | undefined, excludeEl: Element | null | undefined) {
  if (!root || isPageLevelNode(root)) return '';
  const heading = root.querySelector(HEADING_SELECTOR);
  if (!heading || (excludeEl && heading.contains(excludeEl))) return '';
  return overlayHeadingText(heading) || namedOverlayTitle(heading.textContent);
}

function findDialogTitle(el: Element) {
  const root = overlayRoot(el);
  if (root) {
    const fromHeading = headingTextFromRoot(root, el);
    if (fromHeading) return fromHeading;
    const named = namedOverlayTitle(root.textContent);
    if (named) return named;
  }
  return '';
}

function findControlInCell(cell: Element, loc: StepLocator) {
  if (loc.tag === 'td' || loc.tag === 'th') return cell;
  const tagged = [...cell.querySelectorAll(loc.tag || '*')].filter((node) => !isExtensionUi(node));
  if (loc.text) {
    const byText = tagged.find((node) => visibleTextEquals(node, loc.text));
    if (byText) return byText;
  }
  if (loc.type) {
    const byType = tagged.find((node) => (node.getAttribute('type') || '') === loc.type);
    if (byType) return byType;
  }
  if (tagged.length === 1) return tagged[0];
  return [...cell.querySelectorAll('input, select, textarea, button, a')]
    .find((node) => !isExtensionUi(node)) || cell;
}

function findInTable(loc: StepLocator) {
  const columnHeader = loc.table?.columnHeader;
  if (!columnHeader) return null;
  for (const table of document.querySelectorAll('table')) {
    const columnIndex = findColumnIndexByHeader(table, columnHeader);
    if (columnIndex < 0) continue;
    const row = findRowByHeader(table, loc.table?.rowHeader);
    if (!row) continue;
    const cell = cellAtVisualIndex(row, columnIndex);
    if (!cell) continue;
    return findControlInCell(cell, loc);
  }
  return null;
}

function nodesMatchingDialog(nodes: Element[], dialogTitle: string | undefined) {
  if (!dialogTitle) return nodes;
  const inDialog = nodes.filter((node) => findDialogTitle(node) === dialogTitle);
  return inDialog.length ? inDialog : nodes;
}

function overlayNodes() {
  return [...document.querySelectorAll(OVERLAY_SELECTOR)].filter((node) => !isPageLevelNode(node));
}

export function overlayRoots() {
  return overlayNodes().filter(isDisplayed);
}

function overlayMatchesTitle(node: Element, title: string) {
  return headingTextFromRoot(node, null) === title
    || namedOverlayTitle(node.textContent) === title;
}

function dialogRootsNamed(title: string | undefined | null) {
  if (!title) return [];
  return overlayRoots().filter((node) => overlayMatchesTitle(node, title));
}

export function findNamedDialog(title: string | undefined | null) {
  return smallestElement(dialogRootsNamed(title));
}

export function findByVisibleText(
  selector: string,
  text: string | undefined,
  dialogTitle?: string
) {
  if (!text) return null;
  const nodes = queryAllDeep(selector).filter((node) => !isExtensionUi(node));
  const exact = nodes.filter((node) => visibleTextEquals(node, text));
  const scoped = nodesMatchingDialog(exact, dialogTitle);
  const visibleScoped = scoped.filter(isDisplayed);
  if (visibleScoped.length === 1) return visibleScoped[0];
  if (visibleScoped.length > 1) {
    const inList = visibleScoped.filter((node) => node.closest(LIST_SELECTOR + ', [role="dialog"]'));
    return smallestElement(inList.length ? inList : visibleScoped);
  }
  return null;
}

function queryDisplayed(root: DeepQueryRoot | null | undefined, selector: string) {
  if (!root) return null;
  const inLight = [...root.querySelectorAll(selector)].find(isDisplayedPageElement);
  if (inLight) return inLight;
  const shadows = [];
  if (root.shadowRoot) shadows.push(root.shadowRoot);
  for (const child of root.querySelectorAll('*')) {
    if (child.shadowRoot) shadows.push(child.shadowRoot);
  }
  for (const shadow of shadows) {
    const found = [...shadow.querySelectorAll(selector)].find((node) => isDisplayed(node));
    if (found) return found;
  }
  return null;
}

function comboboxRoot(el: Element | null | undefined) {
  if (!el) return null;
  if (el.matches('[role="combobox"]')) return el;
  return el.closest('[role="combobox"]');
}

export function comboboxInnerControl(el: Element | null | undefined) {
  const combo = comboboxRoot(el) || el;
  if (!combo) return el;
  if (combo.matches('input, button, select, textarea')) return combo;
  return queryDisplayed(combo, 'input:not([type="hidden"]), button, [role="button"]') || combo;
}

// 勤務パターン combobox の textContent は空に見える。選択中は配下 input の value。
export function comboboxValue(el: Element | null | undefined) {
  const combo = comboboxRoot(el);
  if (!combo) return '';
  const input = combo.matches('input') ? combo : queryDisplayed(combo, 'input:not([type="hidden"])');
  const inputValue = (input as HTMLInputElement | null)?.value;
  if (input && normalizeSpace(inputValue)) return normalizeSpace(inputValue);
  const aria = normalizeSpace(combo.getAttribute('aria-label') || '');
  if (aria) return aria;
  const title = normalizeSpace(combo.getAttribute('title') || (input && input.getAttribute('title')) || '');
  if (title) return title;
  return normalizeSpace(visibleElementText(combo));
}

// 勤務パターンの input は aria-expanded を持たない。開閉は listbox / role=option の出現で見る。
export function isComboboxOpen(el: Element | null | undefined) {
  const combo = comboboxRoot(el);
  if (!combo) return false;
  if (combo.getAttribute('aria-expanded') === 'true') return true;
  if (combo.querySelector('[aria-expanded="true"]')) return true;
  const control = comboboxInnerControl(combo);
  if (control && control.getAttribute('aria-expanded') === 'true') return true;
  const controls = [
    combo.getAttribute('aria-controls') || '',
    control && control.getAttribute('aria-controls') || ''
  ].join(' ').trim();
  if (controls) {
    for (const id of controls.split(/\s+/)) {
      const list = document.getElementById(id);
      if (isDisplayedPageElement(list)) return true;
    }
  }
  return false;
}

function findByLabel(loc: StepLocator) {
  if (!loc.labelText || !loc.tag) return null;
  let tagged = [...document.querySelectorAll(loc.tag)].filter((node) => findLabelText(node) === loc.labelText);
  tagged = nodesMatchingDialog(tagged, loc.dialogTitle);
  if (loc.placeholder) {
    const withPlaceholder = tagged.filter((node) => (node.getAttribute('placeholder') || '') === loc.placeholder);
    if (withPlaceholder.length === 1) return withPlaceholder[0];
    if (withPlaceholder.length > 1 && isNonNegativeIndex(loc.placeholderIndex)) {
      return withPlaceholder[loc.placeholderIndex] || null;
    }
  }
  if (tagged.length === 1) return tagged[0];
  if (tagged.length > 1 && isNonNegativeIndex(loc.dialogInputIndex)) {
    return tagged[loc.dialogInputIndex] || null;
  }
  return null;
}

function findByPlaceholderIndex(loc: StepLocator) {
  if (!loc.placeholder || !isNonNegativeIndex(loc.placeholderIndex)) return null;
  const overlays = loc.dialogTitle ? overlayNodes() : [];
  const root = overlays.find((node) => headingTextFromRoot(node, null) === loc.dialogTitle)
    || overlays.find((node) => namedOverlayTitle(node.textContent) === loc.dialogTitle)
    || null;
  const scope = root || document;
  const similar = [...scope.querySelectorAll(loc.tag || 'input')].filter((node) =>
    (node.getAttribute('placeholder') || '') === loc.placeholder
    && (node.getAttribute('type') || '') === (loc.type || '')
  );
  return similar[loc.placeholderIndex] || null;
}

export function findElement(loc: StepLocator | null | undefined) {
  if (!loc) return null;

  const inTable = findInTable(loc);
  if (inTable) return inTable;

  const byLabel = findByLabel(loc);
  if (byLabel) return byLabel;

  const textSelector = loc.role
    ? `${loc.tag}[role="${cssEscape(loc.role)}"], [role="${cssEscape(loc.role)}"]`
    : loc.tag as string;
  if (loc.text) {
    const byText = findByVisibleText(textSelector, loc.text, loc.dialogTitle);
    if (byText) return byText;
    const byOptionText = findByVisibleText(
      'li, [role="option"], [role="menuitem"], option',
      loc.text,
      loc.dialogTitle
    );
    if (byOptionText) return byOptionText;
  }

  const byPlaceholder = findByPlaceholderIndex(loc);
  if (byPlaceholder) return byPlaceholder;

  return null;
}

