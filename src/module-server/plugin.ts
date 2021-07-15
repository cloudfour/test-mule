import type { Plugin as RollupPlugin } from 'rollup';

export interface Plugin extends RollupPlugin {
  enforce?: 'pre' | 'normal' | 'post';
}
