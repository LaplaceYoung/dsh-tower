/** Env/config gate aligned with Kimi `KIMI_CODE_EXPERIMENTAL_TOWER`. Default off. */
export const TOWER_FLAG_ENV = 'DSH_EXPERIMENTAL_TOWER';

export function isTowerEnabled(config: { experimental?: boolean } = {}): boolean {
  if (config.experimental === true) return true;
  const env = process.env[TOWER_FLAG_ENV];
  return env === '1' || env === 'true' || env === 'yes';
}
