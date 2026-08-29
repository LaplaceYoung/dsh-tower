import { TOWER_MODE_EXIT_REMINDER } from './exit.js';
import { TOWER_MODE_FULL_REMINDER } from './full.js';
import { TOWER_MODE_SPARSE_REMINDER } from './sparse.js';

export type TowerModeDisclosure = 'full' | 'sparse' | 'exit';

export { TOWER_MODE_EXIT_REMINDER, TOWER_MODE_FULL_REMINDER, TOWER_MODE_SPARSE_REMINDER };

export function reminderFor(disclosure: TowerModeDisclosure): string {
  switch (disclosure) {
    case 'full':
      return TOWER_MODE_FULL_REMINDER;
    case 'sparse':
      return TOWER_MODE_SPARSE_REMINDER;
    case 'exit':
      return TOWER_MODE_EXIT_REMINDER;
  }
}
