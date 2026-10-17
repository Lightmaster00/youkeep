import { describe, it, expect, vi } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { setImageFallback, FALLBACK_AVATAR } from '../../app/utils/imageFallback';
import VideoCard from '../../app/components/VideoCard.vue';

function brokenImage(src: string) {
  const img = document.createElement('img');
  img.setAttribute('src', src);
  img.addEventListener('error', (e) => setImageFallback(e, FALLBACK_AVATAR));
  return img;
}

describe('setImageFallback', () => {
  it('sets the fallback once even if it keeps failing', () => {
    const img = brokenImage('/missing.png');
    const spy = vi.spyOn(img, 'setAttribute');
    for (let i = 0; i < 50; i++) img.dispatchEvent(new Event('error'));
    expect(spy.mock.calls.filter(([n]) => n === 'src')).toHaveLength(1);
    expect(img.getAttribute('src')).toBe(FALLBACK_AVATAR);
  });

  it('applies again when the element is reused for another image', () => {
    const img = brokenImage('/a.png');
    img.dispatchEvent(new Event('error'));
    img.setAttribute('src', '/b.png');
    img.dispatchEvent(new Event('error'));
    expect(img.getAttribute('src')).toBe(FALLBACK_AVATAR);
  });

  it('does nothing when the original src already is the fallback', () => {
    const img = brokenImage(FALLBACK_AVATAR);
    const spy = vi.spyOn(img, 'setAttribute');
    img.dispatchEvent(new Event('error'));
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('VideoCard image errors', () => {
  it('falls back from the local thumbnail to YouTube once, then stops', async () => {
    const w = await mountSuspended(VideoCard, {
      props: { video: { id: 'vid1', title: 'T', local_thumbnail_path: '/downloads/t.jpg', channel_title: 'C', channel_avatar: '/x.jpg', duration: 10 } },
    });
    const imgs = w.findAll('img').map((i: any) => i.element as HTMLImageElement);
    for (const img of imgs) {
      const spy = vi.spyOn(img, 'setAttribute');
      for (let i = 0; i < 10; i++) img.dispatchEvent(new Event('error'));
      expect(spy.mock.calls.filter(([n]) => n === 'src').length).toBeLessThanOrEqual(1);
    }
  });
});
