// The Claude Code bridge's PDF reader (services/background/nativeBridge.ts). pdf.js needs a worker,
// which the service worker can't start, so the bridge opens this page offscreen for a PDF tab and
// closes it after. Other builds never open it.
import { MESSAGE_BRIDGE_READ_PDF } from '@/config/constants';
import { readPdfPage } from '@/lib/tabText';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.action !== MESSAGE_BRIDGE_READ_PDF || sender.id !== chrome.runtime.id) return false;
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
