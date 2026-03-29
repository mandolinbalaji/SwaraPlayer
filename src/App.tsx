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
  Upload,
  Download,
  Settings,
  Info,
  FileText,
  Share2,
  Wand2,
  Zap,
  Layers,
  Hash
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { audioEngine } from './lib/audio';
import { MetaData, Octave, SWARASTHANA_OFFSETS, BASE_NOTE_TO_DEFAULT_SWARASTHANA } from './types';
import { 
  DOT_ABOVE_MAP, 
  DOT_BELOW_MAP, 
  REVERSE_MAP, 
  getGraphemes, 
  getSemitones 
} from './lib/music';
import { exportMidi } from './lib/midi';

export default function App() {
  const [notes, setNotes] = useState('');
  const [meta, setMeta] = useState<MetaData>({
    song: 'Varnam',
    composer: '',
    raga: 'Mayamalavagowla',
    arohana: '',
    avarohana: '',
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
  const [isPlaying, setIsPlaying] = useState(false);
  const playbackRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const [activeLineIdx, setActiveLineIdx] = useState<number | null>(null);
  const [showOctaveToast, setShowOctaveToast] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) {
        if (e.key.toLowerCase() === 'u') {
          e.preventDefault();
          setOctave('above');
          setShowOctaveToast(true);
          setTimeout(() => setShowOctaveToast(false), 1000);
        } else if (e.key.toLowerCase() === 'd') {
          e.preventDefault();
          setOctave('below');
          setShowOctaveToast(true);
          setTimeout(() => setShowOctaveToast(false), 1000);
        } else if (e.key.toLowerCase() === 'n') {
          e.preventDefault();
          setOctave('normal');
          setShowOctaveToast(true);
          setTimeout(() => setShowOctaveToast(false), 1000);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, [notes]);

  const insertNote = (charToAdd: string, start: number, end: number) => {
    let insertion = charToAdd;
    let cursorOffset = charToAdd.length;

    // Auto-Tala bar insertion disabled during typing as requested
    // Users will use the "Format Line" (🪄) button instead
    
    const newNotes = notes.substring(0, start) + insertion + notes.substring(end);
    setNotes(newNotes);
    return cursorOffset;
  };

  const redrawTala = (currentNotes: string, newNadai: number, forceLine?: number) => {
    const lines = currentNotes.split('\n');
    const redrawnLines = lines.map((line, idx) => {
      if (forceLine !== undefined && idx !== forceLine) return line;
      
      // Match labels, notes, commas, bars, spaces, braces {}, blocks [N:...], and hyphen -
      const units = line.match(/([A-Za-z0-9 ]+:|[SRGMPDN][123]?\u0323?|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,|\|| |\{|\}|\[\d+:|\]|-)/gi) || [];
      let beatProgress = 0;
      let newLine = '';
      let speedMultiplier = 1;
      let nadaiOverride = null;
      
      units.forEach(unit => {
        if (unit === '|') return; // Strip existing bars
        
        if (unit === '{') { speedMultiplier = 0.5; newLine += unit; return; }
        if (unit === '}') { speedMultiplier = 1; newLine += unit; return; }
        if (unit.startsWith('[')) {
          const n = parseInt(unit.match(/\d+/)![0]);
          nadaiOverride = n;
          newLine += unit;
          return;
        }
        if (unit === ']') { nadaiOverride = null; newLine += unit; return; }
        if (unit === '-') { newLine += unit; return; } // Hyphen has zero duration
        
        newLine += unit;
        
        // Check if it's a playable note or comma
        const isPlayable = /[SRGMPDN]|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,/i.test(unit) && !unit.endsWith(':');
        
        if (isPlayable) {
          if (nadaiOverride) {
            beatProgress += (1 / nadaiOverride);
          } else {
            beatProgress += (speedMultiplier / newNadai);
          }
        }
      });
      
      return newLine;
    });
    
    return redrawnLines.join('\n');
  };

  // Improved Formatter that handles the "}|" requirement and hyphens
  const formatLine = (line: string) => {
    if (/^TAGS\b/i.test(line.trim()) || /^LR:/i.test(line.trim())) return line;
    const upperLine = line.toUpperCase();
    // Strip bars and collapse multiple spaces
    let clean = upperLine.replace(/\|/g, '').replace(/  +/g, ' ');
    // Tokenize
    const rawUnits = clean.match(/([A-Za-z0-9 ]+:|[SRGMPDNṠṘĠṀṖḊṄṢṚṂḌṆ][123]?\u0323?|,| |\{|\}|\[\d+:|\]|-)/gi) || [];
    // Filter out raw spaces to re-generate them correctly based on rules
    const units = rawUnits.filter(u => u !== ' ');
    
    let beatProgress = 0;
    let formatted = '';
    let speedMultiplier = 1;
    let nadaiOverride = null;

    const isVariant = (u: string) => /[123]/.test(u);
    const isPlayable = (u: string) => /[SRGMPDNṠṘĠṀṖḊṄṢṚṂḌṆ,]/i.test(u) && !u.endsWith(':');

    for (let i = 0; i < units.length; i++) {
      const unit = units[i];
      const nextUnit = i < units.length - 1 ? units[i+1] : null;
      
      if (unit === '{') speedMultiplier = 0.5;
      if (unit === '}') speedMultiplier = 1;
      if (unit.startsWith('[')) {
        const match = unit.match(/\d+/);
        if (match) nadaiOverride = parseInt(match[0]);
      }
      if (unit === ']') nadaiOverride = null;

      formatted += unit;

      // Update beat progress
      if (isPlayable(unit)) {
        if (nadaiOverride) beatProgress += (1 / nadaiOverride);
        else beatProgress += (speedMultiplier / meta.nadai);
      }

      const isAtBeatBoundary = Math.abs(beatProgress - Math.round(beatProgress)) < 0.001 && beatProgress > 0;

      if (isAtBeatBoundary) {
        // Add bar if we just finished a beat with a note, bracket, or hyphen
        if (isPlayable(unit) || unit === '}' || unit === ']' || unit === '-') {
          if (nextUnit !== '-' && nextUnit !== '}' && nextUnit !== ']') {
            formatted += '|';
          }
        }
      } else {
        // Not at beat boundary. Add space if:
        // 1. Current unit is a label
        // 2. Current unit is a playable note AND it's NOT a variant AND next unit is playable
        if (unit.endsWith(':')) {
          formatted += ' ';
        } else if (isPlayable(unit)) {
          if (!isVariant(unit) && nextUnit && isPlayable(nextUnit)) {
            formatted += ' ';
          }
        }
      }
      
      // Special handling for hyphen at beat boundary
      if (unit === '-' && isAtBeatBoundary && !formatted.endsWith('|')) {
        if (nextUnit !== '}' && nextUnit !== ']') {
          formatted += '|';
        }
      }
    }
    return formatted.trim();
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
    const start = e.target.selectionStart || 0;
    
    // Stop any current playback when typing
    if (isPlayingRef.current) {
      setIsPlaying(false);
      isPlayingRef.current = false;
      if (playbackRef.current) clearTimeout(playbackRef.current);
    }

    // Live Play Logic: Play the current line once after a short delay
    if (livePlayTimeoutRef.current) clearTimeout(livePlayTimeoutRef.current);
    
    const lines = newValue.split('\n');
    const linesBefore = newValue.substring(0, start).split('\n');
    const currentLineIdx = linesBefore.length - 1;
    const currentLine = lines[currentLineIdx];

    if (currentLine && currentLine.trim() && !/^TAGS\b/i.test(currentLine.trim()) && !/^LR:/i.test(currentLine.trim())) {
      livePlayTimeoutRef.current = setTimeout(() => {
        playNotation(currentLine, false); // Play once, no loop
      }, 800);
    }

    // If a single character was added at the cursor
    if (newValue.length === notes.length + 1) {
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
      // Auto-Tala redrawing disabled during typing
      setNotes(newValue);
      // Try to maintain cursor position
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.setSelectionRange(start, start);
        }
      }, 0);
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
          if (key === 'Composer') newMeta.composer = value;
          if (key === 'Raga') newMeta.raga = value;
          if (key === 'Arohana') newMeta.arohana = value;
          if (key === 'Avarohana') newMeta.avarohana = value;
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
          setNotes(notationContent.toUpperCase());
        }
      } else {
        // Fallback: If no meta tags, just load the whole content as notes
        setNotes(content.toUpperCase());
      }
    };
    reader.readAsText(file);
    // Reset input value so the same file can be imported again
    e.target.value = '';
  };

  const saveFile = async () => {
    setSaveStatus('saving');
    try {
      const fileName = `${meta.song || 'Song'}_${meta.raga || 'Raga'}.txt`;
      const content = `MetaS: Song: ${meta.song} | Composer: ${meta.composer} | Raga: ${meta.raga} | Arohana: ${meta.arohana} | Avarohana: ${meta.avarohana} | Scale: ${meta.scale} | Beats: ${meta.beats} | Nadai: ${meta.nadai} | Sruthi: ${meta.sruthi} | BPM: ${meta.bpm} | Thala: ${meta.thala} | Edam: ${meta.edam} | Tags: ${meta.tags} | MetaE:
${notes}`;
      const entry = {
        name: meta.song,
        song: meta.song,
        composer: meta.composer,
        raga: meta.raga,
        tala: meta.thala,
        beats: String(meta.beats),
        arohana: meta.arohana,
        avarohana: meta.avarohana,
        scale: meta.scale,
        sruthi: meta.sruthi,
        edam: meta.edam,
        tags: meta.tags,
        file: fileName,
      };

      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName, content, entry }),
      });

      if (!res.ok) throw new Error(await res.text());

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Save failed:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const playNotation = async (customNotes?: string | React.MouseEvent, loopOverride?: boolean, customLineIdx?: number) => {
    if (isPlaying) {
      setIsPlaying(false);
      isPlayingRef.current = false;
      if (playbackRef.current) clearTimeout(playbackRef.current);
      setActiveLineIdx(null);
      return;
    }

    const notesToPlay = (typeof customNotes === 'string' ? customNotes : notes) || '';
    if (!notesToPlay.trim()) return;

    // Loop if it's a line play (string) and not explicitly overridden (e.g. for live play)
    isLoopingRef.current = loopOverride !== undefined ? loopOverride : (typeof customNotes === 'string');

    await audioEngine.playClick(0.01);

    setIsPlaying(true);
    isPlayingRef.current = true;
    
    // Parse notes into playable units
    const playableUnits: { char: string, duration: number, lineIdx: number, unitIdx: number }[] = [];
    
    const beatDuration = (60 / meta.bpm) * 1000;
    const baseNoteDuration = beatDuration / meta.nadai;
    
    let speedMultiplier = 1;
    let nadaiOverride = null;

    if (typeof customNotes === 'string' && customLineIdx !== undefined) {
      const rawUnits = customNotes.match(/([A-Za-z0-9 ]+:|[SRGMPDN][123]?\u0323?|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,|\||\{|\}|\[\d+:|\]|-)/gi) || [];
      rawUnits.forEach((u, unitIdx) => {
        if (u === '{') { speedMultiplier = 0.5; return; }
        if (u === '}') { speedMultiplier = 1; return; }
        if (u.startsWith('[')) {
          nadaiOverride = parseInt(u.match(/\d+/)![0]);
          return;
        }
        if (u === ']') { nadaiOverride = null; return; }
        if (u === '-') return;

        if (u !== '|' && !u.endsWith(':') && u !== ' ') {
          let duration = baseNoteDuration * speedMultiplier;
          if (nadaiOverride) {
            duration = beatDuration / nadaiOverride;
          }
          playableUnits.push({ char: u, duration, lineIdx: customLineIdx, unitIdx });
        }
      });
    } else {
      const lines = notes.split('\n');
      lines.forEach((line, lineIdx) => {
        const trimmedLine = line.trim();
        if (/^TAGS\b/i.test(trimmedLine) || /^LR:/i.test(trimmedLine)) return;
        const rawUnits = line.match(/([A-Za-z0-9 ]+:|[SRGMPDN][123]?\u0323?|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,|\||\{|\}|\[\d+:|\]|-)/gi) || [];
        speedMultiplier = 1; // Reset per line
        nadaiOverride = null;
        rawUnits.forEach((u, unitIdx) => {
          if (u === '{') { speedMultiplier = 0.5; return; }
          if (u === '}') { speedMultiplier = 1; return; }
          if (u.startsWith('[')) {
            nadaiOverride = parseInt(u.match(/\d+/)![0]);
            return;
          }
          if (u === ']') { nadaiOverride = null; return; }
          if (u === '-') return;

          if (u !== '|' && !u.endsWith(':') && u !== ' ') {
            let duration = baseNoteDuration * speedMultiplier;
            if (nadaiOverride) {
              duration = beatDuration / nadaiOverride;
            }
            playableUnits.push({ char: u, duration, lineIdx, unitIdx });
          }
        });
      });
    }

    let currentIndex = 0;
    let totalElapsedBeats = 0;

    const playNext = async () => {
      if (!isPlayingRef.current) {
        setActiveLineIdx(null);
        return;
      }
      
      if (currentIndex >= playableUnits.length) {
        if (isLoopingRef.current) {
          currentIndex = 0;
          totalElapsedBeats = 0;
          playNext();
          return;
        }
        setIsPlaying(false);
        isPlayingRef.current = false;
        setActiveLineIdx(null);
        return;
      }

      const unit = playableUnits[currentIndex];
      const char = unit.char;
      const currentNoteDuration = unit.duration;
      
      // Update active line for UI highlighting
      setActiveLineIdx(unit.lineIdx);
      
      // Metronome Click Logic: Play click on every beat boundary
      // We track total elapsed beats and play click when we cross an integer
      const currentBeatVal = currentNoteDuration / beatDuration;
      
      // Play click if we are at the very start OR if we just crossed a beat boundary
      if (currentIndex === 0 || Math.floor(totalElapsedBeats + 0.001) > Math.floor(totalElapsedBeats - (playableUnits[currentIndex-1]?.duration / beatDuration) + 0.001)) {
        audioEngine.playClick();
      }

      if (char !== ',') {
        const semitones = getSemitones(char, meta.scale);
        audioEngine.playNote(semitones, meta.sruthi, currentNoteDuration / 1000);
      }

      totalElapsedBeats += currentBeatVal;
      currentIndex++;
      playbackRef.current = window.setTimeout(playNext, currentNoteDuration);
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
      const trimmed = line.trim();

      // TAGS line — render invisible (keeps line height for cursor alignment)
      if (/^TAGS\b/i.test(trimmed)) {
        return (
          <div key={lineIdx} className="relative leading-relaxed min-h-[1.625rem]">
            <span className="text-transparent select-none">{line}</span>
          </div>
        );
      }

      // LR: lyrics line — show text without tag, no controls
      if (/^LR:/i.test(trimmed)) {
        const prefixMatch = line.match(/^LR:\s*/i);
        const prefix = prefixMatch ? prefixMatch[0] : '';
        const lyrics = line.slice(prefix.length);
        return (
          <div key={lineIdx} className="relative leading-relaxed min-h-[1.625rem]">
            <span className="text-transparent select-none">{prefix}</span>
            <span className="text-gray-400 italic font-sans text-[15px]">{lyrics}</span>
          </div>
        );
      }

      const units = line.match(/([A-Za-z0-9 ]+:|[SRGMPDN][123]?\u0323?|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,|\|| |\{|\}|\[\d+:|\]|-)/gi) || [];

      let currentBrace: { startIdx: number, count: number } | null = null;
      let currentNadaiBlock: { startIdx: number, nadai: number } | null = null;

      return (
        <div key={lineIdx} className={`relative leading-relaxed min-h-[1.625rem] group transition-colors duration-200 ${activeLineIdx === lineIdx ? 'bg-yellow-100/50 rounded-md ring-1 ring-yellow-200' : ''}`}>
          {/* Line Controls */}
          <div className="absolute -left-16 top-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-40 pointer-events-auto">
            <button
              onClick={() => {
                const formatted = formatLine(line);
                const allLines = notes.split('\n');
                allLines[lineIdx] = formatted;
                setNotes(allLines.join('\n'));
              }}
              className="p-1.5 rounded-full bg-gray-100 hover:bg-purple-600 text-gray-400 hover:text-white transition-all shadow-sm"
              title="Format this line (🪄)"
            >
              <Wand2 className="w-2.5 h-2.5" />
            </button>
            <button
              onClick={() => playNotation(line, true, lineIdx)}
              className="p-1.5 rounded-full bg-gray-100 hover:bg-black text-gray-400 hover:text-white transition-all shadow-sm"
              title="Play this line (Loop)"
            >
              <Play className="w-2.5 h-2.5 fill-current" />
            </button>
          </div>
          
          <div className="inline">
            {units.map((char, i) => {
              let color = 'text-gray-800';
              
              if (char === '-') {
                return <span key={i} className="text-gray-300 mx-0.5 font-bold">{char}</span>;
              }

              if (char === '{') {
                currentBrace = { startIdx: i, count: 0 };
                let j = i + 1;
                while (j < units.length && units[j] !== '}') {
                  const isPlayable = /[SRGMPDN]|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,/i.test(units[j]) && !units[j].endsWith(':');
                  if (isPlayable) currentBrace.count++;
                  j++;
                }
                const isOdd = currentBrace.count % 2 !== 0;
                return <span key={i} className={`font-bold ${isOdd ? 'text-red-600' : 'text-red-400'}`}>{char}</span>;
              }

              if (char === '}') {
                const isOdd = currentBrace ? currentBrace.count % 2 !== 0 : false;
                currentBrace = null;
                return <span key={i} className={`font-bold ${isOdd ? 'text-red-600' : 'text-red-400'}`}>{char}</span>;
              }

              if (char.startsWith('[')) {
                const n = parseInt(char.match(/\d+/)![0]);
                currentNadaiBlock = { startIdx: i, nadai: n };
                return (
                  <span key={i} className="relative font-bold text-purple-400">
                    <span className="absolute -top-3 left-0 text-[8px] text-purple-600">{n}</span>
                    {char}
                  </span>
                );
              }

              if (char === ']') {
                currentNadaiBlock = null;
                return <span key={i} className="font-bold text-purple-400">{char}</span>;
              }

              if (char.endsWith(':')) {
                return <span key={i} className="text-gray-400 font-bold italic mr-2">{char}</span>;
              }

              const isAbove = Object.values(DOT_ABOVE_MAP).some(v => char.startsWith(v));
              const isBelow = Object.values(DOT_BELOW_MAP).some(v => char.startsWith(v)) || char.includes('\u0323');
              
              if (isAbove) color = 'text-red-600';
              if (isBelow) color = 'text-blue-600';
              
              if (currentBrace && currentBrace.count % 2 !== 0) {
                color = 'text-red-600 underline decoration-dotted';
              } else if (currentBrace) {
                color += ' border-t border-red-300';
              } else if (currentNadaiBlock) {
                color += ' border-t border-purple-300';
              }
              
              const handleClick = (e: React.MouseEvent) => {
                if (octave === 'normal') return;
                e.stopPropagation();
                const baseMatch = char.match(/[SRGMPDN]/i);
                if (!baseMatch) return;
                const baseNote = baseMatch[0].toUpperCase();
                const suffix = char.length > 1 && !char.includes('\u0323') ? char.substring(1) : '';
                let newChar = char;
                if (octave === 'above') newChar = (DOT_ABOVE_MAP[baseNote] || baseNote) + suffix;
                else if (octave === 'below') newChar = (DOT_BELOW_MAP[baseNote] || baseNote) + suffix;
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
                  className={`${color} font-mono text-[16px] ${octave !== 'normal' && /[SRGMPDN]/i.test(char) ? 'pointer-events-auto cursor-pointer hover:bg-black/5 rounded px-0.5' : 'pointer-events-none'}`}
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

  const wrapSelection = (prefix: string, suffix: string, replacement?: string) => {
    if (!textareaRef.current) return;
    const start = textareaRef.current.selectionStart;
    const end = textareaRef.current.selectionEnd;
    
    if (start === end && replacement) {
      const newText = notes.substring(0, start) + replacement + notes.substring(end);
      setNotes(newText);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(start + replacement.length, start + replacement.length);
        }
      }, 0);
      return;
    }

    if (start === end) return;

    const selectedText = notes.substring(start, end);
    const newText = notes.substring(0, start) + prefix + selectedText + suffix + notes.substring(end);
    setNotes(newText);
    
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(start, start + prefix.length + selectedText.length + suffix.length);
      }
    }, 0);
  };

  const getTalaMap = () => {
    // Get current line
    if (!textareaRef.current) return null;
    const start = textareaRef.current.selectionStart || 0;
    const lines = notes.substring(0, start).split('\n');
    const currentLineIdx = lines.length - 1;
    const fullLines = notes.split('\n');
    const currentLine = fullLines[currentLineIdx] || '';

    if (/^TAGS\b/i.test(currentLine.trim()) || /^LR:/i.test(currentLine.trim())) return null;

    const units = currentLine.match(/([A-Za-z0-9 ]+:|[SRGMPDN][123]?\u0323?|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,|\|| |\{|\}|\[\d+:|\]|-)/gi) || [];
    
    let beatProgress = 0;
    let speedMultiplier = 1;
    let nadaiOverride = null;
    
    const beatStates: { progress: number, isError: boolean }[] = [];
    for (let i = 0; i < meta.beats; i++) beatStates.push({ progress: 0, isError: false });

    units.forEach(u => {
      if (u === '{') speedMultiplier = 0.5;
      if (u === '}') speedMultiplier = 1;
      if (u.startsWith('[')) nadaiOverride = parseInt(u.match(/\d+/)![0]);
      if (u === ']') nadaiOverride = null;
      if (u === '|') return;
      if (u === '-') return; // Hyphen has zero duration

      const isPlayable = /[SRGMPDN]|Ṡ|Ṙ|Ġ|Ṁ|Ṗ|Ḋ|Ṅ|Ṣ|Ṛ|Ṃ|Ḍ|Ṇ|,/i.test(u) && !u.endsWith(':');
      if (isPlayable) {
        const val = nadaiOverride ? (1 / nadaiOverride) : (speedMultiplier / meta.nadai);
        const currentBeatIdx = Math.floor(beatProgress + 0.001);
        if (currentBeatIdx < meta.beats) {
          beatStates[currentBeatIdx].progress += val;
        }
        beatProgress += val;
      }
    });

    return (
      <div className="flex flex-wrap gap-2 mt-4 p-3 bg-white rounded-lg border border-gray-100 shadow-sm">
        {beatStates.map((beat, i) => {
          const isFull = Math.abs(beat.progress - 1) < 0.05;
          const isOver = beat.progress > 1.05;
          const isEmpty = beat.progress < 0.05;
          
          let bgColor = 'bg-gray-50';
          if (isFull) bgColor = 'bg-green-50 border-green-200';
          if (isOver) bgColor = 'bg-red-50 border-red-200';
          if (!isEmpty && !isFull && !isOver) bgColor = 'bg-orange-50 border-orange-200';

          return (
            <div key={i} className={`w-12 h-10 rounded border flex flex-col items-center justify-center transition-colors ${bgColor}`}>
              <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter">Beat {i+1}</span>
              <div className="flex gap-0.5 mt-1">
                {Array.from({ length: 4 }).map((_, dotIdx) => (
                  <div 
                    key={dotIdx} 
                    className={`w-1.5 h-1.5 rounded-full ${beat.progress > (dotIdx * 0.25) ? (isOver ? 'bg-red-400' : 'bg-green-400') : 'bg-gray-200'}`} 
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#F5F2ED] text-[#1A1A1A] p-4 md:p-8 font-sans">
      {/* Floating Octave Bar - Fixed to Viewport */}
      <div className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2 bg-white/90 backdrop-blur-md p-1.5 rounded-full border border-gray-200 shadow-lg hover:shadow-xl transition-all group">
        <button 
          onClick={() => setOctave('above')}
          className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${octave === 'above' ? 'bg-red-500 text-white scale-110 shadow-md' : 'text-gray-400 hover:bg-gray-100'}`}
          title="Dot Above (Alt+U)"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button 
          onClick={() => setOctave('normal')}
          className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${octave === 'normal' ? 'bg-gray-800 text-white scale-110 shadow-md' : 'text-gray-400 hover:bg-gray-100'}`}
          title="Normal (Alt+N)"
        >
          <Minus className="w-4 h-4" />
        </button>
        <button 
          onClick={() => setOctave('below')}
          className={`w-8 h-8 flex items-center justify-center rounded-full transition-all ${octave === 'below' ? 'bg-blue-500 text-white scale-110 shadow-md' : 'text-gray-400 hover:bg-gray-100'}`}
          title="Dot Below (Alt+D)"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      <div className="max-w-4xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden border border-gray-200">
        {/* Header / Meta Section */}
        <div className="p-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-black rounded-lg">
              <Music className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-2xl font-serif italic font-bold tracking-tight">Carnatic Notation Composer</h1>
          </div>

          <div className="flex flex-wrap gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Song</label>
              <input
                type="text"
                value={meta.song}
                onChange={e => setMeta({...meta, song: e.target.value})}
                placeholder="Song"
                className="w-[9rem] bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Composer</label>
              <input
                type="text"
                value={meta.composer}
                onChange={e => setMeta({...meta, composer: e.target.value})}
                placeholder="Composer"
                className="w-[9rem] bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Raga</label>
              <input
                type="text"
                value={meta.raga}
                onChange={e => setMeta({...meta, raga: e.target.value})}
                placeholder="Raga"
                className="w-[9rem] bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Arohana</label>
              <input
                type="text"
                value={meta.arohana}
                onChange={e => setMeta({...meta, arohana: e.target.value})}
                placeholder="S R G M P D N Ṡ"
                className="w-[9rem] bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Avarohana</label>
              <input
                type="text"
                value={meta.avarohana}
                onChange={e => setMeta({...meta, avarohana: e.target.value})}
                placeholder="Ṡ N D P M G R S"
                className="w-[9rem] bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Scale</label>
              <input
                type="text"
                value={meta.scale}
                onChange={e => setMeta({...meta, scale: e.target.value})}
                placeholder="Scale"
                className="w-[9rem] bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Thala</label>
              <input
                type="text"
                value={meta.thala}
                onChange={e => setMeta({...meta, thala: e.target.value})}
                placeholder="Thala"
                className="w-[9rem] bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Edam</label>
              <input
                type="text"
                value={meta.edam}
                onChange={e => setMeta({...meta, edam: e.target.value})}
                placeholder="Edam"
                className="w-[9rem] bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] uppercase tracking-widest font-bold text-gray-400">Tags</label>
              <input
                type="text"
                value={meta.tags}
                onChange={e => setMeta({...meta, tags: e.target.value})}
                placeholder="Tags"
                className="w-[9rem] bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-black/5"
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
            <div className="flex flex-col gap-1">
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
          {getTalaMap()}
          <label className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-2 block">
            {octave !== 'normal' ? `Click notes below to apply Dot ${octave === 'above' ? 'Above' : 'Below'}` : 'Enter Notes'}
          </label>
          {/* Selection Helpers */}
          <div className="flex flex-wrap gap-2 mb-4 p-2 bg-gray-50 rounded-lg border border-gray-100">
            <button 
              onClick={() => wrapSelection('{', '}')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-bold text-red-600 hover:bg-red-50 transition-colors shadow-sm"
              title="Wrap selection in Mel-Kaala (2x speed)"
            >
              <Zap className="w-3 h-3" />
              2x Speed
            </button>
            <button 
              onClick={() => wrapSelection('[3:', ']')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-bold text-purple-600 hover:bg-purple-50 transition-colors shadow-sm"
              title="Wrap selection in Thisram (3 notes/beat)"
            >
              <Hash className="w-3 h-3" />
              Thisram (3)
            </button>
            <button 
              onClick={() => wrapSelection('[5:', ']')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-bold text-purple-600 hover:bg-purple-50 transition-colors shadow-sm"
              title="Wrap selection in Kandam (5 notes/beat)"
            >
              <Hash className="w-3 h-3" />
              Kandam (5)
            </button>
            <button 
              onClick={() => wrapSelection('[7:', ']')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-bold text-purple-600 hover:bg-purple-50 transition-colors shadow-sm"
              title="Wrap selection in Misram (7 notes/beat)"
            >
              <Hash className="w-3 h-3" />
              Misram (7)
            </button>
            <button 
              onClick={() => wrapSelection('', '', '-')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-md text-xs font-bold text-gray-600 hover:bg-gray-50 transition-colors shadow-sm"
              title="Insert hyphen for visual grouping"
            >
              <Minus className="w-3 h-3" />
              Hyphen (-)
            </button>
            <div className="w-px h-6 bg-gray-200 mx-1 self-center" />
            <button 
              onClick={() => {
                const allLines = notes.split('\n');
                const formatted = allLines.map(l => formatLine(l)).join('\n');
                setNotes(formatted);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white rounded-md text-xs font-bold hover:bg-purple-700 transition-colors shadow-sm"
              title="Format all lines (🪄)"
            >
              <Wand2 className="w-3 h-3" />
              Format All
            </button>
          </div>

          <div className="relative h-[700px] bg-gray-50 rounded-xl border border-gray-200 p-0 font-mono text-[16px] leading-relaxed overflow-hidden">
            {/* Octave Toast */}
            {showOctaveToast && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-black/80 text-white text-xs font-bold rounded-full backdrop-blur-md animate-in fade-in zoom-in duration-200">
                Octave: {octave === 'above' ? 'Dot Above' : octave === 'below' ? 'Dot Below' : 'Normal'}
              </div>
            )}

            {/* Layered display for colors and interactive transformation - Always on top but transparent to clicks except for buttons */}
            <div 
              ref={highlightRef}
              style={{ scrollbarGutter: 'stable' }}
              className="absolute inset-0 p-4 pl-20 whitespace-pre-wrap break-all z-30 pointer-events-none font-mono text-[16px] leading-relaxed select-none overflow-y-hidden"
            >
              {renderHighlightedNotes()}
            </div>
            <textarea
              ref={textareaRef}
              value={notes}
              onChange={handleTextareaChange}
              onScroll={(e) => {
                if (highlightRef.current) {
                  highlightRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop;
                }
              }}
              style={{ scrollbarGutter: 'stable' }}
              className="absolute inset-0 w-full h-full p-4 pl-20 bg-transparent text-transparent caret-black focus:outline-none resize-none whitespace-pre-wrap break-all z-10 font-mono text-[16px] leading-relaxed border-none shadow-none ring-0 overflow-y-auto"
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
              disabled={saveStatus === 'saving'}
              className={`flex items-center gap-2 px-5 py-2 rounded-full font-bold transition-all active:scale-95 text-xs border ${
                saveStatus === 'saved' ? 'bg-green-50 border-green-300 text-green-700' :
                saveStatus === 'error' ? 'bg-red-50 border-red-300 text-red-700' :
                'bg-white border-gray-200 hover:bg-gray-50'
              }`}
            >
              <Save className="w-3 h-3" />
              <span>{saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved!' : saveStatus === 'error' ? 'Error' : 'Save File'}</span>
            </button>

            <button
              onClick={() => exportMidi(notes, meta).catch(err => alert(err.message))}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-blue-50 border border-blue-200 text-blue-700 font-bold hover:bg-blue-100 transition-all active:scale-95 text-xs"
            >
              <Download className="w-3 h-3" />
              <span>Export MIDI</span>
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
