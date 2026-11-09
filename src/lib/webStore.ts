// Chrome keeps extensions out of its Web Store: no script runs on chromewebstore.google.com or
// anywhere on chrome.google.com, the old store's domain. Shizue can't read, summarize, translate or
// control these pages, so it says why instead of failing.
export const isWebStorePage = (url: string | undefined) => {
  try {
    const { hostname } = new URL(url ?? '');
    const under = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
    return under('chromewebstore.google.com') || under('chrome.google.com');
  } catch {
    return false;
  }
};
