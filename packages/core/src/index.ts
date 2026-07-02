/**
 * `@quiksend/core` — pure domain logic for the sequence engine.
 *
 * Nothing in this package performs I/O. It exports:
 *   • the enrollment state machine (transitions, guards, effects)
 *   • schedule/window/throttle math (used by the sequence-builder preview *and* the
 *     worker executor, so preview never drifts from reality — see Appendix A #2
 *     in Phases-2-10.md)
 *   • tenancy helpers (branded organization ids, orgFn context shape)
 *
 * The worker (`apps/worker`) interprets the effects the state machine emits; it
 * never lives inside this package.
 */
export * from "./tenancy.ts";
export * as schedule from "./schedule/index.ts";
export * as stateMachine from "./state-machine/index.ts";
export * as deliverability from "./deliverability/index.ts";
