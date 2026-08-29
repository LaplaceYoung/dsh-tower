import Schema from '@deepseek-ai/schemastery';

export interface Config {
  /** Enable Tower tools (also via DSH_EXPERIMENTAL_TOWER=1). Default false. */
  experimental?: boolean;
  /** Inflight spawn cap (default 8). */
  inflightCap?: number;
  /** Announce Tower in the system prompt when enabled (default true). */
  announceToAgent?: boolean;
}

export const Config: Schema<Config> = Schema.object({
  experimental: Schema.boolean()
    .default(false)
    .description('Enable Tower tools and /tower (also via env DSH_EXPERIMENTAL_TOWER=1).'),
  inflightCap: Schema.number()
    .default(8)
    .description('Max concurrent tower worker/reviewer spawns.'),
  announceToAgent: Schema.boolean()
    .default(true)
    .description('Register a systemPrompt section announcing Tower when experimental is on.'),
});
