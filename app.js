import { Chess } from "https://esm.sh/chess.js@1.4.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

/* Isi dua nilai ini dari Project Settings > API di Supabase. */
const SUPABASE_URL = "https://icgrhyznqgorxwmnxdyo.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZ3JoeXpucWdvcnh3bW54ZHlvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwMTMzOTUsImV4cCI6MjExMDU4OTM5NX0.LK7197IRjnf5dDUUBUqTKWypzi2BaUooRFMWKZ_X0nQ";

const $ = (id) => document.getElementById(id);
const glyph = { w:{k:"♔",q:"♕",r:"♖",b:"♗",n:"♘",p:"♙"}, b:{k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟"} };
const game = new Chess();
const playerId = getPlayerId();
let selected = null, legalTargets = [], flipped = false, lastMove = null;
let supabase = null, channel = null, roomId = null, myColor = "w";
let roomRow = null, isApplyingRemote = false, pendingPromotion = null;
let selectedBot = null, botThinking = false, botTimer = null, resignationResult = null;
let selectedTimeBase = 180, selectedIncrement = 2, whiteTime = 180, blackTime = 180;
let clockInterval = null, clockStarted = false, clockExpired = false;
let playerElo = Number(localStorage.getItem("quietmove-elo") || 400);
let resultApplied = false;
let localMatchId = null;
let finishReturnTimer = null;
let finishReturnScheduled = false;
const BOT_PROFILES = {
  magnus: {name:"Magnus Carlsen", elo:"2882", style:"Endgame technique · Positional pressure", depth:3, avatar:"M", seed:11},
  hikaru: {name:"Hikaru Nakamura", elo:"2816", style:"Tactical alertness · Dynamic play", depth:3, avatar:"H", seed:23},
  fischer: {name:"Bobby Fischer", elo:"2785", style:"Classical precision · Active pieces", depth:3, avatar:"B", seed:37},
  arya: {name:"Arya", elo:"5000", style:"Maximum setting · Fictional super-bot", depth:4, avatar:"A", seed:53},
  mitten: {name:"Mitten", elo:"350", style:"Easy practice · Gentle moves for beginners", depth:1, avatar:"m", seed:71}
};
const RANDOM_BOTS = [
  {name:"Adrian Fischer", elo:1180, depth:1, style:"Calm and careful", avatar:"A"},
  {name:"Nathan Cole", elo:1420, depth:2, style:"Balanced club player", avatar:"N"},
  {name:"Daniel Brooks", elo:960, depth:1, style:"Casual and unpredictable", avatar:"D"},
  {name:"Ethan Morgan", elo:1660, depth:2, style:"Tactical challenger", avatar:"E"},
  {name:"Lucas Bennett", elo:1270, depth:1, style:"Solid positional play", avatar:"L"},
  {name:"Oliver Hayes", elo:1840, depth:3, style:"Sharp attacking style", avatar:"O"},
  {name:"Mason Reed", elo:1510, depth:2, style:"Patient counterplay", avatar:"M"},
  {name:"Leo Carter", elo:1100, depth:1, style:"Quick developing moves", avatar:"L"},
  {name:"Noah Blake", elo:1740, depth:2, style:"Confident tournament style", avatar:"N"},
  {name:"Julian Ross", elo:1350, depth:2, style:"Flexible all-rounder", avatar:"J"}
];
let activeRandomBot = null, matchmakingTimer = null, matchmakingPoll = null, matchmakingActive = false;
const MATCHMAKING_WAIT_MS = 15000;

// Stockfish 19 Lite single-threaded. Loaded lazily in a dedicated Worker.
// The single-threaded build avoids SharedArrayBuffer / COOP-COEP requirements.
const STOCKFISH_BASE = "https://cdn.jsdelivr.net/npm/stockfish@19.0.1/bin/";
let stockfishWorker = null, stockfishInitPromise = null, stockfishWaiters = [];
let stockfishQueue = Promise.resolve();
let stockfishSearchId = 0;
let stockfishAvailable = true;
let adminLoggedIn = false, adminAutoPlay = false, adminBestMove = null, adminAnalysisBusy = false, adminAutoBusy = false;
let adminInfoLines = [];
let adminCollectInfo = false;
let moveQualityByPly = {};
let qualityAnalysisToken = 0;
let stockfishQualityLines = [];
function withStockfishLock(task) {
  const run = stockfishQueue.then(task, task);
  stockfishQueue = run.catch(() => {});
  return run;
}
function stopStockfishSearch() {
  if (stockfishWorker) stockfishWorker.postMessage("stop");
}
function stockfishMessage(line) {
  const text = String(line?.data ?? line ?? "");
  if (adminCollectInfo && text.startsWith("info ")) adminInfoLines.push(text);
  if (text.startsWith("info ")) stockfishQualityLines.push(text);
  for (const waiter of [...stockfishWaiters]) {
    if (waiter.test(text)) {
      stockfishWaiters = stockfishWaiters.filter(x => x !== waiter);
      clearTimeout(waiter.timer); waiter.resolve(text);
    }
  }
}
function waitStockfish(test, timeout=20000) {
  return new Promise((resolve,reject)=>{
    const waiter={test,resolve,reject,timer:setTimeout(()=>{
      stockfishWaiters=stockfishWaiters.filter(x=>x!==waiter); reject(new Error("Stockfish timeout"));
    },timeout)};
    stockfishWaiters.push(waiter);
  });
}
async function initStockfish() {
  if (stockfishInitPromise) return stockfishInitPromise;
  stockfishInitPromise=(async()=>{
    // A Blob bootstrap lets the Worker import the engine while locateFile points
    // the WASM loader at the matching CDN asset.
    const jsUrl=STOCKFISH_BASE+"stockfish-19-lite-single.js";
    const wasmUrl=STOCKFISH_BASE+"stockfish-19-lite-single.wasm";
    const bootstrap=`self.Module={locateFile:function(path){return path.endsWith('.wasm')?${JSON.stringify(wasmUrl)}:path;}};importScripts(${JSON.stringify(jsUrl)});`;
    const blobUrl=URL.createObjectURL(new Blob([bootstrap],{type:"text/javascript"}));
    stockfishWorker=new Worker(blobUrl);
    URL.revokeObjectURL(blobUrl);
    stockfishWorker.onmessage=e=>stockfishMessage(e);
    stockfishWorker.onerror=()=>{
      stockfishAvailable=false;
      const pending=stockfishWaiters.splice(0);
      pending.forEach(w=>{clearTimeout(w.timer);w.reject(new Error("Stockfish Worker gagal dimuat."));});
    };
    stockfishWorker.postMessage("uci");
    await waitStockfish(x=>x.includes("uciok"),30000);
    stockfishWorker.postMessage("isready");
    await waitStockfish(x=>x.includes("readyok"),30000);
    return true;
  })().catch(error=>{stockfishAvailable=false; stockfishInitPromise=null; throw error;});
  return stockfishInitPromise;
}
async function stockfishMove(fen, bot) {
  return withStockfishLock(async () => {
    await initStockfish();
    const rating=Math.max(350,Number(bot?.elo)||400);
    // One principal variation is faster and more useful for move selection.
    const profiles = rating<650 ? {skill:0,depth:5,time:220} :
      rating<950 ? {skill:2,depth:7,time:300} :
      rating<1200 ? {skill:5,depth:9,time:380} :
      rating<1500 ? {skill:8,depth:11,time:480} :
      rating<1800 ? {skill:11,depth:13,time:600} :
      rating<2200 ? {skill:15,depth:15,time:750} :
      rating<2800 ? {skill:19,depth:17,time:950} :
      {skill:20,depth:19,time:1200};
    const limited=rating>=1320;
    const elo=Math.max(1320,Math.min(3190,rating));
    stockfishWorker.postMessage("stop");
    stockfishWorker.postMessage("setoption name UCI_LimitStrength value "+(limited?"true":"false"));
    if(limited) stockfishWorker.postMessage("setoption name UCI_Elo value "+elo);
    stockfishWorker.postMessage("setoption name Skill Level value "+profiles.skill);
    stockfishWorker.postMessage("setoption name MultiPV value 1");
    stockfishWorker.postMessage("position fen "+fen);
    stockfishWorker.postMessage("go depth "+profiles.depth+" movetime "+profiles.time);
    const response=await waitStockfish(x=>x.includes("bestmove "),profiles.time+12000);
    const match=response.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
    if(!match) return null;
    return {from:match[1].slice(0,2),to:match[1].slice(2,4),promotion:match[1][4]||undefined};
  });
}


function parseEngineScore(lines) {
  let best=null;
  for(const line of lines){
    if(!line.startsWith("info ")) continue;
    const depth=Number((line.match(/\bdepth (\d+)/)||[])[1]||0);
    const score=(line.match(/\bscore (cp|mate) (-?\d+)/)||[]);
    if(!score)continue;
    let cp=score[1]==="mate"?(Number(score[2])>0?10000:-10000):Number(score[2]);
    if(!best||depth>=best.depth)best={depth,cp};
  }
  return best;
}
async function engineQuickPosition(fen, depth=9, movetime=220) {
  await initStockfish();
  stockfishQualityLines=[];
  stockfishWorker.postMessage("setoption name UCI_LimitStrength value false");
  stockfishWorker.postMessage("setoption name Skill Level value 20");
  stockfishWorker.postMessage("setoption name MultiPV value 1");
  stockfishWorker.postMessage("position fen "+fen);
  stockfishWorker.postMessage(`go depth ${depth} movetime ${movetime}`);
  const response=await waitStockfish(x=>x.includes("bestmove "),movetime+8000);
  const bestMove=(response.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/)||[])[1]||null;
  const score=parseEngineScore(stockfishQualityLines);
  if(!score)throw new Error("Stockfish belum mengirim evaluasi posisi.");
  const turn=fen.split(/\s+/)[1];
  return {bestMove, whiteCp:turn==="w"?score.cp:-score.cp, depth:score.depth};
}
function qualityLabel(loss, matchesBest) {
  if(matchesBest)return {label:"Best",symbol:"★",className:"best"};
  if(loss<=12)return {label:"Excellent",symbol:"‼",className:"excellent"};
  if(loss<=35)return {label:"Good",symbol:"✓",className:"good"};
  if(loss<=80)return {label:"Inaccuracy",symbol:"?!",className:"inaccuracy"};
  if(loss<=180)return {label:"Mistake",symbol:"?",className:"mistake"};
  return {label:"Blunder",symbol:"??",className:"blunder"};
}
function analyzeMoveQuality(beforeFen, afterFen, moveUci, movingColor, ply) {
  const token=++qualityAnalysisToken;
  moveQualityByPly[ply]={label:"Analyzing",symbol:"…",className:"pending"};
  render();
  withStockfishLock(async()=>{
    const before=await engineQuickPosition(beforeFen,8,180);
    const after=await engineQuickPosition(afterFen,8,180);
    const swing=movingColor==="w"?before.whiteCp-after.whiteCp:after.whiteCp-before.whiteCp;
    const loss=Math.max(0,swing);
    const result=qualityLabel(loss,before.bestMove===moveUci);
    moveQualityByPly[ply]={...result,loss:Math.round(loss),depth:Math.min(before.depth,after.depth)};
  }).then(()=>{render();}).catch(error=>{
    console.warn("Move quality analysis unavailable:",error);
    delete moveQualityByPly[ply];
    if(token===qualityAnalysisToken)render();
  });
}


function updateAdminUI() {
  const tools=$("adminTools"); if(!tools)return;
  tools.hidden=!adminLoggedIn;
  $("adminEmail").hidden=adminLoggedIn; $("adminPassword").hidden=adminLoggedIn; $("adminLoginBtn").hidden=adminLoggedIn;
  $("adminStatus").textContent=adminLoggedIn?"Owner terverifikasi oleh Supabase. Admin tools aktif pada giliran akun ini.":"Login menggunakan akun Supabase Auth yang sudah didaftarkan sebagai owner melalui SQL.";
  $("adminAutoPlay").checked=adminAutoPlay;
}
async function verifyAdminSession() {
  if(!supabase)return;
  const {data:{session}}=await supabase.auth.getSession();
  if(!session){adminLoggedIn=false;updateAdminUI();return;}
  const {data,isError,error}=await supabase.rpc("is_qm_admin");
  if(error||data!==true){adminLoggedIn=false;adminAutoPlay=false;updateAdminUI();return;}
  adminLoggedIn=true;updateAdminUI();
}
async function adminLogin() {
  if(!supabase)return toast("Supabase belum tersambung.");
  const email=$("adminEmail").value.trim(), password=$("adminPassword").value;
  if(!email||!password)return toast("Masukkan email dan password akun owner.");
  const {data,error}=await supabase.auth.signInWithPassword({email,password});
  if(error){toast("Login gagal. Periksa email dan password Supabase Auth.");return;}
  const {data:isOwner,error:checkError}=await supabase.rpc("is_qm_admin");
  if(checkError||isOwner!==true){await supabase.auth.signOut();adminLoggedIn=false;updateAdminUI();toast("Akun ini tidak terdaftar sebagai owner Admin.");return;}
  adminLoggedIn=true;$("adminPassword").value="";updateAdminUI();toast("Login Admin Owner berhasil.");
}
function parseAdminAnalysis(lines) {
  const rows=[];
  for(const line of lines){
    const depth=Number((line.match(/\bdepth (\d+)/)||[])[1]||0);
    const multipv=Number((line.match(/\bmultipv (\d+)/)||[])[1]||1);
    const score=(line.match(/\bscore (cp|mate) (-?\d+)/)||[]);
    const pv=(line.match(/\bpv (.+)$/)||[])[1];
    if(pv){const first=pv.trim().split(/\s+/)[0];if(/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(first))rows.push({depth,multipv,scoreType:score[1],score:Number(score[2]),uci:first});}
  }
  rows.sort((a,b)=>b.depth-a.depth||a.multipv-b.multipv);
  return rows;
}
async function analyzeAdminPosition() {
  if(!adminLoggedIn)return toast("Login admin terlebih dahulu.");
  if(roomId && game.turn()!==myColor)return toast("Tunggu giliranmu sebelum menganalisis posisi multiplayer.");
  if(game.isGameOver())return toast("Permainan sudah selesai.");
  if(adminAnalysisBusy)return;
  adminAnalysisBusy=true;adminBestMove=null;adminInfoLines=[];$("adminAnalyzeBtn").disabled=true;$("adminPlayBestBtn").disabled=true;$("adminBestMove").textContent="Stockfish sedang menganalisis...";
  const analyzedFen=game.fen();
  try{
    await withStockfishLock(async()=>{
      await initStockfish();
      adminInfoLines=[];adminCollectInfo=true;
      stockfishWorker.postMessage("stop");
      stockfishWorker.postMessage("setoption name UCI_LimitStrength value false");
      stockfishWorker.postMessage("setoption name Skill Level value 20");
      stockfishWorker.postMessage("setoption name MultiPV value 3");
      stockfishWorker.postMessage("position fen "+analyzedFen);
      stockfishWorker.postMessage("go depth 18 movetime 2600");
      const best=await waitStockfish(x=>x.includes("bestmove "),18000);
      const match=best.match(/bestmove\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
      adminCollectInfo=false;
      const allRows=parseAdminAnalysis(adminInfoLines).filter(r=>r.depth>0);
      const deepest=Math.max(0,...allRows.map(r=>r.depth));
      const rows=allRows.filter(r=>r.depth===deepest).sort((a,b)=>a.multipv-b.multipv);
      if(!match)throw new Error("Stockfish tidak mengembalikan langkah.");
      if(game.fen()!==analyzedFen)throw new Error("Posisi berubah selama analisis. Jalankan analisis ulang.");
      const uci=match[1];
      adminBestMove={from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]||undefined,fen:analyzedFen};
      const scoreRow=rows.find(r=>r.uci===uci)||rows[0];
      const score=scoreRow?(scoreRow.scoreType==="mate"?"mate "+scoreRow.score:(scoreRow.score/100).toFixed(2)):"evaluasi tersedia";
      const alternatives=rows.slice(0,3).map((r,i)=>`${i+1}. ${r.uci} (${r.scoreType==="mate"?"M"+r.score:(r.score/100).toFixed(2)})`).join(" · ");
      $("adminBestMove").textContent=`Best move: ${uci.slice(0,2)} → ${uci.slice(2,4)} · depth ${scoreRow?.depth||18} · ${score}${alternatives?" | Kandidat: "+alternatives:""}`;
      $("adminPlayBestBtn").disabled=false;
    });
  }catch(error){adminCollectInfo=false;console.error(error);$("adminBestMove").textContent=error.message||"Analisis gagal. Periksa koneksi Stockfish.";toast("Analisis Stockfish gagal atau posisi berubah.");}
  finally{adminCollectInfo=false;adminAnalysisBusy=false;$("adminAnalyzeBtn").disabled=false;}
}
function adminPlayBest() {
  if(!adminLoggedIn||!adminBestMove)return;
  if(roomId && game.turn()!==myColor)return toast("Langkah hanya dapat dimainkan pada giliran akun owner.");
  if(adminBestMove.fen!==game.fen())return toast("Posisi berubah. Analisis ulang terlebih dahulu.");
  const legal=game.moves({verbose:true}).find(m=>m.from===adminBestMove.from&&m.to===adminBestMove.to&&(!adminBestMove.promotion||m.promotion===adminBestMove.promotion));
  if(!legal)return toast("Langkah terbaik tidak lagi legal.");
  makeMove(legal);adminBestMove=null;$("adminPlayBestBtn").disabled=true;
}
async function adminAutoMoveIfNeeded() {
  if(!adminLoggedIn||!adminAutoPlay||game.isGameOver()||game.turn()!==(roomId?myColor:"w")||adminAutoBusy)return;
  adminAutoBusy=true;
  try{await analyzeAdminPosition();if(adminBestMove&&adminBestMove.fen===game.fen())adminPlayBest();}
  finally{adminAutoBusy=false;}
}


if (SUPABASE_URL.startsWith("https://") && !SUPABASE_ANON_KEY.startsWith("YOUR_")) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  $("connectionLabel").textContent = "ONLINE READY";
} else {
  $("connectionLabel").textContent = "LOCAL GAME";
  $("roomStatus").textContent = "Tambahkan kredensial Supabase untuk mengaktifkan Mabar.";
}


const PIECE_VALUES = {p:1,n:3,b:3,r:5,q:9,k:0};
function formatClock(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safe/60)).padStart(2,"0")}:${String(safe%60).padStart(2,"0")}`;
}
function paintClocks() {
  if (!$("whiteClock")) return;
  $("whiteClock").textContent = formatClock(whiteTime);
  $("blackClock").textContent = formatClock(blackTime);
  $("whiteClockBox").classList.toggle("active", clockStarted && game.turn()==="w" && !game.isGameOver());
  $("blackClockBox").classList.toggle("active", clockStarted && game.turn()==="b" && !game.isGameOver());
}
function stopClock() {
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = null;
}
function resetClock() {
  stopClock();
  whiteTime = selectedTimeBase;
  blackTime = selectedTimeBase;
  clockStarted = false;
  clockExpired = false;
  paintClocks();
}
function startClock() {
  if (clockStarted || clockExpired) return;
  clockStarted = true;
  stopClock();
  clockInterval = setInterval(() => {
    if (game.isGameOver() || resignationResult || clockExpired) { stopClock(); return; }
    if (game.turn()==="w") whiteTime = Math.max(0, whiteTime-0.1);
    else blackTime = Math.max(0, blackTime-0.1);
    if (whiteTime<=0 || blackTime<=0) {
      clockExpired = true;
      stopClock();
      resignationResult = whiteTime<=0 ? "Black wins on time" : "White wins on time";
      toast(resignationResult);
      render();
    }
    paintClocks();
  },100);
}
function addMoveIncrement(color) {
  if (!clockStarted || !selectedIncrement) return;
  if (color==="w") whiteTime += selectedIncrement;
  else blackTime += selectedIncrement;
}
function updateMaterialCount() {
  const totals = {w:0,b:0};
  for (const row of game.board()) for (const piece of row) if (piece) totals[piece.color] += PIECE_VALUES[piece.type] || 0;
  const diff = totals.w-totals.b;
  $("materialCount").textContent = diff===0 ? "Even" : `${diff>0?"White":"Black"} +${Math.abs(diff)}`;
}

function updateEloDisplay() {
  const el = $("playerElo");
  if (el) el.textContent = String(playerElo);
}
function eloExpectedScore(playerRating, opponentRating) {
  return 1 / (1 + Math.pow(10, (opponentRating - playerRating) / 400));
}
async function getCurrentOpponentRating() {
  if (roomId && supabase) {
    const opponentId = myColor === "w" ? roomRow?.black_id : roomRow?.white_id;
    if (opponentId) {
      const {data, error} = await supabase.from("profiles").select("elo").eq("player_id", opponentId).maybeSingle();
      if (!error && Number(data?.elo) > 0) return Number(data.elo);
    }
    return 400;
  }
  const bot = activeRandomBot || BOT_PROFILES[selectedBot];
  return Number(bot?.elo) || 400;
}
function getLocalMatchOutcome() {
  if (game.isDraw() || (!game.isCheckmate() && !resignationResult && !clockExpired)) return null;
  if (game.isCheckmate()) {
    const winnerColor = game.turn() === "w" ? "b" : "w";
    return (roomId ? winnerColor === myColor : winnerColor === "w") ? 1 : 0;
  }
  if (clockExpired) {
    const winnerIsWhite = String(resignationResult || "").toLowerCase().includes("black wins");
    return (roomId ? (winnerIsWhite ? myColor === "w" : myColor === "b") : winnerIsWhite) ? 1 : 0;
  }
  if (resignationResult) {
    const text = String(resignationResult).toLowerCase();
    const winnerIsWhite = text.includes("white wins");
    const winnerIsBlack = text.includes("black wins");
    if (winnerIsWhite || winnerIsBlack) {
      const winnerColor = winnerIsWhite ? "w" : "b";
      return (roomId ? winnerColor === myColor : winnerColor === "w") ? 1 : 0;
    }
    // The resign button is only available to the local player.
    return 0;
  }
  return null;
}
async function settleMatchElo() {
  const finished = game.isGameOver() || !!resignationResult || !!clockExpired;
  if (!finished || resultApplied) return;
  const matchKey = roomId ? `quietmove-result-${roomId}` : `quietmove-result-${localMatchId || "local"}`;
  if (localStorage.getItem(matchKey)) { resultApplied = true; return; }
  resultApplied = true;

  const outcome = getLocalMatchOutcome();
  let delta = 0;
  let label = "Draw · Elo unchanged";
  if (outcome !== null) {
    const opponentRating = await getCurrentOpponentRating();
    const expected = eloExpectedScore(playerElo, opponentRating);
    // K=24: rating changes are based on opponent strength, not a fixed win/loss amount.
    delta = Math.round(24 * (outcome - expected));
    if (outcome === 1) label = `Victory · +${delta} Elo`;
    else label = `Defeat · ${delta} Elo`;
  }

  playerElo = Math.max(100, playerElo + delta);
  localStorage.setItem("quietmove-elo", String(playerElo));
  localStorage.setItem(matchKey, label);
  updateEloDisplay();

  if (supabase) {
    const username = localStorage.getItem("quietmove-username") || ("Player" + playerId.slice(0,5));
    const {error} = await supabase.from("profiles").upsert({
      player_id: playerId,
      username,
      elo: playerElo,
      last_seen: new Date().toISOString()
    }, {onConflict:"player_id"});
    if (error) console.warn("Could not sync Elo to profile:", error);
  }
  toast(`${label} · Your Elo: ${playerElo}`);
}

let soundEnabled = localStorage.getItem("quietmove-sound") !== "off";
let audioContext = null;
function ensureAudio() {
  if (!soundEnabled) return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioContext) audioContext = new AudioCtx();
  if (audioContext.state === "suspended") audioContext.resume();
  return audioContext;
}
function woodenTap(when, strength=1, variation=0) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t = when ?? ctx.currentTime;
  // A short, warm wooden knock: filtered broadband impact plus hollow resonances.
  const length = Math.floor(ctx.sampleRate * 0.13);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i=0;i<length;i++) {
    const fade = Math.pow(1-i/length, 3.2);
    data[i] = (Math.random()*2-1) * fade;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 780 + variation*90;
  band.Q.value = 0.85;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001,t);
  noiseGain.gain.exponentialRampToValueAtTime(0.19*strength,t+0.004);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001,t+0.105);
  noise.connect(band).connect(noiseGain).connect(ctx.destination);
  noise.start(t); noise.stop(t+0.12);

  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(178 + variation*19,t);
  body.frequency.exponentialRampToValueAtTime(92 + variation*9,t+0.105);
  const bodyGain = ctx.createGain();
  bodyGain.gain.setValueAtTime(0.0001,t);
  bodyGain.gain.exponentialRampToValueAtTime(0.22*strength,t+0.003);
  bodyGain.gain.exponentialRampToValueAtTime(0.0001,t+0.16);
  body.connect(bodyGain).connect(ctx.destination);
  body.start(t); body.stop(t+0.17);

  const tick = ctx.createOscillator();
  tick.type = "triangle";
  tick.frequency.value = 510 + variation*35;
  const tickGain = ctx.createGain();
  tickGain.gain.setValueAtTime(0.0001,t);
  tickGain.gain.exponentialRampToValueAtTime(0.045*strength,t+0.002);
  tickGain.gain.exponentialRampToValueAtTime(0.0001,t+0.035);
  tick.connect(tickGain).connect(ctx.destination);
  tick.start(t); tick.stop(t+0.04);
}
function playMoveSound(move) {
  if (!soundEnabled) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const capture = !!move.captured || (move.flags && move.flags.includes("e"));
  const castle = !!(move.flags && (move.flags.includes("k") || move.flags.includes("q")));
  const now = ctx.currentTime + 0.012;
  woodenTap(now, capture ? 1.18 : 0.88, capture ? 2 : 0);
  if (castle) woodenTap(now+0.105,0.72,1);
}
function setSoundEnabled(enabled) {
  soundEnabled = enabled;
  localStorage.setItem("quietmove-sound", enabled ? "on" : "off");
  const btn=$("soundToggle");
  if(btn) {
    btn.setAttribute("aria-pressed",String(enabled));
    btn.classList.toggle("sound-active",enabled);
    $("soundState").textContent=enabled?"ON ♪":"OFF";
  }
}


let socialTab = "find";
function socialMessage(message){ $("socialStatus").textContent=message; }
function switchSocialTab(tab){
  socialTab=tab;
  document.querySelectorAll(".social-tab").forEach(b=>b.classList.toggle("active",b.dataset.socialTab===tab));
  document.querySelectorAll(".social-pane").forEach(p=>p.classList.toggle("active",p.id==="social-"+tab));
  if(tab==="friends")loadFriends();
  if(tab==="requests")loadFriendRequests();
  if(tab==="profile")loadMyProfile();
  if(tab==="history")loadMatchHistory();
}
async function ensureMyProfile(){
  if(!supabase)return null;
  const username=localStorage.getItem("quietmove-username")||("Player"+playerId.slice(0,5));
  const {data,error}=await supabase.from("profiles").upsert({
    player_id:playerId,username,elo:playerElo,bio:"",last_seen:new Date().toISOString()
  },{onConflict:"player_id",ignoreDuplicates:true}).select().maybeSingle();
  if(error)console.warn("profile init",error);
  return data;
}
function escapeHTML(value){
  return String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function playerCard(profile, action="add"){
  const online=profile.last_seen && Date.now()-new Date(profile.last_seen).getTime()<90000;
  const btn=action==="add"?`<button class="social-action" data-add="${escapeHTML(profile.player_id)}">Add</button>`:
    action==="duel"?`<button class="social-action" data-duel="${escapeHTML(profile.player_id)}">Duel</button>`:
    `<button class="social-action" data-view="${escapeHTML(profile.player_id)}">View</button>`;
  const view=action==="add"?`<button class="social-action muted" data-view="${escapeHTML(profile.player_id)}">Profile</button>`:"";
  const avatar=profile.avatar_url?`<img class="player-avatar-img" src="${escapeHTML(profile.avatar_url)}" alt="">`:`<div class="player-avatar">${escapeHTML((profile.username||"?").slice(0,1).toUpperCase())}</div>`;
  return `<article class="player-card">${avatar}<div class="player-info"><strong>${escapeHTML(profile.username)}</strong><small><i class="${online?"online":"offline"}"></i>${online?"Online":"Offline"} · ${Number(profile.elo)||400} Elo</small></div>${view}${btn}</article>`;
}
async function searchPlayers(){
  if(!supabase)return socialMessage("Configure Supabase terlebih dahulu.");
  const q=$("playerSearch").value.trim();
  if(!q)return socialMessage("Masukkan username atau Player ID.");
  const {data,error}=await supabase.from("profiles").select("player_id,username,elo,bio,last_seen,avatar_url").or(`username.ilike.%${q}%,player_id.eq.${q}`).neq("player_id",playerId).limit(20);
  if(error){socialMessage("Pencarian gagal. Jalankan pembaruan SQL.");return;}
  $("searchResults").innerHTML=data.length?data.map(x=>playerCard(x,"add")).join(""):'<p class="social-empty">No players found.</p>';
  socialMessage(`${data.length} player(s) found.`);
}
async function loadFriends(){
  if(!supabase)return;
  const {data,error}=await supabase.from("friendships").select("player_a,player_b,status").eq("status","accepted").or(`player_a.eq.${playerId},player_b.eq.${playerId}`);
  if(error){$("friendsList").innerHTML='<p class="social-empty">Friends table is not configured yet.</p>';return;}
  const ids=data.map(r=>r.player_a===playerId?r.player_b:r.player_a);
  $("friendCount").textContent=ids.length+" FRIENDS";
  if(!ids.length){$("friendsList").innerHTML='<p class="social-empty">No friends yet. Find players and add them.</p>';return;}
  const result=await supabase.from("profiles").select("player_id,username,elo,last_seen,avatar_url").in("player_id",ids);
  $("friendsList").innerHTML=(result.data||[]).map(x=>playerCard(x,"duel")).join("");
}
async function loadFriendRequests(){
  if(!supabase)return;
  const {data,error}=await supabase.from("friend_requests").select("*").eq("to_id",playerId).eq("status","pending").order("created_at",{ascending:false});
  if(error){$("friendRequests").innerHTML='<p class="social-empty">Friend requests table is not configured.</p>';return;}
  const ids=data.map(x=>x.from_id);
  const profiles=ids.length ? await supabase.from("profiles").select("player_id,username,elo,last_seen,avatar_url").in("player_id",ids) : {data:[]};
  $("friendRequests").innerHTML=data.map(req=>{
    const u=(profiles.data||[]).find(x=>x.player_id===req.from_id)||{username:"Player",elo:400};
    return `<article class="player-card"><div class="player-info"><strong>${escapeHTML(u.username)}</strong><small>Friend request · ${Number(u.elo)||400} Elo</small></div><button class="social-action" data-accept="${req.id}">Accept</button><button class="social-action muted" data-decline="${req.id}">Decline</button></article>`;
  }).join("") || '<p class="social-empty">No pending requests.</p>';
  const duels=await supabase.from("duel_requests").select("*").eq("to_id",playerId).eq("status","pending").order("created_at",{ascending:false});
  if(!duels.error && duels.data.length){
    const duelIds=duels.data.map(d=>d.from_id);
    const duelProfiles=await supabase.from("profiles").select("player_id,username,elo,avatar_url").in("player_id",duelIds);
    $("friendRequests").innerHTML += duels.data.map(d=>{
      const u=(duelProfiles.data||[]).find(x=>x.player_id===d.from_id)||{username:"Player",elo:400};
      return `<article class="player-card duel-invite"><div class="player-info"><strong>${escapeHTML(u.username)}</strong><small>Chess duel · ${escapeHTML(d.time_control||"10+0")}</small></div><button class="social-action" data-duel-accept="${d.id}">Accept duel</button></article>`;
    }).join("");
  }
}
async function loadMyProfile(){
  if(!supabase)return;
  const {data}=await supabase.from("profiles").select("*").eq("player_id",playerId).maybeSingle();
  if(data){$("myUsername").value=data.username||"";$("myBio").value=data.bio||"";setMyAvatarPreview(data.avatar_url||"");}
  $("myProfileStats").innerHTML=`<div class="stat-tile"><strong>${playerElo}</strong><small>YOUR ELO</small></div><div class="stat-tile"><strong>${data?.username?escapeHTML(data.username):"New player"}</strong><small>PLAYER PROFILE</small></div>`;
}
async function viewPlayer(id){
  if(!supabase)return;
  const {data,error}=await supabase.from("profiles").select("*").eq("player_id",id).single();
  if(error||!data)return toast("Profile not found.");
  $("searchResults").innerHTML=`<article class="public-profile"><div class="player-avatar large">${escapeHTML((data.username||"?").slice(0,1).toUpperCase())}</div><h3>${escapeHTML(data.username)}</h3><strong>${Number(data.elo)||400} ELO</strong><p>${escapeHTML(data.bio||"No bio yet.")}</p><small>Player ID: ${escapeHTML(data.player_id)}</small><button class="social-action" data-add="${escapeHTML(data.player_id)}">Add friend</button></article>`;
  switchSocialTab("find");
}
async function sendFriendRequest(id){
  if(!supabase)return;
  const {error}=await supabase.from("friend_requests").insert({from_id:playerId,to_id:id,status:"pending"});
  socialMessage(error?"Could not send request. Maybe already sent.":"Friend request sent.");
  if(!error)toast("Friend request sent.");
}
async function respondFriendRequest(id,accept){
  const {data:request}=await supabase.from("friend_requests").select("*").eq("id",id).single();
  if(!request)return;
  await supabase.from("friend_requests").update({status:accept?"accepted":"declined"}).eq("id",id);
  if(accept){
    const [a,b]=[request.from_id,request.to_id].sort();
    await supabase.from("friendships").upsert({player_a:a,player_b:b,status:"accepted"},{onConflict:"player_a,player_b"});
  }
  loadFriendRequests();loadFriends();
}
async function challengePlayer(id){
  if(!supabase)return;
  const {error}=await supabase.from("duel_requests").insert({from_id:playerId,to_id:id,status:"pending",time_control:"10+0"});
  if(error){toast("Could not send challenge.");return;}
  toast("Duel invitation sent.");
}
async function acceptDuel(id){
  const {data:req,error}=await supabase.from("duel_requests").select("*").eq("id",id).single();
  if(error||!req)return toast("Duel invitation not found.");
  const roomIdNew=Math.random().toString(36).slice(2,8).toUpperCase();
  const {error:roomError}=await supabase.from("chess_rooms").insert({
    id:roomIdNew,fen:new Chess().fen(),pgn:"",white_id:req.from_id,black_id:req.to_id,updated_at:new Date().toISOString()
  });
  if(roomError)return toast("Could not create duel room.");
  await supabase.from("duel_requests").update({status:"accepted",room_id:roomIdNew}).eq("id",id);
  const invite=new URL(location.href);invite.searchParams.set("room",roomIdNew);
  toast("Duel accepted. Opening match…");
  setTimeout(()=>location.href=invite.toString(),500);
}
async function loadMatchHistory(){
  if(!supabase)return;
  const {data,error}=await supabase.from("chess_rooms").select("id,pgn,white_id,black_id,updated_at,result,completed_at").or(`white_id.eq.${playerId},black_id.eq.${playerId}`).not("completed_at","is",null).order("completed_at",{ascending:false}).limit(15);
  if(error){$("matchHistory").innerHTML='<p class="social-empty">Match history is not available yet.</p>';return;}
  if(!data.length){$("matchHistory").innerHTML='<p class="social-empty">No previous games found.</p>';return;}
  $("matchHistory").innerHTML=data.map(m=>{
    const moves=(m.pgn||"").trim().split(/\s+/).filter(Boolean).length;
    return `<article class="player-card"><div class="player-info"><strong>Game ${escapeHTML(m.id)}</strong><small>${m.white_id===playerId?"White":"Black"} · ${moves} PGN tokens · ${new Date(m.completed_at).toLocaleDateString()}</small></div><span class="history-result">${escapeHTML(m.result||"Finished")}</span></article>`;
  }).join("");
}
async function refreshSocial(){
  if(!supabase){socialMessage("Configure Supabase and run supabase.sql.");return;}
  await ensureMyProfile();
  await supabase.from("profiles").update({last_seen:new Date().toISOString(),elo:playerElo}).eq("player_id",playerId);
  if(socialTab==="friends")await loadFriends();
  if(socialTab==="requests")await loadFriendRequests();
  if(socialTab==="profile")await loadMyProfile();
  if(socialTab==="history")await loadMatchHistory();
  const accepted=await supabase.from("duel_requests").select("room_id").eq("from_id",playerId).eq("status","accepted").not("room_id","is",null).order("created_at",{ascending:false}).limit(1);
  if(accepted.data?.[0]?.room_id && !new URLSearchParams(location.search).has("room")){
    const room=accepted.data[0].room_id;
    const link=new URL(location.href);link.searchParams.set("room",room);
    socialMessage("Your duel was accepted. Open the match link.");
    $("socialStatus").innerHTML=`Duel accepted · <a href="${link.toString()}">Join match ↗</a>`;
  } else socialMessage("Profile and player network refreshed.");
}
document.querySelectorAll(".social-tab").forEach(b=>b.addEventListener("click",()=>switchSocialTab(b.dataset.socialTab)));
$("searchPlayersBtn").onclick=searchPlayers;
$("playerSearch").addEventListener("keydown",e=>{if(e.key==="Enter")searchPlayers();});
$("refreshSocialBtn").onclick=refreshSocial;
function setMyAvatarPreview(url){
  const img=$("myAvatarPreview"),fallback=$("myAvatarFallback");
  if(url){img.src=url;img.hidden=false;fallback.hidden=true;}
  else{img.removeAttribute("src");img.hidden=true;fallback.hidden=false;fallback.textContent=(($("myUsername")?.value||"?").trim()[0]||"?").toUpperCase();}
}
$("profilePhotoInput")?.addEventListener("change",async(e)=>{
  const file=e.target.files?.[0];if(!file)return;
  if(!file.type.startsWith("image/")){toast("Pilih file gambar.");e.target.value="";return;}
  if(file.size>2*1024*1024){toast("Ukuran foto maksimal 2 MB.");e.target.value="";return;}
  if(!supabase){toast("Supabase belum tersambung.");return;}
  const ext=(file.name.split(".").pop()||"jpg").toLowerCase().replace(/[^a-z0-9]/g,"")||"jpg";
  const path=`${playerId}/avatar-${Date.now()}.${ext}`;
  toast("Mengunggah foto profil…");
  const {error:uploadError}=await supabase.storage.from("profile-photos").upload(path,file,{upsert:true,contentType:file.type,cacheControl:"3600"});
  if(uploadError){console.warn("Avatar upload:",uploadError);toast("Upload gagal. Pastikan SQL Storage sudah dijalankan.");return;}
  const {data:publicData}=supabase.storage.from("profile-photos").getPublicUrl(path);
  const avatarUrl=publicData?.publicUrl;
  const {error:updateError}=await supabase.from("profiles").update({avatar_url:avatarUrl}).eq("player_id",playerId);
  if(updateError){console.warn("Avatar profile update:",updateError);toast("Foto terunggah, tetapi profil gagal diperbarui.");return;}
  setMyAvatarPreview(avatarUrl);toast("Foto profil berhasil diperbarui.");
});
$("saveProfileBtn").onclick=async()=>{
  if(!supabase)return socialMessage("Configure Supabase first.");
  const username=$("myUsername").value.trim(),bio=$("myBio").value.trim();
  if(username.length<3)return toast("Username needs at least 3 characters.");
  const {error}=await supabase.from("profiles").upsert({player_id:playerId,username,bio,elo:playerElo,last_seen:new Date().toISOString()},{onConflict:"player_id"});
  if(error){toast("Username may already be taken.");return;}
  localStorage.setItem("quietmove-username",username);toast("Profile saved.");
};
document.addEventListener("click",e=>{
  const add=e.target.closest("[data-add]");if(add)sendFriendRequest(add.dataset.add);
  const accept=e.target.closest("[data-accept]");if(accept)respondFriendRequest(accept.dataset.accept,true);
  const decline=e.target.closest("[data-decline]");if(decline)respondFriendRequest(decline.dataset.decline,false);
  const duel=e.target.closest("[data-duel]");if(duel)challengePlayer(duel.dataset.duel);
  const view=e.target.closest("[data-view]");if(view)viewPlayer(view.dataset.view);
  const duelAccept=e.target.closest("[data-duel-accept]");if(duelAccept)acceptDuel(duelAccept.dataset.duelAccept);
});

function getPlayerId() {
  let id = localStorage.getItem("quietmove-player");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("quietmove-player", id); }
  return id;
}
function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove("show"), 2300);
}
function isMyTurn() {
  // Online: only the seat assigned to this browser may move.
  if (roomId) return game.turn() === myColor;
  // Local bot match: the human controls White; Black is reserved for the bot.
  // Local free-play (no bot selected) remains two-sided.
  if (selectedBot !== null) return game.turn() === "w" && !botThinking;
  return true;
}
function updateBotProfile() {
  const bot = BOT_PROFILES[selectedBot] || activeRandomBot;
  $("botName").textContent = bot?.name || "No opponent selected";
  $("botDescription").textContent = bot?.style || "Choose an AI opponent to continue";
  $("botElo").textContent = bot?.elo || "—";
  $("botAvatar").textContent = bot?.avatar || "?";
  const playButton = $("playBotBtn");
  if (playButton) {
    playButton.disabled = !selectedBot;
    playButton.innerHTML = selectedBot ? 'Play against bot <span>↗</span>' : 'Choose an opponent first <span>↗</span>';
  }
}
function isEndgamePosition(board) {
  let queens=0, minorsAndRooks=0;
  for(const row of board)for(const piece of row)if(piece){if(piece.type==="q")queens++;if(["r","b","n"].includes(piece.type))minorsAndRooks++;}
  return queens===0 || minorsAndRooks<=4;
}

// Bot strength is derived from its displayed Elo. The numbers are practical
// browser difficulty settings, not official engine ratings.
function getBotStrength(bot) {
  const rating = Number(bot?.elo) || 400;
  if (rating < 650) return {depth:1, noise:175, nodes:1800, think:300};
  if (rating < 950) return {depth:2, noise:125, nodes:2600, think:350};
  if (rating < 1200) return {depth:2, noise:85, nodes:3600, think:400};
  if (rating < 1500) return {depth:2, noise:55, nodes:4800, think:450};
  if (rating < 1800) return {depth:3, noise:30, nodes:6200, think:550};
  if (rating < 2200) return {depth:3, noise:16, nodes:7600, think:650};
  if (rating < 2800) return {depth:4, noise:8, nodes:9000, think:750};
  return {depth:4, noise:2, nodes:11000, think:850};
}

function evaluatePosition(position, perspective, style) {
  const values = {p:100,n:325,b:335,r:500,q:950,k:20000};
  const board = position.board();
  let score = 0, bishops = {w:0,b:0}, pawnFiles = {w:Array(8).fill(0),b:Array(8).fill(0)};
  let kingSquares = {w:null,b:null};
  for (let r=0;r<8;r++) for (let f=0;f<8;f++) {
    const piece=board[r][f]; if(!piece)continue;
    const sign=piece.color===perspective?1:-1, type=piece.type;
    const center=(3.5-Math.abs(3.5-f))+(3.5-Math.abs(3.5-r));
    let positional=0;
    if(type==="n") positional += center*7;
    if(type==="b") positional += center*4;
    if(type==="p") {
      pawnFiles[piece.color][f]++;
      positional += (piece.color==="w"?(6-r):(r-1))*7;
      if(f>=2&&f<=5) positional+=8;
    }
    if(type==="r" && (piece.color==="w"?r===1:r===6)) positional+=18;
    if(type==="q" && style==="tactical") positional+=center*3;
    if(type==="k") {
      kingSquares[piece.color]={r,f};
      if(isEndgamePosition(board)) positional+=center*8;
      else positional-=center*5;
    }
    score+=sign*(values[type]+positional);
    if(type==="b")bishops[piece.color]++;
  }
  for(const color of ["w","b"]) {
    const sign=color===perspective?1:-1;
    if(bishops[color]>=2)score+=sign*32;
    for(let f=0;f<8;f++) {
      if(pawnFiles[color][f]>1)score-=sign*13*(pawnFiles[color][f]-1);
      if(pawnFiles[color][f] && !pawnFiles[color][Math.max(0,f-1)] && !pawnFiles[color][Math.min(7,f+1)]) score-=sign*10;
    }
    const king=kingSquares[color];
    if(king && !isEndgamePosition(board)) {
      const home=color==="w"?7:0;
      if(king.r===home && (king.f===6||king.f===2)) score+=sign*22;
    }
  }
  return score;
}

function moveOrderScore(move) {
  const values={p:100,n:325,b:335,r:500,q:950};
  let score=move.captured?(10*values[move.captured]-(values[move.piece]||0)):0;
  if(move.promotion)score+=800+(values[move.promotion]||0);
  if(move.flags?.includes("k")||move.flags?.includes("q"))score+=35;
  return score;
}

function botSearch(position, depth, alpha, beta, maximizingColor, style, budget) {
  if (budget.nodes++ > budget.maxNodes) return evaluatePosition(position,maximizingColor,style);
  if(position.isCheckmate()) return position.turn()===maximizingColor ? -100000-depth : 100000+depth;
  if(position.isDraw()) return 0;
  if(depth===0) return evaluatePosition(position,maximizingColor,style);
  const moves=position.moves({verbose:true}).sort((a,b)=>moveOrderScore(b)-moveOrderScore(a));
  const isMax=position.turn()===maximizingColor;
  let best=isMax?-Infinity:Infinity;
  for(const move of moves){
    const next=new Chess(position.fen()); next.move(move);
    const score=botSearch(next,depth-1,alpha,beta,maximizingColor,style,budget);
    if(isMax){best=Math.max(best,score);alpha=Math.max(alpha,best);}
    else{best=Math.min(best,score);beta=Math.min(beta,best);}
    if(beta<=alpha||budget.nodes>budget.maxNodes)break;
  }
  return best;
}

async function chooseBotMove() {
  const bot=activeRandomBot || BOT_PROFILES[selectedBot] || BOT_PROFILES.mitten;
  try {
    const move=await stockfishMove(game.fen(),bot);
    if(move && game.moves({verbose:true}).some(m=>m.from===move.from&&m.to===move.to&&(!move.promotion||m.promotion===move.promotion))) return move;
  } catch(error) {
    console.warn("Stockfish Lite unavailable, using built-in fallback AI:",error);
    toast("Stockfish tidak tersedia. Menggunakan AI cadangan.");
  }
  return chooseFallbackBotMove();
}
function chooseFallbackBotMove() {
  const bot=activeRandomBot || BOT_PROFILES[selectedBot] || BOT_PROFILES.mitten;
  const moves=game.moves({verbose:true});
  if(!moves.length)return null;
  const strength=getBotStrength(bot), style=selectedBot==="hikaru"?"tactical":selectedBot==="magnus"?"endgame":"classical";
  const budget={nodes:0,maxNodes:strength.nodes}; let best=-Infinity,choices=[];
  const ordered=moves.sort((a,b)=>moveOrderScore(b)-moveOrderScore(a));
  for(const move of ordered){
    const next=new Chess(game.fen()); next.move(move);
    const score=botSearch(next,strength.depth-1,-Infinity,Infinity,game.turn(),style,budget)+(Math.random()-.5)*strength.noise;
    if(score>best+.01){best=score;choices=[move];} else if(Math.abs(score-best)<.01)choices.push(move);
    if(budget.nodes>budget.maxNodes)break;
  }
  return choices[Math.floor(Math.random()*choices.length)]||ordered[0];
}
function scheduleBotMove() {
  if(roomId||selectedBot==null||game.isGameOver()||game.turn()!=="b"||botThinking)return;
  botThinking=true;
  $("statusTitle").textContent=(activeRandomBot?.name || BOT_PROFILES[selectedBot]?.name || "Bot")+" is thinking";
  $("statusDescription").textContent="Calculating a reply…";
  $("statusPill").textContent="BOT THINKING";
  $("playBotBtn").disabled=true;
  const botTurnFen = game.fen();
  botTimer=setTimeout(async()=>{
    try {
      const move=await chooseBotMove();
      // Discard stale engine output if the board changed while the bot was thinking.
      if(move && !roomId && game.turn()==="b" && game.fen()===botTurnFen) {
        const movingColor = game.turn();
        const result=game.move({from:move.from,to:move.to,promotion:move.promotion});
        if(result){addMoveIncrement(movingColor);playMoveSound(result);lastMove={from:result.from,to:result.to};}
      }
    } finally {
      botThinking=false;$("playBotBtn").disabled=false;render();
      if(adminAutoPlay && game.turn()==="w") setTimeout(adminAutoMoveIfNeeded,250);
    }
  },getBotStrength(activeRandomBot || BOT_PROFILES[selectedBot] || BOT_PROFILES.mitten).think);
}
function render() {
  paintClocks();
  updateMaterialCount();
  const board = $("board"); board.innerHTML = "";
  const files = flipped ? "hgfedcba" : "abcdefgh";
  const ranks = flipped ? "12345678" : "87654321";
  const moves = game.moves({ verbose:true });
  const targetSet = new Set(legalTargets.map(m => m.to));
  for (const rank of ranks) for (const file of files) {
    const square = file + rank, piece = game.get(square);
    const el = document.createElement("button");
    el.className = "square " + ((files.indexOf(file) + ranks.indexOf(rank)) % 2 === 0 ? "light":"dark");
    el.setAttribute("aria-label", square + (piece ? " " + piece.type : ""));
    if (selected === square) el.classList.add("selected");
    if (lastMove && (lastMove.from === square || lastMove.to === square)) el.classList.add("last-move");
    if (piece && piece.type === "k" && game.isCheck() && piece.color === game.turn()) el.classList.add("king-in-check");
    if (piece) {
      const p = document.createElement("span"); p.className = "piece " + (piece.color === "w" ? "white":"black");
      p.textContent = glyph[piece.color][piece.type]; el.appendChild(p);
      const plyNow=game.history().length;
      const quality=moveQualityByPly[plyNow];
      if(lastMove && lastMove.to===square && quality){
        const badge=document.createElement("span");badge.className="move-quality-badge "+quality.className;badge.textContent=quality.symbol;badge.title=quality.label+(quality.loss!==undefined?` · eval loss ${quality.loss/100} pawns`:"");el.appendChild(badge);
      }
    }
    if (targetSet.has(square)) {
      const marker = document.createElement("span");
      marker.className = piece ? "capture-ring":"move-dot"; el.appendChild(marker);
    }
    if (file === files[0]) { const c=document.createElement("span");c.className="coord rank";c.textContent=rank;el.appendChild(c); }
    if (rank === ranks[ranks.length-1]) { const c=document.createElement("span");c.className="coord file";c.textContent=file;el.appendChild(c); }
    el.addEventListener("click", () => onSquare(square));
    board.appendChild(el);
  }
  updatePanel();
}
function updatePanel() {
  const turn = game.turn(), check = game.isCheck(), over = game.isGameOver() || !!resignationResult || !!clockExpired;
  let title = turn === "w" ? "White to move":"Black to move";
  let description = "Choose a piece, then select a highlighted square.";
  let pill = turn === "w" ? "WHITE TO MOVE":"BLACK TO MOVE";
  if (resignationResult) { title = "Game resigned"; description = resignationResult; pill = "GAME OVER"; }
  else if (checkmate()) { title = "Checkmate"; description = (turn === "w" ? "Black":"White") + " wins the game."; pill = "GAME OVER"; }
  else if (game.isDraw()) { title = "Game drawn"; description = "The position is a draw."; pill = "GAME OVER"; }
  else if (check) { title = "Check"; description = "Your king is under attack. Find a safe move."; pill = "CHECK"; }
  if (roomId && !over && !isMyTurn()) description = "Opponent's turn. Waiting for their move.";
  if (roomId && !over && isMyTurn()) description = "It's your turn. Make a move.";
  $("statusTitle").textContent = title; $("statusDescription").textContent = description; $("statusPill").textContent = pill;
  if ($("resignBtn")) $("resignBtn").disabled = over || (roomId && !isMyTurn()) || botThinking;

  const castleMoves = game.moves({verbose:true}).filter(m => m.flags.includes("k") || m.flags.includes("q"));
  const kingCastle = castleMoves.find(m => m.flags.includes("k"));
  const queenCastle = castleMoves.find(m => m.flags.includes("q"));
  const canActNow = !over && !botThinking && (roomId ? turn === myColor : turn === "w");
  $("castleKingBtn").disabled = !kingCastle || !canActNow;
  $("castleQueenBtn").disabled = !queenCastle || !canActNow;
  $("castleKingBtn").classList.toggle("available", !!kingCastle && canActNow);
  $("castleQueenBtn").classList.toggle("available", !!queenCastle && canActNow);
  $("castleHint").textContent = (kingCastle || queenCastle)
    ? (canActNow ? "A legal castle is available. Choose short or long." : "Castling is available on this turn.")
    : "No legal castling move in this position.";

  $("whiteTurn").classList.toggle("active", turn === "w" && !over);
  $("blackTurn").classList.toggle("active", turn === "b" && !over);
  $("moveCount").textContent = `${game.history().length} MOVES`;
  const history = game.history();
  const list = $("moveList"); list.innerHTML = "";
  if (!history.length) list.innerHTML = '<div class="empty-history">Your game starts here.</div>';
  for (let i=0;i<history.length;i+=2) {
    const row = document.createElement("div"); row.className="move-row";
    const num=document.createElement("span");num.className="move-number";num.textContent=(i/2+1)+".";
    const white=document.createElement("span");white.textContent=history[i];
    const black=document.createElement("span");black.textContent=history[i+1]||"";
    if (i+1===history.length-1) black.classList.add("move-current");
    if (i===history.length-1) white.classList.add("move-current");
    row.append(num,white,black);list.appendChild(row);
  }
  list.scrollTop = list.scrollHeight;
  $("whiteName").textContent = roomId ? (myColor==="w" ? "You · White":"Opponent · White") : "You · White";
  $("blackName").textContent = roomId ? (myColor==="b" ? "You · Black":"Opponent · Black") : (activeRandomBot?.name || BOT_PROFILES[selectedBot]?.name || "Bot");
  $("whiteCaption").textContent = roomId ? (myColor==="w" ? "Your seat":"Playing online") : "Playing as White";
  $("blackCaption").textContent = roomId ? (myColor==="b" ? "Your seat":"Playing online") : "AI opponent · "+(activeRandomBot?.elo || BOT_PROFILES[selectedBot]?.elo || "—")+" Elo setting";
  updateEloDisplay();
  if (over) {
    settleMatchElo();
    scheduleReturnToHome();
  }
}

function scheduleReturnToHome() {
  if (finishReturnScheduled) return;
  finishReturnScheduled = true;
  clearTimeout(finishReturnTimer);
  toast("Pertandingan selesai. Kembali ke halaman awal dalam beberapa detik...");
  finishReturnTimer = setTimeout(async () => {
    try {
      if (roomId) await leaveCurrentRoom();
      stopMatchmaking();
      selectedBot = null;
      activeRandomBot = null;
      document.querySelectorAll(".bot-choice").forEach(button => button.classList.remove("active"));
      resetBoardForFreshGame();
      finishReturnScheduled = false;
      finishReturnTimer = null;
      if ($("roomStatus")) $("roomStatus").textContent = "Ready. Choose a game mode to begin.";
      if ($("connectionLabel")) $("connectionLabel").textContent = supabase ? "ONLINE READY" : "LOCAL GAME";
      updateBotProfile();
      render();
      window.scrollTo({top: 0, behavior: "smooth"});
      toast("Kembali ke halaman awal. Pilih mode untuk bermain lagi.");
    } catch (error) {
      console.error("Return to home failed:", error);
      finishReturnScheduled = false;
    }
  }, 5000);
}
function checkmate(){ return game.isCheckmate(); }
function onSquare(square) {
  if (!isMyTurn()) return toast(roomId ? "Tunggu giliran lawan." : "Bot sedang berpikir. Kamu hanya bisa menggerakkan bidak Putih.");
  if (clockExpired) return toast("Waktu habis. Pertandingan selesai.");
  if (resignationResult) return toast("Pertandingan sudah selesai.");
  if (roomMoveSaving) return toast("Mengirim langkah ke lawan...");
  if (game.isGameOver()) return toast("Game sudah selesai. Mulai game baru untuk bermain lagi.");
  if (!isMyTurn()) return toast("Tunggu giliran lawan.");
  const piece = game.get(square);
  if (selected) {
    const candidate = legalTargets.find(m => m.to === square);
    if (candidate) {
      if (candidate.promotion) return showPromotion(candidate);
      makeMove(candidate); return;
    }
  }
  if (piece && piece.color === game.turn()) {
    selected = square; legalTargets = game.moves({square,verbose:true}); render(); return;
  }
  selected = null; legalTargets = []; render();
}
function showPromotion(move) {
  pendingPromotion = move;
  const modal=$("promotionModal"), options=$("promotionOptions"); options.innerHTML="";
  for (const type of ["q","r","b","n"]) {
    const btn=document.createElement("button");btn.textContent=glyph[game.turn()][type];
    btn.title=({q:"Queen",r:"Rook",b:"Bishop",n:"Knight"})[type];
    btn.onclick=()=>{modal.classList.remove("open");makeMove({...move,promotion:type});pendingPromotion=null;};
    options.appendChild(btn);
  }
  modal.classList.add("open");
}
function makeMove(move) {
  // Central guard: blocks accidental opponent-piece moves in bot and online games.
  if (!isApplyingRemote && !isMyTurn()) {
    toast(roomId ? "Tunggu giliranmu." : "Sekarang giliran bot. Kamu tidak bisa menggerakkan bidak Hitam.");
    return;
  }
  try {
    const movingColor = game.turn();
    const beforeFen=game.fen();
    const result = game.move({from:move.from,to:move.to,promotion:move.promotion});
    if (!result) return;
    const afterFen=game.fen();
    const ply=game.history().length;
    const moveUci=result.from+result.to+(result.promotion||"");
    if(!game.isGameOver()) analyzeMoveQuality(beforeFen,afterFen,moveUci,movingColor,ply);
    addMoveIncrement(movingColor);
    playMoveSound(result);
    lastMove = {from:result.from,to:result.to}; selected=null;legalTargets=[];
    render();
    if (roomId && !isApplyingRemote) {
      saveRoom();
    } else if (!roomId && game.turn()==="b") {
      scheduleBotMove();
    }
    if(adminAutoPlay && game.turn()===(roomId?myColor:"w")) setTimeout(adminAutoMoveIfNeeded,250);
  } catch (e) { toast("Gerakan tidak valid."); }
}
$("castleKingBtn").onclick=()=>{
  const move=game.moves({verbose:true}).find(m=>m.flags.includes("k"));
  if(move && ! $("castleKingBtn").disabled) { makeMove(move); toast("Kingside castling · O-O"); }
};
$("castleQueenBtn").onclick=()=>{
  const move=game.moves({verbose:true}).find(m=>m.flags.includes("q"));
  if(move && ! $("castleQueenBtn").disabled) { makeMove(move); toast("Queenside castling · O-O-O"); }
};
$("cancelPromotion").onclick=()=>{$("promotionModal").classList.remove("open");pendingPromotion=null;};
$("newGameBtn").onclick=async()=>{
  clearTimeout(finishReturnTimer); finishReturnTimer = null; finishReturnScheduled = false;
  if (roomId) await leaveCurrentRoom();
  resetBoardForFreshGame();
  $("roomStatus").textContent="Ready for a new game.";
  $("connectionLabel").textContent="OFFLINE";
  render();
  toast("Board reset. You can start a new game or create a new room.");
};
$("flipBtn").onclick=()=>{flipped=!flipped;render();};
$("soundToggle").onclick=()=>{
  if (!soundEnabled) { setSoundEnabled(true); woodenTap(undefined,0.75,0); }
  else setSoundEnabled(false);
};
setSoundEnabled(soundEnabled);
updateBotProfile();
resetClock();
$("copyRoomBtn").onclick=async()=>{
  if(!roomId)return;
  const url=new URL(location.href);url.searchParams.set("room",roomId);
  await navigator.clipboard.writeText(url.toString());toast("Invite link copied.");
};


function setMatchmakingStatus(message) {
  const el = $("matchmakingStatus");
  if (el) el.textContent = message;
}
function setMatchmakingBusy(busy) {
  matchmakingActive = busy;
  if ($("matchmakingBtn")) $("matchmakingBtn").disabled = busy;
  if ($("cancelMatchmakingBtn")) $("cancelMatchmakingBtn").disabled = !busy;
}
function stopMatchmaking() {
  clearTimeout(matchmakingTimer);
  clearInterval(matchmakingPoll);
  matchmakingTimer = null;
  matchmakingPoll = null;
  setMatchmakingBusy(false);
}
function startRandomBotMatch() {
  stopMatchmaking();
  const bot = RANDOM_BOTS[Math.floor(Math.random() * RANDOM_BOTS.length)];
  activeRandomBot = {...bot, depth:bot.depth, seed:Math.floor(Math.random()*9999)};
  localMatchId = crypto.randomUUID(); resultApplied = false;
  selectedBot = "random";
  if (roomId && channel && supabase) {
    supabase.removeChannel(channel);
    channel = null;
  }
  roomId = null; roomRow = null; myColor = "w"; resultApplied = false;
  history.replaceState({}, "", location.pathname);
  resignationResult=null; game.reset(); selected = null; legalTargets = []; lastMove = null;
  $("roomStatus").textContent = `Practice match vs ${bot.name} · You play White.`;
  $("connectionLabel").textContent = "BOT MATCH";
  $("whiteCaption").textContent = "You are White";
  $("blackCaption").textContent = `${bot.name} · ${bot.elo} ELO`;
  if ($("botName")) $("botName").textContent = bot.name;
  if ($("botElo")) $("botElo").textContent = String(bot.elo);
  if ($("botAvatar")) $("botAvatar").textContent = bot.avatar;
  setMatchmakingStatus(`No player found. Matched with ${bot.name} (${bot.elo} Elo).`);
  render();
  toast(`Opponent found: ${bot.name}`);
}
async function attemptMatchmaking() {
  if (!supabase) {
    setMatchmakingStatus("Supabase belum dikonfigurasi. Matchmaking online membutuhkan koneksi Supabase.");
    toast("Configure Supabase first.");
    return;
  }
  if (roomId) {
    toast("Selesaikan atau tinggalkan room yang sedang aktif terlebih dahulu.");
    return;
  }
  setMatchmakingBusy(true);
  setMatchmakingStatus("Searching for an opponent...");
  const startedAt = Date.now();
  try {
    // First, look for a waiting player who is not this browser identity.
    const {data:waiting,error:findError} = await supabase
      .from("matchmaking_queue").select("*")
      .eq("status","waiting").neq("player_id",playerId)
      .order("created_at",{ascending:true}).limit(1);
    if (findError) throw findError;
    if (waiting && waiting.length) {
      const opponent = waiting[0];
      const roomCode = Math.random().toString(36).slice(2,8).toUpperCase();
      const roomInsert = await supabase.from("chess_rooms").insert({
        id:roomCode,fen:new Chess().fen(),pgn:"",white_id:opponent.player_id,
        black_id:playerId,updated_at:new Date().toISOString()
      }).select().single();
      if (roomInsert.error) throw roomInsert.error;
      const claim = await supabase.from("matchmaking_queue").update({
        status:"matched",room_id:roomCode,matched_with:playerId
      }).eq("id",opponent.id).eq("status","waiting").select().maybeSingle();
      if (claim.error) throw claim.error;
      if (!claim.data) {
        await supabase.from("chess_rooms").delete().eq("id",roomCode);
      } else {
        await supabase.from("matchmaking_queue").update({status:"matched",room_id:roomCode,matched_with:opponent.player_id})
          .eq("player_id",playerId).eq("status","waiting");
        stopMatchmaking();
        setMatchmakingStatus("Opponent found. Joining match...");
        await joinRoom(roomCode);
        return;
      }
    }
    // No opponent yet: add this player to the waiting queue.
    await supabase.from("matchmaking_queue").delete().eq("player_id",playerId).eq("status","waiting");
    const {error:queueError} = await supabase.from("matchmaking_queue").insert({
      player_id:playerId,status:"waiting"
    });
    if (queueError) throw queueError;
    setMatchmakingStatus("Searching for players... A bot will join if no one appears.");
    matchmakingPoll = setInterval(async()=>{
      if (!matchmakingActive) return;
      const result = await supabase.from("matchmaking_queue").select("*")
        .eq("player_id",playerId).eq("status","matched").order("created_at",{ascending:false}).limit(1);
      const match = result.data?.[0];
      if (match?.room_id) {
        stopMatchmaking();
        await supabase.from("matchmaking_queue").delete().eq("player_id",playerId);
        setMatchmakingStatus("Opponent found. Joining match...");
        await joinRoom(match.room_id);
      }
    },2000);
    matchmakingTimer = setTimeout(async()=>{
      if (!matchmakingActive) return;
      await supabase.from("matchmaking_queue").delete().eq("player_id",playerId).eq("status","waiting");
      startRandomBotMatch();
    },Math.max(0,MATCHMAKING_WAIT_MS-(Date.now()-startedAt)));
  } catch(error) {
    console.error("Matchmaking error:",error);
    stopMatchmaking();
    setMatchmakingStatus("Matchmaking failed. Check the SQL setup and Supabase connection.");
    toast("Matchmaking gagal. Periksa tabel matchmaking_queue.");
  }
}
$("matchmakingBtn")?.addEventListener("click",attemptMatchmaking);
$("cancelMatchmakingBtn")?.addEventListener("click",async()=>{
  stopMatchmaking();
  if(supabase) await supabase.from("matchmaking_queue").delete().eq("player_id",playerId).eq("status","waiting");
  setMatchmakingStatus("Search cancelled.");
});

async function leaveCurrentRoom() {
  if (roomSyncTimer) {
    clearInterval(roomSyncTimer);
    roomSyncTimer = null;
  }
  if (channel && supabase) {
    try { await supabase.removeChannel(channel); } catch (error) { console.warn("Room channel cleanup:", error); }
  }
  channel = null;
  roomId = null;
  roomRow = null;
  roomMoveSaving = false;
  isApplyingRemote = false;
  myColor = "w";
  resultApplied = false;
  $("copyRoomBtn").disabled = true;
  $("connectionLabel").textContent = "OFFLINE";
  $("blackCaption").textContent = "Waiting for opponent";
  const cleanUrl = new URL(location.href);
  cleanUrl.searchParams.delete("room");
  history.replaceState({}, "", cleanUrl.pathname + cleanUrl.search + cleanUrl.hash);
}

function resetBoardForFreshGame() {
  clearTimeout(botTimer);
  stopClock();
  botThinking = false;
  $("playBotBtn").disabled = false;
  activeRandomBot = null;
  resignationResult = null;
  localMatchId = null;
  resultApplied = false;
  game.reset();
  moveQualityByPly = {}; qualityAnalysisToken++;
  resetClock();
  selected = null;
  legalTargets = [];
  lastMove = null;
  pendingPromotion = null;
  $("promotionModal")?.classList.remove("open");
}

async function createRoom() {
  if (!supabase) return toast("Isi URL dan anon key Supabase di app.js terlebih dahulu.");
  $("createRoomBtn").disabled=true;
  try {
    if (roomId) await leaveCurrentRoom();
    resetBoardForFreshGame();
    render();
    const id = Math.random().toString(36).slice(2,8).toUpperCase();
    const {data,error}=await supabase.from("chess_rooms").insert({
      id,fen:game.fen(),pgn:game.pgn(),white_id:playerId,black_id:null,updated_at:new Date().toISOString()
    }).select().single();
    if(error)throw error;
    roomRow=data;roomId=id;myColor="w";resultApplied=false;localMatchId=null;await connectRoom();if(adminLoggedIn&&adminAutoPlay&&game.turn()===myColor)setTimeout(adminAutoMoveIfNeeded,350);
    history.replaceState({}, "", `?room=${id}`);
    $("roomStatus").textContent=`Room ${id} dibuat. Bagikan invite link ke teman.`;
    $("copyRoomBtn").disabled=false;$("connectionLabel").textContent="ONLINE · ROOM "+id;
    $("whiteCaption").textContent="You are hosting";render();toast("Room created. Invite your friend!");
  } catch(e) { console.error(e);toast("Gagal membuat room. Periksa konfigurasi Supabase."); }
  finally {$("createRoomBtn").disabled=false;}
}
async function joinRoom(id) {
  if (!supabase) { $("roomStatus").textContent="Konfigurasi Supabase belum diisi."; return; }
  try {
    let {data,error}=await supabase.from("chess_rooms").select("*").eq("id",id).single();
    if(error)throw error;
    if(data.white_id===playerId) myColor="w";
    else if(data.black_id===playerId) myColor="b";
    else if(!data.black_id) {
      const {data:updated,error:updateError}=await supabase.from("chess_rooms").update({black_id:playerId}).eq("id",id).is("black_id",null).select().single();
      if(updateError)throw updateError;
      if(updated){data=updated;myColor="b";}
      else {const retry=await supabase.from("chess_rooms").select("*").eq("id",id).single();data=retry.data;if(data.black_id===playerId)myColor="b";else return toast("Room sudah penuh.");}
    } else return toast("Room sudah penuh. Maksimal dua pemain.");
    if (roomId && roomId !== id) await leaveCurrentRoom();
    roomId=id;roomRow=data;resultApplied=false;localMatchId=null;resignationResult=null;if(adminLoggedIn&&adminAutoPlay&&game.turn()===myColor)setTimeout(adminAutoMoveIfNeeded,350);
    game.load(data.fen);selected=null;legalTargets=[];lastMove=null;
    await connectRoom();
    $("roomStatus").textContent=`Joined room ${id} as ${myColor==="w"?"White":"Black"}.`;
    $("copyRoomBtn").disabled=false;$("connectionLabel").textContent="ONLINE · ROOM "+id;
    render();toast("Connected to room.");
  } catch(e){console.error(e);toast("Room tidak ditemukan atau gagal diakses.");}
}
function applyRemoteRoomRow(row) {
  if (!row) return;
  if (row.result && String(row.result).toLowerCase().includes("resign")) {
    resignationResult = row.result;
    roomRow = row;
    render();
    toast(row.result);
    return;
  }
  if (row.fen && row.fen !== game.fen()) {
    // Never overwrite a move currently being committed by this device.
    if (roomMoveSaving) return;
    isApplyingRemote = true;
    try {
      const loaded = game.load(row.fen);
      if (loaded !== false) {
        roomRow = row;
        selected = null;
        legalTargets = [];
        lastMove = null;
        render();
        woodenTap(undefined, 0.88, 0);
        if(adminLoggedIn && adminAutoPlay && game.turn()===myColor) setTimeout(adminAutoMoveIfNeeded,350);
      }
    } catch (err) {
      console.error("Could not apply remote chess position:", err);
    } finally {
      isApplyingRemote = false;
    }
  } else {
    roomRow = row;
  }
  if (row.black_id) $("blackCaption").textContent = "Connected";
}

let roomSyncTimer = null;
let roomMoveSaving = false;
async function connectRoom() {
  if (channel) await supabase.removeChannel(channel);
  if (roomSyncTimer) clearInterval(roomSyncTimer);
  channel = supabase.channel("chess-room-" + roomId);
  channel.on("postgres_changes", {
    event: "*",
    schema: "public",
    table: "chess_rooms",
    filter: `id=eq.${roomId}`
  }, payload => {
    if (payload.new) applyRemoteRoomRow(payload.new);
  }).subscribe(status => {
    if (status === "SUBSCRIBED") {
      $("roomStatus").textContent = `Connected · room ${roomId}`;
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      $("roomStatus").textContent = "Realtime terputus · mencoba sinkronisasi otomatis";
      console.warn("Room realtime status:", status);
    }
  });

  // Polling fallback: keeps duel moves synced even if Realtime is delayed/unavailable.
  roomSyncTimer = setInterval(async () => {
    if (!roomId || !supabase || roomMoveSaving) return;
    const { data, error } = await supabase
      .from("chess_rooms").select("*").eq("id", roomId).maybeSingle();
    if (error) {
      console.warn("Room sync polling failed:", error);
      return;
    }
    if (data) applyRemoteRoomRow(data);
  }, 1200);

  if (roomRow?.black_id) $("blackCaption").textContent = "Connected";
}

async function saveRoom() {
  if (!supabase || !roomId || isApplyingRemote) return false;
  roomMoveSaving = true;
  try {
    const currentRoomId = roomId;
    const payload = {
      fen: game.fen(),
      pgn: game.pgn(),
      updated_at: new Date().toISOString(),
      result: resignationResult || (game.isCheckmate()
        ? (game.turn() === "w" ? "Black wins" : "White wins")
        : (game.isDraw() ? "Draw" : null)),
      completed_at: (game.isGameOver() || !!resignationResult)
        ? new Date().toISOString() : null
    };
    const { data, error } = await supabase
      .from("chess_rooms").update(payload).eq("id", currentRoomId).select().single();
    if (error) throw error;
    if (roomId === currentRoomId) roomRow = data;
    return true;
  } catch (error) {
    console.error("Room move sync failed:", error);
    toast("Langkah belum terkirim. Periksa koneksi, lalu coba lagi.");
    return false;
  } finally {
    roomMoveSaving = false;
  }
}
$("createRoomBtn").onclick=createRoom;
$("botChoiceGrid").addEventListener("click",e=>{
  const choice=e.target.closest("[data-bot]");
  if(!choice)return;
  selectedBot=choice.dataset.bot; activeRandomBot=null;
  $("botChoiceGrid").querySelectorAll(".bot-choice").forEach(btn=>btn.classList.toggle("active",btn===choice));
  updateBotProfile();
});
$("playBotBtn").onclick=()=>{
  clearTimeout(finishReturnTimer); finishReturnTimer = null; finishReturnScheduled = false;
  if(roomId){toast("Keluar dari room online sebelum bermain melawan bot.");return;}
  if(!selectedBot){toast("Pilih lawan AI terlebih dahulu.");return;}
  clearTimeout(botTimer);botThinking=false;
  activeRandomBot=null; resignationResult=null; game.reset();selected=null;legalTargets=[];lastMove=null;
  localMatchId = crypto.randomUUID(); resultApplied = false;
  resetClock(); startClock();
  $("roomStatus").textContent="Local bot match · You play White.";
  render();toast("New match vs "+BOT_PROFILES[selectedBot].name);
};

$("resignBtn").addEventListener("click", async () => {
  if (game.isGameOver() || resignationResult || clockExpired) return;
  if (!confirm("Yakin ingin menyerah dari pertandingan ini?")) return;
  stopClock();
  clearTimeout(botTimer);
  botThinking = false;
  const winner = roomId ? (myColor === "w" ? "Black" : "White") : "Black";
  resignationResult = `${winner} wins by resignation`;
  selected = null;
  legalTargets = [];
  if (roomId && supabase) {
    const {data,error} = await supabase.from("chess_rooms").update({
      result: resignationResult,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq("id",roomId).select().single();
    if (error) {
      console.error("Resign update failed:",error);
      toast("Gagal mengirim status menyerah. Periksa akses database.");
      resignationResult = null;
      render();
      return;
    }
    roomRow = data;
  }
  render();
  toast("Kamu menyerah. Pertandingan selesai.");
});

updateBotProfile();
updateEloDisplay();
if(supabase){
  refreshSocial();
  setInterval(()=>supabase.from("profiles").update({last_seen:new Date().toISOString(),elo:playerElo}).eq("player_id",playerId),30000);
}

const params=new URLSearchParams(location.search);
if(params.get("room")) {
  $("roomStatus").textContent="Joining room "+params.get("room")+"…";
  joinRoom(params.get("room").toUpperCase());
}
render();


/* Developer credits menu */
const creditsModal = $("creditsModal");
$("openCreditsBtn")?.addEventListener("click", () => {
  creditsModal?.classList.add("open");
  creditsModal?.setAttribute("aria-hidden", "false");
});
$("closeCreditsBtn")?.addEventListener("click", () => {
  creditsModal?.classList.remove("open");
  creditsModal?.setAttribute("aria-hidden", "true");
});
creditsModal?.addEventListener("click", event => {
  if (event.target === creditsModal) {
    creditsModal.classList.remove("open");
    creditsModal.setAttribute("aria-hidden", "true");
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && creditsModal?.classList.contains("open")) {
    creditsModal.classList.remove("open");
    creditsModal.setAttribute("aria-hidden", "true");
  }
});

$("timeOptions")?.addEventListener("click", (event) => {
  const option = event.target.closest("[data-base]");
  if (!option) return;
  selectedTimeBase = Number(option.dataset.base);
  selectedIncrement = Number(option.dataset.increment);
  $("timeOptions").querySelectorAll(".time-option").forEach(btn => btn.classList.toggle("active", btn===option));
  resetClock();
  toast(`Time control: ${option.querySelector("strong").textContent} ${option.querySelector("small").textContent}`);
});


/* Two-hour Blitz tournament lobby (registration + shared participant roster). */
const TOURNAMENT_INTERVAL_MS = 2 * 60 * 60 * 1000;
let tournamentTimer = null;
let currentTournamentId = null;
function getNextTournamentStart(now=Date.now()) {
  return (Math.floor(now / TOURNAMENT_INTERVAL_MS) + 1) * TOURNAMENT_INTERVAL_MS;
}
function tournamentIdFor(startMs) {
  return "qm-blitz-" + Math.floor(startMs / TOURNAMENT_INTERVAL_MS);
}
function formatTournamentCountdown(ms) {
  const sec=Math.max(0,Math.floor(ms/1000));
  return `${String(Math.floor(sec/3600)).padStart(2,"0")}:${String(Math.floor(sec%3600/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
}
async function loadTournamentLobby() {
  if (!supabase) {
    $("tournamentStatus").textContent="Supabase belum tersambung. Turnamen online belum tersedia.";
    $("tournamentJoinBtn").disabled=true;
    return;
  }
  const startMs=getNextTournamentStart();
  const startIso=new Date(startMs).toISOString();
  const id=tournamentIdFor(startMs);
  currentTournamentId=id;
  const {error:upsertError}=await supabase.from("qm_tournaments").upsert({
    id,starts_at:startIso,status:"registration"
  },{onConflict:"id",ignoreDuplicates:true});
  if(upsertError) {
    console.warn("Tournament lobby setup:",upsertError);
    $("tournamentStatus").textContent="Tabel turnamen belum siap. Jalankan SQL update turnamen.";
    $("tournamentJoinBtn").disabled=true;
    return;
  }
  const {data:entries,error}=await supabase.from("qm_tournament_entries")
    .select("player_id,username,elo,created_at")
    .eq("tournament_id",id).order("created_at",{ascending:true}).limit(32);
  if(error) {
    $("tournamentStatus").textContent="Gagal memuat peserta. Periksa izin tabel turnamen.";
    return;
  }
  const list=entries||[];
  $("tournamentPlayers").textContent=`${list.length} / 32`;
  $("tournamentProgress").style.width=`${Math.min(100,list.length/32*100)}%`;
  $("tournamentRoster").innerHTML=list.length?list.map((entry,i)=>
    `<div class="tournament-player"><span class="tournament-seed">${i+1}</span><span>${escapeHTML(entry.username||"Player")}</span><small>${Number(entry.elo)||400} ELO</small></div>`
  ).join(""):'<p class="social-empty">Belum ada peserta. Jadilah pendaftar pertama!</p>';
  const joined=list.some(x=>x.player_id===playerId);
  $("tournamentJoinBtn").hidden=joined;
  $("tournamentJoinBtn").disabled=list.length>=32;
  $("tournamentJoinBtn").textContent=list.length>=32?"Tournament full":"Join next tournament";
  $("tournamentLeaveBtn").hidden=!joined;
  $("tournamentStatus").textContent=joined?"Kamu sudah terdaftar. Kamu bisa membatalkan pendaftaran sebelum turnamen dimulai.":list.length>=32?"Kuota penuh. Pendaftaran ditutup.":"Pendaftaran terbuka sampai waktu mulai.";
  await loadTournamentTrophies();
}
async function joinNextTournament() {
  if(!supabase)return toast("Supabase belum tersambung.");
  const startMs=getNextTournamentStart();
  const id=tournamentIdFor(startMs);
  const username=localStorage.getItem("quietmove-username")||("Player"+playerId.slice(0,5));
  $("tournamentJoinBtn").disabled=true;
  const {error}=await supabase.from("qm_tournament_entries").insert({
    tournament_id:id,player_id:playerId,username,elo:playerElo
  });
  if(error) {
    console.warn("Tournament registration:",error);
    toast(error.code==="23505"?"Kamu sudah terdaftar.":"Pendaftaran gagal. Coba refresh.");
  } else toast("Berhasil mendaftar ke Blitz Tournament!");
  await loadTournamentLobby();
}
async function unregisterTournament(){
  if(!supabase||!currentTournamentId)return;
  const confirmed=confirm("Batalkan pendaftaran turnamen berikutnya?");
  if(!confirmed)return;
  const {error}=await supabase.from("qm_tournament_entries").delete().eq("tournament_id",currentTournamentId).eq("player_id",playerId);
  if(error){console.warn("Tournament unregister:",error);toast("Gagal membatalkan pendaftaran.");return;}
  toast("Pendaftaran turnamen dibatalkan.");
  await loadTournamentLobby();
}
async function loadTournamentTrophies() {
  if(!supabase)return;
  const {data,error}=await supabase.from("qm_tournament_trophies")
    .select("id,tournament_id,placement,awarded_at")
    .eq("player_id",playerId).order("awarded_at",{ascending:false}).limit(20);
  if(error)return;
  const trophies=data||[];
  $("tournamentTrophyCount").textContent=String(trophies.length);
  $("tournamentMyTrophies").innerHTML=trophies.length?trophies.map(t=>
    `<div class="tournament-player trophy-row"><span class="trophy-icon">🏆</span><span>Blitz Champion</span><small>${new Date(t.awarded_at).toLocaleDateString()}</small></div>`
  ).join(""):'<p class="social-empty">Belum ada piala. Menangkan turnamen untuk mengoleksinya.</p>';
}
function startTournamentTicker() {
  if(tournamentTimer)clearInterval(tournamentTimer);
  const tick=()=>{
    const remaining=getNextTournamentStart()-Date.now();
    $("tournamentCountdown").textContent=formatTournamentCountdown(remaining);
    if(remaining<=1000)loadTournamentLobby();
  };
  tick();
  tournamentTimer=setInterval(tick,1000);
}
$("tournamentJoinBtn")?.addEventListener("click",joinNextTournament);
$("tournamentLeaveBtn")?.addEventListener("click",unregisterTournament);
$("tournamentRefreshBtn")?.addEventListener("click",loadTournamentLobby);
startTournamentTicker();
if(supabase)loadTournamentLobby();



// Admin-only local analysis controls
$("adminLoginBtn")?.addEventListener("click",adminLogin);
$("adminPassword")?.addEventListener("keydown",e=>{if(e.key==="Enter")adminLogin();});
$("adminEmail")?.addEventListener("keydown",e=>{if(e.key==="Enter")adminLogin();});
$("adminAnalyzeBtn")?.addEventListener("click",analyzeAdminPosition);
$("adminPlayBestBtn")?.addEventListener("click",adminPlayBest);
$("adminLogoutBtn")?.addEventListener("click",async()=>{if(supabase)await supabase.auth.signOut();adminLoggedIn=false;adminAutoPlay=false;adminBestMove=null;updateAdminUI();toast("Admin logout.");});
$("adminAutoPlay")?.addEventListener("change",e=>{adminAutoPlay=e.target.checked;if(adminAutoPlay)adminAutoMoveIfNeeded();});
updateAdminUI();
if(supabase){ verifyAdminSession(); supabase.auth.onAuthStateChange((_event)=>{ setTimeout(verifyAdminSession,0); }); }
