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
  autoStepDelayMs: { storageKey: 'auto_step_delay_ms', defaultValue: 100 },
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

function workPatternFromText(text: string): WorkPattern {
  return { id: text.split('_')[0] || text, text };
}

function workPatternById(patterns: WorkPattern[], patternId: string | null) {
  if (!patternId) return null;
  for (const pattern of patterns) {
    if (pattern.id === patternId) return pattern;
  }
  return null;
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
  const name = String((template && template.name) || '').trim();
  if (name) return name;
  return String((template && template.workContent) || '').trim();
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
  const workContentMissing = !String((template && template.workContent) || '').trim();
  const itemValueMissing = TEMPLATE_ITEM_SLOTS.some((_, slotIndex) => !String(templateSlotValue(template, slotIndex)).trim());
  if (workContentMissing || itemValueMissing) {
    return '名前以外の工数テンプレート項目はすべて入力してください。';
  }
  return '';
}

function duplicateDisplayNames(templates: FillTemplate[]) {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const template of templates) {
    const label = templateLabel(template);
    if (seen.has(label)) {
      if (!duplicates.includes(label)) duplicates.push(label);
    } else {
      seen.add(label);
    }
  }
  return duplicates;
}

function validateTemplates(templates: unknown) {
  if (!Array.isArray(templates)) {
    return '工数テンプレートの形式が正しくありません。';
  }
  for (const template of templates) {
    const requiredFieldsError = validateTemplateRequiredFields(template);
    if (requiredFieldsError) return requiredFieldsError;
  }
  if (duplicateDisplayNames(templates).length) {
    return '工数テンプレートの表示名が重複しています。';
  }
  return '';
}

function templatePreviewRows(template?: Partial<FillTemplate> | null) {
  const source = template || {};
  const rows = [{ label: '業務内容', value: source.workContent || '' }];
  TEMPLATE_ITEM_SLOTS.forEach((slot, slotIndex) => {
    rows.push({
      label: slot.fieldName,
      value: templateSlotValue(source, slotIndex)
    });
  });
  return rows;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function defaultsFromRaw(raw: unknown): FillDefaults | null {
  if (!isPlainRecord(raw)) return null;
  const defaults: FillDefaults = {
    workPatternId: null,
    clockIn: SEED_DEFAULTS.clockIn,
    clockOut: SEED_DEFAULTS.clockOut,
    breakTime: SEED_DEFAULTS.breakTime,
    workLocation: SEED_DEFAULTS.workLocation,
    stepByStep: SEED_DEFAULTS.stepByStep,
    includeDayApply: SEED_DEFAULTS.includeDayApply
  };
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
  const texts: string[] = [];
  for (const entry of raw) {
    if (isPlainRecord(entry) && typeof entry.text === 'string') texts.push(entry.text);
  }
  return workPatternsFromTexts(texts);
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
  const items: FillTemplateItem[] = [];
  for (const item of raw.items) {
    const parsed = templateItemFromRaw(item);
    if (!parsed) return null;
    items.push(parsed);
  }
  return { name: raw.name, workContent: raw.workContent, items };
}

function templatesFromRaw(raw: unknown): FillTemplate[] | null {
  if (!Array.isArray(raw)) return null;
  const templates: FillTemplate[] = [];
  for (const entry of raw) {
    const parsed = templateFromRaw(entry);
    if (parsed) templates.push(parsed);
  }
  return templates;
}

async function loadFillSettings(): Promise<{
  defaults: FillDefaults;
  templates: FillTemplate[];
  workPatterns: WorkPattern[];
}> {
  const data = await browser.storage.local.get([DEFAULTS_KEY, TEMPLATES_KEY, WORK_PATTERNS_KEY]);
  const parsedDefaults = defaultsFromRaw(data[DEFAULTS_KEY]);
  const parsedTemplates = templatesFromRaw(data[TEMPLATES_KEY]);
  const parsedWorkPatterns = workPatternsFromRaw(data[WORK_PATTERNS_KEY]);
  const defaults = parsedDefaults || Object.assign({}, SEED_DEFAULTS);
  const templates = parsedTemplates || [];
  const workPatterns = parsedWorkPatterns || [];
  return { defaults, templates, workPatterns };
}

async function saveFillSettings(
  defaults: FillDefaults,
  templates: FillTemplate[],
  workPatterns: WorkPattern[]
) {
  const nextDefaults = Object.assign({}, defaults);
  nextDefaults.workPatternId = workPatternById(workPatterns, defaults.workPatternId)?.id ?? null;
  await browser.storage.local.set({
    [DEFAULTS_KEY]: nextDefaults,
    [TEMPLATES_KEY]: templates,
    [WORK_PATTERNS_KEY]: workPatterns
  });
}

async function saveWorkPatterns(workPatterns: WorkPattern[]) {
  const data = await browser.storage.local.get([DEFAULTS_KEY, TEMPLATES_KEY]);
  const defaults = defaultsFromRaw(data[DEFAULTS_KEY]) || Object.assign({}, SEED_DEFAULTS);
  const templates = templatesFromRaw(data[TEMPLATES_KEY]) || [];
  await saveFillSettings(defaults, templates, workPatterns);
}

async function appendFillTemplate(template: FillTemplate) {
  const { defaults, templates, workPatterns } = await loadFillSettings();
  const named = {
    name: template.name,
    workContent: template.workContent,
    items: template.items.map((item) => Object.assign({}, item))
  };
  const existingLabels = templates.map(templateLabel);
  const label = templateLabel(named);
  if (label && existingLabels.includes(label)) {
    const takenLabels = new Set(existingLabels);
    let serial = 1;
    while (true) {
      const uniqueName = `${label} (${serial})`.trim();
      if (!takenLabels.has(uniqueName)) {
        named.name = uniqueName;
        break;
      }
      serial += 1;
    }
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

function waitSettingsFromRaw(raw: object): FillWaitSettings {
  const rawRecord = isPlainRecord(raw) ? raw : {};
  const settings = {} as FillWaitSettings;
  for (const fieldName of FILL_WAIT_FIELD_NAMES) {
    const field = FILL_WAIT_FIELDS[fieldName];
    const parsed = parseNonNegativeMs(rawRecord[field.storageKey]);
    settings[fieldName] = parsed ?? field.defaultValue;
  }
  return settings;
}

function waitSettingsToStorage(settings: FillWaitSettings): Record<string, number> {
  const record: Record<string, number> = {};
  for (const fieldName of FILL_WAIT_FIELD_NAMES) {
    record[FILL_WAIT_FIELDS[fieldName].storageKey] = settings[fieldName];
  }
  return record;
}

async function loadWaitSettings(): Promise<FillWaitSettings> {
  const storageDefaults: Record<string, number> = {};
  for (const fieldName of FILL_WAIT_FIELD_NAMES) {
    const field = FILL_WAIT_FIELDS[fieldName];
    storageDefaults[field.storageKey] = field.defaultValue;
  }
  const stored = await browser.storage.local.get(storageDefaults);
  return waitSettingsFromRaw(stored);
}

async function saveWaitSettings(settings: FillWaitSettings) {
  await browser.storage.local.set(waitSettingsToStorage(settings));
}

function saveFillLogs(logs: unknown[]) {
  const payload = logs.slice(-FILL_LOGS_MAX);
  void browser.storage.local.set({ [FILL_LOGS_KEY]: payload }).then(
    () => {},
    () => {}
  );
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

function settingsFromFile(data: unknown) {
  if (!isPlainRecord(data)) {
    return {};
  }
  const imported: {
    defaults?: FillDefaults;
    templates?: FillTemplate[];
    workPatterns?: WorkPattern[];
    waitSettings?: FillWaitSettings;
  } = {};
  const parsedDefaults = defaultsFromRaw(data[DEFAULTS_KEY]);
  if (parsedDefaults) imported.defaults = parsedDefaults;
  const parsedTemplates = templatesFromRaw(data[TEMPLATES_KEY]);
  if (parsedTemplates) imported.templates = parsedTemplates;
  const parsedWorkPatterns = workPatternsFromRaw(data[WORK_PATTERNS_KEY]);
  if (parsedWorkPatterns) imported.workPatterns = parsedWorkPatterns;
  let fileHasWaitKey = false;
  for (const fieldName of FILL_WAIT_FIELD_NAMES) {
    if (Object.prototype.hasOwnProperty.call(data, FILL_WAIT_FIELDS[fieldName].storageKey)) {
      fileHasWaitKey = true;
    }
  }
  if (fileHasWaitKey) {
    imported.waitSettings = waitSettingsFromRaw(data);
  }
  return imported;
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
