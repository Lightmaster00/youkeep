<template>
  <div class="settings-container">
    <h1 class="page-title text-gradient">Application Settings</h1>

    <div class="settings-layout">
      <!-- Tabs Sidebar -->
      <div v-if="isAdmin" class="settings-tabs glass-panel">
        <button 
          v-if="isAdmin && !currentUser?.mustChangePassword" 
          class="tab-btn" 
          :class="{ active: activeTab === 'stats' }" 
          @click="activeTab = 'stats'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
          <span>Dashboard</span>
        </button>

        <button 
          v-if="isAdmin && !currentUser?.mustChangePassword" 
          class="tab-btn" 
          :class="{ active: activeTab === 'downloads' }" 
          @click="activeTab = 'downloads'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          <span>Downloads</span>
          <span v-if="activeDownloadCount > 0" class="tab-badge">{{ activeDownloadCount }}</span>
        </button>

        <button 
          v-if="isAdmin && !currentUser?.mustChangePassword" 
          class="tab-btn" 
          :class="{ active: activeTab === 'users' }" 
          @click="activeTab = 'users'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
          <span>Users</span>
        </button>

        <button 
          v-if="isAdmin && !currentUser?.mustChangePassword" 
          class="tab-btn" 
          :class="{ active: activeTab === 'system' }" 
          @click="activeTab = 'system'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
          <span>System</span>
        </button>

      </div>

      <!-- Tab Content Area -->
      <div class="settings-content">
        
        <!-- ================= STATS TAB ================= -->
        <div v-if="activeTab === 'stats' && isAdmin" class="tab-pane">
          <div class="pane-header">
            <h2>Dashboard & Statistiques</h2>
            <p>Overview of the global storage and archiving status.</p>
          </div>

          <!-- Quick Metrics Grid -->
          <div class="metrics-grid">
            <div class="metric-card glass-panel">
              <span class="metric-label">Archived Videos</span>
              <span class="metric-value">{{ stats?.totalVideos || 0 }}</span>
              <div class="metric-sub">In the local library</div>
            </div>

            <div class="metric-card glass-panel">
              <span class="metric-label">Followed Channels</span>
              <span class="metric-value">{{ stats?.totalChannels || 0 }}</span>
              <div class="metric-sub">Configured archiving sources</div>
            </div>

            <div class="metric-card glass-panel">
              <span class="metric-label">Media Disk Space</span>
              <span class="metric-value text-gradient">{{ formatBytes(stats?.mediaSize || 0) }}</span>
              <div class="metric-sub">Consumed by MP4/JPG files</div>
            </div>

            <div class="metric-card glass-panel">
              <span class="metric-label">Archived Duration</span>
              <span class="metric-value">{{ formatSecondsToHours(stats?.totalDuration || 0) }}</span>
              <div class="metric-sub">Cumulative time of local videos</div>
            </div>

            <div class="metric-card glass-panel">
              <span class="metric-label">Archived Comments</span>
              <span class="metric-value">{{ stats?.totalComments || 0 }}</span>
              <div class="metric-sub">Extracted from YouTube</div>
            </div>

            <div class="metric-card glass-panel">
              <span class="metric-label">SQLite Database</span>
              <span class="metric-value">{{ formatBytes(stats?.dbSize || 0) }}</span>
              <div class="metric-sub">Indexing and database</div>
            </div>
          </div>

          <!-- Graphs & Storage Breakdown Row -->
          <div class="stats-row" style="grid-template-columns: 1fr;">
            <!-- Channels breakdown -->
            <div class="stats-col glass-panel">
              <h3>Top Channels (by videos)</h3>
              <div v-if="channels.length === 0" class="stats-empty">
                No channels found.
              </div>
              <div v-else class="stats-list">
                <div 
                  v-for="ch in sortedChannels" 
                  :key="ch.id" 
                  class="stats-list-item"
                >
                  <div class="stats-item-info">
                    <span class="item-title">{{ ch.title }}</span>
                    <span class="item-count">{{ ch.completed_count }} / {{ ch.total_count }} vid.</span>
                  </div>
                  <!-- Mini Progress Bar -->
                  <div class="stats-item-bar-bg">
                    <div 
                      class="stats-item-bar" 
                      :style="{ width: getPercentage(ch.completed_count, ch.total_count) + '%' }"
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- ================= DOWNLOADS TAB ================= -->
        <div v-if="activeTab === 'downloads' && isAdmin" class="tab-pane">
          <div class="pane-header">
            <h2>Downloads Manager</h2>
            <p>Add videos or monitor active streams in your queue.</p>
          </div>

          <!-- Add Ingest / Channel Search Box -->
          <div class="ingest-box glass-panel">
            <h3>Search for a YouTube Channel</h3>
            <p class="section-desc">Enter the name of the YouTube channel you want to add.</p>
            <form @submit.prevent="handleSearchOrIngest" class="ingest-form mt-2">
              <input 
                type="text" 
                v-model="channelSearchInput" 
                placeholder="Channel name (e.g. Marques Brownlee, Veritasium...)" 
                class="form-input" 
                required
                :disabled="searching || ingesting"
              />
              <button type="submit" class="btn btn-primary" :disabled="searching || ingesting">
                <span v-if="searching">Searching...</span>
                <span v-else>Search</span>
              </button>
            </form>
            <div v-if="ingestMessage" class="form-msg mt-3" :class="ingestSuccess ? 'success-msg' : 'error-msg'">
              {{ ingestMessage }}
            </div>

            <!-- Search Results -->
            <div v-if="searchResults.length > 0" class="search-results-list mt-3">
              <h4 style="font-size: 14px; font-weight: 600; margin-bottom: 12px; color: var(--text-primary);">Search Results :</h4>
              <div class="search-results-grid">
                <div v-for="ch in searchResults" :key="ch.id" class="search-channel-card">
                  <img :src="ch.avatarUrl || '/img/default-avatar.png'" class="channel-avatar-thumb" />
                  <div class="channel-search-info">
                    <h5>{{ ch.title }}</h5>
                    <p class="channel-search-meta">{{ ch.subscriberCount }} • {{ ch.videoCount }}</p>
                    <p class="channel-search-desc" v-if="ch.description">{{ ch.description }}</p>
                  </div>
                  <button @click="openIngestModal(ch)" class="btn btn-secondary btn-xs">
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Default Downloads Directory Configuration -->
          <div class="ingest-box glass-panel mt-3">
            <h3>Default Downloads Directory</h3>
            <p class="section-desc">Set the absolute path on the server where all channels will be archived by default.</p>
            <form @submit.prevent="handleSaveDefaultDir" class="ingest-form mt-2">
              <input 
                type="text" 
                v-model="defaultDownloadsDir" 
                placeholder="e.g. /downloads/videos" 
                class="form-input" 
                required
                :disabled="savingDir"
              />
              <button type="submit" class="btn btn-primary" :disabled="savingDir">
                <span>{{ savingDir ? 'Enregistrement...' : 'Enregistrer' }}</span>
              </button>
            </form>
            <div v-if="saveDirMessage" class="form-msg mt-3" :class="saveDirSuccess ? 'success-msg' : 'error-msg'">
              {{ saveDirMessage }}
            </div>
          </div>

          <!-- Planification (Cron) Configuration Box -->
          <div class="ingest-box glass-panel mt-3">
            <h3>Sync Scheduling (Cron)</h3>
            <p class="section-desc">
              Determine the interval at which the server will query YouTube to identify and catalog new videos for tracked channels.
            </p>

            <form @submit.prevent="handleSaveSchedule" class="ingest-form mt-2" style="display: flex; flex-direction: column; gap: 12px; align-items: stretch; width: 100%;">
              <div class="form-group" style="margin: 0;">
                <label class="checkbox-container">
                  <input type="checkbox" v-model="scheduleForm.enabled" />
                  <span class="checkmark"></span>
                  Enable automatic background synchronization
                </label>
              </div>

              <div v-if="scheduleForm.enabled" class="schedule-settings-row" style="display: flex; gap: 16px; align-items: flex-end; width: 100%; flex-wrap: wrap;">
                <div class="form-group" style="flex: 1; min-width: 200px; margin: 0;">
                  <label class="form-label" for="preset">Preset Interval</label>
                  <select id="preset" v-model="scheduleForm.preset" @change="applyPreset" class="form-select" style="width: 100%;">
                    <option value="hourly">Hourly</option>
                    <option value="twelve_hours">Every 12 hours</option>
                    <option value="daily">Daily (at 3 AM)</option>
                    <option value="weekly">Weekly (Sunday at 3 AM)</option>
                    <option value="custom">Custom Cron Expression</option>
                  </select>
                </div>

                <div class="form-group" v-if="scheduleForm.preset === 'custom'" style="flex: 1; min-width: 200px; margin: 0;">
                  <label class="form-label" for="cron">Cron Expression</label>
                  <input type="text" id="cron" v-model="scheduleForm.schedule" class="form-input" placeholder="*/30 * * * *" required style="width: 100%;" />
                </div>
              </div>

              <div class="form-actions" style="margin-top: 8px;">
                <button type="submit" class="btn btn-primary" :disabled="savingSchedule">
                  {{ savingSchedule ? 'Saving...' : 'Save schedule' }}
                </button>
              </div>
            </form>
            <div v-if="scheduleMessage" class="form-msg mt-3 success-msg">
              {{ scheduleMessage }}
            </div>
          </div>

          <!-- Synchronize Button & Queue Actions -->
          <div class="queue-actions-row">
            <!-- Global Pause/Resume Button -->
            <button 
              @click="toggleGlobalPause" 
              class="btn" 
              :class="isPaused ? 'btn-primary' : 'btn-secondary'"
              :disabled="pausingOrResuming"
            >
              <svg v-if="isPaused" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>
              <span>{{ isPaused ? 'Resume downloads' : 'Pause downloads' }}</span>
            </button>

            <button @click="handleSyncAll" class="btn btn-secondary" :disabled="syncingAll">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2" :class="{ 'spin-anim': syncingAll }"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
              <span>{{ syncingAll ? 'Synchronizing...' : 'Synchronize entire library' }}</span>
            </button>

            <button v-if="failedCount > 0" @click="handleRetryAllFailed" class="btn btn-secondary" :disabled="retryingFailed">
              <span>Retry {{ failedCount }} failed</span>
            </button>

            <button v-if="queue.length > 0" @click="handleClearQueue" class="btn btn-danger-outline">
              Clear queue
            </button>
          </div>

          <!-- Queue Section -->
          <div class="queue-box glass-panel">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px;">
              <h3 style="margin: 0; font-size: 16px;">Processing Queue</h3>
              <span :class="isPaused ? 'badge-paused-global' : 'badge-active-global'">
                {{ isPaused ? 'Downloads Suspended' : 'Active' }}
              </span>
            </div>

            <div v-if="queue.length === 0" class="queue-empty">
              No active or pending downloads.
            </div>
            <div v-else class="queue-list">
              <div v-for="video in queue" :key="video.id" class="queue-card">
                <div class="queue-details">
                  <div class="queue-text">
                    <h4 class="queue-title" :title="video.title">{{ video.title }}</h4>
                    <p class="queue-channel">{{ video.channel_title }} • <code>{{ video.id }}</code></p>
                  </div>
                  <span class="badge" :class="`badge-${video.download_status}`">
                    {{ formatStatus(video.download_status) }}
                  </span>
                </div>

                <!-- Progress indicators -->
                <div class="queue-progress-row">
                  <div class="progress-bar-bg">
                    <div 
                      class="progress-bar-fill" 
                      :style="{ width: (smoothProgress[video.id] !== undefined ? smoothProgress[video.id] : (video.download_progress || 0)) + '%' }"
                    ></div>
                  </div>
                  <span class="progress-percent">{{ Math.round(smoothProgress[video.id] !== undefined ? smoothProgress[video.id] : (video.download_progress || 0)) }}%</span>
                </div>

                <div class="queue-meta" v-if="video.download_status === 'downloading'">
                  <span v-if="video.download_speed">Speed: {{ video.download_speed }}</span>
                  <span v-if="video.download_eta">ETA: {{ video.download_eta }}</span>
                </div>

                <div class="queue-error" v-if="video.download_status === 'failed' && video.last_error">
                  <strong>Error:</strong> {{ video.last_error }}
                </div>

                <div class="queue-card-actions">
                  <button 
                    v-if="video.download_status === 'pending'"
                    @click="handlePrioritizeTask(video.id)" 
                    class="btn btn-secondary btn-xs"
                  >
                    Prioritize
                  </button>
                  <button 
                    @click="handleCancelDownload(video.id)" 
                    class="btn btn-danger-outline btn-xs"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Ingest Options Modal -->
        <div v-if="showIngestModal" class="modal-overlay" @click.self="closeIngestModal">
          <div class="modal-content glass-panel">
            <div class="modal-header">
              <h3>Archiving options: {{ selectedSearchChannel?.title }}</h3>
              <button @click="closeIngestModal" class="btn-close">&times;</button>
            </div>

            <form @submit.prevent="submitIngestModal" class="modal-body mt-3">
              <div class="form-group">
                <label class="form-label" for="custom_path">Storage Folder (full path on the server)</label>
                <input 
                  type="text" 
                  id="custom_path" 
                  v-model="modalForm.custom_save_path" 
                  class="form-input" 
                  placeholder="e.g. /downloads/videos/channel_name" 
                  required
                />
              </div>

              <div class="form-group">
                <label class="form-label" for="visibility">Default Visibility</label>
                <select id="visibility" v-model="modalForm.visibility" class="form-select">
                  <option value="public">Public (Everyone can view)</option>
                  <option value="private">Private (Logged-in users only)</option>
                  <option value="unlisted">Unlisted (Restricted to explicit permissions)</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label">Content to archive</label>
                <div class="checkbox-row mt-1" style="display: flex; gap: 16px;">
                  <label class="checkbox-container">
                    <input type="checkbox" v-model="modalForm.download_videos" />
                    <span class="checkmark"></span>
                    Videos
                  </label>
                  <label class="checkbox-container">
                    <input type="checkbox" v-model="modalForm.download_shorts" />
                    <span class="checkmark"></span>
                    Shorts
                  </label>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="date_after">Only download after (optional)</label>
                <input 
                  type="date" 
                  id="date_after" 
                  v-model="modalForm.date_after" 
                  class="form-input" 
                />
              </div>

              <div class="form-group mt-3">
                <label class="checkbox-container">
                  <input type="checkbox" v-model="modalForm.sync_automatically" />
                  <span class="checkmark"></span>
                  Automatically synchronize this channel (Scheduling)
                </label>
              </div>

              <div class="form-group">
                <label class="checkbox-container">
                  <input type="checkbox" v-model="modalForm.start_sync" />
                  <span class="checkmark"></span>
                  Start synchronization and download immediately
                </label>
              </div>

              <div class="modal-footer mt-4" style="display: flex; justify-content: flex-end; gap: 10px;">
                <button type="button" @click="closeIngestModal" class="btn btn-secondary">Cancel</button>
                <button type="submit" class="btn btn-primary" :disabled="ingesting">
                  {{ ingesting ? 'Adding...' : 'Confirm' }}
                </button>
              </div>
            </form>
          </div>
        </div>



        <!-- ================= SYSTEM & MAINTENANCE TAB ================= -->
        <div v-if="activeTab === 'system' && isAdmin" class="tab-pane">
          <div class="pane-header">
            <h2>Maintenance & System Tools</h2>
            <p>Verify server dependencies status and observe the log console in real time.</p>
          </div>

          <!-- yt-dlp & FFmpeg Diagnostic Tools -->
          <div class="config-section glass-panel">
            <h3>Server Dependencies Diagnostic</h3>
            <p class="section-desc">Local archiving binary path: <code>{{ diagnosticYtdlPath || 'loading...' }}</code></p>
            <div class="btn-group mt-3">
              <button @click="handleTestBinary" class="btn btn-secondary" :disabled="diagnosticBinaryTesting">
                {{ diagnosticBinaryTesting ? 'Testing...' : 'Test Binaries' }}
              </button>
              
              <button @click="handleUpdateYtdl" class="btn btn-secondary" :disabled="updatingYtdl">
                {{ updatingYtdl ? 'Updating...' : 'Update yt-dlp' }}
              </button>
            </div>

            <!-- Diagnostics results panel -->
            <div v-if="diagnosticBinaryResult" class="test-result-box mt-3">
              <div class="diagnostic-status-item">
                <span class="diagnostic-label">yt-dlp:</span>
                <span :class="diagnosticBinaryResult.success ? 'badge-status badge-success' : 'badge-status badge-danger'">
                  {{ diagnosticBinaryResult.success ? 'Operational' : 'Error' }}
                </span>
                <span v-if="diagnosticBinaryResult.success" class="diagnostic-version-text ml-2">
                  (version: <code>{{ diagnosticBinaryResult.version }}</code>)
                </span>
              </div>
              
              <div class="diagnostic-status-item mt-2">
                <span class="diagnostic-label">FFmpeg:</span>
                <span :class="diagnosticBinaryResult.ffmpegAvailable ? 'badge-status badge-success' : 'badge-status badge-warning'">
                  {{ diagnosticBinaryResult.ffmpegAvailable ? 'Available (A/V Merge active)' : 'Not detected' }}
                </span>
              </div>

              <div v-if="!diagnosticBinaryResult.ffmpegAvailable" class="ffmpeg-warning-box mt-3">
                <strong class="warning-title">💡 Note on video quality:</strong>
                <p class="warning-desc">FFmpeg was not detected on your system. Videos will be downloaded in their default combined format (usually limited to 720p maximum) and thumbnails cannot be converted to JPG. For maximum quality (1080p, 4K, etc.), please install <code>ffmpeg</code> (for example via <code>brew install ffmpeg</code> on macOS or <code>sudo apt install ffmpeg</code> on Linux) and restart MyTeub.</p>
              </div>

              <div v-if="diagnosticBinaryResult.stderr" class="diagnostic-stderr-box mt-3">
                <h5>Error output:</h5>
                <pre class="diagnostic-pre mt-1">{{ diagnosticBinaryResult.stderr }}</pre>
              </div>
            </div>

            <div v-if="updatingYtdl || updateConsoleOutput" class="test-result-box mt-3">
              <h4>Update Output:</h4>
              <pre class="diagnostic-pre mt-2">{{ updateConsoleOutput || 'Waiting...' }}</pre>
            </div>
          </div>

          <!-- Interactive Live Logs Terminal -->
          <div class="logs-container glass-panel mt-4">
            <div class="logs-header">
              <h3>Worker Console (Background Logs)</h3>
              <button @click="fetchDiagnostics" class="btn btn-secondary btn-icon-sm" title="Refresh logs">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path></svg>
              </button>
            </div>
            <div class="logs-terminal" ref="terminalBody">
              <div v-if="diagnosticLogs.length === 0" class="log-line text-muted">
                No logs available at the moment.
              </div>
              <div 
                v-for="(log, idx) in diagnosticLogs" 
                :key="idx" 
                class="log-line"
                :class="getLogLineClass(log)"
              >
                {{ log }}
              </div>
            </div>
          </div>
        </div>

        <!-- ================= USERS TAB ================= -->
        <div v-if="activeTab === 'users' && isAdmin" class="tab-pane">
          <div class="pane-header">
            <h2>Manage User Accounts</h2>
            <p>Create new profiles or assign access permissions.</p>
          </div>

          <div class="users-layout">
            <!-- Save User Form -->
            <div class="user-form-panel glass-panel">
              <h3>{{ editingUserId ? 'Edit user' : 'Create user' }}</h3>
              
              <form @submit.prevent="handleSaveUser" class="user-form mt-3">
                <div class="form-group">
                  <label class="form-label" for="u_username">Username</label>
                  <input 
                    type="text" 
                    id="u_username" 
                    v-model="userForm.username" 
                    class="form-input" 
                    placeholder="e.g. Paul" 
                    required
                    :disabled="!!editingUserId"
                  />
                </div>

                <div class="form-group">
                  <label class="form-label" for="u_password">
                    {{ editingUserId ? 'New password (leave empty to keep unchanged)' : 'Password (leave empty to auto-generate)' }}
                  </label>
                  <input 
                    type="password" 
                    id="u_password" 
                    v-model="userForm.password" 
                    class="form-input" 
                    placeholder="•••••••• (Optional)" 
                  />
                </div>

                <div class="form-group">
                  <label class="form-label">Role</label>
                  <div class="role-selector">
                    <label class="role-option" :class="{ selected: userForm.role === 'user' }">
                      <input type="radio" v-model="userForm.role" value="user" />
                      <span>Standard User</span>
                    </label>
                    <label class="role-option" :class="{ selected: userForm.role === 'admin' }">
                      <input type="radio" v-model="userForm.role" value="admin" />
                      <span>Administrator</span>
                    </label>
                  </div>
                </div>

                <!-- Access checklist for user role -->
                <div v-if="userForm.role === 'user'" class="permissions-section mt-3">
                  <h4>Access Permissions</h4>
                  
                  <div class="form-group mt-2">
                    <label class="checkbox-container">
                      <input type="checkbox" v-model="fullChannelAccess" />
                      <span class="checkmark"></span>
                      Full access to all channels
                    </label>
                  </div>

                  <!-- Channels list (only if NOT full access) -->
                  <div v-if="!fullChannelAccess" class="perm-col mt-2">
                    <span class="perm-label">Select allowed channels</span>
                    <div class="checklist-container" style="max-height: 200px;">
                      <label v-for="ch in channels" :key="ch.id" class="check-item">
                        <input type="checkbox" v-model="userForm.channelAccess" :value="ch.id" />
                        <span>{{ ch.title }}</span>
                      </label>
                    </div>
                  </div>
                </div>

                 <div v-if="generatedPassword" class="form-msg success-msg mt-3" style="background: rgba(34, 197, 94, 0.12); border: 1px solid rgba(34, 197, 94, 0.3); padding: 14px; border-radius: 8px;">
                  <strong style="display: block; margin-bottom: 4px; font-size: 14px;">Account successfully configured!</strong>
                  Username: <code>{{ oldUsername || userForm.username }}</code><br />
                  Temporary password: <code style="font-size: 15px; background: rgba(0, 0, 0, 0.4); padding: 2px 6px; border-radius: 4px; color: #4ade80; font-weight: bold;">{{ generatedPassword }}</code>
                  
                  <div class="mt-2">
                    <button type="button" @click="copyCredentials" class="btn btn-secondary btn-xs">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mr-2"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>
                      Copy credentials
                    </button>
                  </div>

                  <p style="font-size: 11px; color: var(--text-secondary); margin-top: 6px; line-height: 1.4;">
                    Copy these credentials and send them to the user. They must change their password on their first login.
                  </p>
                </div>

                <div v-if="userFormMessage" class="form-msg mt-3" :class="userFormSuccess ? 'success-msg' : 'error-msg'">
                  {{ userFormMessage }}
                </div>

                <div class="form-actions mt-3">
                  <button type="submit" class="btn btn-primary">
                    {{ editingUserId ? 'Update' : 'Create user' }}
                  </button>
                  <button v-if="editingUserId" type="button" @click="cancelEditUser" class="btn btn-secondary ml-2">
                    Cancel
                  </button>
                </div>
              </form>
            </div>

            <!-- Users List Panel -->
            <div class="users-list-panel glass-panel">
              <h3>Saved Accounts</h3>
              
              <div v-if="usersPending" class="users-loading mt-3">
                <div class="spinner"></div>
              </div>
              <div v-else-if="users.length === 0" class="users-empty mt-3">
                No user accounts.
              </div>
              <div v-else class="users-list mt-3">
                <div v-for="u in users" :key="u.id" class="user-card">
                  <div class="user-info">
                    <div class="user-headline">
                      <strong>{{ u.username }}</strong>
                      <span class="badge" :class="u.role === 'admin' ? 'badge-completed' : 'badge-pending'">
                        {{ u.role === 'admin' ? 'Admin' : 'Standard' }}
                      </span>
                    </div>
                    <span class="user-created text-muted">Created on: {{ formatDate(u.created_at) }}</span>
                    
                    <div class="user-access-summary text-muted" v-if="u.role === 'user'">
                      <span>Channels: {{ u.channelAccess?.length || 0 }}</span>
                    </div>
                  </div>

                  <div class="user-actions">
                    <button 
                      @click="handleResetPassword(u.id, u.username)" 
                      class="btn btn-secondary btn-icon-sm" 
                      title="Reset password"
                      :disabled="u.id === currentUser?.id"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    </button>
                    <button @click="loadUserForEdit(u)" class="btn btn-secondary btn-icon-sm" title="Edit">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button 
                      @click="handleDeleteUser(u.id, u.username)" 
                      class="btn btn-danger-outline btn-icon-sm" 
                      title="Delete"
                      :disabled="u.id === currentUser?.id || u.username === 'admin'"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        

      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { useAuth } from '~/composables/useAuth';
import { useToast } from '~/composables/useToast';

const toast = useToast();
const { user: currentUser, isAdmin } = useAuth();
const route = useRoute();

const allowedTabs = ['stats', 'downloads', 'users', 'system'];
const queryTab = route.query.tab ? String(route.query.tab) : '';
const initialTab = allowedTabs.includes(queryTab) ? queryTab : 'stats';
if (!isAdmin.value) {
  navigateTo('/account');
}

const activeTab = ref(initialTab);

watch(() => route.query.tab, (newTab) => {
  if (newTab && allowedTabs.includes(String(newTab))) {
    activeTab.value = String(newTab);
  }
});



const generatedPassword = ref('');

/* ================= 1. STATS TAB ================= */
const { data: stats, refresh: refreshStats } = await useFetch<any>('/api/admin/stats');
const { data: channelsData } = await useFetch<{ channels: any[] }>('/api/channels');
const channels = computed(() => channelsData.value?.channels || []);

const sortedChannels = computed(() => {
  return [...channels.value]
    .sort((a, b) => (b.completed_count || 0) - (a.completed_count || 0))
    .slice(0, 5);
});

const getPercentage = (count: number, total: number) => {
  if (!total) return 0;
  return Math.min(Math.round((count / total) * 100), 100);
};

const formatSecondsToHours = (secs: number) => {
  if (!secs) return '0h';
  const hours = Math.round(secs / 3600);
  return `${hours.toLocaleString()} h`;
};

/* ================= 2. DOWNLOADS TAB ================= */
const queue = ref<any[]>([]);
const failedCount = ref(0);
const syncingAll = ref(false);
const retryingFailed = ref(false);
const isPaused = ref(false);
const pausingOrResuming = ref(false);

const activeDownloadCount = computed(() => {
  return queue.value.filter(v => v.download_status === 'downloading').length;
});

const parseETAToSeconds = (etaStr: string | null | undefined): number => {
  if (!etaStr) return 0;
  const cleaned = etaStr.trim();
  if (cleaned === '--:--' || cleaned.toLowerCase().includes('waiting')) return 0;
  const parts = cleaned.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 2) {
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  } else if (parts.length === 3) {
    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
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
  queue.value.forEach(video => {
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
    const currentSmooth = smoothProgress.value[id] ?? target;
    if (rate > 0 && currentSmooth < target) {
      const nextProgress = currentSmooth + rate * dt;
      smoothProgress.value[id] = Math.min(nextProgress, target);
      if (smoothProgress.value[id]! < target) {
        hasActive = true;
      }
    }
  });

  if (hasActive || activeDownloadCount.value > 0) {
    animationFrameId = requestAnimationFrame(updateSmoothProgress);
  } else {
    animationFrameId = null;
  }
};

watch(() => queue.value, () => {
  queue.value.forEach(video => {
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

    const currentSmooth = smoothProgress.value[id] ?? target;
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

  if (!animationFrameId && activeDownloadCount.value > 0) {
    lastFrameTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    updateSmoothProgress(lastFrameTime);
  }
}, { deep: true });

onUnmounted(() => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
});

const fetchQueue = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/queue');
    queue.value = data.queue || [];
    failedCount.value = data.failedCount || 0;
    isPaused.value = data.isPaused || false;
  } catch (err) {
    console.error('Failed to fetch downloader queue:', err);
  }
};

const toggleGlobalPause = async () => {
  pausingOrResuming.value = true;
  try {
    const endpoint = isPaused.value ? '/api/admin/downloader/resume' : '/api/admin/downloader/pause';
    await $fetch(endpoint, { method: 'POST' });
    isPaused.value = !isPaused.value;
    toast.success(isPaused.value ? 'Downloads paused.' : 'Downloads resumed.');
    fetchQueue();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'An error occurred.');
  } finally {
    pausingOrResuming.value = false;
  }
};

const handleSyncAll = async () => {
  syncingAll.value = true;
  try {
    const res = await $fetch<any>('/api/admin/downloader/sync-all', { method: 'POST' });
    toast.success(res.message || 'Sync started.');
    fetchQueue();
    refreshStats();
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Launch failed.');
  } finally {
    syncingAll.value = false;
  }
};

const handleRetryAllFailed = async () => {
  retryingFailed.value = true;
  try {
    await $fetch('/api/admin/downloader/retry-failed', { method: 'POST' });
    fetchQueue();
    toast.success('Failed downloads retried.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Retry failed.');
  } finally {
    retryingFailed.value = false;
  }
};

const handleClearQueue = async () => {
  if (!confirm('Do you want to clear the entire queue (unstarted videos will be removed)?')) return;
  try {
    await $fetch('/api/admin/downloader/clear-queue', { method: 'POST' });
    fetchQueue();
    toast.success('Queue cleared.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Action failed.');
  }
};

const handlePrioritizeTask = async (videoId: string) => {
  try {
    await $fetch('/api/admin/downloader/prioritize', {
      method: 'POST',
      body: { videoId }
    });
    fetchQueue();
    toast.success('Download set as priority.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Failed.');
  }
};

const handleCancelDownload = async (videoId: string) => {
  try {
    await $fetch('/api/admin/downloader/cancel', {
      method: 'POST',
      body: { videoId }
    });
    fetchQueue();
    toast.success('Download cancelled.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Cancellation failed.');
  }
};

const channelSearchInput = ref('');
const searching = ref(false);
const searchResults = ref<any[]>([]);
const ingesting = ref(false);
const ingestMessage = ref('');
const ingestSuccess = ref(false);

const defaultDownloadsDir = ref('');
const savingDir = ref(false);
const saveDirMessage = ref('');
const saveDirSuccess = ref(false);

const fetchDefaultDir = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/default-dir');
    defaultDownloadsDir.value = data.path || '/downloads/videos';
  } catch (err) {
    console.error('Failed to fetch default downloads directory:', err);
  }
};

const handleSaveDefaultDir = async () => {
  savingDir.value = true;
  saveDirMessage.value = '';
  saveDirSuccess.value = false;
  try {
    await $fetch('/api/admin/downloader/default-dir', {
      method: 'POST',
      body: {
        path: defaultDownloadsDir.value
      }
    });
    saveDirSuccess.value = true;
    saveDirMessage.value = 'Default downloads folder saved successfully.';
    toast.success('Default folder updated.');
  } catch (err: any) {
    saveDirSuccess.value = false;
    saveDirMessage.value = err.data?.statusMessage || 'Save failed.';
    toast.error(saveDirMessage.value);
  } finally {
    savingDir.value = false;
  }
};

const handleSearchOrIngest = async () => {
  const query = channelSearchInput.value.trim();
  if (!query) return;

  if (query.startsWith('http://') || query.startsWith('https://') || query.includes('youtube.com/')) {
    openIngestModal({
      id: null,
      title: 'Channel via URL',
      avatarUrl: '',
      handle: query,
      isDirectUrl: true
    });
  } else {
    searching.value = true;
    ingestMessage.value = '';
    searchResults.value = [];
    try {
      const data = await $fetch<any>('/api/admin/downloader/search-channels', {
        params: { q: query }
      });
      searchResults.value = data.channels || [];
      if (searchResults.value.length === 0) {
        toast.info('No channels found for this search.');
      }
    } catch (err: any) {
      toast.error(err.data?.statusMessage || 'Search failed.');
    } finally {
      searching.value = false;
    }
  }
};

const showIngestModal = ref(false);
const selectedSearchChannel = ref<any>(null);
const modalForm = reactive({
  custom_save_path: '',
  visibility: 'public',
  download_videos: true,
  download_shorts: false,
  date_after: '',
  sync_automatically: true,
  start_sync: true
});

const openIngestModal = (channel: any) => {
  selectedSearchChannel.value = channel;
  const baseDir = defaultDownloadsDir.value || '/downloads/videos';
  const cleanTitle = channel.title ? channel.title.replace(/[\\/:*?"<>|]/g, '_').trim() : (channel.id || '');
  modalForm.custom_save_path = `${baseDir}/${cleanTitle}`.replace(/\/+/g, '/');
  modalForm.visibility = 'public';
  modalForm.download_videos = true;
  modalForm.download_shorts = false;
  modalForm.date_after = '';
  modalForm.sync_automatically = true;
  modalForm.start_sync = true;
  showIngestModal.value = true;
};

const closeIngestModal = () => {
  showIngestModal.value = false;
  selectedSearchChannel.value = null;
};

const submitIngestModal = async () => {
  if (!selectedSearchChannel.value) return;

  ingesting.value = true;
  ingestMessage.value = '';
  showIngestModal.value = false;

  const targetUrl = selectedSearchChannel.value.isDirectUrl
    ? selectedSearchChannel.value.handle
    : `https://www.youtube.com/channel/${selectedSearchChannel.value.id}`;

  try {
    const res = await $fetch<any>('/api/admin/downloader/ingest', {
      method: 'POST',
      body: {
        url: targetUrl,
        download_videos: modalForm.download_videos,
        download_shorts: modalForm.download_shorts,
        date_after: modalForm.date_after ? modalForm.date_after.replace(/-/g, '') : undefined,
        sync_status: modalForm.sync_automatically ? 'active' : 'paused',
        visibility: modalForm.visibility,
        custom_save_path: modalForm.custom_save_path || undefined,
        start_sync: modalForm.start_sync
      }
    });

    ingestSuccess.value = res.success;
    ingestMessage.value = res.message;
    channelSearchInput.value = '';
    searchResults.value = [];
    fetchQueue();
    refreshStats();
    toast.success('Channel imported successfully!');
  } catch (err: any) {
    ingestSuccess.value = false;
    ingestMessage.value = err.data?.statusMessage || 'Import failed.';
    toast.error('Error importing channel.');
  } finally {
    ingesting.value = false;
  }
};

// Logs & Diagnostics
const diagnosticLogs = ref<string[]>([]);
const diagnosticYtdlPath = ref('');
const terminalBody = ref<HTMLElement | null>(null);

const fetchDiagnostics = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/logs');
    diagnosticLogs.value = data.logs || [];
    diagnosticYtdlPath.value = data.ytdlPath || '';
    
    setTimeout(() => {
      if (terminalBody.value) {
        terminalBody.value.scrollTop = terminalBody.value.scrollHeight;
      }
    }, 50);
  } catch (err) {
    console.error('Failed to fetch logs:', err);
  }
};

const getLogLineClass = (log: string) => {
  const l = log.toLowerCase();
  if (l.includes('[error]') || l.includes('error') || l.includes('failed')) return 'log-error';
  if (l.includes('[warning]') || l.includes('warning')) return 'log-warning';
  if (l.includes('success') || l.includes('completed') || l.includes('finished')) return 'log-success';
  if (l.includes('starting') || l.includes('started') || l.includes('info')) return 'log-info';
  return 'log-default';
};

/* ================= 3. CONFIGURATION TAB ================= */
const savingSchedule = ref(false);
const scheduleMessage = ref('');

const scheduleForm = reactive({
  enabled: false,
  preset: 'daily',
  schedule: '0 3 * * *'
});

const presets: Record<string, string> = {
  hourly: '0 * * * *',
  twelve_hours: '0 */12 * * *',
  daily: '0 3 * * *',
  weekly: '0 3 * * 0'
};

const applyPreset = () => {
  if (scheduleForm.preset !== 'custom') {
    scheduleForm.schedule = presets[scheduleForm.preset] || '0 3 * * *';
  }
};

const fetchSchedule = async () => {
  try {
    const data = await $fetch<any>('/api/admin/downloader/schedule');
    scheduleForm.enabled = data.enabled;
    scheduleForm.schedule = data.schedule || '0 3 * * *';
    
    // Find preset matching schedule
    const foundPreset = Object.keys(presets).find(k => presets[k] === scheduleForm.schedule);
    scheduleForm.preset = foundPreset || 'custom';
  } catch (err) {
    console.error('Failed to fetch schedule:', err);
  }
};

const handleSaveSchedule = async () => {
  savingSchedule.value = true;
  scheduleMessage.value = '';
  try {
    await $fetch('/api/admin/downloader/schedule', {
      method: 'POST',
      body: {
        enabled: scheduleForm.enabled,
        schedule: scheduleForm.schedule
      }
    });
    scheduleMessage.value = 'Synchronization frequency saved successfully.';
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Save failed.');
  } finally {
    savingSchedule.value = false;
  }
};

// yt-dlp test & update
const diagnosticBinaryTesting = ref(false);
const diagnosticBinaryResult = ref<any>(null);
const updatingYtdl = ref(false);
const updateConsoleOutput = ref('');

const handleTestBinary = async () => {
  diagnosticBinaryTesting.value = true;
  diagnosticBinaryResult.value = null;
  try {
    const res = await $fetch<any>('/api/admin/downloader/test-binary', { method: 'POST' });
    diagnosticBinaryResult.value = res;
    toast.success('Binary test completed.');
  } catch (err: any) {
    diagnosticBinaryResult.value = {
      success: false,
      stderr: err.data?.statusMessage || err.message || 'Unknown error'
    };
    toast.error('Binary test failed.');
  } finally {
    diagnosticBinaryTesting.value = false;
  }
};

const handleUpdateYtdl = async () => {
  updatingYtdl.value = true;
  updateConsoleOutput.value = 'Launching update...';
  try {
    const res = await $fetch<any>('/api/admin/downloader/update-ytdl', { method: 'POST' });
    updateConsoleOutput.value = res.output || 'Update completed successfully.';
    toast.success('yt-dlp updated.');
  } catch (err: any) {
    updateConsoleOutput.value = err.data?.statusMessage || err.message || 'Update failed.';
    toast.error('Update failed.');
  } finally {
    updatingYtdl.value = false;
  }
};

/* ================= 4. USERS TAB ================= */
const { data: usersData, pending: usersPending, refresh: refreshUsers } = await useFetch<{ users: any[] }>('/api/admin/users');
const users = computed(() => usersData.value?.users || []);

const editingUserId = ref<string | null>(null);
const fullChannelAccess = ref(true);

const userForm = reactive({
  username: '',
  password: '',
  role: 'user' as 'user' | 'admin',
  channelAccess: [] as string[]
});
const userFormMessage = ref('');
const userFormSuccess = ref(false);
const oldUsername = ref('');

const copyCredentials = () => {
  const text = `MyTeub Credentials:\nUsername: ${oldUsername.value || userForm.username}\nTemporary password: ${generatedPassword.value}`;
  navigator.clipboard.writeText(text).then(() => {
    toast.success('Credentials copied to clipboard!');
  }).catch(() => {
    toast.error('Copy failed.');
  });
};

const loadUserForEdit = (user: any) => {
  generatedPassword.value = '';
  oldUsername.value = '';
  editingUserId.value = user.id;
  userForm.username = user.username;
  userForm.password = '';
  userForm.role = user.role;
  userForm.channelAccess = [...(user.channelAccess || [])];
  
  // Set toggle if user channel access matches all available channels
  const allIds = channels.value.map((c: any) => c.id);
  fullChannelAccess.value = allIds.length > 0 && allIds.every((id: string) => userForm.channelAccess.includes(id));
  
  userFormMessage.value = '';
};

const cancelEditUser = () => {
  editingUserId.value = null;
  userForm.username = '';
  userForm.password = '';
  userForm.role = 'user';
  userForm.channelAccess = [];
  fullChannelAccess.value = true;
  userFormMessage.value = '';
};

const handleSaveUser = async () => {
  userFormMessage.value = '';
  const submitChannelAccess = fullChannelAccess.value && userForm.role === 'user'
    ? channels.value.map((c: any) => c.id)
    : userForm.channelAccess;

  try {
    if (editingUserId.value) {
      await $fetch(`/api/admin/users/${editingUserId.value}`, {
        method: 'PUT',
        body: {
          password: userForm.password || undefined,
          role: userForm.role,
          channelAccess: submitChannelAccess
        }
      });
      userFormSuccess.value = true;
      userFormMessage.value = 'User updated successfully.';
    } else {
      const res = await $fetch<any>('/api/admin/users', {
        method: 'POST',
        body: {
          username: userForm.username,
          password: userForm.password,
          role: userForm.role,
          channelAccess: submitChannelAccess
        }
      });
      userFormSuccess.value = true;
      userFormMessage.value = 'User created successfully.';
      if (res && res.password) {
        generatedPassword.value = res.password;
      }
    }
    oldUsername.value = userForm.username;
    cancelEditUser();
    refreshUsers();
  } catch (err: any) {
    userFormSuccess.value = false;
    userFormMessage.value = err.data?.statusMessage || 'An error occurred.';
  }
};

const handleDeleteUser = async (id: string, name: string) => {
  if (!confirm(`Permanently delete the user "${name}"?`)) return;
  try {
    await $fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    refreshUsers();
    toast.success('User deleted.');
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Delete failed.');
  }
};

const handleResetPassword = async (userId: string, username: string) => {
  if (!confirm(`Do you want to reset the password for "${username}"? A new temporary password will be generated.`)) return;
  try {
    const res = await $fetch<any>(`/api/admin/users/${userId}/reset-password`, {
      method: 'POST'
    });
    if (res && res.password) {
      generatedPassword.value = res.password;
      oldUsername.value = res.username;
      toast.success('Password reset.');
    }
  } catch (err: any) {
    toast.error(err.data?.statusMessage || 'Reset failed.');
  }
};

/* Helper formats */
const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatDate = (ts: number) => {
  return new Date(ts).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatStatus = (status: string) => {
  const s: Record<string, string> = {
    pending: 'Pending',
    downloading: 'Downloading',
    failed: 'Failed',
    completed: 'Completed'
  };
  return s[status] || status;
};

// Dynamic polling for queue and progress
let pollingTimeout: any = null;

const runPolling = async () => {
  if (!isAdmin.value) return;
  await fetchQueue();
  // Only poll diagnostics when downloads are active
  if (activeDownloadCount.value > 0) {
    await fetchDiagnostics();
  }
  
  // If we have active downloads, poll faster (500ms) for high reactivity, otherwise poll every 3000ms
  const nextPollDelay = activeDownloadCount.value > 0 ? 500 : 3000;
  pollingTimeout = setTimeout(runPolling, nextPollDelay);
};

onMounted(() => {
  if (isAdmin.value) {
    fetchSchedule();
    fetchDefaultDir();
    runPolling();
  }
});

onUnmounted(() => {
  if (pollingTimeout) clearTimeout(pollingTimeout);
});
</script>

<style scoped>
.settings-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.settings-layout {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  gap: 24px;
  align-items: start;
}

@media (max-width: 900px) {
  .settings-layout {
    grid-template-columns: 1fr;
  }
}

.settings-tabs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  border-radius: var(--border-radius-md);
}

@media (max-width: 900px) {
  .settings-tabs {
    flex-direction: row;
    overflow-x: auto;
    white-space: nowrap;
    padding: 8px;
  }
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.2s ease;
  width: 100%;
  text-align: left;
}

.tab-btn:hover {
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-primary);
}

.tab-btn.active {
  background: rgba(139, 92, 246, 0.1);
  color: white;
  box-shadow: inset 0 0 0 1px rgba(139, 92, 246, 0.2);
}

.tab-badge {
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: white;
  font-size: 9px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 8px;
  margin-left: auto;
}

.settings-content {
  flex: 1;
  min-width: 0;
}

.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.pane-header h2 {
  font-size: 24px;
  font-weight: 700;
  margin-bottom: 4px;
}

.pane-header p {
  color: var(--text-secondary);
  font-size: 14px;
}

/* Metrics Dashboard */
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}

.metric-card {
  display: flex;
  flex-direction: column;
  padding: 20px;
  border-radius: var(--border-radius-md);
}

.metric-label {
  font-size: 12px;
  text-transform: uppercase;
  color: var(--text-muted);
  font-weight: 700;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.metric-value {
  font-size: 28px;
  font-weight: 800;
  font-family: var(--font-title);
  line-height: 1.2;
}

.metric-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 4px;
}

.stats-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

@media (max-width: 768px) {
  .stats-row {
    grid-template-columns: 1fr;
  }
}

.stats-col {
  padding: 24px;
  border-radius: var(--border-radius-md);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stats-col h3 {
  font-size: 16px;
  font-weight: 600;
}

.stats-empty {
  color: var(--text-muted);
  font-size: 13px;
  padding: 12px 0;
}

.stats-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stats-list-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stats-item-info {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
}

.item-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 250px;
}

.item-count {
  color: var(--text-secondary);
}

.stats-item-bar-bg {
  height: 6px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 3px;
  overflow: hidden;
}

.stats-item-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-primary), var(--accent-primary-hover));
  border-radius: 3px;
}

.secondary-gradient {
  background: linear-gradient(90deg, var(--accent-secondary), var(--accent-secondary-hover)) !important;
}

/* Ingestion Form */
.ingest-box, .config-section, .profile-box {
  padding: 24px;
  border-radius: var(--border-radius-md);
}

.ingest-box h3, .config-section h3, .profile-box h4 {
  font-size: 16px;
  margin-bottom: 8px;
}

.section-desc {
  font-size: 13px;
  color: var(--text-secondary);
}

.ingest-form {
  display: flex;
  gap: 12px;
  margin-top: 16px;
}

@media (max-width: 600px) {
  .ingest-form {
    flex-direction: column;
  }
}

.form-input, .form-select {
  flex: 1;
  background: rgba(0, 0, 0, 0.4);
  border: 1px solid rgba(255, 255, 255, 0.08);
  padding: 10px 16px;
  border-radius: 8px;
  font-size: 14px;
  color: white;
  transition: border-color 0.2s;
}

.form-input:focus, .form-select:focus {
  border-color: var(--accent-primary);
  background: rgba(0, 0, 0, 0.6);
}

.form-select {
  cursor: pointer;
}

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary {
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: white;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.1);
}

.btn-danger-outline {
  background: transparent;
  border: 1px solid #ef4444;
  color: #ef4444;
}

.btn-danger-outline:hover {
  background: rgba(239, 68, 68, 0.1);
}

.queue-actions-row {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

/* Queue List */
.queue-box {
  padding: 24px;
  border-radius: var(--border-radius-md);
}

.queue-box h3 {
  font-size: 16px;
  margin-bottom: 16px;
}

.queue-empty {
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
  padding: 24px 0;
}

.queue-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.queue-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--border-radius-sm);
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.queue-details {
  display: flex;
  justify-content: space-between;
  align-items: start;
  gap: 16px;
}

.queue-text {
  flex: 1;
  min-width: 0;
}

.queue-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queue-channel {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.queue-error {
  font-size: 11px;
  color: #f87171;
  background: rgba(239, 68, 68, 0.08);
  border: 1px solid rgba(239, 68, 68, 0.15);
  border-radius: 4px;
  padding: 8px 12px;
  font-family: var(--font-mono, monospace);
  line-height: 1.4;
  word-break: break-word;
  white-space: pre-wrap;
}

.badge {
  padding: 3px 8px;
  font-size: 11px;
  border-radius: 4px;
  font-weight: 600;
}

.badge-pending {
  background: rgba(234, 179, 8, 0.15);
  color: #fbbf24;
}

.badge-downloading {
  background: rgba(139, 92, 246, 0.15);
  color: #a78bfa;
}

.badge-completed {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.badge-failed {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
}

.queue-progress-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.progress-bar-bg {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(
    90deg,
    var(--accent-primary) 0%,
    var(--accent-secondary) 50%,
    var(--accent-primary) 100%
  );
  background-size: 200% 100%;
  box-shadow: 0 0 8px var(--accent-primary-glow), 0 0 3px var(--accent-primary);
  border-radius: 3px;
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

.progress-percent {
  font-size: 12px;
  font-weight: 600;
  width: 35px;
  text-align: right;
}

.queue-meta {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary);
}

.queue-card-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.btn-xs {
  padding: 4px 10px;
  font-size: 11px;
  border-radius: 4px;
}

/* Logs Terminal */
.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.logs-header h3 {
  font-size: 15px;
}

.logs-terminal {
  background: #030307;
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 16px;
  font-family: monospace;
  font-size: 12px;
  max-height: 250px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.log-line {
  white-space: pre-wrap;
  word-break: break-all;
}

.log-default { color: #d1d5db; }
.log-info { color: #3b82f6; }
.log-success { color: #10b981; }
.log-warning { color: #f59e0b; }
.log-error { color: #ef4444; }

/* Configuration Elements */
.checkbox-container {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
  cursor: pointer;
  user-select: none;
}

.checkbox-container input {
  display: none;
}

.checkmark {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  display: inline-block;
  position: relative;
  transition: all 0.2s;
}

.checkbox-container input:checked ~ .checkmark {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}

.checkbox-container input:checked ~ .checkmark::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 1px;
  width: 4px;
  height: 8px;
  border: solid white;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg);
}

.schedule-settings-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 16px;
}

@media (max-width: 600px) {
  .schedule-settings-row {
    grid-template-columns: 1fr;
  }
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}

.form-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.diagnostic-pre {
  background: #030307;
  padding: 12px;
  border-radius: 6px;
  font-family: monospace;
  font-size: 11px;
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.diagnostic-status-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}

.diagnostic-label {
  font-weight: 600;
  color: var(--text-secondary);
  width: 70px;
}

.badge-status {
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 600;
}

.badge-success {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.badge-warning {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.badge-danger {
  background: rgba(239, 68, 68, 0.15);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.diagnostic-version-text {
  font-size: 12px;
  color: var(--text-secondary);
}

.ffmpeg-warning-box {
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.15);
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.warning-title {
  color: #f59e0b;
  display: block;
  margin-bottom: 4px;
}

.warning-desc {
  margin: 0;
}

.btn-group {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}



/* Users Admin Layout */
.users-layout {
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 24px;
  align-items: start;
}

@media (max-width: 900px) {
  .users-layout {
    grid-template-columns: 1fr;
  }
}

.user-form-panel, .users-list-panel {
  padding: 24px;
  border-radius: var(--border-radius-md);
}

.role-selector {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.role-option {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  background: rgba(0, 0, 0, 0.2);
  text-align: center;
}

.role-option input {
  display: none;
}

.role-option span {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.role-option.selected {
  border-color: var(--accent-primary);
  background: rgba(139, 92, 246, 0.08);
}

.role-option.selected span {
  color: white;
}

.permissions-grids {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.perm-col {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.perm-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
}

.checklist-container {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 6px;
  padding: 8px;
  max-height: 150px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.check-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  cursor: pointer;
}

.check-item input {
  cursor: pointer;
}

.check-item span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.form-msg {
  padding: 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
}

.success-msg {
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.error-msg {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
}

.users-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.user-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: var(--border-radius-sm);
  padding: 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.user-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.user-headline {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-created {
  font-size: 11px;
}

.user-access-summary {
  display: flex;
  gap: 12px;
  font-size: 11px;
  margin-top: 4px;
}

.user-actions {
  display: flex;
  gap: 8px;
}

.btn-icon-sm {
  padding: 8px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Account Profile Pane */
.profile-details-row {
  display: flex;
  align-items: center;
  gap: 20px;
}

.profile-avatar-large {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  font-weight: 800;
  font-family: var(--font-title);
  box-shadow: 0 4px 16px var(--accent-primary-glow);
}

.profile-meta-info {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.profile-meta-info h3 {
  font-size: 20px;
}

.password-change-form {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 20px;
}

.password-change-form h4 {
  font-size: 14px;
  margin-bottom: 12px;
}

.ml-2 { margin-left: 8px; }
.mr-2 { margin-right: 8px; }
.mt-2 { margin-top: 8px; }
.mt-3 { margin-top: 12px; }
.mt-4 { margin-top: 24px; }
.text-success { color: #4ade80; }
.text-danger { color: #f87171; }
.text-muted { color: var(--text-muted); }

@keyframes spin {
  to { transform: rotate(360deg); }
}

.spin-anim {
  animation: spin 1.2s linear infinite;
}

/* Modals */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  animation: fadeIn 0.2s ease-out;
}

.modal-content {
  width: 90%;
  max-width: 550px;
  background: rgba(18, 18, 29, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: var(--border-radius-md);
  padding: 24px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
  animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  padding-bottom: 12px;
}

.modal-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
}

.btn-close {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.btn-close:hover {
  color: white;
}

/* Search results styles */
.search-results-list {
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  padding-top: 16px;
}

.search-results-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 300px;
  overflow-y: auto;
  padding-right: 4px;
}

.search-channel-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  transition: all 0.2s;
}

.search-channel-card:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(255, 255, 255, 0.08);
}

.channel-avatar-thumb {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  object-fit: cover;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(0, 0, 0, 0.2);
}

.channel-search-info {
  flex: 1;
  min-width: 0;
}

.channel-search-info h5 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: white;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.channel-search-meta {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
}

.channel-search-desc {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Global status badges */
.badge-active-global {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

.badge-paused-global {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
  border: 1px solid rgba(245, 158, 11, 0.2);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 600;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
</style>
