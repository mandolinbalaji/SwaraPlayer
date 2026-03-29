import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});
app.use(express.json({ limit: '10mb' }));

const NOTES_DIR = path.join(__dirname, 'notesfromtext');

app.post('/api/save', async (req, res) => {
  try {
    const { fileName, content, entry } = req.body as {
      fileName: string;
      content: string;
      entry: Record<string, unknown>;
    };

    // Ensure notesfromtext/ exists
    await fs.mkdir(NOTES_DIR, { recursive: true });

    // Write .txt file
    await fs.writeFile(path.join(NOTES_DIR, fileName), content, 'utf8');

    // Read existing index.json (or start fresh)
    let songs: Record<string, unknown>[] = [];
    const jsonPath = path.join(NOTES_DIR, 'index.json');
    try {
      songs = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    } catch {
      // file doesn't exist yet
    }

    // Update or append entry
    const idx = songs.findIndex(s => s.file === fileName);
    if (idx >= 0) songs[idx] = entry;
    else songs.push(entry);

    await fs.writeFile(jsonPath, JSON.stringify(songs, null, 2), 'utf8');

    res.json({ ok: true });
  } catch (err) {
    console.error('Save error:', err);
    res.status(500).json({ error: String(err) });
  }
});

app.post('/api/save-midi', async (req, res) => {
  try {
    const { fileName, dataUri } = req.body as { fileName: string; dataUri: string };

    // dataUri is "data:audio/midi;base64,<data>"
    const base64 = dataUri.split(',')[1];
    if (!base64) {
      res.status(400).json({ error: 'Invalid dataUri — missing base64 payload' });
      return;
    }

    await fs.mkdir(NOTES_DIR, { recursive: true });
    await fs.writeFile(path.join(NOTES_DIR, fileName), Buffer.from(base64, 'base64'));

    // Update index.json: find the entry whose .txt file matches this .mid file
    const txtFileName = fileName.replace(/\.mid$/i, '.txt');
    const normalize = (str) => str.toLowerCase().replace(/[-_]/g, '');
    const jsonPath = path.join(NOTES_DIR, 'index.json');
    let songs: Record<string, unknown>[] = [];
    try {
      songs = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    } catch {
      // index.json doesn't exist yet — nothing to update
    }

    console.log('[MIDI EXPORT] fileName:', fileName, '| txtFileName:', txtFileName);
    const idx = songs.findIndex(s => s.file && normalize(s.file) === normalize(txtFileName));
    if (idx >= 0) {
      songs[idx] = { ...songs[idx], midiFile: fileName };
      await fs.writeFile(jsonPath, JSON.stringify(songs, null, 2), 'utf8');
      console.log(`[MIDI EXPORT] Updated entry for`, songs[idx].file);
    } else {
      console.log(`[MIDI EXPORT] No matching entry found for`, txtFileName, '- no update made.');
    }

    res.json({ ok: true, path: path.join(NOTES_DIR, fileName) });
  } catch (err) {
    console.error('Save MIDI error:', err);
    res.status(500).json({ error: String(err) });
  }
});

const PORT = 3001;
app.listen(PORT, () => console.log(`API server on http://localhost:${PORT}`));
