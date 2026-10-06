import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import PodcastEpisodeEditModal from '../../app/components/PodcastEpisodeEditModal.vue';

const EPISODE = {
  id: 'ep-1',
  title: 'Pilot',
  description: 'The first one',
  episode_number: 3,
  season_number: 2
};

// The component calls the global $fetch that Nuxt injects. Stubbing the
// global directly (rather than registerEndpoint) keeps the assertion on the
// request body itself, which is the contract this modal owns.
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    episode: { id: 'ep-1', title: 'Renamed', description: 'The first one', episode_number: 3, season_number: 2 }
  }));
  vi.stubGlobal('$fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PodcastEpisodeEditModal', () => {
  it('prefills every form field from the episode prop', async () => {
    const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
      props: { show: true, episode: EPISODE }
    });
    expect((wrapper.find('#episode-edit-title').element as HTMLInputElement).value).toBe('Pilot');
    expect((wrapper.find('#episode-edit-description').element as HTMLTextAreaElement).value).toBe('The first one');
    expect((wrapper.find('#episode-edit-number').element as HTMLInputElement).value).toBe('3');
    expect((wrapper.find('#episode-edit-season').element as HTMLInputElement).value).toBe('2');
  });

  it('renders null episode_number/season_number/description as empty inputs, not "null"', async () => {
    const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
      props: {
        show: true,
        episode: { id: 'ep-2', title: 'Untagged', description: null, episode_number: null, season_number: null }
      }
    });
    expect((wrapper.find('#episode-edit-description').element as HTMLTextAreaElement).value).toBe('');
    expect((wrapper.find('#episode-edit-number').element as HTMLInputElement).value).toBe('');
    expect((wrapper.find('#episode-edit-season').element as HTMLInputElement).value).toBe('');
  });

  it('re-prefills when the episode prop changes to a different episode', async () => {
    const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
      props: { show: true, episode: EPISODE }
    });
    await wrapper.setProps({
      episode: { id: 'ep-9', title: 'Other', description: 'Second', episode_number: 11, season_number: null }
    });
    expect((wrapper.find('#episode-edit-title').element as HTMLInputElement).value).toBe('Other');
    expect((wrapper.find('#episode-edit-number').element as HTMLInputElement).value).toBe('11');
    expect((wrapper.find('#episode-edit-season').element as HTMLInputElement).value).toBe('');
  });

  it('PATCHes the camelCase body to the episode endpoint on submit and emits "saved" with the returned episode', async () => {
    const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
      props: { show: true, episode: EPISODE }
    });
    await wrapper.find('#episode-edit-title').setValue('Renamed');
    await wrapper.find('form').trigger('submit');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/admin/podcasts/episodes/ep-1');
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'PATCH',
      body: {
        title: 'Renamed',
        description: 'The first one',
        episodeNumber: 3,
        seasonNumber: 2
      }
    });
    await new Promise((r) => setTimeout(r, 0));

    const saved = wrapper.emitted('saved');
    expect(saved).toBeTruthy();
    expect(saved![0]![0]).toMatchObject({ id: 'ep-1', title: 'Renamed' });
  });

  it('does not emit "saved" and does not stay disabled when the request fails', async () => {
    fetchMock.mockRejectedValueOnce({ data: { statusMessage: 'Title cannot be empty.' } });
    const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
      props: { show: true, episode: EPISODE }
    });
    await wrapper.find('form').trigger('submit');
    await new Promise((r) => setTimeout(r, 0));

    expect(wrapper.emitted('saved')).toBeFalsy();
    const submitBtn = wrapper.find('button[type="submit"]');
    expect(submitBtn.attributes('disabled')).toBeUndefined();
  });

  it('does nothing when submitted with a null episode prop', async () => {
    const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
      props: { show: true, episode: null }
    });
    // BaseModal still renders its slot when show is true, so the form exists.
    await wrapper.find('form').trigger('submit');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emits "close" when the Annuler button is clicked', async () => {
    const wrapper = await mountSuspended(PodcastEpisodeEditModal, {
      props: { show: true, episode: EPISODE }
    });
    await wrapper.find('button[type="button"]').trigger('click');
    expect(wrapper.emitted('close')).toBeTruthy();
  });
});
