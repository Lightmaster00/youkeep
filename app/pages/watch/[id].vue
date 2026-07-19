<template>
  <div class="watch-container">
    <div v-if="pending" class="loading-state">
      <div class="spinner"></div>
      <p>Loading video...</p>
    </div>

    <EmptyState
      v-else-if="error || !video"
      title="Loading Error"
      :description="errorMsg || 'This video was not found or you do not have permission to view it.'"
      icon="video"
      action-text="Back to Home"
      action-route="/"
    />

    <div v-else class="watch-content">
      <!-- Left Column (Player + Description) -->
      <div class="player-column">
        <!-- Custom Video Player -->
        <div 
          class="video-player-container" 
          ref="playerContainer"
          @mouseenter="showControls = true"
          @mouseleave="handleMouseLeave"
          @mousemove="handleMouseMove"
          @dblclick="toggleFullscreen"
          :class="{ 'controls-visible': showControls || isPaused, 'is-short-player': video?.is_short === 1 }"
          tabindex="0"
          @keydown="handleKeydown"
        >
          <video 
            ref="videoPlayer"
            class="video-player" 
            :poster="video.local_thumbnail_path || (video.id ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` : '')"
            :src="video.local_video_path ? `${video.local_video_path}${token ? `?token=${token}` : ''}` : ''"
            preload="metadata"
            :loop="video?.is_short === 1"
            @click="togglePlay"
            @timeupdate="onTimeUpdate"
            @loadedmetadata="onMetadataLoaded"
            @durationchange="onDurationChange"
            @play="onPlayTrigger"
            @pause="onPauseTrigger"
            @ended="handleVideoEnded"
            @volumechange="onVolumeChange"
            @waiting="isBuffering = true"
            @canplay="isBuffering = false"
          >
            <track 
              v-for="sub in subtitles"
              :key="sub.code"
              kind="subtitles"
              :src="sub.url + (token ? `?token=${token}` : '')"
              :srclang="sub.code"
              :label="sub.label"
            />
            Your browser does not support video playback.
          </video>

          <!-- Buffering Spinner Overlay -->
          <div v-if="isBuffering" class="player-buffering">
            <div class="player-spinner"></div>
          </div>

          <!-- Big Play Button (when paused & not playing) -->
          <div v-if="isPaused && !isBuffering" class="big-play-overlay" @click="togglePlay">
            <div class="big-play-btn">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </div>
          </div>

          <!-- Custom Controls Bar -->
          <div class="player-controls" @click.stop>
            <!-- Progress Bar -->
            <div 
              class="progress-bar-container" 
              ref="progressBarEl"
              @mousedown="startScrubbing"
              @mousemove="onProgressHover"
              @mouseleave="progressHoverPercent = -1"
            >
              <div class="progress-buffered" :style="{ width: bufferedPercent + '%' }"></div>
              <div class="progress-played" :style="{ width: playedPercent + '%' }"></div>
              <div class="progress-scrubber" :style="{ left: playedPercent + '%' }"></div>
              <!-- Time Preview Tooltip -->
              <div 
                v-if="progressHoverPercent >= 0" 
                class="progress-tooltip"
                :style="{ left: Math.min(Math.max(progressHoverPercent, 5), 95) + '%' }"
              >
                {{ formatTime((progressHoverPercent / 100) * videoDuration) }}
              </div>
            </div>

            <div class="controls-row">
              <!-- Left Controls -->
              <div class="controls-left">
                <!-- Play / Pause -->
                <button class="ctrl-btn" @click="togglePlay" :title="isPaused ? 'Play (Space)' : 'Pause (Space)'">
                  <svg v-if="isPaused" xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  <svg v-else xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="white" stroke="none"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
                </button>

                <!-- Playlist Prev Video -->
                <button 
                  v-if="playlistId && hasPrevVideo" 
                  class="ctrl-btn" 
                  @click="playPrevVideo" 
                  title="Previous Video"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="4" x2="5" y2="20" stroke="white" stroke-width="2"></line></svg>
                </button>

                <!-- Playlist Next Video -->
                <button 
                  v-if="playlistId && hasNextVideo" 
                  class="ctrl-btn" 
                  @click="playNextVideo" 
                  title="Next Video"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white" stroke="none"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="4" x2="19" y2="20" stroke="white" stroke-width="2"></line></svg>
                </button>

                <!-- Skip Backward 10s -->
                <button class="ctrl-btn" @click="skip(-10)" title="Rewind 10s (←)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path><text x="12" y="16" font-size="7" fill="white" stroke="none" text-anchor="middle" font-weight="bold">10</text></svg>
                </button>

                <!-- Skip Forward 10s -->
                <button class="ctrl-btn" @click="skip(10)" title="Forward 10s (→)">
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path><text x="12" y="16" font-size="7" fill="white" stroke="none" text-anchor="middle" font-weight="bold">10</text></svg>
                </button>

                <!-- Volume -->
                <div class="volume-control">
                  <button class="ctrl-btn" @click="toggleMute" :title="isMuted ? 'Unmute (M)' : 'Mute (M)'">
                    <svg v-if="isMuted || currentVolume === 0" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
                    <svg v-else-if="currentVolume < 0.5" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                    <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
                  </button>
                  <input 
                    type="range" 
                    min="0" max="1" step="0.01"
                    :value="currentVolume"
                    @input="setVolume($event)"
                    class="volume-slider"
                  />
                </div>

                <!-- Time Display -->
                <span class="time-display">
                  {{ formatTime(currentTime) }} / {{ formatTime(videoDuration) }}
                </span>
              </div>

              <!-- Right Controls -->
              <div class="controls-right">
                <!-- Speed Selector -->
                <div class="speed-control" ref="speedMenuRef">
                  <button class="ctrl-btn speed-btn" @click="toggleSpeedMenu" title="Playback Speed">
                    <span class="speed-label">{{ currentSpeed === 1 ? '1x' : currentSpeed + 'x' }}</span>
                  </button>
                  <div v-if="showSpeedMenu" class="speed-menu">
                    <button 
                      v-for="speed in playbackSpeeds" 
                      :key="speed"
                      class="speed-option" 
                      :class="{ active: currentSpeed === speed }"
                      @click="setSpeed(speed)"
                    >
                      {{ speed === 1 ? 'Normal' : speed + 'x' }}
                    </button>
                  </div>
                </div>

                <!-- Subtitles Selector -->
                <div v-if="subtitles && subtitles.length > 0" class="subtitles-control" ref="subtitlesMenuRef">
                  <button 
                    class="ctrl-btn cc-btn" 
                    :class="{ active: activeSubtitleCode !== 'off' }" 
                    @click="toggleSubtitlesMenu" 
                    title="Subtitles/CC"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2" ry="2"></rect><line x1="7" y1="10" x2="11" y2="10"></line><line x1="7" y1="14" x2="17" y2="14"></line><line x1="15" y1="10" x2="17" y2="10"></line></svg>
                  </button>
                  <div v-if="showSubtitlesMenu" class="subtitles-menu">
                    <button 
                      class="subtitles-option" 
                      :class="{ active: activeSubtitleCode === 'off' }"
                      @click="selectSubtitle('off')"
                    >
                      Off
                    </button>
                    <button 
                      v-for="sub in subtitles" 
                      :key="sub.code"
                      class="subtitles-option" 
                      :class="{ active: activeSubtitleCode === sub.code }"
                      @click="selectSubtitle(sub.code)"
                    >
                      {{ sub.label }}
                    </button>
                  </div>
                </div>

                <!-- Fullscreen -->
                <button class="ctrl-btn" @click="toggleFullscreen" title="Fullscreen (F)">
                  <svg v-if="!isFullscreen" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                  <svg v-else xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Video Header Info -->
        <h1 class="video-title">{{ video.title }}</h1>
        

        
        <!-- Channel Row -->
        <div class="channel-row">
          <div class="channel-info" @click="navigateToChannel(video.channel_id)">
            <img 
              :src="video.channel_avatar || 'data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 24 24\' fill=\'%23666\'><circle cx=\'12\' cy=\'12\' r=\'10\'></circle><path d=\'M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z\'></path></svg>'" 
              @error="handleAvatarError"
              class="channel-avatar" 
              alt="Avatar"
            />
            <div>
              <h3 class="channel-name">{{ video.channel_title }}</h3>
              <p class="sub-count">Archived in YouKeep</p>
            </div>
          </div>
          
          <div class="action-buttons" style="display: flex; gap: 8px; align-items: center;">
            <button class="btn btn-secondary" @click="shareVideo">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
              Share
            </button>
            <div class="dropdown-wrapper" ref="dropdownWrapperRef" style="position: relative;">
              <button class="btn btn-secondary" style="width: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center;" @click.stop="toggleWatchOptionsMenu" title="More options">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle><circle cx="5" cy="12" r="1.5"></circle></svg>
              </button>
              
              <transition name="dropdown-fade">
                <div v-if="isWatchOptionsMenuOpen" class="watch-options-menu glass-panel" style="position: absolute; right: 0; top: 100%; margin-top: 8px; width: 220px; padding: 8px; border-radius: 12px; z-index: 50; display: flex; flex-direction: column; gap: 4px; box-shadow: 0 10px 40px rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.08);">
                  <button v-if="user" class="dropdown-item" @click="openPlaylistsModalWrapper">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="15" y1="10" x2="9" y2="10"/></svg>
                    Save
                  </button>
                  <button v-if="video?.local_video_path" class="dropdown-item" @click="downloadLocalCopyWrapper">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    Download
                  </button>
                  <div class="dropdown-divider" style="height: 1px; background: rgba(255, 255, 255, 0.06); margin: 4px 0;"></div>
                  <button class="dropdown-item text-danger" @click="reportWatchVideo">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>
                    Report
                  </button>
                </div>
              </transition>
            </div>
          </div>
        </div>

        <!-- Collapsible Description Box -->
        <div class="description-box glass-panel" :class="{ expanded: descriptionExpanded }">
          <div class="description-meta">
            <span class="view-count">{{ formatViews(video.view_count) }} views</span>
            <span class="meta-dot">•</span>
            <span class="upload-date">{{ formatUploadDate(video.upload_date) }}</span>
            <template v-if="video.like_count">
              <span class="meta-dot">•</span>
              <span class="like-count">👍 {{ formatViews(video.like_count) }} likes</span>
            </template>
          </div>
          
          <p class="description-text">{{ video.description || 'No description available.' }}</p>
          
          <button class="toggle-desc-btn" @click="descriptionExpanded = !descriptionExpanded">
            {{ descriptionExpanded ? 'Show less' : 'Show more' }}
          </button>
        </div>

        <!-- Collapsible Technical Details Box -->
        <div class="tech-details-box glass-panel" :class="{ expanded: techDetailsExpanded }">
          <div class="tech-details-header" @click="techDetailsExpanded = !techDetailsExpanded">
            <div class="tech-details-title-row">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gradient"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              <h3 class="tech-details-label">Archive Technical Details</h3>
            </div>
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              width="14" 
              height="14" 
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              stroke-width="2"
              class="chevron-icon"
              :style="techDetailsExpanded ? { transform: 'rotate(180deg)' } : {}"
            ><polyline points="6 9 12 15 18 9"></polyline></svg>
          </div>
          
          <div v-show="techDetailsExpanded" class="tech-details-content">
            <div class="tech-grid">
              <div class="tech-item">
                <span class="tech-label">YouTube ID:</span>
                <code class="tech-value">{{ video.id }}</code>
              </div>
              <div class="tech-item">
                <span class="tech-label">Local Import Date:</span>
                <span class="tech-value">{{ formatTimestamp(video.created_at) }}</span>
              </div>
              <div class="tech-item">
                <span class="tech-label">Disk space occupied:</span>
                <span class="tech-value">{{ formatBytes(video.size_bytes) }}</span>
              </div>
              <div class="tech-item" v-if="video.local_video_path">
                <span class="tech-label">Server path:</span>
                <code class="tech-value" :title="video.local_video_path">{{ video.local_video_path }}</code>
              </div>
              <div class="tech-item">
                <span class="tech-label">Download status:</span>
                <span class="badge badge-completed">{{ video.download_status }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Section Comments -->
        <div class="comments-section glass-panel">
          <h3 class="comments-title">
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            <span>{{ comments.length }} Comments</span>
          </h3>

          <div v-if="comments.length === 0" class="comments-empty">
            No archived comments for this video.
          </div>

          <div v-else class="comments-list">
            <div v-for="comment in comments" :key="comment.id" class="comment-item">
              <img 
                v-if="comment.author_thumbnail" 
                :src="comment.author_thumbnail" 
                class="comment-avatar" 
                alt="Avatar"
              />
              <div v-else class="comment-avatar-fallback">
                {{ comment.author.charAt(0).toUpperCase() }}
              </div>
              <div class="comment-body">
                <div class="comment-header">
                  <span class="comment-author">{{ comment.author }}</span>
                  <span class="comment-time">{{ comment.time_text || 'some time ago' }}</span>
                </div>
                <p class="comment-text">{{ comment.text }}</p>
                <div class="comment-footer">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                  <span>{{ comment.like_count || 0 }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right Column (Recommendations Sidebar) -->
      <aside class="sidebar-column">
        <!-- Playlist Sidebar View -->
        <template v-if="playlistId && playlist">
          <div class="playlist-header-sidebar glass-panel" style="padding: 14px; border-radius: var(--border-radius-md); background: rgba(139, 92, 246, 0.05); border: 1px solid rgba(139, 92, 246, 0.15); margin-bottom: 16px;">
            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--accent-primary); letter-spacing: 0.05em;">Playlist</span>
            <h3 style="font-size: 15px; font-weight: 700; color: white; margin-top: 4px; line-height: 1.3;">{{ playlist.title }}</h3>
            <p style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
              {{ playlist.channel_title }} • {{ playlistVideos.findIndex((v: any) => v.id === videoId) + 1 }} / {{ playlistVideos.length }}
            </p>
          </div>

          <div v-if="playlistPending" class="sidebar-loading">
            <div class="spinner"></div>
          </div>

          <div v-else class="recommendations-list playlist-vids-list" style="max-height: 380px; overflow-y: auto; padding-right: 4px; margin-bottom: 20px; display: flex; flex-direction: column; gap: 8px;">
            <div 
              v-for="rel in playlistVideos" 
              :key="rel.id" 
              class="recommendation-card playlist-card-item"
              :class="{ 'active-playlist-item': rel.id === videoId, 'disabled-playlist-item': rel.download_status !== 'completed' }"
              @click="rel.download_status === 'completed' ? navigateTo(`/watch/${rel.id}?playlistId=${playlistId}`) : null"
              style="position: relative; display: flex; gap: 12px; padding: 6px; border-radius: 8px; cursor: pointer; transition: all 0.2s;"
            >
              <span style="display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; color: var(--text-muted); width: 16px; text-align: center; flex-shrink: 0;">
                <span v-if="rel.id === videoId" style="color: var(--accent-primary);">▶</span>
                <span v-else>{{ rel.position }}</span>
              </span>
              
              <div class="rec-thumbnail-wrapper" style="width: 100px; aspect-ratio: 16/9; position: relative; border-radius: 6px; overflow: hidden; flex-shrink: 0;">
                <img :src="rel.local_thumbnail_path || `https://i.ytimg.com/vi/${rel.id}/hqdefault.jpg`" class="rec-thumbnail-img" style="width: 100%; height: 100%; object-fit: cover;" alt="Thumbnail" />
                <span class="rec-duration">{{ formatDuration(rel.duration) }}</span>
                <VideoDropdownMenu :video="rel" @hidden="onVideoHidden" />
              </div>
              
              <div class="rec-info" style="display: flex; flex-direction: column; min-width: 0; flex: 1; justify-content: center;">
                <h4 class="rec-title" :title="rel.title" style="font-size: 12.5px; font-weight: 600; line-height: 1.3; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">{{ rel.title }}</h4>
                <div class="rec-metadata" style="font-size: 11px; margin-top: 4px;">
                  <span v-if="rel.download_status !== 'completed'" style="color: #ef4444; font-weight: 500;">Non téléchargé</span>
                  <span v-else style="color: var(--text-secondary);">Téléchargé</span>
                </div>
              </div>
            </div>
          </div>

          <hr style="border: 0; height: 1px; background: rgba(255,255,255,0.06); margin: 20px 0;" />
        </template>

        <h2 class="sidebar-title">{{ playlistId ? 'Autres suggestions' : 'Other archived videos' }}</h2>
        
        <div v-if="relatedPending" class="sidebar-loading">
          <div class="spinner"></div>
        </div>

        <div v-else-if="!relatedData?.videos || relatedData.videos.length <= 1" class="sidebar-empty">
          <p>No other archived videos available.</p>
        </div>

        <div v-else class="recommendations-list">
          <div 
            v-for="rel in filteredRelatedVideos" 
            :key="rel.id" 
            class="recommendation-card premium-card"
            @click="playRecommendedVideo(rel.id)"
          >
            <div class="rec-thumbnail-wrapper">
              <img :src="rel.local_thumbnail_path || `https://i.ytimg.com/vi/${rel.id}/hqdefault.jpg`" class="rec-thumbnail-img" alt="Thumbnail" />
              <span class="rec-duration">{{ formatDuration(rel.duration) }}</span>
              <VideoDropdownMenu :video="rel" @hidden="onVideoHidden" />
            </div>
            
            <div class="rec-info">
              <h4 class="rec-title" :title="rel.title">{{ rel.title }}</h4>
              <p class="rec-channel">{{ rel.channel_title }}</p>
              <div class="rec-metadata">
                <span>{{ formatViews(rel.view_count) }} views</span>
                <span>•</span>
                <span>{{ formatUploadDate(rel.upload_date) }}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>

    <!-- Modal: Manage Playlists (Save to Playlist) -->
    <div v-if="user && showPlaylistsModal" class="modal-overlay" @click="closePlaylistsModal">
      <div class="modal-card glass-panel" @click.stop>
        <div class="modal-header">
          <h3>Save to Playlist</h3>
          <button class="close-modal-btn" @click="closePlaylistsModal">&times;</button>
        </div>
        
        <div class="modal-body">
          <p class="modal-desc">Select playlists to add or remove "{{ video?.title }}":</p>
          
          <div v-if="loadingPlaylists" class="modal-empty-state">
            Loading playlists...
          </div>
          <div v-else-if="userPlaylists.length === 0" class="modal-empty-state">
            No playlists created yet. Go to <NuxtLink to="/playlists" class="text-accent" @click="closePlaylistsModal">Playlists</NuxtLink> to create one.
          </div>
          
          <div v-else class="modal-categories-list">
            <label v-for="pl in userPlaylists" :key="pl.id" class="modal-check-item">
              <input type="checkbox" :checked="isVideoInPlaylist(pl.id)" @change="togglePlaylistMembership(pl.id, $event)" />
              <div class="check-item-text">
                <span class="check-item-name">{{ pl.title }}</span>
                <span v-if="pl.description" class="check-item-desc">{{ pl.description }}</span>
              </div>
            </label>
          </div>

          <div class="create-playlist-inline mt-4 pt-4" style="border-top: 1px solid rgba(255,255,255,0.08);">
            <button v-if="!showInlineForm" @click="showInlineForm = true" class="btn btn-secondary" style="width: 100%; justify-content: center;">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              Create new playlist
            </button>
            <div v-else class="inline-form" style="display: flex; flex-direction: column; gap: 8px;">
              <input v-model="newPlaylistTitle" class="form-input" placeholder="Playlist title" style="padding: 8px 12px; font-size: 13px;" />
              <select v-model="newPlaylistVisibility" class="form-input" style="padding: 8px 12px; font-size: 13px;">
                <option value="private">Private</option>
                <option value="unlisted">Unlisted</option>
                <option value="public">Public</option>
              </select>
              <div style="display: flex; gap: 8px; margin-top: 4px;">
                <button @click="createPlaylist" :disabled="!newPlaylistTitle || creatingPlaylist" class="btn btn-primary" style="flex: 1; justify-content: center;">
                  {{ creatingPlaylist ? 'Creating...' : 'Create' }}
                </button>
                <button @click="showInlineForm = false" class="btn btn-secondary" style="justify-content: center;">Cancel</button>
              </div>
            </div>
          </div>
        </div>
        
        <div class="modal-footer">
          <button class="btn btn-primary" @click="closePlaylistsModal">Done</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useToast } from '~/composables/useToast';
import { useAuth } from '~/composables/useAuth';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { user, isAdmin } = useAuth();

const videoId = computed(() => String(route.params.id));
const token = computed(() => route.query.token ? String(route.query.token) : '');

const descriptionExpanded = ref(false);
const techDetailsExpanded = ref(false);
const videoPlayer = ref<HTMLVideoElement | null>(null);
const playerContainer = ref<HTMLElement | null>(null);
const progressBarEl = ref<HTMLElement | null>(null);
const speedMenuRef = ref<HTMLElement | null>(null);
const subtitlesMenuRef = ref<HTMLElement | null>(null);

const showPlaylistsModal = ref(false);
const loadingPlaylists = ref(false);
const userPlaylists = ref<any[]>([]);

const showInlineForm = ref(false);
const newPlaylistTitle = ref('');
const newPlaylistVisibility = ref('private');
const creatingPlaylist = ref(false);

// ============================================
// Custom Player State
// ============================================
const isPaused = ref(true);
const isBuffering = ref(false);
const isMuted = ref(false);
const isFullscreen = ref(false);
const showControls = ref(true);
const currentTime = ref(0);
const videoDuration = ref(0);
const currentVolume = ref(1);
const currentSpeed = ref(1);
const showSpeedMenu = ref(false);
const playedPercent = ref(0);
const bufferedPercent = ref(0);
const progressHoverPercent = ref(-1);
const isScrubbing = ref(false);
let controlsTimeout: ReturnType<typeof setTimeout> | null = null;

const isWatchOptionsMenuOpen = ref(false);
const dropdownWrapperRef = ref<HTMLElement | null>(null);

const toggleWatchOptionsMenu = () => {
  isWatchOptionsMenuOpen.value = !isWatchOptionsMenuOpen.value;
};

const closeWatchOptionsMenu = () => {
  isWatchOptionsMenuOpen.value = false;
};

const openPlaylistsModalWrapper = () => {
  closeWatchOptionsMenu();
  openPlaylistsModal();
};

const downloadLocalCopyWrapper = () => {
  closeWatchOptionsMenu();
  downloadLocalCopy();
};

const reportWatchVideo = async () => {
  closeWatchOptionsMenu();
  try {
    await $fetch(`/api/videos/${videoId.value}/report`, { 
      method: 'POST',
      body: { reason: 'User reported this video from player options' }
    });
    toast.success('Video reported successfully');
  } catch (e) {
    toast.error('Failed to report video');
  }
};

const playbackSpeeds = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

// Subtitle controls state
const activeSubtitleCode = ref('off');
const showSubtitlesMenu = ref(false);

const toggleSubtitlesMenu = () => {
  showSubtitlesMenu.value = !showSubtitlesMenu.value;
  showSpeedMenu.value = false;
};

const selectSubtitle = (code: string) => {
  activeSubtitleCode.value = code;
  showSubtitlesMenu.value = false;
  
  const v = videoPlayer.value;
  if (!v) return;
  
  for (let i = 0; i < v.textTracks.length; i++) {
    const track = v.textTracks[i];
    if (!track) continue;
    if (track.language === code) {
      track.mode = 'showing';
    } else {
      track.mode = 'disabled';
    }
  }
};

// Fetch video metadata, comments and categories
const { data: videoResponse, pending, error, refresh: refreshVideo } = await useFetch<{ video: any; comments?: any[]; categories?: any[]; subtitles?: any[] }>(() => {
  return `/api/videos/${videoId.value}${token.value ? `?token=${token.value}` : ''}`;
});
const video = computed(() => videoResponse.value?.video || null);
const comments = computed(() => videoResponse.value?.comments || []);
const subtitles = computed(() => videoResponse.value?.subtitles || []);

// Custom error message extractor
const errorMsg = computed(() => {
  if (error.value) {
    return error.value.data?.statusMessage || error.value.message;
  }
  return '';
});

// Fetch other recommended videos (completed only)
const { data: relatedData, pending: relatedPending } = await useFetch<{ videos: any[] }>(() => {
  return `/api/videos?limit=10&status=completed`;
});

// Filter out the currently playing video from the sidebar recommendations list
const filteredRelatedVideos = computed(() => {
  if (!relatedData.value?.videos || !video.value) return [];
  return relatedData.value.videos.filter(v => v.id !== video.value.id);
});

const playlistId = computed(() => route.query.playlistId ? String(route.query.playlistId) : '');

// Fetch playlist details and videos
const { data: playlistData, pending: playlistPending } = await useAsyncData<any>(
  'watch-playlist-data',
  () => playlistId.value ? $fetch<any>(`/api/playlists/${playlistId.value}` as any) : Promise.resolve(null),
  { immediate: !!playlistId.value, watch: [playlistId] }
);

const playlist = computed(() => playlistData.value?.playlist || null);
const playlistVideos = computed(() => playlistData.value?.videos || []);

const hasPrevVideo = computed(() => {
  if (!playlistId.value || playlistVideos.value.length === 0) return false;
  const idx = playlistVideos.value.findIndex((v: any) => v.id === videoId.value);
  return idx > 0 && playlistVideos.value[idx - 1].download_status === 'completed';
});

const hasNextVideo = computed(() => {
  if (!playlistId.value || playlistVideos.value.length === 0) return false;
  const idx = playlistVideos.value.findIndex((v: any) => v.id === videoId.value);
  return idx >= 0 && idx < playlistVideos.value.length - 1 && playlistVideos.value[idx + 1].download_status === 'completed';
});

const playPrevVideo = () => {
  if (!playlistId.value) return;
  const idx = playlistVideos.value.findIndex((v: any) => v.id === videoId.value);
  if (idx > 0) {
    const prevVideo = playlistVideos.value[idx - 1];
    navigateTo(`/watch/${prevVideo.id}?playlistId=${playlistId.value}`);
  }
};

const playNextVideo = () => {
  if (!playlistId.value) return;
  const idx = playlistVideos.value.findIndex((v: any) => v.id === videoId.value);
  if (idx >= 0 && idx < playlistVideos.value.length - 1) {
    const nextVideo = playlistVideos.value[idx + 1];
    navigateTo(`/watch/${nextVideo.id}?playlistId=${playlistId.value}`);
  }
};

const handleVideoEnded = () => {
  isPaused.value = true;
  if (playlistId.value && playlistVideos.value.length > 0) {
    const currentIndex = playlistVideos.value.findIndex((v: any) => v.id === videoId.value);
    if (currentIndex >= 0 && currentIndex < playlistVideos.value.length - 1) {
      const nextVideo = playlistVideos.value[currentIndex + 1];
      if (nextVideo.download_status === 'completed') {
        toast.info(`Lecture de la vidéo suivante : ${nextVideo.title}`);
        setTimeout(() => {
          navigateTo(`/watch/${nextVideo.id}?playlistId=${playlistId.value}`);
        }, 1500);
      }
    }
  }
};

// ============================================
// Player Controls Logic
// ============================================

const togglePlay = () => {
  const v = videoPlayer.value;
  if (!v) return;
  if (v.paused) {
    v.play();
  } else {
    v.pause();
  }
};

const skip = (seconds: number) => {
  const v = videoPlayer.value;
  if (!v) return;
  v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + seconds));
};

const toggleMute = () => {
  const v = videoPlayer.value;
  if (!v) return;
  v.muted = !v.muted;
  isMuted.value = v.muted;
};

const setVolume = (e: Event) => {
  const v = videoPlayer.value;
  if (!v) return;
  const val = parseFloat((e.target as HTMLInputElement).value);
  v.volume = val;
  currentVolume.value = val;
  if (val > 0 && v.muted) {
    v.muted = false;
    isMuted.value = false;
  }
};

const onVolumeChange = () => {
  const v = videoPlayer.value;
  if (!v) return;
  currentVolume.value = v.volume;
  isMuted.value = v.muted;
};

const onTimeUpdate = () => {
  const v = videoPlayer.value;
  if (!v || isScrubbing.value) return;
  currentTime.value = v.currentTime;
  if (v.duration && !isNaN(v.duration)) {
    videoDuration.value = v.duration;
    playedPercent.value = (v.currentTime / v.duration) * 100;
  }
  // Update buffered
  if (v.buffered.length > 0 && v.duration) {
    bufferedPercent.value = (v.buffered.end(v.buffered.length - 1) / v.duration) * 100;
  }
};

const updateMediaSession = () => {
  if (process.client && 'mediaSession' in navigator && video.value) {
    const v = videoPlayer.value;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: video.value.title || 'YouKeep Video',
      artist: video.value.channel_title || 'YouKeep',
      album: 'YouKeep Archive',
      artwork: [
        { 
          src: video.value.local_thumbnail_path || (video.value.id ? `https://i.ytimg.com/vi/${video.value.id}/hqdefault.jpg` : ''),
          sizes: '512x512',
          type: 'image/jpeg' 
        }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => {
      if (v) v.play();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      if (v) v.pause();
    });
    navigator.mediaSession.setActionHandler('seekbackward', () => {
      skip(-10);
    });
    navigator.mediaSession.setActionHandler('seekforward', () => {
      skip(10);
    });
    try {
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (v && details.seekTime !== undefined) {
          v.currentTime = details.seekTime;
        }
      });
    } catch (e) {}
  }
};

const onPlayTrigger = () => {
  isPaused.value = false;
  updateMediaSession();
};

const onPauseTrigger = () => {
  isPaused.value = true;
};

const onMetadataLoaded = () => {
  const v = videoPlayer.value;
  if (!v) return;
  if (v.duration && !isNaN(v.duration)) {
    videoDuration.value = v.duration;
  }
  // Autoplay
  v.play().catch(() => {
    isPaused.value = true;
  });
  updateMediaSession();
};

const onDurationChange = () => {
  const v = videoPlayer.value;
  if (!v) return;
  if (v.duration && !isNaN(v.duration)) {
    videoDuration.value = v.duration;
  }
};

const setSpeed = (speed: number) => {
  const v = videoPlayer.value;
  if (!v) return;
  v.playbackRate = speed;
  currentSpeed.value = speed;
  showSpeedMenu.value = false;
};

const toggleSpeedMenu = () => {
  showSpeedMenu.value = !showSpeedMenu.value;
};

const toggleFullscreen = () => {
  const container = playerContainer.value;
  if (!container) return;

  if (!document.fullscreenElement) {
    container.requestFullscreen().then(() => {
      isFullscreen.value = true;
    }).catch(() => {});
  } else {
    document.exitFullscreen().then(() => {
      isFullscreen.value = false;
    }).catch(() => {});
  }
};

// Progress Bar Scrubbing
const startScrubbing = (e: MouseEvent) => {
  isScrubbing.value = true;
  scrubTo(e);
  document.addEventListener('mousemove', scrubTo);
  document.addEventListener('mouseup', stopScrubbing);
};

const scrubTo = (e: MouseEvent) => {
  const bar = progressBarEl.value;
  if (!bar || !videoPlayer.value) return;
  const rect = bar.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  playedPercent.value = percent * 100;
  currentTime.value = percent * videoDuration.value;
};

const stopScrubbing = (e: MouseEvent) => {
  isScrubbing.value = false;
  document.removeEventListener('mousemove', scrubTo);
  document.removeEventListener('mouseup', stopScrubbing);
  
  const bar = progressBarEl.value;
  if (!bar || !videoPlayer.value) return;
  const rect = bar.getBoundingClientRect();
  const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  videoPlayer.value.currentTime = percent * videoDuration.value;
};

const onProgressHover = (e: MouseEvent) => {
  const bar = progressBarEl.value;
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  progressHoverPercent.value = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
};

// Controls auto-hide
const handleMouseMove = () => {
  showControls.value = true;
  resetControlsTimeout();
};

const handleMouseLeave = () => {
  if (!isPaused.value) {
    controlsTimeout = setTimeout(() => {
      showControls.value = false;
    }, 2000);
  }
};

const resetControlsTimeout = () => {
  if (controlsTimeout) clearTimeout(controlsTimeout);
  if (!isPaused.value) {
    controlsTimeout = setTimeout(() => {
      showControls.value = false;
    }, 3000);
  }
};

// Keyboard Shortcuts
const handleKeydown = (e: KeyboardEvent) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  
  switch (e.key) {
    case ' ':
    case 'k':
      e.preventDefault();
      togglePlay();
      break;
    case 'ArrowLeft':
      e.preventDefault();
      skip(-10);
      break;
    case 'ArrowRight':
      e.preventDefault();
      skip(10);
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (videoPlayer.value) {
        videoPlayer.value.volume = Math.min(1, videoPlayer.value.volume + 0.1);
      }
      break;
    case 'ArrowDown':
      e.preventDefault();
      if (videoPlayer.value) {
        videoPlayer.value.volume = Math.max(0, videoPlayer.value.volume - 0.1);
      }
      break;
    case 'f':
    case 'F':
      e.preventDefault();
      toggleFullscreen();
      break;
    case 'm':
    case 'M':
      e.preventDefault();
      toggleMute();
      break;
  }
};

// Listen to fullscreen change events
const onFullscreenChange = () => {
  isFullscreen.value = !!document.fullscreenElement;
};

// Close speed and subtitles menu on outside click
const onDocumentClick = (e: MouseEvent) => {
  if (speedMenuRef.value && !speedMenuRef.value.contains(e.target as Node)) {
    showSpeedMenu.value = false;
  }
  if (subtitlesMenuRef.value && !subtitlesMenuRef.value.contains(e.target as Node)) {
    showSubtitlesMenu.value = false;
  }
  if (dropdownWrapperRef.value && !dropdownWrapperRef.value.contains(e.target as Node)) {
    closeWatchOptionsMenu();
  }
};

const wasPlayingBeforeVisibilityChange = ref(false);

const handleVisibilityChange = () => {
  const v = videoPlayer.value;
  if (!v) return;
  
  if (document.hidden) {
    wasPlayingBeforeVisibilityChange.value = !v.paused;
    if (wasPlayingBeforeVisibilityChange.value) {
      // In background: wait a moment and try to resume if browser auto-paused it.
      setTimeout(() => {
        if (v.paused) {
          v.play().catch(err => {
            console.log('Background play request failed:', err);
          });
        }
      }, 200);
    }
  } else {
    // Returned to foreground
    if (wasPlayingBeforeVisibilityChange.value && v.paused) {
      v.play().catch(() => {});
    }
  }
};

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('click', onDocumentClick);
  if (process.client) {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  
  // Focus player container for keyboard shortcuts
  nextTick(() => {
    playerContainer.value?.focus();
  });
});

onUnmounted(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('click', onDocumentClick);
  if (process.client) {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  }
  if (controlsTimeout) clearTimeout(controlsTimeout);
});

// Reload video source when ID changes
watch(videoId, () => {
  descriptionExpanded.value = false;
  currentTime.value = 0;
  playedPercent.value = 0;
  currentSpeed.value = 1;
  if (videoPlayer.value) {
    videoPlayer.value.playbackRate = 1;
    videoPlayer.value.load();
  }
});

const navigateToChannel = (channelId: string) => {
  navigateTo(`/channels?channelId=${channelId}`);
};

const playRecommendedVideo = (id: string) => {
  navigateTo(`/watch/${id}`);
};

const shareVideo = () => {
  if (!video.value) return;
  
  let shareUrl = window.location.origin + '/watch/' + video.value.id;
  if (video.value.visibility !== 'public' && video.value.share_token) {
    shareUrl += '?token=' + video.value.share_token;
  }
  
  navigator.clipboard.writeText(shareUrl);
  toast.success('Share link copied to clipboard!');
};

const downloadLocalCopy = () => {
  if (video.value?.local_video_path) {
    const link = document.createElement('a');
    link.href = video.value.local_video_path + (token.value ? '?token=' + token.value : '');
    link.download = `${video.value.title}.mp4`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
};

/* Format Helpers */
const formatTime = (seconds: number): string => {
  if (!seconds || isNaN(seconds)) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '--:--';
  return formatTime(seconds);
};

const handleAvatarError = (event: Event) => {
  const target = event.target as HTMLImageElement;
  const fallback = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%23666"><circle cx="12" cy="12" r="10"></circle><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-3.33 0-10 1.67-10 5v2h20v-2c0-3.33-6.67-5-10-5z"></path></svg>';
  if (target && target.src !== fallback) {
    target.src = fallback;
  }
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
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
};

const openPlaylistsModal = async () => {
  showPlaylistsModal.value = true;
  loadingPlaylists.value = true;
  try {
    const data = await $fetch<any>(`/api/playlists/personal?videoId=${videoId.value}`);
    userPlaylists.value = data.playlists || [];
  } catch (err: any) {
    toast.error('Failed to load playlists.');
  } finally {
    loadingPlaylists.value = false;
  }
};

const closePlaylistsModal = () => {
  showPlaylistsModal.value = false;
};

const isVideoInPlaylist = (playlistId: string) => {
  const pl = userPlaylists.value.find(p => p.id === playlistId);
  return pl ? pl.contains_video === 1 : false;
};

const togglePlaylistMembership = async (playlistId: string, event: Event) => {
  const checkbox = event.target as HTMLInputElement;
  const isChecked = checkbox.checked;
  const action = isChecked ? 'add' : 'remove';
  
  try {
    await $fetch(`/api/playlists/personal/${playlistId}/videos`, {
      method: 'POST',
      body: { action, videoId: videoId.value }
    });
    
    // Update local state
    const pl = userPlaylists.value.find(p => p.id === playlistId);
    if (pl) {
      pl.contains_video = isChecked ? 1 : 0;
    }
    toast.success(isChecked ? 'Added to playlist.' : 'Removed from playlist.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed to update playlist membership.');
    checkbox.checked = !isChecked; // Revert checkbox state on error
  }
};

const createPlaylist = async () => {
  if (!newPlaylistTitle.value.trim()) return;
  creatingPlaylist.value = true;
  try {
    const { playlist: newPl } = await $fetch<any>('/api/playlists/personal', {
      method: 'POST',
      body: {
        title: newPlaylistTitle.value.trim(),
        visibility: newPlaylistVisibility.value,
        description: ''
      }
    });

    // Add to local list
    userPlaylists.value.push({ ...newPl, contains_video: 1 });

    // Automatically add this video to the new playlist
    await $fetch(`/api/playlists/personal/${newPl.id}/videos`, {
      method: 'POST',
      body: { action: 'add', videoId: videoId.value }
    });
    
    toast.success(`Playlist created and video added!`);
    
    // Reset form
    newPlaylistTitle.value = '';
    newPlaylistVisibility.value = 'private';
    showInlineForm.value = false;
  } catch (e: any) {
    toast.error(e.data?.statusMessage || 'Failed to create playlist');
  } finally {
    creatingPlaylist.value = false;
  }
};

const formatTimestamp = (ts: number | null): string => {
  if (!ts) return 'Unknown';
  const date = new Date(ts);
  return date.toLocaleString('en-US', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const formatBytes = (bytes: number | null): string => {
  if (bytes === null || bytes === undefined) return 'Inconnu';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const onVideoHidden = (id: string) => {
  if (relatedData.value && relatedData.value.videos) {
    relatedData.value.videos = relatedData.value.videos.filter((v: any) => v.id !== id);
  }
};
</script>

<style scoped>
.dropdown-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px;
  background: none;
  border: none;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;
  text-align: left;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.dropdown-item:hover {
  background: rgba(255, 255, 255, 0.1);
}

.dropdown-item.text-danger {
  color: #ef4444;
}

.dropdown-item.text-danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

.dropdown-fade-enter-active,
.dropdown-fade-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.dropdown-fade-enter-from,
.dropdown-fade-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}
.watch-container {
  max-width: 1400px;
  margin: 0 auto;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 40px;
  text-align: center;
  border-radius: var(--border-radius-md);
  gap: 16px;
  color: var(--text-secondary);
}

.loading-state .spinner {
  width: 36px;
  height: 36px;
  border: 3.5px solid rgba(139, 92, 246, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

.watch-content {
  display: grid;
  grid-template-columns: 1fr 360px;
  gap: 24px;
}

@media (max-width: 1200px) {
  .watch-content {
    grid-template-columns: 1fr;
  }
}

.player-column {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
}

/* ============================================
   CUSTOM VIDEO PLAYER
   ============================================ */
.video-player-container {
  position: relative;
  width: 100%;
  aspect-ratio: 16/9;
  border-radius: var(--border-radius-lg);
  overflow: hidden;
  background: #000;
  box-shadow: 0 0 80px rgba(139, 92, 246, 0.15), var(--shadow-lg);
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  outline: none;
  user-select: none;
}

.video-player-container:focus {
  border-color: rgba(139, 92, 246, 0.3);
}

.video-player-container.is-short-player {
  aspect-ratio: 9/16 !important;
  max-width: 450px;
  margin: 0 auto;
}

.video-player {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

/* Hide native controls */
.video-player::-webkit-media-controls {
  display: none !important;
}

/* Buffering Spinner */
.player-buffering {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.3);
  z-index: 5;
}

.player-spinner {
  width: 48px;
  height: 48px;
  border: 4px solid rgba(255, 255, 255, 0.15);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

/* Big Play Overlay */
.big-play-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 4;
  background: rgba(0, 0, 0, 0.15);
}

.big-play-btn {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(12px);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  border: 2px solid rgba(255, 255, 255, 0.15);
}

.big-play-btn svg {
  margin-left: 4px;
}

.big-play-btn:hover {
  background: rgba(139, 92, 246, 0.5);
  transform: scale(1.1);
  border-color: rgba(139, 92, 246, 0.5);
  box-shadow: 0 0 30px var(--accent-primary-glow);
}

/* Player Controls Bar */
.player-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0, 0, 0, 0.85));
  padding: 32px 12px 10px 12px;
  z-index: 10;
  opacity: 0;
  transition: opacity 0.25s ease;
  cursor: default;
}

.controls-visible .player-controls {
  opacity: 1;
}

/* Progress Bar */
.progress-bar-container {
  position: relative;
  height: 4px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 2px;
  cursor: pointer;
  margin-bottom: 8px;
  transition: height 0.15s ease;
}

.progress-bar-container:hover {
  height: 6px;
}

.progress-buffered {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  pointer-events: none;
}

.progress-played {
  position: absolute;
  top: 0;
  left: 0;
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-secondary));
  border-radius: 2px;
  pointer-events: none;
}

.progress-scrubber {
  position: absolute;
  top: 50%;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: white;
  transform: translate(-50%, -50%);
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
  opacity: 0;
  transition: opacity 0.15s ease;
  pointer-events: none;
}

.progress-bar-container:hover .progress-scrubber {
  opacity: 1;
}

.progress-tooltip {
  position: absolute;
  bottom: 18px;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.85);
  color: white;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  pointer-events: none;
}

/* Controls Row */
.controls-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.controls-left, .controls-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ctrl-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 50%;
  transition: background 0.15s ease;
  color: white;
  flex-shrink: 0;
}

.ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.12);
}

/* Volume Control */
.volume-control {
  display: flex;
  align-items: center;
  gap: 0;
}

.volume-slider {
  width: 0;
  opacity: 0;
  transition: width 0.2s ease, opacity 0.2s ease;
  accent-color: var(--accent-primary);
  cursor: pointer;
  height: 4px;
}

.volume-control:hover .volume-slider {
  width: 80px;
  opacity: 1;
  margin-left: 4px;
}

/* Time Display */
.time-display {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  margin-left: 8px;
  font-weight: 500;
}

/* Speed Control */
.speed-control {
  position: relative;
}

.speed-btn {
  width: auto;
  padding: 0 10px;
  border-radius: 6px;
}

.speed-label {
  font-size: 13px;
  font-weight: 700;
  color: white;
}

.speed-menu {
  position: absolute;
  bottom: 44px;
  right: 0;
  background: rgba(20, 20, 35, 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--border-radius-sm);
  padding: 6px 0;
  min-width: 120px;
  box-shadow: var(--shadow-lg);
  animation: fadeIn 0.15s ease-out;
}

.speed-option {
  display: block;
  width: 100%;
  padding: 8px 16px;
  text-align: left;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  background: none;
  border: none;
  transition: all 0.15s;
}

.speed-option:hover {
  background: rgba(139, 92, 246, 0.1);
  color: white;
}

.speed-option.active {
  color: var(--accent-primary-hover);
  font-weight: 700;
  background: rgba(139, 92, 246, 0.08);
}

.subtitles-control {
  position: relative;
}

.subtitles-menu {
  position: absolute;
  bottom: 44px;
  right: 0;
  background: rgba(20, 20, 35, 0.95);
  backdrop-filter: blur(16px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--border-radius-sm);
  padding: 6px 0;
  min-width: 120px;
  max-height: 200px;
  overflow-y: auto;
  box-shadow: var(--shadow-lg);
  animation: fadeIn 0.15s ease-out;
}

.subtitles-option {
  display: block;
  width: 100%;
  padding: 8px 16px;
  text-align: left;
  font-size: 13px;
  color: var(--text-secondary);
  cursor: pointer;
  background: none;
  border: none;
  transition: all 0.15s;
}

.subtitles-option:hover {
  background: rgba(139, 92, 246, 0.1);
  color: white;
}

.subtitles-option.active {
  color: var(--accent-primary-hover);
  font-weight: 700;
  background: rgba(139, 92, 246, 0.08);
}

.ctrl-btn.cc-btn.active svg {
  color: var(--accent-primary-hover);
  filter: drop-shadow(0 0 5px var(--accent-primary-glow));
}

/* ============================================
   PAGE LAYOUT
   ============================================ */

.video-title {
  font-size: 20px;
  font-weight: 700;
  margin-top: 20px;
  line-height: 1.4;
}



/* Channel Row */
.channel-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid var(--border-color);
  gap: 16px;
  flex-wrap: wrap;
}

.channel-info {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.channel-info:hover .channel-name {
  color: white;
  text-decoration: underline;
}

.channel-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--bg-surface);
}

.channel-name {
  font-size: 15px;
  font-weight: 600;
}

.sub-count {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

/* Action Buttons — proper CSS class instead of inline styles */
.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* Description Box */
.description-box {
  padding: 20px;
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  cursor: pointer;
  transition: background 0.2s;
}

.description-box:hover {
  border-color: rgba(139, 92, 246, 0.3);
  box-shadow: 0 8px 32px rgba(139, 92, 246, 0.1);
}

.description-meta {
  display: flex;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  align-items: center;
}

.meta-dot {
  color: var(--text-muted);
}

.description-text {
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  color: var(--text-secondary);
}

.description-box.expanded .description-text {
  display: block;
  overflow: visible;
}

.toggle-desc-btn {
  align-self: flex-start;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-top: 4px;
  cursor: pointer;
}

/* Technical Details panel */
.tech-details-box {
  margin-top: 20px;
  border-radius: var(--border-radius-md);
  border: 1px solid var(--border-color);
  overflow: hidden;
  transition: all 0.3s ease;
}

.tech-details-header {
  padding: 14px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.01);
  transition: background 0.2s;
}

.tech-details-header:hover {
  background: rgba(255, 255, 255, 0.03);
}

.tech-details-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tech-details-label {
  font-size: 14px;
  font-weight: 700;
  margin: 0;
}

.chevron-icon {
  color: var(--text-secondary);
  transition: transform 0.3s ease;
}

.tech-details-content {
  padding: 16px;
  border-top: 1px solid var(--border-color);
  background: rgba(0, 0, 0, 0.2);
  animation: slideDown 0.25s ease-out;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.tech-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}

.tech-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.tech-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.tech-value {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
  word-break: break-all;
}

code.tech-value {
  font-family: monospace;
  background: rgba(0, 0, 0, 0.4);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

/* Comments section */
.comments-section {
  margin-top: 24px;
  padding: 24px;
  border-radius: var(--border-radius-md);
}

.comments-title {
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.comments-empty {
  color: var(--text-secondary);
  font-size: 14px;
  text-align: center;
  padding: 30px 0;
}

.comments-list {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.comment-item {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 12px;
  border-radius: var(--border-radius-md);
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid transparent;
  transition: all 0.25s;
}

.comment-item:hover {
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.03);
}

.comment-avatar {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.comment-avatar-fallback {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-family: var(--font-title);
  font-size: 14px;
  flex-shrink: 0;
  box-shadow: 0 2px 6px var(--accent-primary-glow);
}

.comment-body {
  flex: 1;
  min-width: 0;
}

.comment-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.comment-author {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.comment-time {
  font-size: 11px;
  color: var(--text-muted);
}

.comment-text {
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary);
  margin: 0;
  white-space: pre-wrap;
}

.comment-footer {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 500;
}

.comment-footer svg {
  transition: color 0.2s;
}

.comment-item:hover .comment-footer svg {
  color: var(--accent-secondary);
}

/* Sidebar */
.sidebar-column {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sidebar-title {
  font-size: 16px;
  font-weight: 700;
}

.sidebar-loading {
  display: flex;
  justify-content: center;
  padding: 40px 0;
}

.sidebar-loading .spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(139, 92, 246, 0.1);
  border-radius: 50%;
  border-top-color: var(--accent-primary);
  animation: spin 0.8s linear infinite;
}

.sidebar-empty {
  color: var(--text-secondary);
  font-size: 14px;
  padding: 20px 0;
}

.recommendations-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.recommendation-card {
  display: flex;
  flex-direction: row;
  gap: 12px;
  cursor: pointer;
  padding: 8px;
}

.rec-thumbnail-wrapper {
  position: relative;
  width: 168px;
  aspect-ratio: 16/9;
  border-radius: var(--border-radius-md);
  overflow: hidden;
  background: #000;
  flex-shrink: 0;
}

.rec-thumbnail-wrapper::after {
  content: '';
  position: absolute;
  bottom: 0; left: 0; right: 0; height: 40%;
  background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
  pointer-events: none;
}

.rec-thumbnail-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.rec-duration {
  position: absolute;
  bottom: 4px;
  right: 4px;
  background: rgba(0, 0, 0, 0.85);
  font-size: 10px;
  font-weight: 600;
  padding: 2px 5px;
  border-radius: 3px;
}

.rec-info {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 4px;
  min-width: 0;
}

.rec-title {
  font-size: 13px;
  line-height: 1.3;
  font-weight: 600;
  color: var(--text-primary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.rec-channel {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rec-metadata {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}

/* Modal Window styles */
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

.mt-4 {
  margin-top: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}

.playlist-card-item {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.playlist-card-item:hover:not(.disabled-playlist-item) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.1);
}

.active-playlist-item {
  background: rgba(139, 92, 246, 0.1) !important;
  border-color: rgba(139, 92, 246, 0.3) !important;
  box-shadow: 0 0 12px rgba(139, 92, 246, 0.1);
}

.disabled-playlist-item {
  opacity: 0.5;
  cursor: not-allowed;
}

.playlist-vids-list::-webkit-scrollbar {
  width: 4px;
}
.playlist-vids-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.02);
}
.playlist-vids-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 2px;
}
.playlist-vids-list::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
