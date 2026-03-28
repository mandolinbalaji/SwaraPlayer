export type Octave = 'normal' | 'above' | 'below';

export interface MetaData {
  song: string;
  composer: string;
  raga: string;
  arohana: string;
  avarohana: string;
  scale: string; // e.g. "r2 g2 m1 d2 n2"
  beats: number;
  nadai: number;
  sruthi: string;
  bpm: number;
  thala: string;
  edam: string;
  tags: string;
}

export const SWARASTHANA_OFFSETS: Record<string, number> = {
  'S': 0,
  'R1': 1, 'R2': 2, 'R3': 3,
  'G1': 2, 'G2': 3, 'G3': 4,
  'M1': 5, 'M2': 6,
  'P': 7,
  'D1': 8, 'D2': 9, 'D3': 10,
  'N1': 9, 'N2': 10, 'N3': 11
};

export const BASE_NOTE_TO_DEFAULT_SWARASTHANA: Record<string, string> = {
  'S': 'S', 'R': 'R2', 'G': 'G3', 'M': 'M1', 'P': 'P', 'D': 'D2', 'N': 'N3'
};

export const SRUTHI_FREQUENCIES: Record<string, number> = {
  'C': 261.63, 'C#': 277.18, 'D': 293.66, 'D#': 311.13, 'E': 329.63,
  'F': 349.23, 'F#': 369.99, 'G': 392.00, 'G#': 415.30, 'A': 440.00,
  'A#': 466.16, 'B': 493.88
};
