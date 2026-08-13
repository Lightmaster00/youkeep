import { describe, it, expect } from 'vitest';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import EmptyState from '../../app/components/EmptyState.vue';

describe('EmptyState', () => {
  it('renders the title and description text', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 'No videos yet', description: 'Subscribe to a channel to get started' }
    });
    expect(wrapper.text()).toContain('No videos yet');
    expect(wrapper.text()).toContain('Subscribe to a channel to get started');
  });

  it('renders a NuxtLink (not a button) when actionRoute and actionText are both set', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: {
        title: 'No playlists',
        description: 'Create one to get started',
        actionRoute: '/playlists/new',
        actionText: 'Create playlist'
      }
    });
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

  it('renders the book icon variant', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 't', description: 'd', icon: 'book' }
    });
    const path = wrapper.find('svg.main-icon path');
    expect(path.attributes('d')).toContain('M4 19.5A2.5 2.5 0 0 1 6.5 17H20');
  });

  it('renders the music icon variant (two circles)', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 't', description: 'd', icon: 'music' }
    });
    expect(wrapper.findAll('svg.main-icon circle').length).toBe(2);
  });

  it('renders the default (video) icon variant when icon is unset', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { title: 't', description: 'd' }
    });
    expect(wrapper.findAll('svg.main-icon polygon').length).toBe(1);
    expect(wrapper.findAll('svg.main-icon rect').length).toBe(1);
  });
});
