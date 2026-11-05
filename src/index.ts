import path from "node:path";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZipArchive } from "archiver";
import multer from "multer";
import {
  entryId,
  filePath,
  isValidSegment,
  listFiles,
  listTagFiles,
  loadAuth,
  loadTags,
  mimeFor,
  readEntry,
  removeFile,
  writeAuthWithBackup,
  writeFile,
} from "./store";
import { API_INDEX } from "./api-index";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_FILE_SIZE = 32 * 1024 * 1024;
const MAX_SEGMENT_BYTES = 255;

const LIMITS = {
  username: 64,
  tag: 64,
};

const app = express();
app.use(express.json());
app.use(express.static(path.resolve(process.cwd(), "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

class BadRequest extends Error {}

function field(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BadRequest(`${name} is required`);
  }
  if (value.length > max) {
    throw new BadRequest(`${name} must be ${max} characters or fewer`);
  }
  return value;
}

function part(value: unknown, name: string, maxChars = MAX_SEGMENT_BYTES): string {
  if (typeof value !== "string" || !isValidSegment(value, MAX_SEGMENT_BYTES)) {
    throw new BadRequest(`${name} is not a valid path segment`);
  }
  if (value.length > maxChars) {
    throw new BadRequest(`${name} must be ${maxChars} characters or fewer`);
  }
  return value;
}

function routeParts(req: Request): { tag: string; username: string; track: string } | null {
  const { tag, username, track } = req.params;
  if (typeof tag !== "string" || typeof username !== "string" || typeof track !== "string") {
    return null;
  }
  if (!isValidSegment(tag) || tag.length > LIMITS.tag) return null;
  if (!isValidSegment(username) || username.length > LIMITS.username) return null;
  if (!isValidSegment(track, MAX_SEGMENT_BYTES)) return null;
  return { tag, username, track };
}

async function assertAuthorized(authKey: unknown, username: string): Promise<void> {
  const auth = await loadAuth();
  if (
    typeof authKey !== "string" ||
    !Object.prototype.hasOwnProperty.call(auth, username) ||
    auth[username] !== authKey
  ) {
    const err = new Error("unauthorized");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
}

function userForKey(auth: Record<string, string>, authKey: unknown): string | null {
  if (typeof authKey !== "string") return null;
  for (const [name, key] of Object.entries(auth)) {
    if (name !== "useradd" && key === authKey) return name;
  }
  return null;
}

async function assertAdminKey(req: Request): Promise<void> {
  const auth = await loadAuth();
  const key = req.query.key;
  if (
    typeof key !== "string" ||
    typeof auth.admin !== "string" ||
    auth.admin !== key
  ) {
    const err = new Error("unauthorized");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
}

async function requestUser(req: Request): Promise<string> {
  const auth = await loadAuth();
  const user = userForKey(auth, req.query.key);
  if (!user) {
    const err = new Error("unauthorized");
    (err as Error & { status?: number }).status = 401;
    throw err;
  }
  return user;
}

app.get("/api/v1", (_req: Request, res: Response) => {
  res.json(API_INDEX);
});

app.get("/api/v1/ls", async (req: Request, res: Response) => {
  const user = await requestUser(req);
  const files = await listFiles();
  res.json(user === "admin" ? files : files.filter((file) => file.username === user));
});

app.get("/api/v1/ls/tags", async (_req: Request, res: Response) => {
  res.json(await loadTags());
});

app.get("/api/v1/ls/users", async (req: Request, res: Response) => {
  await assertAdminKey(req);
  const auth = await loadAuth();
  res.json(Object.keys(auth).filter((name) => name !== "useradd").sort());
});

app.post("/api/v1/auth", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const username = field(body.username, "username", LIMITS.username);
  part(username, "username", LIMITS.username);

  const auth = await loadAuth();
  const authKey = body.authKey;
  if (
    typeof authKey !== "string" ||
    !Object.prototype.hasOwnProperty.call(auth, username) ||
    auth[username] !== authKey
  ) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  res.json({ username });
});

app.post("/api/v1/up", upload.single("file"), async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;

  const username = field(body.username, "username", LIMITS.username);
  part(username, "username", LIMITS.username);
  const authKey = body.authKey;
  await assertAuthorized(authKey, username);

  const tag = field(body.tag, "tag", LIMITS.tag);
  part(tag, "tag", LIMITS.tag);

  const tags = await loadTags();
  if (!tags.includes(tag)) {
    throw new BadRequest("tag is not valid");
  }

  if (!req.file) {
    throw new BadRequest("file is required");
  }

  const track = req.file.originalname;
  part(track, "file name");

  if (!mimeFor(track)) {
    throw new BadRequest("file must be wav, mp3, flac or ogg");
  }

  await writeFile(tag, username, track, req.file.buffer);
  res.status(201).json({ id: entryId(tag, username, track) });
});

app.get("/api/v1/dl/:tag", async (req: Request, res: Response) => {
  const user = await requestUser(req);
  const tag = req.params.tag;
  if (
    typeof tag !== "string" ||
    !isValidSegment(tag) ||
    tag.length > LIMITS.tag
  ) {
    res.status(400).json({ error: "invalid tag" });
    return;
  }

  let files = await listTagFiles(tag);
  if (!files) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (user !== "admin") {
    files = files.filter((file) => path.dirname(file.rel) === user);
  }

  res.type("application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(tag)}.zip`
  );

  const archive = new ZipArchive();
  archive.on("error", (err: Error) => {
    console.error(err);
    if (res.headersSent) {
      res.destroy();
    } else {
      res.status(500).json({ error: "failed to create archive" });
    }
  });
  res.on("close", () => {
    if (!res.writableEnded) archive.abort();
  });

  archive.pipe(res);
  for (const file of files) {
    archive.file(file.abs, { name: file.rel });
  }
  await archive.finalize();
});

app.get("/api/v1/dl/:tag/:username/:track", async (req: Request, res: Response) => {
  const user = await requestUser(req);
  const parts = routeParts(req);
  if (!parts) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  const entry = await readEntry(parts.tag, parts.username, parts.track);
  if (!entry) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (user !== "admin" && user !== parts.username) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  res.type(entry.mimeType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(parts.track)}`
  );
  res.sendFile(filePath(parts.tag, parts.username, parts.track));
});

app.delete("/api/v1/rm/:tag/:username/:track", async (req: Request, res: Response) => {
  const authKey = (req.body as Record<string, unknown>).authKey;
  const auth = await loadAuth();
  const requester = userForKey(auth, authKey);
  if (!requester) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const parts = routeParts(req);
  if (!parts) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  const entry = await readEntry(parts.tag, parts.username, parts.track);
  if (!entry) {
    res.status(404).json({ error: "not found" });
    return;
  }
  if (requester !== "admin" && requester !== parts.username) {
    res.status(403).json({ error: "forbidden" });
    return;
  }

  await removeFile(parts.tag, parts.username, parts.track);
  res.status(204).end();
});

app.post("/api/v1/useradd", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const auth = await loadAuth();
  const key = body.key;
  if (
    typeof key !== "string" ||
    !Object.prototype.hasOwnProperty.call(auth, "useradd") ||
    auth.useradd !== key
  ) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const username = field(body.username, "username", LIMITS.username);
  part(username, "username", LIMITS.username);

  const userkey = body.userkey;
  if (typeof userkey !== "string" || userkey.length === 0) {
    throw new BadRequest("userkey is required");
  }

  if (Object.prototype.hasOwnProperty.call(auth, username)) {
    res.status(409).json({
      error: "user_already_exists",
      message: "user already exists",
    });
    return;
  }

  if (Object.values(auth).includes(userkey)) {
    res.status(409).json({
      error: "userkey_already_exists",
      message: "userkey already exists",
    });
    return;
  }

  const backup = await writeAuthWithBackup({ ...auth, [username]: userkey });
  res.status(201).json({ username, backup });
});

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    res.status(413).json({ error: "file must be 32mb or smaller" });
    return;
  }
  if (err instanceof BadRequest) {
    res.status(400).json({ error: err.message });
    return;
  }
  const status = (err as Error & { status?: number }).status;
  if (status === 401) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "internal server error" });
});

app.listen(PORT, () => {
  console.log(`smal listening on port ${PORT}`);
});
