/**
 * The build state machine. Steps run in order; each advances the row to one state.
 * A failure keeps the row where it was, records the step and the error, and counts an attempt.
 * Resuming starts at the first step whose target state hasn't been reached.
 */
export const STEPS = ['gather', 'repo', 'research', 'agent', 'gate', 'push', 'deploy', 'evidence'] as const;
export type Step = (typeof STEPS)[number];

export const STEP_TARGET: Record<Step, BuildState> = {
  gather: 'gathered', repo: 'repo_ready', research: 'researched', agent: 'built', gate: 'gated', push: 'pushed', deploy: 'deployed', evidence: 'preview_ready',
};

export const BUILD_STATES = ['picked', 'awaiting_call', 'gathered', 'repo_ready', 'awaiting_photos', 'researched', 'awaiting_concept', 'built', 'gated', 'pushed', 'deployed', 'preview_ready', 'approved', 'revising', 'failed', 'awaiting_usage', 'torn_down', 'live'] as const;
export type BuildState = (typeof BUILD_STATES)[number];

/** States in pipeline order, for "how far did it get". */
/** The awaiting states are checkpoints: the build stopped there for you, and resumes with the next step. */
const ORDER: BuildState[] = ['picked', 'awaiting_call', 'gathered', 'repo_ready', 'awaiting_photos', 'researched', 'awaiting_concept', 'built', 'gated', 'pushed', 'deployed', 'preview_ready'];

export function stepsFrom(state: BuildState, failedStep: Step | null): Step[] {
  // awaiting_usage: the agent was stopped at the usage limit. Like a failure, it resumes at the step it stopped in.
  if (state === 'failed' || state === 'awaiting_usage') {
    const i = failedStep ? STEPS.indexOf(failedStep) : 0;
    return STEPS.slice(Math.max(i, 0));
  }
  if (state === 'revising') return ['agent', 'gate', 'push', 'deploy', 'evidence'];
  const idx = ORDER.indexOf(state);
  if (idx < 0) return [];
  return STEPS.filter((s) => ORDER.indexOf(STEP_TARGET[s]) > idx);
}

export const REVIEWABLE: BuildState[] = ['preview_ready', 'failed'];

export function canApprove(state: BuildState) { return state === 'preview_ready'; }
export function canReject(state: BuildState) { return state === 'preview_ready' || state === 'approved'; }
export function canTearDown(state: BuildState) { return state !== 'torn_down' && state !== 'live'; }
