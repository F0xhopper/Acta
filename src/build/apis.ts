/**
 * Lazy access to the gather and research modules, which are built alongside this orchestrator.
 * Typed here so the orchestrator typechecks on its own.
 */
import type { Brand, Facts } from './contracts.js';
import type { FullLead } from '../db/types.js';

export interface GatherResult {
  brand: Brand;
  facts: Facts;
  dir: string;
  files: { brand: string; facts: string; logo: string | null; photos: string[] };
}
export interface GatherApi {
  gather(full: FullLead, opts?: { force?: boolean; onRequest?: (api: 'places' | 'ch') => void; log?: (msg: string) => void }): Promise<GatherResult>;
  copyIntoRepo(result: GatherResult, repoDir: string): { brandJson: string; factsJson: string };
}
export interface ResearchApi {
  pinterestLogin(sessionPath: string): Promise<void>;
  researchLead(brand: Brand, facts: Facts, outDir: string, opts: { sessionPath: string; queries?: string[]; log?: (m: string) => void }): Promise<{ pins: number; queries: string[]; boardPath: string; fallback: boolean }>;
}

export const loadGather = async (): Promise<GatherApi> => (await import('./gather/index.js')) as unknown as GatherApi;
export const loadResearch = async (): Promise<ResearchApi> => (await import('./research.js')) as unknown as ResearchApi;
