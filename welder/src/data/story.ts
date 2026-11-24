import type { StoryBeat } from './types';

/** Beats fire once, in any order, when their condition holds. */
export const STORY: StoryBeat[] = [
  { id: 'shelf', when: { ordersDone: 2 } },
  { id: 'board', when: { ordersDone: 5 } },
  {
    id: 'finale',
    when: {
      all: [
        { flag: 'board' },
        { ordersDone: 7 },
        { any: [{ all: [{ owns: ['wheel2'] }, { time: 300 }] }, { time: 355 }] },
      ],
    },
  },
];
