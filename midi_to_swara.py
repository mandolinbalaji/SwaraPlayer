#!/usr/bin/env python3
"""
midi_to_swara.py — MIDI to SwaraPlayer Notation Converter

Converts a standard MIDI file (.mid) to Carnatic music notation format
compatible with the SwaraPlayer / Carnatic Notation Composer application.

Usage:
    python midi_to_swara.py input.mid [options]

Options:
    --sruthi    Root note / tonic (e.g. C, C#, D, D#, E, F, F#, G, G#, A, A#, B)
                Default: auto-detected from most frequent pitch class
    --nadai     Rhythmic subdivision per beat (2, 3, 4, 5, 6, 7, 8, 9)
                Default: auto-detected from note onset intervals
    --beats     Number of beats per measure (e.g. 4, 6, 8)
                Default: from MIDI time signature or 4
    --bpm       Override BPM (default: from MIDI tempo event)
    --track     MIDI track index to use (0-based). Default: merge all tracks
    --output    Output .txt file path. Default: same name as input with .txt extension
    --song      Song title for metadata
    --raga      Raga name for metadata
    --composer  Composer name for metadata

Requirements:
    pip install mido

Examples:
    python midi_to_swara.py my_song.mid --sruthi C# --nadai 4
    python midi_to_swara.py raga.mid --sruthi D --nadai 3 --beats 8 --raga Bhairavi
"""

import sys
import os
import argparse
import math
import textwrap
from collections import defaultdict, Counter
from pathlib import Path
from fractions import Fraction

# Force UTF-8 output on Windows so swara symbols render correctly
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except AttributeError:
        pass  # Python < 3.7 fallback

# ─────────────────────────────────────────────────────────────────────────────
# Dependency Check
# ─────────────────────────────────────────────────────────────────────────────

try:
    import mido
except ImportError:
    print()
    print("ERROR: Required library 'mido' is not installed.")
    print()
    print("  Install it with:")
    print("    pip install mido")
    print()
    print("  Or with uv:")
    print("    uv pip install mido")
    print()
    sys.exit(1)


# ─────────────────────────────────────────────────────────────────────────────
# Note / Swara Mappings
# ─────────────────────────────────────────────────────────────────────────────

# MIDI pitch class (0–11) → note name
PC_TO_NAME = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# Sruthi name → pitch class (0–11)
SRUTHI_TO_PC = {
    'C':  0,  'C#': 1,  'Db': 1,
    'D':  2,  'D#': 3,  'Eb': 3,
    'E':  4,
    'F':  5,  'F#': 6,  'Gb': 6,
    'G':  7,  'G#': 8,  'Ab': 8,
    'A':  9,  'A#': 10, 'Bb': 10,
    'B':  11
}

# Semitone offset from tonic (0–11) → Swara symbol (Carnatic standard)
# Base letter + optional variant number (1/2/3)
SEMITONE_TO_SWARA = {
    0:  'S',
    1:  'R1',
    2:  'R2',
    3:  'G2',   # enharmonic with R3; G2 is more common in Carnatic
    4:  'G3',
    5:  'M1',
    6:  'M2',
    7:  'P',
    8:  'D1',
    9:  'D2',
    10: 'N2',   # enharmonic with D3; N2 is more common
    11: 'N3'
}

# Higher octave precomposed Unicode (dot above each letter)
HIGHER = {
    'S': '\u1e60',   # Ṡ
    'R': '\u1e58',   # Ṙ
    'G': '\u0120',   # Ġ
    'M': '\u1e40',   # Ṁ
    'P': '\u1e56',   # Ṗ
    'D': '\u1e0a',   # Ḋ
    'N': '\u1e44',   # Ṅ
}

# Lower octave precomposed Unicode (dot below each letter)
# G and P use combining dot below (\u0323) as no precomposed form exists
LOWER = {
    'S': '\u1e62',         # Ṣ
    'R': '\u1e5a',         # Ṛ
    'G': 'G\u0323',        # G̣
    'M': '\u1e42',         # Ṃ
    'P': 'P\u0323',        # P̣
    'D': '\u1e0c',         # Ḍ
    'N': '\u1e46',         # Ṇ
}


# ─────────────────────────────────────────────────────────────────────────────
# MIDI → Swara conversion
# ─────────────────────────────────────────────────────────────────────────────

def midi_note_to_swara(midi_note: int, sruthi_pc: int):
    """
    Convert a MIDI note number to a SwaraPlayer swara symbol.

    Returns:
        (swara_string, carnatic_octave)
        carnatic_octave:  0 = middle, +1 = higher (dot above), -1 = lower (dot below)
        Returns (None, None) if the pitch is too far out of the 3-octave range.
    """
    # Find the semitone offset from the sruthi (tonic) in octave 0
    diff = midi_note - (sruthi_pc + 60)   # 60 = C4 reference

    # Carnatic octave and in-octave semitone
    octave = diff // 12
    semitone = diff % 12          # always 0–11 due to Python's // and %

    if semitone not in SEMITONE_TO_SWARA:
        return None, None          # should never happen

    swara = SEMITONE_TO_SWARA[semitone]   # e.g. 'R2', 'M1', 'S'
    base  = swara[0]                       # 'R', 'M', 'S', …
    variant = swara[1:]                    # '2', '1', '' …

    if octave == 0:
        symbol = swara
    elif octave == 1:
        symbol = HIGHER[base] + variant
    elif octave == -1:
        symbol = LOWER[base] + variant
    elif octave == 2:
        # Two octaves up — not standard notation; flag it
        symbol = f"[+2:{swara}]"
    elif octave == -2:
        symbol = f"[-2:{swara}]"
    else:
        symbol = f"[MIDI:{midi_note}]"

    return symbol, octave


# ─────────────────────────────────────────────────────────────────────────────
# MIDI file parsing
# ─────────────────────────────────────────────────────────────────────────────

def parse_midi(path: str) -> dict:
    """
    Parse a MIDI file and return a structured dict with:
      - ppq         : ticks per quarter note
      - tempo       : microseconds per beat (list of (tick, value) events)
      - time_sig    : (numerator, denominator) of first time signature
      - tracks_info : list of dicts {name, note_events [(abs_tick, pitch, velocity, type)]}
    Raises detailed exceptions on parse errors.
    """
    try:
        mid = mido.MidiFile(path)
    except FileNotFoundError:
        raise FileNotFoundError(f"MIDI file not found: '{path}'")
    except Exception as e:
        raise ValueError(
            f"Failed to parse MIDI file '{path}'.\n"
            f"  Error: {e}\n"
            f"  The file may be corrupt, truncated, or not a valid MIDI file."
        )

    ppq = mid.ticks_per_beat
    if ppq <= 0:
        raise ValueError(
            f"Invalid MIDI file: ticks_per_beat = {ppq}. "
            "Expected a positive integer (typically 96, 120, 480, or 960)."
        )

    tempo_events = []       # [(abs_tick, microseconds_per_beat)]
    time_sig = (4, 4)       # default
    tracks_info = []

    for track_idx, track in enumerate(mid.tracks):
        abs_tick = 0
        note_events = []   # (abs_tick, pitch, velocity, 'on'/'off')
        track_name = track.name or f"Track {track_idx}"

        for msg in track:
            abs_tick += msg.time

            if msg.type == 'set_tempo':
                tempo_events.append((abs_tick, msg.tempo))

            elif msg.type == 'time_signature':
                if not tempo_events and track_idx == 0:   # use first occurrence
                    time_sig = (msg.numerator, msg.denominator)

            elif msg.type == 'note_on' and msg.velocity > 0:
                note_events.append((abs_tick, msg.note, msg.velocity, 'on'))

            elif msg.type == 'note_off' or (msg.type == 'note_on' and msg.velocity == 0):
                note_events.append((abs_tick, msg.note, msg.velocity, 'off'))

        tracks_info.append({'name': track_name, 'note_events': note_events})

    if not tempo_events:
        tempo_events = [(0, 500000)]   # default: 120 BPM

    return {
        'ppq': ppq,
        'tempo_events': tempo_events,
        'time_sig': time_sig,
        'tracks_info': tracks_info,
        'midi_type': mid.type,
    }


def ticks_to_beats(ticks: int, ppq: int) -> float:
    return ticks / ppq


def get_bpm(tempo_us: int) -> float:
    return round(60_000_000 / tempo_us, 1)


def build_note_list(tracks_info, track_filter, ppq):
    """
    Build a flat list of notes: {start_beats, duration_beats, pitch, track, velocity}
    Handles note-on/off pairing. Unmatched note-ons get a default duration of 0.25 beats.
    """
    notes = []
    warnings = []

    # Decide which tracks to include
    if track_filter is not None:
        if track_filter < 0 or track_filter >= len(tracks_info):
            raise ValueError(
                f"Track index {track_filter} is out of range. "
                f"The MIDI file has {len(tracks_info)} track(s) (indexed 0–{len(tracks_info)-1})."
            )
        selected = [(track_filter, tracks_info[track_filter])]
    else:
        selected = list(enumerate(tracks_info))

    for t_idx, track in selected:
        active = {}   # pitch → (start_tick, velocity)
        for abs_tick, pitch, velocity, event_type in track['note_events']:
            if event_type == 'on':
                if pitch in active:
                    # Overlapping note: close previous
                    prev_start, prev_vel = active[pitch]
                    dur_ticks = abs_tick - prev_start
                    if dur_ticks > 0:
                        notes.append({
                            'start_beats':    ticks_to_beats(prev_start, ppq),
                            'duration_beats': ticks_to_beats(dur_ticks, ppq),
                            'pitch': pitch,
                            'track': t_idx,
                            'velocity': prev_vel,
                        })
                active[pitch] = (abs_tick, velocity)

            elif event_type == 'off':
                if pitch in active:
                    start_tick, vel = active.pop(pitch)
                    dur_ticks = abs_tick - start_tick
                    if dur_ticks > 0:
                        notes.append({
                            'start_beats':    ticks_to_beats(start_tick, ppq),
                            'duration_beats': ticks_to_beats(dur_ticks, ppq),
                            'pitch': pitch,
                            'track': t_idx,
                            'velocity': vel,
                        })
                else:
                    warnings.append(
                        f"  Note-off without matching note-on: "
                        f"pitch {pitch} on track {t_idx} at tick ~{abs_tick}"
                    )

        # Close any still-open notes at end of track
        for pitch, (start_tick, vel) in active.items():
            warnings.append(
                f"  Unclosed note (no note-off): pitch {pitch} on track {t_idx}. "
                f"Assigning default duration of 0.25 beats."
            )
            notes.append({
                'start_beats':    ticks_to_beats(start_tick, ppq),
                'duration_beats': 0.25,
                'pitch': pitch,
                'track': t_idx,
                'velocity': vel,
            })

    if not notes:
        raise ValueError(
            "No playable notes found in the selected MIDI track(s).\n"
            "  Possible causes:\n"
            "    • The file contains only control/meta messages (no note-on events)\n"
            "    • You selected a non-melodic track (e.g. percussion on channel 10)\n"
            "    • Try --track with a different track index"
        )

    return notes, warnings


# ─────────────────────────────────────────────────────────────────────────────
# Auto-detection helpers
# ─────────────────────────────────────────────────────────────────────────────

def detect_sruthi(notes: list[dict]) -> tuple[str, list[str]]:
    """
    Auto-detect the most likely sruthi by finding the most frequent pitch class.
    Returns (sruthi_name, all_candidates_sorted_by_frequency).
    """
    pc_counter = Counter(n['pitch'] % 12 for n in notes)
    sorted_pcs = [pc for pc, _ in pc_counter.most_common()]
    best_pc = sorted_pcs[0]
    return PC_TO_NAME[best_pc], [PC_TO_NAME[pc] for pc in sorted_pcs]


def gcd_float(values: list[float], tolerance: float = 0.01) -> float:
    """Approximate GCD of a list of floats using fractional approximation."""
    if not values:
        return 1.0
    # Round to nearest 1/32 to reduce floating-point noise
    fracs = [Fraction(v).limit_denominator(32) for v in values if v > tolerance]
    if not fracs:
        return 1.0
    g = fracs[0]
    for f in fracs[1:]:
        # GCD via Fraction arithmetic
        from math import gcd as int_gcd
        g = Fraction(int_gcd(g.numerator * f.denominator,
                             f.numerator * g.denominator),
                     g.denominator * f.denominator)
        if g <= 0:
            g = Fraction(1, 32)
    return float(g)


def detect_nadai(notes: list[dict], beats_per_bar: int) -> tuple[int, str]:
    """
    Auto-detect nadai (subdivisions per beat) from note onset intervals.
    Returns (nadai, explanation_string).
    """
    onsets = sorted(set(round(n['start_beats'], 6) for n in notes))
    if len(onsets) < 2:
        return 4, "Only one unique onset; defaulting to nadai=4"

    intervals = [round(onsets[i+1] - onsets[i], 6) for i in range(len(onsets)-1)]
    unit = gcd_float(intervals, tolerance=0.02)

    if unit <= 0 or unit > 2:
        return 4, f"Could not determine unit duration (got {unit:.4f}); defaulting to nadai=4"

    nadai_float = 1.0 / unit
    # Round to nearest common nadai value
    candidates = [2, 3, 4, 5, 6, 7, 8, 9, 12, 16]
    nadai = min(candidates, key=lambda n: abs(n - nadai_float))
    return nadai, f"Detected unit = {unit:.4f} beats → nadai = {nadai}"


# ─────────────────────────────────────────────────────────────────────────────
# Quantization & grid building
# ─────────────────────────────────────────────────────────────────────────────

def quantize_notes(notes: list[dict], nadai: int) -> list[dict]:
    """
    Snap each note's start time to the nearest nadai grid position (in units).
    Returns notes with 'grid_pos' (integer) field added.
    """
    unit = 1.0 / nadai
    quantized = []
    for note in notes:
        grid_pos = round(note['start_beats'] / unit)
        quantized.append({**note, 'grid_pos': grid_pos})
    return quantized


def resolve_polyphony(notes: list[dict]) -> tuple[dict, list[str]]:
    """
    When multiple notes share the same grid position, keep the highest pitch
    (melody note) and warn about the rest.
    Returns (grid_pos → note_dict, warnings).
    """
    grid = {}
    warnings = []

    for note in notes:
        pos = note['grid_pos']
        if pos in grid:
            existing = grid[pos]
            if note['pitch'] > existing['pitch']:
                warnings.append(
                    f"  Grid position {pos}: Polyphony detected "
                    f"(pitches {existing['pitch']} and {note['pitch']}). "
                    f"Keeping highest pitch {note['pitch']}."
                )
                grid[pos] = note
            else:
                warnings.append(
                    f"  Grid position {pos}: Polyphony detected "
                    f"(pitches {existing['pitch']} and {note['pitch']}). "
                    f"Keeping highest pitch {existing['pitch']}."
                )
        else:
            grid[pos] = note

    return grid, warnings


# ─────────────────────────────────────────────────────────────────────────────
# Notation generation
# ─────────────────────────────────────────────────────────────────────────────

def generate_notation(grid: dict, sruthi_pc: int, nadai: int, beats_per_bar: int) -> tuple[list[str], list[str]]:
    """
    Generate SwaraPlayer notation tokens from the quantized note grid.

    Returns:
        (tokens_list, warnings_list)
        tokens_list: flat list of swara symbols and ',' rests, with '|' bar markers
    """
    if not grid:
        return [], []

    max_pos = max(grid.keys())
    units_per_bar = beats_per_bar * nadai
    tokens = []
    warnings = []

    out_of_range_notes = []

    for pos in range(max_pos + 1):
        # Insert bar line at the start of each bar (except position 0)
        if pos > 0 and pos % units_per_bar == 0:
            tokens.append('|')

        if pos in grid:
            note = grid[pos]
            symbol, octave = midi_note_to_swara(note['pitch'], sruthi_pc)

            if symbol is None:
                symbol = ','
                warnings.append(
                    f"  MIDI note {note['pitch']} could not be mapped to a swara. "
                    f"Replaced with rest ','."
                )
            elif symbol.startswith('[') and symbol.endswith(']'):
                out_of_range_notes.append(
                    f"  MIDI note {note['pitch']} (grid pos {pos}) is "
                    f"{'2+ octaves above' if '+2' in symbol else '2+ octaves below or out of range'} "
                    f"the sruthi. Symbol: {symbol}. Replaced with rest ','."
                )
                symbol = ','

            tokens.append(symbol)
        else:
            tokens.append(',')

    warnings.extend(out_of_range_notes)
    return tokens, warnings


def format_tokens_to_lines(tokens: list[str], units_per_bar: int, bars_per_line: int = 4) -> list[str]:
    """
    Format a flat token list into notation lines.
    Each line contains up to bars_per_line bars.
    """
    lines = []
    current_line = []
    bar_count = 0
    pos = 0

    # Group tokens into bars
    bars = []
    current_bar = []
    for tok in tokens:
        if tok == '|':
            bars.append(current_bar)
            current_bar = []
        else:
            current_bar.append(tok)
    if current_bar:
        bars.append(current_bar)

    # Arrange bars into lines
    for i, bar in enumerate(bars):
        current_line.append(' '.join(bar))
        if (i + 1) % bars_per_line == 0:
            lines.append('| ' + ' | '.join(current_line) + ' |')
            current_line = []

    if current_line:
        lines.append('| ' + ' | '.join(current_line) + ' |')

    return lines


def build_metadata_line(
    song: str, composer: str, raga: str, arohana: str, avarohana: str,
    scale: str, beats: int, nadai: int, sruthi: str, bpm: float,
) -> str:
    """Build the MetaS: ... MetaE: header line."""
    bpm_int = int(round(bpm))
    parts = [
        f"MetaS:",
        f" Song: {song} |",
        f" Composer: {composer} |",
        f" Raga: {raga} |",
        f" Arohana: {arohana} |",
        f" Avarohana: {avarohana} |",
        f" Scale: {scale} |",
        f" Beats: {beats} |",
        f" Nadai: {nadai} |",
        f" Sruthi: {sruthi} |",
        f" BPM: {bpm_int} |",
        f" Thala:  |",
        f" Edam:  |",
        f" Tags:  |",
        f" MetaE:",
    ]
    return ''.join(parts)


# ─────────────────────────────────────────────────────────────────────────────
# Main converter
# ─────────────────────────────────────────────────────────────────────────────

def convert(args) -> None:
    """Run the full MIDI → SwaraPlayer conversion pipeline."""

    print(f"\n{'─'*60}")
    print(f"  MIDI → SwaraPlayer Converter")
    print(f"{'─'*60}")
    print(f"  Input : {args.input}")

    # ── 1. Parse MIDI ──────────────────────────────────────────────────────
    print("\n[1/6] Parsing MIDI file …")
    try:
        midi_data = parse_midi(args.input)
    except (FileNotFoundError, ValueError) as e:
        print(f"\nERROR: {e}\n")
        sys.exit(1)
    except Exception as e:
        print(f"\nERROR: Unexpected error while reading MIDI file.")
        print(f"  {type(e).__name__}: {e}\n")
        sys.exit(1)

    ppq         = midi_data['ppq']
    tempo_us    = midi_data['tempo_events'][0][1]   # first tempo event
    time_sig    = midi_data['time_sig']
    tracks_info = midi_data['tracks_info']

    bpm_detected = get_bpm(tempo_us)
    beats_detected = time_sig[0]

    print(f"       MIDI type   : {midi_data['midi_type']}")
    print(f"       Tracks      : {len(tracks_info)}")
    print(f"       PPQ         : {ppq}")
    print(f"       Tempo       : {tempo_us} µs/beat  ({bpm_detected} BPM)")
    print(f"       Time sig    : {time_sig[0]}/{time_sig[1]}")

    # List tracks
    for i, t in enumerate(tracks_info):
        n_events = len(t['note_events'])
        print(f"       Track {i:<2}    : '{t['name']}'  ({n_events} note events)")

    # ── 2. Build note list ─────────────────────────────────────────────────
    print("\n[2/6] Extracting notes …")
    try:
        notes, note_warnings = build_note_list(tracks_info, args.track, ppq)
    except ValueError as e:
        print(f"\nERROR: {e}\n")
        sys.exit(1)

    print(f"       Notes found : {len(notes)}")
    if note_warnings:
        print(f"       Warnings ({len(note_warnings)}):")
        for w in note_warnings:
            print(w)

    # ── 3. Detect / validate sruthi ────────────────────────────────────────
    print("\n[3/6] Determining sruthi (tonic) …")
    if args.sruthi:
        sruthi = args.sruthi.strip()
        if sruthi not in SRUTHI_TO_PC:
            valid = ', '.join(sorted(SRUTHI_TO_PC.keys()))
            print(f"\nERROR: Unknown sruthi '{sruthi}'.")
            print(f"  Valid values: {valid}\n")
            sys.exit(1)
        print(f"       Sruthi      : {sruthi}  (provided by user)")
    else:
        sruthi, candidates = detect_sruthi(notes)
        print(f"       Sruthi      : {sruthi}  (auto-detected; top candidates: {candidates[:4]})")
        print(f"       TIP: Use --sruthi to override if the melody sounds off-key.")

    sruthi_pc = SRUTHI_TO_PC[sruthi]

    # ── 4. Detect / validate nadai & beats ────────────────────────────────
    print("\n[4/6] Determining nadai & beats …")

    beats = args.beats if args.beats else beats_detected
    bpm   = args.bpm   if args.bpm   else bpm_detected

    if args.nadai:
        nadai = args.nadai
        print(f"       Nadai       : {nadai}  (provided by user)")
    else:
        nadai, nadai_msg = detect_nadai(notes, beats)
        print(f"       Nadai       : {nadai}  ({nadai_msg})")

    print(f"       Beats/bar   : {beats}")
    print(f"       BPM         : {bpm}")

    units_per_bar = beats * nadai
    unit_duration = 1.0 / nadai  # in beats

    # ── 5. Quantize & resolve polyphony ───────────────────────────────────
    print("\n[5/6] Quantizing and mapping notes …")
    q_notes = quantize_notes(notes, nadai)
    grid, poly_warnings = resolve_polyphony(q_notes)
    print(f"       Grid cells  : {max(grid.keys()) + 1 if grid else 0}")
    print(f"       Unique pos  : {len(grid)}")

    if poly_warnings:
        print(f"       Polyphony warnings ({len(poly_warnings)}):")
        for w in poly_warnings:
            print(w)

    # ── Generate notation ─────────────────────────────────────────────────
    tokens, map_warnings = generate_notation(grid, sruthi_pc, nadai, beats)
    if map_warnings:
        print(f"       Mapping warnings ({len(map_warnings)}):")
        for w in map_warnings:
            print(w)

    notation_lines = format_tokens_to_lines(tokens, units_per_bar, bars_per_line=4)

    # ── 6. Write output ───────────────────────────────────────────────────
    print("\n[6/6] Writing output file …")

    # Determine output path
    if args.output:
        out_path = Path(args.output)
    else:
        out_path = Path(args.input).with_suffix('.txt')

    song     = args.song     or Path(args.input).stem.replace('_', ' ').replace('-', ' ').title()
    raga     = args.raga     or ''
    composer = args.composer or ''

    meta_line = build_metadata_line(
        song=song, composer=composer, raga=raga,
        arohana='', avarohana='', scale='',
        beats=beats, nadai=nadai, sruthi=sruthi, bpm=bpm,
    )

    try:
        with open(out_path, 'w', encoding='utf-8') as f:
            f.write(meta_line + '\n')
            for line in notation_lines:
                f.write(line + '\n')
    except PermissionError:
        print(f"\nERROR: Permission denied writing to '{out_path}'.")
        print(f"  Try specifying a different output path with --output.\n")
        sys.exit(1)
    except OSError as e:
        print(f"\nERROR: Could not write output file '{out_path}'.")
        print(f"  {type(e).__name__}: {e}\n")
        sys.exit(1)

    print(f"       Output      : {out_path}")
    print(f"       Lines       : {len(notation_lines)}")

    total_warnings = len(note_warnings) + len(poly_warnings) + len(map_warnings)
    print(f"\n{'─'*60}")
    if total_warnings:
        print(f"  Done — with {total_warnings} warning(s). Review output carefully.")
    else:
        print(f"  Done — conversion successful.")
    print(f"{'─'*60}\n")


# ─────────────────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog='midi_to_swara',
        description=textwrap.dedent("""\
            Convert a MIDI file to SwaraPlayer / Carnatic Notation Composer format.

            The output .txt file uses the MetaS:/MetaE: header and swara notation
            (S R G M P D N with dot-above/dot-below octave markers) ready for
            direct import into the SwaraPlayer application.
        """),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            examples:
              %(prog)s song.mid
              %(prog)s song.mid --sruthi C# --nadai 4
              %(prog)s song.mid --sruthi D --nadai 3 --beats 8 --raga Bhairavi
              %(prog)s song.mid --track 1 --output my_notation.txt
        """)
    )

    parser.add_argument('input',
        help='Path to input .mid file')
    parser.add_argument('--sruthi', metavar='NOTE',
        help='Tonic/root note (C, C#, D, D#, E, F, F#, G, G#, A, A#, B). '
             'Default: auto-detected.')
    parser.add_argument('--nadai', metavar='N', type=int, choices=[2,3,4,5,6,7,8,9,12,16],
        help='Subdivisions per beat (2–9, 12, 16). Default: auto-detected.')
    parser.add_argument('--beats', metavar='N', type=int,
        help='Beats per measure. Default: from MIDI time signature.')
    parser.add_argument('--bpm', metavar='BPM', type=float,
        help='Override BPM. Default: from MIDI tempo.')
    parser.add_argument('--track', metavar='N', type=int,
        help='MIDI track index to use (0-based). Default: merge all tracks.')
    parser.add_argument('--output', metavar='FILE',
        help='Output .txt file path. Default: same name as input with .txt extension.')
    parser.add_argument('--song', metavar='TITLE',
        help='Song title for metadata.')
    parser.add_argument('--raga', metavar='NAME',
        help='Raga name for metadata.')
    parser.add_argument('--composer', metavar='NAME',
        help='Composer name for metadata.')

    if len(sys.argv) == 1:
        parser.print_help()
        sys.exit(0)

    args = parser.parse_args()

    # Basic input validation
    if not os.path.exists(args.input):
        print(f"\nERROR: Input file not found: '{args.input}'\n")
        sys.exit(1)

    ext = Path(args.input).suffix.lower()
    if ext not in ('.mid', '.midi'):
        print(f"\nWARNING: Input file '{args.input}' has extension '{ext}'.")
        print(f"  Expected a .mid or .midi file. Attempting to parse anyway …\n")

    convert(args)


if __name__ == '__main__':
    main()
