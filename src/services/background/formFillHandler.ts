import {
  describeFields,
  FORM_FILL_SOURCE_CHARS,
  parseFormFillValues,
  type FormField,
  type FormFillProposal,
} from '@/lib/formFill';
import { getModelInstance, isLocalModel } from '@/lib/models';
import { FORM_FILL_JSON_SCHEMA, getFormFillPrompt } from '@/lib/prompts';
import { chunkParts } from '@/lib/reasoning';
import { readTabPage } from '@/lib/tabText';
import { trackTokenUsage } from '@/lib/tokenUsageTracker';
import { errorLog } from '@/logs';
import { getChatModelPreset } from '@/services/background/chatModelHandler';
import { AIMessage, AIMessageChunk, HumanMessage } from '@langchain/core/messages';

export type FormFillProposeResult =
  | { success: true; proposals: FormFillProposal[]; sourceTitle: string }
  | { success: false; error: 'unreadable' | 'empty' | 'failed'; message?: string };

// Values for the form's fields from the tab the user picked, by the chat model in one call. The
// panel read the form; the source tab is read here like an attached tab, PDF included.
export async function proposeFormFill(
  fields: FormField[],
  form: { title: string; url: string },
  sourceTabId: number
): Promise<FormFillProposeResult> {
  const read = await readTabPage(sourceTabId, true);
  if ('error' in read) return { success: false, error: read.error };
  const source = { ...read.page, text: read.page.text.slice(0, FORM_FILL_SOURCE_CHARS) };
  try {
    const modelPreset = getChatModelPreset();
    const local = isLocalModel(modelPreset.modelName);
    const llm = getModelInstance({
      temperature: 0,
      maxTokens: 4000,
      streaming: local,
      fast: true,
      modelPreset,
      jsonSchema: FORM_FILL_JSON_SCHEMA,
    });
    const prompt = [new HumanMessage(getFormFillPrompt(describeFields(fields), form, source))];
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
    // Without the thinking a model may send along, whose braces would spoil the JSON.
    const text = chunkParts(response).text;
    return { success: true, proposals: parseFormFillValues(text, fields), sourceTitle: source.title };
  } catch (error) {
    errorLog('Form fill: proposing values failed', error);
    return { success: false, error: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
