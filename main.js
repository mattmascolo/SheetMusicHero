import {
  createGameState,
  GameModes,
  getEasyScoreNote,
  getNoteName,
  parseSongToMidiSequence,
  DEFAULT_AVAILABLE_NOTES
} from './src/gameLogic.js';

(() => {
  const { Factory, Renderer } = Vex.Flow || {};
  if (!Factory || !Renderer) {
    throw new Error('VexFlow failed to load. Ensure the CDN script is available.');
  }

  const SONG_LIBRARY = [
    {
      title: 'Twinkle Twinkle Little Star',
      notes: 'C4/q, C4, G4, G4, A4, A4, G4/h, F4/q, F4, E4, E4, D4, D4, C4/h',
      timeSignature: '4/4'
    },
    {
      title: 'Mary Had a Little Lamb',
      notes: 'E4/q, D4, C4, D4, E4, E4, E4/h, D4/q, D4, D4/h, E4/q, G4, G4/h',
      timeSignature: '4/4'
    },
    {
      title: 'Ode to Joy',
      notes: 'E4/q, E4, F4, G4, G4, F4, E4, D4, C4, C4, D4, E4, E4/q., D4/8, D4/h',
      timeSignature: '4/4'
    },
    {
      title: 'Frere Jacques',
      notes: 'C4/q, D4, E4, C4, C4, D4, E4, C4, E4, F4, G4/h, E4/q, F4, G4/h',
      timeSignature: '4/4'
    },
    {
      title: 'Hot Cross Buns',
      notes: 'E4/q, D4, C4/h, E4/q, D4, C4/h, C4/8, C4, C4, C4, D4, D4, D4, D4, E4/q, D4, C4/h',
      timeSignature: '4/4'
    }
  ];

  const AVAILABLE_NOTES_POOL = [
    { midi: 60, label: 'C4' },
    { midi: 62, label: 'D4' },
    { midi: 64, label: 'E4' },
    { midi: 65, label: 'F4' },
    { midi: 67, label: 'G4' },
    { midi: 69, label: 'A4' },
    { midi: 71, label: 'B4' },
    { midi: 72, label: 'C5' }
  ];

  const STORAGE_KEYS = {
    ACTIVE_NOTES: 'noteTrainer.activeNotes',
    MODE: 'noteTrainer.mode',
    SONG_INDEX: 'noteTrainer.songIndex',
    SHOW_NOTE_NAME: 'noteTrainer.showNoteName'
  };

  const settingsState = {
    showNoteName: true
  };

  const gameState = createGameState({
    availableNotesPool: AVAILABLE_NOTES_POOL.map((note) => note.midi),
    songLibrary: SONG_LIBRARY,
    parseSongFn: parseSongToMidiSequence,
    penaltyLength: 3
  });

  // --- DOM Elements ---
  const appContainer = document.getElementById('app-container');
  const midiStatusEl = document.getElementById('midi-status');
  const retryMidiBtn = document.getElementById('retry-midi');
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
  const modeSelect = document.getElementById('mode-select');
  const randomSettingsPanel = document.getElementById('random-settings-panel');
  const settingsFeedback = document.getElementById('settings-feedback');

  const SVG_HEIGHT = 150;
  let audioCtx = null;
  let midiAccessRef = null;
  const midiInputs = new Map();
  let midiConnecting = false;
  let resizeObserver = null;
  let previousFocusedElement = null;
  let modalKeydownListener = null;

  const debouncedStaffRender = debounce(() => {
    renderNoteOnStaff(gameState.getSnapshot().targetNote, true);
  }, 150);

  function storageGet(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (error) {
      console.warn('Unable to read setting', key, error);
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (error) {
      console.warn('Unable to persist setting', key, error);
    }
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch (error) {
      console.warn('Unable to remove setting', key, error);
    }
  }

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  function playNoteSound(midiNote) {
    if (!audioCtx) initAudio();
    if (!audioCtx) return;

    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    const frequency = 440 * Math.pow(2, (midiNote - 69) / 12);
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);

    const now = audioCtx.currentTime;
    const duration = 0.3;

    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(0.2, now + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

    osc.start(now);
    osc.stop(now + duration);
  }

  function renderNoteOnStaff(noteNumber, isPositive = true) {
    if (typeof noteNumber !== 'number') return;
    noteOutputDiv.innerHTML = '';

    const width = Math.max(canvasWrapper.clientWidth || 0, 220);
    const vf = new Factory({
      renderer: {
        elementId: 'note-canvas',
        width,
        height: SVG_HEIGHT,
        backend: Renderer.Backends.SVG
      }
    });

    const context = vf.getContext();
    const score = vf.EasyScore();

    context.setFillStyle('#e6edf3');
    context.setStrokeStyle('#e6edf3');

    const noteString = `${getEasyScoreNote(noteNumber)}/q`;
    const notes = score.notes(noteString);
    const targetStaveNote = notes[0];
    const accentColor = isPositive ? '#00ff9c' : '#ff5874';
    targetStaveNote.setStyle({ fillStyle: accentColor, strokeStyle: accentColor });

    const voice = score.voice(notes, { time: '1/4' });
    const stave = vf.Stave({ x: 0, y: 10, width });
    stave.addClef('treble');
    stave.setContext(context).draw();

    vf.Formatter().joinVoices([voice]).formatToStave([voice], stave);
    voice.draw(context, stave);

    if (showNoteNameCheckbox.checked) {
      context.setFont('Inter', 12, 'bold');
      context.setFillStyle(isPositive ? '#00ff9c' : '#fae100');
      context.fillText(getEasyScoreNote(noteNumber), width / 2 - 10, 140);
    }
  }

  function updateTargetNoteUI(isPositive = true) {
    renderNoteOnStaff(gameState.getSnapshot().targetNote, isPositive);
  }

  function updateStreakUI(isCorrect = null) {
    const { currentStreak } = gameState.getSnapshot();
    streakCountEl.textContent = currentStreak;

    if (typeof isCorrect === 'boolean') {
      appContainer.classList.remove('feedback-correct', 'feedback-incorrect');
      void appContainer.offsetWidth;
      canvasWrapper.classList.remove('border-transparent', 'border-green-500', 'border-red-500');
      if (isCorrect) {
        appContainer.classList.add('feedback-correct');
        canvasWrapper.classList.add('border-green-500');
      } else {
        appContainer.classList.add('feedback-incorrect');
        canvasWrapper.classList.add('border-red-500');
      }
    } else {
      canvasWrapper.classList.remove('border-green-500', 'border-red-500');
      canvasWrapper.classList.add('border-transparent');
    }
  }

  function applyMIDIStatusTone(tone) {
    midiStatusEl.classList.remove(
      'text-yellow-400',
      'text-green-400',
      'text-red-400',
      'bg-gray-700/50',
      'bg-green-700/20',
      'bg-red-700/20',
      'border-gray-600',
      'border-green-600',
      'border-red-600'
    );

    if (tone === 'success') {
      midiStatusEl.classList.add('text-green-400', 'bg-green-700/20', 'border-green-600');
    } else if (tone === 'error') {
      midiStatusEl.classList.add('text-red-400', 'bg-red-700/20', 'border-red-600');
    } else {
      midiStatusEl.classList.add('text-yellow-400', 'bg-gray-700/50', 'border-gray-600');
    }
  }

  function renderMIDIConnections() {
    if (midiInputs.size === 0) {
      midiStatusEl.innerHTML = '<span class="font-bold">No MIDI device found.</span> Connect a keyboard and press Retry.';
      applyMIDIStatusTone('error');
      return;
    }

    midiStatusEl.innerHTML = '';
    midiInputs.forEach((input) => {
      const deviceBadge = document.createElement('div');
      deviceBadge.className = 'mb-1';
      deviceBadge.textContent = `Connected: ${input.name}`;
      midiStatusEl.appendChild(deviceBadge);
    });
    applyMIDIStatusTone('success');
  }

  function handleIncomingNote(noteNumber, velocity) {
    if (velocity === 0) return;
    playNoteSound(noteNumber);

    const noteNameText = `${getNoteName(noteNumber)} (${noteNumber})`;
    lastNoteInfoEl.textContent = `Last Note: ${noteNameText}`;

    const result = gameState.recordNote(noteNumber);
    const isHit = result.event === 'hit';

    updateStreakUI(isHit);

    if (isHit) {
      updateTargetNoteUI(true);
      if (result.songLooped) {
        appContainer.classList.add('feedback-complete');
        setTimeout(() => appContainer.classList.remove('feedback-complete'), 500);
      }
    } else {
      updateTargetNoteUI(false);
    }

    updateInstructionText();
  }

  function onMIDIMessage(event) {
    const [status, data1, data2] = event.data;
    if (status === 254 || status === 248) return;
    if (status >= 144 && status <= 159) {
      handleIncomingNote(data1, data2);
    }
  }

  function wireMIDIInput(input) {
    if (!input || !input.id) return;
    input.onmidimessage = onMIDIMessage;
    midiInputs.set(input.id, input);
  }

  function unwireMIDIInput(inputId) {
    const device = midiInputs.get(inputId);
    if (device) {
      device.onmidimessage = null;
      midiInputs.delete(inputId);
    }
  }

  function handleMIDIStateChange(event) {
    if (event.port.type !== 'input') return;
    if (event.port.state === 'connected') {
      wireMIDIInput(event.port);
    } else if (event.port.state === 'disconnected') {
      unwireMIDIInput(event.port.id);
    }
    renderMIDIConnections();
  }

  function finishMidiConnectionAttempt() {
    midiConnecting = false;
    retryMidiBtn.disabled = false;
    retryMidiBtn.textContent = 'Retry Connection';
  }

  function onMIDISuccess(access) {
    midiAccessRef = access;
    midiInputs.clear();
    for (const input of midiAccessRef.inputs.values()) {
      wireMIDIInput(input);
    }
    midiAccessRef.onstatechange = handleMIDIStateChange;
    renderMIDIConnections();
    finishMidiConnectionAttempt();
  }

  function onMIDIFailure(error) {
    const message = error?.message || 'MIDI connection failed.';
    midiStatusEl.innerHTML = `<span class="font-bold">${message}</span>`;
    applyMIDIStatusTone('error');
    finishMidiConnectionAttempt();
  }

  function initMIDI() {
    if (midiConnecting) return;
    if (!navigator.requestMIDIAccess) {
      onMIDIFailure({ message: 'Your browser does not support the Web MIDI API.' });
      return;
    }

    midiConnecting = true;
    retryMidiBtn.disabled = true;
    retryMidiBtn.textContent = 'Connecting...';
    applyMIDIStatusTone('pending');
    midiStatusEl.innerHTML = '<span class="text-yellow-400">Connecting to MIDI...</span>';

    navigator
      .requestMIDIAccess()
      .then(onMIDISuccess)
      .catch(onMIDIFailure);
  }

  function updateInstructionText() {
    const snapshot = gameState.getSnapshot();
    instructionText.classList.remove('text-[#ff5874]', 'text-[#58a6ff]', 'text-gray-300');

    if (snapshot.penaltyHits > 0) {
      instructionText.textContent = `Penalty drill: ${snapshot.penaltyHits} more hit${snapshot.penaltyHits === 1 ? '' : 's'}`;
      instructionText.classList.add('text-[#ff5874]');
      return;
    }

    if (snapshot.mode === GameModes.SONG) {
      const title = snapshot.currentSongTitle || 'Song Mode';
      instructionText.textContent = `Song: ${title}`;
      instructionText.classList.add('text-[#58a6ff]');
      return;
    }

    instructionText.textContent = 'Next Note:';
    instructionText.classList.add('text-gray-300');
  }

  function populateSongOptions() {
    SONG_LIBRARY.forEach((song, index) => {
      const option = document.createElement('option');
      option.value = String(index);
      option.textContent = song.title;
      modeSelect.appendChild(option);
    });
  }

  function renderSettingsGrid() {
    notesGrid.innerHTML = '';
    AVAILABLE_NOTES_POOL.forEach((note) => {
      const label = document.createElement('label');
      label.className = 'flex items-center space-x-3 cursor-pointer p-2 rounded hover:bg-white/5';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'accent-[#58a6ff] h-4 w-4 bg-gray-700 border-gray-600 rounded focus:ring-0 focus:ring-offset-0 cursor-pointer';
      checkbox.value = note.midi;
      checkbox.checked = gameState.getSnapshot().activeNotes.includes(note.midi);

      const span = document.createElement('span');
      span.className = 'text-sm text-gray-300';
      span.textContent = note.label;

      label.appendChild(checkbox);
      label.appendChild(span);
      notesGrid.appendChild(label);
    });
  }

  function syncNoteCheckboxes() {
    const activeNotes = gameState.getSnapshot().activeNotes;
    notesGrid.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = activeNotes.includes(Number(checkbox.value));
    });
  }

  function applyActiveNotes(notes) {
    const success = gameState.setActiveNotes(notes);
    if (!success) {
      settingsFeedback.textContent = 'Select at least one active note.';
      return false;
    }
    settingsFeedback.textContent = '';
    storageSet(STORAGE_KEYS.ACTIVE_NOTES, gameState.getSnapshot().activeNotes);
    syncNoteCheckboxes();
    updateInstructionText();
    updateTargetNoteUI(true);
    return true;
  }

  function handleNotesGridChange(event) {
    if (event.target.tagName !== 'INPUT') return;
    const midiValue = Number(event.target.value);
    const activeNotes = new Set(gameState.getSnapshot().activeNotes);

    if (event.target.checked) {
      activeNotes.add(midiValue);
    } else {
      activeNotes.delete(midiValue);
    }

    const success = applyActiveNotes(Array.from(activeNotes));
    if (!success) {
      event.target.checked = true;
    }
  }

  function handleSelectAll() {
    applyActiveNotes(AVAILABLE_NOTES_POOL.map((note) => note.midi));
  }

  function handleClearAll() {
    applyActiveNotes([AVAILABLE_NOTES_POOL[0].midi]);
  }

  function applyPersistedSettings() {
    const persistedNotes = storageGet(STORAGE_KEYS.ACTIVE_NOTES, AVAILABLE_NOTES_POOL.map((note) => note.midi));
    if (!gameState.setActiveNotes(persistedNotes)) {
      gameState.setActiveNotes(DEFAULT_AVAILABLE_NOTES);
    }

    settingsState.showNoteName = storageGet(STORAGE_KEYS.SHOW_NOTE_NAME, true);
    showNoteNameCheckbox.checked = settingsState.showNoteName;
    showNoteNameCheckbox.setAttribute('aria-checked', settingsState.showNoteName ? 'true' : 'false');

    const persistedMode = storageGet(STORAGE_KEYS.MODE, GameModes.RANDOM);
    const persistedSongIndex = storageGet(STORAGE_KEYS.SONG_INDEX, 0);

    if (persistedMode === GameModes.SONG && gameState.setModeSong(persistedSongIndex)) {
      modeSelect.value = String(persistedSongIndex);
      randomSettingsPanel.classList.add('hidden');
    } else {
      modeSelect.value = 'random';
      randomSettingsPanel.classList.remove('hidden');
      gameState.setModeRandom();
      storageSet(STORAGE_KEYS.MODE, GameModes.RANDOM);
      storageRemove(STORAGE_KEYS.SONG_INDEX);
    }
  }

  function handleModeChange(event) {
    const value = event.target.value;
    if (value === 'random') {
      gameState.setModeRandom();
      randomSettingsPanel.classList.remove('hidden');
      storageSet(STORAGE_KEYS.MODE, GameModes.RANDOM);
      storageRemove(STORAGE_KEYS.SONG_INDEX);
    } else {
      const songIndex = Number(value);
      const success = gameState.setModeSong(songIndex);
      if (!success) {
        settingsFeedback.textContent = 'Unable to load song. Please select a different option.';
        modeSelect.value = 'random';
        gameState.setModeRandom();
        randomSettingsPanel.classList.remove('hidden');
        storageSet(STORAGE_KEYS.MODE, GameModes.RANDOM);
        storageRemove(STORAGE_KEYS.SONG_INDEX);
      } else {
        settingsFeedback.textContent = '';
        randomSettingsPanel.classList.add('hidden');
        storageSet(STORAGE_KEYS.MODE, GameModes.SONG);
        storageSet(STORAGE_KEYS.SONG_INDEX, songIndex);
      }
    }

    updateStreakUI();
    updateInstructionText();
    updateTargetNoteUI(true);
  }

  function handleShowNoteToggle() {
    settingsState.showNoteName = showNoteNameCheckbox.checked;
    showNoteNameCheckbox.setAttribute('aria-checked', settingsState.showNoteName ? 'true' : 'false');
    storageSet(STORAGE_KEYS.SHOW_NOTE_NAME, settingsState.showNoteName);
    updateTargetNoteUI(true);
  }

  function setupResizeObserver() {
    if (!('ResizeObserver' in window)) {
      window.addEventListener('resize', debouncedStaffRender);
      return;
    }
    resizeObserver = new ResizeObserver(() => debouncedStaffRender());
    resizeObserver.observe(canvasWrapper);
  }

  function openSettingsModal() {
    if (!settingsModal.classList.contains('hidden')) return;
    previousFocusedElement = document.activeElement;
    settingsModal.classList.remove('hidden');
    settingsModal.classList.add('flex', 'modal-enter');
    settingsModal.setAttribute('aria-hidden', 'false');
    settingsBtn.setAttribute('aria-expanded', 'true');

    requestAnimationFrame(() => settingsModal.classList.remove('modal-enter'));

    const focusable = settingsModal.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (first) {
      first.focus();
    }

    modalKeydownListener = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSettingsModal();
        return;
      }
      if (event.key === 'Tab' && focusable.length) {
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          (last || first).focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          (first || last).focus();
        }
      }
    };

    document.addEventListener('keydown', modalKeydownListener);
    settingsModal.addEventListener('click', handleModalBackdropClick);
  }

  function handleModalBackdropClick(event) {
    if (event.target === settingsModal) {
      closeSettingsModal();
    }
  }

  function closeSettingsModal() {
    if (settingsModal.classList.contains('hidden')) return;
    settingsModal.classList.add('hidden');
    settingsModal.classList.remove('flex');
    settingsModal.setAttribute('aria-hidden', 'true');
    settingsBtn.setAttribute('aria-expanded', 'false');

    if (modalKeydownListener) {
      document.removeEventListener('keydown', modalKeydownListener);
      modalKeydownListener = null;
    }
    settingsModal.removeEventListener('click', handleModalBackdropClick);

    if (previousFocusedElement) {
      previousFocusedElement.focus();
    }
  }

  function bindEventListeners() {
    notesGrid.addEventListener('change', handleNotesGridChange);
    selectAllBtn.addEventListener('click', handleSelectAll);
    clearAllBtn.addEventListener('click', handleClearAll);
    modeSelect.addEventListener('change', handleModeChange);
    showNoteNameCheckbox.addEventListener('change', handleShowNoteToggle);
    retryMidiBtn.addEventListener('click', initMIDI);
    settingsBtn.addEventListener('click', openSettingsModal);
    closeSettingsBtn.addEventListener('click', closeSettingsModal);
    window.addEventListener('pointerdown', initAudio, { once: true });
    window.addEventListener('keydown', initAudio, { once: true });
  }

  function initialize() {
    populateSongOptions();
    renderSettingsGrid();
    applyPersistedSettings();
    syncNoteCheckboxes();
    bindEventListeners();
    updateInstructionText();
    updateStreakUI();
    updateTargetNoteUI(true);
    initMIDI();
    setupResizeObserver();
  }

  initialize();
})();

function debounce(fn, delay = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
