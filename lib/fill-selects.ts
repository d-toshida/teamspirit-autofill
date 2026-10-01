// 設定画面と確認画面の select を候補で埋める。

import {
  WORK_HOUR_GRADE_OPTIONS,
  WORK_LOCATION_OPTIONS,
  workHourGradeOrEmpty,
  workPatternById,
  type WorkPattern
} from './fill-config.js';

function appendOption(selectEl: HTMLSelectElement, value: string, text: string) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = text;
  selectEl.appendChild(option);
  return option;
}

// 「選択してください」は既定が未選択のときだけ出す。この項目は選べず、未選択へ戻す操作は無い。
export function populateWorkPatternSelect(
  selectEl: HTMLSelectElement,
  patterns: WorkPattern[],
  selectedId: string | null
) {
  selectEl.replaceChildren();
  const selected = workPatternById(patterns, selectedId);
  if (!selected) {
    const unselected = appendOption(selectEl, '', '選択してください');
    unselected.disabled = true;
    unselected.hidden = true;
  }
  for (const pattern of patterns) {
    appendOption(selectEl, pattern.id, pattern.text);
  }
  selectEl.value = selected ? selected.id : '';
}

export function populateWorkLocationSelect(selectEl: HTMLSelectElement, selectedValue: string) {
  selectEl.replaceChildren();
  for (const location of WORK_LOCATION_OPTIONS) {
    appendOption(selectEl, location, location);
  }
  selectEl.value = selectedValue;
}

export function populateWorkHourGradeSelect(selectEl: HTMLSelectElement, selectedValue: unknown) {
  selectEl.replaceChildren();
  appendOption(selectEl, '', '選択してください');
  for (const grade of WORK_HOUR_GRADE_OPTIONS) {
    appendOption(selectEl, grade, grade);
  }
  selectEl.value = workHourGradeOrEmpty(selectedValue);
}
