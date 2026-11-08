import {
  HISTORY_SEARCH_JSON_SCHEMA,
  OPEN_TABS_JSON_SCHEMA,
  parseHistorySearchTerms,
  parseOpenTabPicks,
  type HistorySearchTerms,
} from '@/lib/chatLookup';
import { getModelInstance, isLocalModel } from '@/lib/models';
import { getHistorySearchPrompt, getOpenTabsPickPrompt } from '@/lib/prompts';
import { trackTokenUsage } from '@/lib/tokenUsageTracker';
import { getChatModelPreset } from '@/services/background/chatModelHandler';
import { errorLog } from '@/logs';
import { AIMessage, AIMessageChunk, HumanMessage } from '@langchain/core/messages';

// One short request to the chat model, quick and without thinking, that answers in JSON.
const askForJson = async (prompt: string, jsonSchema: Record<string, unknown>, maxTokens: number) => {
  const modelPreset = getChatModelPreset();
  const local = isLocalModel(modelPreset.modelName);
  const llm = getModelInstance({
    temperature: 0,
    maxTokens,
    // A slow local model's single response can outlast the service worker's fetch limit.
    streaming: local,
    fast: true,
    modelPreset,
    jsonSchema,
  });
  const messages = [new HumanMessage(prompt)];
  let response: AIMessage | AIMessageChunk | undefined;
  if (local) {
    for await (const chunk of await llm.stream(messages)) {
      response = response ? (response as AIMessageChunk).concat(chunk) : chunk;
    }
  } else {
    response = await llm.invoke(messages);
  }
  if (!response) return '';
  await trackTokenUsage(modelPreset, response);
  return response.text;
};

// Which of the open tabs (by title and site) may answer the question, as indexes into `tabs`;
// none when the model can't say.
export const pickOpenTabs = async (
  question: string,
  tabs: { title: string; site: string }[],
  max: number
): Promise<number[]> => {
  if (tabs.length === 0) return [];
  try {
    const prompt = getOpenTabsPickPrompt(question, tabs, max);
    const text = await askForJson(prompt, OPEN_TABS_JSON_SCHEMA, 200);
    return parseOpenTabPicks(text, tabs.length, max);
  } catch (err) {
    errorLog('chatLookup [pickOpenTabs] failed:', err);
    return [];
  }
};

// The words to search browsing history and past chats with for the question, or null when the
// model can't say.
export const historySearchTerms = async (
  question: string,
  today: string
): Promise<HistorySearchTerms | null> => {
  try {
    const prompt = getHistorySearchPrompt(question, today);
    const text = await askForJson(prompt, HISTORY_SEARCH_JSON_SCHEMA, 300);
    return parseHistorySearchTerms(text);
  } catch (err) {
    errorLog('chatLookup [historySearchTerms] failed:', err);
    return null;
  }
};
