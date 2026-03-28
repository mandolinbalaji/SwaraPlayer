import { SWARASTHANA_OFFSETS, BASE_NOTE_TO_DEFAULT_SWARASTHANA } from '../types';

export const DOT_ABOVE_MAP: Record<string, string> = {
  'S': 'Ṡ', 'R': 'Ṙ', 'G': 'Ġ', 'M': 'Ṁ', 'P': 'Ṗ', 'D': 'Ḋ', 'N': 'Ṅ'
};

export const DOT_BELOW_MAP: Record<string, string> = {
  'S': 'Ṣ', 'R': 'Ṛ', 'G': 'G\u0323', 'M': 'Ṃ', 'P': 'P\u0323', 'D': 'Ḍ', 'N': 'Ṇ'
};

export const REVERSE_MAP: Record<string, string> = {
  'Ṡ': 'S', 'Ṙ': 'R', 'Ġ': 'G', 'Ṁ': 'M', 'Ṗ': 'P', 'Ḋ': 'D', 'Ṅ': 'N',
  'Ṣ': 'S', 'Ṛ': 'R', 'G\u0323': 'G', 'Ṃ': 'M', 'P\u0323': 'P', 'Ḍ': 'D', 'Ṇ': 'N'
};

export const getGraphemes = (text: string) => {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text)).map(s => s.segment);
  }
  return text.match(/.\u0323?|./gu) || [];
};

export const getSemitones = (note: string, scale: string) => {
  const defaultMap: Record<string, number> = {};
  const ragaMatches = scale.match(/[SRGMPDN][123]?/gi) || [];
  ragaMatches.forEach(m => {
    const base = m[0].toUpperCase();
    defaultMap[base] = SWARASTHANA_OFFSETS[m.toUpperCase()] ?? 0;
  });

  let base = note[0].toUpperCase();
  let octaveOffset = 0;
  
  if (Object.values(DOT_ABOVE_MAP).includes(note)) {
    base = REVERSE_MAP[note];
    octaveOffset = 12;
  } else if (Object.values(DOT_BELOW_MAP).includes(note) || note.includes('\u0323')) {
    base = REVERSE_MAP[note] || note.replace('\u0323', '');
    octaveOffset = -12;
  }

  const swaraMatch = note.match(/[SRGMPDN][123]/i);
  if (swaraMatch) {
    return (SWARASTHANA_OFFSETS[swaraMatch[0].toUpperCase()] ?? 0) + octaveOffset;
  }

  const semitones = defaultMap[base] ?? SWARASTHANA_OFFSETS[BASE_NOTE_TO_DEFAULT_SWARASTHANA[base]] ?? 0;
  return semitones + octaveOffset;
};

export const SRUTHI_TO_MIDI: Record<string, number> = {
  'C': 60, 'C#': 61, 'D': 62, 'D#': 63, 'E': 64, 'F': 65, 'F#': 66, 'G': 67, 'G#': 68, 'A': 69, 'A#': 70, 'B': 71
};

export const getMidiNote = (note: string, scale: string, sruthi: string) => {
  const baseMidi = SRUTHI_TO_MIDI[sruthi] || 60;
  return baseMidi + getSemitones(note, scale);
};
