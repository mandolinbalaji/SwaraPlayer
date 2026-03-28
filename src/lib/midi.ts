import MidiWriter from 'midi-writer-js';
import { MetaData } from '../types';
import { getMidiNote, getGraphemes } from './music';

export const exportMidi = (notes: string, meta: MetaData) => {
  const track = new MidiWriter.Track();
  track.setTempo(meta.bpm);
  track.addEvent(new MidiWriter.ProgramChangeEvent({ instrument: 1 })); // Acoustic Grand Piano

  const lines = notes.split('\n');
  
  lines.forEach(line => {
    const upperLine = line.toUpperCase();
    // Strip bars and collapse multiple spaces
    const clean = upperLine.replace(/\|/g, '').replace(/  +/g, ' ');
    // Tokenize
    const rawUnits = clean.match(/([A-Za-z0-9 ]+:|[SRGMPDNṠṘĠṀṖḊṄṢṚṂḌṆ][123]?\u0323?|,| |\{|\}|\[\d+:|\]|-)/gi) || [];
    // Filter out raw spaces
    const units = rawUnits.filter(u => u !== ' ');

    let speedMultiplier = 1;
    let nadaiOverride: number | null = null;

    let currentWait = 0;

    units.forEach(unit => {
      if (unit === '{') {
        speedMultiplier = 0.5;
        return;
      }
      if (unit === '}') {
        speedMultiplier = 1;
        return;
      }
      if (unit.startsWith('[')) {
        const match = unit.match(/\d+/);
        if (match) nadaiOverride = parseInt(match[0]);
        return;
      }
      if (unit === ']') {
        nadaiOverride = null;
        return;
      }
      if (unit.endsWith(':')) {
        return;
      }

      const isPlayable = /[SRGMPDNṠṘĠṀṖḊṄṢṚṂḌṆ]/i.test(unit);
      const isComma = unit === ',';
      const isHyphen = unit === '-';

      // Duration calculation:
      const ticksPerBeat = 128;
      let durationTicks = 0;
      
      if (nadaiOverride) {
        durationTicks = Math.round(ticksPerBeat / nadaiOverride);
      } else {
        durationTicks = Math.round((ticksPerBeat * speedMultiplier) / meta.nadai);
      }

      if (isPlayable) {
        const midiNote = getMidiNote(unit, meta.scale, meta.sruthi);
        track.addEvent(new MidiWriter.NoteEvent({
          pitch: [midiNote],
          duration: 'T' + durationTicks,
          wait: 'T' + currentWait,
          velocity: 100
        }));
        currentWait = 0;
      } else if (isComma || isHyphen) {
        currentWait += durationTicks;
      }
    });
  });

  const write = new MidiWriter.Writer(track);
  const dataUri = write.dataUri();
  
  const link = document.createElement('a');
  link.href = dataUri;
  link.download = `${meta.song}-${meta.raga}.mid`.toLowerCase().replace(/\s+/g, '-');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};
