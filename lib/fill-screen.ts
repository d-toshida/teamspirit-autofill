// 勤務表画面に対する、勤務パターン・勤務場所・工数ダイアログ・候補クリックなどの操作。
// 実行セッションは持たない。失敗観察は呼び出し側の lastProbe に書く。

import { loadWaitSettings } from './fill-config.js';
import { sendMessage } from './messaging.js';
import {
  MAX_OPTION_TEXT_CHARS,
  comparableText,
  isDisplayed,
  isDisplayedPageElement,
  isExtensionUi,
  normalizeSpace,
  ownVisibleText,
  queryAllDeep,
  visibleElementText,
  visibleTextEquals
} from './dom.js';
import {
  cellAtVisualIndex,
  findColumnIndexByHeader,
  findRowByHeader,
  timesheetTable
} from './timesheet.js';
import {
  DIALOG_SELECTOR,
  comboboxInnerControl,
  comboboxValue,
  findByVisibleText,
  findElement,
  findNamedDialog,
  isComboboxOpen,
  isPageLevelNode,
  namedOverlayTitle,
  overlayRoots,
  type StepLocator
} from './locate.js';
import {
  activateClick,
  applyElementOperation,
  commitTextField,
  setNativeValue,
  type ElementAction
} from './execute-step.js';

export type FillProbe = {
  lastProbe: string;
};

export type ExistingRowValue = {
  header: string;
  text: string;
};

export const CHOICE_SELECTOR = 'li, a, button, [role="menuitem"], [role="option"], [role="menuitemradio"]';
export const OPEN_MENU_SELECTOR = '[role="menu"], [role="listbox"], .slds-dropdown, [class*="dropdown"], [class*="menu"]';
export const WORK_HOUR_EXTENDED_ITEM_SELECTOR = '.task__extended__item-list__item';

const DISPLAYED_SELECT_SUMMARY_MAX = 4;
const FAVORITE_SEARCH_RESULT_ROW_SELECTOR = '[data-testid^="favorite-search-result-row-"]';
const FAVORITE_SEARCH_RESULT_LABEL_SELECTOR = '.favorite-search-result-table-row-hierarchyOption-label';
const WORK_HOUR_JOB_ROW_SELECTOR = '[data-rbd-draggable-id]';
const WORK_HOUR_LOOKUP_ITEM_SELECTOR = `${WORK_HOUR_EXTENDED_ITEM_SELECTOR}.task-hierarchy`;
const TIMESHEET_LOADING_OVERLAY_SELECTOR = [
  'lightning-spinner',
  '.slds-spinner_container',
  '[class*="common-spinner"]'
].join(', ');
const WORK_HOUR_PICKLIST_SELECT_SELECTOR = '.task-picklist select.slds-select.ts-select';
const WORK_TIME_CHANGE_FORM_ROW_SELECTOR = '.timesheet-pc-dialogs-daily-att-request-dialog-form-row';
const WORK_TIME_CHANGE_FORM_ROW_LABEL_SELECTOR = '.timesheet-pc-dialogs-daily-att-request-dialog-form-row__label';
const WORK_TIME_CHANGE_APPLY_BUTTON_SELECTOR = '.timesheet-pc-dialogs-daily-att-request-dialog-form-frame__button';

export function waitMs(durationMs: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

export async function waitUntilReady(
  isReady: () => boolean,
  intervalMs: number,
  timeoutMs: number,
  isCancelled?: () => boolean
) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (isCancelled?.()) return 'cancelled';
    if (isReady()) return 'ok';
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return 'timeout';
    await waitMs(Math.min(intervalMs, remainingMs));
  }
}

function isTimesheetLoadingOverlayDisplayed() {
  return queryAllDeep(TIMESHEET_LOADING_OVERLAY_SELECTOR).some(isDisplayedPageElement);
}

function timesheetReturnState() {
  const table = timesheetTable();
  return {
    timesheet: !!(table && isDisplayed(table)),
    workTimeChange: !!workTimeChangeDialog(),
    workHourSummary: !!findNamedDialog('工数実績サマリー'),
    timeInput: !!displayedAttendanceCaption()
  };
}

function isTimesheetReturnedAfterLoad() {
  const state = timesheetReturnState();
  return state.timesheet && !state.workTimeChange && !state.workHourSummary && !state.timeInput;
}

export function describeTimesheetReturnWait() {
  const state = timesheetReturnState();
  return [
    `loadingOverlay=${isTimesheetLoadingOverlayDisplayed()}`,
    `timesheet=${state.timesheet}`,
    `workTimeChange=${state.workTimeChange}`,
    `workHourSummary=${state.workHourSummary}`,
    `timeInput=${state.timeInput}`
  ].join(' ');
}

export async function waitUntilReturnedToTimesheet(
  intervalMs: number,
  timeoutMs: number,
  requireOverlayAppear: boolean,
  isCancelled?: () => boolean
) {
  const deadline = Date.now() + timeoutMs;
  const remainingMs = () => Math.max(0, deadline - Date.now());
  if (requireOverlayAppear) {
    const appeared = await waitUntilReady(
      isTimesheetLoadingOverlayDisplayed,
      intervalMs,
      remainingMs(),
      isCancelled
    );
    if (appeared !== 'ok') return appeared;
  }
  return waitUntilReady(
    () => !isTimesheetLoadingOverlayDisplayed() && isTimesheetReturnedAfterLoad(),
    intervalMs,
    remainingMs(),
    isCancelled
  );
}

function runLocatedOperation(action: ElementAction, loc: StepLocator, value?: unknown) {
  const found = findElement(loc);
  if (!found) return { ok: false, found: null };
  return { ok: applyElementOperation(found, action, value).ok, found };
}

export function runOperation(action: ElementAction, loc: StepLocator, value?: unknown) {
  return runLocatedOperation(action, loc, value).ok;
}

export function clickByText(selector: string, text: string, dialogTitle?: string) {
  return activateClick(findByVisibleText(selector, text, dialogTitle));
}

export function isInsideOpenChoiceList(el: Element | null | undefined) {
  let node = el;
  while (node && node.nodeType === 1) {
    if (node.matches && node.matches(OPEN_MENU_SELECTOR) && isDisplayedPageElement(node)) {
      const choices = queryAllDeep(CHOICE_SELECTOR, node).filter(isDisplayedPageElement);
      if (choices.length >= 2) return true;
    }
    const root = node.getRootNode && node.getRootNode();
    node = node.parentElement || (root && (root as ShadowRoot).host) || null;
  }
  return false;
}

// 行セルに出ている同じ文言の trigger は候補にしない。
export function isTimesheetValueTrigger(el: Element) {
  const role = el.getAttribute('role') || '';
  if (role === 'option' || role === 'menuitem' || role === 'menuitemradio') return false;
  if (el.tagName === 'OPTION') return false;
  if (isInsideOpenChoiceList(el)) return false;
  const cell = el.closest('td, th');
  if (!cell) return false;
  const table = cell.closest('table');
  return !!(table && table === timesheetTable());
}

function choiceIsShown(el: Element) {
  if (isDisplayed(el)) return true;
  if (el.getAttribute('aria-hidden') !== 'true') return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && isInsideOpenChoiceList(el);
}

function findChoiceByText(text: string, rootDocument?: Document | null) {
  const doc = rootDocument || document;
  if (!doc || !doc.querySelectorAll) return null;
  const matchesWanted = (el: Element) => {
    if (isExtensionUi(el)) return false;
    if (isTimesheetValueTrigger(el)) return false;
    return visibleTextEquals(el, text);
  };
  const rank = (el: Element) => {
    const role = el.getAttribute('role') || '';
    if (role === 'menuitem' || role === 'option') return 0;
    if (el.tagName === 'OPTION') return 1;
    if (el.tagName === 'A' || el.tagName === 'BUTTON') return 2;
    if (el.tagName === 'LI') return 3;
    return 4;
  };
  const pickVisible = (nodes: Element[]) => {
    const visible = nodes.filter((el) => choiceIsShown(el) && matchesWanted(el));
    if (!visible.length) return null;
    const inOpenList = visible.filter((el) => isInsideOpenChoiceList(el) || el.tagName === 'OPTION');
    const pool = inOpenList.length ? inOpenList : visible;
    return pool.slice().sort((a, b) =>
      rank(a) - rank(b) || a.querySelectorAll('*').length - b.querySelectorAll('*').length
    )[0] || null;
  };
  const inOpenMenus = queryAllDeep(OPEN_MENU_SELECTOR, doc)
    .filter(isDisplayedPageElement)
    .flatMap((menu) => queryAllDeep(CHOICE_SELECTOR + ', span', menu));
  return pickVisible(inOpenMenus)
    || pickVisible(queryAllDeep(CHOICE_SELECTOR, doc));
}

export function clickChoiceByText(text: string, rootDocument?: Document | null) {
  return activateClick(findChoiceByText(text, rootDocument));
}

function summarizeChoiceMiss(text: string) {
  const wanted = comparableText(text);
  const nodes = queryAllDeep(CHOICE_SELECTOR + ', span, option');
  const rows = [];
  let matched = 0;
  let shown = 0;
  let skippedTrigger = 0;
  let inOpenList = 0;
  for (const el of nodes) {
    if (isExtensionUi(el)) continue;
    if (comparableText(visibleElementText(el)) !== wanted) continue;
    matched += 1;
    const isShown = choiceIsShown(el);
    const trigger = isTimesheetValueTrigger(el);
    const openList = isInsideOpenChoiceList(el);
    if (isShown) shown += 1;
    if (trigger) skippedTrigger += 1;
    if (openList) inOpenList += 1;
    if (rows.length < 8) {
      rows.push(
        `  ${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : ''} displayed=${isDisplayed(el)} trigger=${trigger} openList=${openList} ${normalizeSpace(visibleElementText(el)).slice(0, 40)}`
      );
    }
  }
  return [
    `text一致${matched} / 表示${shown} / trigger除外${skippedTrigger} / openList${inOpenList}`,
    ...rows
  ].join('\n');
}

function selectSelectedOptionText(select: HTMLSelectElement) {
  const selected = select.options[select.selectedIndex];
  return normalizeSpace(selected ? selected.text : '');
}

export function displayedSelectSummaries() {
  return [...document.querySelectorAll('select')]
    .filter(isDisplayedPageElement)
    .slice(0, DISPLAYED_SELECT_SUMMARY_MAX)
    .map((el) => `${selectSelectedOptionText(el) || '(空)'} / ${el.options.length}件`);
}

export function describeFailureProbe(targetText?: string) {
  const lines = [];
  const focused = document.activeElement;
  if (focused && focused !== document.body && focused !== document.documentElement) {
    lines.push(
      `focusAttrs: expanded=${focused.getAttribute('aria-expanded') || 'なし'} haspopup=${focused.getAttribute('aria-haspopup') || 'なし'} controls=${(focused.getAttribute('aria-controls') || 'なし').slice(0, 60)}`
    );
  }
  const optionNodes = queryAllDeep('[role="option"]');
  const visibleOptions = optionNodes.filter(isDisplayedPageElement);
  lines.push(`role=option: 表示${visibleOptions.length} / 全体${optionNodes.length}`);
  for (const el of optionNodes.slice(0, 8)) {
    const text = normalizeSpace(visibleElementText(el)).slice(0, 40);
    lines.push(
      `  ${el.tagName.toLowerCase()} displayed=${isDisplayed(el)} openList=${isInsideOpenChoiceList(el)} ${text}`
    );
  }
  const selectSummaries = displayedSelectSummaries();
  lines.push(`select: ${selectSummaries.join(' / ') || 'なし'}`);
  if (targetText) lines.push(summarizeChoiceMiss(targetText));
  return lines.join('\n');
}

function otherSameOriginDocuments() {
  const docs: Document[] = [];
  const add = (win: Window | null) => {
    try {
      if (win && win !== window && win.document && win.document !== document) {
        docs.push(win.document);
      }
    } catch (e) { /* クロスオリジン */ }
  };
  add(window.parent);
  add(window.top);
  return docs;
}

export function choiceIsDisplayed(text: string) {
  if (findChoiceByText(text)) return true;
  for (const doc of otherSameOriginDocuments()) {
    if (findChoiceByText(text, doc)) return true;
  }
  return false;
}

// 同一オリジンの親 document と全フレームへ探す。候補探索は queryAllDeep で open shadow も見る。
export async function clickChoiceEverywhere(text: string) {
  if (clickChoiceByText(text)) return true;
  for (const doc of otherSameOriginDocuments()) {
    if (clickChoiceByText(text, doc)) return true;
  }
  const response = await sendMessage('clickChoiceByText', text).catch(() => null);
  return !!(response && response.ok);
}

function overlayCaptionNode(overlay: Element, caption: string) {
  return [...overlay.querySelectorAll('div, span, label, button')].find((node) => {
    return isDisplayedPageElement(node) && visibleTextEquals(node, caption);
  }) || null;
}

export function displayedOverlayCaption(caption: string) {
  for (const overlay of overlayRoots()) {
    const match = overlayCaptionNode(overlay, caption);
    if (match) return match;
  }
  return null;
}

export function displayedAttendanceCaption() {
  const workTimeChange = workTimeChangeDialog();
  for (const overlay of overlayRoots()) {
    if (namedOverlayTitle(overlay.textContent) === '勤務時間変更') continue;
    if (workTimeChange && (overlay.contains(workTimeChange) || workTimeChange.contains(overlay))) continue;
    const match = overlayCaptionNode(overlay, '出勤');
    if (match) return match;
  }
  return null;
}

export function clickOverlayCaption(caption: string) {
  return activateClick(displayedOverlayCaption(caption));
}

function blurActiveTextField() {
  const active = document.activeElement;
  if (!active || isExtensionUi(active)) return;
  if (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA') return;
  (active as HTMLElement).blur();
}

// 行の保存と文言が同じで、勤務時間変更側にはダイアログ名が付かない。保存直前に時刻欄からフォーカスを外す。
export function clickTimeDialogSave() {
  blurActiveTextField();
  const table = timesheetTable();
  for (const overlay of overlayRoots()) {
    const submitSave = [...overlay.querySelectorAll('button')].find((button) =>
      isDisplayed(button)
      && (button.getAttribute('type') || '') === 'submit'
      && visibleTextEquals(button, '保存')
    );
    if (submitSave) return activateClick(submitSave);
  }
  const saveOutsideTable = [...document.querySelectorAll('button')].find((button) =>
    isDisplayedPageElement(button)
    && visibleTextEquals(button, '保存')
    && (!table || !table.contains(button))
  );
  return activateClick(saveOutsideTable);
}

export function workHourFirstJobRow() {
  return queryAllDeep(WORK_HOUR_JOB_ROW_SELECTOR).find((row) => {
    if (!isDisplayedPageElement(row)) return false;
    return !!row.querySelector(WORK_HOUR_EXTENDED_ITEM_SELECTOR);
  }) || null;
}

// 検索欄は先頭ジョブ行の task-hierarchy。クリック対象は内側の空の .name / .code。
// 欄ラッパへ click しても配下のハンドラは動かない。ラベルはジョブ名になるため欄名では特定できない。
// 出現順 0 が製品分野、1–4 が業務区分と業務種別_技術要素、5 がアウトプット名称。
function workHourLookupClickTarget(lookupItem: Element) {
  return lookupItem.querySelector('.name')
    || lookupItem.querySelector('.code')
    || lookupItem.querySelector('.container')
    || lookupItem;
}

export function clickWorkHourLookup(index: number, probe: FillProbe) {
  const jobRow = workHourFirstJobRow();
  if (!jobRow) {
    probe.lastProbe = 'workHourLookup: ジョブ行なし';
    return false;
  }
  const lookupItems = queryAllDeep(WORK_HOUR_LOOKUP_ITEM_SELECTOR, jobRow).filter(
    (el) => !isExtensionUi(el)
  );
  const lookupItem = lookupItems[index];
  if (!lookupItem) {
    probe.lastProbe = `workHourLookup: hierarchy=${lookupItems.length} index=${index} 該当なし`;
    return false;
  }
  return activateClick(workHourLookupClickTarget(lookupItem));
}

// お気に入り照合は先頭6桁。一致する候補が複数あることは無い。
function workHourFavoriteCode(value: unknown) {
  const match = comparableText(value).match(/\d{6}/);
  return match ? match[0] : '';
}

// お気に入りピッカーは role=dialog ではない。お気に入りタブ中もカテゴリー仮想リストが同一モーダル内に残る。決定は未選択時 disabled。
export function displayedFavoriteCandidate(value: string, probe: FillProbe) {
  const wantedCode = workHourFavoriteCode(value);
  if (!wantedCode) {
    probe.lastProbe = 'favorite: 6桁なし';
    return null;
  }
  const rowCounts: string[] = [];
  for (const searchRoot of [document, ...otherSameOriginDocuments()]) {
    const rows = queryAllDeep(FAVORITE_SEARCH_RESULT_ROW_SELECTOR, searchRoot).filter(
      isDisplayedPageElement
    );
    rowCounts.push(`rows=${rows.length}`);
    for (const row of rows) {
      if (workHourFavoriteCode(row.textContent) !== wantedCode) continue;
      const label = queryAllDeep(FAVORITE_SEARCH_RESULT_LABEL_SELECTOR, row).find(
        (el) => isDisplayedPageElement(el)
      );
      return label || row;
    }
  }
  probe.lastProbe = `favorite: code=${wantedCode} ${rowCounts.join(' | ')} 候補なし`;
  return null;
}

function workHourPicklistSelects(jobRow: Element) {
  return queryAllDeep(WORK_HOUR_PICKLIST_SELECT_SELECTOR, jobRow).filter(
    isDisplayedPageElement
  ) as HTMLSelectElement[];
}

// 知識が出現順 0、技能が 1。先頭ジョブ行の task-picklist。
export function setWorkHourDropdown(index: number, value: string, probe: FillProbe) {
  const jobRow = workHourFirstJobRow();
  if (!jobRow) {
    probe.lastProbe = 'picklistSelect: ジョブ行なし';
    return false;
  }
  const picklistSelects = workHourPicklistSelects(jobRow);
  const picklistSelect = picklistSelects[index];
  if (!picklistSelect) {
    probe.lastProbe = `picklistSelect: ${picklistSelects.length}件 index=${index} 該当なし`;
    return false;
  }
  setNativeValue(picklistSelect, value);
  return true;
}

// 作業時間は拡張欄ではなく TimeWrapper 内の placeholder 0 の input。
// combobox を開かず input へ直接 set する。
export function setWorkHourTime(value: string) {
  const dialog = findNamedDialog('工数実績サマリー');
  if (dialog) {
    const input = [...dialog.querySelectorAll('input')].find((el) =>
      isDisplayed(el)
      && (el.getAttribute('placeholder') === '0' || el.getAttribute('placeholder') === '(00:00)')
    );
    if (input) {
      commitTextField(input, value);
      return true;
    }
  }
  return runOperation('set', {
    tag: 'input',
    type: 'text',
    placeholder: '0',
    placeholderIndex: 0,
    dialogTitle: '工数実績サマリー'
  }, value);
}

export function currentTimesheetRow(rowHeader: string) {
  const table = timesheetTable();
  if (!table) return { table: null, row: null };
  return { table, row: findRowByHeader(table, rowHeader) };
}

export function cellOf(row: HTMLTableRowElement, table: HTMLTableElement, header: string) {
  const columnIndex = findColumnIndexByHeader(table, header);
  if (columnIndex < 0) return null;
  return cellAtVisualIndex(row, columnIndex);
}

function controlIsDisplayedAndEnabled(el: Element) {
  if (!isDisplayedPageElement(el)) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.getAttribute('aria-disabled') === 'true') return false;
  return true;
}

export function workHourColumnButtonIsEnabled(rowHeader: string) {
  const found = findElement({
    tag: 'button',
    labelText: '工数',
    table: { columnHeader: '工数', rowHeader }
  });
  if (!found) return false;
  const button = found.tagName === 'BUTTON' || found.getAttribute('role') === 'button'
    ? found
    : (found.querySelector('button, [role="button"]') || found);
  return controlIsDisplayedAndEnabled(button);
}

export function cellDisplayValue(cell: Element | null | undefined) {
  if (!cell) return '';
  const input = [...cell.querySelectorAll('input, textarea, select')].find((el) => !isExtensionUi(el));
  if (input) return normalizeSpace((input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value);
  return normalizeSpace(cell.textContent);
}

function looksFilled(header: string, text: string) {
  const value = normalizeSpace(text);
  if (!value || value === header) return false;
  if (header === '出勤' || header === '退勤') return /\d/.test(value);
  return value.length > 0 && !/^(選択|未入力|--|－)/.test(value);
}

export function existingRowValues(row: HTMLTableRowElement, table: HTMLTableElement) {
  const filled: ExistingRowValue[] = [];
  for (const header of ['出勤', '退勤', '勤務場所', '業務内容']) {
    const text = cellDisplayValue(cellOf(row, table, header));
    if (looksFilled(header, text)) filled.push({ header, text });
  }
  return filled;
}

function workPatternValuesMatch(onScreen: string, wanted: string) {
  const screenCmp = comparableText(onScreen);
  const wantedCmp = comparableText(wanted);
  if (!wantedCmp) return false;
  if (!screenCmp) return false;
  if (screenCmp === wantedCmp || screenCmp.includes(wantedCmp) || wantedCmp.includes(screenCmp)) return true;
  const patternId = wanted.match(/WPC-\d+/);
  return !!(patternId && screenCmp.includes(patternId[0]));
}

function workTimeChangeFormRow(labelText: string, root: ParentNode = document) {
  const wanted = comparableText(labelText);
  for (const row of root.querySelectorAll(WORK_TIME_CHANGE_FORM_ROW_SELECTOR)) {
    if (isExtensionUi(row)) continue;
    const label = row.querySelector(WORK_TIME_CHANGE_FORM_ROW_LABEL_SELECTOR);
    if (label && comparableText(label.textContent) === wanted) return row;
  }
  return null;
}

// 勤務パターンは form-row のラベルで特定する。ダイアログ見出しは「申請」のまま。
export function findWorkPatternCombobox() {
  const row = workTimeChangeFormRow('勤務パターン');
  if (!row) return null;
  const combo = row.querySelector('[role="combobox"]');
  if (!combo || isExtensionUi(combo) || !isDisplayed(combo)) return null;
  return combo;
}

export function workTimeChangeDialog() {
  const combo = findWorkPatternCombobox();
  if (combo) {
    const overlay = combo.closest(DIALOG_SELECTOR) || combo.closest('form');
    if (overlay && isDisplayed(overlay) && !isPageLevelNode(overlay)) return overlay;
  }
  return findNamedDialog('勤務時間変更');
}

// キャンセルはフッタ側。このクラスの button は申請の1つ。1日の申請の「申請」とは別。
export function clickWorkTimeChangeApply() {
  const button = queryAllDeep(WORK_TIME_CHANGE_APPLY_BUTTON_SELECTOR).find((el) =>
    isDisplayedPageElement(el) && visibleTextEquals(el, '申請')
  );
  return activateClick(button);
}

// 勤務パターンは react-autosuggest の combobox。候補は配下の li[role=option]。
// 閉じているとき listbox #react-autowhatever-1 は空。開くと ul.react-autosuggest__suggestions-list に出る。
// 開く成功はカタログ同期と同じく、候補の出現を load wait で待つ。
function workPatternOptionNodes() {
  const combo = findWorkPatternCombobox();
  if (!combo) return [];
  return queryAllDeep('[role="option"]', combo).filter((el) => !isExtensionUi(el));
}

export function readWorkPatternOptionTexts() {
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const el of workPatternOptionNodes()) {
    const text = normalizeSpace(el.textContent || '');
    if (!text || /^(選択|未入力|--|－)/.test(text) || seen.has(text)) continue;
    seen.add(text);
    texts.push(text);
  }
  return texts;
}

export function workTimeChangeRemarkRow(root: Element) {
  return workTimeChangeFormRow('備考', root);
}

function onScreenWorkPatternText() {
  const combo = findWorkPatternCombobox();
  if (!combo) return '';
  const fromCombo = comboboxValue(combo);
  if (fromCombo) return fromCombo;
  const block = combo.closest('.slds-form-element, [class*="form-element"], [class*="FormElement"]') || combo.parentElement;
  if (block && block !== document.body) {
    const blockText = ownVisibleText(block, MAX_OPTION_TEXT_CHARS);
    if (blockText) return blockText;
  }
  return ownVisibleText(combo, MAX_OPTION_TEXT_CHARS) || '';
}

// 行テキストには WPC- が出ない。判定は combobox の現在値。
export function isOnScreenWorkPatternSame(wanted: string) {
  return workPatternValuesMatch(onScreenWorkPatternText(), wanted);
}

function visiblePatternOptions() {
  return workPatternOptionNodes().filter(isDisplayed);
}

export async function openWorkPatternCombobox() {
  const combo = findWorkPatternCombobox();
  if (!combo) return false;
  if (!readWorkPatternOptionTexts().length && !isComboboxOpen(combo)) {
    const optionCountBefore = visiblePatternOptions().length;
    if (!activateClick(combo)) return false;
    if (!(isComboboxOpen(combo) || visiblePatternOptions().length > optionCountBefore)) {
      const control = comboboxInnerControl(combo) || combo;
      try {
        (control as Element).dispatchEvent(new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          code: 'ArrowDown',
          keyCode: 40,
          which: 40,
          bubbles: true,
          cancelable: true
        }));
      } catch (e) { /* キーボードイベントを送れない場合はクリック結果のみで判定 */ }
    }
  }
  const { loadWaitIntervalMs, loadWaitTimeoutMs } = await loadWaitSettings();
  return (await waitUntilReady(
    () => readWorkPatternOptionTexts().length > 0,
    loadWaitIntervalMs,
    loadWaitTimeoutMs
  )) === 'ok';
}

function isUsableDayApplyButton(node: Element) {
  if (!controlIsDisplayedAndEnabled(node)) return false;
  return visibleTextEquals(node, '申請');
}

// 1日の申請の「申請」は勤務時間入力にある。
// overlay 名は空なので、出勤キャプションがある overlay 内の disabled でない「申請」。
export function displayedDayApplyButton() {
  const attendanceCaption = displayedAttendanceCaption();
  if (!attendanceCaption) return null;
  const overlay = overlayRoots().find((root) => root.contains(attendanceCaption));
  if (!overlay) return null;
  return queryAllDeep('button', overlay).find(isUsableDayApplyButton) || null;
}
