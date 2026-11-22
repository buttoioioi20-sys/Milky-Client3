const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const path = require("path"), fs = require("fs");
const { Auth } = require("msmc");
const { Client } = require("minecraft-launcher-core");
const AdmZip = require("adm-zip");

const ROOT = path.join(app.getPath("userData"), "milky");
const PROFILES = path.join(ROOT, "profiles"), SKINS = path.join(ROOT, "skins");
const UA = { "User-Agent": "MilkyClient/0.1 (open-source launcher)" };
// Installed into every new profile automatically:
const BASE = ["fabric-api", "sodium", "lithium", "ferrite-core", "immediatelyfast", "moreculling", "dynamic-fps", "modernfix"];
let win, mc = null; // Minecraft session lives in memory only, never written to disk

const cfgFile = path.join(ROOT, "config.json");
const cfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile)); } catch { return { profiles: [], memory: 4 }; } };
const save = c => { fs.mkdirSync(ROOT, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(c, null, 2)); };
const log = m => win && win.webContents.send("log", String(m));
const h = (n, fn) => ipcMain.handle(n, (_, ...a) => fn(...a));

const j = async (u, o) => { const r = await fetch(u, { headers: UA, ...o }); if (!r.ok) throw new Error(u + " -> " + r.status); return r.json(); };
const dl = async (u, f) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(u + " -> " + r.status);
  fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
};

async function addMod(p, slug, seen = new Set()) {
  if (seen.has(slug)) return; seen.add(slug);
  const q = new URLSearchParams({ game_versions: JSON.stringify([p.mc]), loaders: JSON.stringify(["fabric"]) });
  const v = await j(`https://api.modrinth.com/v2/project/${slug}/version?${q}`);
  if (!v.length) { log(`Skipped ${slug}: no Fabric build for ${p.mc}`); return; }
  const f = v[0].files.find(x => x.primary) || v[0].files[0];
  await dl(f.url, path.join(PROFILES, p.name, "mods", f.filename));
  log(`Installed ${f.filename}`);
  for (const d of v[0].dependencies || []) if (d.dependency_type === "required" && d.project_id) await addMod(p, d.project_id, seen);
}

async function fabric(mcv) {
  let arr = []; try { arr = await j(`https://meta.fabricmc.net/v2/versions/loader/${mcv}`); } catch {}
  if (!arr.length) return null; // no Fabric for this version (e.g. pre-1.14): play vanilla
  const lv = arr[0].loader.version;
  const id = `fabric-loader-${lv}-${mcv}`;
  const f = path.join(ROOT, "game", "versions", id, id + ".json");
  if (!fs.existsSync(f)) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(await j(`https://meta.fabricmc.net/v2/versions/loader/${mcv}/${lv}/profile/json`)));
  }
  return id;
}

h("login", async () => {
  const x = await new Auth("select_account").launch("electron");
  mc = await x.getMinecraft();
  return { name: mc.profile.name, uuid: mc.profile.id };
});
h("logout", () => { mc = null; });
h("state", () => cfg());
h("setJava", p => { const c = cfg(); c.java = String(p).trim(); save(c); });
h("versions", async snaps => {
  const m = await j("https://launchermeta.mojang.com/mc/game/version_manifest_v2.json");
  return m.versions.filter(v => v.type === "release" || (snaps && v.type === "snapshot")).map(v => v.id);
});
h("setMem", g => { const c = cfg(); c.memory = g; save(c); });

h("profile:create", async (name, mcv) => {
  const c = cfg(); name = name.replace(/[^\w .-]/g, "").trim();
  if (!name || c.profiles.find(p => p.name === name)) throw new Error("Pick a unique profile name");
  const p = { name, mc: mcv }; fs.mkdirSync(path.join(PROFILES, name, "mods"), { recursive: true });
  c.profiles.push(p); save(c);
  if (await fabric(mcv)) { const seen = new Set(); for (const s of BASE) await addMod(p, s, seen); }
  else log(`Fabric doesn't support ${mcv}, so this is a vanilla profile (no mods).`);
  return c.profiles;
});
h("profile:delete", name => { const c = cfg(); c.profiles = c.profiles.filter(p => p.name !== name); save(c); fs.rmSync(path.join(PROFILES, name), { recursive: true, force: true }); return c.profiles; });
h("profile:open", name => shell.openPath(path.join(PROFILES, name)));

h("mods:search", async (q, mcv) => {
  const f = JSON.stringify([["project_type:mod"], ["categories:fabric"], ["versions:" + mcv]]);
  return (await j(`https://api.modrinth.com/v2/search?limit=20&query=${encodeURIComponent(q)}&facets=${encodeURIComponent(f)}`)).hits
    .map(x => ({ slug: x.slug, title: x.title, desc: x.description, icon: x.icon_url, dl: x.downloads }));
});
h("mods:add", async (name, slug) => { const p = cfg().profiles.find(x => x.name === name); await addMod(p, slug); });
h("mods:list", name => { const d = path.join(PROFILES, name, "mods"); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => /\.jar(\.disabled)?$/.test(f)) : []; });
h("mods:toggle", (name, f) => { const d = path.join(PROFILES, name, "mods"); fs.renameSync(path.join(d, f), path.join(d, f.endsWith(".disabled") ? f.slice(0, -9) : f + ".disabled")); });
h("mods:remove", (name, f) => fs.rmSync(path.join(PROFILES, name, "mods", f)));

h("pack:import", async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: "Modrinth modpack", extensions: ["mrpack"] }] });
  if (r.canceled) return cfg().profiles;
  const zip = new AdmZip(r.filePaths[0]), idx = JSON.parse(zip.readAsText("modrinth.index.json"));
  if (!idx.dependencies["fabric-loader"]) throw new Error("Only Fabric modpacks are supported right now");
  const c = cfg(); let name = idx.name.replace(/[^\w .-]/g, "").trim(), n = name, i = 2;
  while (c.profiles.find(p => p.name === n)) n = name + " " + i++;
  const dir = path.join(PROFILES, n); c.profiles.push({ name: n, mc: idx.dependencies.minecraft }); save(c);
  for (const f of idx.files) {
    if (f.env && f.env.client === "unsupported") continue;
    const dest = path.resolve(dir, f.path); if (!dest.startsWith(dir)) continue; // block path traversal
    await dl(f.downloads[0], dest); log("Downloaded " + f.path);
  }
  for (const e of zip.getEntries()) {
    const m = e.entryName.match(/^(client-)?overrides\/(.+)/); if (!m || e.isDirectory) continue;
    const dest = path.resolve(dir, m[2]); if (dest.startsWith(dir)) { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, e.getData()); }
  }
  return cfg().profiles;
});

h("launch", async name => {
  if (!mc) throw new Error("Sign in first");
  const p = cfg().profiles.find(x => x.name === name), id = await fabric(p.mc), l = new Client();
  l.on("debug", log); l.on("data", log);
  l.on("progress", e => log(`Downloading ${e.type} ${e.task}/${e.total}`));
  l.on("close", () => log("Game closed"));
  await l.launch({
    authorization: mc.mclc(), root: path.join(ROOT, "game"),
    version: id ? { number: p.mc, type: "release", custom: id } : { number: p.mc, type: "release" },
    javaPath: cfg().java || "java",
    memory: { max: cfg().memory + "G", min: "1G" },
    overrides: { gameDirectory: path.join(PROFILES, p.name) }
  });
});

h("skin:list", () => fs.existsSync(SKINS) ? fs.readdirSync(SKINS).map(f => ({ name: f, data: "data:image/png;base64," + fs.readFileSync(path.join(SKINS, f)).toString("base64") })) : []);
h("skin:add", async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: "Skin PNG", extensions: ["png"] }] });
  if (r.canceled) return; fs.mkdirSync(SKINS, { recursive: true });
  fs.copyFileSync(r.filePaths[0], path.join(SKINS, path.basename(r.filePaths[0])));
});
h("skin:apply", async (file, variant) => {
  if (!mc) throw new Error("Sign in first");
  const fd = new FormData(); fd.append("variant", variant);
  fd.append("file", new Blob([fs.readFileSync(path.join(SKINS, path.basename(file)))], { type: "image/png" }), "skin.png");
  const r = await fetch("https://api.minecraftservices.com/minecraft/profile/skins", { method: "POST", headers: { Authorization: "Bearer " + mc.mclc().access_token }, body: fd });
  if (!r.ok) throw new Error("Skin upload failed (" + r.status + ")");
});

app.whenReady().then(() => {
  win = new BrowserWindow({ width: 1100, height: 700, minWidth: 900, minHeight: 600, backgroundColor: "#14161b", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false } });
  win.loadFile("index.html");
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
});
app.on("window-all-closed", () => app.quit());
