import { CURRENT_VERSION, type KanbanDoc } from '@shared/schema';
import { newId } from './ids';

export function createSeedDoc(): KanbanDoc {
  return {
    version: CURRENT_VERSION,
    tags: {},
    boards: [
      {
        id: newId('brd'),
        name: 'Prompts',
        defaultRepo: null,
        archived: false,
        scratchpad: '',
        lists: [
          { id: newId('lst'), name: 'Waiting', cards: [] },
          { id: newId('lst'), name: 'In Flight', cards: [] },
          { id: newId('lst'), name: 'Done', cards: [] },
        ],
      },
    ],
  };
}
