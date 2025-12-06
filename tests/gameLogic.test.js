import { describe, it, expect } from 'vitest';
import {
  createGameState,
  parseNoteToMidi,
  parseSongToMidiSequence,
  DEFAULT_AVAILABLE_NOTES
} from '../src/gameLogic.js';

describe('note helpers', () => {
  it('parses note names into MIDI numbers', () => {
    expect(parseNoteToMidi('C4')).toBe(60);
    expect(parseNoteToMidi('F#4')).toBe(66);
    expect(parseNoteToMidi('Bb3')).toBe(58);
  });

  it('converts song strings to MIDI sequences', () => {
    const sequence = parseSongToMidiSequence('C4/q, D4/8, E4, F4');
    expect(sequence).toEqual([60, 62, 64, 65]);
  });
});

describe('game state', () => {
  it('advances to new random targets after correct hits', () => {
    const game = createGameState({
      availableNotesPool: [60, 62],
      songLibrary: []
    });
    const initialTarget = game.getSnapshot().targetNote;
    const result = game.recordNote(initialTarget);
    expect(result.event).toBe('hit');
    const nextTarget = game.getSnapshot().targetNote;
    expect(nextTarget).not.toBe(initialTarget);
  });

  it('enforces penalty hits after a miss', () => {
    const game = createGameState({
      availableNotesPool: DEFAULT_AVAILABLE_NOTES.slice(0, 2),
      songLibrary: [],
      penaltyLength: 2
    });
    const snapshot = game.getSnapshot();
    const target = snapshot.targetNote;
    const missNote = target === 60 ? 62 : 60;

    const missResult = game.recordNote(missNote);
    expect(missResult.event).toBe('miss');
    expect(game.getSnapshot().penaltyHits).toBe(2);

    game.recordNote(target);
    expect(game.getSnapshot().penaltyHits).toBe(1);
    const releaseResult = game.recordNote(target);
    expect(releaseResult.event).toBe('hit');
    expect(game.getSnapshot().penaltyHits).toBe(0);
  });

  it('loops songs and reports completion when reaching the end', () => {
    const songLibrary = [
      { title: 'Test Song', notes: 'C4, D4' }
    ];
    const game = createGameState({
      availableNotesPool: [60, 62],
      songLibrary,
      parseSongFn: parseSongToMidiSequence
    });

    expect(game.setModeSong(0)).toBe(true);
    const firstTarget = game.getSnapshot().targetNote;
    game.recordNote(firstTarget);
    const secondTarget = game.getSnapshot().targetNote;
    const result = game.recordNote(secondTarget);
    expect(result.songLooped).toBe(true);
    expect(game.getSnapshot().songProgressIndex).toBe(0);
    expect(game.getSnapshot().targetNote).toBe(firstTarget);
  });
});
