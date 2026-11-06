# smal

A flat-file audio store built with TypeScript, Node and Express. Files live in `data/files/<tag>/<username>/<track>`. 

There is no database or metadata file. A vanilla JS front-end is served at `/`.

## Setup

```sh
npm install
npm start
```

The server listens on port `3000` by default. Set `PORT` to change it, and `DATA_DIR` to point at a different data directory. For development, run `npm run dev`.

## Dependencies

- `express`: HTTP server and routing
- `multer`: parses `multipart/form-data` uploads and enforces the 32MB cap
- `archiver`: streams the per-tag zip download
- `tsx`: runs the TypeScript source directly

## Themes

The front-end ships two stylesheets, `public/styleA.css` and `public/styleB.css`. Theme A loads by default. The `[change theme]` button beside the title swaps the active stylesheet at runtime, and the choice is stored in `localStorage` under `smal.theme` (`a` or `b`).

Both stylesheets define the same custom properties on `:root` (`--fg`, `--muted`, `--bg`, `--panel`, `--line`, `--accent`, `--link`), each with a light and a dark variant, so adding a theme means providing those variables and registering it in `THEMES` in `public/app.js`.

## Configuration

Users and auth keys are stored in `data/auth.json`:

```json
{
  "cooluser": "abc123"
}
```

The JSON key is the username and the value is that user's auth key. The `useradd` entry is reserved for authorizing user creation.

Valid tags are stored in `data/tags.txt`, one per line:

```
music
speech
field-recording
```

Deactivated tags are stored in `data/tags-inactive.txt`. Tags in that file are not valid for uploads until reactivated.

Blank lines are ignored. A tag must also be a valid path segment, so tag names containing `/`, `\`, control characters, `.` or `..` cannot be used.

## Access

Several GET routes require an auth key as `?key=<authKey>`. 

All POST routes requite `authKey` in the body.

## Endpoints

- `GET /api/v1`: API index
- `GET /api/v1/ls`: list files
- `GET /api/v1/ls/tags`: list tags
- `GET /api/v1/ls/filter-tags`: list active and inactive tags for filters
- `GET /api/v1/ls/users`: list users
- `PUT /api/v1/tag`: add or reactivate a tag
- `POST /api/v1/auth`: validate a username and key
- `POST /api/v1/up`: upload a file
- `GET /api/v1/dl/:tag`: download a zip of files in a tag
- `GET /api/v1/dl/:tag/:username/:track`: download a file
- `DELETE /api/v1/rm/:tag`: deactivate a tag
- `DELETE /api/v1/rm/:tag/:username/:track`: delete a file
- `POST /api/v1/useradd`: add a user

File paths are three URL-encoded segments: tag, username, track filename.

### `GET /api/v1`

Returns a JSON index of the API. 

This lists every endpoint with its method, path, description, and request body fields where applicable.

```sh
curl http://localhost:3000/api/v1
```

### `GET /api/v1/ls`

Lists files by newest first. 

Size and creation time come from the filesystem.

```sh
curl 'http://localhost:3000/api/v1/ls?key=admin'
```

```json
[
  {
    "id": "music/cooluser/track one.wav",
    "tag": "music",
    "username": "cooluser",
    "track": "track one.wav",
    "mimeType": "audio/wav",
    "size": 8,
    "createdAt": "2026-10-27T10:12:15.011Z"
  }
]
```

`id` is the decoded relative path. 

Note: URL-encode each segment when calling the other endpoints.

### `GET /api/v1/ls/tags`

Returns the tag list as a JSON array.

```sh
curl http://localhost:3000/api/v1/ls/tags
```

### `GET /api/v1/ls/filter-tags`

Returns active and inactive tags as a JSON array for the file filters. This does
not make inactive tags available for uploads.

### `PUT /api/v1/tag`

Adds a tag or reactivates an inactive tag. Requires the admin auth key as `?key=<authKey>`.

Returns `201` for a new tag, `200` for a reactivated tag, and `409` if the tag is already active.

```sh
curl -X PUT \
     -H 'Content-Type: application/json' \
     -d '{"tag":"new-tag"}' \
     'http://localhost:3000/api/v1/tag?key=admin'
```

### `DELETE /api/v1/rm/:tag`

Deactivates a tag by moving it from `tags.txt` to `tags-inactive.txt`. Requires the admin auth key as `?key=<authKey>`.

Returns `204` on success or `404` if the tag is not active.

```sh
curl -X DELETE 'http://localhost:3000/api/v1/rm/new-tag?key=admin'
```

### `GET /api/v1/ls/users`

Returns the usernames in `auth.json` as a sorted JSON array. 

Note: The reserved `useradd` entry is excluded.

```sh
curl 'http://localhost:3000/api/v1/ls/users?key=admin'
```

### `POST /api/v1/auth`

Validates a username and key. 

Returns `200` with `{ "username": "..." }` or `401` if the pair is wrong.

```sh
curl -X POST \
     -H 'Content-Type: application/json' \
     -d '{"username":"cooluser","authKey":"abc123"}' \
     http://localhost:3000/api/v1/auth
```

### `POST /api/v1/up`

Uploads a file. 

Multipart form data. 

Returns `201` with `{ "id": "..." }`.

The track name is the uploaded file's name. 

Note: Uploading the same tag, username and filename again overwrites the existing file.

| Field      | Limits                                |
| ---------- | ------------------------------------- |
| `authKey`  | must match `username` in `auth.json`  |
| `username` | 64 characters max                     |
| `tag`      | 64 characters max, must exist in tags |
| `file`     | wav, mp3, flac or ogg; 32MB max       |

The file's name must be one safe path segment.

No `/`, `\`, control characters, `.` or `..`, and no more than 255 bytes. 

All fields are required.

```sh
curl -F authKey=abc123 \
     -F username=cooluser \
     -F tag=music \
     -F 'file=@track.mp3;filename=my track.mp3' \
     http://localhost:3000/api/v1/up
```

```json
{ "id": "music/cooluser/my track.mp3" }
```

### `GET /api/v1/dl/:tag`

Returns a zip of files in the tag, keeping the `username/track` directory structure. 

The response is streamed. Symlinks and other non-regular files are skipped. 

A tag with no matching files returns an empty zip; an unknown tag returns `404`.

```sh
curl -o music.zip 'http://localhost:3000/api/v1/dl/music?key=admin'
```

### `GET /api/v1/dl/:tag/:username/:track`

Returns the audio file with its content type.

```sh
curl -o out.wav 'http://localhost:3000/api/v1/dl/music/cooluser/track%20one.wav?key=admin'
```

### `DELETE /api/v1/rm/:tag/:username/:track`

Deletes a file. 

JSON body needs an `authKey`. 

Returns `204` on success. 

Note: Empty directories are left in place.

```sh
curl -X DELETE \
     -H 'Content-Type: application/json' \
     -d '{"authKey":"abc123"}' \
     'http://localhost:3000/api/v1/rm/music/cooluser/my%20track.mp3'
```

### `POST /api/v1/useradd`

Adds a user to `auth.json`. 

Before writing, the current file is copied to the next free `auth.json.bak<n>` in the data directory. 

Returns `201`.

An existing username returns `409`.

```sh
curl -X POST \
     -H 'Content-Type: application/json' \
     -d '{"key":"specialkey","username":"newuser","userkey":"newkey"}' \
     http://localhost:3000/api/v1/useradd
```

```json
{ "username": "newuser", "backup": "auth.json.bak1" }
```

## Errors

Errors are returned as JSON:

```json
{ "error": "message" }
```

- `400` invalid or missing field, or invalid path segment
- `401` bad auth key
- `403` not allowed
- `404` unknown file
- `409` username already exists
- `413` file too large
