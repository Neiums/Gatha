/* script.js - With IndexedDB Persistence */

const $ = (s) => document.querySelector(s);
const ui = {
    audio: $('#audio'), folderInput: $('#folder-input'), playlist: $('#playlist'),
    count: $('#playlist-count'), playBtn: $('#play-btn'), prevBtn: $('#prev-btn'),
    nextBtn: $('#next-btn'), shuffleBtn: $('#shuffle-btn'), repeatBtn: $('#repeat-btn'),
    volSlider: $('#volume-slider'), volIcon: $('#volume-icon'), progressBar: $('#progress-bar'),
    progress: $('#progress'), currTime: $('.current-time'), totTime: $('.total-duration'),
    title: $('.track-title'), artist: $('.track-artist'), addBtn: $('#add-folder-btn'),
    cover: $('#cover-art'), artBox: $('.album-art')
};

const state = {
    tracks: [], idx: 0, playing: false, shuffle: false, repeat: 0, 
    shuffledIdx: [], blobUrl: null
};

// IndexedDB Helper 
const db = {
    req: null,
    open: () => new Promise((resolve, reject) => {
        const req = indexedDB.open('HarmonyDB', 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('tracks')) {
                db.createObjectStore('tracks', { keyPath: 'id' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject('DB Error');
    }),
    add: async (track) => {
        const dbRef = await db.open();
        // We save the file directly.
        dbRef.transaction('tracks', 'readwrite').objectStore('tracks').put(track);
    },
    getAll: async () => {
        const dbRef = await db.open();
        return new Promise(resolve => {
            const req = dbRef.transaction('tracks', 'readonly').objectStore('tracks').getAll();
            req.onsuccess = () => resolve(req.result);
        });
    },
    remove: async (id) => {
        const dbRef = await db.open();
        dbRef.transaction('tracks', 'readwrite').objectStore('tracks').delete(id);
    }
};

// --- Initialization ---
const init = async () => {
    setupEvents();
    // Retrieving files from the database on page load
    try {
        const savedTracks = await db.getAll();
        if (savedTracks && savedTracks.length > 0) {
            state.tracks = savedTracks;
            // Retrieve the latest index
            const lastIdx = localStorage.getItem('lastIdx');
            if (lastIdx) state.idx = parseInt(lastIdx);
            renderPlaylist();
            // Load current track info (without playing)
            if(state.tracks[state.idx]) loadTrackInfo(state.tracks[state.idx]);
        }
    } catch (e) { console.error('Error loading DB:', e); }
};

// --- Core Logic ---
const loadTracks = async (files) => {
    const audioFiles = Array.from(files).filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a)$/i.test(f.name));
    if (!audioFiles.length) return alert('No audio files found.');

    ui.playlist.innerHTML = '<div class="empty-playlist"><i class="fas fa-spinner fa-spin"></i><h3>Saving to database...</h3></div>';

    for (const file of audioFiles) {
        // Check for duplicates
        if (state.tracks.some(t => t.name === file.name.replace(/\.[^/.]+$/, ""))) continue;

        const track = {
            id: Date.now() + Math.random(),
            name: file.name.replace(/\.[^/.]+$/, ""),
            artist: 'Unknown Artist',
            file: file, // The actual file is stored in the database
            duration: 0,
            cover: null
        };

        // Extract cover (optional)
        if (window.jsmediatags) {
            await new Promise(resolve => {
                window.jsmediatags.read(file, {
                    onSuccess: (tag) => {
                        track.artist = tag.tags.artist || track.artist;
                        track.name = tag.tags.title || track.name;
                        if (tag.tags.picture) {
                            const { data, format } = tag.tags.picture;
                            let base64 = "";
                            data.forEach(b => base64 += String.fromCharCode(b));
                            track.cover = `data:${format};base64,${btoa(base64)}`;
                        }
                        resolve();
                    },
                    onError: () => resolve() // Continue even if there's an error
                });
            });
        }
        
        state.tracks.push(track);
        // Save to database
        await db.add(track);
    }
    renderPlaylist();
};

const playTrack = (index) => {
    if (!state.tracks[index]) return;
    if (state.blobUrl) URL.revokeObjectURL(state.blobUrl);

    state.idx = index;
    const t = state.tracks[index];
    localStorage.setItem('lastIdx', index); // Save position in localStorage

    if (t.file) {
        state.blobUrl = URL.createObjectURL(t.file);
        ui.audio.src = state.blobUrl;
        
        loadTrackInfo(t);
        ui.audio.play().then(() => setPlayState(true)).catch(() => setPlayState(false));
        
        renderPlaylist();
        scrollToActive();
    } else {
        alert("The file is corrupted. Please add it again.");
    }
};

const loadTrackInfo = (t) => {
    ui.title.innerText = t.name;
    ui.artist.innerText = t.artist;
    updateCover(t);
};

// --- Controls & UI ---
const control = {
    toggle: () => {
        if (!state.tracks.length) return ui.addBtn.click();
        state.playing ? ui.audio.pause() : (ui.audio.src ? ui.audio.play() : playTrack(state.idx));
    },
    prev: () => changeTrack(-1),
    next: () => changeTrack(1),
    shuffle: () => {
        state.shuffle = !state.shuffle;
        ui.shuffleBtn.classList.toggle('active', state.shuffle);
        if (state.shuffle) state.shuffledIdx = state.tracks.map((_, i) => i).sort(() => Math.random() - .5);
    },
    repeat: () => {
        state.repeat = (state.repeat + 1) % 3;
        ui.repeatBtn.className = 'control-btn ' + (state.repeat > 0 ? 'active' : '');
        ui.repeatBtn.querySelector('i').className = `fas fa-redo ${state.repeat === 2 ? 'fa-rotate-180' : ''}`;
    }
};

const changeTrack = (dir) => {
    if (!state.tracks.length) return;
    if (dir === -1 && ui.audio.currentTime > 3) return ui.audio.currentTime = 0;

    let nextIdx;
    if (state.shuffle) {
        if (!state.shuffledIdx.length) control.shuffle(); // Ensure shuffle list exists
        let currentPos = state.shuffledIdx.indexOf(state.idx);
        // If current track isn't in shuffle list (e.g. added later), start from 0
        if (currentPos === -1) currentPos = 0;
        
        let target = currentPos + dir;
        if (target >= state.tracks.length) target = 0;
        if (target < 0) target = state.tracks.length - 1;
        nextIdx = state.shuffledIdx[target];
    } else {
        nextIdx = state.idx + dir;
        if (nextIdx >= state.tracks.length) nextIdx = 0;
        if (nextIdx < 0) nextIdx = state.tracks.length - 1;
    }
    playTrack(nextIdx);
};

const renderPlaylist = () => {
    ui.count.innerText = state.tracks.length;
    if (!state.tracks.length) {
        ui.playlist.innerHTML = `<div class="empty-playlist"><i class="fas fa-music"></i><h3>The playlist is empty</h3></div>`;
        return;
    }
    ui.playlist.innerHTML = state.tracks.map((t, i) => `
        <div class="playlist-item ${i === state.idx ? 'active' : ''}" data-i="${i}">
            <div class="track-number">${i + 1}</div>
            <div class="track-details">
                <div class="playlist-title">${t.name}</div>
                <div class="playlist-artist">${t.artist}</div>
            </div>
            <button class="delete-btn" data-del="${i}"><i class="fas fa-trash"></i></button>
        </div>
    `).join('');
};

const updateCover = (t) => {
    ui.cover.src = t.cover || ''; 
    ui.artBox.classList.toggle('show-image', !!t.cover);
};

const setPlayState = (p) => {
    state.playing = p;
    ui.playBtn.innerHTML = `<i class="fas fa-${p ? 'pause' : 'play'}"></i>`;
    ui.artBox.classList.toggle('pulse', p);
};

const formatTime = s => isNaN(s) ? '0:00' : `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
const scrollToActive = () => $('.playlist-item.active')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

// --- Events ---
const setupEvents = () => {
    ui.addBtn.onclick = () => ui.folderInput.click();
    ui.folderInput.onchange = (e) => loadTracks(e.target.files);
    
    ui.playBtn.onclick = control.toggle;
    ui.prevBtn.onclick = control.prev;
    ui.nextBtn.onclick = control.next;
    ui.shuffleBtn.onclick = control.shuffle;
    ui.repeatBtn.onclick = control.repeat;

    ui.audio.ontimeupdate = () => {
        ui.progress.style.width = `${(ui.audio.currentTime / ui.audio.duration) * 100}%`;
        ui.currTime.innerText = formatTime(ui.audio.currentTime);
        ui.totTime.innerText = formatTime(ui.audio.duration);
    };
    ui.audio.onended = () => state.repeat === 2 ? ui.audio.play() : control.next();
    ui.audio.onplay = () => setPlayState(true);
    ui.audio.onpause = () => setPlayState(false);

    ui.progressBar.onclick = e => ui.audio.currentTime = (e.offsetX / ui.progressBar.clientWidth) * ui.audio.duration;
    
    ui.volSlider.oninput = e => {
        ui.audio.volume = e.target.value / 100;
        ui.volIcon.className = `fas fa-volume-${ui.audio.volume===0?'mute':(ui.audio.volume<.5?'down':'up')} volume-icon`;
    };
    ui.volIcon.onclick = () => { ui.volSlider.value = ui.audio.volume > 0 ? 0 : 80; ui.volSlider.dispatchEvent(new Event('input')); };

    ui.playlist.onclick = async (e) => {
        const delBtn = e.target.closest('.delete-btn');
        const item = e.target.closest('.playlist-item');
        if (delBtn) {
            e.stopPropagation();
            const idx = +delBtn.dataset.del;
            const trackId = state.tracks[idx].id;
            
            // حذف از دیتابیس و آرایه
            await db.remove(trackId);
            state.tracks.splice(idx, 1);
            
            if (idx === state.idx) { ui.audio.pause(); ui.audio.src=''; setPlayState(false); }
            else if (idx < state.idx) state.idx--;
            
            localStorage.setItem('lastIdx', state.idx);
            renderPlaylist();
        } else if (item) {
            playTrack(+item.dataset.i);
        }
    };

    document.onkeydown = e => {
        if(e.code==='Space') {e.preventDefault(); control.toggle();}
        if(e.code==='ArrowLeft') control.prev();
        if(e.code==='ArrowRight') control.next();
    };
};

init();