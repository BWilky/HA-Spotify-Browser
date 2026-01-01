import { msToTime } from './utils.js';

export const Templates = {
    mainStructure: () => `
      <div class="editor-placeholder">
          <!-- ... (keep existing placeholder code) ... -->
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
          <!-- ... (keep header-left, title, search-container, queue-btn) ... -->
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
                <!-- NEW: Switch Accounts Option -->
                <div class="menu-item" data-action="menu-accounts">Switch Accounts</div>
                <div class="menu-item" data-action="menu-refresh">Refresh Data</div>
            </div>
          </div>
        </div>
        
        <!-- Queue Panel -->
        <div class="queue-panel" id="queue-panel">
            <div class="queue-header-wrapper">
                <div class="mobile-drag-handle"></div>
                <div id="queue-now-playing"></div>
            </div>
            <div class="queue-list" id="queue-list">
                <div style="padding:20px; text-align:center; color:#666;">Loading queue...</div>
            </div>
        </div>

        <!-- Device Popup -->
        <div class="device-popup-backdrop" id="device-popup">
            <div class="device-popup-content">
                <h3 class="device-popup-title">Connect to a device</h3>
                <div class="device-list" id="device-list"></div>
                <button class="device-close-btn">Close</button>
            </div>
        </div>

        <!-- NEW: Accounts Popup (Reuses device-popup classes) -->
        <div class="device-popup-backdrop" id="accounts-popup">
            <div class="device-popup-content">
                <h3 class="device-popup-title">Switch Account</h3>
                <div class="device-list" id="accounts-list"></div>
                <button class="device-close-btn" data-action="close-accounts">Close</button>
            </div>
        </div>

        <div class="device-popup-backdrop" id="track-context-popup">
            <div class="device-popup-content">
                
                <div class="track-popup-header">
                    <div class="track-popup-art" id="track-popup-art"></div>
                    <div class="track-popup-info">
                        <div class="track-popup-title-text" id="track-popup-title">Track Options</div>
                        <div class="track-popup-artist-text" id="track-popup-artist"></div>
                    </div>
                </div>
    
                <button class="track-popup-item" data-action="tm-play">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                    Play Now
                </button>
                
                <button class="track-popup-item" data-action="tm-queue">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
                    Add to Queue
                </button>
                
                <button class="track-popup-item" data-action="tm-radio">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-5.5-2.5l7.51-3.22-7.51-3.22V17.5z"/></svg>
                    Start Radio
                </button>
                
                <button class="track-popup-item" data-action="tm-artist">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                    Go to Artist
                </button>
    
                <button class="device-close-btn" id="track-popup-close">
                    Cancel
                </button>
            </div>
        </div>

    <div class="alert-backdrop" id="alert-backdrop">
        <div class="alert-content">
            <h3 class="alert-title" id="alert-title">Alert</h3>
            <div class="alert-message" id="alert-message">...</div>
            <div class="alert-actions" id="alert-actions"></div>
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
            <div class="scroll-content">
                ${html}
            </div>
        `;
    },

    search: (query) => `
      <div class="scroll-content">
        <h2 class="page-title">Top Results for "${query}"</h2>
        ${renderCarouselSection('Songs', 'search-songs', { query, type: 'track' })}
        ${renderCarouselSection('Artists', 'search-artists', { query, type: 'artist' })}
        ${renderCarouselSection('Albums', 'search-albums', { query, type: 'album' })}
        ${renderCarouselSection('Playlists', 'search-playlists', { query, type: 'playlist' })}
      </div>
    `,
    searchResults: (type, query) => `
        
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

        <section class="home-section" style="display:none;">
            <h3 class="section-title">Fans Also Like</h3>
            <div class="carousel-wrapper">
                <div class="carousel-layout" id="artist-similar">
                    ${Array(6).fill(0).map(() => cardSkeleton(true)).join('')}
                </div>
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

    // In templates.js inside the Templates object

    mediaCard: (item, type) => {
        // 1. Extract IDs and Titles
        // Last.fm items will have id: null, which is fine (handled in click logic)
        const id = item.id;
        const uri = item.uri;
        const title = item.name || item.title || 'Unknown';
        
        // 2. Determine Subtitle
        // For Last.fm artists, this falls through to the default 'Artist'
        let subtitle = item.subtitle;
        if (!subtitle && item.owner) subtitle = item.owner.display_name; 
        if (!subtitle && item.artists && Array.isArray(item.artists)) subtitle = item.artists.map(a => a.name).join(', '); 
        if (!subtitle) subtitle = type === 'artist' ? 'Artist' : '';
    
        // 3. Extract Image
        // This logic works for both Spotify (images array) and our Last.fm mapper (images array)
        let img = '';
        if (type === 'track' && item.album && item.album.images && item.album.images.length > 0) {
            img = item.album.images[0].url;
        } else if (item.images && item.images.length > 0) {
            img = item.images[0].url;
        } else if (item.album && item.album.images && item.album.images.length > 0) {
            img = item.album.images[0].url;
        }
        
        // 4. Safety & Styling
        const safeTitle = title.replace(/"/g, '&quot;');
        const safeSubtitle = subtitle.replace(/"/g, '&quot;');
    
        // Artists get circular rendering
        const isArtist = type === 'artist';
        const imageStyle = isArtist ? 'border-radius: 50%;' : '';
        const containerClass = isArtist ? 'media-card artist-card interactive' : 'media-card interactive';
    
        // 5. HTML Template
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
        
        let img = '';
            
        if (showArt) {
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
                    <button class="track-action-btn" data-action="menu" data-track-data='${JSON.stringify({
                        name: track.name,
                        artist: artistNames,
                        uri: uri,
                        id: track.id,
                        image: img
                    }).replace(/'/g, "&#39;")}'>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><circle cx="5" cy="12" r="2"/></svg>
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

    // Update signature to accept 'components'
    // --- In templates.js (inside Templates object) ---

    // --- In templates.js (inside Templates object) ---



    nowPlayingRow: (track, isPlaying, showMini, isFav, components, showVol, vol, deviceName) => {
        // 1. Data Setup
        const title = track.name || '';
        const artist = track.artists.map(a => a.name).join(', ');
        const img = track.image_url || '';
        const id = track.id || '';
    
        // 2. Play/Pause Icons
        const playIcon = '<path d="M8 5v14l11-7z"/>';
        const pauseIcon = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';
        const currentIcon = isPlaying ? pauseIcon : playIcon;
    
        // --- UPDATED ICON: YOUR SPECIFIC SPEAKER SVG ---
        const deviceIconPath = "M12,12A3,3 0 0,0 9,15A3,3 0 0,0 12,18A3,3 0 0,0 15,15A3,3 0 0,0 12,12M12,20A5,5 0 0,1 7,15A5,5 0 0,1 12,10A5,5 0 0,1 17,15A5,5 0 0,1 12,20M12,4A2,2 0 0,1 14,6A2,2 0 0,1 12,8C10.89,8 10,7.1 10,6C10,4.89 10.89,4 12,4M17,2H7C5.89,2 5,2.89 5,4V20A2,2 0 0,0 7,22H17A2,2 0 0,0 19,20V4C19,2.89 18.1,2 17,2Z";
    
        // 3. Device Row (Using New Icon)
        const deviceDisplay = deviceName ? 'flex' : 'none';
        const deviceHtml = `
            <div class="queue-device-row" style="display: ${deviceDisplay}">
                <svg viewBox="0 0 24 24"><path fill="currentColor" d="${deviceIconPath}"/></svg>
                <span class="device-name-text">${deviceName || ''}</span>
            </div>`;
    
        // 4. Large Play Button (Right Side)
        const mainPlayBtn = `
            <div class="queue-play-btn large-side-btn" id="queue-hero-play-btn">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor">${currentIcon}</svg>
            </div>
        `;
    
        // 5. Controls Logic
        let bottomRowHtml = '';
    
        if (showVol) {
            // --- Volume Slider ---
            bottomRowHtml = `
                <div class="volume-control-container">
                    <div class="vol-icon"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg></div>
                    <input type="range" class="volume-slider" id="mini-vol-slider" min="0" max="100" value="${Math.round(vol * 100)}">
                    <button class="mini-btn" data-action="close-volume" style="margin-left:12px;">
                        <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                </div>
            `;
        } else if (showMini) {
            // --- Standard Controls (Updated Device Button Icon) ---
            bottomRowHtml = `
                <div class="queue-mini-controls">
                    ${components.shuffle ? `<button class="mini-btn" data-action="mini-shuffle"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg></button>` : ''}
                    ${components.previous ? `<button class="mini-btn" data-action="mini-prev"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>` : ''}
                    
                    ${components.next ? `<button class="mini-btn" data-action="mini-skip"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>` : ''}
                    
                    ${components.like ? `<button class="mini-btn ${isFav ? 'is-favorite' : ''}" data-action="mini-fav" data-id="${id}"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></button>` : ''}
                    
                    ${components.volume ? `<button class="mini-btn" data-action="mini-volume"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg></button>` : ''}
                    
                    ${components.device ? `<button class="mini-btn" data-action="mini-device"><svg viewBox="0 0 24 24"><path fill="currentColor" d="${deviceIconPath}"/></svg></button>` : ''}
                </div>
            `;
        }
    
        const progressBar = `
            <div class="queue-progress-container">
                <div class="queue-progress-bar" id="mini-progress-bar"></div>
            </div>
        `;
    
        return `
          <div class="queue-now-playing-row">
              <div class="queue-item-content">
                  <div class="queue-art large" style="background-image: url('${img}')"></div>
                  
                  <div class="queue-info">
                      <div class="queue-title active">${title}</div>
                      <div class="queue-artist">${artist}</div>
                      ${deviceHtml}
                  </div>
    
                  ${mainPlayBtn}
              </div>
              
              ${bottomRowHtml}
              ${progressBar}
          </div>
        `;
      },

    // 2. The New Helper (Exposed so index.js can use it)
    renderNowPlayingControls: (showVolumeView, currentVolume, isFavorite, components, trackId) => {
        const volPercent = Math.round(currentVolume * 100);
        
        if (showVolumeView) {
            return `
            <div class="volume-control-container">
                <div class="vol-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
                </div>
                <input type="range" class="volume-slider" min="0" max="100" value="${volPercent}" id="mini-vol-slider">
                <button class="mini-btn" data-action="close-volume" title="Close Volume">
                    <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                </button>
            </div>`;
        } 
        else {
            const heartClass = isFavorite ? 'is-favorite' : '';
            const showShuffle = components.shuffle === true; 
            const showPrev = components.previous !== false; 
            const showNext = components.next !== false;        
            const showLike = components.like !== false;        
            const showVol = components.volume !== false; 
            const showDevice = components.device !== false; 

            const shuffleHtml = showShuffle ? `<button class="mini-btn" data-action="mini-shuffle"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg></button>` : '';
            const prevHtml = showPrev ? `<button class="mini-btn" data-action="mini-prev"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg></button>` : '';
            const nextHtml = showNext ? `<button class="mini-btn" data-action="mini-skip"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg></button>` : '';
            const deviceHtml = showDevice ? `<button class="mini-btn" data-action="mini-device"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C7.58 2 4 5.58 4 10V20H20V10C20 5.58 16.42 2 12 2M12 4C15.31 4 18 6.69 18 10V18H6V10C6 6.69 8.69 4 12 4M12 6C13.11 6 14 6.89 14 8C14 9.11 13.11 10 12 10C10.89 10 10 9.11 10 8C10 6.89 10.89 6 12 6M12 12C10.89 12 10 12.89 10 14C10 15.11 10.89 16 12 16C13.11 16 14 15.11 14 14C14 12.89 13.11 12 12 12Z" /></svg></button>` : '';
            const likeHtml = showLike ? `<button class="mini-btn ${heartClass}" data-action="mini-fav" data-id="${trackId}"><svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg></button>` : '';
            const volHtml = showVol ? `<button class="mini-btn" data-action="mini-volume"><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg></button>` : '';

            return `
            <div class="queue-mini-controls">
                ${shuffleHtml} ${prevHtml} ${nextHtml} ${deviceHtml} ${likeHtml} ${volHtml}
            </div>`;
        }
    },

    queueRow: (track) => {
        const artists = track.artists ? track.artists.map(a => a.name).join(', ') : 'Unknown';
        
        let img = track.image_url || '';
        if (!img && track.album && track.album.images && track.album.images.length > 0) {
             img = track.album.images[track.album.images.length - 1].url;
        }
            
        return `
        <div class="queue-item">
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
        <div class="media-image-wrapper">
            <div class="card-image-sk" style="${isCircle ? 'border-radius:50%' : ''}"></div>
        </div>
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
        <div class="recent-grid-layout" id="grid-${sectionId}" data-section="${sectionId}">
            ${Array(8).fill(0).map(() => recentPillSkeleton()).join('')}
        </div>
    </section>
    `;
}

// --- ADDED THIS FUNCTION TO FIX THE ERROR ---
function recentPillSkeleton() {
    return `
      <div class="recent-pill skeleton-pulse">
        <div class="recent-pill-img"></div>
        <div class="recent-pill-text" style="width: 60%; height: 12px; background: #333; border-radius: 4px;"></div>
      </div>
    `;
}
