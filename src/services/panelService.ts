import { MESSAGE_OPEN_PANEL, MESSAGE_SET_PANEL_OPEN_OR_NOT } from '@/config/constants';
import { debugLog } from '@/logs';

// The background's answer: 'success' when the panel opened, and for a summary that failed because
// of the page itself (a PDF with no text, services/pageSummary.ts), the reason.
async function sendPanelRequest(
  action: string,
  options?: { summarizePage?: boolean }
): Promise<{ status?: string; reason?: string } | undefined> {
  try {
    return await chrome.runtime.sendMessage({ action, ...options });
  } catch (error) {
    // Existing tabs can keep an invalidated content script after an extension update.
    debugLog('Panel connection unavailable', error);
    return undefined;
  }
}

async function requestPanel(action: string, options?: { summarizePage?: boolean }): Promise<boolean> {
  return (await sendPanelRequest(action, options))?.status === 'success';
}

export const panelService = {
  openPanel: (options?: { summarizePage?: boolean }) => requestPanel(MESSAGE_OPEN_PANEL, options),
  setPanelOpenOrNot: () => requestPanel(MESSAGE_SET_PANEL_OPEN_OR_NOT),
  // Opens the panel on a summary of this page, and says why when the page couldn't be summarized.
  summarizePage: async () => {
    const response = await sendPanelRequest(MESSAGE_OPEN_PANEL, { summarizePage: true });
    return { opened: response?.status === 'success', reason: response?.reason };
  },
};
