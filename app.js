// Use an IIFE for scope management and initialization
(function () {
    // Import VexFlow objects from the global scope
    // FIX: Added Renderer to imports so we can access Backends.SVG
    const { Factory, EasyScore, System, Renderer } = Vex.Flow;

    // --- DOM Elements ---
    const appContainer = document.getElementById('app-container');
    const midiStatusEl = document.getElementById('midi-status');
    const streakCountEl = document.getElementById('streak-count');
    const lastNoteInfoEl = document.getElementById('last-note-info');
    const instructionText = document.getElementById('instruction-text');
    const noteOutputDiv = document.getElementById('note-canvas'); 
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const showNoteNameCheckbox = document.getElementById('show-note-name');
    const settingsBtn = document.getElementById('settings-btn');
    const settingsModal = document.getElementById('settings-modal');
    const closeSettingsBtn = document.getElementById('close-settings');
    const notesGrid = document.getElementById('notes-grid');
    const selectAllBtn = document.getElementById('select-all-btn');
    const clearAllBtn = document.getElementById('clear-all-btn');
    const scaleSelect = document.getElementById('scale-select');
    const modeSelect = document.getElementById('mode-select');
    const randomSettingsPanel = document.getElementById('random-settings-panel');
    
    // Set explicit dimensions for the SVG
    const height = 150;

    // --- Audio Context Setup ---
    let audioCtx = null;

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    window.addEventListener('click', initAudio, { once: true });
    window.addEventListener('keydown', initAudio, { once: true });

    function playNoteSound(midiNote) {
        if (!audioCtx) initAudio();
        if (!audioCtx) return;

        const osc = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        osc.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
        
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

        const now = audioCtx.currentTime;
        const duration = 0.3;

        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.2, now + 0.05);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.start(now);
        osc.stop(now + duration);
    }

    // --- SONG LIBRARY & PARSING ---

    const songLibrary = [
        {
            title: "Twinkle Twinkle Little Star",
            notes: "C4/q, C4, G4, G4, A4, A4, G4/h, F4/q, F4, E4, E4, D4, D4, C4/h",
            timeSignature: "4/4"
        },
        {
            title: "Mary Had a Little Lamb",
            notes: "E4/q, D4, C4, D4, E4, E4, E4/h, D4/q, D4, D4/h, E4/q, G4, G4/h",
            timeSignature: "4/4"
        },
        {
            title: "Ode to Joy",
            notes: "E4/q, E4, F4, G4, G4, F4, E4, D4, C4, C4, D4, E4, E4/q., D4/8, D4/h",
            timeSignature: "4/4"
        },
        {
            title: "Frere Jacques",
            notes: "C4/q, D4, E4, C4, C4, D4, E4, C4, E4, F4, G4/h, E4/q, F4, G4/h",
            timeSignature: "4/4"
        },
        {
            title: "Hot Cross Buns",
            notes: "E4/q, D4, C4/h, E4/q, D4, C4/h, C4/8, C4, C4, C4, D4, D4, D4, D4, E4/q, D4, C4/h",
            timeSignature: "4/4"
        }
    ];

    // Helper to parse note name (e.g. "C#4") to MIDI number
    function parseNoteToMidi(noteName) {
        const noteRegex = /^([A-G])([#b]?)([0-9])$/;
        const match = noteName.match(noteRegex);
        if (!match) return 60; // fallback

        const noteChar = match[1];
        const accidental = match[2];
        const octave = parseInt(match[3]);

        const baseMap = { 'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11 };
        let midi = baseMap[noteChar] + (octave + 1) * 12;

        if (accidental === '#') midi += 1;
        if (accidental === 'b') midi -= 1;

        return midi;
    }

    // Convert EasyScore string into array of MIDI numbers
    function parseSongToMidiSequence(notesString) {
        // Split by comma or space, remove empty entries
        const tokens = notesString.split(/[\s,]+/).filter(t => t);
        return tokens.map(token => {
            // Remove duration info (e.g., "/q", "/h", "/8")
            const cleanName = token.split('/')[0];
            return parseNoteToMidi(cleanName);
        });
    }

    // --- Game State & Settings ---
    let currentMode = 'random'; // 'random' or 'song'
    let currentSongIndex = -1; // Index in songLibrary
    let songQueue = []; // Array of MIDI numbers for current song
    let songProgressIndex = 0; // Current position in songQueue

    let currentStreak = 0;
    let penaltyHits = 0;
    const SCALE_CUSTOM_VALUE = 'custom';
    const DEFAULT_SCALE_PRESET = 'c-major-pent';
    let currentScalePreset = DEFAULT_SCALE_PRESET;
    
    // --- Melodic Phrase Engine State ---
    let phraseQueue = [];
    let lastMelodicNote = null;
    let chordPool = [];
    let currentChordIndex = 0;
    
    // Define the pool of all possible notes for Random Mode
    const chromaticNoteNames = [
        'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4',
        'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4', 'C5'
    ];
    const availableNotesPool = chromaticNoteNames.map(label => ({
        midi: parseNoteToMidi(label),
        label
    }));

    const scalePresets = [
        {
            id: 'c-major',
            name: 'C Major (Ionian)',
            notes: ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5']
        },
        {
            id: 'c-natural-minor',
            name: 'C Natural Minor',
            notes: ['C4', 'D4', 'D#4', 'F4', 'G4', 'G#4', 'A#4', 'C5']
        },
        {
            id: 'c-major-pent',
            name: 'C Major Pentatonic',
            notes: ['C4', 'D4', 'E4', 'G4', 'A4', 'C5']
        },
        {
            id: 'c-blues',
            name: 'C Blues',
            notes: ['C4', 'D#4', 'F4', 'F#4', 'G4', 'A#4', 'C5']
        }
    ];

    function getPresetMidiNotes(presetId) {
        const preset = scalePresets.find(p => p.id === presetId);
        if (!preset) return null;
        const midiNotes = preset.notes
            .map(parseNoteToMidi)
            .filter(note => availableNotesPool.some(n => n.midi === note));
        return midiNotes.length ? Array.from(new Set(midiNotes)).sort((a, b) => a - b) : null;
    }

    // Currently active notes (defaults to preset or full pool)
    let activeNotes = (() => {
        const defaultNotes = getPresetMidiNotes(DEFAULT_SCALE_PRESET);
        return defaultNotes ?? availableNotesPool.map(n => n.midi);
    })();
    let targetNote = 60; // Default start
    const NOTE_BATCH_SIZE = 8;
    let displayQueue = [];
    let batchCursor = 0;

    // --- Helper UI Functions ---
    function updateInstructionText() {
        if (penaltyHits > 0) {
            instructionText.textContent = `Drill: Play ${penaltyHits} more time${penaltyHits === 1 ? '' : 's'}!`;
            instructionText.classList.add('text-[#ff5874]');
            instructionText.classList.remove('text-gray-300');
            instructionText.classList.remove('text-[#58a6ff]');
        } else if (currentMode === 'song') {
            instructionText.textContent = `Song: ${songLibrary[currentSongIndex].title}`;
            instructionText.classList.remove('text-[#ff5874]');
            instructionText.classList.add('text-[#58a6ff]'); // Blue for song mode
            instructionText.classList.remove('text-gray-300');
        } else {
            instructionText.textContent = "Next Note:";
            instructionText.classList.remove('text-[#ff5874]');
            instructionText.classList.remove('text-[#58a6ff]');
            instructionText.classList.add('text-gray-300');
        }
    }

    // --- Note Batch Helpers ---

    function setTargetFromBatch() {
        if (!displayQueue.length) {
            targetNote = null;
            return;
        }
        const safeIndex = Math.min(batchCursor, displayQueue.length - 1);
        targetNote = displayQueue[safeIndex];
    }

    function generateRandomSequence(count, seed = null) {
        const sequence = [];
        let previous = seed;
        for (let i = 0; i < count; i++) {
            const next = getNextRandomNote(previous);
            sequence.push(next);
            previous = next;
        }
        return sequence;
    }

    function initializeRandomBatch({ resetEngine = true, seed = null } = {}) {
        if (resetEngine) {
            resetMelodicEngine();
            seed = null;
        } else if (seed == null && displayQueue.length) {
            seed = displayQueue[displayQueue.length - 1];
        }
        displayQueue = generateRandomSequence(NOTE_BATCH_SIZE, seed);
        batchCursor = 0;
        setTargetFromBatch();
    }

    function buildSongBatch(startIndex) {
        const batch = [];
        if (!songQueue.length) return batch;
        for (let i = 0; i < NOTE_BATCH_SIZE; i++) {
            const idx = (startIndex + i) % songQueue.length;
            batch.push(songQueue[idx]);
        }
        return batch;
    }

    function initializeSongBatch() {
        if (!songQueue.length) {
            displayQueue = [];
            batchCursor = 0;
            targetNote = null;
            return;
        }
        displayQueue = buildSongBatch(songProgressIndex);
        batchCursor = 0;
        setTargetFromBatch();
    }

    function advanceSongProgress() {
        if (!songQueue.length) return;
        songProgressIndex++;
        if (songProgressIndex >= songQueue.length) {
            appContainer.classList.add('feedback-complete');
            setTimeout(() => appContainer.classList.remove('feedback-complete'), 500);
            songProgressIndex = 0; // Loop song
        }
    }

    function advanceBatchCursor() {
        if (!displayQueue.length) {
            if (currentMode === 'random') {
                initializeRandomBatch({ resetEngine: false });
            } else {
                initializeSongBatch();
            }
            return;
        }
        batchCursor++;
        if (batchCursor >= displayQueue.length) {
            if (currentMode === 'random') {
                const seed = displayQueue.length ? displayQueue[displayQueue.length - 1] : null;
                initializeRandomBatch({ resetEngine: false, seed });
            } else {
                initializeSongBatch();
            }
        } else {
            setTargetFromBatch();
        }
    }

    // --- Settings Logic ---

    function toggleSettings() {
        if (settingsModal.classList.contains('hidden')) {
            settingsModal.classList.remove('hidden');
            settingsModal.classList.add('flex', 'modal-enter');
            setTimeout(() => settingsModal.classList.remove('modal-enter', 'modal-enter-active'), 200);
        } else {
            settingsModal.classList.add('hidden');
            settingsModal.classList.remove('flex');
        }
    }

    // Populate Song Select Dropdown
    function initSettingsUI() {
        songLibrary.forEach((song, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = song.title;
            modeSelect.appendChild(option);
        });
        populateScaleSelect();

        modeSelect.addEventListener('change', (e) => {
            const val = e.target.value;
            if (val === 'random') {
                currentMode = 'random';
                randomSettingsPanel.classList.remove('hidden');
                initializeRandomBatch();
                penaltyHits = 0;
                currentStreak = 0;
                updateStreakUI(true);
                updateInstructionText();
                updateTargetNoteUI();
            } else {
                currentMode = 'song';
                currentSongIndex = parseInt(val);
                randomSettingsPanel.classList.add('hidden');
                
                // Load Song
                const songData = songLibrary[currentSongIndex];
                songQueue = parseSongToMidiSequence(songData.notes);
                songProgressIndex = 0;
                initializeSongBatch();
                
                penaltyHits = 0;
                currentStreak = 0;
                updateStreakUI(true); // reset visuals
                updateInstructionText();
                updateTargetNoteUI();
            }
        });
    }

    function renderSettingsGrid() {
        notesGrid.innerHTML = '';
        availableNotesPool.forEach(note => {
            const isChecked = activeNotes.includes(note.midi);
            
            const label = document.createElement('label');
            label.className = "flex items-center space-x-3 cursor-pointer p-2 rounded hover:bg-white/5";
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = "accent-[#58a6ff] h-4 w-4 bg-gray-700 border-gray-600 rounded focus:ring-0 focus:ring-offset-0 cursor-pointer";
            checkbox.checked = isChecked;
            checkbox.value = note.midi;
            
            checkbox.addEventListener('change', (e) => {
                const midiVal = parseInt(e.target.value);
                if (e.target.checked) {
                    if (!activeNotes.includes(midiVal)) {
                        activeNotes.push(midiVal);
                        activeNotes.sort((a, b) => a - b);
                    }
                } else {
                    if (activeNotes.length <= 1) {
                        e.target.checked = true;
                        alert("You must have at least one note active!");
                        return;
                    }
                    activeNotes = activeNotes.filter(n => n !== midiVal);
                }
                
                resetToCustomScale();
                syncTargetAfterPoolChange();
            });

            const span = document.createElement('span');
            span.className = "text-sm text-gray-300";
            span.textContent = note.label;

            label.appendChild(checkbox);
            label.appendChild(span);
            notesGrid.appendChild(label);
        });
    }

    function populateScaleSelect() {
        if (!scaleSelect) return;
        while (scaleSelect.options.length > 1) {
            scaleSelect.remove(1);
        }
        scalePresets.forEach(preset => {
            const option = document.createElement('option');
            option.value = preset.id;
            option.textContent = preset.name;
            scaleSelect.appendChild(option);
        });
        scaleSelect.value = currentScalePreset;
    }

    function resetToCustomScale() {
        currentScalePreset = SCALE_CUSTOM_VALUE;
        if (scaleSelect) {
            scaleSelect.value = SCALE_CUSTOM_VALUE;
        }
    }

    function syncTargetAfterPoolChange() {
        resetMelodicEngine();
        if (currentMode === 'random') {
            penaltyHits = 0;
            updateInstructionText();
            initializeRandomBatch({ resetEngine: true });
            updateTargetNoteUI();
        }
    }

    function applyScalePreset(presetId) {
        const midiNotes = getPresetMidiNotes(presetId);
        if (!midiNotes) return;
        currentScalePreset = presetId;
        if (scaleSelect) {
            scaleSelect.value = presetId;
        }
        activeNotes = midiNotes;
        renderSettingsGrid();
        resetMelodicEngine();
        syncTargetAfterPoolChange();
    }

    settingsBtn.addEventListener('click', toggleSettings);
    closeSettingsBtn.addEventListener('click', toggleSettings);

    if (scaleSelect) {
        scaleSelect.addEventListener('change', (e) => {
            const value = e.target.value;
            if (value === SCALE_CUSTOM_VALUE) {
                resetToCustomScale();
                return;
            }
            applyScalePreset(value);
        });
    }

    selectAllBtn.addEventListener('click', () => {
        activeNotes = availableNotesPool.map(n => n.midi);
        renderSettingsGrid();
        resetToCustomScale();
        syncTargetAfterPoolChange();
    });

    clearAllBtn.addEventListener('click', () => {
        activeNotes = [60];
        renderSettingsGrid();
        resetToCustomScale();
        syncTargetAfterPoolChange();
    });

    // --- MELODIC RANDOM ENGINE ---

    const chordProgressionsByScale = {
        'c-major': [
            ['C4', 'E4', 'G4'],
            ['G4', 'B4', 'D4'],
            ['A4', 'C5', 'E4'],
            ['F4', 'A4', 'C5']
        ],
        'c-natural-minor': [
            ['C4', 'D#4', 'G4'],
            ['G4', 'A#4', 'D4'],
            ['D#4', 'G4', 'A#4'],
            ['F4', 'G#4', 'C5']
        ],
        'c-major-pent': [
            ['C4', 'E4', 'G4'],
            ['D4', 'G4', 'A4'],
            ['E4', 'A4', 'C5']
        ],
        'c-blues': [
            ['C4', 'F4', 'G4'],
            ['D#4', 'G4', 'A#4'],
            ['F4', 'G#4', 'C5']
        ]
    };

    function rebuildChordPool() {
        const rawChords = chordProgressionsByScale[currentScalePreset] || [];
        if (!rawChords.length) {
            const sortedFallback = [...activeNotes].sort((a, b) => a - b);
            const fallbackChords = [];
            for (let i = 0; i + 2 < sortedFallback.length; i++) {
                fallbackChords.push([sortedFallback[i], sortedFallback[i + 1], sortedFallback[i + 2]]);
            }
            chordPool = fallbackChords;
            currentChordIndex = 0;
            return;
        }

        chordPool = rawChords
            .map(chordNames =>
                chordNames
                    .map(parseNoteToMidi)
                    .filter(midi => activeNotes.includes(midi))
            )
            .filter(chord => chord.length >= 2);

        if (!chordPool.length) {
            const sortedFallback = [...activeNotes].sort((a, b) => a - b);
            const fallbackChords = [];
            for (let i = 0; i + 2 < sortedFallback.length; i++) {
                fallbackChords.push([sortedFallback[i], sortedFallback[i + 1], sortedFallback[i + 2]]);
            }
            chordPool = fallbackChords;
        }
        currentChordIndex = 0;
    }

    function choice(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function generateMotif(chord, length = 4) {
        const motif = [];
        const sortedActive = [...activeNotes].sort((a, b) => a - b);
        let prev = lastMelodicNote;
        if (prev == null) {
            prev = choice(chord);
        }

        for (let i = 0; i < length; i++) {
            const usePassing = Math.random() < 0.25;
            let candidates = usePassing
                ? sortedActive.filter(n => Math.abs(n - prev) <= 2)
                : chord;
            if (!candidates.length) {
                candidates = chord;
            }
            let filtered = candidates.filter(n => Math.abs(n - prev) <= 5);
            if (!filtered.length) filtered = candidates;
            const nonRepeat = filtered.filter(n => n !== prev);
            const nextNote = choice(nonRepeat.length ? nonRepeat : filtered);
            motif.push(nextNote);
            prev = nextNote;
        }

        lastMelodicNote = prev;
        return motif;
    }

    function generateMelodicPhrase() {
        if (!activeNotes.length) return;
        if (!chordPool.length) {
            rebuildChordPool();
        }
        if (!chordPool.length) return;

        const phrase = [];
        const tonic = [...activeNotes].sort((a, b) => a - b)[0];
        lastMelodicNote = tonic;

        const chordBlocks = 4;
        for (let i = 0; i < chordBlocks; i++) {
            const chord = chordPool[currentChordIndex];
            const motif = generateMotif(chord, 4);
            phrase.push(...motif);
            currentChordIndex = (currentChordIndex + 1) % chordPool.length;
        }

        phrase[0] = tonic;
        phrase[phrase.length - 1] = tonic;
        phraseQueue = phrase;
    }

    function resetMelodicEngine() {
        phraseQueue = [];
        lastMelodicNote = null;
        chordPool = [];
        currentChordIndex = 0;
    }

    // --- Game Logic ---

    function getNextRandomNote(currentNote) {
        if (activeNotes.length === 0) return 60;
        if (activeNotes.length === 1) return activeNotes[0];

        const noteToValidate = currentNote;
        if (noteToValidate != null && !activeNotes.includes(noteToValidate)) {
            resetMelodicEngine();
        }

        if (!phraseQueue.length) {
            generateMelodicPhrase();
        }

        if (!phraseQueue.length) {
            let fallback;
            do {
                const randomIndex = Math.floor(Math.random() * activeNotes.length);
                fallback = activeNotes[randomIndex];
            } while (fallback === currentNote && activeNotes.length > 1);
            lastMelodicNote = fallback;
            return fallback;
        }

        const next = phraseQueue.shift();
        lastMelodicNote = next;
        return next;
    }

    // --- VexFlow Utilities ---
    
    const easyScoreNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    function getEasyScoreNote(noteNumber) {
        const octave = Math.floor(noteNumber / 12) - 1;
        const note = easyScoreNames[noteNumber % 12];
        return `${note}${octave}`;
    }
    
    function renderNotesOnStaff(noteNumbers, options = {}) {
        const { highlightMode = 'highlight', highlightIndex = 0 } = options;
        try {
            if (!noteNumbers.length) return;
            noteOutputDiv.innerHTML = '';
            
            const width = canvasWrapper.clientWidth;
            
            const vf = new Factory({
                renderer: {
                    elementId: 'note-canvas', 
                    width: width, 
                    height: height,
                    backend: Renderer.Backends.SVG
                }
            });
            
            const score = vf.EasyScore();
            vf.System(); // ensure fonts initialized
            const context = vf.getContext();
            const foreColor = "#e6edf3"; 
            context.setFillStyle(foreColor);
            context.setStrokeStyle(foreColor);

            const highlightColor = highlightMode === 'penalty' ? '#ff5874'
                : highlightMode === 'highlight' ? '#00ff9c'
                : '#e6edf3';

            const staveNotes = noteNumbers.map((noteNumber, index) => {
                const noteName = getEasyScoreNote(noteNumber);
                const [staveNote] = score.notes(`${noteName}/8`);
                const isTarget = highlightMode !== 'default' && index === highlightIndex;
                const styleColor = isTarget ? highlightColor : foreColor;
                staveNote.setStyle({ fillStyle: styleColor, strokeStyle: styleColor });
                return staveNote;
            });

            const voice = score.voice(staveNotes, {time: '4/4'});
            voice.setStrict(false);

            const stave = vf.Stave({x: 0, y: 10, width: width}); 
            stave.addClef('treble');
            stave.setContext(context).draw();

            vf.Formatter().joinVoices([voice]).formatToStave([voice], stave);
            voice.draw(context, stave);
            
            if (showNoteNameCheckbox.checked && highlightMode !== 'default' && noteNumbers.length) {
                context.setFont("Inter", 11, "bold");
                const tickables = voice.getTickables();
                const safeIndex = Math.min(highlightIndex, Math.min(noteNumbers.length - 1, tickables.length - 1));
                if (safeIndex >= 0) {
                    const targetTickable = tickables[safeIndex];
                    const label = getNoteName(noteNumbers[safeIndex]);
                    const x = (targetTickable?.getAbsoluteX?.() || width / 2) - 10;
                    const y = 140;
                    context.setFillStyle(highlightColor);
                    context.fillText(label, x, y);
                }
            }
        } catch (error) {
            console.error("[VexFlow] Error rendering notes on staff:", error);
        }
    }

    function getHighlightMode() {
        return penaltyHits > 0 ? 'penalty' : 'highlight';
    }

    function renderBatch(highlightMode = getHighlightMode()) {
        const notesToRender = displayQueue.length ? displayQueue : (targetNote != null ? [targetNote] : []);
        if (!notesToRender.length) return;
        const highlightIndex = Math.min(batchCursor, notesToRender.length - 1);
        renderNotesOnStaff(notesToRender, { highlightMode, highlightIndex });
    }

    function updateTargetNoteUI() {
        renderBatch(getHighlightMode());
    }

    function updateStreakUI(isCorrect) {
        streakCountEl.textContent = currentStreak;
        appContainer.classList.remove('feedback-correct', 'feedback-incorrect');
        void appContainer.offsetWidth;
        if (!isCorrect) {
            appContainer.classList.add('feedback-incorrect');
        }
        canvasWrapper.classList.remove('border-green-500', 'border-red-500', 'border-transparent');
        canvasWrapper.classList.add(isCorrect ? 'border-green-500' : 'border-red-500');
    }
    
    showNoteNameCheckbox.addEventListener('change', () => {
        renderBatch(getHighlightMode());
    });

    function handleIncomingNote(noteNumber, velocity) {
        if (velocity === 0) return;
        playNoteSound(noteNumber);

        const noteNameText = `${getNoteName(noteNumber)} (${noteNumber})`;
        lastNoteInfoEl.textContent = `Last Note: ${noteNameText}`;

        if (noteNumber === targetNote) {
            // CORRECT HIT
            currentStreak++;
            updateStreakUI(true);

            const moveForward = () => {
                if (currentMode === 'song') {
                    advanceSongProgress();
                }
                advanceBatchCursor();
                setTimeout(() => renderBatch('highlight'), 100);
            };

            if (penaltyHits > 0) {
                penaltyHits--;
                if (penaltyHits === 0) {
                    updateInstructionText();
                    moveForward();
                } else {
                    updateInstructionText();
                    renderBatch('penalty');
                }
            } else {
                moveForward();
            }

        } else {
            // INCORRECT HIT
            if (currentStreak > 0) {
                currentStreak = 0;
                updateStreakUI(false);
            }
            
            // Activate Penalty Mode (for both modes)
            penaltyHits = 3;
            updateInstructionText();
            
            renderBatch('penalty'); 
        }
    }
    
    const basicNoteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    function getNoteName(noteNumber) {
        const octave = Math.floor(noteNumber / 12) - 1;
        const note = basicNoteNames[noteNumber % 12];
        return `${note}${octave}`;
    }

    // --- MIDI Setup ---

    function onMIDIMessage(event) {
        const [status, data1, data2] = event.data;
        if (status === 254 || status === 248) return;

        if (status >= 144 && status <= 159) {
            const noteNumber = data1;
            const velocity = data2;
            handleIncomingNote(noteNumber, velocity);
        }
    }

    function onMIDISuccess(midiAccess) {
        midiStatusEl.classList.remove('text-yellow-400', 'bg-gray-700/50', 'border-gray-600');
        midiStatusEl.classList.add('text-green-400', 'bg-green-700/20', 'border-green-600');

        const inputs = midiAccess.inputs.values();
        let portFound = false;
        midiStatusEl.innerHTML = "";
        
        for (let input of inputs) {
            const deviceBadge = document.createElement('div');
            deviceBadge.className = "mb-1";
            deviceBadge.innerHTML = `Connected: <span class="font-bold">${input.name}</span>`;
            midiStatusEl.appendChild(deviceBadge);
            input.onmidimessage = onMIDIMessage;
            portFound = true;
        }

        if (!portFound) {
            midiStatusEl.innerHTML = `<span class="font-bold">No MIDI device found.</span> Please connect your keyboard and refresh.`;
            midiStatusEl.classList.remove('text-green-400', 'bg-green-700/20', 'border-green-600');
            midiStatusEl.classList.add('text-red-400', 'bg-red-700/20', 'border-red-600');
        }
    }

    function onMIDIFailure(e) {
        midiStatusEl.innerHTML = `MIDI Connection Failed: <span class="font-bold">${e.message || "Access denied"}</span>`;
        midiStatusEl.classList.remove('text-yellow-400', 'bg-gray-700/50', 'border-gray-600');
        midiStatusEl.classList.add('text-red-400', 'bg-red-700/20', 'border-red-600');
    }

    // Main initialization function
    function init() {
        initSettingsUI(); // NEW
        renderSettingsGrid();
        
        initializeRandomBatch();
        
        updateTargetNoteUI();
        updateStreakUI(true);

        if (navigator.requestMIDIAccess) {
            navigator.requestMIDIAccess()
                .then(onMIDISuccess)
                .catch(onMIDIFailure);
        } else {
            onMIDIFailure({ message: "Your browser does not support the Web MIDI API." });
        }
    }

    window.onload = init;

})();

