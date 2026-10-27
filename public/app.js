const filesEl = document.querySelector("#files");
const filtersEl = document.querySelector("#filters");
const statusEl = document.querySelector("#status");
const form = document.querySelector("#upload-form");
const authForm = document.querySelector("#auth-form");
const tagSelect = document.querySelector("#tag-select");
const usernameInput = document.querySelector("#username");
const authKeyInput = document.querySelector("#authKey");
const fileInput = document.querySelector("#file");
const refreshButton = document.querySelector("#refresh");
const listenSection = document.querySelector("#listen-section");
const authStatus = document.querySelector("#auth-status");
const clearAuthButton = document.querySelector("#clear-auth");
const uploadSection = document.querySelector("#upload-section");
const template = document.querySelector("#file-template");

const state = {
  files: [],
  tags: [],
  tag: "all",
  username: null,
  authKey: null,
  isAdmin: false,
};

function setAdmin(username) {
  state.username = username;
  state.authKey = username ? authKeyInput.value : null;
  state.isAdmin = username === "admin";
  authStatus.textContent = username ? "[yes authorized]" : "[not authorized]";
  listenSection.hidden = !username;
  uploadSection.hidden = state.isAdmin;
  if (!username) {
    state.files = [];
    filesEl.replaceChildren();
  }
}

const STORAGE_USER = "smal.username";
const STORAGE_KEY = "smal.authKey";

function restoreCredentials() {
  try {
    const username = localStorage.getItem(STORAGE_USER);
    const authKey = localStorage.getItem(STORAGE_KEY);
    if (username) usernameInput.value = username;
    if (authKey) authKeyInput.value = authKey;
  } catch {
    // storage is unavailable
  }
}

function saveCredentials() {
  try {
    localStorage.setItem(STORAGE_USER, usernameInput.value.trim());
    localStorage.setItem(STORAGE_KEY, authKeyInput.value);
  } catch {
    // storage is unavailable
  }
}

function segment(value) {
  return encodeURIComponent(value);
}

function withKey(path) {
  return state.authKey ? `${path}?key=${encodeURIComponent(state.authKey)}` : path;
}

function fileUrl(file) {
  return withKey(
    `/api/v1/dl/${segment(file.tag)}/${segment(file.username)}/${segment(file.track)}`
  );
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.error) message = body.error;
    } catch {
      // response was not JSON
    }
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }
  return res;
}

function setStatus(message, error = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

function renderFilters() {
  filtersEl.replaceChildren();

  const all = document.createElement("button");
  all.type = "button";
  all.textContent = "all";
  all.classList.toggle("active", state.tag === "all");
  all.addEventListener("click", () => {
    state.tag = "all";
    renderFilters();
    renderFiles();
  });
  filtersEl.append(all);

  for (const tag of state.tags) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tag;
    button.classList.toggle("active", state.tag === tag);
    button.addEventListener("click", () => {
      state.tag = tag;
      renderFilters();
      renderFiles();
    });
    filtersEl.append(button);
  }

  if (state.tag !== "all") {
    const zip = document.createElement("a");
    zip.href = withKey(`/api/v1/dl/${segment(state.tag)}`);
    zip.textContent = "download zip";
    filtersEl.append(zip);
  }
}

function renderFiles() {
  filesEl.replaceChildren();

  const visible =
    state.tag === "all" ? state.files : state.files.filter((file) => file.tag === state.tag);

  if (visible.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "no files.";
    filesEl.append(empty);
    return;
  }

  for (const file of visible) {
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector(".track").textContent = file.track;
    node.querySelector(".meta").textContent = [
      file.tag,
      file.username,
      formatSize(file.size),
      formatDate(file.createdAt),
    ].join(" / ");

    const url = fileUrl(file);
    const audio = node.querySelector("audio");
    audio.src = url;

    const download = node.querySelector(".download");
    download.href = url;

    node.querySelector(".delete").addEventListener("click", () => removeFile(file));
    filesEl.append(node);
  }
}

async function loadFiles() {
  const res = await api(withKey("/api/v1/ls"));
  state.files = await res.json();
  renderFiles();
}

async function loadTags() {
  const res = await api("/api/v1/ls/tags");
  state.tags = await res.json();

  tagSelect.replaceChildren();
  for (const tag of state.tags) {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    tagSelect.append(option);
  }

  renderFilters();
}

async function removeFile(file) {
  const fromForm = authKeyInput.value.trim();
  const authKey = state.authKey || fromForm || prompt(`auth key for ${file.username}:`);
  if (!authKey) return;

  if (!confirm(`delete "${file.track}"?`)) return;

  try {
    await api(`/api/v1/rm/${segment(file.tag)}/${segment(file.username)}/${segment(file.track)}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authKey }),
    });
    setStatus(`deleted ${file.track}`);
    await loadFiles();
  } catch (err) {
    setStatus(`delete failed: ${err.message}`, true);
  }
}

function authFailure(message) {
  setStatus(message, true);
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = authForm.querySelector('button[type="submit"]');
  button.disabled = true;
  setStatus("authenticating...");

  const username = usernameInput.value.trim();
  const authKey = authKeyInput.value;

  try {
    await api("/api/v1/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, authKey }),
    });
    saveCredentials();
    setAdmin(username);
    setStatus(`authenticated as ${username}`);
    if (state.username) {
      try {
        await loadFiles();
      } catch (err) {
        authFailure(`authenticated as ${username}, but could not load files: ${err.message}`);
      }
    }
  } catch (err) {
    setAdmin(null);
    if (err.status !== 401) {
      authFailure(`auth failed: ${err.message}`);
      return;
    }

    const addKey = prompt(
      `unknown username or key for "${username}".\n\n` +
        "enter the useradd key to create the account:"
    );
    if (!addKey) {
      authFailure("authentication cancelled.");
      return;
    }

    try {
      await api("/api/v1/useradd", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: addKey, username, userkey: authKey }),
      });
      saveCredentials();
      setAdmin(username);
      setStatus(`created account ${username}`);
      if (state.username) {
        try {
          await loadFiles();
        } catch (loadErr) {
          authFailure(`created account ${username}, but could not load files: ${loadErr.message}`);
        }
      }
    } catch (createErr) {
      authFailure(`account creation failed: ${createErr.message}`);
    }
  } finally {
    button.disabled = false;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  setStatus("uploading...");

  try {
    const username = usernameInput.value.trim();
    const data = new FormData();
    data.append("username", username);
    data.append("authKey", authKeyInput.value);
    data.append("tag", tagSelect.value);
    data.append("file", fileInput.files[0]);

    const res = await api("/api/v1/up", { method: "POST", body: data });
    const body = await res.json();
    saveCredentials();
    setStatus(`uploaded ${body.id}`);
    alert(`uploaded ${body.id}`);
    fileInput.value = "";
    if (state.username) await loadFiles();
  } catch (err) {
    setStatus(`upload failed: ${err.message}`, true);
    alert(`upload failed: ${err.message}`);
  } finally {
    button.disabled = false;
  }
});

refreshButton.addEventListener("click", async () => {
  try {
    await loadTags();
    if (state.username) await loadFiles();
    setStatus("refreshed.");
  } catch (err) {
    setStatus(`refresh failed: ${err.message}`, true);
  }
});

clearAuthButton.addEventListener("click", () => {
  if (!confirm("clear saved username and key?")) return;

  try {
    localStorage.removeItem(STORAGE_USER);
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage is unavailable
  }

  usernameInput.value = "";
  authKeyInput.value = "";
  setAdmin(null);
  setStatus("cleared saved credentials.");
});

restoreCredentials();

try {
  await loadTags();
} catch (err) {
  setStatus(`failed to load: ${err.message}`, true);
}

if (usernameInput.value.trim() && authKeyInput.value) {
  try {
    const res = await api("/api/v1/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: usernameInput.value.trim(),
        authKey: authKeyInput.value,
      }),
    });
    const body = await res.json();
    setAdmin(body.username);
    if (state.username) await loadFiles();
  } catch {
    setAdmin(null);
  }
} else {
  setAdmin(null);
}
