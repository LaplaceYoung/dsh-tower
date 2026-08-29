/** Adapted from Kimi `tower-mode-exit-reminder.md` — `.dsh-tower` paths. */
export const TOWER_MODE_EXIT_REMINDER = [
  'Tower mode is no longer active.',
  'The tower orchestration restrictions are lifted and your normal capabilities (including TodoList) are restored;',
  'the tower tool set remains available while the experimental flag is on.',
  'The `.dsh-tower/` workspace state — comms, worktrees, and the activity log — is preserved on disk.',
  'Re-enter tower mode with `/tower on`.',
].join(' ');
