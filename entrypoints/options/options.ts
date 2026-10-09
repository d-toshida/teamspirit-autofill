// options.ts - 既定値・工数テンプレートと、設定の共有

import {
  FILL_WAIT_FIELD_NAMES,
  TEMPLATE_ITEM_SLOTS,
  digitsTime,
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
  type FillWaitSettings,
  type WorkPattern
} from '../../lib/fill-config.js';
import {
  populateTemplateSelect,
  populateWorkHourGradeSelect,
  populateWorkLocationSelect,
  populateWorkPatternSelect
} from '../../lib/fill-selects.js';
const fileInput = document.getElementById('fileInput') as HTMLInputElement;
const fillSaveStatus = document.getElementById('fillSaveStatus') as HTMLElement;
const templateListEl = document.getElementById('templateList') as HTMLSelectElement;
const templateDeleteEl = document.getElementById('templateDelete') as HTMLButtonElement;
const workPatternDefaultEl = document.getElementById('workPatternDefault') as HTMLSelectElement;

// 待ち時間の入力欄 id は FillWaitSettings のキー名と同じ。
const WAIT_FIELD_ERROR_MESSAGES: Record<keyof FillWaitSettings, string> = {
  autoStepDelayMs: '自動ステップ間の待ちは0以上の整数（ミリ秒）で入力してください。',
  loadWaitIntervalMs: 'ロード待ちの間隔は0以上の整数（ミリ秒）で入力してください。',
  loadWaitTimeoutMs: 'ロード待ちのタイムアウトは0以上の整数（ミリ秒）で入力してください。'
};

let loadedTemplates: FillTemplate[] = [];
let selectedTemplateIndex = 0;
let loadedWorkPatterns: WorkPattern[] = [];

function inputEl(id: string) {
  return document.getElementById(id) as HTMLInputElement;
}

function selectEl(id: string) {
  return document.getElementById(id) as HTMLSelectElement;
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
  inputEl('templateName').placeholder = inputEl('templateWorkContent').value.trim();
}

function populateTemplateForm(template: FillTemplate | undefined) {
  inputEl('templateName').value = template?.name || '';
  inputEl('templateWorkContent').value = template?.workContent || '';
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

function populateDefaultsForm(defaults: FillDefaults) {
  inputEl('clockIn').value = defaults.clockIn;
  inputEl('clockOut').value = defaults.clockOut;
  inputEl('breakTime').value = defaults.breakTime;
  populateWorkLocationSelect(selectEl('workLocation'), defaults.workLocation);
  inputEl('stepByStep').checked = defaults.stepByStep;
  inputEl('includeDayApply').checked = defaults.includeDayApply;
}

function commitSelectedTemplateFromForm() {
  if (!loadedTemplates.length) return;
  loadedTemplates[selectedTemplateIndex] = templateFromForm();
}

function renderTemplateList() {
  populateTemplateSelect(templateListEl, loadedTemplates);
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
  loadedWorkPatterns = workPatterns;
  populateWorkPatternSelect(workPatternDefaultEl, workPatterns, defaults.workPatternId);
  loadedTemplates = templates;
  selectedTemplateIndex = 0;
  showSelectedTemplate();
}

async function loadOtherSettingsForm() {
  const waitSettings = await loadWaitSettings();
  for (const fieldName of FILL_WAIT_FIELD_NAMES) {
    inputEl(fieldName).value = String(waitSettings[fieldName]);
  }
}

document.getElementById('saveFill')!.addEventListener('click', async () => {
  commitSelectedTemplateFromForm();
  renderTemplateList();
  const validationError = validateTemplates(loadedTemplates);
  if (validationError) {
    fillSaveStatus.textContent = validationError;
    return;
  }
  const waitSettings = {} as FillWaitSettings;
  for (const fieldName of FILL_WAIT_FIELD_NAMES) {
    const parsedMs = parseNonNegativeMs(inputEl(fieldName).value);
    if (parsedMs === null) {
      fillSaveStatus.textContent = WAIT_FIELD_ERROR_MESSAGES[fieldName];
      return;
    }
    waitSettings[fieldName] = parsedMs;
  }
  await saveFillSettings(defaultsFromForm(), loadedTemplates, loadedWorkPatterns);
  await saveWaitSettings(waitSettings);
  await loadOtherSettingsForm();
  fillSaveStatus.textContent = '設定を保存しました。';
});

templateDeleteEl.addEventListener('click', () => {
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
      const imported = settingsFromFile(JSON.parse(String(reader.result)));
      if (!imported.defaults && !imported.templates && !imported.workPatterns && !imported.waitSettings) {
        alert('ファイルの形式が正しくありません。');
        return;
      }
      const validationError = imported.templates ? validateTemplates(imported.templates) : '';
      if (validationError) {
        alert(validationError);
        return;
      }
      if (imported.defaults || imported.templates || imported.workPatterns) {
        const current = await loadFillSettings();
        await saveFillSettings(
          imported.defaults || current.defaults,
          imported.templates || current.templates,
          imported.workPatterns || current.workPatterns
        );
      }
      if (imported.waitSettings) {
        await saveWaitSettings(imported.waitSettings);
      }
      await loadFillForms();
      await loadOtherSettingsForm();
      alert('インポートして保存しました。');
    } catch (e) {
      alert('ファイルの形式が正しくありません：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      fileInput.value = '';
    }
  };
  reader.readAsText(file);
});

for (const id of ['templateName', 'templateWorkContent']) {
  inputEl(id).addEventListener('input', () => {
    syncTemplateNamePlaceholder();
    commitSelectedTemplateFromForm();
    renderTemplateList();
  });
}

void loadFillForms();
void loadOtherSettingsForm();
