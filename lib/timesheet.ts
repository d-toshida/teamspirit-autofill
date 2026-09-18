// 勤務表の行・列・日付ヘッダ。

import {
  normalizeSpace,
  usableCaption
} from './dom.js';

const DAY_AND_WEEKDAY = /^(\d{1,2})\s*[\(（]?[月火水木金土日祝][\)）]?/;
const MONTH_YEAR_TEXT = /(\d{4})\s*年\s*(\d{1,2})\s*月/;
const TIMESHEET_TABLE_SELECTOR = '.timesheet-pc-main-content-timesheet__table';

function visualColumnIndex(cell: HTMLTableCellElement) {
  let index = 0;
  for (const sibling of (cell.parentElement as HTMLTableRowElement).cells) {
    if (sibling === cell) return index;
    index += sibling.colSpan || 1;
  }
  return index;
}

export function cellAtVisualIndex(row: HTMLTableRowElement, visualIndex: number) {
  let index = 0;
  for (const cell of row.cells) {
    const span = cell.colSpan || 1;
    if (visualIndex >= index && visualIndex < index + span) return cell;
    index += span;
  }
  return null;
}

function headerRowsOf(table: HTMLTableElement) {
  if (table.tHead && table.tHead.rows.length) return [...table.tHead.rows];
  return table.rows[0] ? [table.rows[0]] : [];
}

export function isHeadRow(row: Element) {
  return !!(row.parentElement && row.parentElement.tagName === 'THEAD');
}

function columnHeaderText(table: HTMLTableElement, visualIndex: number) {
  const parts: string[] = [];
  for (const row of headerRowsOf(table)) {
    const cell = cellAtVisualIndex(row, visualIndex);
    const text = usableCaption(cell && cell.textContent, cell);
    if (text && !parts.includes(text)) parts.push(text);
  }
  return parts.join(' / ');
}

export function timesheetTable() {
  const table = document.querySelector(TIMESHEET_TABLE_SELECTOR);
  return table instanceof HTMLTableElement ? table : null;
}

function closestRowInTable(cell: Element, table: HTMLTableElement) {
  let node: Element | null = cell;
  while (node && node !== table) {
    if (node.tagName === 'TR' && node.closest('table') === table) return node as HTMLTableRowElement;
    node = node.parentElement;
  }
  return cell.parentElement as HTMLTableRowElement | null;
}

function cellInRow(row: HTMLTableRowElement, descendant: Element) {
  for (const cell of row.cells) {
    if (cell === descendant || cell.contains(descendant)) return cell;
  }
  return null;
}

function pageMonthYear() {
  for (const node of document.querySelectorAll('select')) {
    const selected = (node as HTMLSelectElement).selectedOptions[0];
    if (!selected) continue;
    const match = String(selected.textContent || '').match(MONTH_YEAR_TEXT);
    if (match) return `${match[1]}-${String(match[2]).padStart(2, '0')}`;
  }
  return '';
}

function cellDateSources(cell: Element) {
  return [
    normalizeSpace(cell.getAttribute('aria-label') || ''),
    normalizeSpace(cell.getAttribute('title') || ''),
    normalizeSpace(cell.textContent)
  ].filter(Boolean);
}

function extractRowDay(row: HTMLTableRowElement) {
  for (const cell of row.cells) {
    for (const source of cellDateSources(cell)) {
      const weekday = source.match(DAY_AND_WEEKDAY);
      if (!weekday) continue;
      return Number(weekday[1]);
    }
  }
  return null;
}

// 日付セル表示は「日＋曜日」（例: 6木）。行キーは年月付きへ正規化する（例: 2026-10-17）。
export function rowHeaderText(row: HTMLTableRowElement) {
  const day = extractRowDay(row);
  const monthYear = pageMonthYear();
  if (day == null || !monthYear) return '';
  return `${monthYear}-${String(day).padStart(2, '0')}`;
}

export function getTableContext(el: Element) {
  const table = timesheetTable();
  if (!table || !table.contains(el)) return null;
  const row = closestRowInTable(el, table);
  if (!row || !row.cells || isHeadRow(row)) return null;
  const rowCell = cellInRow(row, el.closest('td, th') || el);
  if (!rowCell) return null;
  const columnIndex = visualColumnIndex(rowCell);
  const columnHeader = columnHeaderText(table, columnIndex);
  const rowHeader = rowHeaderText(row);
  if (!columnHeader && !rowHeader) return null;
  return {
    columnHeader,
    rowHeader,
    columnIndex
  };
}

export function findColumnIndexByHeader(table: HTMLTableElement, headerText: string) {
  const headerParts = headerText.split(' / ').filter(Boolean);
  for (const row of headerRowsOf(table)) {
    let visual = 0;
    for (const cell of row.cells) {
      const text = normalizeSpace(cell.textContent);
      if (text === headerText || headerParts.includes(text)) return visual;
      visual += cell.colSpan || 1;
    }
  }
  return -1;
}

export function findRowByHeader(table: HTMLTableElement, rowHeader: string | undefined) {
  if (!rowHeader) return null;
  for (const row of table.rows) {
    if (isHeadRow(row)) continue;
    if (rowHeaderText(row) === rowHeader) return row;
  }
  return null;
}
