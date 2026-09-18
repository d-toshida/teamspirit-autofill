// 手動ステップの実行。
// 連続実行では全手動ステップを、ステップ実行では「次のステップ」1回分を進める。

import { loadWaitSettings } from './fill-config.js';
import {
  describeFailureProbe,
  describeTimesheetReturnWait,
  isOnScreenWorkPatternSame,
  waitMs,
  waitUntilReady,
  waitUntilReturnedToTimesheet
} from './fill-screen.js';
import {
  type FillAutoStep,
  type FillManualGroup,
  type FillStepSession
} from './fill-steps.js';

export type FillPhase = 'idle' | 'form' | 'overwrite' | 'steps';

export type ChoiceMatchSnapshot = {
  tag: string;
  role: string;
  displayed: boolean;
  timesheetTrigger: boolean;
  inOpenList: boolean;
  text: string;
};

export type OverlaySnapshot = {
  title: string;
  buttons: string[];
  choices: string[];
};

export type OpenMenuSnapshot = {
  tag: string;
  className: string;
  items: string[];
};

export type OptionsSnapshot = {
  total: number;
  visible: number;
  texts: string[];
};

export type ComboboxSnapshot = {
  ariaLabel: string;
  text: string;
  value: string;
  expanded: boolean;
};

export type UiState = {
  pathname: string;
  isIframe: boolean;
  focused: string;
  overlayCount: number;
  overlays: OverlaySnapshot[];
  openMenus: OpenMenuSnapshot[];
  options: OptionsSnapshot;
  selects: string[];
  comboboxes: ComboboxSnapshot[];
  timeInputs: string[];
  targetText: string;
  matchCount: number;
  visibleMatchCount: number;
  matches: ChoiceMatchSnapshot[];
};

export type FillLogEntry = {
  at: number;
  rowHeader: string;
  step: number;
  total: number;
  label: string;
  targetText: string;
  ok: boolean;
  skipped?: boolean;
  skipReason?: string;
  error: string;
  errorMessage: string;
  probe?: string;
  before: UiState;
  after: UiState;
};

export type FillSession = FillStepSession & {
  phase: FillPhase;
  stepByStep: boolean;
  steps: FillAutoStep[];
  manualGroups: FillManualGroup[];
  stepIndex: number;
  stepRunning: boolean;
  stepRunGeneration: number;
  logs: FillLogEntry[];
};

function idleFillSession(stepRunGeneration: number): FillSession {
  return {
    phase: 'idle',
    stepByStep: false,
    rowHeader: '',
    workPattern: '',
    clockIn: '',
    clockOut: '',
    breakTime: '',
    workLocation: '',
    workContent: '',
    template: null,
    includeDayApply: false,
    lastProbe: '',
    steps: [],
    manualGroups: [],
    stepIndex: 0,
    stepRunning: false,
    stepRunGeneration,
    logs: []
  };
}

export type FillRunUi = {
  captureUiState: (targetText?: string) => UiState;
  appendFillLog: (entry: FillLogEntry) => void;
  persistFillLogs: () => void;
  setPanelStatus: (text: string, isError: boolean) => void;
  setStepActionButtonsDisabled: (disabled: boolean) => void;
  showFillEnded: (statusText: string, isError: boolean) => void;
  notify: (message: string) => void;
  cancelFill: () => void;
};

export const fillSession: FillSession = idleFillSession(0);

export function currentManualGroup() {
  const autoIndex = fillSession.stepIndex;
  return fillSession.manualGroups.find((group) =>
    autoIndex >= group.autoStart && autoIndex < group.autoEnd
  ) || null;
}

export function autoProgressText(group: FillManualGroup) {
  const autoTotal = fillSession.steps.length;
  const autoStartDisplay = fillSession.stepIndex + 1;
  const autoEndDisplay = group.autoEnd;
  if (autoStartDisplay === autoEndDisplay) return `${autoStartDisplay} / ${autoTotal}`;
  return `${autoStartDisplay}–${autoEndDisplay} / ${autoTotal}`;
}

export function clearFillSession() {
  Object.assign(fillSession, idleFillSession(fillSession.stepRunGeneration + 1));
}

export function currentStepStatusText() {
  const autoTotal = fillSession.steps.length;
  if (fillSession.stepIndex >= autoTotal) return 'この行の入力が完了しました。';
  const group = currentManualGroup();
  if (!group) return 'この行の入力が完了しました。';
  const manualIndex = fillSession.manualGroups.indexOf(group);
  return `手動 ${manualIndex + 1} / ${fillSession.manualGroups.length}　自動 ${autoProgressText(group)}　次: ${group.manualLabel}`;
}

function finishFillIfComplete(ui: FillRunUi) {
  if (fillSession.stepIndex < fillSession.steps.length) {
    ui.setPanelStatus(currentStepStatusText(), false);
    return false;
  }
  ui.notify('この行の入力が完了しました');
  ui.persistFillLogs();
  if (!fillSession.stepByStep) {
    ui.cancelFill();
    return true;
  }
  ui.showFillEnded('この行の入力が完了しました。ログをコピーできます', false);
  return true;
}

function skipAutoStepsUntil(autoEndExclusive: number, reason: string, ui: FillRunUi) {
  if (fillSession.stepIndex >= fillSession.steps.length) {
    finishFillIfComplete(ui);
    return;
  }
  while (fillSession.stepIndex < autoEndExclusive && fillSession.stepIndex < fillSession.steps.length) {
    const step = fillSession.steps[fillSession.stepIndex]!;
    const snapshot = ui.captureUiState(step.targetText);
    ui.appendFillLog({
      at: Date.now(),
      rowHeader: fillSession.rowHeader,
      step: fillSession.stepIndex + 1,
      total: fillSession.steps.length,
      label: step.label,
      targetText: step.targetText || '',
      ok: true,
      skipped: true,
      skipReason: reason,
      error: '',
      errorMessage: '',
      before: snapshot,
      after: snapshot
    });
    fillSession.stepIndex += 1;
  }
  finishFillIfComplete(ui);
}

export function skipCurrentFillStep(reason: string, ui: FillRunUi) {
  const group = currentManualGroup();
  const autoEndExclusive = group ? group.autoEnd : fillSession.stepIndex + 1;
  skipAutoStepsUntil(autoEndExclusive, reason, ui);
}

function isRunCancelled(runGeneration: number) {
  return fillSession.phase !== 'steps' || fillSession.stepRunGeneration !== runGeneration;
}

async function runCurrentAutoStep(
  loadWaitIntervalMs: number,
  loadWaitTimeoutMs: number,
  runGeneration: number,
  ui: FillRunUi
) {
  if (fillSession.stepIndex >= fillSession.steps.length) {
    finishFillIfComplete(ui);
    return 'complete';
  }
  const step = fillSession.steps[fillSession.stepIndex]!;
  const finishIfLoadWaitEnded = (
    waitResult: 'cancelled' | 'ok' | 'timeout',
    probeSuffix: string
  ) => {
    if (waitResult === 'ok') return null;
    if (waitResult === 'cancelled') return 'cancelled';
    fillSession.lastProbe = [
      `loadWait: timeout intervalMs=${loadWaitIntervalMs} timeoutMs=${loadWaitTimeoutMs}${probeSuffix}`,
      fillSession.lastProbe
    ].filter(Boolean).join('\n');
    const snapshot = ui.captureUiState(step.targetText);
    return completeAutoStep(step, false, 'ロード待ちがタイムアウトしました', snapshot, snapshot, ui);
  };
  const previous = fillSession.stepIndex > 0 ? fillSession.steps[fillSession.stepIndex - 1] : null;
  if (previous?.returnsToTimesheet) {
    const waitEnded = finishIfLoadWaitEnded(
      await waitUntilReturnedToTimesheet(
        loadWaitIntervalMs,
        loadWaitTimeoutMs,
        !fillSession.stepByStep,
        () => isRunCancelled(runGeneration)
      ),
      ` returnsToTimesheet ${describeTimesheetReturnWait()}`
    );
    if (waitEnded) return waitEnded;
  }
  if (typeof step.targetIsDisplayed === 'function') {
    const waitEnded = finishIfLoadWaitEnded(
      await waitUntilReady(
        step.targetIsDisplayed,
        loadWaitIntervalMs,
        loadWaitTimeoutMs,
        () => isRunCancelled(runGeneration)
      ),
      ''
    );
    if (waitEnded) return waitEnded;
  }
  // 省略したあとも同じ手動ステップの残り自動ステップは連続実行する。
  if (step.skipWhen === 'workPatternSame' && isOnScreenWorkPatternSame(fillSession.workPattern)) {
    skipAutoStepsUntil(fillSession.stepIndex + 1, '確認値と同じため、勤務パターンは開きません', ui);
    return 'skipped';
  }
  const before = ui.captureUiState(step.targetText);
  fillSession.lastProbe = '';
  let ok = false;
  let error = '';
  try {
    ok = !!(await step.run());
  } catch (caught) {
    ok = false;
    const caughtMessage = (caught as { message?: string } | null | undefined)?.message;
    error = caught && caughtMessage ? caughtMessage : String(caught);
  }
  const after = ui.captureUiState(step.targetText);
  return completeAutoStep(step, ok, error, before, after, ui);
}

function completeAutoStep(
  step: FillAutoStep,
  ok: boolean,
  error: string,
  before: UiState,
  after: UiState,
  ui: FillRunUi
) {
  const errorMessage = !ok
    ? (error ? `失敗: ${step.label}（${error}）` : (step.failMessage || `要素が見つかりません: ${step.label}`))
    : '';
  const probe = !ok
    ? [fillSession.lastProbe, describeFailureProbe(step.targetText)].filter(Boolean).join('\n')
    : fillSession.lastProbe;
  ui.appendFillLog({
    at: Date.now(),
    rowHeader: fillSession.rowHeader,
    step: fillSession.stepIndex + 1,
    total: fillSession.steps.length,
    label: step.label,
    targetText: step.targetText || '',
    ok,
    error,
    errorMessage,
    probe,
    before,
    after
  });
  if (!ok) {
    ui.notify(errorMessage);
    ui.showFillEnded(errorMessage, true);
    return 'failed';
  }
  fillSession.stepIndex += 1;
  finishFillIfComplete(ui);
  return 'ok';
}

export async function runCurrentFillStep(ui: FillRunUi) {
  if (fillSession.stepRunning) return;
  if (fillSession.stepIndex >= fillSession.steps.length) {
    finishFillIfComplete(ui);
    return;
  }
  const group = currentManualGroup();
  if (!group) {
    ui.notify('この行の入力が完了しました');
    ui.cancelFill();
    return;
  }
  fillSession.stepRunning = true;
  const runGeneration = fillSession.stepRunGeneration;
  const autoEndExclusive = fillSession.stepByStep ? group.autoEnd : fillSession.steps.length;
  ui.setStepActionButtonsDisabled(true);
  let autoStepFailed = false;
  try {
    const { autoStepDelayMs, loadWaitIntervalMs, loadWaitTimeoutMs } = await loadWaitSettings();
    let ranAutoStepInThisClick = false;
    while (!isRunCancelled(runGeneration) && fillSession.stepIndex < autoEndExclusive) {
      if (ranAutoStepInThisClick) {
        const groupForNextAuto = currentManualGroup();
        const nextAutoIsFirstOfManualGroup =
          !!groupForNextAuto && fillSession.stepIndex === groupForNextAuto.autoStart;
        if (!nextAutoIsFirstOfManualGroup) {
          await waitMs(autoStepDelayMs);
          if (isRunCancelled(runGeneration)) return;
        }
      }
      const result = await runCurrentAutoStep(loadWaitIntervalMs, loadWaitTimeoutMs, runGeneration, ui);
      ranAutoStepInThisClick = true;
      if (result === 'failed') {
        autoStepFailed = true;
        return;
      }
      if (result !== 'ok' && result !== 'skipped') return;
    }
  } finally {
    fillSession.stepRunning = false;
    if (
      fillSession.phase === 'steps'
      && fillSession.stepIndex < fillSession.steps.length
      && !autoStepFailed
    ) {
      ui.setStepActionButtonsDisabled(false);
    }
  }
}
