export const GameModes = {
  RANDOM: 'random',
  SONG: 'song'
};

export const GamePhase = {
  PRACTICE: 'practice',
  PENALTY: 'penalty'
};

export const DEFAULT_AVAILABLE_NOTES = [60, 62, 64, 65, 67, 69, 71, 72];

const EASY_SCORE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function parseNoteToMidi(noteName) {
  const noteRegex = /^([A-G])([#b]?)([0-9])$/;
  const match = noteName.trim().match(noteRegex);
  if (!match) {
    return 60;
  }

  const [, noteChar, accidental, octaveString] = match;
  const octave = Number(octaveString);
  const baseMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  let midi = baseMap[noteChar.toUpperCase()] + (octave + 1) * 12;

  if (accidental === '#') midi += 1;
  if (accidental === 'b') midi -= 1;

  return midi;
}

export function parseSongToMidiSequence(notesString) {
  if (!notesString) return [];
  const tokens = notesString.split(/[\s,]+/).filter(Boolean);
  return tokens.map((token) => {
    const cleanName = token.split('/')[0];
    return parseNoteToMidi(cleanName);
  });
}

export function getEasyScoreNote(noteNumber) {
  const octave = Math.floor(noteNumber / 12) - 1;
  const note = EASY_SCORE_NAMES[noteNumber % 12];
  return `${note}${octave}`;
}

export function getNoteName(noteNumber) {
  const octave = Math.floor(noteNumber / 12) - 1;
  const note = EASY_SCORE_NAMES[noteNumber % 12];
  return `${note}${octave}`;
}

function uniqueSortedNotes(notes, allowedNotes) {
  const allowedSet = new Set(allowedNotes);
  const deduped = [];

  notes.forEach((note) => {
    if (!allowedSet.has(note)) return;
    if (!deduped.includes(note)) {
      deduped.push(note);
    }
  });

  deduped.sort((a, b) => a - b);
  return deduped;
}

export function createGameState(config = {}) {
  const {
    availableNotesPool = DEFAULT_AVAILABLE_NOTES,
    songLibrary = [],
    parseSongFn = parseSongToMidiSequence,
    penaltyLength = 3
  } = config;

  if (!availableNotesPool.length) {
    throw new Error('availableNotesPool must contain at least one MIDI note');
  }

  const state = {
    availableNotesPool: [...availableNotesPool],
    activeNotes: [...availableNotesPool],
    previousRandomNote: null,
    mode: GameModes.RANDOM,
    phase: GamePhase.PRACTICE,
    targetNote: availableNotesPool[0],
    penaltyHits: 0,
    penaltyLength,
    currentStreak: 0,
    songLibrary,
    currentSongIndex: -1,
    currentSongTitle: '',
    songQueue: [],
    songProgressIndex: 0
  };

  function getSnapshot() {
    return {
      mode: state.mode,
      phase: state.phase,
      targetNote: state.targetNote,
      penaltyHits: state.penaltyHits,
      penaltyLength: state.penaltyLength,
      currentStreak: state.currentStreak,
      activeNotes: [...state.activeNotes],
      currentSongIndex: state.currentSongIndex,
      currentSongTitle: state.currentSongTitle,
      songQueueLength: state.songQueue.length,
      songProgressIndex: state.songProgressIndex
    };
  }

  function setPhase(newPhase) {
    state.phase = newPhase;
  }

  function resetPenalty() {
    state.penaltyHits = 0;
    setPhase(GamePhase.PRACTICE);
  }

  function ensureActiveNotes(notes) {
    const sanitized = uniqueSortedNotes(notes, state.availableNotesPool);
    if (!sanitized.length) {
      return false;
    }
    state.activeNotes = sanitized;
    return true;
  }

  function pickRandomNote(excludeNote = null) {
    const pool = state.activeNotes.length ? state.activeNotes : state.availableNotesPool;
    if (pool.length === 1) {
      state.previousRandomNote = pool[0];
      return pool[0];
    }

    let nextNote = pool[Math.floor(Math.random() * pool.length)];
    let safety = 0;
    while (nextNote === excludeNote && safety < 10) {
      nextNote = pool[Math.floor(Math.random() * pool.length)];
      safety += 1;
    }
    state.previousRandomNote = nextNote;
    return nextNote;
  }

  function advanceTargetForRandomMode() {
    const nextNote = pickRandomNote(state.targetNote);
    state.targetNote = nextNote;
    return {
      targetChanged: true,
      newTarget: nextNote,
      songLooped: false
    };
  }

  function advanceTargetForSongMode() {
    if (!state.songQueue.length) {
      return advanceTargetForRandomMode();
    }
    state.songProgressIndex += 1;
    let songLooped = false;
    if (state.songProgressIndex >= state.songQueue.length) {
      state.songProgressIndex = 0;
      songLooped = true;
    }
    state.targetNote = state.songQueue[state.songProgressIndex];
    return {
      targetChanged: true,
      newTarget: state.targetNote,
      songLooped
    };
  }

  function advanceTarget() {
    if (state.mode === GameModes.SONG) {
      return advanceTargetForSongMode();
    }
    return advanceTargetForRandomMode();
  }

  function setModeRandom() {
    state.mode = GameModes.RANDOM;
    state.currentSongIndex = -1;
    state.currentSongTitle = '';
    state.songQueue = [];
    state.songProgressIndex = 0;
    resetPenalty();
    state.currentStreak = 0;
    state.targetNote = pickRandomNote();
    return getSnapshot();
  }

  function setModeSong(songIndex) {
    const song = state.songLibrary[songIndex];
    if (!song) {
      return false;
    }
    const queue = parseSongFn(song.notes);
    if (!queue.length) {
      return false;
    }

    state.mode = GameModes.SONG;
    state.currentSongIndex = songIndex;
    state.currentSongTitle = song.title;
    state.songQueue = queue;
    state.songProgressIndex = 0;
    state.targetNote = queue[0];
    resetPenalty();
    state.currentStreak = 0;
    return true;
  }

  function setActiveNotes(notes) {
    const success = ensureActiveNotes(notes);
    if (!success) {
      return false;
    }

    if (state.mode === GameModes.RANDOM && !state.activeNotes.includes(state.targetNote)) {
      state.targetNote = pickRandomNote(state.targetNote);
    }
    return true;
  }

  function recordNote(noteNumber) {
    const isHit = noteNumber === state.targetNote;

    if (!isHit) {
      state.currentStreak = 0;
      state.penaltyHits = state.penaltyLength;
      setPhase(GamePhase.PENALTY);
      return {
        event: 'miss',
        newTarget: state.targetNote,
        targetChanged: false,
        penaltyRemaining: state.penaltyHits,
        streak: state.currentStreak,
        mode: state.mode
      };
    }

    state.currentStreak += 1;

    let targetChanged = false;
    let newTarget = state.targetNote;
    let songLooped = false;

    let shouldAdvance = false;
    if (state.penaltyHits > 0) {
      state.penaltyHits -= 1;
      if (state.penaltyHits === 0) {
        shouldAdvance = true;
        setPhase(GamePhase.PRACTICE);
      }
    } else {
      shouldAdvance = true;
    }

    if (shouldAdvance) {
      const advanceInfo = advanceTarget();
      targetChanged = advanceInfo.targetChanged;
      newTarget = advanceInfo.newTarget;
      songLooped = advanceInfo.songLooped;
    }

    return {
      event: 'hit',
      newTarget,
      targetChanged,
      penaltyRemaining: state.penaltyHits,
      streak: state.currentStreak,
      songLooped,
      mode: state.mode
    };
  }

  // Initialize target for default mode
  state.targetNote = pickRandomNote();

  return {
    getSnapshot,
    setModeRandom,
    setModeSong,
    setActiveNotes,
    recordNote,
    resetPenalty,
    getAvailableNotes: () => [...state.availableNotesPool]
  };
}
