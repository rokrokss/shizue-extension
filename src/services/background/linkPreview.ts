import { getCurrentLanguage } from '@/entrypoints/background/states/language';
import {
  isPreviewableUrl,
  LINK_PREVIEW_JSON_SCHEMA,
  LINK_PREVIEW_MAX_BYTES,
  LINK_PREVIEW_TEXT_CHARS,
  LinkPreviewFetch,
  LinkPreviewSummary,
  parsePreviewLines,
} from '@/lib/linkPreview';
import { getModelInstance, isLocalModel } from '@/lib/models';
import { getLinkPreviewPrompt } from '@/lib/prompts';
import { trackTokenUsage } from '@/lib/tokenUsageTracker';
import { errorLog } from '@/logs';
import { getChatModelPreset } from '@/services/background/chatModelHandler';
import { AIMessage, AIMessageChunk, HumanMessage } from '@langchain/core/messages';

// A link's preview card (lib/linkPreview.ts). The page is fetched as a stranger would see it: https
// only, without the user's cookies, so a preview never acts as the user on a site or reads their
// account pages.

const FETCH_TIMEOUT_MS = 15_000;

// The page's encoding: the header's, else a <meta> near the top (older Korean and Japanese sites
// still serve EUC-KR and Shift_JIS), else UTF-8.
const decode = (bytes: Uint8Array, contentType: string) => {
  const head = new TextDecoder('ascii').decode(bytes.subarray(0, 4096));
  const label =
    contentType.match(/charset=["']?([\w-]+)/i)?.[1] ??
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  try {
    return new TextDecoder(label ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
};

export const fetchLinkPreview = async (url: string): Promise<LinkPreviewFetch> => {
  if (!isPreviewableUrl(url)) return { success: false, error: 'notHttps' };
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    // A redirect to plain http is refused like a link to it.
    if (!isPreviewableUrl(response.url || url)) return { success: false, error: 'notHttps' };
    if (!response.ok) return { success: false, error: 'failed' };
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return { success: false, error: 'notPage' };
    }
    if (Number(response.headers.get('content-length') ?? 0) > LINK_PREVIEW_MAX_BYTES) {
      return { success: false, error: 'tooBig' };
    }
    // The length header may be missing or wrong, so the body is counted as it comes.
    const reader = response.body?.getReader();
    if (!reader) return { success: false, error: 'failed' };
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (let read = await reader.read(); !read.done; read = await reader.read()) {
      size += read.value.byteLength;
      if (size > LINK_PREVIEW_MAX_BYTES) {
        void reader.cancel().catch(() => {});
        return { success: false, error: 'tooBig' };
      }
      chunks.push(read.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { success: true, html: decode(bytes, contentType), url: response.url || url };
  } catch (error) {
    errorLog('Link preview fetch failed:', error);
    return { success: false, error: 'failed' };
  }
};

export const summarizeLinkPreview = async (
  title: string,
  text: string
): Promise<LinkPreviewSummary> => {
  if (!text.trim()) return { success: false, error: 'noText' };
  try {
    const modelPreset = getChatModelPreset();
    const local = isLocalModel(modelPreset.modelName);
    const llm = getModelInstance({
      temperature: 0.2,
      maxTokens: 600,
      streaming: local,
      fast: true,
      modelPreset,
      jsonSchema: LINK_PREVIEW_JSON_SCHEMA,
    });
    const prompt = [
      new HumanMessage(
        getLinkPreviewPrompt(getCurrentLanguage(), title, text.slice(0, LINK_PREVIEW_TEXT_CHARS))
      ),
    ];
    // A slow local model's single response can outlast the service worker's fetch limit.
    let response: AIMessage | AIMessageChunk | undefined;
    if (local) {
      for await (const chunk of await llm.stream(prompt)) {
        response = response ? (response as AIMessageChunk).concat(chunk) : chunk;
      }
    } else {
      response = await llm.invoke(prompt);
    }
    if (!response) return { success: false, error: 'failed' };
    await trackTokenUsage(modelPreset, response);
    const lines = parsePreviewLines(response.text);
    return lines.length ? { success: true, lines } : { success: false, error: 'failed' };
  } catch (error) {
    errorLog('Link preview summary failed:', error);
    return { success: false, error: 'failed', message: (error as Error)?.message };
  }
};
