import { STORAGE_AGENT_ALLOWED_SITES, STORAGE_AGENT_BACKGROUND, STORAGE_AGENT_SITE_TIPS } from '@/config/constants';
import { atomWithChromeStorage } from '@/lib/atomWithChromeStorage';
import type { AgentSiteTips } from '@/lib/browserAgent';
import { useAtom } from 'jotai';

// The browser agent's own settings, read by the background when a run starts
// (services/background/browserAgentHandler.ts).
export const agentBackgroundAtom = atomWithChromeStorage<boolean>(STORAGE_AGENT_BACKGROUND, false);
export const agentAllowedSitesAtom = atomWithChromeStorage<string[]>(STORAGE_AGENT_ALLOWED_SITES, []);
export const agentSiteTipsAtom = atomWithChromeStorage<AgentSiteTips>(STORAGE_AGENT_SITE_TIPS, {});

export const useAgentBackground = () => useAtom(agentBackgroundAtom);
export const useAgentAllowedSites = () => useAtom(agentAllowedSitesAtom);
export const useAgentSiteTips = () => useAtom(agentSiteTipsAtom);
