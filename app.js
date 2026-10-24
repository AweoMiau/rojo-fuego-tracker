"use strict";
// Tracker de Rojo Fuego y Verde Hoja: lee el datos.json de cada juego del repo privado de
// saves (lo genera la acción de GitHub con cada save) y edita sus objetivos en ese mismo repo.

const REPO_POR_DEFECTO = "AweoMiau/pokemon-rojo-fuego-saves";
const CLAVES = {token: "rf-token", repo: "rf-repo", datos: "rf-datos", etag: "rf-etag", vista: "rf-vista", juego: "rf-juego"};
// Cada juego: dónde está su datos.json y su archivo de objetivos en el repo.
const JUEGOS = {
  rojo:  {nombre: "Rojo Fuego", otra: "Verde Hoja", json: "tracker/datos.json",       objetivos: "objetivos.toml"},
  verde: {nombre: "Verde Hoja", otra: "Rojo Fuego", json: "tracker/verde/datos.json", objetivos: "objetivos_verde.toml"},
};
const guardado = {
  get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} },
  del: k => { try { localStorage.removeItem(k); } catch (e) {} },
};

let DATA = null;      // tracker/datos.json
let JUEGO = null;     // juego.json (solo para el formulario de objetivos)
let pendiente = null; // objetivos guardados desde aquí que GitHub todavía no evalúa
let porNombre = {};

// Colores clásicos de los tipos; el texto va en blanco u oscuro según el fondo.
const TIPOS = {
  "Normal":["#A8A878","#1f1f14"],"Fuego":["#F08030","#2a1305"],"Agua":["#6890F0","#fff"],"Planta":["#78C850","#14250b"],
  "Eléctrico":["#F8D030","#2a2305"],"Hielo":["#98D8D8","#10282a"],"Lucha":["#C03028","#fff"],"Veneno":["#A040A0","#fff"],
  "Tierra":["#E0C068","#2a2210"],"Volador":["#A890F0","#1a1430"],"Psíquico":["#F85888","#fff"],"Bicho":["#A8B820","#1d2205"],
  "Roca":["#B8A038","#221d08"],"Fantasma":["#705898","#fff"],"Dragón":["#7038F8","#fff"],"Siniestro":["#705848","#fff"],
  "Acero":["#B8B8D0","#1d1d2a"],"???":["#68A090","#fff"]
};
// En 3.ª gen la categoría depende del tipo, no del movimiento.
const FISICOS = new Set(["Normal","Lucha","Volador","Veneno","Tierra","Roca","Bicho","Fantasma","Acero"]);
const STATS = ["PS","Atq","Def","Vel","AtE","DfE"];   // orden del juego
const ORDEN = [0,1,2,4,5,3];                          // orden en que se muestran
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const typeVars = t => { const c = TIPOS[t] || TIPOS["???"]; return `--tc:${c[0]};--tt:${c[1]}`; };
const juegoActivo = () => JUEGOS[guardado.get(CLAVES.juego)] ? guardado.get(CLAVES.juego) : "rojo";
const J = () => JUEGOS[juegoActivo()];
// La caché de Rojo Fuego conserva sus claves de siempre; las de otros juegos llevan sufijo.
const claveDe = k => juegoActivo() === "rojo" ? CLAVES[k] : `${CLAVES[k]}-${juegoActivo()}`;
const iniciales = nombre => nombre.split(" ").map(p => p[0]).join("");
const typeChip = t => `<span class="type" style="${typeVars(t)}">${esc(t)}</span>`;
const sprite = n => n ? `<img class="spr" src="sprites/${n}.png" alt="" width="64" height="64" loading="lazy">` : "";
const sumaIV = p => p.iv.reduce((a, b) => a + b, 0);
const hora = () => new Date().toLocaleTimeString("es-CL", {hour: "2-digit", minute: "2-digit", hour12: false});

function toast(texto){
  const t = $("#toast"); t.textContent = texto; t.hidden = false;
  clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, 4000);
}

/* ---------- GitHub ---------- */

const repo = () => guardado.get(CLAVES.repo) || REPO_POR_DEFECTO;
function api(ruta, {method = "GET", headers = {}, body} = {}, token = guardado.get(CLAVES.token), nombreRepo = repo()){
  const url = `https://api.github.com/repos/${nombreRepo}/contents/${ruta.split("/").map(encodeURIComponent).join("/")}`;
  return fetch(url, {method, body, cache: "no-store", headers: {
    Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", ...headers}});
}
function errorGitHub(status){
  if (status === 401) return "GitHub rechazó el token: revisa que esté bien copiado y que no haya vencido.";
  if (status === 403) return "El token no tiene permiso para esto. Necesita «Contents: Read and write» en el repo de los saves.";
  if (status === 404) return "No encontré el repo o el archivo. Revisa el nombre del repo y que el token tenga acceso a él.";
  if (status === 409 || status === 422) return "El archivo cambió en GitHub mientras editabas. Vuelve a intentarlo.";
  return `GitHub respondió con un error (${status}). Intenta de nuevo en un rato.`;
}
const aBase64 = texto => btoa(String.fromCharCode(...new TextEncoder().encode(texto)));
const deBase64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));

function estado(texto, ocupado = false){
  $("#t-estado").textContent = texto;
  $("#btn-refresh").classList.toggle("busy", ocupado);
}

let cargando = false;
async function cargarDatos(manual = false){
  if (cargando || !guardado.get(CLAVES.token)) return;
  cargando = true; ultimaRevision = Date.now(); estado("Buscando…", true);
  try {
    const juego = juegoActivo();
    const etag = DATA ? guardado.get(claveDe("etag")) : null;
    const r = await api(J().json, {headers: {
      Accept: "application/vnd.github.raw+json", ...(etag ? {"If-None-Match": etag} : {})}});
    if (r.status === 304) {
      estado(`Al día · ${hora()}`);
      if (manual) toast("No hay un save nuevo.");
      return;
    }
    if (!r.ok) {
      estado("Error al leer GitHub");
      if (manual || !DATA) toast(errorGitHub(r.status));
      return;
    }
    const texto = await r.text();
    if (juego !== juegoActivo()) return;  // se cambió de juego mientras se descargaba
    const nuevo = JSON.parse(texto);
    const antes = DATA?.save?.fecha;
    DATA = nuevo;
    guardado.set(claveDe("datos"), texto);
    guardado.set(claveDe("etag"), r.headers.get("ETag") || "");
    renderTodo();
    estado(`Al día · ${hora()}`);
    if (antes && nuevo.save && nuevo.save.fecha !== antes) toast(`Save nuevo: «${nuevo.save.mensaje}»`);
  } catch (e) {
    estado("Sin conexión");
    if (manual) toast("No pude conectarme a GitHub. ¿Hay internet?");
  } finally {
    cargando = false;
    $("#btn-refresh").classList.remove("busy");
  }
}

// Revisa si hay datos nuevos al volver a la app y cada 30 s mientras está a la vista
// (cada 8 s justo después de guardar objetivos, mientras GitHub los evalúa).
let rapidoHasta = 0, ultimaRevision = 0;
setInterval(() => {
  if (document.hidden) return;
  const ahora = Date.now();
  if (ahora < rapidoHasta || ahora - ultimaRevision >= 30000) cargarDatos();
}, 8000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) cargarDatos(); });
$("#btn-refresh").addEventListener("click", () => cargarDatos(true));

/* ---------- Conexión (token) ---------- */

function mostrarSetup(ajustes = false, error = ""){
  document.body.classList.add("setup");
  VISTAS.forEach(x => { $("#v-" + x).hidden = true; });
  $("#v-setup").hidden = false;
  $("#in-repo").value = repo();
  $("#in-token").value = "";
  $("#in-token").placeholder = ajustes ? "Token guardado (pega uno nuevo para cambiarlo)" : "github_pat_…";
  $("#in-token").required = !ajustes;
  $("#btn-cancelar-setup").hidden = !ajustes;
  $("#setup-extra").hidden = !ajustes;
  $("#setup-err").hidden = !error; $("#setup-err").textContent = error;
  window.scrollTo({top: 0});
}
function salirSetup(){
  document.body.classList.remove("setup");
  $("#v-setup").hidden = true;
  mostrar(guardado.get(CLAVES.vista) || "equipo");
}
$("#btn-ajustes").addEventListener("click", () => mostrarSetup(!!guardado.get(CLAVES.token)));
$("#btn-cancelar-setup").addEventListener("click", salirSetup);
$("#btn-desconectar").addEventListener("click", () => {
  Object.values(CLAVES).forEach(k => { guardado.del(k); Object.keys(JUEGOS).forEach(j => guardado.del(`${k}-${j}`)); });
  DATA = null; renderTodo(); mostrarSetup(false);
});
$("#f-setup").addEventListener("submit", async e => {
  e.preventDefault();
  const token = $("#in-token").value.trim() || guardado.get(CLAVES.token);
  const nombreRepo = $("#in-repo").value.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, "");
  const boton = $("#btn-conectar"); boton.disabled = true; boton.textContent = "Conectando…";
  $("#setup-err").hidden = true;
  try {
    const r = await api("tracker/datos.json", {headers: {Accept: "application/vnd.github.raw+json"}}, token, nombreRepo);
    if (!r.ok) throw new Error(errorGitHub(r.status));
    const texto = await r.text();
    DATA = JSON.parse(texto);
    guardado.set(CLAVES.token, token); guardado.set(CLAVES.repo, nombreRepo);
    guardado.set(CLAVES.juego, "rojo");
    guardado.set(CLAVES.datos, texto); guardado.set(CLAVES.etag, r.headers.get("ETag") || "");
    renderTodo(); estado(`Al día · ${hora()}`); salirSetup();
    toast("Conectado. Los datos se actualizan solos con cada save.");
  } catch (err) {
    $("#setup-err").textContent = err instanceof TypeError ? "No pude conectarme a GitHub. ¿Hay internet?" : err.message;
    $("#setup-err").hidden = false;
  } finally {
    boton.disabled = false; boton.textContent = "Conectar";
  }
});

/* ---------- Pokémon (equipo, PC y fichas) ---------- */

function moveCard(m){
  const cat = m.estado ? "Estado" : (FISICOS.has(m.tipo) ? "Físico" : "Especial");
  const det = [cat, m.poder ? `Pot ${m.poder}` : null, m.precision ? `${m.precision}%` : null, m.pp ? `${m.pp} PP` : null]
    .filter(Boolean).join(" · ");
  return `<div class="move" style="${typeVars(m.tipo)}"><b>${esc(m.nombre)}</b><span>${esc(m.tipo)} · ${det}</span></div>`;
}

function statsGrid(p){
  const n = p.naturaleza;
  let h = `<div class="stats"><span class="hd">Stat</span><span class="hd num">${p.stats ? "Valor" : ""}</span><span class="hd">IV</span><span></span><span class="hd">EV</span>`;
  for (const i of ORDEN){
    const cls = i === n.sube ? "up" : i === n.baja ? "down" : "";
    const marca = i === n.sube ? " <small>▲</small>" : i === n.baja ? " <small>▼</small>" : "";
    const iv = p.iv[i];
    const nivel = iv === 31 ? "max" : iv >= 25 ? "hi" : "";
    h += `<span class="lab ${cls}">${STATS[i]}${marca}</span>
      <span class="num">${p.stats ? p.stats[i] : ""}</span>
      <span class="ivbar" aria-label="IV ${iv} de 31"><i class="${nivel}" style="width:${(iv / 31 * 100).toFixed(1)}%"></i></span>
      <span class="iv num ${iv === 31 ? "max" : ""}">${iv}</span>
      <span class="ev num">${p.ev[i] ? "+" + p.ev[i] : "—"}</span>`;
  }
  return h + "</div>";
}

function monBody(p){
  const n = p.naturaleza;
  const nat = n.sube == null ? `${esc(n.nombre)} <span style="color:var(--muted)">(neutra)</span>`
    : `${esc(n.nombre)}: <span class="up">+${STATS[n.sube]}</span> <span class="down">−${STATS[n.baja]}</span>`;
  const meta = [
    p.habilidad ? `<span class="pill">Habilidad: ${esc(p.habilidad)}</span>` : "",
    `<span class="pill hp-type" style="${typeVars(p.poder_oculto.tipo)}">Poder Oculto: ${esc(p.poder_oculto.tipo)} ${p.poder_oculto.poder}</span>`,
    `<span class="pill">${p.objeto ? "Lleva " + esc(p.objeto) : "Sin objeto"}</span>`,
    p.origen ? `<span class="pill warn">${esc(p.origen)}</span>` : "",
    p.variocolor ? `<span class="pill warn">✨ Variocolor</span>` : "",
  ].join("");
  return `<div class="nature">Naturaleza ${nat}</div>${statsGrid(p)}
    <div><p class="sec-t">Movimientos</p><div class="moves">${p.movimientos.map(moveCard).join("") || '<span class="empty-msg">Sin movimientos</span>'}</div></div>
    <div class="meta">${meta}</div>
    <button class="btn sm aprende-btn" type="button" data-especie="${p.num}">Qué movimientos aprende ${esc(p.nombre)}</button>`;
}

function monHead(p){
  const hp = p.stats ? `<div class="hp"><span class="num">PS ${p.ps_actual}/${p.stats[0]}</span><span class="track"><i style="width:${(p.ps_actual / p.stats[0] * 100).toFixed(0)}%"></i></span></div>` : "";
  return `<div class="well sm">${sprite(p.num)}</div>
    <div class="mon-info">
      <div class="mon-name"><b>${esc(p.nombre)}</b><span class="lv">Nv ${p.nivel}</span>${p.mote ? `<span class="nick">«${esc(p.mote)}»</span>` : ""}</div>
      <div class="types">${p.tipos.map(typeChip).join("")}</div>${hp}
    </div>
    <div class="ivtot"><div class="v">${sumaIV(p)}</div><div class="k">IV / 186</div></div>`;
}

function renderTeam(){
  $("#team").innerHTML = DATA.equipo.map(p => `<article class="mon">
    <button class="mon-head" type="button" aria-expanded="false">${monHead(p)}
      <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button>
    <div class="mon-body">${monBody(p)}</div></article>`).join("") || '<p class="empty-msg">El equipo está vacío.</p>';
}
$("#team").addEventListener("click", e => {
  const b = e.target.closest(".mon-head"); if (!b) return;
  const a = b.parentElement; a.classList.toggle("open"); b.setAttribute("aria-expanded", a.classList.contains("open"));
});

const sheet = $("#sheet");
function openSheet(html){
  $("#sheet-in").innerHTML = `<div class="grab"></div><button class="close" type="button" aria-label="Cerrar">✕</button>${html}`;
  if (!sheet.open) sheet.showModal();
  $("#sheet-in").scrollTop = 0;
}
sheet.addEventListener("click", e => { if (e.target === sheet || e.target.closest(".close")) sheet.close(); });

function monSheet(p){
  openSheet(`<div class="sheet-top"><div class="well lg">${sprite(p.num)}</div><div class="info">
      <h3>${esc(p.nombre)} <span style="font-family:var(--display);color:var(--muted);font-size:1rem">Nv ${p.nivel}</span></h3>
      ${p.mote ? `<span style="color:var(--muted)">«${esc(p.mote)}»</span>` : ""}
      <div class="types">${p.tipos.map(typeChip).join("")}</div>
      <span class="pill" style="align-self:flex-start">${esc(p.lugar)} · IV ${sumaIV(p)}/186</span></div></div>
    <div class="mon-body">${monBody(p)}</div>`);
}

let cajaActual = 0, ordenIV = false;
function renderBoxes(){
  const cajas = DATA.cajas;
  if (cajaActual >= cajas.length) cajaActual = 0;
  $("#boxes").innerHTML = cajas.map((c, i) =>
    `<button class="chip" type="button" data-i="${i}" aria-pressed="${i === cajaActual}">${esc(c.nombre)}<span class="c">${c.pokemon.length}</span></button>`).join("")
    || '<span class="empty-msg">El PC está vacío.</span>';
  const caja = cajas[cajaActual];
  if (!caja) { $("#box").innerHTML = ""; $("#box-sub").textContent = ""; return; }
  const lista = caja.pokemon.map((p, k) => ({p, k}));
  if (ordenIV) lista.sort((a, b) => sumaIV(b.p) - sumaIV(a.p));
  const mejor = Math.max(...caja.pokemon.map(sumaIV));
  $("#box-sub").textContent = `${caja.pokemon.length} de 30`;
  let h = lista.map(({p, k}) => `<button class="slot" type="button" data-k="${k}" aria-label="${esc(p.nombre)} nivel ${p.nivel}">
      ${sumaIV(p) === mejor ? '<span class="star" title="Mejor IV de la caja">★</span>' : ""}${sprite(p.num)}<span class="l">${p.nivel}</span></button>`).join("");
  for (let i = lista.length; i < 30; i++) h += '<span class="slot empty"></span>';
  $("#box").innerHTML = h;
}
$("#boxes").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; cajaActual = +b.dataset.i; renderBoxes(); });
$("#box").addEventListener("click", e => { const b = e.target.closest(".slot[data-k]"); if (b) monSheet(DATA.cajas[cajaActual].pokemon[+b.dataset.k]); });
function orden(iv){
  ordenIV = iv;
  $("#ord-pc").setAttribute("aria-pressed", !iv); $("#ord-iv").setAttribute("aria-pressed", iv);
  renderBoxes();
}
$("#ord-pc").addEventListener("click", () => orden(false));
$("#ord-iv").addEventListener("click", () => orden(true));

/* ---------- Pokédex ---------- */

const FILTROS = [
  ["todos", "Todos", () => true],
  ["tengo", "Lo tienes", p => p.estado === "tengo"],
  ["registrado", "Registrados que ya no tienes", p => p.estado === "registrado"],
  ["visto", "Vistos", p => p.estado === "visto"],
  ["faltan", "Te faltan", p => p.estado !== "tengo" && p.estado !== "registrado"],
  ["ya", "Evolucionables ya", p => p.grupo === "ya"],
  ["exclusivo", null, p => !!p.exclusivo],  // el título sale del juego: "Rojo Fuego" o "Verde Hoja"
];
let filtro = "todos";
function renderDex(){
  $("#dex-filters").innerHTML = FILTROS.map(([k, t, f]) =>
    `<button class="chip" type="button" data-f="${k}" aria-pressed="${k === filtro}">${t || "Exclusivos de " + esc(otraVersion())}<span class="c">${DATA.pokedex.filter(f).length}</span></button>`).join("");
  const q = $("#dex-q").value.trim().toLowerCase();
  const f = FILTROS.find(x => x[0] === filtro)[2];
  const lista = DATA.pokedex.filter(p => f(p) && (!q || p.nombre.toLowerCase().includes(q) || String(p.num).padStart(3, "0").includes(q)));
  $("#dex").innerHTML = lista.map(p => `<button class="cell ${p.estado}" type="button" data-n="${p.num}" aria-label="${esc(p.nombre)}">
      ${p.exclusivo ? `<span class="vh">${iniciales(otraVersion())}</span>` : ""}<i class="mark ${p.estado}"></i>
      <span class="w">${sprite(p.num)}</span><span class="n">#${String(p.num).padStart(3, "0")}</span><span class="nm">${esc(p.nombre)}</span></button>`).join("")
    || '<p class="empty-msg">Ningún Pokémon coincide.</p>';
}
$("#dex-filters").addEventListener("click", e => { const b = e.target.closest(".chip"); if (!b) return; filtro = b.dataset.f; renderDex(); });
$("#dex-q").addEventListener("input", renderDex);
$("#dex").addEventListener("click", e => { const b = e.target.closest(".cell"); if (b) dexSheet(+b.dataset.n); });

const ESTADO_TXT = {tengo: "Lo tienes", registrado: "Registrado, pero ya no lo tienes", visto: "Visto, sin atrapar", no: "Sin ver todavía"};
function cadena(texto){
  // "Gastly en Torre…; … → Haunter (nivel 25) → Gengar (intercambio) · o directo: …"
  let [principal, directo] = texto.split(" · o directo: ");
  const prefijo = `En ${otraVersion()}: `;
  let vh = false;
  if (principal.startsWith(prefijo)) { vh = true; principal = principal.slice(prefijo.length); }
  if (principal.startsWith("Solo por evento")) return `<p class="how">${esc(principal)}</p>`;
  const partes = principal.split(" → ");
  const [nombre, ...resto] = partes[0].split(" en ");
  let h = `<div class="chain"><div class="step"><span class="w">${sprite(porNombre[nombre])}</span>
    <span class="t"><b>${esc(nombre)}</b>${vh ? esc(prefijo) : ""}${esc(resto.join(" en "))}</span></div>`;
  for (const p of partes.slice(1)){
    const m = p.match(/^(.*) \((.*)\)$/) || [p, p, ""];
    h += `<div class="arrow">↓ ${esc(m[2])}</div><div class="step"><span class="w">${sprite(porNombre[m[1]])}</span><span class="t"><b>${esc(m[1])}</b></span></div>`;
  }
  if (directo) h += `<p class="how" style="margin:0;color:var(--muted)">También salvaje: ${esc(directo)}</p>`;
  return h + "</div>";
}
async function dexSheet(n){
  const p = DATA.pokedex.find(x => x.num === n);
  if (!p) return especieSheet(n);  // fuera de la Pokédex de Kanto (p. ej. de las Islas Sete)
  const mios = [...DATA.equipo, ...DATA.cajas.flatMap(c => c.pokemon)].filter(m => m.num === n);
  let extra = "";
  if (p.grupo === "ya") extra = `<div><p class="sec-t">Lo puedes evolucionar</p><p class="how" style="margin:0">${esc(p.como)}</p></div>`;
  if (p.nota) extra += `<p class="note" style="margin:0">${esc(p.nota)}</p>`;
  const tuyos = mios.length ? `<div><p class="sec-t">Los tuyos</p><div class="meta">${mios.map(m =>
      `<span class="pill">${esc(m.lugar)} · Nv ${m.nivel} · ${esc(m.naturaleza.nombre)} · IV ${sumaIV(m)}</span>`).join("")}</div></div>` : "";
  openSheet(`<div class="sheet-top"><div class="well lg">${sprite(n)}</div><div class="info">
      <span class="num" style="color:var(--muted);font-size:.8rem">#${String(n).padStart(3, "0")}</span>
      <h3>${esc(p.nombre)}</h3><div class="types">${p.tipos.map(typeChip).join("")}</div>
      <span class="pill" style="align-self:flex-start"><i class="mark ${p.estado}"></i>${ESTADO_TXT[p.estado]}</span>
      ${p.exclusivo ? `<span class="pill warn" style="align-self:flex-start">Exclusivo de ${esc(otraVersion())}</span>` : ""}</div></div>
    ${tuyos}${extra}<div><p class="sec-t">Cómo conseguirlo</p>${cadena(p.obtener)}</div>${contenedorMovimientos(n)}`);
  llenarMovimientos(n);
}
async function especieSheet(n){
  openSheet('<p class="loading">Cargando datos del juego…</p>');
  try { await cargarJuego(); } catch (e) { openSheet('<p class="err">No pude cargar los datos del juego. Revisa la conexión e intenta de nuevo.</p>'); return; }
  const e = JUEGO.especies[n];
  if (!e) { openSheet('<p class="err">No tengo datos de ese Pokémon.</p>'); return; }
  openSheet(`<div class="sheet-top"><div class="well lg">${sprite(n)}</div><div class="info">
      <span class="num" style="color:var(--muted);font-size:.8rem">#${String(n).padStart(3, "0")}</span>
      <h3>${esc(e.nombre)}</h3><div class="types">${e.tipos.map(typeChip).join("")}</div></div></div>${contenedorMovimientos(n)}`);
  llenarMovimientos(n);
}

/* ---------- Movimientos que aprende cada especie ---------- */

const categoria = m => m.estado ? "Estado" : m.nombre === "Poder Oculto" ? "Tipo variable"
  : (FISICOS.has(m.tipo) ? "Físico" : "Especial");
let HIJOS = null;  // especie → sus evoluciones directas
function familia(num){
  if (!HIJOS) {
    HIJOS = {};
    for (const [n, e] of Object.entries(JUEGO.especies)) if (e.viene_de) (HIJOS[e.viene_de] ||= []).push(+n);
  }
  let base = String(num);
  while (JUEGO.especies[base]?.viene_de && JUEGO.especies[JUEGO.especies[base].viene_de]) base = JUEGO.especies[base].viene_de;
  const orden = [], cola = [+base];
  while (cola.length){ const n = cola.shift(); orden.push(n); cola.push(...(HIJOS[n] || []).sort((a, b) => a - b)); }
  return orden;
}
function preevoluciones(num){
  const lista = [];
  let actual = JUEGO.especies[num]?.viene_de;
  while (actual && JUEGO.especies[actual]) { lista.push(+actual); actual = JUEGO.especies[actual].viene_de; }
  return lista;
}

// Lo que aprende una especie, agrupado por método y ordenado (nivel, MT/MO, tutor, huevo).
function aprendeDe(num){
  const g = {nivel: [], mt: new Map(), tutor: new Map(), huevo: new Map()};
  for (const [mov, formas] of Object.entries(JUEGO.especies[num].aprende)){
    const m = JUEGO.movimientos[mov]; if (!m) continue;
    for (const [metodo, nivel] of formas){
      if (metodo === "nivel") g.nivel.push({mov, m, nivel});
      else if (g[metodo]) g[metodo].set(mov, {mov, m});
    }
  }
  const porNombreMov = (a, b) => a.m.nombre.localeCompare(b.m.nombre, "es");
  const numeroMt = x => { const t = JUEGO.mt[x.mov] || ""; return (t.startsWith("MO") ? 100 : 0) + (parseInt(t.slice(2), 10) || 0); };
  return {
    nivel: g.nivel.sort((a, b) => a.nivel - b.nivel || porNombreMov(a, b)),
    mt: [...g.mt.values()].sort((a, b) => numeroMt(a) - numeroMt(b)),
    tutor: [...g.tutor.values()].sort(porNombreMov),
    huevo: [...g.huevo.values()].sort(porNombreMov),
  };
}

function filaMov(m, clave, extra = ""){
  // Poder 1 en los datos = poder variable (Poder Oculto, Frustración…).
  const det = [categoria(m), m.poder > 1 ? `Pot ${m.poder}` : null, m.precision ? `${m.precision}%` : null].filter(Boolean).join(" · ");
  return `<li class="lm" style="${typeVars(m.tipo)}"><span class="lm-k num">${clave}</span>
    <span class="lm-n"><b>${esc(m.nombre)}</b><small>${esc(det)}</small></span>${extra}<span class="type">${esc(m.tipo)}</span></li>`;
}

function contenedorMovimientos(n){
  return `<div class="aprende" id="aprende" data-num="${n}"><p class="sec-t">Movimientos</p><p class="loading" style="padding:8px 0">Cargando movimientos…</p></div>`;
}
async function llenarMovimientos(n){
  try { await cargarJuego(); } catch (e) {
    const c = $("#aprende"); if (c) c.innerHTML = '<p class="err">No pude cargar los movimientos. Revisa la conexión.</p>';
    return;
  }
  const c = $("#aprende");
  if (!c || +c.dataset.num !== n || !JUEGO.especies[n]) return;  // se cerró o se abrió otra ficha
  const fam = familia(n);
  const etapas = fam.length > 1 ? `<div class="etapas" role="group" aria-label="Etapa evolutiva">${fam.map(f =>
      `<button type="button" class="etapa" data-etapa="${f}" aria-pressed="${f === n}"><img class="spr" src="sprites/${f}.png" alt="" width="32" height="32" loading="lazy">${esc(JUEGO.especies[f].nombre)}</button>`).join("")}</div>` : "";
  c.innerHTML = `<p class="sec-t">Movimientos</p>${etapas}<div id="aprende-etapa">${movimientosEtapa(n)}</div>`;
}
function movimientosEtapa(num){
  const e = JUEGO.especies[num];
  const g = aprendeDe(num);
  const tuyas = new Set((DATA?.mochila || []).flatMap(b => b.objetos.map(o => o.nombre)));
  let h = `<div class="lm-grupo"><p class="lm-t">Por nivel · ${esc(e.nombre)}</p><ul class="lm-list">${
    g.nivel.map(x => filaMov(x.m, `Nv ${x.nivel}`)).join("") || '<li class="lm-vacio">No aprende nada por nivel.</li>'}</ul></div>`;

  // Lo que aprenden sus preevoluciones por nivel y esta etapa ya no puede aprender de ninguna forma.
  const antes = new Map();
  for (const pre of preevoluciones(num)){
    for (const [mov, formas] of Object.entries(JUEGO.especies[pre].aprende)){
      const m = JUEGO.movimientos[mov];
      if (!m || e.aprende[mov] || antes.has(mov)) continue;
      const nivel = formas.filter(f => f[0] === "nivel" && f[1] > 1).map(f => f[1]).sort((a, b) => a - b)[0];
      if (nivel) antes.set(mov, {m, nivel, de: JUEGO.especies[pre].nombre});
    }
  }
  if (antes.size) h += `<div class="lm-grupo"><p class="lm-t">Solo antes de evolucionar</p>
    <p class="lm-hint">${esc(e.nombre)} no los aprende: hay que enseñárselos a la preevolución antes de evolucionarla.</p>
    <ul class="lm-list">${[...antes.values()].sort((a, b) => a.nivel - b.nivel)
      .map(x => filaMov(x.m, `Nv ${x.nivel}`, `<span class="lm-de">como ${esc(x.de)}</span>`)).join("")}</ul></div>`;

  const tengo = g.mt.filter(x => tuyas.has(JUEGO.mt[x.mov])).length;
  h += `<details class="lm-det"><summary>MT y MO<span class="num">${g.mt.length}${tengo ? ` · ${tengo} en la mochila` : ""}</span></summary>
    <ul class="lm-list">${g.mt.map(x => filaMov(x.m, esc(JUEGO.mt[x.mov] || "MT"),
      tuyas.has(JUEGO.mt[x.mov]) ? '<span class="lm-ok" title="La tienes en la mochila">✓ la tienes</span>' : "")).join("")
      || '<li class="lm-vacio">No puede aprender ninguna MT ni MO.</li>'}</ul></details>`;
  if (g.tutor.length) h += `<details class="lm-det"><summary>Tutor (un solo uso)<span class="num">${g.tutor.length}</span></summary>
    <ul class="lm-list">${g.tutor.map(x => filaMov(x.m, "Tutor")).join("")}</ul></details>`;
  if (g.huevo.length) h += `<details class="lm-det"><summary>Huevo (crianza)<span class="num">${g.huevo.length}</span></summary>
    <ul class="lm-list">${g.huevo.map(x => filaMov(x.m, "Huevo")).join("")}</ul></details>`;
  return h;
}
$("#sheet-in").addEventListener("click", e => {
  const b = e.target.closest(".etapa"); if (!b) return;
  document.querySelectorAll("#aprende .etapa").forEach(x => x.setAttribute("aria-pressed", x === b));
  $("#aprende-etapa").innerHTML = movimientosEtapa(+b.dataset.etapa);
});
// Botones "Qué aprende…" del equipo, el PC y los objetivos.
document.addEventListener("click", e => {
  const b = e.target.closest("[data-especie]"); if (b) dexSheet(+b.dataset.especie);
});

/* ---------- Objetivos ---------- */

const ORDEN_CLAVES = {pokemon: ["especie", "plazo", "naturaleza", "movimientos", "objeto", "nota"],
                      objetos: ["nombre", "cantidad", "plazo", "nota"]};
const CABECERA = [
  "# Objetivos de la partida. El tracker los revisa contra el save y dice qué falta.",
  "# Se pueden editar aquí o desde la página del tracker (pestaña Objetivos).",
  "#",
  "# - Nombres en español, como en el juego (no importan tildes ni mayúsculas).",
  "# - plazo = \"corto\" o \"largo\" (si no se pone, es corto).",
];

// Lector y escritor del subconjunto de TOML que usa objetivos.toml.
function leerToml(texto){
  const config = {pokemon: [], objetos: []};
  const cabecera = [];
  let enCabecera = true, actual = null;
  for (const cruda of texto.split(/\r?\n/)){
    const linea = cruda.trim();
    if (enCabecera && (linea === "" || linea.startsWith("#")) && !/^#?\s*(\[\[|---)/.test(linea)) { cabecera.push(cruda); continue; }
    enCabecera = false;
    if (!linea || linea.startsWith("#")) continue;
    const tabla = linea.match(/^\[\[\s*(\w+)\s*\]\]/);
    if (tabla) { actual = config[tabla[1]] ? {} : null; if (actual) config[tabla[1]].push(actual); continue; }
    const par = linea.match(/^(\w+)\s*=\s*(.+)$/);
    if (!par || !actual) continue;
    const valor = par[2].trim();
    const cadenas = [...valor.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => JSON.parse(`"${m[1]}"`));
    if (valor.startsWith("[")) actual[par[1]] = cadenas;
    else if (valor.startsWith('"')) actual[par[1]] = cadenas[0] ?? "";
    else if (/^-?\d+/.test(valor)) actual[par[1]] = parseInt(valor, 10);
    else if (/^(true|false)/.test(valor)) actual[par[1]] = valor.startsWith("true");
  }
  while (cabecera.length && !cabecera[cabecera.length - 1].trim()) cabecera.pop();
  return {config, cabecera: cabecera.length ? cabecera : CABECERA};
}
function escribirToml(config, cabecera){
  const valor = v => Array.isArray(v) ? `[${v.map(x => JSON.stringify(x)).join(", ")}]` : typeof v === "string" ? JSON.stringify(v) : String(v);
  let out = cabecera.join("\n") + "\n";
  for (const tipo of ["pokemon", "objetos"]) for (const e of config[tipo]){
    out += `\n[[${tipo}]]\n`;
    const claves = [...ORDEN_CLAVES[tipo], ...Object.keys(e).filter(k => !ORDEN_CLAVES[tipo].includes(k))];
    for (const k of claves){
      const v = e[k];
      if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
      out += `${k} = ${valor(v)}\n`;
    }
  }
  return out;
}
const igual = (a, b) => JSON.stringify(ordenado(a)) === JSON.stringify(ordenado(b));
const ordenado = o => o && typeof o === "object" && !Array.isArray(o)
  ? Object.fromEntries(Object.keys(o).sort().map(k => [k, ordenado(o[k])])) : o;

async function leerObjetivosRepo(){
  const r = await api(J().objetivos, {headers: {Accept: "application/vnd.github+json"}});
  if (r.status === 404) return {sha: null, config: {pokemon: [], objetos: []}, cabecera: CABECERA};
  if (!r.ok) throw new Error(errorGitHub(r.status));
  const j = await r.json();
  return {sha: j.sha, ...leerToml(deBase64(j.content))};
}
async function guardarObjetivosRepo(cambio, mensaje){
  const actual = await leerObjetivosRepo();
  cambio(actual.config);  // puede lanzar un Error si el archivo cambió
  const cuerpo = {message: mensaje, content: aBase64(escribirToml(actual.config, actual.cabecera))};
  if (actual.sha) cuerpo.sha = actual.sha;
  const r = await api(J().objetivos, {method: "PUT", headers: {Accept: "application/vnd.github+json"}, body: JSON.stringify(cuerpo)});
  if (!r.ok) throw new Error(errorGitHub(r.status));
  pendiente = {config: actual.config};
  rapidoHasta = Date.now() + 3 * 60 * 1000;
  renderGoals();
}

// Lo que se muestra: los objetivos ya evaluados, o los recién guardados con su evaluación
// cuando ya llegó (si no, "Evaluando…").
function objetivosVisibles(){
  const evaluados = DATA?.objetivos || [];
  if (!pendiente) return evaluados;
  const lista = [];
  let todos = true;
  for (const [clave, tipo] of [["pokemon", "pokemon"], ["objetos", "objeto"]]){
    pendiente.config[clave].forEach((config, indice) => {
      const ev = evaluados.find(o => o.tipo === tipo && o.indice === indice && igual(o.config, config));
      if (ev) lista.push(ev);
      else { todos = false; lista.push({tipo, indice, config, estado: "evaluando", plazo: config.plazo === "largo" ? "largo" : "corto"}); }
    });
  }
  if (todos && evaluados.length === lista.length) pendiente = null;
  return lista;
}

let plazo = "todos";
const ESTADOS = {hecho: "Listo", en_progreso: "En progreso", pendiente: "Pendiente", evaluando: "Evaluando…"};
function chipMovimiento(nombre){
  const m = Object.values(JUEGO?.movimientos || {}).find(x => x.nombre === nombre)
    || DATA.equipo.concat(DATA.cajas.flatMap(c => c.pokemon)).flatMap(p => p.movimientos).find(x => x.nombre === nombre);
  return m ? `<span class="type" style="${typeVars(m.tipo)};text-transform:none">${esc(nombre)}</span>` : `<span class="pill">${esc(nombre)}</span>`;
}
function renderGoals(){
  const todos = objetivosVisibles();
  const lista = todos.filter(o => plazo === "todos" || o.plazo === plazo);
  const editar = o => o.config ? `<div class="goal-actions"><button class="btn sm" type="button" data-editar="${o.tipo}:${o.indice}">Editar</button></div>` : "";
  const card = o => {
    const c = o.config || {};
    if (o.tipo === "pokemon"){
      const nombre = o.nombre || c.especie;
      const num = o.num || porNombre[nombre] || numEspecie(nombre);
      const want = [(o.naturaleza ?? c.naturaleza) ? `<span class="pill">${esc(o.naturaleza ?? c.naturaleza)}</span>` : "",
        ...(o.movimientos || c.movimientos || []).map(chipMovimiento),
        (o.objeto ?? c.objeto) ? `<span class="pill">Con ${esc(o.objeto ?? c.objeto)}</span>` : ""].join("");
      const cand = o.candidato;
      const well = num ? `<button class="well sm" type="button" data-especie="${num}" aria-label="Qué movimientos aprende ${esc(nombre)}">${sprite(num)}</button>`
        : `<div class="well sm"></div>`;
      return `<article class="goal"><div class="goal-top">${well}
          <div class="info"><b>${esc(nombre)}</b>${(o.nota ?? c.nota) ? `<div class="note">${esc(o.nota ?? c.nota)}</div>` : ""}</div>
          <span class="state ${o.estado}">${ESTADOS[o.estado]}</span></div>
        ${want ? `<div class="want">${want}</div>` : ""}
        ${cand ? `<div class="cand">Mejor candidato: ${esc(cand.nombre)} · ${esc(cand.lugar)} · Nv ${cand.nivel} · ${esc(cand.naturaleza)}</div>` : ""}
        ${o.pendientes?.length ? `<ul class="todo">${o.pendientes.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        ${editar(o)}</article>`;
    }
    const tengo = o.tengo ?? 0, quiero = o.quiero ?? c.cantidad ?? 1;
    return `<article class="goal"><div class="itemgoal"><div class="info"><b>${esc(o.nombre || c.nombre)}</b>
        ${o.movimiento ? ` <span style="color:var(--muted);font-size:.85rem">${esc(o.movimiento)}</span>` : ""}
        ${(o.nota ?? c.nota) ? `<div class="note">${esc(o.nota ?? c.nota)}</div>` : ""}
        <div class="prog"><i style="width:${tengo / quiero * 100}%"></i></div></div>
        <span class="num">${tengo}/${quiero}</span><span class="state ${o.estado}">${ESTADOS[o.estado]}</span></div>${editar(o)}</article>`;
  };
  const pk = lista.filter(o => o.tipo === "pokemon"), ob = lista.filter(o => o.tipo === "objeto");
  const avisos = DATA?.avisos?.length ? `<div class="avisos"><b>Hay objetivos que no se entendieron:</b><ul>${DATA.avisos.map(a => `<li>${esc(a)}</li>`).join("")}</ul></div>` : "";
  $("#goals").innerHTML = avisos + ((pk.length ? `<h3 class="gh">Pokémon</h3><div class="goals">${pk.map(card).join("")}</div>` : "")
    + (ob.length ? `<h3 class="gh">Objetos y MT</h3><div class="goals">${ob.map(card).join("")}</div>` : "")
    || `<p class="empty-msg">${todos.length ? "No hay objetivos en este plazo." : "Todavía no tienes objetivos. Toca «+ Agregar» para crear el primero: un Pokémon con la naturaleza, movimientos y objeto que quieres, o un objeto que te falta."}</p>`);
}
$("#seg-plazo").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b) return; plazo = b.dataset.plazo;
  document.querySelectorAll("#seg-plazo button").forEach(x => x.setAttribute("aria-pressed", x === b)); renderGoals();
});
$("#goals").addEventListener("click", e => {
  const b = e.target.closest("[data-editar]"); if (!b) return;
  const [tipo, indice] = b.dataset.editar.split(":");
  const o = objetivosVisibles().find(x => x.tipo === tipo && x.indice === +indice);
  if (o) abrirEditor(o);
});
$("#btn-nuevo").addEventListener("click", () => abrirEditor(null));

/* ---------- Editor de objetivos ---------- */

async function cargarJuego(){
  if (JUEGO) return JUEGO;
  const r = await fetch("juego.json");
  JUEGO = await r.json();
  $("#dl-especies").innerHTML = Object.entries(JUEGO.especies)
    .map(([n, e]) => `<option value="${esc(e.nombre)}" label="#${String(n).padStart(3, "0")}"></option>`).join("");
  const mtPorNombre = {};
  for (const [mov, mt] of Object.entries(JUEGO.mt)) mtPorNombre[mt] = JUEGO.movimientos[mov].nombre;
  $("#dl-objetos").innerHTML = JUEGO.objetos
    .map(o => `<option value="${esc(o)}"${mtPorNombre[o] ? ` label="${esc(mtPorNombre[o])}"` : ""}></option>`).join("");
  return JUEGO;
}
function numEspecie(nombre){
  if (!JUEGO || !nombre) return null;
  const n = nombre.trim().toLowerCase();
  const e = Object.entries(JUEGO.especies).find(([, x]) => x.nombre.toLowerCase() === n);
  return e ? +e[0] : null;
}
const efectoNaturaleza = i => {
  const s = ["Atq", "Def", "Vel", "AtE", "DfE"], sube = i / 5 | 0, baja = i % 5;
  return sube === baja ? "neutra" : `+${s[sube]} −${s[baja]}`;
};

// Movimientos que puede aprender una especie en Rojo Fuego (ella o sus preevoluciones).
function aprendibles(num){
  const formas = new Map();
  let actual = num, desde = null;
  while (actual && JUEGO.especies[actual]){
    for (const [mov, lista] of Object.entries(JUEGO.especies[actual].aprende)){
      const m = JUEGO.movimientos[mov]; if (!m) continue;
      const f = formas.get(m.nombre) || {mov: m, formas: [], desde};
      for (const [metodo, nivel] of lista){
        const txt = metodo === "nivel" ? `Nv ${nivel}` : metodo === "mt" ? (JUEGO.mt[mov] || "MT") : metodo === "tutor" ? "Tutor" : "Huevo";
        const etiqueta = desde ? `${txt} como ${desde}` : txt;
        if (!f.formas.some(x => x.txt === etiqueta)) f.formas.push({metodo, nivel, txt: etiqueta, propio: !desde});
      }
      formas.set(m.nombre, f);
    }
    desde = JUEGO.especies[actual].nombre;
    actual = JUEGO.especies[actual].viene_de;
  }
  const prioridad = {nivel: 0, mt: 1, tutor: 2, huevo: 3};
  return [...formas.values()].map(f => {
    if (f.formas.some(x => x.propio)) f.formas = f.formas.filter(x => x.propio);
    f.formas.sort((a, b) => (b.propio - a.propio) || prioridad[a.metodo] - prioridad[b.metodo] || a.nivel - b.nivel);
    return f;
  });
}
function opcionesMovimientos(num, elegido){
  if (!num) return '<option value="">Primero elige el Pokémon</option>';
  const grupos = {nivel: [], mt: [], tutor: [], huevo: []};
  for (const f of aprendibles(num)) grupos[f.formas[0].metodo].push(f);
  grupos.nivel.sort((a, b) => a.formas[0].nivel - b.formas[0].nivel);
  ["mt", "tutor", "huevo"].forEach(g => grupos[g].sort((a, b) => a.mov.nombre.localeCompare(b.mov.nombre, "es")));
  const titulos = {nivel: "Por nivel", mt: "MT y MO", tutor: "Tutor", huevo: "Huevo (crianza)"};
  let h = '<option value="">—</option>';
  for (const g of ["nivel", "mt", "tutor", "huevo"]){
    if (!grupos[g].length) continue;
    h += `<optgroup label="${titulos[g]}">` + grupos[g].map(f =>
      `<option value="${esc(f.mov.nombre)}"${f.mov.nombre === elegido ? " selected" : ""}>${esc(f.mov.nombre)} · ${esc(f.formas.map(x => x.txt).join(", "))}</option>`).join("") + "</optgroup>";
  }
  if (elegido && !aprendibles(num).some(f => f.mov.nombre === elegido))
    h += `<option value="${esc(elegido)}" selected>${esc(elegido)} (no lo aprende en ${esc(nombreJuego())})</option>`;
  return h;
}

async function abrirEditor(o){
  openSheet('<p class="loading">Cargando datos del juego…</p>');
  try { await cargarJuego(); } catch (e) { openSheet('<p class="err">No pude cargar los datos del juego. Revisa la conexión e intenta de nuevo.</p>'); return; }
  const c = o?.config || {};
  const tipo = o?.tipo || "pokemon";
  const plazoSel = c.plazo === "largo" ? "largo" : "corto";
  const naturalezas = JUEGO.naturalezas.map((n, i) => `<option value="${esc(n)}"${c.naturaleza === n ? " selected" : ""}>${esc(n)} (${efectoNaturaleza(i)})</option>`).join("");
  const num = numEspecie(c.especie);
  const movs = c.movimientos || [];
  openSheet(`<h3 style="margin:0;font-size:1.2rem">${o ? "Editar objetivo" : "Nuevo objetivo"}</h3>
    <form class="form" id="f-obj" novalidate>
      ${o ? "" : `<div class="seg" role="group" aria-label="Tipo de objetivo" id="seg-tipo" style="align-self:flex-start">
        <button type="button" data-t="pokemon" aria-pressed="${tipo === "pokemon"}">Pokémon</button>
        <button type="button" data-t="objeto" aria-pressed="${tipo === "objeto"}">Objeto o MT</button></div>`}
      <div id="campos-pokemon" ${tipo === "pokemon" ? "" : "hidden"} class="form">
        <label for="o-especie">Pokémon</label>
        <input id="o-especie" list="dl-especies" autocomplete="off" placeholder="Ej: Gengar" value="${esc(c.especie || "")}">
        <label for="o-naturaleza">Naturaleza</label>
        <select id="o-naturaleza"><option value="">Cualquiera</option>${naturalezas}</select>
        <label>Movimientos</label>
        <span class="hint">Solo aparecen los que puede aprender en ${esc(nombreJuego())}, con cómo se aprenden.</span>
        ${[0, 1, 2, 3].map(i => `<select id="o-mov${i}" aria-label="Movimiento ${i + 1}">${opcionesMovimientos(num, movs[i])}</select>`).join("")}
        <label for="o-objeto">Objeto equipado</label>
        <input id="o-objeto" list="dl-objetos" autocomplete="off" placeholder="Ej: Restos (opcional)" value="${esc(c.objeto || "")}">
      </div>
      <div id="campos-objeto" ${tipo === "objeto" ? "" : "hidden"} class="form">
        <label for="o-nombre">Objeto o MT</label>
        <input id="o-nombre" list="dl-objetos" autocomplete="off" placeholder="Ej: MT24 o Caramelo Raro" value="${esc(c.nombre || "")}">
        <label for="o-cantidad">Cantidad</label>
        <input id="o-cantidad" type="number" min="1" inputmode="numeric" value="${c.cantidad || 1}">
      </div>
      <div class="two">
        <div class="form"><label for="o-plazo">Plazo</label>
          <select id="o-plazo"><option value="corto"${plazoSel === "corto" ? " selected" : ""}>Corto plazo</option><option value="largo"${plazoSel === "largo" ? " selected" : ""}>Largo plazo</option></select></div>
        <div class="form"><label for="o-nota">Nota</label><input id="o-nota" autocomplete="off" placeholder="Opcional" value="${esc(c.nota || "")}"></div>
      </div>
      <p class="err" id="o-err" hidden></p>
      <div class="actions"><button class="btn primary" type="submit" id="o-guardar">Guardar</button>
        ${o ? '<button class="btn danger" type="button" id="o-borrar">Borrar</button>' : ""}</div>
      <div class="ask" id="o-ask" hidden>¿Borrar este objetivo?
        <button class="btn sm danger" type="button" id="o-si">Sí, borrar</button><button class="btn sm" type="button" id="o-no">No</button></div>
    </form>`);

  let tipoActual = tipo;
  $("#seg-tipo")?.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return; tipoActual = b.dataset.t;
    document.querySelectorAll("#seg-tipo button").forEach(x => x.setAttribute("aria-pressed", x === b));
    $("#campos-pokemon").hidden = tipoActual !== "pokemon"; $("#campos-objeto").hidden = tipoActual !== "objeto";
  });
  $("#o-especie").addEventListener("change", () => {
    const n = numEspecie($("#o-especie").value);
    for (let i = 0; i < 4; i++) $("#o-mov" + i).innerHTML = opcionesMovimientos(n, $("#o-mov" + i).value);
  });
  const error = t => { $("#o-err").textContent = t; $("#o-err").hidden = !t; };
  const clave = tipoActual === "pokemon" ? "pokemon" : "objetos";
  const verificar = config => {
    if (o && !igual(config[clave][o.indice], o.config)) throw new Error("El archivo de objetivos cambió en GitHub. Cierra y vuelve a abrir el objetivo.");
  };
  const ocupado = (si, texto) => { $("#o-guardar").disabled = si; $("#o-guardar").textContent = texto; };

  $("#f-obj").addEventListener("submit", async e => {
    e.preventDefault(); error("");
    let nuevo, nombre;
    if (tipoActual === "pokemon"){
      const n = numEspecie($("#o-especie").value);
      if (!n) return error("Elige un Pokémon de la lista.");
      nombre = JUEGO.especies[n].nombre;
      const movimientos = [0, 1, 2, 3].map(i => $("#o-mov" + i).value).filter(Boolean);
      if (new Set(movimientos).size !== movimientos.length) return error("Hay un movimiento repetido.");
      const objeto = $("#o-objeto").value.trim();
      if (objeto && !JUEGO.objetos.includes(objeto)) return error("Ese objeto no existe en el juego. Elígelo de la lista.");
      nuevo = {especie: nombre, plazo: $("#o-plazo").value, naturaleza: $("#o-naturaleza").value || null,
               movimientos, objeto: objeto || null, nota: $("#o-nota").value.trim() || null};
    } else {
      nombre = $("#o-nombre").value.trim();
      if (!JUEGO.objetos.includes(nombre)) return error("Elige un objeto o MT de la lista.");
      const cantidad = Math.max(1, parseInt($("#o-cantidad").value, 10) || 1);
      nuevo = {nombre, cantidad, plazo: $("#o-plazo").value, nota: $("#o-nota").value.trim() || null};
    }
    Object.keys(nuevo).forEach(k => (nuevo[k] == null || (k === "plazo" && nuevo[k] === "corto")) && delete nuevo[k]);
    if (tipoActual === "objeto" && nuevo.cantidad === 1) delete nuevo.cantidad;
    ocupado(true, "Guardando…");
    try {
      const destino = tipoActual === "pokemon" ? "pokemon" : "objetos";
      await guardarObjetivosRepo(config => {
        if (o) { verificar(config); config[destino][o.indice] = nuevo; }
        else config[destino].push(nuevo);
      }, `Objetivos: ${o ? "editar" : "agregar"} ${nombre}`);
      sheet.close();
      toast("Guardado. En alrededor de un minuto aparece qué te falta.");
    } catch (err) {
      error(err instanceof TypeError ? "No pude conectarme a GitHub. ¿Hay internet?" : err.message);
      ocupado(false, "Guardar");
    }
  });
  $("#o-borrar")?.addEventListener("click", () => { $("#o-ask").hidden = false; $("#o-si").focus(); });
  $("#o-no")?.addEventListener("click", () => { $("#o-ask").hidden = true; });
  $("#o-si")?.addEventListener("click", async () => {
    $("#o-si").disabled = true; error("");
    try {
      await guardarObjetivosRepo(config => { verificar(config); config[clave].splice(o.indice, 1); },
        `Objetivos: borrar ${o.nombre || o.config.especie || o.config.nombre}`);
      sheet.close(); toast("Objetivo borrado.");
    } catch (err) {
      error(err instanceof TypeError ? "No pude conectarme a GitHub. ¿Hay internet?" : err.message);
      $("#o-si").disabled = false;
    }
  });
}

/* ---------- Mochila y cabecera ---------- */

function renderBag(){
  $("#bag").innerHTML = DATA.mochila.map((b, i) => `<details class="pocket" ${i < 2 ? "open" : ""}><summary>${esc(b.bolsillo)}<span class="num" style="color:var(--muted);font-weight:400">${b.objetos.length}</span></summary>
    <ul>${b.objetos.map(o => `<li><span>${esc(o.nombre)}</span><span class="r">${o.movimiento ? `<span class="type" style="${typeVars(o.movimiento.tipo)};text-transform:none">${esc(o.movimiento.nombre)}</span>` : ""}${o.cantidad > 1 ? `<span class="num">×${o.cantidad}</span>` : ""}</span></li>`).join("")}</ul></details>`).join("")
    || '<p class="empty-msg">La mochila está vacía.</p>';
}

function renderTrainer(){
  const t = DATA.entrenador;
  $("#t-name").textContent = t.nombre;
  $("#t-id").textContent = `ID ${String(t.id).padStart(5, "0")} · ${t.horas}:${String(t.minutos).padStart(2, "0")} h · $${t.dinero.toLocaleString("es-CL")}`;
  $("#t-badges").innerHTML = t.medallas.map(m => `<span class="badge ${m.tiene ? "on" : ""}" title="Medalla ${esc(m.nombre)}" aria-label="Medalla ${esc(m.nombre)}${m.tiene ? "" : " (falta)"}">${esc(m.nombre[0])}</span>`).join("");
  const tengo = DATA.pokedex.filter(p => p.estado === "tengo").length;
  const reg = tengo + DATA.pokedex.filter(p => p.estado === "registrado").length;
  const [t1, t2] = document.querySelectorAll("#t-track i");
  t1.style.width = (tengo / 151 * 100) + "%"; t2.style.width = ((reg - tengo) / 151 * 100) + "%";
  $("#t-dex").textContent = `${reg} / 151`;
  $("#t-save").textContent = DATA.save ? `Save del ${DATA.save.fecha} · «${DATA.save.mensaje}»` : "";
}

// Selector de juego: aparece cuando hay más de un juego con save.
function renderJuegos(){
  const lista = (DATA?.juegos || []).filter(j => JUEGOS[j.clave]);
  if (lista.length > 1) guardado.set("rf-juegos", JSON.stringify(lista.map(j => j.clave)));
  let claves = lista.map(j => j.clave);
  try { if (claves.length < 2) claves = JSON.parse(guardado.get("rf-juegos") || "[]"); } catch (e) { claves = []; }
  const caja = $("#t-juegos");
  caja.hidden = claves.length < 2;
  caja.innerHTML = claves.map(k => `<button type="button" data-j="${k}" aria-pressed="${k === juegoActivo()}">${esc(JUEGOS[k].nombre)}</button>`).join("");
  document.body.dataset.juego = juegoActivo();
}
$("#t-juegos").addEventListener("click", e => {
  const b = e.target.closest("button"); if (!b || b.dataset.j === juegoActivo()) return;
  guardado.set(CLAVES.juego, b.dataset.j);
  try { DATA = JSON.parse(guardado.get(claveDe("datos")) || "null"); } catch (err) { DATA = null; }
  pendiente = null; filtro = "todos";
  renderTodo();
  if (!DATA) $("#team").innerHTML = '<p class="loading">Cargando tu partida…</p>';
  cargarDatos();
});
const nombreJuego = () => DATA?.juego?.nombre || J().nombre;
const otraVersion = () => DATA?.juego?.otra || J().otra;

function renderTodo(){
  renderJuegos();
  document.title = `Tracker ${nombreJuego()}`;
  if (!DATA) {
    $("#t-name").textContent = nombreJuego(); $("#t-id").textContent = ""; $("#t-badges").innerHTML = ""; $("#t-save").textContent = "";
    return;
  }
  porNombre = Object.fromEntries(DATA.pokedex.map(p => [p.nombre, p.num]));
  renderTrainer(); renderTeam(); renderBoxes(); renderDex(); renderGoals(); renderBag();
}

/* ---------- Pestañas ---------- */

const VISTAS = ["equipo", "pc", "dex", "obj", "bag"];
function mostrar(v){
  if (!VISTAS.includes(v)) v = "equipo";
  VISTAS.forEach(x => { $("#v-" + x).hidden = x !== v; });
  document.querySelectorAll("nav.tabs button").forEach(b => {
    if (b.dataset.v === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  guardado.set(CLAVES.vista, v);
  window.scrollTo({top: 0});
}
document.querySelector("nav.tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) mostrar(b.dataset.v); });

/* ---------- Inicio ---------- */

try { DATA = JSON.parse(guardado.get(claveDe("datos")) || "null"); } catch (e) { DATA = null; }
if (!guardado.get(CLAVES.token)) {
  mostrarSetup(false);
} else {
  renderTodo();
  mostrar(location.hash.slice(1) || guardado.get(CLAVES.vista) || "equipo");
  if (!DATA) $("#team").innerHTML = '<p class="loading">Cargando tu partida…</p>';
  cargarDatos();
}
