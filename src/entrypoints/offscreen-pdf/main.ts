// Reads a PDF tab's text for a page summary and the Claude Code bridge (services/background/pdfTab.ts).
// pdf.js needs a worker, which the service worker can't start, so the background opens this page
// offscreen for a PDF tab and closes it after.
import { MESSAGE_OFFSCREEN_READ_PDF } from '@/config/constants';
import { readPdfPage } from '@/lib/tabText';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action !== MESSAGE_OFFSCREEN_READ_PDF || sender.id !== chrome.runtime.id) return false;
  void (async () => {
    try {
      const response = await fetch(msg.url, { credentials: 'include' });
      if (!response.ok) return sendResponse({ error: 'unreadable' });
      sendResponse(await readPdfPage(await response.arrayBuffer(), msg.title, msg.url));
    } catch {
      sendResponse({ error: 'unreadable' });
    }
  })();
  return true;
});
