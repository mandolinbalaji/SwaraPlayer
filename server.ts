import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
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

const PORT = 3001;
app.listen(PORT, () => console.log(`API server on http://localhost:${PORT}`));
