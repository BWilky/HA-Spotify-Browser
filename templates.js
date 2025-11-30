import { msToTime } from './utils.js';

export const Templates = {
    mainStructure: () => `
      <div class="editor-placeholder">
          <div class="editor-icon">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.59 14.42c-.2.3-.59.4-.89.2-2.43-1.48-5.49-1.81-9.08-1-33 .07-.55-.16-.62-.47-.07-.33.16-.55.47-.62 3.92-.89 7.33-.52 10.1 1.17.29.19.38.58.19.89zm1.27-2.83c-.25.41-.78.53-1.19.28-2.99-1.84-7.55-2.37-11.09-1.3-.46.14-.95-.12-1.09-.58-.14-.46.12-.95.58-1.09 4.07-1.23 9.14-.62 12.6 1.51.41.24.53.77.28 1.19zm.13-2.97c-3.58-2.13-9.49-2.33-12.91-1.27-.54.17-1.12-.13-1.29-.67-.17-.54.13-1.12.67-1.29 4.02-1.21 10.56-.98 14.71 1.49.49.29.65.92.36 1.41-.29.49-.92.65-1.41.36z"/></svg>
          </div>
          <div class="editor-text">
              <strong>Spotify Browser</strong>
              <span>Hidden Component</span>
          </div>
      </div>
      
      <div class="backdrop" id="backdrop"></div>
      <div class="browser-wrapper" id="browser-wrapper">
        <div class="header">
          <div class="header-left">
            <button class="nav-btn" id="back-btn" style="display:none;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <svg class="spotify-logo" viewBox="0 0 168 168"><path d="M83.996.277C37.747.277.253 37.77.253 84.019c0 46.251 37.494 83.741 83.743 83.741 46.254 0 83.744-37.49 83.744-83.741 0-46.246-37.49-83.738-83.745-83.738zM121.49 121.36a4.789 4.789 0 0 1-6.574 1.574c-18.01-11.005-40.69-13.473-67.41-7.36a4.784 4.784 0 0 1-5.78-3.585 4.789 4.789 0 0 1 3.584-5.784c29.175-6.663 54.287-3.889 74.611 8.582a4.785 4.785 0 0 1 1.568 6.573zm9.457-21.207a5.996 5.996 0 0 1-8.22 1.991c-20.59-12.656-51.975-16.316-76.28-8.84a5.995 5.995 0 0 1-7.508-3.968 5.993 5.993 0 0 1 3.967-7.508c27.62-8.49 62.293-4.407 86.048 10.103a5.996 5.996 0 0 1 1.992 8.222zm1.102-22.266c-24.66-14.64-65.388-15.997-88.933-8.845a7.186 7.186 0 0 1-9.004-4.756 7.191 7.191 0 0 1 4.754-9.003c27.094-8.22 72.132-6.655 100.82 10.385a7.195 7.195 0 0 1 2.365 9.855 7.192 7.192 0 0 1-9.855 2.364h-.147z"/></svg>
          </div>
          
          <div class="header-center-title"></div>

          <div class="header-right">
            <div class="search-container" id="search-container">
                <button class="search-icon-btn" id="search-toggle">
                    <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                </button>
                <input type="text" class="search-input" id="search-input" placeholder="Search...">
            </div>
            
            <button class="nav-btn" id="queue-btn" style="margin-left: 4px;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
            </button>

            <button class="nav-btn" id="menu-btn" style="margin-left:4px;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
            </button>
            <button class="nav-btn" id="close-btn">
              <svg width="24" height="24" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
            
            <div class="dropdown-menu" id="dropdown-menu">
                <div class="menu-item" data-action="menu-library">Your Library</div>
                <div class="menu-item" data-action="menu-device">Device Playback</div>
                <div class="menu-item" data-action="menu-refresh">Refresh Data</div>
            </div>
          </div>
        </div>
        
        <div class="queue-panel" id="queue-panel">
            <div class="queue-header-wrapper">
                <div class="mobile-drag-handle"></div>
                <div id="queue-now-playing"></div>
            </div>
            <div class="queue-list" id="queue-list">
                <div style="padding:20px; text-align:center; color:#666;">Loading queue...</div>
            </div>
        </div>

        <div class="device-popup-backdrop" id="device-popup">
            <div class="device-popup-content">
                <h3 class="device-popup-title">Connect to a device</h3>
                <div class="device-list" id="device-list"></div>
                <button class="device-close-btn">Close</button>
            </div>
        </div>
        
        <div class="alert-backdrop" id="alert-backdrop">
            <div class="alert-content">
                <h3 class="alert-title" id="alert-title">Alert</h3>
                <div class="alert-message" id="alert-message">Something happened.</div>
                <div class="alert-actions" id="alert-actions">
                    </div>
            </div>
        </div>

        <div class="page-container" id="page-container"></div>
      </div>
    `,

    // --- HOME TEMPLATES ---

    homeDesktop: (hasMadeForYou, order, usePills = false) => {
        const sections = {
            'recent': renderCarouselSection('Recently Played', 'recent'),
            'favorites': renderCarouselSection('Your Favorite Playlists', 'favorites'),
            'artists': renderCarouselSection('Followed Artists', 'artists'),
            'albums': renderCarouselSection('Your Favorite Albums', 'albums'),
            
            // FIX: Choose layout based on config
            'madeforyou': hasMadeForYou 
                ? (usePills ? renderPillSection('Made For You', 'madeforyou') : renderCarouselSection('Made For You', 'madeforyou')) 
                : ''
        };

        const html = order.map(key => sections[key] || '').join('');

        return `
            ${Templates.refreshSpinner()}
            <div class="scroll-content">
                ${html}
            </div>
        `;
    },

    homeMobile: (hasMadeForYou, order) => {
        const sections = {
            // Special Grid for Recent on Mobile
            'recent': `
                <h3 class="section-title" style="margin-bottom:16px;">Good Morning</h3>
                <div class="recent-grid-layout" id="grid-recent" data-section="recent" style="margin-bottom: 32px;">
                    ${Array(6).fill(0).map(() => recentPillSkeleton()).join('')}
                </div>
            `,
            'favorites': renderCarouselSection('Your Playlists', 'favorites'),
            'artists': renderCarouselSection('Your Artists', 'artists'),
            'albums': renderCarouselSection('Your Albums', 'albums'),
            'madeforyou': hasMadeForYou ? renderCarouselSection('Made For You', 'madeforyou') : ''
        };

        const html = order.map(key => sections[key] || '').join('');

        return `
            ${Templates.refreshSpinner()}
            <div class="scroll-content">
                ${html}
            </div>
        `;
    },

    search: (query) => `
      ${Templates.refreshSpinner()}
      <div class="scroll-content">
        <h2 class="page-title">Top Results for "${query}"</h2>
        ${renderCarouselSection('Songs', 'search-songs', { query, type: 'track' })}
        ${renderCarouselSection('Artists', 'search-artists', { query, type: 'artist' })}
        ${renderCarouselSection('Albums', 'search-albums', { query, type: 'album' })}
        ${renderCarouselSection('Playlists', 'search-playlists', { query, type: 'playlist' })}
      </div>
    `,
    searchResults: (type, query) => `
        ${Templates.refreshSpinner()}
        
        <div class="scroll-content" data-search-type="${type}" data-search-query="${query}">
            <div class="search-list-layout" id="search-results-grid">
                ${Array(12).fill(0).map(() => {
                    if (type === 'track') return `<div class="track-row skeleton-row"><div class="sk-text w-5"></div><div class="sk-text w-40"></div><div class="sk-text w-20"></div></div>`;
                    return Templates.listItemSkeleton(type === 'artist');
                }).join('')}
            </div>
            <div id="search-loader" style="padding:20px; text-align:center; opacity:0;">
                Loading more...
            </div>
        </div>
    `,

    // --- COMPONENT TEMPLATES ---

    refreshSpinner: () => `
        <div class="pull-to-refresh">
            <div class="ptr-spinner">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </div>
        </div>
    `,

    recentPill: (item) => {
        const id = item.id;
        const uri = item.uri;
        const title = item.name || 'Unknown';
        let img = '';
        if (item.images && item.images.length > 0) img = item.images[0].url;
        else if (item.album && item.album.images && item.album.images.length > 0) img = item.album.images[0].url;

        return `
        <div class="recent-pill interactive" 
             data-id="${id}" 
             data-type="${item.type}" 
             data-uri="${uri}"
             data-title="${title.replace(/"/g, '&quot;')}"
             data-subtitle="">
            <div class="recent-pill-img" style="background-image: url('${img}');"></div>
            <div class="recent-pill-text">${title}</div>
        </div>
        `;
    },
    

    drillDown: (data) => {
        const title = data?.title || 'Loading...';
        const subtitle = data?.subtitle || '';
        const type = data?.type || 'playlist';
        
        return `
          ${Templates.refreshSpinner()}
          <div class="hero-banner">
            <div class="hero-bg"></div>
            <div class="hero-content">
               <div class="hero-art skeleton-pulse"></div>
               <div class="hero-text">
                  <div class="hero-type">${type}</div>
                  <h1 class="hero-title">${title}</h1>
                  <div class="hero-subtitle">${subtitle}</div>
                  <div class="hero-actions"></div>
               </div>
            </div>
          </div>
          <div class="scroll-content has-hero">
            <div class="track-list">
               ${Array(10).fill(0).map(() => `
                  <div class="track-row skeleton-row">
                     <div class="sk-text w-5"></div>
                     <div class="sk-text w-40"></div>
                     <div class="sk-text w-20"></div>
                  </div>
               `).join('')}
            </div>
          </div>
        `;
    },

    artist: (data) => `
      ${Templates.refreshSpinner()}
      <div class="artist-hero">
        <div class="hero-bg"></div>
        <div class="hero-gradient"></div>
        <div class="artist-header-content">
            <h1 class="artist-hero-name">${data.title || 'Loading...'}</h1>
            <div class="hero-actions" style="margin-left: 24px; margin-bottom: 24px;"></div>
        </div>
      </div>
      <div class="scroll-content" style="padding-top: 20px;">
        <section class="home-section">
            <h3 class="section-title">Popular</h3>
            <div class="artist-track-grid">
                ${Array(8).fill(0).map(() => `
                   <div class="artist-top-track skeleton-pulse" style="height: 56px; border-radius: 6px;"></div>
                `).join('')}
            </div>
        </section>
        <section class="home-section">
            <h3 class="section-title">Discography</h3>
            <div class="carousel-wrapper">
                <div class="carousel-layout" id="artist-albums">
                    ${Array(6).fill(0).map(() => cardSkeleton()).join('')}
                </div>
            </div>
        </section>
        <section class="home-section">
            <h3 class="section-title">Discovered On</h3>
            <div class="carousel-wrapper">
                <div class="carousel-layout" id="artist-playlists">
                    ${Array(6).fill(0).map(() => cardSkeleton()).join('')}
                </div>
            </div>
        </section>
      </div>
    `,

    cardSkeleton: (isCircle) => cardSkeleton(isCircle),

    mediaCard: (item, type) => {
        const id = item.id;
        const uri = item.uri;
        const title = item.name || item.title || 'Unknown';
        
        let subtitle = item.subtitle;
        if (!subtitle && item.owner) subtitle = item.owner.display_name; 
        if (!subtitle && item.artists && Array.isArray(item.artists)) subtitle = item.artists.map(a => a.name).join(', '); 
        if (!subtitle) subtitle = type === 'artist' ? 'Artist' : '';

        let img = '';
        if (type === 'track' && item.album && item.album.images && item.album.images.length > 0) {
            img = item.album.images[0].url;
        } else if (item.images && item.images.length > 0) {
            img = item.images[0].url;
        } else if (item.album && item.album.images && item.album.images.length > 0) {
            img = item.album.images[0].url;
        }
        
        const safeTitle = title.replace(/"/g, '&quot;');
        const safeSubtitle = subtitle.replace(/"/g, '&quot;');

        const isArtist = type === 'artist';
        const imageStyle = isArtist ? 'border-radius: 50%;' : '';
        const containerClass = isArtist ? 'media-card artist-card interactive' : 'media-card interactive';

        return `
          <div class="${containerClass}" 
               data-id="${id}" 
               data-type="${type}" 
               data-uri="${uri || ''}" 
               data-title="${safeTitle}"
               data-subtitle="${safeSubtitle}">
            <div class="media-image-wrapper">
                <div class="media-image" style="background-image: url('${img}'); background-color: #282828; ${imageStyle}"></div>
                ${!isArtist ? `
                <button class="play-btn-overlay">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                </button>
                ` : ''}
            </div>
            <div class="media-title" ${isArtist ? 'style="text-align:center;"' : ''}>${title}</div>
            <div class="media-subtitle" ${isArtist ? 'style="text-align:center;"' : ''}>${subtitle}</div>
          </div>
        `;
    },

    trackRow: (track, index, showArt = false) => {
        const duration = msToTime(track.duration_ms);
        const artistNames = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown';
        const uri = track.uri || '';
        
        // Determine First Column Content (Art vs Index)
        let firstColHtml = `<div class="track-num">${index}</div>`;
        let rowClass = "track-row interactive";
        
        if (showArt) {
            let img = '';
            if (track.album && track.album.images && track.album.images.length > 0) {
                // Use smallest image for list performance
                img = track.album.images[track.album.images.length - 1].url;
            }
            firstColHtml = `<div class="track-art-small" style="background-image: url('${img}');"></div>`;
            rowClass += " with-art"; // Trigger CSS grid change
        }

        return `
            <div class="${rowClass}" data-track-id="${track.id}" data-uri="${uri}">
                ${firstColHtml}
                <div class="track-info">
                    <div class="track-name">${track.name}</div>
                    <div class="track-artist">${artistNames}</div>
                </div>
                <div class="track-duration">${duration}</div>
                <div class="track-actions-right">
                    <button class="track-action-btn" data-action="save">
                       <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                    </button>
                    <button class="track-action-btn" data-action="queue">
                       <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                    </button>
                </div>
            </div>
        `;
    },
    
    artistTopTrack: (track) => {
        let img = '';
        if (track.album && track.album.images && track.album.images.length > 0) {
            img = track.album.images[0].url;
        }
        const duration = msToTime(track.duration_ms);
        const pop = track.popularity ? `${track.popularity}%` : '';
        
        return `
          <div class="artist-top-track interactive" data-id="${track.id}" data-type="track" data-uri="${track.uri}">
              <div class="track-art-left" style="background-image: url('${img}');">
                  <button class="play-btn-overlay mini">
                      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                  </button>
              </div>
              <div class="track-info-middle">
                  <div class="track-title">${track.name}</div>
                  <div class="track-meta">${duration} ${pop ? '• ' + pop : ''}</div>
              </div>
              <div class="track-actions-right">
                  <button class="track-action-btn" data-action="save">
                     <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                  </button>
                  <button class="track-action-btn" data-action="queue">
                     <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                  </button>
              </div>
          </div>
        `;
    },
    
    /* --- New List Item for Search Results --- */
    listItem: (item, type) => {
        const id = item.id;
        const uri = item.uri;
        const title = item.name || 'Unknown';
        
        // Subtitle logic
        let subtitle = '';
        if (type === 'artist') subtitle = 'Artist';
        else if (item.owner) subtitle = `Playlist • ${item.owner.display_name}`;
        else if (item.artists) subtitle = `Album • ${item.artists.map(a => a.name).join(', ')}`;

        // Image logic
        let img = '';
        if (item.images && item.images.length > 0) img = item.images[0].url;
        
        const safeTitle = title.replace(/"/g, '&quot;');
        const isArtist = type === 'artist';

        return `
        <div class="list-item interactive ${isArtist ? 'artist' : ''}" 
             data-id="${id}" 
             data-type="${type}" 
             data-uri="${uri}"
             data-title="${safeTitle}"
             data-subtitle="${subtitle.replace(/"/g, '&quot;')}">
            
            <div class="list-item-img" style="background-image: url('${img}');"></div>
            
            <div class="list-item-info">
                <div class="list-item-title">${title}</div>
                <div class="list-item-subtitle">${subtitle}</div>
            </div>
            
            <div class="list-item-action">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
            </div>
        </div>
        `;
    },

    listItemSkeleton: (isArtist) => `
        <div class="list-item skeleton-pulse">
            <div class="list-item-img" style="${isArtist ? 'border-radius: 50%' : ''}; background: #282828;"></div>
            <div class="list-item-info" style="width: 100%">
                <div class="card-text-sk" style="width: 40%"></div>
                <div class="card-text-sk short" style="width: 20%"></div>
            </div>
        </div>
    `,
    
    emptyDevices: () => `
        <div class="device-empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
                <line x1="6" y1="6" x2="6.01" y2="6"></line>
                <line x1="6" y1="18" x2="6.01" y2="18"></line>
            </svg>
            <div class="empty-text">No Devices Discovered</div>
            <div class="empty-sub">Make sure your device is on and connected.</div>
            <button class="device-refresh-btn">Refresh List</button>
        </div>
    `,
    

    /* --- QUEUE TEMPLATES --- */

    nowPlayingRow: (track, isPlaying, showMiniPlayer = false, isFavorite = false) => {
        const artists = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown';
        const img = track.image_url || (track.album?.images?.[0]?.url) || '';
        const icon = isPlaying 
            ? `<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`
            : `<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;

        let extras = '';
        let progressBar = '';
        
        if (showMiniPlayer) {
            const heartClass = isFavorite ? 'is-favorite' : '';
            extras = `
            <div class="queue-mini-controls">
                <button class="mini-btn" data-action="mini-prev">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
                </button>
                
                <button class="mini-btn" data-action="mini-skip">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
                </button>
                
                <button class="mini-btn ${heartClass}" data-action="mini-fav" data-id="${track.id}">
                     <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
                </button>
            </div>`;
            
            progressBar = `
            <div class="queue-progress-container">
                <div class="queue-progress-bar" id="mini-progress-bar"></div>
            </div>`;
        }

        return `
        <div class="queue-now-playing-row">
            <div class="queue-item-content">
                <div class="queue-art large" style="background-image: url('${img}')"></div>
                <div class="queue-info">
                    <div class="queue-title active">${track.name}</div>
                    <div class="queue-artist">${artists}</div>
                </div>
                <button class="queue-play-btn" id="queue-hero-play-btn">
                    ${icon}
                </button>
            </div>
        </div>
        ${extras}
        ${progressBar}
        `;
    },

    queueRow: (track) => {
        const artists = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown';
        
        let img = track.image_url || '';
        if (!img && track.album && track.album.images && track.album.images.length > 0) {
             img = track.album.images[track.album.images.length - 1].url;
        }
            
        return `
        <div class="queue-item">
            <div class="queue-status-icon">
                <div class="q-circle"></div>
            </div>
            <div class="queue-art" style="background-image: url('${img}')"></div>
            <div class="queue-info">
                <div class="queue-title">${track.name}</div>
                <div class="queue-artist">${artists}</div>
            </div>
            <button class="queue-row-play-btn" data-uri="${track.uri}">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </button>
        </div>
        `;
    },

    emptyQueue: () => `
        <div class="queue-empty-state">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#333" stroke-width="1"><path d="M9 17H5v-2h4v2zm9-2h-4v2h4v-2zm-9-4H5v-2h4v2zm9-2h-4v2h4v-2zm-9-4H5V3h4v2zm9-2h-4v2h4V3zM3 21h18v-2H3v2z"/></svg>
            <div class="empty-text">Queue is empty</div>
            <div class="empty-sub">Add songs to see them here</div>
        </div>
    `,
    
    emptyPlayer: () => `
        <div class="queue-now-playing-row">
            <div class="queue-item-content" style="opacity:0.5">
                <div class="queue-art large" style="background-color:#333"></div>
                <div class="queue-info">
                    <div class="queue-title">Nothing playing</div>
                    <div class="queue-artist">Select music to start</div>
                </div>
            </div>
        </div>
    `
};

function renderCarouselSection(title, sectionId, seeMoreParams = null) {
    // seeMoreParams = { query: '...', type: 'artist' }
    let headerBtn = '';
    if (seeMoreParams) {
        headerBtn = `<button class="see-all-btn" data-action="search-more" data-query="${seeMoreParams.query}" data-type="${seeMoreParams.type}">See All</button>`;
    } else {
        headerBtn = `<button class="see-all-btn" data-action="toggle-view" style="display:none">See All</button>`;
    }

    return `
    <section class="home-section" data-section-id="${sectionId}">
        <div class="section-header">
            <h3 class="section-title">${title}</h3>
            ${headerBtn}
        </div>
        <div class="carousel-wrapper">
            <div class="carousel-layout" id="carousel-${sectionId}" data-section="${sectionId}">
                ${Array(6).fill(0).map(() => cardSkeleton(sectionId.includes('artists'))).join('')}
            </div>
            <button class="scroll-btn right" data-action="scroll-right">
                <svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>
            </button>
        </div>
    </section>
    `;
}

function cardSkeleton(isCircle = false) {
    return `
      <div class="media-card skeleton-pulse ${isCircle ? 'artist-card' : ''}">
        <div class="card-image-sk" style="${isCircle ? 'border-radius:50%' : ''}"></div>
        <div class="card-text-sk"></div>
        <div class="card-text-sk short"></div>
      </div>
    `;
}

function renderPillSection(title, sectionId) {
    return `
    <section class="home-section" data-section-id="${sectionId}">
        <div class="section-header">
            <h3 class="section-title">${title}</h3>
        </div>
        <!-- Using 'recent-grid-layout' class triggers the Pill renderer in JS -->
        <div class="recent-grid-layout" id="grid-${sectionId}" data-section="${sectionId}">
            ${Array(8).fill(0).map(() => recentPillSkeleton()).join('')}
        </div>
    </section>
    `;
}


