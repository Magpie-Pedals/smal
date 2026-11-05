import { promises as fs, type Stats } from "node:fs";
import path from "node:path";

const DATA_DIR = process.env.DATA_DIR ?? path.resolve(process.cwd(), "data");
const FILES_DIR = path.join(DATA_DIR, "files");
const AUTH_FILE = path.join(DATA_DIR, "auth.json");
const TAGS_FILE = path.join(DATA_DIR, "tags.txt");

interface FileEntry {
  id: string;
  tag: string;
  username: string;
  track: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

const MIME_TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  flac: "audio/flac",
  ogg: "audio/ogg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
};

export async function loadAuth(): Promise<Record<string, string>> {
  const parsed = JSON.parse(await fs.readFile(AUTH_FILE, "utf8"));
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("auth.json must contain an object");
  }
  return parsed as Record<string, string>;
}

export async function loadTags(): Promise<string[]> {
  const raw = await fs.readFile(TAGS_FILE, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function ensureFilesDir(): Promise<void> {
  await fs.mkdir(FILES_DIR, { recursive: true });
}

// A path segment must be one safe filename: no separators, no traversal, no
// control characters, and within the filesystem's byte limit.
export function isValidSegment(value: string, maxBytes = 255): boolean {
  if (value.length === 0 || value === "." || value === "..") return false;
  if (value.includes("/") || value.includes("\\") || value.includes("\0")) return false;
  if (/[\x00-\x1f\x7f]/.test(value)) return false;
  return Buffer.byteLength(value, "utf8") <= maxBytes;
}

export function mimeFor(track: string): string | null {
  const ext = path.extname(track).slice(1).toLowerCase();
  return MIME_TYPES[ext] ?? null;
}

export function filePath(tag: string, username: string, track: string): string {
  return path.join(FILES_DIR, tag, username, track);
}

export function entryId(tag: string, username: string, track: string): string {
  return `${tag}/${username}/${track}`;
}

function toEntry(tag: string, username: string, track: string, stat: Stats): FileEntry {
  const created = stat.birthtimeMs > 0 ? stat.birthtime : stat.mtime;
  return {
    id: entryId(tag, username, track),
    tag,
    username,
    track,
    mimeType: mimeFor(track) ?? "application/octet-stream",
    size: stat.size,
    createdAt: created.toISOString(),
  };
}

export async function readEntry(
  tag: string,
  username: string,
  track: string
): Promise<FileEntry | null> {
  let stat;
  try {
    stat = await fs.lstat(filePath(tag, username, track));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (!stat.isFile()) return null;
  return toEntry(tag, username, track, stat);
}

export async function listFiles(): Promise<FileEntry[]> {
  await ensureFilesDir();
  const entries: FileEntry[] = [];

  const tags = await fs.readdir(FILES_DIR, { withFileTypes: true });
  for (const tagDir of tags) {
    if (!tagDir.isDirectory()) continue;

    const users = await fs.readdir(path.join(FILES_DIR, tagDir.name), { withFileTypes: true });
    for (const userDir of users) {
      if (!userDir.isDirectory()) continue;

      const tracks = await fs.readdir(path.join(FILES_DIR, tagDir.name, userDir.name), {
        withFileTypes: true,
      });
      for (const trackFile of tracks) {
        if (!trackFile.isFile()) continue;
        const stat = await fs.lstat(
          filePath(tagDir.name, userDir.name, trackFile.name)
        );
        entries.push(toEntry(tagDir.name, userDir.name, trackFile.name, stat));
      }
    }
  }

  return entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function writeFile(
  tag: string,
  username: string,
  track: string,
  data: Buffer
): Promise<void> {
  const target = filePath(tag, username, track);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
}

export async function removeFile(tag: string, username: string, track: string): Promise<void> {
  await fs.rm(filePath(tag, username, track), { force: true });
}

export async function writeAuthWithBackup(next: Record<string, string>): Promise<string> {
  const entries = await fs.readdir(DATA_DIR);
  let max = 0;
  for (const name of entries) {
    const match = /^auth\.json\.bak(\d+)$/.exec(name);
    if (match) max = Math.max(max, Number(match[1]));
  }

  const backupName = `auth.json.bak${max + 1}`;
  await fs.copyFile(AUTH_FILE, path.join(DATA_DIR, backupName));
  await fs.writeFile(AUTH_FILE, JSON.stringify(next, null, 2) + "\n");
  return backupName;
}

interface TagFile {
  abs: string;
  rel: string;
}

export async function listTagFiles(tag: string): Promise<TagFile[] | null> {
  const tagDir = path.join(FILES_DIR, tag);
  let stat;
  try {
    stat = await fs.lstat(tagDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  if (!stat.isDirectory()) return null;

  const files: TagFile[] = [];
  const users = await fs.readdir(tagDir, { withFileTypes: true });
  for (const userDir of users) {
    if (!userDir.isDirectory()) continue;

    const userPath = path.join(tagDir, userDir.name);
    const tracks = await fs.readdir(userPath, { withFileTypes: true });
    for (const track of tracks) {
      if (!track.isFile()) continue;
      files.push({
        abs: path.join(userPath, track.name),
        rel: path.join(userDir.name, track.name),
      });
    }
  }
  return files;
}
