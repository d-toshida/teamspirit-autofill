// 日次行の「入力」から、確認UI・上書き確認のあと、連続実行またはステップ実行で1日分を入れる。

import {
  SEED_DEFAULTS,
  TEMPLATE_ITEM_SLOTS,
  templatePreviewRows,
  workPatternTextById,
  workPatternsFromTexts,
  templateLabel,
  digitsTime,
  validateTemplateRequiredFields,
  loadFillSettings,
  saveWorkPatterns,
  appendFillTemplate,
  templateFromItemValues,
  saveFillLogs,
  type FillDefaults,
  type FillTemplate,
  type WorkPattern
} from './fill-config.js';
import {
  populateWorkLocationSelect,
  populateWorkPatternSelect
} from './fill-selects.js';
import {
  buildFillManuals,
  flattenFillManuals
} from './fill-steps.js';
import {
  clearFillSession,
  currentStepStatusText,
  fillSession,
  runCurrentFillStep,
  skipCurrentFillStep,
  type FillLogEntry,
  type FillRunUi,
  type UiState
} from './fill-runner.js';
import {
  CHOICE_SELECTOR,
  OPEN_MENU_SELECTOR,
  WORK_HOUR_EXTENDED_ITEM_SELECTOR,
  cellDisplayValue,
  cellOf,
  clickChoiceByText,
  currentTimesheetRow,
  displayedSelectSummaries,
  existingRowValues,
  findWorkPatternCombobox,
  isInsideOpenChoiceList,
  isTimesheetValueTrigger,
  openWorkPatternCombobox,
  readWorkPatternOptionTexts,
  workTimeChangeDialog,
  workTimeChangeRemarkRow,
  type ExistingRowValue
} from './fill-screen.js';
import {
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
  isHeadRow,
  rowHeaderText,
  timesheetTable
} from './timesheet.js';
import {
  comboboxValue,
  findNamedDialog,
  headingTextFromRoot,
  isComboboxOpen,
  namedOverlayTitle,
  overlayRoots
} from './locate.js';
import { notify } from './execute-step.js';

const FILL_ROOT_ID = 'ts-autofill-root';
const FILL_BUTTON_CLASS = 'ts-row-fill-btn';
const FILL_BUTTON_CELL_CLASS = 'ts-row-fill-cell';
const TIMESHEET_APPLICATION_COL_SELECTOR = '.timesheet-pc-main-content-timesheet-daily-row__col-application, .timesheet-pc-main-content-timesheet-heading-row__col-application';
const WORK_PATTERN_SYNC_ATTR = 'work-pattern-sync';
const WORK_PATTERN_SYNC_BUTTON_CLASS = 'ts-work-pattern-sync-btn';
const WORK_HOUR_TEMPLATE_SAVE_ATTR = 'work-hour-template-save';
const WORK_HOUR_TEMPLATE_SAVE_BUTTON_CLASS = 'ts-work-hour-template-save-btn';
const INJECT_DEBOUNCE_MS = 250;

let lastWorkHourRowHeader = '';

function elementLabel(el: Element | null) {
  if (!el || el === document.body || el === document.documentElement) return '';
  const text = normalizeSpace(visibleElementText(el)).slice(0, 80);
  const extras = [];
  const expanded = el.getAttribute('aria-expanded');
  if (expanded !== null) extras.push(`expanded=${expanded}`);
  const haspopup = el.getAttribute('aria-haspopup');
  if (haspopup) extras.push(`haspopup=${haspopup}`);
  return `${el.tagName.toLowerCase()}${el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : ''}${text ? ' ' + text : ''}${extras.length ? ' ' + extras.join(' ') : ''}`;
}

function overlayTitleOf(root: Element) {
  return headingTextFromRoot(root, null) || namedOverlayTitle(root.textContent) || '';
}

function listedTexts(nodes: Iterable<Element>, maxItems: number) {
  const texts: string[] = [];
  for (const node of nodes) {
    if (!isDisplayedPageElement(node)) continue;
    const text = normalizeSpace(ownVisibleText(node, 80) || '').slice(0, 80);
    if (text && !texts.includes(text)) texts.push(text);
    if (texts.length >= maxItems) break;
  }
  return texts;
}

function targetMatchSnapshot(targetText?: string) {
  if (!targetText) return [];
  return queryAllDeep(CHOICE_SELECTOR + ', [role="combobox"], label').filter((el) => {
    if (isExtensionUi(el)) return false;
    return visibleTextEquals(el, targetText);
  }).slice(0, 12).map((el) => ({
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role') || '',
    displayed: isDisplayed(el),
    timesheetTrigger: isTimesheetValueTrigger(el),
    inOpenList: isInsideOpenChoiceList(el),
    text: normalizeSpace(visibleElementText(el)).slice(0, 80)
  }));
}

function captureUiState(targetText?: string): UiState {
  const overlays = overlayRoots().map((root) => ({
    title: overlayTitleOf(root),
    buttons: listedTexts(root.querySelectorAll('button'), 12),
    choices: listedTexts(root.querySelectorAll(CHOICE_SELECTOR), 16)
  }));
  const openMenus = queryAllDeep(OPEN_MENU_SELECTOR)
    .filter(isDisplayedPageElement)
    .slice(0, 8)
    .map((menu) => ({
      tag: menu.tagName.toLowerCase(),
      className: String(menu.className || '').slice(0, 80),
      items: listedTexts(queryAllDeep(CHOICE_SELECTOR, menu), 16)
    }));
  const optionNodes = queryAllDeep('[role="option"]');
  const options = {
    total: optionNodes.length,
    visible: optionNodes.filter(isDisplayedPageElement).length,
    texts: listedTexts(optionNodes, 12)
  };
  const selects = displayedSelectSummaries();
  const matches = targetMatchSnapshot(targetText);
  const comboboxes = queryAllDeep('[role="combobox"]')
    .filter(isDisplayedPageElement)
    .slice(0, 8)
    .map((el) => ({
      ariaLabel: normalizeSpace(el.getAttribute('aria-label') || '').slice(0, 40),
      text: normalizeSpace(el.textContent).slice(0, 80),
      value: comboboxValue(el).slice(0, 80),
      expanded: isComboboxOpen(el)
    }));
  const timeInputs = [...document.querySelectorAll('input')]
    .filter(isDisplayedPageElement)
    .filter((el) => {
      const placeholder = el.getAttribute('placeholder') || '';
      return placeholder === '(00:00)' || placeholder === '0';
    })
    .slice(0, 6)
    .map((el) => `${el.getAttribute('placeholder')}=${el.value || '(空)'}`);
  return {
    pathname: location.pathname,
    isIframe: window !== window.top,
    focused: elementLabel(document.activeElement),
    overlayCount: overlays.length,
    overlays,
    openMenus,
    options,
    selects,
    comboboxes,
    timeInputs,
    targetText: targetText || '',
    matchCount: matches.length,
    visibleMatchCount: matches.filter((item) => item.displayed).length,
    matches
  };
}

function formatUiState(state: UiState) {
  const menuItems = state.openMenus.flatMap((menu) => menu.items);
  const overlayTitles = state.overlays.map((overlay) => overlay.title).filter(Boolean);
  const lines = [
    `path: ${state.pathname}${state.isIframe ? ' (iframe)' : ' (top)'}`,
    `focus: ${state.focused || 'なし'}`,
    `overlay: ${overlayTitles.join(' / ') || 'なし'}`,
    `menuItems: ${menuItems.join(' / ') || 'なし'}`,
    `options: 表示${state.options.visible} / 全体${state.options.total}${state.options.texts.length ? ' ' + state.options.texts.join(' / ') : ''}`,
    state.selects.length ? `select: ${state.selects.join(' / ')}` : '',
    `combobox: ${state.comboboxes.map((item) => {
      const label = item.value || item.ariaLabel || item.text || '(空)';
      return `${label}${item.expanded ? ' expanded' : ''}`;
    }).join(' / ') || 'なし'}`,
    state.timeInputs.length ? `timeInputs: ${state.timeInputs.join(' / ')}` : '',
    state.targetText
      ? `「${state.targetText}」候補: 表示${state.visibleMatchCount} / 全体${state.matchCount}`
      : ''
  ];
  if (state.matches.length) {
    for (const match of state.matches) {
      lines.push(`  - ${match.tag}${match.role ? '[role=' + match.role + ']' : ''} displayed=${match.displayed}${match.timesheetTrigger ? ' trigger=true' : ''}${match.inOpenList ? ' openList=true' : ''} ${match.text}`);
    }
  }
  return lines.filter(Boolean).join('\n');
}

function formatLogEntry(entry: FillLogEntry) {
  const result = entry.skipped ? '省略' : (entry.ok ? '成功' : '失敗');
  const lines = [`${entry.step}/${entry.total} ${entry.label} → ${result}`];
  if (entry.skipReason) lines.push(`reason: ${entry.skipReason}`);
  if (entry.errorMessage) lines.push(`error: ${entry.errorMessage}`);
  if (entry.error) lines.push(`exception: ${entry.error}`);
  if (entry.probe) lines.push('--- probe ---', entry.probe);
  lines.push('--- before ---', formatUiState(entry.before), '--- after ---', formatUiState(entry.after));
  return lines.join('\n');
}

function renderLogView(entry: FillLogEntry | null | undefined) {
  const logEl = document.getElementById('ts-autofill-log');
  if (!logEl) return;
  logEl.textContent = entry ? formatLogEntry(entry) : 'まだステップログはありません。';
}

function persistFillLogs() {
  saveFillLogs(fillSession.logs);
}

function appendFillLog(entry: FillLogEntry) {
  fillSession.logs.push(entry);
  persistFillLogs();
  console.info('[ts-autofill]', entry.label, entry.ok ? 'ok' : 'fail', entry);
  renderLogView(entry);
}

// 勤務表 iframe 内の clipboard.writeText は Permissions Policy で拒否される。
function copyFillLogs() {
  const status = document.getElementById('ts-autofill-status');
  const statusText = status ? status.textContent.trim() : '';
  const parts = [];
  if (statusText) parts.push(`表示中の状態: ${statusText}`);
  parts.push(fillSession.logs.map(formatLogEntry).join('\n\n') || 'ログはありません。');
  const text = parts.join('\n\n');
  const done = () => notify('ステップログをコピーしました');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => copyFillLogsFallback(text, done));
    return;
  }
  copyFillLogsFallback(text, done);
}

function copyFillLogsFallback(text: string, done: () => void) {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('data-ts-autofill', 'log-copy');
  area.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.appendChild(area);
  area.select();
  try {
    document.execCommand('copy');
    done();
  } catch (e) {
    notify('ログのコピーに失敗しました');
  }
  area.remove();
}

// 同期ボタンを押すとドロップダウンは閉じる。開始時点では選択肢は出ていない。
async function syncWorkPatternCatalog() {
  if (!findWorkPatternCombobox()) {
    notify(findNamedDialog('勤務時間変更') ? '勤務パターン欄が見つかりません' : '勤務時間変更の画面が見つかりません');
    return;
  }
  await openWorkPatternCombobox();
  const workPatterns = workPatternsFromTexts(readWorkPatternOptionTexts());
  if (!workPatterns.length) {
    notify('勤務パターンの選択肢を読み取れませんでした');
    return;
  }
  await saveWorkPatterns(workPatterns);
  notify(`勤務パターンを${workPatterns.length}件同期しました`);
}

function injectButtonAfter(
  anchor: Element | null,
  autofillAttr: string,
  className: string,
  label: string,
  onClick: () => unknown
) {
  const existing = document.querySelector(`[data-ts-autofill="${autofillAttr}"]`) as HTMLButtonElement | null;
  if (!anchor) {
    if (existing) existing.remove();
    return;
  }
  const button = existing || makeButton(label, className, onClick);
  button.dataset.tsAutofill = autofillAttr;
  if (button.previousElementSibling === anchor && button.parentElement === anchor.parentElement) return;
  anchor.insertAdjacentElement('afterend', button);
}

function injectWorkPatternSyncButton() {
  const dialog = workTimeChangeDialog();
  injectButtonAfter(
    dialog ? workTimeChangeRemarkRow(dialog) : null,
    WORK_PATTERN_SYNC_ATTR,
    WORK_PATTERN_SYNC_BUTTON_CLASS,
    '勤務パターン選択肢を同期',
    () => {
      void syncWorkPatternCatalog();
    }
  );
}

function rememberWorkHourTimesheetRow(event: Event) {
  const target = event.target;
  if (!(target instanceof Element) || isExtensionUi(target)) return;
  const table = timesheetTable();
  if (!table || !table.contains(target)) return;
  const row = target.closest('tr');
  if (!(row instanceof HTMLTableRowElement) || isHeadRow(row) || !table.contains(row)) return;
  const columnIndex = findColumnIndexByHeader(table, '工数');
  if (columnIndex < 0) return;
  const cell = cellAtVisualIndex(row, columnIndex);
  if (!cell || !cell.contains(target)) return;
  lastWorkHourRowHeader = rowHeaderText(row);
}

// 工数入力サブ画面は勤務表の「工数」セル操作のあとだけ開く。見出しは「工数入力」。
function workHourInputLabel() {
  for (const el of queryAllDeep('span')) {
    if (!isDisplayedPageElement(el)) continue;
    if (normalizeSpace(el.textContent || '') !== '工数入力') continue;
    return el;
  }
  return null;
}

async function saveWorkHourTemplateFromScreen() {
  const label = workHourInputLabel();
  let panel: Element | null = null;
  if (label) {
    let node: Element | null = label.parentElement;
    while (node && node !== document.body) {
      if (node.querySelector('[data-rbd-droppable-id], [data-rbd-draggable-id]')) {
        panel = node;
        break;
      }
      node = node.parentElement;
    }
  }
  if (!panel) {
    notify('工数入力の画面が見つかりません');
    return;
  }
  const rows = queryAllDeep('[data-rbd-draggable-id]', panel).filter((el) => {
    if (!isDisplayedPageElement(el)) return false;
    return !!el.querySelector(WORK_HOUR_EXTENDED_ITEM_SELECTOR);
  });
  const firstJobRow = rows[0];
  if (!firstJobRow) {
    notify('ジョブ行が見つかりません');
    return;
  }
  const table = timesheetTable();
  if (!table || !lastWorkHourRowHeader) {
    notify('勤務表の対象行が見つかりません');
    return;
  }
  const timesheetRow = findRowByHeader(table, lastWorkHourRowHeader);
  if (!timesheetRow) {
    notify('勤務表の対象行が見つかりません');
    return;
  }
  const workContent = cellDisplayValue(cellOf(timesheetRow, table, '業務内容'));
  const jobRowItemValues = queryAllDeep(WORK_HOUR_EXTENDED_ITEM_SELECTOR, firstJobRow)
    .filter((el) => !isExtensionUi(el))
    .map((el) => {
      const select = el.querySelector('select') as HTMLSelectElement | null;
      if (select) return normalizeSpace(select.value);
      const code = normalizeSpace(el.querySelector('.code')?.textContent || '');
      const name = normalizeSpace(el.querySelector('.name')?.textContent || '');
      return `${code}${name}`;
    })
    .slice(0, TEMPLATE_ITEM_SLOTS.length);
  // ジョブ行拡張欄の出現順は不変。先頭8件がテンプレート対象。その後に入力不要の task-text 列がある。
  const template = templateFromItemValues(workContent, jobRowItemValues);
  const validationError = validateTemplateRequiredFields(template);
  if (validationError) {
    notify(validationError);
    return;
  }
  if (rows.length > 1 && !window.confirm('ジョブが複数あります。先頭の1行だけをテンプレートに保存します。')) {
    return;
  }
  const named = await appendFillTemplate(template);
  notify(`工数テンプレート「${templateLabel(named)}」を保存しました`);
}

function injectWorkHourTemplateSaveButton() {
  injectButtonAfter(
    workHourInputLabel(),
    WORK_HOUR_TEMPLATE_SAVE_ATTR,
    WORK_HOUR_TEMPLATE_SAVE_BUTTON_CLASS,
    'テンプレートに保存',
    () => {
      void saveWorkHourTemplateFromScreen();
    }
  );
}

function removeFillPanel() {
  const root = document.getElementById(FILL_ROOT_ID);
  if (root) root.remove();
}

function closeFillPanel() {
  removeFillPanel();
  document.querySelectorAll('.' + FILL_BUTTON_CLASS).forEach((button) => {
    (button as HTMLButtonElement).disabled = false;
  });
}

function cancelFill() {
  closeFillPanel();
  clearFillSession();
}

function setPanelStatus(text: string, isError: boolean) {
  const status = document.getElementById('ts-autofill-status');
  if (!status) return;
  status.textContent = text;
  status.classList.toggle('error', !!isError);
}

function setStepActionButtonsDisabled(disabled: boolean) {
  const skipButton = document.getElementById('ts-autofill-skip') as HTMLButtonElement | null;
  const nextButton = document.getElementById('ts-autofill-next') as HTMLButtonElement | null;
  if (skipButton) skipButton.disabled = disabled;
  if (nextButton) nextButton.disabled = disabled;
}

function fillRunUi(): FillRunUi {
  return {
    captureUiState,
    appendFillLog,
    persistFillLogs,
    setPanelStatus,
    setStepActionButtonsDisabled,
    showFillEnded,
    notify,
    cancelFill
  };
}

function makeButton(label: string, className: string, onClick: () => unknown) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener('mousedown', (event) => {
    event.preventDefault();
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    setTimeout(() => {
      Promise.resolve(onClick()).catch((error) => {
        console.info('[ts-autofill]', error);
      });
    }, 0);
  });
  return button;
}

function ensureFillPanel() {
  let root = document.getElementById(FILL_ROOT_ID);
  if (root) return root;
  root = document.createElement('div');
  root.id = FILL_ROOT_ID;
  root.className = 'ts-autofill-root';
  root.dataset.tsAutofill = 'panel';

  const backdrop = document.createElement('div');
  backdrop.className = 'ts-autofill-backdrop';
  backdrop.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (fillSession.phase === 'steps') return;
    cancelFill();
  });

  const panel = document.createElement('div');
  panel.className = 'ts-autofill-panel';
  panel.addEventListener('click', (event) => event.stopPropagation());

  const title = document.createElement('h2');
  title.id = 'ts-autofill-title';

  const body = document.createElement('div');
  body.id = 'ts-autofill-body';

  const actions = document.createElement('div');
  actions.id = 'ts-autofill-actions';
  actions.className = 'ts-autofill-actions';

  panel.append(title, body, actions);
  root.append(backdrop, panel);
  (document.body || document.documentElement).appendChild(root);
  return root;
}

function setPanelChrome(titleText: string, docked?: boolean) {
  const root = ensureFillPanel();
  root.classList.toggle('ts-autofill-docked', !!docked);
  (document.getElementById('ts-autofill-title') as HTMLElement).textContent = titleText;
  const body = document.getElementById('ts-autofill-body') as HTMLElement;
  const actions = document.getElementById('ts-autofill-actions') as HTMLElement;
  body.replaceChildren();
  actions.replaceChildren();
  return { body, actions };
}

function addField(parent: Element, labelText: string, control: HTMLElement) {
  const wrap = document.createElement('div');
  wrap.className = 'ts-autofill-field';
  const label = document.createElement('label');
  label.textContent = labelText;
  if (control.id) label.htmlFor = control.id;
  wrap.append(label, control);
  parent.appendChild(wrap);
}

function addTimeInput(parent: Element, id: string, labelText: string, value: string, placeholder: string) {
  const input = document.createElement('input');
  input.id = id;
  input.type = 'text';
  input.inputMode = 'numeric';
  input.value = value;
  input.placeholder = placeholder;
  addField(parent, labelText, input);
  return input;
}

function addCheck(parent: Element, id: string, labelText: string, checked: boolean) {
  const label = document.createElement('label');
  label.className = 'ts-autofill-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.id = id;
  input.checked = checked;
  label.append(input, labelText);
  parent.appendChild(label);
  return input;
}

function renderTemplatePreview(container: Element, template: FillTemplate | undefined) {
  container.replaceChildren();
  for (const row of templatePreviewRows(template)) {
    const previewRow = document.createElement('div');
    previewRow.className = 'ts-autofill-preview-row';
    const fieldLabel = document.createElement('div');
    fieldLabel.className = 'ts-autofill-preview-label';
    fieldLabel.textContent = row.label || '';
    const fieldValue = document.createElement('div');
    fieldValue.className = 'ts-autofill-preview-value';
    fieldValue.textContent = row.value || '';
    previewRow.append(fieldLabel, fieldValue);
    container.appendChild(previewRow);
  }
}

function showFillForm(defaults: FillDefaults, templates: FillTemplate[], workPatterns: WorkPattern[]) {
  fillSession.phase = 'form';
  const { body, actions } = setPanelChrome(`入力の確認（${fillSession.rowHeader}）`);

  const note = document.createElement('p');
  note.className = 'ts-autofill-note';
  note.textContent = '業務内容は選んだ工数テンプレートの値を使います。作業時間は始業・終業・休憩から計算します。';
  body.appendChild(note);

  const patternSelect = document.createElement('select');
  patternSelect.id = 'ts-autofill-work-pattern';
  populateWorkPatternSelect(patternSelect, workPatterns, defaults.workPatternId);
  addField(body, '勤務パターン', patternSelect);

  const timeRow = document.createElement('div');
  timeRow.className = 'ts-autofill-field-row';
  const clockInInput = addTimeInput(timeRow, 'ts-autofill-clock-in', '始業時刻（HHmm）', defaults.clockIn, SEED_DEFAULTS.clockIn);
  const clockOutInput = addTimeInput(timeRow, 'ts-autofill-clock-out', '終業時刻（HHmm）', defaults.clockOut, SEED_DEFAULTS.clockOut);
  const breakTimeInput = addTimeInput(timeRow, 'ts-autofill-break-time', '休憩時間（HHmm）', defaults.breakTime, SEED_DEFAULTS.breakTime);
  body.appendChild(timeRow);

  const locationSelect = document.createElement('select');
  locationSelect.id = 'ts-autofill-work-location';
  populateWorkLocationSelect(locationSelect, defaults.workLocation);
  addField(body, '勤務場所', locationSelect);

  const templateSelect = document.createElement('select');
  templateSelect.id = 'ts-autofill-template';
  templates.forEach((template, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = templateLabel(template);
    templateSelect.appendChild(option);
  });
  addField(body, '工数テンプレート', templateSelect);

  const templatePreview = document.createElement('div');
  templatePreview.className = 'ts-autofill-template-preview';
  body.appendChild(templatePreview);

  function showSelectedTemplatePreview() {
    const selectedTemplate = templates[Number(templateSelect.value)] || templates[0];
    renderTemplatePreview(templatePreview, selectedTemplate);
  }
  templateSelect.addEventListener('change', showSelectedTemplatePreview);
  showSelectedTemplatePreview();

  const stepByStepInput = addCheck(body, 'ts-autofill-step-by-step', 'ステップごとに自動入力する', defaults.stepByStep);
  const includeDayApplyInput = addCheck(body, 'ts-autofill-include-day-apply', '申請まで行う', defaults.includeDayApply);

  actions.append(
    makeButton('キャンセル', 'ts-secondary', () => cancelFill()),
    makeButton('自動入力を開始', '', () => {
      const template = templates[Number(templateSelect.value)] || templates[0];
      if (!template) {
        notify('工数テンプレートがありません。工数入力画面の「テンプレートに保存」で登録してください');
        return;
      }
      fillSession.workPattern = workPatternTextById(workPatterns, patternSelect.value || null);
      fillSession.clockIn = digitsTime(clockInInput.value) || digitsTime(defaults.clockIn);
      fillSession.clockOut = digitsTime(clockOutInput.value) || digitsTime(defaults.clockOut);
      fillSession.breakTime = digitsTime(breakTimeInput.value) || digitsTime(defaults.breakTime);
      fillSession.workLocation = locationSelect.value;
      fillSession.workContent = template.workContent;
      fillSession.template = template;
      fillSession.stepByStep = stepByStepInput.checked;
      fillSession.includeDayApply = includeDayApplyInput.checked;
      beginFillAfterConfirm();
    })
  );
}

function beginFillAfterConfirm() {
  const { table, row } = currentTimesheetRow(fillSession.rowHeader);
  if (!row || !table) {
    notify('対象行が見つかりません');
    return;
  }
  const filled = existingRowValues(row, table);
  if (filled.length) {
    showOverwritePrompt(filled);
    return;
  }
  startFillRun();
}

function showOverwritePrompt(filled: ExistingRowValue[]) {
  fillSession.phase = 'overwrite';
  const { body, actions } = setPanelChrome('上書きの確認');
  const note = document.createElement('p');
  note.className = 'ts-autofill-note';
  note.textContent = 'この行には既に入力があります。上書きして自動入力を続けますか。';
  body.appendChild(note);

  const list = document.createElement('ul');
  list.className = 'ts-autofill-existing';
  for (const item of filled) {
    const li = document.createElement('li');
    li.textContent = `${item.header}: ${item.text}`;
    list.appendChild(li);
  }
  body.appendChild(list);

  actions.append(
    makeButton('キャンセル', 'ts-secondary', () => cancelFill()),
    makeButton('上書きして進む', 'ts-danger', () => {
      const { row } = currentTimesheetRow(fillSession.rowHeader);
      if (!row) {
        notify('対象行が見つかりません');
        return;
      }
      startFillRun();
    })
  );
}

function startFillRun() {
  const flattened = flattenFillManuals(buildFillManuals(fillSession));
  fillSession.steps = flattened.steps;
  fillSession.manualGroups = flattened.manualGroups;
  fillSession.stepIndex = 0;
  fillSession.stepRunning = false;
  fillSession.phase = 'steps';
  fillSession.logs = [];
  persistFillLogs();
  injectRowButtons();
  if (fillSession.stepByStep) {
    showStepPanel();
    return;
  }
  removeFillPanel();
  void runCurrentFillStep(fillRunUi());
}

function renderStepPanelBody(statusText: string, isError: boolean) {
  const { body, actions } = setPanelChrome(`ステップ実行（${fillSession.rowHeader}）`, true);
  const status = document.createElement('div');
  status.id = 'ts-autofill-status';
  status.className = 'ts-autofill-status';
  status.classList.toggle('error', isError);
  status.textContent = statusText;
  body.appendChild(status);

  const logEl = document.createElement('pre');
  logEl.id = 'ts-autofill-log';
  logEl.className = 'ts-autofill-log';
  body.appendChild(logEl);
  renderLogView(fillSession.logs[fillSession.logs.length - 1]);
  return { actions };
}

function showStepPanel() {
  const { actions } = renderStepPanelBody(currentStepStatusText(), false);
  const skipButton = makeButton('スキップ', 'ts-secondary', () => skipCurrentFillStep('使用者がスキップした', fillRunUi()));
  skipButton.id = 'ts-autofill-skip';
  const nextButton = makeButton('次のステップ', '', () => runCurrentFillStep(fillRunUi()));
  nextButton.id = 'ts-autofill-next';
  actions.append(
    makeButton('中止', 'ts-secondary', () => cancelFill()),
    makeButton('ログをコピー', 'ts-secondary', () => copyFillLogs()),
    skipButton,
    nextButton
  );
}

function showFillEnded(statusText: string, isError: boolean) {
  const { actions } = renderStepPanelBody(statusText, isError);
  actions.append(
    makeButton('閉じる', 'ts-secondary', () => cancelFill()),
    makeButton('ログをコピー', 'ts-secondary', () => copyFillLogs())
  );
}

async function openFillForm(rowHeader: string) {
  if (fillSession.phase === 'steps') {
    notify('いまステップ実行中です。中止してから別の行を選んでください');
    return;
  }
  const { defaults, templates, workPatterns } = await loadFillSettings();
  fillSession.rowHeader = rowHeader;
  showFillForm(defaults, templates, workPatterns);
}

function applyButtonInCell(cell: Element) {
  return [...cell.querySelectorAll('button')].find((button) =>
    !isExtensionUi(button) && !button.classList.contains(FILL_BUTTON_CLASS)
  );
}

function fitApplicationColumnToContent(table: HTMLTableElement) {
  const appColWidthVar = '--ts-application-col-width';

  table.style.removeProperty(appColWidthVar);
  const fillCell = table.querySelector('.' + FILL_BUTTON_CELL_CLASS);
  if (!(fillCell instanceof HTMLElement) || fillCell.offsetWidth === 0) return;
  table.style.setProperty(appColWidthVar, `${fillCell.offsetWidth}px`);
}

function injectRowButtons() {
  const table = timesheetTable();
  if (!table) return;
  const running = fillSession.phase === 'steps';

  for (const cell of table.querySelectorAll(TIMESHEET_APPLICATION_COL_SELECTOR)) {
    cell.classList.add('ts-application-col');
    const row = cell.closest('tr');
    if (!(row instanceof HTMLTableRowElement) || isHeadRow(row)) continue;
    const applyButton = applyButtonInCell(cell);
    if (!applyButton) continue;
    const rowHeader = rowHeaderText(row);
    if (!rowHeader) continue;

    let fillButton = cell.querySelector('.' + FILL_BUTTON_CLASS) as HTMLButtonElement | null;
    if (!fillButton) {
      fillButton = document.createElement('button');
      fillButton.type = 'button';
      fillButton.className = FILL_BUTTON_CLASS;
      fillButton.dataset.tsAutofill = 'row-button';
      fillButton.textContent = '入力';
      fillButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        const header = fillButton!.dataset.rowHeader as string;
        const table = timesheetTable();
        const liveRow = table ? findRowByHeader(table, header) : null;
        if (!liveRow) {
          notify('対象行が見つかりません');
          return;
        }
        openFillForm(header);
      }, true);
      applyButton.parentElement!.insertBefore(fillButton, applyButton);
    }
    applyButton.parentElement!.classList.add(FILL_BUTTON_CELL_CLASS);
    fillButton.dataset.rowHeader = rowHeader;
    fillButton.title = `${rowHeader} を入力`;
    fillButton.disabled = running;
  }
  fitApplicationColumnToContent(table);
}

function injectPageButtons() {
  injectRowButtons();
  injectWorkPatternSyncButton();
  injectWorkHourTemplateSaveButton();
}

let injectTimer: ReturnType<typeof setTimeout> | 0 = 0;
function scheduleInject() {
  if (injectTimer) clearTimeout(injectTimer);
  injectTimer = setTimeout(() => {
    injectTimer = 0;
    injectPageButtons();
  }, INJECT_DEBOUNCE_MS);
}

function startRowButtonWatch() {
  injectPageButtons();
  document.addEventListener('click', rememberWorkHourTimesheetRow, true);
  if (!document.body) return;
  const observer = new MutationObserver(() => scheduleInject());
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', scheduleInject);
  globalThis.visualViewport?.addEventListener('resize', scheduleInject);
}

export function start() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startRowButtonWatch);
  } else {
    startRowButtonWatch();
  }

  // 設定の読み込みはここ。
  loadFillSettings().catch(() => {});

  // background の executeScript が全フレームで候補クリックするときに読む。
  globalThis.__tsAutofill = { clickChoiceByText };
}
