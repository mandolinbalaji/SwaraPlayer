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
  Music,
  Upload
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

const getSemitones = (note: string, scale: string) => {
  // 1. Parse scale into a map
  const defaultMap: Record<string, number> = {};
  const ragaMatches = scale.match(/[SRGMPDN][123]?/gi) || [];
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
    scale: 'R1 G3 M1 D1 N3',
    beats: 8,
    nadai: 4,
    sruthi: 'C#',
    bpm: 80,
    thala: '',
    edam: '',
    tags: ''
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

  const redrawTala = (currentNotes: string, newNadai: number) => {
    if (!autoTala) return currentNotes;
    
    const lines = currentNotes.split('\n');
    const redrawnLines = lines.map(line => {
      // Match labels, notes with swarasthanas/octaves, commas, bars, and spaces
      const units = line.match(/([A-Za-z0-9 ]+:|[SRGMPDN][123]?\u0323?|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,|\|| )/gi) || [];
      let noteCount = 0;
      let newLine = '';
      
      units.forEach(unit => {
        if (unit === '|') return; // Strip existing bars
        
        newLine += unit;
        
        // Check if it's a playable note or comma
        const isPlayable = /[SRGMPDN]|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,/i.test(unit) && !unit.endsWith(':');
        
        if (isPlayable) {
          noteCount++;
          if (noteCount === newNadai) {
            newLine += '|';
            noteCount = 0;
          }
        }
      });
      
      return newLine;
    });
    
    return redrawnLines.join('\n');
  };

  const handleNadaiChange = (delta: number) => {
    const newNadai = Math.max(1, meta.nadai + delta);
    if (newNadai === meta.nadai) return;
    
    const updatedNotes = redrawTala(notes, newNadai);
    setMeta({ ...meta, nadai: newNadai });
    setNotes(updatedNotes);
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
      const semitones = getSemitones(charToAdd, meta.scale);
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
    
    // Stop any current playback when typing
    if (isPlaying) {
      setIsPlaying(false);
      isPlayingRef.current = false;
      if (playbackRef.current) clearTimeout(playbackRef.current);
    }

    // Live Play Logic: Play the current line once after a short delay
    if (livePlayTimeoutRef.current) clearTimeout(livePlayTimeoutRef.current);
    
    const lines = newValue.split('\n');
    const linesBefore = newValue.substring(0, start || 0).split('\n');
    const currentLineIdx = linesBefore.length - 1;
    const currentLine = lines[currentLineIdx];

    if (currentLine && currentLine.trim()) {
      livePlayTimeoutRef.current = setTimeout(() => {
        playNotation(currentLine, false); // Play once, no loop
      }, 1000);
    }

    // If a single character was added at the cursor
    if (newValue.length === notes.length + 1 && start !== null) {
      const charAdded = newValue[start - 1];
      
      // Play note immediately for keyboard feedback
      if (['S', 'R', 'G', 'M', 'P', 'D', 'N'].includes(charAdded) || 
          Object.values(DOT_ABOVE_MAP).includes(charAdded) || 
          Object.values(DOT_BELOW_MAP).includes(charAdded)) {
        const semitones = getSemitones(charAdded, meta.scale);
        audioEngine.playNote(semitones, meta.sruthi, 0.3);
      }

      const cursorOffset = insertNote(charAdded, start - 1, start - 1);
      
      // Update cursor position after state update
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(start + cursorOffset, start + cursorOffset);
        }
      }, 0);
    } else {
      // If autoTala is on, redraw the current line as we type
      if (autoTala) {
        const redrawn = redrawTala(newValue, meta.nadai);
        setNotes(redrawn);
        // Try to maintain cursor position
        setTimeout(() => {
          if (textareaRef.current) {
            textareaRef.current.setSelectionRange(start, start);
          }
        }, 0);
      } else {
        setNotes(newValue);
      }
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

  const importFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      // More flexible regex for meta tags
      const metaMatch = content.match(/MetaS:\s*(.*?)\s*MetaE:/s);
      if (metaMatch) {
        const metaStr = metaMatch[1];
        const parts = metaStr.split(/\s*\|\s*/);
        const newMeta = { ...meta };
        parts.forEach(part => {
          const colonIndex = part.indexOf(':');
          if (colonIndex === -1) return;
          
          const key = part.substring(0, colonIndex).trim();
          const value = part.substring(colonIndex + 1).trim();

          if (key === 'Song') newMeta.song = value;
          if (key === 'Raga') newMeta.raga = value;
          if (key === 'Scale' || key === 'RagaNotes') newMeta.scale = value;
          if (key === 'Beats') newMeta.beats = parseInt(value) || 8;
          if (key === 'Nadai') newMeta.nadai = parseInt(value) || 4;
          if (key === 'Sruthi') newMeta.sruthi = value;
          if (key === 'BPM') newMeta.bpm = parseInt(value) || 80;
          if (key === 'Thala') newMeta.thala = value;
          if (key === 'Edam') newMeta.edam = value;
          if (key === 'Tags') newMeta.tags = value;
        });
        setMeta(newMeta);
        
        // Split by MetaE: and take everything after
        const partsAfterMeta = content.split(/MetaE:\s*/);
        if (partsAfterMeta.length > 1) {
          let notationContent = partsAfterMeta[1];
          // Remove leading newline if exists
          if (notationContent.startsWith('\n')) {
            notationContent = notationContent.substring(1);
          }
          setNotes(notationContent);
        }
      } else {
        // Fallback: If no meta tags, just load the whole content as notes
        setNotes(content);
      }
    };
    reader.readAsText(file);
    // Reset input value so the same file can be imported again
    e.target.value = '';
  };

  const saveFile = () => {
    const content = `MetaS: Song: ${meta.song} | Raga: ${meta.raga} | Scale: ${meta.scale} | Beats: ${meta.beats} | Nadai: ${meta.nadai} | Sruthi: ${meta.sruthi} | BPM: ${meta.bpm} | Thala: ${meta.thala} | Edam: ${meta.edam} | Tags: ${meta.tags} | MetaE:
${notes}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${meta.song || 'Song'}_${meta.raga || 'Raga'}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const playNotation = async (customNotes?: string | React.MouseEvent, loopOverride?: boolean) => {
    if (isPlaying) {
      setIsPlaying(false);
      isPlayingRef.current = false;
      if (playbackRef.current) clearTimeout(playbackRef.current);
      return;
    }

    const notesToPlay = (typeof customNotes === 'string' ? customNotes : notes) || '';
    if (!notesToPlay.trim()) return;

    // Loop if it's a line play (string) and not explicitly overridden (e.g. for live play)
    isLoopingRef.current = loopOverride !== undefined ? loopOverride : (typeof customNotes === 'string');

    await audioEngine.playClick(0.01);

    setIsPlaying(true);
    isPlayingRef.current = true;
    
    // Parse notes into playable units (handle R2, etc.)
    const playableUnits: string[] = [];
    // Regex to match notes, symbols, and labels (text ending with :)
    const rawUnits = notesToPlay.match(/([A-Za-z0-9 ]+:|[SRGMPDN][123]?\u0323?|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,|\|)/gi) || [];
    
    // Filter out | for timing but keep for structure if needed
    // Skip labels (units ending with :)
    rawUnits.forEach(u => {
      if (u !== '|' && !u.endsWith(':')) playableUnits.push(u);
    });

    let currentIndex = 0;
    const beatDuration = (60 / meta.bpm) * 1000;
    const noteDuration = beatDuration / meta.nadai;

    const playNext = async () => {
      if (!isPlayingRef.current) return;
      
      if (currentIndex >= playableUnits.length) {
        if (isLoopingRef.current) {
          currentIndex = 0;
          playNext();
          return;
        }
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
        const semitones = getSemitones(char, meta.scale);
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
  const isLoopingRef = useRef(false);
  const livePlayTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  const renderHighlightedNotes = () => {
    const lines = notes.split('\n');
    
    return lines.map((line, lineIdx) => {
      const units = line.match(/([A-Za-z0-9 ]+:|[SRGMPDN][123]?\u0323?|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,|\|| )/gi) || [];
      
      return (
        <div key={lineIdx} className="relative leading-relaxed min-h-[1.625rem]">
          {/* Line Play Button - Absolutely positioned in the gutter */}
          <button 
            onClick={() => playNotation(line, true)}
            className="absolute -left-9 top-1 p-1.5 rounded-full bg-gray-100 hover:bg-black text-gray-400 hover:text-white transition-all pointer-events-auto shadow-sm z-40"
            title="Play this line (Loop)"
          >
            <Play className="w-2.5 h-2.5 fill-current" />
          </button>
          
          <div className="inline">
            {units.map((char, i) => {
              let color = 'text-gray-800';
              
              // Handle labels (text ending with :)
              if (char.endsWith(':')) {
                return (
                  <span key={i} className="text-gray-400 font-bold italic mr-2">
                    {char}
                  </span>
                );
              }

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
                
                // Reconstruct notes with the modified char
                const allLines = [...lines];
                const lineUnits = [...units];
                lineUnits[i] = newChar;
                allLines[lineIdx] = lineUnits.join('');
                setNotes(allLines.join('\n'));
              };

              return (
                <span 
                  key={i} 
                  onClick={handleClick}
                  className={`${color} font-mono text-[16px] leading-none inline-block ${octave !== 'normal' && /[SRGMPDN]/i.test(char) ? 'pointer-events-auto cursor-pointer hover:bg-black/5 rounded px-0.5' : 'pointer-events-none'}`}
                >
                  {char}
                </span>
              );
            })}
          </div>
        </div>
      );
    });
  };

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] p-4 md:p-8 font-sans">
      <div className="max-w-4xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-200">
        {/* Header / Meta Section */}
        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-black rounded-lg">
              <Music className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-serif italic font-bold tracking-tight">Carnatic Notation Writer</h1>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-11 gap-2">
            <div className="flex flex-col gap-1 col-span-2 md:col-span-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Song</label>
              <input 
                type="text" 
                value={meta.song}
                onChange={e => setMeta({...meta, song: e.target.value})}
                placeholder="Song"
                className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2 md:col-span-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Raga</label>
              <input 
                type="text" 
                value={meta.raga}
                onChange={e => setMeta({...meta, raga: e.target.value})}
                placeholder="Raga"
                className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2 md:col-span-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Scale</label>
              <input 
                type="text" 
                value={meta.scale}
                onChange={e => setMeta({...meta, scale: e.target.value})}
                placeholder="Scale"
                className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2 md:col-span-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Thala</label>
              <input 
                type="text" 
                value={meta.thala}
                onChange={e => setMeta({...meta, thala: e.target.value})}
                placeholder="Thala"
                className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2 md:col-span-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Edam</label>
              <input 
                type="text" 
                value={meta.edam}
                onChange={e => setMeta({...meta, edam: e.target.value})}
                placeholder="Edam"
                className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2 md:col-span-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Tags</label>
              <input 
                type="text" 
                value={meta.tags}
                onChange={e => setMeta({...meta, tags: e.target.value})}
                placeholder="Tags"
                className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Beats</label>
              <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => setMeta({...meta, beats: Math.max(1, meta.beats - 1)})} className="p-1.5 hover:bg-gray-50"><Minus className="w-2.5 h-2.5"/></button>
                <input type="number" value={meta.beats} readOnly className="w-full text-center text-xs focus:outline-none"/>
                <button onClick={() => setMeta({...meta, beats: meta.beats + 1})} className="p-1.5 hover:bg-gray-50"><Plus className="w-2.5 h-2.5"/></button>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Nadai</label>
              <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => handleNadaiChange(-1)} className="p-1.5 hover:bg-gray-50"><Minus className="w-2.5 h-2.5"/></button>
                <input type="number" value={meta.nadai} readOnly className="w-full text-center text-xs focus:outline-none"/>
                <button onClick={() => handleNadaiChange(1)} className="p-1.5 hover:bg-gray-50"><Plus className="w-2.5 h-2.5"/></button>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <input 
                  type="checkbox" 
                  id="autoTala" 
                  checked={autoTala} 
                  onChange={e => setAutoTala(e.target.checked)}
                  className="w-2.5 h-2.5 accent-black"
                />
                <label htmlFor="autoTala" className="text-[8px] uppercase font-bold text-gray-400 cursor-pointer">Auto |</label>
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Sruthi</label>
              <select 
                value={meta.sruthi}
                onChange={e => setMeta({...meta, sruthi: e.target.value})}
                className="bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none"
              >
                {['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 col-span-2 md:col-span-2">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">BPM</label>
              <div className="flex items-center bg-white border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => setMeta({...meta, bpm: Math.max(20, meta.bpm - 5)})} className="p-1.5 hover:bg-gray-50"><Minus className="w-2.5 h-2.5"/></button>
                <input type="number" value={meta.bpm} readOnly className="w-full text-center text-xs focus:outline-none"/>
                <button onClick={() => setMeta({...meta, bpm: Math.min(300, meta.bpm + 5)})} className="p-1.5 hover:bg-gray-50"><Plus className="w-2.5 h-2.5"/></button>
              </div>
            </div>
          </div>
        </div>

        {/* Editor Section */}
        <div className="p-6 relative">
          <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-2 block">
            {octave !== 'normal' ? `Click notes below to apply Dot ${octave === 'above' ? 'Above' : 'Below'}` : 'Enter Notes'}
          </label>
          <div className="relative min-h-[200px] bg-gray-50 rounded-xl border border-gray-200 p-0 font-mono text-[16px] leading-relaxed overflow-hidden">
            {/* Layered display for colors and interactive transformation - Always on top but transparent to clicks except for buttons */}
            <div className="absolute inset-0 p-4 pl-12 whitespace-pre-wrap break-all z-30 pointer-events-none font-mono text-[16px] leading-relaxed">
              {renderHighlightedNotes()}
            </div>
            <textarea
              ref={textareaRef}
              value={notes}
              onChange={handleTextareaChange}
              className="absolute inset-0 w-full h-full p-4 pl-12 bg-transparent text-transparent caret-black focus:outline-none resize-none whitespace-pre-wrap break-all z-10 font-mono text-[16px] leading-relaxed"
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
              onClick={() => playNotation()}
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

            <label className="flex items-center gap-2 px-5 py-2 rounded-full bg-white border border-gray-200 font-bold hover:bg-gray-50 transition-all active:scale-95 text-xs cursor-pointer">
              <Upload className="w-3 h-3" />
              <span>Import File</span>
              <input type="file" accept=".txt" onChange={importFile} className="hidden" />
            </label>
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
