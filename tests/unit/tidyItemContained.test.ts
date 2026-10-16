import { describe, it, expect } from 'vitest';
import path from 'path';
import { isTidyItemContained, type TidyPlanItem } from '../../server/utils/videoTidy';

const item = (over: Partial<TidyPlanItem>): TidyPlanItem => ({
  id: 'v1', title: 'T', channelId: 'c', channelTitle: 'C', kind: 'legacy',
  fromDir: '/base/C', toDir: '/base/C/T [v1]',
  moves: [{ from: '/base/C/v1.mp4', to: '/base/C/T [v1]/T [v1].mp4', size: 1 } as any],
  cleanupDirs: ['/base/C'], oldVideoUrl: '/downloads/C/v1.mp4', oldThumbUrl: null, newVideoUrl: 'x', newThumbUrl: null,
  ...over,
});

describe('tidy never moves or removes outside its planned folders', () => {
  it('accepts a normal item', () => expect(isTidyItemContained(item({}))).toBe(true));
  it('rejects an invalid id', () => expect(isTidyItemContained(item({ id: '../v1' }))).toBe(false));
  it('rejects a source that leaves its folder', () => {
    expect(isTidyItemContained(item({ moves: [{ from: path.join('/base/C', '../../etc/passwd'), to: '/base/C/T [v1]/x', size: 1 } as any] }))).toBe(false);
  });
  it('rejects a cleanup folder that is not the source folder or above it', () => {
    expect(isTidyItemContained(item({ cleanupDirs: ['/elsewhere'] }))).toBe(false);
  });
});
