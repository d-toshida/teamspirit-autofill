// 1日分の手動ステップ表。

import {
  TEMPLATE_ITEM_SLOTS,
  templateSlotValue,
  workTimeFromAttendance,
  type FillTemplate
} from './fill-config.js';
import { activateClick } from './execute-step.js';
import {
  choiceIsDisplayed,
  clickByText,
  clickChoiceByText,
  clickChoiceEverywhere,
  clickOverlayCaption,
  clickTimeDialogSave,
  clickWorkHourLookup,
  clickWorkTimeChangeApply,
  displayedAttendanceCaption,
  displayedDayApplyButton,
  displayedFavoriteCandidate,
  findWorkPatternCombobox,
  openWorkPatternCombobox,
  runOperation,
  setWorkHourDropdown,
  setWorkHourTime,
  workHourColumnButtonIsEnabled,
  workHourFirstJobRow,
  type FillProbe
} from './fill-screen.js';

export type FillAutoStep = {
  label: string;
  targetText?: string;
  skipWhen?: string;
  failMessage?: string;
  targetIsDisplayed?: () => boolean;
  returnsToTimesheet?: boolean;
  run: () => boolean | Promise<boolean>;
};

export type FillManual = {
  label: string;
  targetText?: string;
  skipWhen?: string;
  failMessage?: string;
  targetIsDisplayed?: () => boolean;
  returnsToTimesheet?: boolean;
  run?: () => boolean | Promise<boolean>;
  autos?: FillAutoStep[];
};

export type FillManualGroup = {
  manualLabel: string;
  autoStart: number;
  autoEnd: number;
};

export type FillStepSession = FillProbe & {
  rowHeader: string;
  workPattern: string;
  clockIn: string;
  clockOut: string;
  breakTime: string;
  workLocation: string;
  workContent: string;
  template: FillTemplate | null;
  includeDayApply: boolean;
};

export const APPLY_COLUMN_HEADER = '申請';

function rowColumnClick(columnHeader: string, label: string, rowHeader: string): FillAutoStep {
  return {
    label,
    targetText: columnHeader,
    run: () => runOperation('click', {
      tag: 'button',
      labelText: columnHeader,
      table: {
        columnHeader,
        rowHeader,
      }
    })
  };
}

// 「カテゴリーから検索お気に入りから検索」div のクリックと、
// 各 select 直後の連結テキストのクリックは手順に含めない。
function workHourFavoriteAutos(
  session: FillStepSession,
  fieldName: string,
  value: string,
  lookupIndex: number
): FillAutoStep[] {
  return [
    {
      label: `工数の「${fieldName}」の検索欄を開く`,
      ...(fieldName === '製品分野' ? { targetIsDisplayed: () => !!workHourFirstJobRow() } : {}),
      run: () => clickWorkHourLookup(lookupIndex, session)
    },
    {
      label: 'お気に入りから検索を開く',
      run: () => clickByText('button', 'お気に入りから検索')
    },
    {
      label: `「${value}」を選ぶ`,
      targetIsDisplayed: () => !!displayedFavoriteCandidate(value, session),
      run: () => activateClick(displayedFavoriteCandidate(value, session))
    },
    {
      label: '決定する',
      run: () => clickByText('button', '決定')
    }
  ];
}

function workHourSlotAutos(session: FillStepSession): FillAutoStep[] {
  const autos: FillAutoStep[] = [];
  let favoriteIndex = 0;
  TEMPLATE_ITEM_SLOTS.forEach((slot, slotIndex) => {
    const value = templateSlotValue(session.template, slotIndex);
    if (slot.kind === 'favorite') {
      autos.push(...workHourFavoriteAutos(session, slot.fieldName, value, favoriteIndex));
      favoriteIndex += 1;
      return;
    }
    autos.push({
      label: `工数の「${slot.fieldName}」を「${value}」にする`,
      run: () => setWorkHourDropdown(slot.index, value, session)
    });
  });
  return autos;
}

// 申請列から開くのはタイトル「申請」のダイアログ。勤務時間変更はその中の左メニューのサブ画面。
export function buildFillManuals(session: FillStepSession): FillManual[] {
  const manuals: FillManual[] = [
    {
      label: '勤務パターンを選択する',
      autos: [
        rowColumnClick(APPLY_COLUMN_HEADER, '申請メニューを開く', session.rowHeader),
        {
          label: '勤務時間変更を開く',
          targetText: '勤務時間変更',
          targetIsDisplayed: () => choiceIsDisplayed('勤務時間変更'),
          run: () => clickChoiceEverywhere('勤務時間変更')
        },
        {
          label: '勤務パターン欄を開く',
          targetText: '勤務パターン',
          skipWhen: 'workPatternSame',
          failMessage: '勤務パターンの候補一覧が開きませんでした',
          targetIsDisplayed: () => !!findWorkPatternCombobox(),
          run: () => openWorkPatternCombobox()
        },
        {
          label: '確認した勤務パターンを選ぶ',
          skipWhen: 'workPatternSame',
          run: () => runOperation('click', {
            tag: 'li',
            role: 'option',
            text: session.workPattern,
            dialogTitle: '勤務時間変更'
          })
        }
      ]
    },
    {
      // 勤務時間変更の申請は単独の手動ステップ。
      label: '勤務時間変更を申請する',
      returnsToTimesheet: true,
      run: () => clickWorkTimeChangeApply()
    },
    {
      label: '勤務時間を入力する',
      autos: [
        // 出勤セルはタイトル「勤務時間入力」を開く。
        rowColumnClick('出勤', '出勤欄を開く', session.rowHeader),
        {
          label: '出勤の時刻欄を選ぶ',
          targetIsDisplayed: () => !!displayedAttendanceCaption(),
          run: () => activateClick(displayedAttendanceCaption())
        },
        {
          // ダイアログ名「勤務時間変更」が付かないことがあるため dialogTitle は指定しない。ダイアログ内 index による fallback は月選択を指しうる。
          label: '出勤時刻を入力する',
          run: () => runOperation('set', {
            tag: 'input',
            type: 'text',
            labelText: '出勤',
            placeholder: '(00:00)',
            placeholderIndex: 0,
            dialogInputIndex: 0
          }, session.clockIn)
        },
        {
          label: '退勤の時刻欄を選ぶ',
          run: () => clickOverlayCaption('退勤')
        },
        {
          label: '退勤時刻を入力する',
          run: () => runOperation('set', {
            tag: 'input',
            type: 'text',
            labelText: '退勤',
            placeholder: '(00:00)',
            placeholderIndex: 1,
            dialogInputIndex: 1
          }, session.clockOut)
        },
      ]
    },
    {
      label: '勤務時間を保存する',
      returnsToTimesheet: true,
      run: () => clickTimeDialogSave()
    },
    {
      label: '勤務場所と業務内容を入力する',
      autos: [
        rowColumnClick('勤務場所', '勤務場所欄を開く', session.rowHeader),
        {
          label: '勤務場所を選ぶ',
          targetText: session.workLocation,
          run: () => clickChoiceByText(session.workLocation)
        },
        {
          label: '業務内容を入力する',
          run: () => runOperation('set', {
            tag: 'input',
            type: 'text',
            labelText: '業務内容',
            table: {
              columnHeader: '業務内容',
              rowHeader: session.rowHeader,
            }
          }, session.workContent)
        },
      ]
    },
    {
      ...rowColumnClick('保存', '行を保存する', session.rowHeader),
      returnsToTimesheet: true
    },

    // 工数列は外側タイトル「デイリーサマリー」。工数入力と「保存して閉じる」はその中。
    {
      ...rowColumnClick('工数', '工数実績サマリーを開く', session.rowHeader),
      targetIsDisplayed: () => workHourColumnButtonIsEnabled(session.rowHeader)
    },
    {
      label: '工数実績を入力する',
      autos: [
        ...workHourSlotAutos(session),
        {
          label: '作業時間を入力する',
          run: () => setWorkHourTime(workTimeFromAttendance(session.clockIn, session.clockOut, session.breakTime))
        }
      ]
    },
    {
      label: '工数を保存して閉じる',
      returnsToTimesheet: true,
      run: () => runOperation('click', {
        tag: 'button',
        text: '保存して閉じる',
        dialogTitle: '工数実績サマリー',
        labelText: '工数実績サマリー'
      })
    }
  ];
  if (session.includeDayApply) {
    manuals.push({
      label: '1日の申請を行う',
      autos: [
        rowColumnClick('出勤', '対象行の出勤の時刻欄を選ぶ', session.rowHeader),
        {
          label: '表示画面内の「申請」を押す',
          targetText: '申請',
          targetIsDisplayed: () => !!displayedDayApplyButton(),
          run: () => activateClick(displayedDayApplyButton())
        }
      ]
    });
  }
  return manuals;
}

// 1日分の正は手動ステップの入れ子。工数お気に入り6欄は workHourFavoriteAutos が1欄分を返す。
export function flattenFillManuals(manuals: FillManual[]) {
  const steps: FillAutoStep[] = [];
  const manualGroups: FillManualGroup[] = [];
  for (const manual of manuals) {
    const autos = manual.autos || [manual as FillAutoStep];
    const autoStart = steps.length;
    steps.push(...autos);
    manualGroups.push({
      manualLabel: manual.label,
      autoStart,
      autoEnd: steps.length
    });
  }
  return { steps, manualGroups };
}
