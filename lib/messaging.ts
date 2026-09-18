import { defineExtensionMessaging } from '@webext-core/messaging';

// 拡張メッセージの正。送受信はこの ProtocolMap。
interface ProtocolMap {
  clickChoiceByText(text: string): { ok: boolean };
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();

// background が executeScript で読む、各フレームの候補クリック入口。
declare global {
  var __tsAutofill: {
    clickChoiceByText: (text: string, rootDocument?: Document | null) => boolean;
  } | undefined;
}
