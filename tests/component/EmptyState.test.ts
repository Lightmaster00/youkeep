import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EmptyState from '../../app/components/EmptyState.vue';

describe('EmptyState', () => {
  it('renders a NuxtLink (not a button) when actionRoute and actionText are both set', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: {
        title: 'No playlists',
        description: 'Create one to get started',
        actionRoute: '/playlists/new',
        actionText: 'Create playlist'
      }
    });
    expect(wrapper.text()).toContain('Create one to get started');
    const link = wrapper.find('a');
    expect(link.exists()).toBe(true);
    expect(link.attributes('href')).toBe('/playlists/new');
    expect(link.text()).toContain('Create playlist');
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('renders a button (not a link) when only actionText is set', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 'No results', description: 'Try a different search', actionText: 'Clear search' }
    });
    const button = wrapper.find('button');
    expect(button.exists()).toBe(true);
    expect(button.text()).toContain('Clear search');
    expect(wrapper.find('a').exists()).toBe(false);
  });

  it('renders neither a link nor a button when actionText is unset', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 'Nothing here', description: 'Nothing to see' }
    });
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('emits "action" with no payload when the button is clicked', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 'No results', description: 'Try a different search', actionText: 'Clear search' }
    });
    await wrapper.find('button').trigger('click');
    const emitted = wrapper.emitted('action');
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual([]);
  });

  it('picks the icon variant from the icon prop (video by default)', async () => {
    const icon = async (i?: string) => (await mountSuspended(EmptyState, { props: { title: 't', description: 'd', ...(i ? { icon: i } : {}) } })).find('svg.main-icon');
    expect((await icon('book')).find('path').attributes('d')).toContain('M4 19.5A2.5 2.5 0 0 1 6.5 17H20');
    expect((await icon('music')).findAll('circle')).toHaveLength(2);
    expect((await icon()).findAll('polygon')).toHaveLength(1);
  });
});
