// options.ts - 既定値・工数テンプレートと、設定の共有

import {
  SEED_DEFAULTS,
  TEMPLATE_ITEM_SLOTS,
  digitsTime,
  templateLabel,
  templateFromItemValues,
  templateSlotValue,
  validateTemplates,
  loadFillSettings,
  saveFillSettings,
  parseNonNegativeMs,
  loadWaitSettings,
  saveWaitSettings,
  settingsFileRecord,
  settingsFromFile,
  type FillDefaults,
  type FillTemplate,
  type WorkPattern
} from '../../lib/fill-config.js';
import {
  populateWorkHourGradeSelect,
  populateWorkLocationSelect,
  populateWorkPatternSelect
} from '../../lib/fill-selects.js';
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const fillSaveStatus = document.getElementById('fillSaveStatus') as HTMLElement;
const autoStepDelayMsEl = document.getElementById('autoStepDelayMs') as HTMLInputElement;
const loadWaitIntervalMsEl = document.getElementById('loadWaitIntervalMs') as HTMLInputElement;
const loadWaitTimeoutMsEl = document.getElementById('loadWaitTimeoutMs') as HTMLInputElement;
const templateListEl = document.getElementById('templateList') as HTMLSelectElement;
const templateDeleteEl = document.getElementById('templateDelete') as HTMLButtonElement;
const workPatternDefaultEl = document.getElementById('workPatternDefault') as HTMLSelectElement;

let loadedTemplates: FillTemplate[] = [];
let selectedTemplateIndex = 0;
let loadedWorkPatterns: WorkPattern[] = [];

function inputEl(id: string) {
  return document.getElementById(id) as HTMLInputElement;
}

function selectEl(id: string) {
  return document.getElementById(id) as HTMLSelectElement;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

const TEMPLATE_EDITOR_IDS = [
  'templateList',
  'templateName',
  'templateWorkContent',
  ...TEMPLATE_ITEM_SLOTS.map((slot) => slot.optionsFieldId)
];

function templateFromForm(): FillTemplate {
  const values = TEMPLATE_ITEM_SLOTS.map((slot) => {
    const el = document.getElementById(slot.optionsFieldId) as HTMLInputElement | HTMLSelectElement | null;
    return (el && el.value || '').trim();
  });
  const template = templateFromItemValues(inputEl('templateWorkContent').value.trim(), values);
  template.name = inputEl('templateName').value.trim();
  return template;
}

function syncTemplateNamePlaceholder() {
  const nameInput = inputEl('templateName');
  nameInput.placeholder = inputEl('templateWorkContent').value.trim();
}

function populateTemplateForm(template: FillTemplate | undefined) {
  inputEl('templateName').value = (template && template.name) || '';
  inputEl('templateWorkContent').value = (template && template.workContent) || '';
  TEMPLATE_ITEM_SLOTS.forEach((slot, slotIndex) => {
    const value = templateSlotValue(template, slotIndex);
    const el = document.getElementById(slot.optionsFieldId);
    if (el instanceof HTMLSelectElement) {
      populateWorkHourGradeSelect(el, value);
    } else {
      inputEl(slot.optionsFieldId).value = value;
    }
  });
  syncTemplateNamePlaceholder();
}

function defaultsFromForm(): FillDefaults {
  return {
    workPatternId: workPatternDefaultEl.value || null,
    clockIn: digitsTime(inputEl('clockIn').value),
    clockOut: digitsTime(inputEl('clockOut').value),
    breakTime: digitsTime(inputEl('breakTime').value),
    workLocation: selectEl('workLocation').value,
    stepByStep: inputEl('stepByStep').checked,
    includeDayApply: inputEl('includeDayApply').checked
  };
}

function populateDefaultsForm(defaults: FillDefaults | undefined) {
  const source = defaults || SEED_DEFAULTS;
  inputEl('clockIn').value = source.clockIn || '';
  inputEl('clockOut').value = source.clockOut || '';
  inputEl('breakTime').value = source.breakTime || '';
  populateWorkLocationSelect(selectEl('workLocation'), source.workLocation);
  inputEl('stepByStep').checked = source.stepByStep;
  inputEl('includeDayApply').checked = source.includeDayApply;
}

function populateWorkPatternsForm(patterns: WorkPattern[], defaultId: string | null) {
  loadedWorkPatterns = patterns.slice();
  populateWorkPatternSelect(workPatternDefaultEl, loadedWorkPatterns, defaultId);
}

function commitSelectedTemplateFromForm() {
  if (!loadedTemplates.length) return;
  loadedTemplates[selectedTemplateIndex] = templateFromForm();
}

function renderTemplateList() {
  templateListEl.innerHTML = '';
  loadedTemplates.forEach((template, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = templateLabel(template);
    templateListEl.appendChild(option);
  });
  if (selectedTemplateIndex >= loadedTemplates.length) {
    selectedTemplateIndex = Math.max(0, loadedTemplates.length - 1);
  }
  templateListEl.value = String(selectedTemplateIndex);
  const editorsEnabled = loadedTemplates.length > 0;
  for (const id of TEMPLATE_EDITOR_IDS) {
    const el = document.getElementById(id);
    if (el) (el as HTMLInputElement | HTMLSelectElement).disabled = !editorsEnabled;
  }
  templateDeleteEl.disabled = !editorsEnabled || loadedTemplates.length <= 1;
}

function showSelectedTemplate() {
  populateTemplateForm(loadedTemplates[selectedTemplateIndex]);
  renderTemplateList();
}

async function loadFillForms() {
  const { defaults, templates, workPatterns } = await loadFillSettings();
  populateDefaultsForm(defaults);
  populateWorkPatternsForm(workPatterns, defaults.workPatternId);
  loadedTemplates = templates.slice();
  selectedTemplateIndex = 0;
  showSelectedTemplate();
  return loadedTemplates;
}

async function loadOtherSettingsForm() {
  const waitSettings = await loadWaitSettings();
  autoStepDelayMsEl.value = String(waitSettings.autoStepDelayMs);
  loadWaitIntervalMsEl.value = String(waitSettings.loadWaitIntervalMs);
  loadWaitTimeoutMsEl.value = String(waitSettings.loadWaitTimeoutMs);
}

document.getElementById('saveFill')!.addEventListener('click', async () => {
  commitSelectedTemplateFromForm();
  renderTemplateList();
  const validationError = validateTemplates(loadedTemplates);
  if (validationError) {
    fillSaveStatus.textContent = validationError;
    return;
  }
  const autoStepDelayMs = parseNonNegativeMs(autoStepDelayMsEl.value);
  if (autoStepDelayMs === null) {
    fillSaveStatus.textContent = '自動ステップ間の待ちは0以上の整数（ミリ秒）で入力してください。';
    return;
  }
  const loadWaitIntervalMs = parseNonNegativeMs(loadWaitIntervalMsEl.value);
  if (loadWaitIntervalMs === null) {
    fillSaveStatus.textContent = 'ロード待ちの間隔は0以上の整数（ミリ秒）で入力してください。';
    return;
  }
  const loadWaitTimeoutMs = parseNonNegativeMs(loadWaitTimeoutMsEl.value);
  if (loadWaitTimeoutMs === null) {
    fillSaveStatus.textContent = 'ロード待ちのタイムアウトは0以上の整数（ミリ秒）で入力してください。';
    return;
  }
  const defaults = defaultsFromForm();
  const nextTemplates = loadedTemplates.slice();
  const nextWorkPatterns = loadedWorkPatterns.slice();
  await saveFillSettings(defaults, nextTemplates, nextWorkPatterns);
  await saveWaitSettings({ autoStepDelayMs, loadWaitIntervalMs, loadWaitTimeoutMs });
  loadedTemplates = nextTemplates;
  loadedWorkPatterns = nextWorkPatterns;
  await loadOtherSettingsForm();
  fillSaveStatus.textContent = '設定を保存しました。';
});

document.getElementById('templateDelete')!.addEventListener('click', () => {
  if (loadedTemplates.length <= 1) return;
  loadedTemplates.splice(selectedTemplateIndex, 1);
  if (selectedTemplateIndex >= loadedTemplates.length) {
    selectedTemplateIndex = loadedTemplates.length - 1;
  }
  showSelectedTemplate();
  fillSaveStatus.textContent = '';
});

templateListEl.addEventListener('change', () => {
  commitSelectedTemplateFromForm();
  selectedTemplateIndex = Number(templateListEl.value);
  populateTemplateForm(loadedTemplates[selectedTemplateIndex]);
  renderTemplateList();
});

document.getElementById('export')!.addEventListener('click', async () => {
  const fill = await loadFillSettings();
  const waitSettings = await loadWaitSettings();
  const payload = settingsFileRecord(
    fill.defaults,
    fill.templates,
    fill.workPatterns,
    waitSettings
  );
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'teamspirit-autofill-settings.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('import')!.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(String(reader.result));
      const imported = settingsFromFile(data);
      if (imported.templates) {
        const validationError = validateTemplates(imported.templates);
        if (validationError) {
          alert(validationError);
          fileInput.value = '';
          return;
        }
      }
      if (imported.defaults || imported.templates || imported.workPatterns) {
        const current = await loadFillSettings();
        const nextWorkPatterns = imported.workPatterns || current.workPatterns;
        await saveFillSettings(
          imported.defaults || current.defaults,
          imported.templates || current.templates,
          nextWorkPatterns
        );
      }
      if (imported.waitSettings) {
        await saveWaitSettings(imported.waitSettings);
      }
      if (!imported.defaults && !imported.templates && !imported.workPatterns && !imported.waitSettings) {
        alert('ファイルの形式が正しくありません。');
        fileInput.value = '';
        return;
      }
      await loadFillForms();
      await loadOtherSettingsForm();
      alert('インポートして保存しました。');
    } catch (e) {
      alert('ファイルの形式が正しくありません：' + errorMessage(e));
    }
    fileInput.value = '';
  };
  reader.readAsText(file);
});

inputEl('templateName').addEventListener('input', () => {
  commitSelectedTemplateFromForm();
  renderTemplateList();
});

inputEl('templateWorkContent').addEventListener('input', () => {
  syncTemplateNamePlaceholder();
  commitSelectedTemplateFromForm();
  renderTemplateList();
});

void loadFillForms();
void loadOtherSettingsForm();
