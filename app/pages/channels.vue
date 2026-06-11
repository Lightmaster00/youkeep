<template>
  <div class="channels-page">
    <!-- DETAIL VIEW: Single Channel Profile -->
    <div v-if="channelId && channel" class="channel-detail-view">
      <!-- Back Button -->
      <button @click="goBack" class="btn btn-secondary back-btn">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
        All Channels
      </button>

      <!-- Channel Banner -->
      <div 
        class="channel-banner-container glass-panel"
        :style="channel.banner_url ? { backgroundImage: `url(${channel.banner_url}), linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}"
      >
        <div class="banner-overlay"></div>
      </div>

      <!-- Channel Profile Header -->
      <div class="channel-profile-header">
        <img 
          :src="channel.avatar_url || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'" 
          @error="handleAvatarError"
          class="channel-profile-avatar" 
          alt="Avatar"
        />
        <div class="channel-profile-info">
          <div class="title-row" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
            <h1 class="channel-profile-title">{{ channel.title }}</h1>
            <span v-if="isAdmin" class="badge" :class="channel.sync_status === 'downloading' ? 'badge-completed' : 'badge-pending'">
              {{ channel.sync_status === 'downloading' ? 'Sync Active' : 'Sync Paused' }}
            </span>
            <span class="badge" :class="getVisBadgeClass(channel.visibility)">
              {{ formatVisibility(channel.visibility) }}
            </span>
          </div>
          <p class="channel-profile-meta">
            YouTube Channel • ID : {{ channel.id }} • {{ channelVideos.filter((v: any) => v.download_status === 'completed').length }} / {{ channelVideos.length }} videos archived
          </p>
          <p class="channel-profile-desc">{{ channel.description || 'No description available.' }}</p>
          
          <div class="channel-actions-row">
            <button 
              @click="handleToggleSubscription" 
              class="btn subscribe-btn"
              :class="subscribed ? 'btn-secondary' : 'btn-primary'"
            >
              <svg v-if="subscribed" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>{{ subscribed ? 'Subscribed' : "Subscribe" }}</span>
            </button>
            <button 
              v-if="isAdmin"
              @click="showDrawer = true" 
              class="btn btn-secondary settings-trigger-btn"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.5 1z"></path></svg>
              <span>Tracking options</span>
            </button>

          </div>
        </div>
      </div>

      <!-- Non-synchronized Channel Warning Banner -->
      <div v-if="singleChannelData?.stats && singleChannelData.stats.totalCount === 0" class="sync-warning-banner glass-panel">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #60a5fa; flex-shrink: 0; margin-top: 1px;" :class="{ 'spin-anim': triggeringSync }"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        <div class="warning-text">
          <h4 style="font-size: 14px; font-weight: 700; color: white; margin: 0;">
            {{ triggeringSync ? 'Initial video search...' : 'Empty or unsynced channel' }}
          </h4>
          <p style="font-size: 13.5px; color: var(--text-secondary); margin: 4px 0 0 0; line-height: 1.45;">
            {{ triggeringSync ? 'MyTeub is querying YouTube to retrieve the list of videos for this channel. Please wait.' : 'No videos have been discovered for this channel yet. MyTeub will automatically launch a search in the background to synchronize the list.' }}
          </p>
        </div>
      </div>

      <!-- Stats Dashboard Row -->
      <div v-if="singleChannelData?.stats" class="channel-stats-row">
        <div class="stat-card">
          <div class="stat-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ singleChannelData.stats.completedCount }} / {{ singleChannelData.stats.totalCount }}</span>
            <span class="stat-label">Archived Videos</span>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ formatDurationHours(singleChannelData.stats.totalDuration) }}</span>
            <span class="stat-label">Archived Duration</span>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ formatViewsShort(singleChannelData.stats.totalViews) }}</span>
            <span class="stat-label">Cumulative Views</span>
          </div>
        </div>
        
        <div class="stat-card">
          <div class="stat-icon">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
          </div>
          <div class="stat-info">
            <span class="stat-value">{{ formatBytes(singleChannelData.stats.totalSize) }}</span>
            <span class="stat-label">Disk Space</span>
          </div>
        </div>
      </div>

      <!-- Target Archiving Status Summary Panel -->
      <div v-if="singleChannelData?.stats && channel" class="archive-targets-summary glass-panel" style="margin-top: 16px; margin-bottom: 8px; padding: 20px; border-radius: var(--border-radius-md); background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06);">
        <h3 style="margin-top: 0; margin-bottom: 14px; font-size: 14px; font-weight: 700; color: white; display: flex; align-items: center; gap: 8px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-primary);"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"></path><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>
          Channel Archiving Status Summary
        </h3>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
          <!-- Column 1: YouTube Content Stats -->
          <div style="background: rgba(255, 255, 255, 0.01); padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.04);">
            <span style="font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);">Channel Content (Indexed)</span>
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: white;">
              <div style="display: flex; justify-content: space-between;">
                <span>Regular videos:</span>
                <strong>{{ singleChannelData.stats.completedVideosCount + singleChannelData.stats.pendingVideosCount + singleChannelData.stats.downloadingVideosCount + singleChannelData.stats.failedVideosCount }}</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>Shorts :</span>
                <strong>{{ singleChannelData.stats.completedShortsCount + singleChannelData.stats.pendingShortsCount + singleChannelData.stats.downloadingShortsCount + singleChannelData.stats.failedShortsCount }}</strong>
              </div>
            </div>
          </div>

          <!-- Column 2: Locally Archived Stats -->
          <div style="background: rgba(255, 255, 255, 0.01); padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.04);">
            <span style="font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);">Already Downloaded (Archived)</span>
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: white;">
              <div style="display: flex; justify-content: space-between;">
                <span>Regular videos:</span>
                <strong style="color: var(--accent-primary);">{{ singleChannelData.stats.completedVideosCount }}</strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>Archived shorts:</span>
                <strong style="color: var(--accent-primary);">{{ singleChannelData.stats.completedShortsCount }}</strong>
              </div>
            </div>
          </div>

          <!-- Column 3: Scheduled / Queue Stats -->
          <div style="background: rgba(255, 255, 255, 0.01); padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.04);">
            <span style="font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);">Remaining to download</span>
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: white;">
              <div style="display: flex; justify-content: space-between;">
                <span>Scheduled videos:</span>
                <strong :style="{ color: (singleChannelData.stats.pendingVideosCount + singleChannelData.stats.downloadingVideosCount) > 0 ? '#fbbf24' : 'white' }">
                  {{ singleChannelData.stats.pendingVideosCount + singleChannelData.stats.downloadingVideosCount }}
                </strong>
              </div>
              <div style="display: flex; justify-content: space-between;">
                <span>Scheduled shorts:</span>
                <strong :style="{ color: (singleChannelData.stats.pendingShortsCount + singleChannelData.stats.downloadingShortsCount) > 0 ? '#fbbf24' : 'white' }">
                  {{ singleChannelData.stats.pendingShortsCount + singleChannelData.stats.downloadingShortsCount }}
                </strong>
              </div>
            </div>
          </div>

          <!-- Column 4: Exclusions / Preferences Summary -->
          <div style="background: rgba(255, 255, 255, 0.01); padding: 12px 16px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.04);">
            <span style="font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary);">Active Filters & Preferences</span>
            <div style="margin-top: 8px; display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: white;">
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Regular videos:</span>
                <span class="badge" :class="channel.download_videos === 1 ? 'badge-completed' : 'badge-failed'" style="font-size: 9px; padding: 1px 4px; font-weight: 700; line-height: 1;">
                  {{ channel.download_videos === 1 ? 'ACTIVE' : 'IGNORED' }}
                </span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <span>Shorts :</span>
                <span class="badge" :class="channel.download_shorts === 1 ? 'badge-completed' : 'badge-failed'" style="font-size: 9px; padding: 1px 4px; font-weight: 700; line-height: 1;">
                  {{ channel.download_shorts === 1 ? 'ACTIVE' : 'IGNORED' }}
                </span>
              </div>
              <div v-if="channel.date_after" style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #fbbf24; margin-top: 1px;">
                <span>Since:</span>
                <strong>{{ formatUploadDate(channel.date_after) }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tabbed Navigation Bar -->
      <div class="channel-tabs-bar tabs-bar" style="margin-top: 12px;">
        <button 
          type="button"
          class="tab-btn" 
          :class="{ active: activeTab === 'archived' }"
          @click="activeTab = 'archived'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
          Archived Videos <span class="tab-count">{{ singleChannelData?.stats?.completedVideosCount || 0 }}</span>
        </button>
        <button 
          type="button"
          class="tab-btn" 
          :class="{ active: activeTab === 'shorts' }"
          @click="activeTab = 'shorts'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
          Shorts <span class="tab-count">{{ singleChannelData?.stats?.completedShortsCount || 0 }}</span>
        </button>
        <button 
          type="button"
          class="tab-btn" 
          :class="{ active: activeTab === 'playlists' }"
          @click="activeTab = 'playlists'; closePlaylist();"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="tab-icon"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
          Playlists <span class="tab-count">{{ channelPlaylists?.length || 0 }}</span>
        </button>
      </div>

      <!-- Tab Content: Archived Videos -->
      <div v-show="activeTab === 'archived'" class="channel-videos-section">
        <!-- Filter and Sort Bar -->
        <div class="filter-sort-bar glass-panel">
          <div class="search-box">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input 
              type="text" 
              v-model="videoSearchQuery" 
              placeholder="Search archived video..." 
              class="filter-input" 
            />
          </div>

          <div class="filters-group">
            <div class="filter-item">
              <label>Sort by:</label>
              <select v-model="sortBy" class="filter-select">
                <option value="date_desc">Latest</option>
                <option value="date_asc">Oldest</option>
                <option value="views_desc">Most viewed</option>
                <option value="views_asc">Least viewed</option>
                <option value="duration_desc">Longest</option>
                <option value="duration_asc">Shortest</option>
              </select>
            </div>
          </div>
        </div>

        <div v-if="videosPending && isInitialLoad" class="videos-loading">
          <div class="spinner"></div>
        </div>

        <div v-else-if="archivedVideos.length === 0" class="videos-empty glass-panel" style="padding: 40px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
          <div v-if="channelVideos.length === 0">
            <h3 style="font-size: 16px; font-weight: 700; color: white;">Channel not synchronized</h3>
            <p style="font-size: 13px; color: var(--text-secondary); max-width: 500px; margin-top: 6px;">
              No videos have been indexed for this channel yet. You need to start a sync to fetch available videos from YouTube.
            </p>
            <button v-if="isAdmin" @click="handleToggleSync(true)" class="btn btn-primary" style="margin-top: 14px;">
              Start initial sync
            </button>
          </div>
          <div v-else>
            <h3 style="font-size: 16px; font-weight: 700; color: white;">No videos archived locally</h3>
            <p style="font-size: 13px; color: var(--text-secondary); max-width: 500px; margin-top: 6px;">
              There are currently {{ channelVideos.length }} videos indexed in our database, but none have been successfully downloaded yet.
            </p>
          </div>
        </div>

        <div v-else class="video-grid">
          <div 
            v-for="video in archivedVideos" 
            :key="video.id" 
            class="video-card premium-card" 
            @click="playVideo(video.id)"
          >
            <div class="thumbnail-wrapper">
              <img :src="video.local_thumbnail_path || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`" class="thumbnail-img" alt="Thumbnail" />
              <span class="duration-badge">{{ formatDuration(video.duration) }}</span>
              <VideoDropdownMenu :video="video" @hidden="onVideoHidden" />

              <!-- Admin Actions on Thumbnail -->
              <div v-if="isAdmin" class="admin-video-actions" @click.stop>

                <!-- Share button -->
                <button 
                  class="action-icon-btn" 
                  @click="copyShareLink(video)"
                  title="Copy share link"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                </button>

                <!-- Visibility select -->
                <select 
                  :value="video.visibility || 'public'" 
                  @change="handleUpdateVideoVisibility(video.id, $event)"
                  class="visibility-quick-select"
                  title="Edit visibility"
                >
                  <option value="public">🌍 Public</option>
                  <option value="private">🔒 Private</option>
                  <option value="ultra_private">🔑 Ultra</option>
                </select>

                <!-- Delete icon -->
                <button 
                  class="delete-video-btn-overlay" 
                  @click="handleDeleteVideo(video.id, video.title)" 
                  title="Delete video"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </div>
            <div class="video-info">
              <h4 class="video-title" :title="video.title">{{ video.title }}</h4>
              <div class="metadata-row">
                <span>{{ formatViews(video.view_count) }} views</span>
                <template v-if="video.upload_date && video.upload_date.length === 8">
                  <span>•</span>
                  <span>{{ formatUploadDate(video.upload_date) }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab Content: Archived Shorts -->
      <div v-show="activeTab === 'shorts'" class="channel-videos-section">
        <!-- Filter and Sort Bar -->
        <div class="filter-sort-bar glass-panel">
          <div class="search-box">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
            <input 
              type="text" 
              v-model="videoSearchQuery" 
              placeholder="Search Short..." 
              class="filter-input" 
            />
          </div>

          <div class="filters-group">
            <div class="filter-item">
              <label>Sort by:</label>
              <select v-model="sortBy" class="filter-select">
                <option value="date_desc">Latest</option>
                <option value="date_asc">Oldest</option>
                <option value="views_desc">Most viewed</option>
                <option value="views_asc">Least viewed</option>
              </select>
            </div>
          </div>
        </div>

        <div v-if="videosPending && isInitialLoad" class="videos-loading">
          <div class="spinner"></div>
        </div>

        <div v-else-if="archivedShorts.length === 0" class="videos-empty glass-panel" style="padding: 40px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px;">
          <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
          <div>
            <h3 style="font-size: 16px; font-weight: 700; color: white;">No Shorts archived</h3>
            <p style="font-size: 13px; color: var(--text-secondary); max-width: 500px; margin-top: 6px;">
              No Shorts have been downloaded for this channel yet. Make sure the Shorts archiving option is enabled in the channel settings.
            </p>
          </div>
        </div>

        <div v-else class="shorts-grid">
          <div 
            v-for="video in archivedShorts" 
            :key="video.id" 
            class="video-card premium-card" 
            @click="playVideo(video.id)"
          >
            <div class="thumbnail-wrapper">
              <img :src="video.local_thumbnail_path || `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`" class="thumbnail-img" alt="Thumbnail" />
              <span class="short-badge">Short</span>
              <VideoDropdownMenu :video="video" @hidden="onVideoHidden" />

              <!-- Admin Actions on Thumbnail -->
              <div v-if="isAdmin" class="admin-video-actions" @click.stop>

                <!-- Share button -->
                <button 
                  class="action-icon-btn" 
                  @click="copyShareLink(video)"
                  title="Copy share link"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                </button>

                <!-- Visibility select -->
                <select 
                  :value="video.visibility || 'public'" 
                  @change="handleUpdateVideoVisibility(video.id, $event)"
                  class="visibility-quick-select"
                  title="Edit visibility"
                >
                  <option value="public">🌍 Public</option>
                  <option value="private">🔒 Private</option>
                  <option value="ultra_private">🔑 Ultra</option>
                </select>

                <!-- Delete icon -->
                <button 
                  class="delete-video-btn-overlay" 
                  @click="handleDeleteVideo(video.id, video.title)" 
                  title="Delete video"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                </button>
              </div>
            </div>
            <div class="video-info">
              <h4 class="video-title" :title="video.title">{{ video.title }}</h4>
              <div class="metadata-row">
                <span>{{ formatViews(video.view_count) }} views</span>
                <template v-if="video.upload_date && video.upload_date.length === 8">
                  <span>•</span>
                  <span>{{ formatUploadDate(video.upload_date) }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tab Content: Queue / Downloads -->

      <!-- Tab Content: Playlists -->
      <div v-show="activeTab === 'playlists'" class="channel-videos-section">
        <!-- Playlist List View -->
        <template v-if="!selectedPlaylistId">
          <div class="videos-section-header">
            <h2 class="section-title">Playlists</h2>
          </div>

          <div v-if="playlistsPending" class="videos-loading">
            <div class="spinner"></div>
          </div>

          <div v-else-if="channelPlaylists.length === 0" class="videos-empty glass-panel" style="padding: 40px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 16px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            <div>
              <h3 style="font-size: 16px; font-weight: 700; color: white;">Aucune playlist trouvée</h3>
              <p style="font-size: 13px; color: var(--text-secondary); max-width: 500px; margin-top: 6px;">
                Aucune playlist publique n'est répertoriée pour cette chaîne. Vous pouvez cliquer sur "Sync Playlists" ci-dessus pour rechercher les playlists publiques existantes.
              </p>
            </div>
          </div>

          <div v-else class="video-grid" style="grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));">
            <div 
              v-for="playlist in channelPlaylists" 
              :key="playlist.id" 
              class="video-card premium-card"
              @click="openPlaylist(playlist.id)"
              style="cursor: pointer;"
            >
              <div class="thumbnail-wrapper" style="position: relative;">
                <!-- Overlay to make it look like a playlist card -->
                <div style="position: absolute; right: 0; top: 0; bottom: 0; width: 40%; background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(2px); z-index: 2; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border-top-right-radius: inherit; border-bottom-right-radius: inherit;">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: white;"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                  <span style="font-size: 12px; font-weight: 700; color: white;">{{ playlist.video_count }}</span>
                </div>
                <img 
                  :src="playlist.thumbnail_url || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 16 9\' fill=\'%23111\'><rect width=\'16\' height=\'9\' fill=\'%23111\'/></svg>'" 
                  class="thumbnail-img" 
                  alt="Playlist Thumbnail" 
                  style="aspect-ratio: 16/9; object-fit: cover;"
                />
              </div>
              <div class="video-info" style="padding: 10px; display: flex; flex-direction: column; flex: 1;">
                <h4 class="video-title" style="font-size: 14px; font-weight: 600; line-height: 1.4; color: white; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                  {{ playlist.title }}
                </h4>
                <p v-if="playlist.description" style="font-size: 12px; color: var(--text-secondary); margin-top: 6px; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                  {{ playlist.description }}
                </p>
              </div>
            </div>
          </div>
        </template>

        <!-- Playlist Detail View -->
        <template v-else>
          <div class="videos-section-header" style="display: flex; align-items: center; gap: 12px;">
            <button @click="closePlaylist" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 6px;">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline></svg>
              Back to playlists
            </button>
            <h2 class="section-title" style="margin-left: 8px;">{{ selectedPlaylistData?.playlist?.title }}</h2>
          </div>

          <div v-if="loadingPlaylistDetail" class="videos-loading">
            <div class="spinner"></div>
          </div>

          <div v-else-if="!selectedPlaylistData?.videos?.length" class="videos-empty glass-panel" style="padding: 40px; text-align: center;">
            <p style="color: var(--text-secondary);">Cette playlist ne contient aucune vidéo.</p>
          </div>

          <div v-else class="video-grid">
            <div 
              v-for="video in selectedPlaylistData.videos" 
              :key="video.id" 
              class="video-card premium-card"
              @click="video.download_status === 'completed' ? playVideoInPlaylist(video.id, selectedPlaylistId) : null"
              :style="{ cursor: video.download_status === 'completed' ? 'pointer' : 'default' }"
            >
              <div class="thumbnail-wrapper">
                <img :src="`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`" class="thumbnail-img" alt="Thumbnail" />
                <span class="duration-badge">{{ formatDuration(video.duration) }}</span>
                <VideoDropdownMenu :video="video" @hidden="onVideoHidden" />
                <span class="badge queue-status-badge" :class="getBadgeClass(video.download_status)" style="top: 8px; right: 8px;">
                  {{ formatStatus(video.download_status) }}
                </span>
                <span class="badge" style="position: absolute; bottom: 8px; left: 8px; background: rgba(0, 0, 0, 0.7); font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 700; z-index: 2;">
                  #{{ video.position }}
                </span>
              </div>

              <div class="video-info" style="padding: 10px; display: flex; flex-direction: column; flex: 1;">
                <h4 class="video-title" :title="video.title" style="font-size: 13.5px; font-weight: 600; line-height: 1.4; color: white; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                  {{ video.title }}
                </h4>
                <div class="metadata-row" style="font-size: 11.5px; color: var(--text-secondary); display: flex; gap: 6px; align-items: center; margin-top: auto; padding-top: 6px;">
                  <span>{{ formatViews(video.view_count) }} views</span>
                </div>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div> <!-- END channel-detail-view -->

    <!-- DIRECTORY VIEW: List of Channels -->
    <div v-else class="channel-directory-view">
      <div class="directory-header-row">
        <h1 class="page-title">Archived Channels</h1>
      </div>
      
      <div v-if="pending" class="loading-state">
        <div class="spinner"></div>
        <p>Loading channels...</p>
      </div>

      <div v-else-if="!channels || channels.length === 0" class="empty-state glass-panel">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
        <h3>No channels archived</h3>
        <p>Start adding YouTube channels in the downloader settings to see them here.</p>
        <NuxtLink v-if="isAdmin" to="/settings?tab=downloads" class="btn btn-primary mt-4">
          Add a channel
        </NuxtLink>
      </div>

      <div v-else class="channel-grid">
        <div 
          v-for="ch in channels" 
          :key="ch.id" 
          class="channel-card glass-panel"
          @click="selectChannel(ch.id)"
        >
          <!-- Banner Section -->
          <div 
            class="channel-card-banner"
            :style="ch.banner_url ? { backgroundImage: `url(${ch.banner_url}), linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)` } : {}"
          >
            <div class="channel-card-banner-overlay"></div>
            <span v-if="isAdmin" class="channel-card-sync-badge" :class="ch.sync_status">
              {{ ch.sync_status === 'downloading' ? 'Active' : 'Pause' }}
            </span>
          </div>

          <!-- Content Section -->
          <div class="channel-card-body">
            <div class="channel-card-avatar-wrapper">
              <img 
                :src="ch.avatar_url || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'" 
                @error="handleAvatarError"
                class="channel-card-avatar" 
                alt="Avatar"
              />
            </div>
            <div class="channel-card-info">
              <h3 class="channel-card-title" :title="ch.title">{{ ch.title }}</h3>
              <p class="channel-card-desc">{{ ch.description || 'No description available.' }}</p>
              
              <!-- Quick Stats row at the bottom of the card -->
              <div class="channel-card-stats">
                <span class="stat-badge">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z"></path><polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02"></polygon></svg>
                  {{ ch.completed_count || 0 }} / {{ ch.total_count || 0 }} videos
                </span>
                <span class="visibility-pill" :class="ch.visibility">
                  {{ ch.visibility === 'public' ? 'Public' : 'Private' }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <!-- Backdrop Overlay for Drawer -->
    <div 
      v-if="isAdmin" 
      class="drawer-backdrop" 
      :class="{ active: showDrawer }" 
      @click="showDrawer = false"
    ></div>

    <!-- Admin Settings Drawer -->
    <div 
      v-if="isAdmin && channel" 
      class="settings-drawer" 
      :class="{ open: showDrawer }"
    >
      <div class="drawer-header">
        <h3 class="drawer-title">Tracking options</h3>
        <button class="drawer-close-btn" @click="showDrawer = false">&times;</button>
      </div>

      <div class="drawer-body">
        <!-- Visibility -->
        <div class="form-group-item">
          <label class="form-label" style="margin-bottom: 8px; font-weight: 600;">Channel visibility:</label>
          <select :value="channel.visibility || 'public'" @change="handleUpdateChannelVisibility" class="form-input">
            <option value="public">🌍 Public (Everyone)</option>
            <option value="private">🔒 Private (Logged-in users)</option>
            <option value="ultra_private">🔑 Ultra Private (Admins only)</option>
          </select>
        </div>

        <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 8px 0;" />

        <!-- Archiving Preferences -->
        <div style="display: flex; flex-direction: column; gap: 16px;">
          <h4 style="font-size: 14px; font-weight: 600; color: white; margin: 0;">Archiving Preferences</h4>
          <form @submit.prevent="handleSavePreferences" style="display: flex; flex-direction: column; gap: 16px;">
            <div style="display: flex; gap: 24px;">
              <!-- Toggle switch Videos -->
              <label class="toggle-switch">
                <input type="checkbox" v-model="formPref.downloadVideos" class="toggle-input" />
                <div class="toggle-slider"></div>
                <span>Regular videos</span>
              </label>

              <!-- Toggle switch Shorts -->
              <label class="toggle-switch">
                <input type="checkbox" v-model="formPref.downloadShorts" class="toggle-input" />
                <div class="toggle-slider"></div>
                <span>Shorts</span>
              </label>
            </div>

            <!-- Date picker -->
            <div class="pref-date-picker">
              <label class="form-label" for="drawerDateAfter" style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Only download videos published after:</label>
              <input 
                type="date" 
                id="drawerDateAfter" 
                v-model="formPref.dateAfter" 
                class="form-input" 
              />
            </div>

            <!-- Custom save path -->
            <div class="pref-path-picker">
              <label class="form-label" for="drawerCustomSavePath" style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Custom save folder (leave empty for default):</label>
              <input 
                type="text" 
                id="drawerCustomSavePath" 
                v-model="formPref.customSavePath" 
                placeholder="/path/to/folder"
                class="form-input" 
              />
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%; justify-content: center; margin-top: 8px;" :disabled="savingPref">
              <span v-if="savingPref" class="spinner-sm mr-2"></span>
              <span>Save preferences</span>
            </button>
          </form>
          <p v-if="prefMessage" class="pref-msg success-msg" style="text-align: center; color: #4ade80; font-size: 13px;">{{ prefMessage }}</p>
        </div>

        <hr style="border: 0; border-top: 1px solid rgba(255, 255, 255, 0.08); margin: 8px 0;" />

        <!-- Supprimer -->
        <div style="margin-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.06); padding-top: 16px;">
          <button 
            @click="handleDeleteChannel" 
            class="btn critical-delete-btn btn-sm"
            style="width: 100%; justify-content: center;"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mr-1"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            Delete from archive
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';

const { isAdmin } = useAuth();
const toast = useToast();
const route = useRoute();
const router = useRouter();

const channelId = ref(route.query.channelId ? String(route.query.channelId) : '');

watch(() => route.query.channelId, (newId) => {
  // Only update if we are still on the channels page to prevent transition flash
  if (route.path === '/channels') {
    channelId.value = newId ? String(newId) : '';
  }
});

const activeTab = ref('archived');

// Fetch all channels
const { data: channelsData, pending, refresh: refreshChannels } = await useFetch<{ channels: any[] }>('/api/channels');
const channels = computed(() => channelsData.value?.channels || []);

// Fetch selected channel details
const { data: singleChannelData, refresh: refreshSingleChannel } = await useFetch<any>(computed(() => {
  return channelId.value ? `/api/channels/${channelId.value}` : '/api/channels';
}));
const channel = computed(() => {
  if (!channelId.value) return null;
  return singleChannelData.value?.channel || null;
});

// Fetch selected channel videos
const { data: videosData, pending: videosPending, refresh: refreshVideos } = await useFetch<any>(computed(() => {
  return channelId.value ? `/api/videos?channelId=${channelId.value}&status=all&limit=200` : '/api/videos?limit=1';
}));
const channelVideos = computed(() => {
  if (!channelId.value) return [];
  return videosData.value?.videos || [];
});

// Fetch selected channel playlists
const { data: playlistsData, pending: playlistsPending, refresh: refreshPlaylists } = await useFetch<any>(computed(() => {
  return channelId.value ? `/api/channels/${channelId.value}/playlists` : '/api/channels';
}));
const channelPlaylists = computed(() => {
  if (!channelId.value) return [];
  return playlistsData.value || [];
});

const selectedPlaylistId = ref('');
const selectedPlaylistData = ref<any>(null);
const loadingPlaylistDetail = ref(false);

const openPlaylist = async (playlistId: string) => {
  selectedPlaylistId.value = playlistId;
  loadingPlaylistDetail.value = true;
  try {
    selectedPlaylistData.value = await $fetch(`/api/playlists/${playlistId}`);
  } catch (err) {
    toast.error('Failed to load playlist details.');
  } finally {
    loadingPlaylistDetail.value = false;
  }
};

const closePlaylist = () => {
  selectedPlaylistId.value = '';
  selectedPlaylistData.value = null;
};

const playVideoInPlaylist = (id: string, playlistId: string) => {
  navigateTo(`/watch/${id}?playlistId=${playlistId}`);
};

// Filter/Sort/Search State
const videoSearchQuery = ref('');
const filterStatus = ref('all');
const sortBy = ref('date_desc');
const selectedVideoIds = ref<string[]>([]);
const isInitialLoad = ref(true);

// Reset selection and filters on channel change
watch(channelId, () => {
  isInitialLoad.value = true;
  clearSelection();
  videoSearchQuery.value = '';
  filterStatus.value = 'all';
  sortBy.value = 'date_desc';
  activeTab.value = 'archived';
  showDrawer.value = false;
  selectedPlaylistId.value = '';
  selectedPlaylistData.value = null;
});

watch(videosPending, (newVal) => {
  if (!newVal) {
    isInitialLoad.value = false;
  }
});

// Computed filtered & sorted videos
const filteredVideos = computed(() => {
  let vids = [...channelVideos.value];

  // 1. Filter by search query
  if (videoSearchQuery.value.trim()) {
    const query = videoSearchQuery.value.toLowerCase().trim();
    vids = vids.filter(v => v.title && v.title.toLowerCase().includes(query));
  }

  // 2. Filter by status
  if (filterStatus.value !== 'all') {
    if (filterStatus.value === 'completed') {
      vids = vids.filter(v => v.download_status === 'completed');
    } else if (filterStatus.value === 'downloading_pending') {
      vids = vids.filter(v => v.download_status === 'pending' || v.download_status === 'downloading');
    } else if (filterStatus.value === 'failed') {
      vids = vids.filter(v => v.download_status === 'failed');
    }
  }

  // 3. Sort
  vids.sort((a, b) => {
    if (sortBy.value === 'date_desc') {
      return (b.upload_date || '').localeCompare(a.upload_date || '');
    } else if (sortBy.value === 'date_asc') {
      return (a.upload_date || '').localeCompare(b.upload_date || '');
    } else if (sortBy.value === 'views_desc') {
      return (b.view_count || 0) - (a.view_count || 0);
    } else if (sortBy.value === 'views_asc') {
      return (a.view_count || 0) - (b.view_count || 0);
    } else if (sortBy.value === 'duration_desc') {
      return (b.duration || 0) - (a.duration || 0);
    } else if (sortBy.value === 'duration_asc') {
      return (a.duration || 0) - (b.duration || 0);
    }
    return 0;
  });

  return vids;
});

const archivedVideos = computed(() => {
  return filteredVideos.value.filter((v: any) => v.download_status === 'completed' && v.is_short !== 1);
});

const archivedShorts = computed(() => {
  return filteredVideos.value.filter((v: any) => v.download_status === 'completed' && v.is_short === 1);
});

const queuedVideos = computed(() => {
  let list = [];
  if (filterStatus.value === 'downloading_pending') {
    list = filteredVideos.value.filter((v: any) => v.download_status === 'pending' || v.download_status === 'downloading');
  } else if (filterStatus.value === 'failed') {
    list = filteredVideos.value.filter((v: any) => v.download_status === 'failed');
  } else {
    list = filteredVideos.value.filter((v: any) => v.download_status !== 'completed');
  }
  
  // Sort currently downloading videos to the top of the grid
  return [...list].sort((a: any, b: any) => {
    if (a.download_status === 'downloading' && b.download_status !== 'downloading') return -1;
    if (b.download_status === 'downloading' && a.download_status !== 'downloading') return 1;
    return 0;
  });
});

const parseETAToSeconds = (etaStr: string | null | undefined): number => {
  if (!etaStr) return 0;
  const cleaned = etaStr.trim();
  if (cleaned === '--:--' || cleaned.toLowerCase().includes('waiting')) return 0;
  const parts = cleaned.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) {
    return parts[0]! * 60 + parts[1]!;
  } else if (parts.length === 3) {
    return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  }
  return 0;
};

const smoothProgress = ref<Record<string, number>>({});
const progressRates = ref<Record<string, number>>({});
let lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
let animationFrameId: any = null;

const updateSmoothProgress = (now: number) => {
  const dt = now - lastFrameTime;
  lastFrameTime = now;

  let hasActive = false;
  queuedVideos.value.forEach(video => {
    const id = video.id;
    const target = video.download_progress || 0;
    
    if (video.download_status !== 'downloading') {
      smoothProgress.value[id] = target;
      return;
    }

    if (smoothProgress.value[id] === undefined) {
      smoothProgress.value[id] = target;
    }

    const rate = progressRates.value[id] || 0;
    if (rate > 0 && smoothProgress.value[id]! < target) {
      const nextProgress = smoothProgress.value[id]! + rate * dt;
      smoothProgress.value[id] = Math.min(nextProgress, target);
      if (smoothProgress.value[id]! < target) {
        hasActive = true;
      }
    }
  });

  const hasActiveDownloads = queuedVideos.value.some((v: any) => v.download_status === 'downloading');
  if (hasActive || hasActiveDownloads) {
    animationFrameId = requestAnimationFrame(updateSmoothProgress);
  } else {
    animationFrameId = null;
  }
};

watch(() => queuedVideos.value, () => {
  queuedVideos.value.forEach(video => {
    const id = video.id;
    const target = video.download_progress || 0;
    
    if (video.download_status !== 'downloading') {
      smoothProgress.value[id] = target;
      progressRates.value[id] = 0;
      return;
    }

    if (smoothProgress.value[id] === undefined) {
      smoothProgress.value[id] = target;
    }

    const currentSmooth = smoothProgress.value[id]!;
    const diff = target - currentSmooth;
    
    if (diff < -2 || Math.abs(diff) > 40 || target === 0 || target === 100) {
      smoothProgress.value[id] = target;
      progressRates.value[id] = 0;
    } else if (diff > 0) {
      progressRates.value[id] = diff / 1000;
    } else {
      progressRates.value[id] = 0;
    }
  });

  const hasActiveDownloads = queuedVideos.value.some((v: any) => v.download_status === 'downloading');
  if (!animationFrameId && hasActiveDownloads) {
    lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    updateSmoothProgress(lastFrameTime);
  }
}, { deep: true });

onUnmounted(() => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
});

const clearSelection = () => {
  selectedVideoIds.value = [];
};

const isAllFilteredSelected = computed(() => {
  const selectables = queuedVideos.value;
  if (selectables.length === 0) return false;
  return selectables.every(v => selectedVideoIds.value.includes(v.id));
});

const toggleSelectAllFiltered = () => {
  const selectables = queuedVideos.value;
  if (isAllFilteredSelected.value) {
    selectedVideoIds.value = selectedVideoIds.value.filter(id => !selectables.some(v => v.id === id));
  } else {
    const newIds = new Set([...selectedVideoIds.value, ...selectables.map(v => v.id)]);
    selectedVideoIds.value = Array.from(newIds);
  }
};

const handleBatchAction = async (action: 'queue' | 'prioritize') => {
  if (selectedVideoIds.value.length === 0) return;
  try {
    await $fetch('/api/admin/downloader/queue-videos', {
      method: 'POST',
      body: {
        videoIds: selectedVideoIds.value,
        action
      }
    });
    
    toast.success(`${selectedVideoIds.value.length} video(s) added to queue.`);
    clearSelection();
    refreshVideos();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Batch action failed.');
  }
};

const handleDownloadAll = async () => {
  if (queuedVideos.value.length === 0) return;
  if (!confirm(`Do you want to add the ${queuedVideos.value.length} videos of this channel to the download queue?`)) {
    return;
  }
  try {
    const videoIds = queuedVideos.value.map((v: any) => v.id);
    await $fetch('/api/admin/downloader/queue-videos', {
      method: 'POST',
      body: {
        videoIds,
        action: 'queue'
      }
    });
    toast.success(`${videoIds.length} video(s) added to queue.`);
    refreshVideos();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to start downloads.');
  }
};

const toggleSelection = (id: string) => {
  const index = selectedVideoIds.value.indexOf(id);
  if (index > -1) {
    selectedVideoIds.value.splice(index, 1);
  } else {
    selectedVideoIds.value.push(id);
  }
};

const handleUpdateChannelVisibility = async (event: Event) => {
  const select = event.target as HTMLSelectElement;
  const visibility = select.value;
  try {
    await $fetch(`/api/admin/channels/${channelId.value}/visibility`, {
      method: 'PUT',
      body: { visibility }
    });
    toast.success('Channel visibility updated.');
    refreshSingleChannel();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Update failed.');
  }
};

const handleUpdateVideoVisibility = async (videoId: string, event: Event) => {
  const select = event.target as HTMLSelectElement;
  const visibility = select.value;
  try {
    await $fetch(`/api/admin/videos/${videoId}/visibility`, {
      method: 'PUT',
      body: { visibility }
    });
    toast.success('Video visibility updated.');
    refreshVideos();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Update failed.');
  }
};

const copyShareLink = (video: any) => {
  let shareUrl = window.location.origin + '/watch/' + video.id;
  if (video.visibility !== 'public' && video.share_token) {
    shareUrl += '?token=' + video.share_token;
  }
  
  navigator.clipboard.writeText(shareUrl);
  toast.success('Share link copied.');
};

const formatVisibility = (vis: string): string => {
  switch (vis) {
    case 'public': return 'Public';
    case 'private': return 'Private';
    case 'ultra_private': return 'Ultra Private';
    default: return vis || 'Public';
  }
};

const getVisBadgeClass = (vis: string): string => {
  switch (vis) {
    case 'public': return 'badge-completed';
    case 'private': return 'badge-downloading';
    case 'ultra_private': return 'badge-failed';
    default: return 'badge-completed';
  }
};

// Preferences form state
const formPref = reactive({
  downloadVideos: true,
  downloadShorts: false,
  dateAfter: '',
  customSavePath: ''
});
const savingPref = ref(false);
const prefMessage = ref('');
const showDrawer = ref(false);
const triggeringSync = ref(false);

const subscribed = ref(false);

const fetchSubscriptionStatus = async () => {
  if (!channelId.value) return;
  try {
    const res = await $fetch<any>(`/api/channels/${channelId.value}/subscription`);
    subscribed.value = res.subscribed;
  } catch (err) {
    console.error('Failed to fetch subscription status:', err);
  }
};

const handleToggleSubscription = async () => {
  if (!channelId.value) return;
  const endpoint = subscribed.value ? 'unsubscribe' : 'subscribe';
  try {
    await $fetch(`/api/channels/${channelId.value}/${endpoint}`, { method: 'POST' });
    subscribed.value = !subscribed.value;
    toast.success(subscribed.value ? 'Subscription saved.' : 'Subscription removed.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  }
};

// Populate preferences state when channel details load
let lastLoadedChannelId = '';

watch(channel, (newVal) => {
  if (newVal) {
    // Only populate formPref if the channel ID has changed, preventing polling resets
    if (newVal.id !== lastLoadedChannelId) {
      lastLoadedChannelId = newVal.id;
      formPref.downloadVideos = newVal.download_videos === 1;
      formPref.downloadShorts = newVal.download_shorts === 1;
      formPref.customSavePath = newVal.custom_save_path || '';
      
      if (newVal.date_after && newVal.date_after.length === 8) {
        const y = newVal.date_after.slice(0, 4);
        const m = newVal.date_after.slice(4, 6);
        const d = newVal.date_after.slice(6, 8);
        formPref.dateAfter = `${y}-${m}-${d}`;
      } else {
        formPref.dateAfter = '';
      }
    }

    fetchSubscriptionStatus();

    // Auto-check YouTube in background if the channel has never been scanned (totalCount === 0)
    if (singleChannelData.value?.stats?.totalCount === 0 && !triggeringSync.value) {
      handleTriggerManualSync();
    }
  }
}, { immediate: true });

const handleSavePreferences = async () => {
  savingPref.value = true;
  prefMessage.value = '';
  try {
    await $fetch(`/api/admin/channels/${channelId.value}/options`, {
      method: 'PUT',
      body: {
        downloadVideos: formPref.downloadVideos,
        downloadShorts: formPref.downloadShorts,
        dateAfter: formPref.dateAfter || null,
        customSavePath: formPref.customSavePath || null
      }
    });
    toast.success('Download options saved.');
    lastLoadedChannelId = ''; // Allow the watch handler to re-sync state on successful save refresh
    refreshSingleChannel();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Save failed.');
  } finally {
    savingPref.value = false;
  }
};

const handleToggleSync = async (start: boolean) => {
  const endpoint = start ? 'sync' : 'pause';
  try {
    await $fetch(`/api/admin/channels/${channelId.value}/${endpoint}`, { method: 'POST' });
    toast.success(start ? 'Synchronization started.' : 'Synchronization paused.');
    refreshSingleChannel();
    refreshChannels();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  }
};

async function handleTriggerManualSync() {
  if (!channelId.value) return;
  triggeringSync.value = true;
  try {
    const channelUrl = `https://www.youtube.com/channel/${channelId.value}`;
    const res = await $fetch<any>('/api/admin/downloader/ingest', {
      method: 'POST',
      body: { url: channelUrl }
    });
    toast.success(res.message || 'Channel update completed.');
    refreshSingleChannel();
    refreshVideos();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to search videos.');
  } finally {
    triggeringSync.value = false;
  }
};

const handleDeleteChannel = async () => {
  if (!confirm(`WARNING: Are you sure you want to permanently delete the channel "${channel.value.title}" from the archive?\nThis will delete all downloaded videos from your disk and the database.`)) {
    return;
  }

  try {
    await $fetch(`/api/admin/channels/${channelId.value}`, { method: 'DELETE' });
    toast.success('Channel deleted.');
    goBack();
    refreshChannels();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to delete the channel.');
  }
};

const handleDeleteVideo = async (videoId: string, title: string) => {
  if (!confirm(`Permanently delete the video "${title}"?\nThe local file will be deleted.`)) {
    return;
  }

  try {
    await $fetch(`/api/admin/videos/${videoId}`, { method: 'DELETE' });
    toast.success('Video deleted.');
    refreshVideos();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Deletion failed.');
  }
};

const onVideoHidden = (id: string) => {
  if (videosData.value && videosData.value.videos) {
    videosData.value.videos = videosData.value.videos.filter((v: any) => v.id !== id);
  }
  if (selectedPlaylistData.value && selectedPlaylistData.value.videos) {
    selectedPlaylistData.value.videos = selectedPlaylistData.value.videos.filter((v: any) => v.id !== id);
  }
};

const handlePrioritizeTask = async (videoId: string) => {
  try {
    await $fetch('/api/admin/downloader/prioritize', {
      method: 'POST',
      body: { videoId }
    });
    refreshVideos();
    toast.success('Video prioritized.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Prioritization failed.');
  }
};

const cancelTask = async (videoId: string, title: string) => {
  if (!confirm(`Cancel download of "${title}"?`)) {
    return;
  }
  try {
    await $fetch('/api/admin/downloader/cancel', {
      method: 'POST',
      body: { videoId }
    });
    refreshVideos();
    toast.success('Download cancelled.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Cancellation failed.');
  }
};

const isSyncingAll = ref(false);
const isDownloaderPaused = ref(false);
let syncStatusInterval: any = null;

const checkDownloaderPausedStatus = async () => {
  if (!isAdmin.value) return;
  try {
    const data = await $fetch<any>('/api/admin/downloader/queue');
    isDownloaderPaused.value = data.isPaused || false;
  } catch (e) {}
};

const handleToggleDownloaderPause = async () => {
  const endpoint = isDownloaderPaused.value ? '/api/admin/downloader/resume' : '/api/admin/downloader/pause';
  try {
    await $fetch(endpoint, { method: 'POST' });
    isDownloaderPaused.value = !isDownloaderPaused.value;
    toast.success(isDownloaderPaused.value ? 'Downloads paused.' : 'Downloads resumed.');
    await pollStatus();
  } catch (err: any) {
    toast.error('Error changing downloader state.');
  }
};

const checkSyncAllStatus = async () => {
  if (!isAdmin.value) return;
  try {
    const data = await $fetch<any>('/api/admin/downloader/sync-all-status');
    const wasSyncing = isSyncingAll.value;
    isSyncingAll.value = data.active;
    
    if (wasSyncing && !data.active) {
      refreshChannels();
    }
  } catch (e) {}
};

const handleSyncAll = async () => {
  try {
    const res = await $fetch<any>('/api/admin/downloader/sync-all', { method: 'POST' });
    if (res.success) {
      isSyncingAll.value = true;
      toast.success('Update started.');
    } else {
      toast.error(res.message);
    }
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to start.');
  }
};

const pollStatus = async () => {
  if (isAdmin.value) {
    await checkSyncAllStatus();
    await checkDownloaderPausedStatus();
  }
  if (channelId.value) {
    await refreshVideos();
    await refreshSingleChannel();
  }
};

let syncStatusTimeout: any = null;

const runPolling = async () => {
  await pollStatus();
  // Poll faster (every 1s) if there is an active downloading video on this channel page, else poll every 3s
  const hasActiveDownloads = channelVideos.value.some((v: any) => v.download_status === 'downloading');
  const nextPollDelay = hasActiveDownloads ? 1000 : 3000;
  syncStatusTimeout = setTimeout(runPolling, nextPollDelay);
};

onMounted(() => {
  runPolling();
});

onUnmounted(() => {
  if (syncStatusTimeout) clearTimeout(syncStatusTimeout);
});

const selectChannel = (id: string) => {
  router.push({ path: '/channels', query: { channelId: id } });
};

const goBack = () => {
  router.push({ path: '/channels' });
};

const playVideo = (id: string) => {
  const vid = channelVideos.value.find((v: any) => v.id === id);
  if (vid && vid.download_status === 'completed') {
    navigateTo(`/watch/${id}`);
  } else {
    toast.info('Video not downloaded.');
  }
};

/* Format Helpers */
const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '--:--';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatDurationHours = (seconds: number | null): string => {
  if (!seconds) return '0h';
  const hrs = Math.ceil(seconds / 3600);
  return `${hrs}h`;
};

const formatViewsShort = (views: number | null): string => {
  if (!views) return '0';
  if (views >= 1000000) return (views / 1000000).toFixed(1).replace('.0', '') + 'M';
  if (views >= 1000) return (views / 1000).toFixed(1).replace('.0', '') + 'k';
  return views.toString();
};

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  const fallback = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';
  if (target && target.src !== fallback) {
    target.src = fallback;
  }
};

const formatBytes = (bytes: number | null): string => {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatViews = (views: number | null): string => {
  if (views === null || views === undefined) return '0';
  if (views >= 1000000) {
    return (views / 1000000).toFixed(1).replace('.0', '') + 'M';
  }
  if (views >= 1000) {
    return (views / 1000).toFixed(1).replace('.0', '') + 'k';
  }
  return views.toString();
};

const formatUploadDate = (dateStr: string | null): string => {
  if (!dateStr || dateStr.length !== 8) return 'Unknown date';
  const year = dateStr.slice(0, 4);
  const month = dateStr.slice(4, 6);
  const day = dateStr.slice(6, 8);
  
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatStatus = (status: string): string => {
  switch (status) {
    case 'pending': return 'Pending';
    case 'downloading': return 'Downloading';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    default: return status;
  }
};

const getBadgeClass = (status: string): string => {
  switch (status) {
    case 'pending': return 'badge-pending';
    case 'downloading': return 'badge-downloading';
    case 'completed': return 'badge-completed';
    case 'failed': return 'badge-failed';
    default: return '';
  }
};
</script>

<style scoped>
.channels-page {
  display: flex;
  flex-direction: column;
}

.directory-header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}

.directory-header-row .page-title {
  margin-bottom: 0;
}

.page-title {
  font-size: 24px;
  margin-bottom: 24px;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 0;
  gap: 16px;
  color: var(--text-secondary);
}

.loading-state .spinner, .videos-loading .spinner {
  width: 36px;
  height: 36px;
  border: 3.5px solid rgba(139, 92, 246, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 40px;
  text-align: center;
  border-radius: var(--border-radius-md);
  gap: 16px;
}

.empty-state h3 {
  font-size: 20px;
}

.empty-state p {
  color: var(--text-secondary);
  font-size: 14px;
  max-width: 450px;
  line-height: 1.5;
}

.channel-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(295px, 1fr));
  gap: 24px;
}

.channel-card {
  display: flex;
  flex-direction: column;
  border-radius: var(--border-radius-lg);
  cursor: pointer;
  border: 1px solid var(--border-color);
  background: rgba(17, 17, 34, 0.4);
  overflow: hidden;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), border-color 0.3s ease, box-shadow 0.3s ease;
}

.channel-card:hover {
  transform: translateY(-4px);
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 12px 32px rgba(139, 92, 246, 0.15);
  background: rgba(17, 17, 34, 0.6);
}

.channel-card-banner {
  height: 90px;
  width: 100%;
  background: linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%);
  background-size: cover;
  background-position: center;
  position: relative;
}

.channel-card-banner-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.2);
}

.channel-card-sync-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 20px;
  text-transform: uppercase;
}

.channel-card-sync-badge.downloading {
  background: rgba(16, 185, 129, 0.85);
  color: white;
  box-shadow: 0 2px 6px rgba(16, 185, 129, 0.4);
}

.channel-card-sync-badge.paused {
  background: rgba(239, 68, 68, 0.85);
  color: white;
}

.channel-card-body {
  display: flex;
  flex-direction: column;
  padding: 16px;
  position: relative;
  flex: 1;
}

.channel-card-avatar-wrapper {
  position: absolute;
  top: -36px;
  left: 16px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: 3px solid #06060c;
  overflow: hidden;
  background: var(--bg-surface);
  box-shadow: var(--shadow-sm);
  transition: transform 0.25s ease;
}

.channel-card:hover .channel-card-avatar-wrapper {
  transform: scale(1.05);
}

.channel-card-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.channel-card-info {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.channel-card-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channel-card-desc {
  font-size: 12.5px;
  color: var(--text-secondary);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.channel-card-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}

.stat-badge {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}

.visibility-pill {
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  text-transform: uppercase;
}

.visibility-pill.public {
  background: rgba(16, 185, 129, 0.1);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.visibility-pill.private {
  background: rgba(239, 68, 68, 0.1);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.visibility-pill.unlisted {
  background: rgba(234, 179, 8, 0.1);
  color: #fbbf24;
  border: 1px solid rgba(234, 179, 8, 0.2);
}

/* Detail View Styles */
.channel-detail-view {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.back-btn {
  align-self: flex-start;
}

.channel-banner-container {
  height: 180px;
  width: 100%;
  border-radius: var(--border-radius-lg);
  background: linear-gradient(135deg, rgba(139, 92, 246, 0.08) 0%, rgba(18, 18, 34, 0.8) 100%);
  position: relative;
  overflow: hidden;
  box-shadow: var(--shadow-md);
}

.banner-overlay {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 10% 20%, rgba(0, 0, 0, 0.4) 0%, transparent 90%);
}

.channel-profile-header {
  display: flex;
  gap: 24px;
  padding: 0 16px;
  align-items: flex-start;
}

@media (max-width: 600px) {
  .channel-profile-header {
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
}

.channel-profile-avatar {
  width: 100px;
  height: 100px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--bg-surface);
  border: 3px solid #06060c;
  box-shadow: var(--shadow-md);
}

.channel-profile-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.channel-profile-title {
  font-size: 24px;
  font-weight: 800;
}

.channel-profile-meta {
  font-size: 13px;
  color: var(--text-secondary);
  font-weight: 500;
}

.channel-profile-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
  max-width: 800px;
}

.channel-actions-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 10px;
}

/* Admin Preferences Panel */
.admin-preferences-panel {
  padding: 20px;
  border-radius: var(--border-radius-md);
  display: flex;
  flex-direction: column;
  gap: 16px;
  margin-top: 8px;
}

.pref-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  flex-wrap: wrap;
}

.panel-subtitle {
  font-size: 14px;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--text-secondary);
  letter-spacing: 0.02em;
}

.sync-actions {
  display: flex;
  gap: 12px;
}

.sync-btn {
  height: 40px;
  font-size: 13.5px;
  font-weight: 600;
  border-radius: var(--border-radius-md);
  transition: all 0.2s ease;
}

.start-sync-btn {
  background: linear-gradient(135deg, #10b981, #059669);
  color: white;
  box-shadow: 0 4px 12px rgba(16, 185, 129, 0.2);
}

.start-sync-btn:hover {
  background: linear-gradient(135deg, #059669, #047857);
  transform: translateY(-1px);
}

.pause-sync-btn {
  border: 1px solid rgba(234, 179, 8, 0.4);
  color: #fbbf24;
  background: rgba(234, 179, 8, 0.05);
}

.pause-sync-btn:hover {
  background: rgba(234, 179, 8, 0.15);
  border-color: rgba(234, 179, 8, 0.6);
  transform: translateY(-1px);
}

.critical-delete-btn {
  background: #dc2626;
  color: white;
  box-shadow: 0 4px 12px rgba(220, 38, 38, 0.2);
  height: 40px;
  font-size: 13.5px;
  font-weight: 600;
  border-radius: var(--border-radius-md);
  transition: all 0.2s ease;
}

.critical-delete-btn:hover {
  background: #b91c1c;
  transform: translateY(-1px);
}

.pref-form {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 24px;
  flex-wrap: wrap;
}

.pref-checkboxes {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.check-item-btn {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 8px 16px;
  border-radius: 20px;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.check-item-btn input {
  cursor: pointer;
}

.check-item-btn:hover {
  background: rgba(255, 255, 255, 0.03);
}

.check-item-btn.checked {
  border-color: var(--accent-primary);
  background: rgba(139, 92, 246, 0.05);
}

.pref-date-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.date-input-row {
  display: flex;
  gap: 8px;
}

.date-input {
  width: 160px;
  height: 36px;
  padding: 0 12px;
  border-radius: var(--border-radius-sm);
}

.save-pref-btn {
  height: 36px;
  font-size: 13px;
  padding: 0 16px;
}

.pref-msg {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: var(--border-radius-sm);
  align-self: flex-start;
}

/* Videos List Grid */
.channel-videos-section {
  border-top: 1px solid var(--border-color);
  padding-top: 24px;
}

.section-title {
  font-size: 18px;
  margin-bottom: 20px;
}

.videos-loading {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.videos-empty {
  padding: 40px;
  text-align: center;
  color: var(--text-secondary);
  border-radius: var(--border-radius-md);
}

.video-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 24px;
}

@media (max-width: 1024px) {
  .video-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .video-grid {
    grid-template-columns: 1fr;
  }
}

.video-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
}

.thumbnail-wrapper {
  position: relative;
  aspect-ratio: 16/9;
  border-radius: var(--border-radius-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  background: #000;
  border: 1px solid transparent;
  transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
}

.thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.5s cubic-bezier(0.25, 1, 0.5, 1);
}

.thumbnail-wrapper::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 40%;
  background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
  pointer-events: none;
}

.duration-badge {
  position: absolute;
  bottom: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.8);
  padding: 2px 4px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 600;
  z-index: 2;
}

.status-overlay-badge {
  position: absolute;
  bottom: 6px;
  left: 6px;
  z-index: 2;
  font-size: 9px;
  padding: 2px 4px;
}

.delete-video-btn {
  position: absolute;
  top: 6px;
  right: 6px;
  background: rgba(0, 0, 0, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  z-index: 3;
}

.delete-video-btn:hover {
  background: #dc2626;
  color: white;
  transform: scale(1.1);
  box-shadow: 0 2px 8px rgba(220, 38, 38, 0.5);
}

.video-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px;
}

.video-title {
  font-family: var(--font-title);
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}

.metadata-row {
  display: flex;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}

.premium-card:hover .thumbnail-img {
  transform: scale(1.06);
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 0.8s linear infinite;
  display: inline-block;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* Barres de tri / filtrage / batch actions */
.videos-section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
  flex-wrap: wrap;
  gap: 12px;
}

.batch-actions-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-radius: var(--border-radius-sm);
  background: rgba(139, 92, 246, 0.05);
  border: 1px solid rgba(139, 92, 246, 0.2);
}

.selected-count {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.btn-sm {
  height: 28px;
  padding: 0 10px;
  font-size: 11px;
}

.btn-text {
  background: transparent;
  border: none;
  color: var(--text-secondary);
}

.btn-text:hover {
  color: var(--text-primary);
}

.gold-border {
  border-color: rgba(234, 179, 8, 0.4);
  color: #fbbf24;
}

.gold-border:hover {
  background: rgba(234, 179, 8, 0.1);
}

.filter-sort-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-radius: var(--border-radius-md);
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 16px;
}

.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 0 12px;
  border-radius: 40px;
  height: 36px;
  width: 260px;
}

.search-box svg {
  color: var(--text-secondary);
}

.filter-input {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-size: 13px;
  width: 100%;
}

.filter-input:focus {
  outline: none;
}

.filters-group {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.filter-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.filter-item label {
  color: var(--text-secondary);
  font-weight: 500;
}

.filter-select {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
  border-radius: var(--border-radius-sm);
  padding: 4px 10px;
  font-size: 13px;
  outline: none;
}

.filter-select:focus {
  border-color: var(--accent-primary);
}

/* Checkbox overlay styling */
.select-checkbox-wrapper {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 3;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 4px;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: all 0.2s;
}

.select-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--accent-primary);
}

.video-card-selected .thumbnail-wrapper {
  box-shadow: 0 0 0 2px var(--accent-primary) !important;
}

/* Visibility Quick Actions styling */
.admin-video-actions {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(0, 0, 0, 0.85);
  padding: 4px 6px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.action-icon-btn, .delete-video-btn-overlay {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  transition: all 0.2s;
}

.action-icon-btn:hover {
  color: white;
  background: rgba(255, 255, 255, 0.1);
}

.delete-video-btn-overlay:hover {
  color: white;
  background: #dc2626;
}

.visibility-quick-select {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 11px;
  cursor: pointer;
  outline: none;
  font-weight: 600;
  padding-right: 4px;
}

.visibility-quick-select option {
  background: #121212;
  color: white;
}

/* Stats Row and Cards */
.channel-stats-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-top: 16px;
  margin-bottom: 24px;
}
@media (max-width: 900px) {
  .channel-stats-row {
    grid-template-columns: repeat(2, 1fr);
  }
}
@media (max-width: 500px) {
  .channel-stats-row {
    grid-template-columns: 1fr;
  }
}
.channel-stats-row .stat-card {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.04);
  padding: 16px;
  border-radius: var(--border-radius-md);
  display: flex;
  align-items: center;
  gap: 16px;
}
.channel-stats-row .stat-icon {
  background: rgba(139, 92, 246, 0.1);
  border-radius: var(--border-radius-sm);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent-primary);
  flex-shrink: 0;
}
.channel-stats-row .stat-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.channel-stats-row .stat-value {
  font-family: var(--font-title);
  font-size: 16px;
  font-weight: 800;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.channel-stats-row .stat-label {
  font-size: 11px;
  color: var(--text-secondary);
  text-transform: uppercase;
  font-weight: 600;
  letter-spacing: 0.05em;
}

/* Tabs Bar */
.channel-tabs-bar {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  margin-bottom: 24px;
}
.channel-tabs-bar .tab-btn {
  background: transparent;
  border: none;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 10px 16px;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: var(--border-radius-sm) var(--border-radius-sm) 0 0;
}
.channel-tabs-bar .tab-btn.active {
  color: white !important;
  border-bottom-color: var(--accent-primary) !important;
  background: rgba(255, 255, 255, 0.03);
}
.channel-tabs-bar .tab-btn:hover {
  color: white !important;
  background: rgba(255, 255, 255, 0.02);
}
.channel-tabs-bar .tab-count {
  background: rgba(255, 255, 255, 0.08);
  padding: 1px 6px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 700;
}

/* Queue List styling */
.queue-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.queue-card {
  padding: 16px 20px;
  border-radius: var(--border-radius-md);
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
  transition: all 0.2s ease;
}

/* Checkbox overlay on thumbnail */
.select-checkbox-overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 5;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 4px;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(4px);
  transition: all 0.2s;
}
.select-checkbox-overlay:hover {
  background: rgba(139, 92, 246, 0.2);
  border-color: var(--accent-primary);
}
.select-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: var(--accent-primary);
  margin: 0;
}

/* Status badge overlay on thumbnail */
.queue-status-badge {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 4;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 8px;
  border-radius: 4px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}

/* Admin actions on queue card */
.queue-actions-overlay {
  position: absolute;
  bottom: 8px;
  left: 8px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(0, 0, 0, 0.85);
  padding: 4px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(4px);
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.2s ease;
  transform: translateY(4px);
}

.video-card:hover .queue-actions-overlay {
  opacity: 1;
  transform: translateY(0);
}

/* Selected state card glow and background */
.video-card-selected {
  background: rgba(139, 92, 246, 0.05) !important;
  border-color: rgba(139, 92, 246, 0.3) !important;
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.1) !important;
}
.queue-card-header {
  display: flex;
  align-items: center;
  gap: 16px;
}
.queue-card-header .title-col {
  flex: 1;
  min-width: 0;
}
.queue-card-header .video-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-primary);
}
.queue-card-header .channel-title {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.queue-card-header .status-col {
  flex-shrink: 0;
}
.queue-card-progress-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.queue-card .progress-container,
.queue-progress-container {
  height: 6px;
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  overflow: hidden;
}
.queue-card .progress-bar,
.queue-progress-bar-fill {
  height: 100%;
  background: linear-gradient(
    90deg,
    var(--accent-primary) 0%,
    var(--accent-secondary) 50%,
    var(--accent-primary) 100%
  );
  background-size: 200% 100%;
  border-radius: 3px;
  box-shadow: 0 0 8px var(--accent-primary-glow), 0 0 3px var(--accent-primary);
  animation: progress-shimmer 2.5s infinite linear;
  transition: width 0.4s cubic-bezier(0.25, 0.8, 0.25, 1);
}

@keyframes progress-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -100% 0;
  }
}
.queue-card .progress-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 600;
}
.queue-card .speed-eta {
  color: var(--text-muted);
}
.prioritize-task-btn:hover {
  background: rgba(250, 204, 21, 0.2) !important;
  color: #fbbf24 !important;
  border-color: #eab308 !important;
  transform: scale(1.05);
}
.cancel-task-btn {
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-secondary);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}
.cancel-task-btn:hover {
  background: #dc2626;
  color: white;
  border-color: #dc2626;
  transform: scale(1.05);
  box-shadow: 0 2px 8px rgba(220, 38, 38, 0.4);
}

/* Modal styling */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}
.modal-card {
  width: 460px;
  max-width: 90%;
  border-radius: var(--border-radius-lg);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.modal-header {
  padding: 18px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
}
.modal-header h3 {
  font-size: 16px;
  font-weight: 700;
  margin: 0;
  color: white;
}
.close-modal-btn {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.2s;
  line-height: 1;
}
.close-modal-btn:hover {
  color: white;
}
.modal-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-height: 350px;
  overflow-y: auto;
}
.modal-desc {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.4;
}
.modal-empty-state {
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
  padding: 24px 0;
}
.modal-categories-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.modal-check-item {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 10px 12px;
  border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  cursor: pointer;
  transition: all 0.2s;
}
.modal-check-item:hover {
  background: rgba(139, 92, 246, 0.05);
  border-color: rgba(139, 92, 246, 0.2);
}
.modal-check-item input[type="checkbox"] {
  margin-top: 3px;
  cursor: pointer;
  accent-color: var(--accent-primary);
}
.check-item-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.check-item-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.check-item-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.3;
}
.modal-footer {
  padding: 16px 24px;
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  border-top: 1px solid var(--border-color);
  background: rgba(0, 0, 0, 0.2);
}
.sync-warning-banner {
  display: flex;
  gap: 16px;
  padding: 16px 20px;
  border-radius: var(--border-radius-md);
  border: 1px solid rgba(234, 179, 8, 0.3);
  background: rgba(234, 179, 8, 0.05);
  align-items: flex-start;
  margin-bottom: 8px;
}
.warning-text {
  display: flex;
  flex-direction: column;
}
.shorts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 20px;
}
.shorts-grid .thumbnail-wrapper {
  aspect-ratio: 9/16 !important;
}
.short-badge {
  position: absolute;
  top: 6px;
  left: 6px;
  background: #ff0000;
  color: white;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  z-index: 2;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
}
</style>
