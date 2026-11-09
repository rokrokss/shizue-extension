export interface WebSource {
  url: string;
  title: string;
}

// Sources shown under an answer: the cited ones first, then other search results.
const MAX_SOURCES = 8;

// Each provider streams search results and citations in its own shape: OpenAI annotations and
// OpenRouter's url_citation ({url, title}), Anthropic search results and text citations ({url,
// title}), Gemini grounding chunks ({web: {uri, title}}). Rather than parse each, this takes every
// object with a web address from a streamed chunk, marking those a citation points at.
const CITATION_TYPES = ['url_citation', 'citation', 'web_search_result_location'];

export const collectWebSources = (
  value: unknown,
  into: Map<string, WebSource & { cited: boolean }>,
  cited = false,
  depth = 0
) => {
  if (depth > 8 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectWebSources(item, into, cited, depth + 1));
    return;
  }
  const record = value as Record<string, unknown>;
  const isCitation =
    cited || (typeof record.type === 'string' && CITATION_TYPES.includes(record.type));
  const url = typeof record.url === 'string' ? record.url : record.uri;
  if (typeof url === 'string' && /^https?:\/\//.test(url) && URL.canParse(url)) {
    const title =
      typeof record.title === 'string' && record.title.trim() ? record.title.trim() : new URL(url).host;
    const known = into.get(url);
    if (!known || (isCitation && !known.cited)) into.set(url, { url, title, cited: isCitation });
  }
  for (const [key, child] of Object.entries(record)) {
    collectWebSources(child, into, isCitation || key === 'url_citation' || key === 'citations', depth + 1);
  }
};

export const orderedWebSources = (found: Map<string, WebSource & { cited: boolean }>) =>
  [...found.values()]
    .sort((a, b) => Number(b.cited) - Number(a.cited))
    .slice(0, MAX_SOURCES)
    .map(({ url, title }) => ({ url, title }));

// A web search the model ran for an answer, shown among its thoughts (ThinkingBlock).
export interface WebSearchStep {
  id: string;
  // What it searched for, once known, or the page it opened instead (OpenAI's open_page).
  query?: string;
  url?: string;
  // How many pages the search found, when the provider says, and the first of them it names.
  results?: number;
  sources?: WebSource[];
  done: boolean;
  // How much of the thinking had been shown when it started: it goes there among the thoughts.
  at: number;
}

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : undefined;

// The pages a search found that it names with a web address, at most 10 of them, kept with the step.
const foundPages = (items: unknown[]): WebSource[] =>
  items
    .flatMap((item) => {
      const page = rec(item);
      const url = page?.url;
      if (typeof url !== 'string' || !/^https?:\/\//.test(url) || !URL.canParse(url)) return [];
      const title = typeof page?.title === 'string' && page.title.trim() ? page.title.trim() : new URL(url).host;
      return [{ url, title }];
    })
    .slice(0, 10);

// The query typed so far in a streamed search input ({"query": "…), or undefined while it ends in
// the middle of an escape.
const partialQuery = (json: string) => {
  const match = /"query"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(json);
  if (!match) return undefined;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return undefined;
  }
};

// Follows an answer's web searches through its streamed chunks. Each provider tells of them in its
// own shape and at its own time:
// - Anthropic, as they happen: a server_tool_use block, its input streamed as input_json_delta,
//   then a web_search_tool_result block with the pages.
// - OpenAI (and ChatGPT, whose model passes them on alike): status events as the search runs
//   (response_metadata.tool_outputs), then the finished call with its query (additional_kwargs).
// - Gemini, only with the answer: the queries in the grounding metadata.
// - OpenRouter, only at the end: how many searches ran, in the usage.
// `place` says where a step seen for the first time goes among the thoughts; `live` is whether it
// is still running, so the answer written before it is in fact what led up to it.
export const webSearchTracker = () => {
  const steps = new Map<string, WebSearchStep>();
  // Anthropic streams a search's input by its block's index.
  const inputs = new Map<number, { id: string; json: string }>();

  const push = (
    chunk: { content?: unknown; response_metadata?: unknown; additional_kwargs?: unknown },
    place: (live: boolean) => number
  ) => {
    let changed = false;
    const set = (id: string, change: Omit<Partial<WebSearchStep>, 'id' | 'at'>) => {
      const known = steps.get(id);
      const next = known
        ? { ...known, ...change, done: known.done || Boolean(change.done) }
        : { id, done: false, ...change, at: place(!change.done) };
      if (known && JSON.stringify(next) === JSON.stringify(known)) return;
      steps.set(id, next);
      changed = true;
    };

    if (Array.isArray(chunk.content)) {
      for (const item of chunk.content) {
        const block = rec(item);
        if (!block) continue;
        if (block.type === 'server_tool_use' && block.name === 'web_search' && typeof block.id === 'string') {
          if (typeof block.index === 'number') inputs.set(block.index, { id: block.id, json: '' });
          const query = rec(block.input)?.query;
          set(block.id, typeof query === 'string' ? { query } : {});
        } else if (block.type === 'input_json_delta' && typeof block.index === 'number') {
          const input = inputs.get(block.index);
          if (!input || typeof block.input !== 'string') continue;
          input.json += block.input;
          const query = partialQuery(input.json);
          if (query) set(input.id, { query });
        } else if (block.type === 'web_search_tool_result' && typeof block.tool_use_id === 'string') {
          set(block.tool_use_id, {
            done: true,
            ...(Array.isArray(block.content)
              ? { results: block.content.length, sources: foundPages(block.content) }
              : {}),
          });
        }
      }
    }

    const metadata = rec(chunk.response_metadata);
    const status = rec(metadata?.tool_outputs);
    if (status?.type === 'web_search_call' && typeof status.id === 'string') {
      set(status.id, status.status === 'completed' ? { done: true } : {});
    }
    const kwargs = rec(chunk.additional_kwargs);
    if (Array.isArray(kwargs?.tool_outputs)) {
      for (const output of kwargs.tool_outputs) {
        const call = rec(output);
        if (call?.type !== 'web_search_call' || typeof call.id !== 'string') continue;
        const action = rec(call.action);
        const queries = Array.isArray(action?.queries)
          ? action.queries.filter((q): q is string => typeof q === 'string' && q.trim() !== '')
          : [];
        const query = typeof action?.query === 'string' && action.query.trim() ? action.query : queries.join(' · ');
        set(call.id, {
          done: true,
          ...(query ? { query } : typeof action?.url === 'string' ? { url: action.url } : {}),
          ...(Array.isArray(action?.sources)
            ? { results: action.sources.length, sources: foundPages(action.sources) }
            : {}),
        });
      }
    }

    const grounding = rec(metadata?.groundingMetadata);
    if (Array.isArray(grounding?.webSearchQueries)) {
      grounding.webSearchQueries.forEach((query, i) => {
        if (typeof query === 'string' && query.trim()) set(`grounding-${i}`, { query, done: true });
      });
    }

    const usage = rec(rec(rec(kwargs?.__raw_response)?.usage)?.server_tool_use_details);
    const count = usage?.web_search_requests;
    if (typeof count === 'number') {
      for (let i = steps.size; i < count; i++) set(`search-${i}`, { done: true });
    }
    return changed;
  };

  return { push, steps: () => [...steps.values()] };
};
