import {
  isSelectionActionType,
  MESSAGE_CONTEXT_MENU_DESCRIBE_IMAGE,
  MESSAGE_CONTEXT_MENU_EXTRACT_IMAGE_TEXT,
  MESSAGE_CONTEXT_MENU_PREVIEW_LINK,
  MESSAGE_CONTEXT_MENU_SELECTION_ACTION,
  MESSAGE_CONTEXT_MENU_TRANSLATE_IMAGE,
  MESSAGE_CONTEXT_MENU_TRANSLATE_PAGE,
  MESSAGE_CONTEXT_MENU_TRANSLATE_PAGE_IMAGES,
} from '@/config/constants';
import { openPanel, panelHost } from '@/entrypoints/background/sidepanel';
import { getCurrentChatModel, getCurrentLocalServer } from '@/entrypoints/background/states/models';
import { whenBackgroundStateReady } from '@/entrypoints/background/states/ready';
import {
  ChatModel,
  isChatModel,
  LocalServerConfig,
  modelSupportsImages,
} from '@/lib/modelRegistry';
import { initFormFillContent } from '@/lib/initPanelData';
import { isWebStorePage } from '@/lib/webStore';
import { errorLog } from '@/logs';
import { openPanelForSummary } from '@/services/background/panelSummary';
import { i18n } from '#i18n';

// Image actions run on the chat model, so they are greyed out for text-only models.
const updateImageMenuItems = (model: ChatModel, localServer?: LocalServerConfig | null) => {
  const enabled = modelSupportsImages(model, localServer);
  for (const id of ['describeImage', 'extractImageText', 'translateImage', 'translatePageImages']) {
    // Callback form: the promise form needs Chrome 123+.
    chrome.contextMenus.update(id, { enabled }, () => {
      if (chrome.runtime.lastError) {
        errorLog('Failed to update context menu item:', id, chrome.runtime.lastError.message);
      }
    });
  }
};

// Chrome keeps extensions out of its Web Store (lib/webStore.ts), so on its pages Shizue's menu is
// greyed out and says why. The menu is the same in every window: it follows the active tab of the
// window last focused.
const updateForWebStore = async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const blocked = isWebStorePage(tab?.url);
  const title = i18n.t(blocked ? 'overlayMenu.shizueWebStore' : 'overlayMenu.shizue');
  chrome.contextMenus.update(
    'shizue-parent',
    { enabled: !blocked, title },
    // Before the menu is made, there is nothing to update yet.
    () => void chrome.runtime.lastError
  );
};

export const createContextMenu = async () => {
  // Firefox for Android and Edge for Android have no context menus.
  if (!chrome.contextMenus) return;

  // Service-worker event listeners must be registered before the first await.
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id !== undefined) {
      // These open the panel from the page, after the menu click: too late for Firefox's sidebar,
      // which opens only within a user action, so the click opens it here.
      if (
        panelHost === 'sidebar' &&
        (info.menuItemId === 'describeImage' ||
          info.menuItemId === 'extractImageText' ||
          isSelectionActionType(info.menuItemId))
      ) {
        void openPanel(tab.windowId, tab.id).catch((error) => errorLog('open panel', error));
      }
      if (info.menuItemId === 'translatePage') {
        void chrome.tabs.sendMessage(tab.id, {
          action: MESSAGE_CONTEXT_MENU_TRANSLATE_PAGE,
        }).catch((error) => errorLog('Page action receiver unavailable; reload the page', error));
      } else if (info.menuItemId === 'fillFormFromTab') {
        // Open in the context-menu gesture; the panel reads the request from storage.
        void openPanel(tab.windowId, tab.id).catch((error) => errorLog('open panel', error));
        void initFormFillContent(tab.id, info.frameId ?? 0).catch((error) => errorLog('form fill', error));
      } else if (info.menuItemId === 'summarizePage') {
        // Open in the context-menu gesture, before messaging or storage work.
        void openPanelForSummary(tab.id, tab.windowId).catch((error) => errorLog('Page summary unavailable', error));
      } else if (info.menuItemId === 'describeImage') {
        void chrome.tabs.sendMessage(tab.id, {
          action: MESSAGE_CONTEXT_MENU_DESCRIBE_IMAGE,
          srcUrl: info.srcUrl,
        }).catch((error) => errorLog('Page action receiver unavailable; reload the page', error));
      } else if (info.menuItemId === 'translateImage' || info.menuItemId === 'translatePageImages') {
        void chrome.tabs.sendMessage(tab.id, {
          action:
            info.menuItemId === 'translateImage'
              ? MESSAGE_CONTEXT_MENU_TRANSLATE_IMAGE
              : MESSAGE_CONTEXT_MENU_TRANSLATE_PAGE_IMAGES,
          srcUrl: info.srcUrl,
        }).catch((error) => errorLog('Page action receiver unavailable; reload the page', error));
      } else if (info.menuItemId === 'extractImageText') {
        void chrome.tabs.sendMessage(tab.id, {
          action: MESSAGE_CONTEXT_MENU_EXTRACT_IMAGE_TEXT,
          srcUrl: info.srcUrl,
        }).catch((error) => errorLog('Page action receiver unavailable; reload the page', error));
      } else if (info.menuItemId === 'previewLink') {
        // The card shows in the top frame, beside the link when the link is there.
        void chrome.tabs.sendMessage(tab.id, {
          action: MESSAGE_CONTEXT_MENU_PREVIEW_LINK,
          linkUrl: info.linkUrl,
          frameId: info.frameId,
        }, { frameId: 0 }).catch((error) => errorLog('Page action receiver unavailable; reload the page', error));
      } else if (isSelectionActionType(info.menuItemId)) {
        void chrome.tabs.sendMessage(tab.id, {
          action: MESSAGE_CONTEXT_MENU_SELECTION_ACTION,
          actionType: info.menuItemId,
          selectionText: info.selectionText,
          frameId: info.frameId,
        }).catch((error) => errorLog('Page action receiver unavailable; reload the page', error));
      }
    }
  });

  chrome.tabs.onActivated.addListener(() => void updateForWebStore());
  chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
    if (change.url && tab.active) void updateForWebStore();
  });
  chrome.windows?.onFocusChanged.addListener(() => void updateForWebStore());

  // Menus persist across service worker restarts; clear them before re-creating the same IDs.
  await chrome.contextMenus.removeAll();

  // Create parent menu with custom title "Shizue"
  chrome.contextMenus.create({
    id: 'shizue-parent',
    title: i18n.t('overlayMenu.shizue'),
    contexts: ['all'],
  });

  const contextMenuItems: chrome.contextMenus.CreateProperties[] = [
    {
      id: 'translatePage',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.translatePage'),
      contexts: ['page'],
    },
    {
      id: 'summarizePage',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.summarizePage'),
      contexts: ['page'],
    },
    // Chrome hides the 'page' items while text is selected, so these take their place.
    {
      id: 'translateSelection',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.translateSelection'),
      contexts: ['selection'],
    },
    {
      id: 'explainSelection',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.explainSelection'),
      contexts: ['selection'],
    },
    {
      id: 'xraySelection',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.xraySelection'),
      contexts: ['selection'],
    },
    {
      id: 'summarizeSelection',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.summarizeSelection'),
      contexts: ['selection'],
    },
    {
      id: 'fixGrammarSelection',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.fixGrammarSelection'),
      contexts: ['selection'],
    },
    {
      id: 'previewLink',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.previewLink'),
      contexts: ['link'],
    },
    {
      id: 'fillFormFromTab',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.fillFormFromTab'),
      contexts: ['editable'],
    },
    {
      id: 'translateImage',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.translateImage'),
      contexts: ['image'],
    },
    {
      id: 'translatePageImages',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.translatePageImages'),
      contexts: ['page', 'image'],
    },
    {
      id: 'describeImage',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.describeImage'),
      contexts: ['image'],
    },
    {
      id: 'extractImageText',
      parentId: 'shizue-parent',
      title: i18n.t('overlayMenu.extractImageText'),
      contexts: ['image'],
    },
  ];

  for (const item of contextMenuItems) {
    chrome.contextMenus.create(item);
  }
  void updateForWebStore();



  // Read the changed values directly: the model state's own listener may not have run yet.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.CHAT_MODEL || changes.LOCAL_SERVER)) {
      const newChatModel = changes.CHAT_MODEL ? changes.CHAT_MODEL.newValue : getCurrentChatModel();
      const localServer = changes.LOCAL_SERVER
        ? (changes.LOCAL_SERVER.newValue as LocalServerConfig | null)
        : getCurrentLocalServer();
      if (isChatModel(newChatModel)) updateImageMenuItems(newChatModel, localServer);
    }
  });
  await whenBackgroundStateReady();
  updateImageMenuItems(getCurrentChatModel(), getCurrentLocalServer());
};
