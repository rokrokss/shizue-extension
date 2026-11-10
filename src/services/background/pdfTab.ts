import { MESSAGE_OFFSCREEN_READ_PDF } from '@/config/constants';
import type { PageRead } from '@/lib/tabText';

// A PDF tab's text, for a page summary (services/pageSummary.ts) and the Claude Code bridge.
// pdf.js needs a worker, which a service worker can't start, so a PDF is read in an offscreen page
// (entrypoints/offscreen-pdf), one at a time, and the page closed after.
let pdfReads: Promise<unknown> = Promise.resolve();
export const readPdf = (url: string, title: string) => {
  const reading = pdfReads.then(async (): Promise<PageRead> => {
    await chrome.offscreen
      .createDocument({
        url: 'offscreen-pdf.html',
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: 'Reads the text of a PDF tab with pdf.js, which needs a worker.',
      })
      .catch(() => {});
    try {
      return (await chrome.runtime.sendMessage({ action: MESSAGE_OFFSCREEN_READ_PDF, url, title })) ?? { error: 'unreadable' };
    } catch {
      return { error: 'unreadable' };
    } finally {
      await chrome.offscreen.closeDocument().catch(() => {});
    }
  });
  pdfReads = reading.catch(() => {});
  return reading;
};
