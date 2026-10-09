// 自動入力の既定値・勤務パターンカタログ・工数テンプレート。設定画面と content script で共有する。
// ファイルI/Oのキーはこのモジュールに閉じる。呼び出し側はオブジェクトと load/save を使う。
// 旧設定との互換は置かない。欠けと不正値は既定値。
// テンプレート追加は工数入力の「テンプレートに保存」で templates 配列へオブジェクトを足す。適用処理は kind の分岐1箇所。
// 工数8枠の形・欄名・設定画面 id は TEMPLATE_ITEM_SLOTS 1箇所。

import { browser } from 'wxt/browser';

const DEFAULTS_KEY = 'defaults';
const WORK_PATTERNS_KEY = 'work_patterns';
const TEMPLATES_KEY = 'templates';
const FILL_LOGS_KEY = 'fill_logs';
const FILL_LOGS_MAX = 100;

type WorkPattern = {
  id: string;
  text: string;
};

type FillDefaults = {
  workPatternId: string | null;
  clockIn: string;
  clockOut: string;
  breakTime: string;
  workLocation: string;
  stepByStep: boolean;
  includeDayApply: boolean;
};

type FillTemplateItem =
  | { kind: 'favorite'; value: string }
  | { kind: 'dropdown'; index: number; value: string };

type FillTemplate = {
  name: string;
  workContent: string;
  items: FillTemplateItem[];
};

type FillWaitField = {
  storageKey: string;
  defaultValue: number;
};

// 待ち時間のキー文字列はこの表だけ。
const FILL_WAIT_FIELDS = {
  autoStepDelayMs: { storageKey: 'auto_step_delay_ms', defaultValue: 200 },
  loadWaitIntervalMs: { storageKey: 'load_wait_interval_ms', defaultValue: 500 },
  loadWaitTimeoutMs: { storageKey: 'load_wait_timeout_ms', defaultValue: 10000 }
} as const satisfies Record<string, FillWaitField>;

type FillWaitSettings = {
  -readonly [FieldName in keyof typeof FILL_WAIT_FIELDS]: number;
};

const FILL_WAIT_FIELD_NAMES = Object.keys(FILL_WAIT_FIELDS) as Array<keyof FillWaitSettings>;

const SEED_DEFAULTS: FillDefaults = {
  workPatternId: null,
  clockIn: '900',
  clockOut: '1800',
  breakTime: '100',
  workLocation: '出社',
  stepByStep: true,
  includeDayApply: false
};

// 候補の Key は、`WPC-00001234_固定_...` のような生値を `_` で区切った先頭。区切りが無ければ生値全体
function workPatternFromText(text: string): WorkPattern {
  return { id: text.split('_')[0] || text, text };
}

function workPatternById(patterns: WorkPattern[], patternId: string | null) {
  if (!patternId) return null;
  return patterns.find((pattern) => pattern.id === patternId) || null;
}

function workPatternTextById(patterns: WorkPattern[], patternId: string | null) {
  return workPatternById(patterns, patternId)?.text || '';
}

function workPatternsFromTexts(texts: string[]) {
  const patterns: WorkPattern[] = [];
  const seenIds = new Set<string>();
  for (const text of texts) {
    const trimmed = String(text || '').trim();
    if (!trimmed) continue;
    const pattern = workPatternFromText(trimmed);
    if (!pattern.id || seenIds.has(pattern.id)) continue;
    seenIds.add(pattern.id);
    patterns.push(pattern);
  }
  return patterns;
}

const WORK_LOCATION_OPTIONS = [
  '出社',
  '在宅：客先業務',
  '在宅：社内業務のみ',
  'その他'
];

type TemplateItemSlot =
  | { kind: 'favorite'; fieldName: string; optionsFieldId: string }
  | { kind: 'dropdown'; index: number; fieldName: string; optionsFieldId: string };

// 画面上のジョブは変更不可の表示であり、テンプレートにも自動入力にも含めない。
const TEMPLATE_ITEM_SLOTS: readonly TemplateItemSlot[] = [
  { kind: 'favorite', fieldName: '製品分野', optionsFieldId: 'templateProductField' },
  { kind: 'favorite', fieldName: '業務区分', optionsFieldId: 'templateWorkCategory' },
  { kind: 'favorite', fieldName: '業務種別_技術要素１', optionsFieldId: 'templateTechElement1' },
  { kind: 'favorite', fieldName: '業務種別_技術要素２', optionsFieldId: 'templateTechElement2' },
  { kind: 'favorite', fieldName: '業務種別_技術要素3', optionsFieldId: 'templateTechElement3' },
  { kind: 'dropdown', index: 0, fieldName: '知識', optionsFieldId: 'templateKnowledge' },
  { kind: 'dropdown', index: 1, fieldName: '技能', optionsFieldId: 'templateSkill' },
  { kind: 'favorite', fieldName: 'アウトプット名称', optionsFieldId: 'templateOutputName' }
];

const WORK_HOUR_GRADE_OPTIONS = ['S', 'A', 'B', 'C', 'D', 'Z'];

function workHourGradeOrEmpty(value: unknown) {
  const trimmed = String(value || '').trim();
  if (WORK_HOUR_GRADE_OPTIONS.includes(trimmed)) return trimmed;
  return '';
}

function digitsTime(value: unknown) {
  return String(value || '').replace(/\D/g, '');
}

function minutesFromDigitsTime(value: unknown) {
  const digits = digitsTime(value);
  if (!digits) return 0;
  const asNumber = Number(digits);
  const hours = Math.floor(asNumber / 100);
  const minutes = asNumber % 100;
  return hours * 60 + minutes;
}

function digitsTimeFromMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return String(hours * 100 + minutes);
}

function workTimeFromAttendance(clockIn: unknown, clockOut: unknown, breakTime: unknown) {
  const workedMinutes = minutesFromDigitsTime(clockOut)
    - minutesFromDigitsTime(clockIn)
    - minutesFromDigitsTime(breakTime);
  return digitsTimeFromMinutes(workedMinutes);
}

function templateLabel(template?: Partial<FillTemplate> | null) {
  return String(template?.name || '').trim() || String(template?.workContent || '').trim();
}

function templateSlotValue(template: Partial<FillTemplate> | null | undefined, slotIndex: number) {
  const slot = TEMPLATE_ITEM_SLOTS[slotIndex];
  const item = template && template.items && template.items[slotIndex];
  if (!slot || !item || item.kind !== slot.kind) return '';
  return item.value || '';
}

function templateFromItemValues(workContent: string, values: string[]): FillTemplate {
  const items: FillTemplateItem[] = TEMPLATE_ITEM_SLOTS.map((slot, index) => {
    const value = values[index] || '';
    if (slot.kind === 'dropdown') {
      return { kind: 'dropdown', index: slot.index, value: workHourGradeOrEmpty(value) };
    }
    return { kind: 'favorite', value };
  });
  return { name: '', workContent, items };
}

function validateTemplateRequiredFields(template?: Partial<FillTemplate> | null) {
  const workContentMissing = !String(template?.workContent || '').trim();
  const itemValueMissing = TEMPLATE_ITEM_SLOTS.some((_, slotIndex) => !String(templateSlotValue(template, slotIndex)).trim());
  if (workContentMissing || itemValueMissing) {
    return '名前以外の工数テンプレート項目はすべて入力してください。';
  }
  return '';
}

function hasDuplicateDisplayName(templates: FillTemplate[]) {
  const labels = templates.map(templateLabel);
  return new Set(labels).size !== labels.length;
}

function validateTemplates(templates: unknown) {
  if (!Array.isArray(templates)) {
    return '工数テンプレートの形式が正しくありません。';
  }
  for (const template of templates) {
    const requiredFieldsError = validateTemplateRequiredFields(template);
    if (requiredFieldsError) return requiredFieldsError;
  }
  if (hasDuplicateDisplayName(templates)) {
    return '工数テンプレートの表示名が重複しています。';
  }
  return '';
}

function templatePreviewRows(template?: Partial<FillTemplate> | null) {
  return [
    { label: '業務内容', value: template?.workContent || '' },
    ...TEMPLATE_ITEM_SLOTS.map((slot, slotIndex) => ({
      label: slot.fieldName,
      value: templateSlotValue(template, slotIndex)
    }))
  ];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function defaultsFromRaw(raw: unknown): FillDefaults | null {
  if (!isPlainRecord(raw)) return null;
  const defaults: FillDefaults = { ...SEED_DEFAULTS };
  if (typeof raw.workPatternId === 'string' && raw.workPatternId !== '') {
    defaults.workPatternId = raw.workPatternId;
  }
  for (const fieldName of ['clockIn', 'clockOut', 'breakTime', 'workLocation'] as const) {
    const value = raw[fieldName];
    if (typeof value === 'string') defaults[fieldName] = value;
  }
  for (const fieldName of ['stepByStep', 'includeDayApply'] as const) {
    if (typeof raw[fieldName] === 'boolean') defaults[fieldName] = raw[fieldName];
  }
  return defaults;
}

function workPatternsFromRaw(raw: unknown): WorkPattern[] | null {
  if (!Array.isArray(raw)) return null;
  return workPatternsFromTexts(raw.flatMap((entry) =>
    isPlainRecord(entry) && typeof entry.text === 'string' ? [entry.text] : []
  ));
}

function templateItemFromRaw(raw: unknown): FillTemplateItem | null {
  if (!isPlainRecord(raw)) return null;
  if (raw.kind === 'favorite') {
    if (typeof raw.value !== 'string') return null;
    return { kind: 'favorite', value: raw.value };
  }
  if (raw.kind === 'dropdown') {
    if (typeof raw.index !== 'number' || !Number.isInteger(raw.index) || typeof raw.value !== 'string') {
      return null;
    }
    return { kind: 'dropdown', index: raw.index, value: raw.value };
  }
  return null;
}

function templateFromRaw(raw: unknown): FillTemplate | null {
  if (!isPlainRecord(raw)) return null;
  if (typeof raw.name !== 'string' || typeof raw.workContent !== 'string' || !Array.isArray(raw.items)) {
    return null;
  }
  const items = raw.items.map(templateItemFromRaw);
  if (!items.every((item): item is FillTemplateItem => item !== null)) return null;
  return { name: raw.name, workContent: raw.workContent, items };
}

function templatesFromRaw(raw: unknown): FillTemplate[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map(templateFromRaw).filter((template): template is FillTemplate => template !== null);
}

async function loadFillSettings() {
  const data = await browser.storage.local.get([DEFAULTS_KEY, TEMPLATES_KEY, WORK_PATTERNS_KEY]);
  return {
    defaults: defaultsFromRaw(data[DEFAULTS_KEY]) || { ...SEED_DEFAULTS },
    templates: templatesFromRaw(data[TEMPLATES_KEY]) || [],
    workPatterns: workPatternsFromRaw(data[WORK_PATTERNS_KEY]) || []
  };
}

async function saveFillSettings(
  defaults: FillDefaults,
  templates: FillTemplate[],
  workPatterns: WorkPattern[]
) {
  await browser.storage.local.set({
    [DEFAULTS_KEY]: {
      ...defaults,
      workPatternId: workPatternById(workPatterns, defaults.workPatternId)?.id ?? null
    },
    [TEMPLATES_KEY]: templates,
    [WORK_PATTERNS_KEY]: workPatterns
  });
}

async function saveWorkPatterns(workPatterns: WorkPattern[]) {
  const { defaults, templates } = await loadFillSettings();
  await saveFillSettings(defaults, templates, workPatterns);
}

async function appendFillTemplate(template: FillTemplate) {
  const { defaults, templates, workPatterns } = await loadFillSettings();
  const named = { ...template, items: template.items.map((item) => ({ ...item })) };
  const takenLabels = new Set(templates.map(templateLabel));
  const label = templateLabel(named);
  if (label && takenLabels.has(label)) {
    let serial = 1;
    while (takenLabels.has(`${label} (${serial})`)) serial += 1;
    named.name = `${label} (${serial})`;
  }
  await saveFillSettings(defaults, templates.concat([named]), workPatterns);
  return named;
}

function parseNonNegativeMs(value: unknown) {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^(0|[1-9]\d*)$/.test(trimmed)) return Number(trimmed);
  }
  return null;
}

function waitSettingsFromRaw(raw: Record<string, unknown>): FillWaitSettings {
  return Object.fromEntries(FILL_WAIT_FIELD_NAMES.map((fieldName) => {
    const field = FILL_WAIT_FIELDS[fieldName];
    return [fieldName, parseNonNegativeMs(raw[field.storageKey]) ?? field.defaultValue];
  })) as FillWaitSettings;
}

function waitSettingsToStorage(settings: FillWaitSettings): Record<string, number> {
  return Object.fromEntries(FILL_WAIT_FIELD_NAMES.map((fieldName) =>
    [FILL_WAIT_FIELDS[fieldName].storageKey, settings[fieldName]]
  ));
}

async function loadWaitSettings() {
  const storageKeys = FILL_WAIT_FIELD_NAMES.map((fieldName) => FILL_WAIT_FIELDS[fieldName].storageKey);
  return waitSettingsFromRaw(await browser.storage.local.get(storageKeys));
}

async function saveWaitSettings(settings: FillWaitSettings) {
  await browser.storage.local.set(waitSettingsToStorage(settings));
}

function saveFillLogs(logs: unknown[]) {
  void browser.storage.local.set({ [FILL_LOGS_KEY]: logs.slice(-FILL_LOGS_MAX) }).catch(() => {});
}

function settingsFileRecord(
  defaults: FillDefaults,
  templates: FillTemplate[],
  workPatterns: WorkPattern[],
  waitSettings: FillWaitSettings
) {
  return {
    [DEFAULTS_KEY]: defaults,
    [TEMPLATES_KEY]: templates,
    [WORK_PATTERNS_KEY]: workPatterns,
    ...waitSettingsToStorage(waitSettings)
  };
}

// ファイルに無い・不正な項目は null。
function settingsFromFile(data: unknown) {
  const record: Record<string, unknown> = isPlainRecord(data) ? data : {};
  const fileHasWaitKey = FILL_WAIT_FIELD_NAMES.some((fieldName) =>
    Object.hasOwn(record, FILL_WAIT_FIELDS[fieldName].storageKey)
  );
  return {
    defaults: defaultsFromRaw(record[DEFAULTS_KEY]),
    templates: templatesFromRaw(record[TEMPLATES_KEY]),
    workPatterns: workPatternsFromRaw(record[WORK_PATTERNS_KEY]),
    waitSettings: fileHasWaitKey ? waitSettingsFromRaw(record) : null
  };
}

export type {
  FillDefaults,
  FillTemplate,
  FillTemplateItem,
  FillWaitSettings,
  WorkPattern
};

export {
  SEED_DEFAULTS,
  WORK_LOCATION_OPTIONS,
  WORK_HOUR_GRADE_OPTIONS,
  workPatternById,
  workPatternsFromTexts,
  workPatternTextById,
  workHourGradeOrEmpty,
  digitsTime,
  templateLabel,
  templateFromItemValues,
  templateSlotValue,
  validateTemplateRequiredFields,
  validateTemplates,
  loadFillSettings,
  saveFillSettings,
  appendFillTemplate,
  saveWorkPatterns,
  FILL_WAIT_FIELD_NAMES,
  parseNonNegativeMs,
  loadWaitSettings,
  saveWaitSettings,
  saveFillLogs,
  settingsFileRecord,
  settingsFromFile,
  TEMPLATE_ITEM_SLOTS,
  workTimeFromAttendance,
  templatePreviewRows
};
