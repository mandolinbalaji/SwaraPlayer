import React, { useState, useRef, useEffect } from 'react';
import { 
  ChevronUp, 
  ChevronDown, 
  Plus, 
  Minus, 
  Play, 
  Square, 
  Save, 
  Trash2, 
  Delete, 
  Music
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { audioEngine } from './lib/audio';
import { MetaData, Octave, SWARASTHANA_OFFSETS, BASE_NOTE_TO_DEFAULT_SWARASTHANA } from './types';

const DOT_ABOVE_MAP: Record<string, string> = {
  'S': 'Ṡ', 'R': 'Ṙ', 'G': 'Ġ', 'M': 'Ṁ', 'P': 'Ṗ', 'D': 'Ḋ', 'N': 'Ṅ'
};

const DOT_BELOW_MAP: Record<string, string> = {
  'S': 'Ṣ', 'R': 'Ṛ', 'G': 'G\u0323', 'M': 'Ṃ', 'P': 'P\u0323', 'D': 'Ḍ', 'N': 'Ṇ'
};

const REVERSE_MAP: Record<string, string> = {
  'Ṡ': 'S', 'Ṙ': 'R', 'Ġ': 'G', 'Ṁ': 'M', 'Ṗ': 'P', 'Ḋ': 'D', 'Ṅ': 'N',
  'Ṣ': 'S', 'Ṛ': 'R', 'G\u0323': 'G', 'Ṃ': 'M', 'P\u0323': 'P', 'Ḍ': 'D', 'Ṇ': 'N'
};

const getGraphemes = (text: string) => {
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return Array.from(segmenter.segment(text)).map(s => s.segment);
  }
  return text.match(/.\u0323?|./gu) || [];
};

const getSemitones = (note: string, ragaNotes: string) => {
  // 1. Parse ragaNotes into a map
  const defaultMap: Record<string, number> = {};
  const ragaMatches = ragaNotes.match(/[SRGMPDN][123]?/gi) || [];
  ragaMatches.forEach(m => {
    const base = m[0].toUpperCase();
    defaultMap[base] = SWARASTHANA_OFFSETS[m.toUpperCase()] ?? 0;
  });

  // 2. Identify base note and octave
  let base = note[0].toUpperCase();
  let octaveOffset = 0;
  
  if (Object.values(DOT_ABOVE_MAP).includes(note)) {
    base = REVERSE_MAP[note];
    octaveOffset = 12;
  } else if (Object.values(DOT_BELOW_MAP).includes(note) || note.includes('\u0323')) {
    base = REVERSE_MAP[note] || note.replace('\u0323', '');
    octaveOffset = -12;
  }

  // 3. Handle specific swarasthana in the note itself (e.g. "R2")
  const swaraMatch = note.match(/[SRGMPDN][123]/i);
  if (swaraMatch) {
    return (SWARASTHANA_OFFSETS[swaraMatch[0].toUpperCase()] ?? 0) + octaveOffset;
  }

  // 4. Use default from ragaNotes or fallback
  const semitones = defaultMap[base] ?? SWARASTHANA_OFFSETS[BASE_NOTE_TO_DEFAULT_SWARASTHANA[base]] ?? 0;
  return semitones + octaveOffset;
};

export default function App() {
  const [notes, setNotes] = useState('');
  const [meta, setMeta] = useState<MetaData>({
    song: 'Varnam',
    raga: 'Mayamalavagowla',
    ragaNotes: 'R1 G3 M1 D1 N3',
    beats: 8,
    nadai: 4,
    sruthi: 'C#',
    bpm: 80
  });
  const [octave, setOctave] = useState<Octave>('normal');
  const [autoTala, setAutoTala] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const insertNote = (charToAdd: string, start: number, end: number) => {
    let insertion = charToAdd;
    let cursorOffset = charToAdd.length;

    if (autoTala && charToAdd !== '|' && charToAdd !== ' ' && charToAdd !== '\n') {
      const textBefore = notes.substring(0, start) + charToAdd;
      const graphemesBefore = getGraphemes(textBefore);
      const notesOnlyBefore = graphemesBefore.filter(g => !['|', ' ', '\n'].includes(g));
      
      if (notesOnlyBefore.length > 0 && notesOnlyBefore.length % meta.nadai === 0) {
        insertion = charToAdd + '|';
        cursorOffset = charToAdd.length + 1;
      }
    }

    const newNotes = notes.substring(0, start) + insertion + notes.substring(end);
    setNotes(newNotes);
    return cursorOffset;
  };

  const handleNoteClick = (note: string) => {
    let charToAdd = note;
    if (octave === 'above' && DOT_ABOVE_MAP[note]) {
      charToAdd = DOT_ABOVE_MAP[note];
    } else if (octave === 'below' && DOT_BELOW_MAP[note]) {
      charToAdd = DOT_BELOW_MAP[note];
    }

    // Play note immediately for feedback
    if (charToAdd !== ',' && charToAdd !== '|') {
      const semitones = getSemitones(charToAdd, meta.ragaNotes);
      audioEngine.playNote(semitones, meta.sruthi, 0.3);
    }

    const start = textareaRef.current?.selectionStart ?? notes.length;
    const end = textareaRef.current?.selectionEnd ?? notes.length;
    
    const cursorOffset = insertNote(charToAdd, start, end);
    
    // Set focus back and move cursor
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(start + cursorOffset, start + cursorOffset);
      }
    }, 0);
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value.toUpperCase();
    const start = e.target.selectionStart;
    
    // If a single character was added at the cursor
    if (newValue.length === notes.length + 1 && start !== null) {
      const charAdded = newValue[start - 1];
      
      // Play note immediately for keyboard feedback
      if (['S', 'R', 'G', 'M', 'P', 'D', 'N'].includes(charAdded) || 
          Object.values(DOT_ABOVE_MAP).includes(charAdded) || 
          Object.values(DOT_BELOW_MAP).includes(charAdded)) {
        const semitones = getSemitones(charAdded, meta.ragaNotes);
        audioEngine.playNote(semitones, meta.sruthi, 0.3);
      }

      const cursorOffset = insertNote(charAdded, start - 1, start - 1);
    } else {
      setNotes(newValue);
    }
  };

  const handleBackspace = () => {
    const start = textareaRef.current?.selectionStart || 0;
    const end = textareaRef.current?.selectionEnd || 0;
    if (start === end && start > 0) {
      setNotes(notes.substring(0, start - 1) + notes.substring(end));
      setTimeout(() => {
        textareaRef.current?.setSelectionRange(start - 1, start - 1);
        textareaRef.current?.focus();
      }, 0);
    } else {
      setNotes(notes.substring(0, start) + notes.substring(end));
      setTimeout(() => {
        textareaRef.current?.setSelectionRange(start, start);
        textareaRef.current?.focus();
      }, 0);
    }
  };

  const handleClear = () => {
    if (confirm('Clear all notes?')) {
      setNotes('');
    }
  };

  const saveFile = () => {
    const content = `MetaS: Song: ${meta.song} | Raga: ${meta.raga} | RagaNotes: ${meta.ragaNotes} | Beats: ${meta.beats} | Nadai: ${meta.nadai} | Sruthi: ${meta.sruthi} | BPM: ${meta.bpm} | MetaE:
${notes}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meta.song || 'Song'}_${meta.raga || 'Raga'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const playNotation = async () => {
    if (isPlaying) {
      setIsPlaying(false);
      isPlayingRef.current = false;
      if (playbackRef.current) clearTimeout(playbackRef.current);
      return;
    }

    await audioEngine.playClick(0.01);

    setIsPlaying(true);
    isPlayingRef.current = true;
    
    // Parse notes into playable units (handle R2, etc.)
    const playableUnits: string[] = [];
    const rawUnits = notes.match(/([SRGMPDN][123]?\u0323?|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,|\|)/gi) || [];
    
    // Filter out | for timing but keep for structure if needed
    // Actually, let's just skip | in the playback loop without incrementing time
    rawUnits.forEach(u => {
      if (u !== '|') playableUnits.push(u);
    });

    let currentIndex = 0;
    const beatDuration = (60 / meta.bpm) * 1000;
    const noteDuration = beatDuration / meta.nadai;

    const playNext = async () => {
      if (!isPlayingRef.current) return;
      
      if (currentIndex >= playableUnits.length) {
        setIsPlaying(false);
        isPlayingRef.current = false;
        return;
      }

      const char = playableUnits[currentIndex];
      
      // Play click on every beat start
      if (currentIndex % meta.nadai === 0) {
        audioEngine.playClick();
      }

      if (char !== ',') {
        const semitones = getSemitones(char, meta.ragaNotes);
        audioEngine.playNote(semitones, meta.sruthi, noteDuration / 1000);
      }

      currentIndex++;
      playbackRef.current = window.setTimeout(playNext, noteDuration);
    };

    playNext();
  };

  // Stop playback on unmount
  useEffect(() => {
    return () => {
      if (playbackRef.current) clearTimeout(playbackRef.current);
    };
  }, []);

  // Update isPlaying ref-like behavior for the recursive playNext
  const isPlayingRef = useRef(isPlaying);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const renderHighlightedNotes = () => {
    const units = notes.match(/([SRGMPDN][123]?\u0323?|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,|\||\n| )/gi) || [];
    return units.map((char, i) => {
      let color = 'text-gray-800';
      const isAbove = Object.values(DOT_ABOVE_MAP).some(v => char.startsWith(v));
      const isBelow = Object.values(DOT_BELOW_MAP).some(v => char.startsWith(v)) || char.includes('\u0323');
      
      if (isAbove) color = 'text-red-600';
      if (isBelow) color = 'text-blue-600';
      
      const handleClick = (e: React.MouseEvent) => {
        if (octave === 'normal') return;
        
        e.stopPropagation();
        // Only transform base notes
        const baseMatch = char.match(/[SRGMPDN]/i);
        if (!baseMatch) return;
        
        const baseNote = baseMatch[0].toUpperCase();
        const suffix = char.length > 1 && !char.includes('\u0323') ? char.substring(1) : '';
        
        let newChar = char;
        if (octave === 'above') {
          newChar = (DOT_ABOVE_MAP[baseNote] || baseNote) + suffix;
        } else if (octave === 'below') {
          newChar = (DOT_BELOW_MAP[baseNote] || baseNote) + suffix;
        }
        
        const newUnits = [...units];
        newUnits[i] = newChar;
        setNotes(newUnits.join(''));
      };

      if (char === '\n') return <br key={i} />;

      return (
        <span 
          key={i} 
          onClick={handleClick}
          className={`${color} font-mono text-[16px] leading-none inline-block ${octave !== 'normal' && /[SRGMPDN]/i.test(char) ? 'cursor-pointer hover:bg-black/5 rounded px-0.5' : ''}`}
        >
          {char}
        </span>
      );
    });
  };

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] p-4 md:p-8 font-sans">
      <div className="max-w-4xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-200">
        {/* Header / Meta Section */}
        <div className="p-6 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-black rounded-lg">
              <Music className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-serif italic font-bold tracking-tight">Carnatic Notation Writer</h1>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
            <div className="flex flex-col gap-1 col-span-2 md:col-span-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Song</label>
              <input 
                type="text" 
                value={meta.song}
                onChange={e => setMeta({...meta, song: e.target.value})}
                placeholder="Song Name"
                className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2 md:col-span-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Raga</label>
              <input 
                type="text" 
                value={meta.raga}
                onChange={e => setMeta({...meta, raga: e.target.value})}
                placeholder="Raga Name"
                className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2 md:col-span-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Raga Notes</label>
              <input 
                type="text" 
                value={meta.ragaNotes}
                onChange={e => setMeta({...meta, ragaNotes: e.target.value})}
                placeholder="e.g. R2 G3 M1"
                className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Beats</label>
              <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => setMeta({...meta, beats: Math.max(1, meta.beats - 1)})} className="p-2 hover:bg-gray-50"><Minus className="w-3 h-3"/></button>
                <input type="number" value={meta.beats} readOnly className="w-full text-center text-sm focus:outline-none"/>
                <button onClick={() => setMeta({...meta, beats: meta.beats + 1})} className="p-2 hover:bg-gray-50"><Plus className="w-3 h-3"/></button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Nadai</label>
              <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => setMeta({...meta, nadai: Math.max(1, meta.nadai - 1)})} className="p-2 hover:bg-gray-50"><Minus className="w-3 h-3"/></button>
                <input type="number" value={meta.nadai} readOnly className="w-full text-center text-sm focus:outline-none"/>
                <button onClick={() => setMeta({...meta, nadai: meta.nadai + 1})} className="p-2 hover:bg-gray-50"><Plus className="w-3 h-3"/></button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <input 
                  type="checkbox" 
                  id="autoTala" 
                  checked={autoTala} 
                  onChange={e => setAutoTala(e.target.checked)}
                  className="w-3 h-3 accent-black"
                />
                <label htmlFor="autoTala" className="text-[9px] uppercase font-bold text-gray-400 cursor-pointer">Auto |</label>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400">Sruthi</label>
              <select 
                value={meta.sruthi}
                onChange={e => setMeta({...meta, sruthi: e.target.value})}
                className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
              >
                {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400">BPM</label>
              <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => setMeta({...meta, bpm: Math.max(20, meta.bpm - 5)})} className="p-2 hover:bg-gray-50"><Minus className="w-3 h-3"/></button>
                <input type="number" value={meta.bpm} readOnly className="w-full text-center text-sm focus:outline-none"/>
                <button onClick={() => setMeta({...meta, bpm: Math.min(300, meta.bpm + 5)})} className="p-2 hover:bg-gray-50"><Plus className="w-3 h-3"/></button>
              </div>
            </div>
          </div>
        </div>

        {/* Editor Section */}
        <div className="p-6 relative">
          <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-2 block">
            {octave !== 'normal' ? `Click notes below to apply Dot ${octave === 'above' ? 'Above' : 'Below'}` : 'Enter Notes'}
          </label>
          <div className="relative min-h-[200px] bg-gray-50 rounded-xl border border-gray-200 p-4 font-mono text-[16px] leading-relaxed">
            {/* Layered display for colors and interactive transformation */}
            <div className={`absolute inset-0 p-4 whitespace-pre-wrap break-all ${octave !== 'normal' ? 'z-20' : 'z-0 pointer-events-none'}`}>
              {renderHighlightedNotes()}
            </div>
            <textarea
              ref={textareaRef}
              value={notes}
              onChange={handleTextareaChange}
              className={`absolute inset-0 w-full h-full p-4 bg-transparent text-transparent caret-black focus:outline-none resize-none whitespace-pre-wrap break-all ${octave !== 'normal' ? 'z-10' : 'z-20'}`}
              spellCheck={false}
              placeholder="Type S R G M P D N..."
            />
          </div>
        </div>

        {/* Keyboard Section */}
        <div className="p-6 bg-gray-50 border-t border-gray-100">
          <div className="flex flex-wrap gap-2 justify-center items-center mb-6">
            <button 
              onClick={() => setOctave(octave === 'above' ? 'normal' : 'above')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full border transition-all ${octave === 'above' ? 'bg-red-500 text-white border-red-600 shadow-lg' : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'}`}
            >
              <ChevronUp className="w-3 h-3" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Dot Above</span>
            </button>
            <button 
              onClick={() => setOctave(octave === 'below' ? 'normal' : 'below')}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-full border transition-all ${octave === 'below' ? 'bg-blue-500 text-white border-blue-600 shadow-lg' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}
            >
              <ChevronDown className="w-3 h-3" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Dot Below</span>
            </button>
            
            <div className="h-6 w-[1px] bg-gray-300 mx-2" />

            <button 
              onClick={playNotation}
              className={`flex items-center gap-2 px-5 py-2 rounded-full font-bold transition-all ${isPlaying ? 'bg-red-500 text-white shadow-red-200' : 'bg-black text-white shadow-gray-200'} shadow-lg active:scale-95 text-xs`}
            >
              {isPlaying ? <Square className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
              <span>{isPlaying ? 'Stop' : 'Play'}</span>
            </button>

            <button 
              onClick={saveFile}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-white border border-gray-200 font-bold hover:bg-gray-50 transition-all active:scale-95 text-xs"
            >
              <Save className="w-3 h-3" />
              <span>Save File</span>
            </button>
          </div>

          <div className="grid grid-cols-4 sm:grid-cols-7 md:grid-cols-10 gap-2">
            {['S', 'R', 'G', 'M', 'P', 'D', 'N', ',', '|'].map(note => (
              <button
                key={note}
                onClick={() => handleNoteClick(note)}
                className="h-14 bg-white border border-gray-200 rounded-xl flex items-center justify-center text-xl font-bold hover:bg-gray-50 active:scale-95 transition-all shadow-sm"
              >
                {octave === 'above' && DOT_ABOVE_MAP[note] ? DOT_ABOVE_MAP[note] : 
                 octave === 'below' && DOT_BELOW_MAP[note] ? DOT_BELOW_MAP[note] : note}
              </button>
            ))}
            <button
              onClick={handleBackspace}
              className="h-14 bg-white border border-gray-200 rounded-xl flex items-center justify-center hover:bg-gray-50 active:scale-95 transition-all shadow-sm"
            >
              <Delete className="w-6 h-6 text-gray-500" />
            </button>
            <button
              onClick={handleClear}
              className="h-14 bg-white border border-gray-200 rounded-xl flex items-center justify-center hover:bg-red-50 active:scale-95 transition-all shadow-sm"
            >
              <Trash2 className="w-6 h-6 text-red-400" />
            </button>
          </div>
        </div>

      </div>

      <div className="max-w-4xl mx-auto mt-8 text-center">
        <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-gray-400">
          Monospaced 16px • Red: Upper Octave • Blue: Lower Octave
        </p>
      </div>
    </div>
  );
}
