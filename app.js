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
let selectedBot = "magnus", botThinking = false, botTimer = null;
let playerElo = Number(localStorage.getItem("quietmove-elo") || 400);
let resultApplied = false;
const BOT_PROFILES = {
  magnus: {name:"Magnus Carlsen", elo:"2882", style:"Endgame technique · Positional pressure", depth:3, avatar:"M", seed:11},
  hikaru: {name:"Hikaru Nakamura", elo:"2816", style:"Tactical alertness · Dynamic play", depth:3, avatar:"H", seed:23},
  fischer: {name:"Bobby Fischer", elo:"2785", style:"Classical precision · Active pieces", depth:3, avatar:"B", seed:37},
  arya: {name:"Arya", elo:"5000", style:"Maximum setting · Fictional super-bot", depth:4, avatar:"A", seed:53}
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


if (SUPABASE_URL.startsWith("https://") && !SUPABASE_ANON_KEY.startsWith("YOUR_")) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  $("connectionLabel").textContent = "ONLINE READY";
} else {
  $("connectionLabel").textContent = "LOCAL GAME";
  $("roomStatus").textContent = "Tambahkan kredensial Supabase untuk mengaktifkan Mabar.";
}

function updateEloDisplay() {
  const el = $("playerElo");
  if (el) el.textContent = String(playerElo);
}
function settleOnlineResult() {
  if (!roomId || !game.isGameOver() || resultApplied) return;
  const key = "quietmove-result-" + roomId;
  if (localStorage.getItem(key)) { resultApplied = true; return; }
  resultApplied = true;
  let delta = 0, label = "Draw · Elo unchanged";
  if (game.isCheckmate()) {
    const winner = game.turn() === "w" ? "b" : "w";
    if (winner === myColor) {
      const fullMoves = Math.max(1, Math.ceil(game.history().length / 2));
      delta = Math.max(15, Math.min(80, 82 - fullMoves * 2));
      label = `Victory · +${delta} Elo`;
    } else {
      delta = -15;
      label = "Defeat · −15 Elo";
    }
  }
  playerElo = Math.max(100, playerElo + delta);
  localStorage.setItem("quietmove-elo", String(playerElo));
  localStorage.setItem(key, label);
  updateEloDisplay();
  toast(label);
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
  return `<article class="player-card"><div class="player-avatar">${escapeHTML((profile.username||"?").slice(0,1).toUpperCase())}</div><div class="player-info"><strong>${escapeHTML(profile.username)}</strong><small><i class="${online?"online":"offline"}"></i>${online?"Online":"Offline"} · ${Number(profile.elo)||400} Elo</small></div>${view}${btn}</article>`;
}
async function searchPlayers(){
  if(!supabase)return socialMessage("Configure Supabase terlebih dahulu.");
  const q=$("playerSearch").value.trim();
  if(!q)return socialMessage("Masukkan username atau Player ID.");
  const {data,error}=await supabase.from("profiles").select("player_id,username,elo,bio,last_seen").or(`username.ilike.%${q}%,player_id.eq.${q}`).neq("player_id",playerId).limit(20);
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
  const result=await supabase.from("profiles").select("player_id,username,elo,last_seen").in("player_id",ids);
  $("friendsList").innerHTML=(result.data||[]).map(x=>playerCard(x,"duel")).join("");
}
async function loadFriendRequests(){
  if(!supabase)return;
  const {data,error}=await supabase.from("friend_requests").select("*").eq("to_id",playerId).eq("status","pending").order("created_at",{ascending:false});
  if(error){$("friendRequests").innerHTML='<p class="social-empty">Friend requests table is not configured.</p>';return;}
  const ids=data.map(x=>x.from_id);
  const profiles=ids.length ? await supabase.from("profiles").select("player_id,username,elo,last_seen").in("player_id",ids) : {data:[]};
  $("friendRequests").innerHTML=data.map(req=>{
    const u=(profiles.data||[]).find(x=>x.player_id===req.from_id)||{username:"Player",elo:400};
    return `<article class="player-card"><div class="player-info"><strong>${escapeHTML(u.username)}</strong><small>Friend request · ${Number(u.elo)||400} Elo</small></div><button class="social-action" data-accept="${req.id}">Accept</button><button class="social-action muted" data-decline="${req.id}">Decline</button></article>`;
  }).join("") || '<p class="social-empty">No pending requests.</p>';
  const duels=await supabase.from("duel_requests").select("*").eq("to_id",playerId).eq("status","pending").order("created_at",{ascending:false});
  if(!duels.error && duels.data.length){
    const duelIds=duels.data.map(d=>d.from_id);
    const duelProfiles=await supabase.from("profiles").select("player_id,username,elo").in("player_id",duelIds);
    $("friendRequests").innerHTML += duels.data.map(d=>{
      const u=(duelProfiles.data||[]).find(x=>x.player_id===d.from_id)||{username:"Player",elo:400};
      return `<article class="player-card duel-invite"><div class="player-info"><strong>${escapeHTML(u.username)}</strong><small>Chess duel · ${escapeHTML(d.time_control||"10+0")}</small></div><button class="social-action" data-duel-accept="${d.id}">Accept duel</button></article>`;
    }).join("");
  }
}
async function loadMyProfile(){
  if(!supabase)return;
  const {data}=await supabase.from("profiles").select("*").eq("player_id",playerId).maybeSingle();
  if(data){$("myUsername").value=data.username||"";$("myBio").value=data.bio||"";}
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
function isMyTurn() { return !roomId || game.turn() === myColor; }
function updateBotProfile() {
  const bot = BOT_PROFILES[selectedBot];
  $("botName").textContent = bot.name;
  $("botDescription").textContent = bot.style;
  $("botElo").textContent = bot.elo;
  $("botAvatar").textContent = bot.avatar;
}
function isEndgamePosition(board) {
  let queens=0, minorsAndRooks=0;
  for(const row of board)for(const piece of row)if(piece){if(piece.type==="q")queens++;if(["r","b","n"].includes(piece.type))minorsAndRooks++;}
  return queens===0 || minorsAndRooks<=4;
}
function evaluatePosition(position, perspective, style) {
  const values = {p:100,n:320,b:335,r:500,q:900,k:20000};
  const board = position.board();
  let score = 0, bishops = {w:0,b:0};
  for (let r=0;r<8;r++) for (let f=0;f<8;f++) {
    const piece=board[r][f]; if(!piece)continue;
    const sign=piece.color===perspective?1:-1, type=piece.type;
    let positional=0;
    const center=(3.5-Math.abs(3.5-f))+(3.5-Math.abs(3.5-r));
    if(type==="n"||type==="b")positional+=center*5;
    if(type==="p")positional+=(piece.color==="w"?(6-r):(r-1))*5;
    if(type==="k"&&isEndgamePosition(board))positional+=center*5;
    if(type==="q"&&style==="tactical")positional+=center*2;
    score+=sign*(values[type]+positional);
    if(type==="b")bishops[piece.color]++;
  }
  if(bishops[perspective]>=2)score+=28;
  if(bishops[perspective==="w"?"b":"w"]>=2)score-=28;
  return score;
}
function botSearch(position, depth, alpha, beta, maximizingColor, style, budget) {
  if (depth===0 || position.isGameOver() || budget.nodes>18000) {
    budget.nodes++;
    if(position.isCheckmate()) return position.turn()===maximizingColor ? -100000-depth : 100000+depth;
    return evaluatePosition(position,maximizingColor,style);
  }
  budget.nodes++;
  const moves=position.moves({verbose:true});
  moves.sort((a,b)=>{
    const va=(b.captured?({p:100,n:320,b:335,r:500,q:900}[b.captured]||0):0)+(b.promotion?800:0);
    const vb=(a.captured?({p:100,n:320,b:335,r:500,q:900}[a.captured]||0):0)+(a.promotion?800:0);
    return va-vb;
  });
  const isMax=position.turn()===maximizingColor;
  let best=isMax?-Infinity:Infinity;
  for(const move of moves){
    const next=new Chess(position.fen());next.move(move);
    const score=botSearch(next,depth-1,alpha,beta,maximizingColor,style,budget);
    if(isMax){best=Math.max(best,score);alpha=Math.max(alpha,best);}
    else{best=Math.min(best,score);beta=Math.min(beta,best);}
    if(beta<=alpha||budget.nodes>18000)break;
  }
  return best;
}
function chooseBotMove() {
  const bot=activeRandomBot || BOT_PROFILES[selectedBot], moves=game.moves({verbose:true});
  if(!moves.length)return null;
  const style=activeRandomBot ? "classical" : (selectedBot==="hikaru"?"tactical":selectedBot==="magnus"?"endgame":"classical");
  const budget={nodes:0};
  let best=-Infinity, choices=[];
  for(const move of moves){
    const next=new Chess(game.fen());next.move(move);
    const score=botSearch(next,bot.depth-1,-Infinity,Infinity,game.turn(),style,budget);
    const noise=selectedBot==="hikaru"&&move.captured?5:0;
    const total=score+noise+(Math.random()-.5)*(selectedBot==="arya"?0.2:2.5);
    if(total>best+0.01){best=total;choices=[move];}
    else if(Math.abs(total-best)<0.01)choices.push(move);
    if(budget.nodes>18000)break;
  }
  return choices[Math.floor(Math.random()*choices.length)]||moves[0];
}
function scheduleBotMove() {
  if(roomId||selectedBot==null||game.isGameOver()||game.turn()!=="b"||botThinking)return;
  botThinking=true;
  $("statusTitle").textContent=BOT_PROFILES[selectedBot].name+" is thinking";
  $("statusDescription").textContent="Calculating a reply…";
  $("statusPill").textContent="BOT THINKING";
  $("playBotBtn").disabled=true;
  botTimer=setTimeout(()=>{
    const move=chooseBotMove();
    if(move) {
      const result=game.move({from:move.from,to:move.to,promotion:move.promotion});
      if(result){playMoveSound(result);lastMove={from:result.from,to:result.to};}
    }
    botThinking=false;$("playBotBtn").disabled=false;render();
  },selectedBot==="arya"?650:450);
}
function render() {
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
  const turn = game.turn(), check = game.isCheck(), over = game.isGameOver();
  let title = turn === "w" ? "White to move":"Black to move";
  let description = "Choose a piece, then select a highlighted square.";
  let pill = turn === "w" ? "WHITE TO MOVE":"BLACK TO MOVE";
  if (checkmate()) { title = "Checkmate"; description = (turn === "w" ? "Black":"White") + " wins the game."; pill = "GAME OVER"; }
  else if (game.isDraw()) { title = "Game drawn"; description = "The position is a draw."; pill = "GAME OVER"; }
  else if (check) { title = "Check"; description = "Your king is under attack. Find a safe move."; pill = "CHECK"; }
  if (roomId && !over && !isMyTurn()) description = "Opponent's turn. Waiting for their move.";
  if (roomId && !over && isMyTurn()) description = "It's your turn. Make a move.";
  $("statusTitle").textContent = title; $("statusDescription").textContent = description; $("statusPill").textContent = pill;

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
  $("blackName").textContent = roomId ? (myColor==="b" ? "You · Black":"Opponent · Black") : BOT_PROFILES[selectedBot].name;
  $("whiteCaption").textContent = roomId ? (myColor==="w" ? "Your seat":"Playing online") : "Playing as White";
  $("blackCaption").textContent = roomId ? (myColor==="b" ? "Your seat":"Playing online") : "AI opponent · "+BOT_PROFILES[selectedBot].elo+" Elo setting";
  updateEloDisplay();
  if (roomId && over) settleOnlineResult();
}
function checkmate(){ return game.isCheckmate(); }
function onSquare(square) {
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
  try {
    const result = game.move({from:move.from,to:move.to,promotion:move.promotion});
    if (!result) return;
    playMoveSound(result);
    lastMove = {from:result.from,to:result.to}; selected=null;legalTargets=[];
    render();
    if (roomId && !isApplyingRemote) saveRoom();
    else if (!roomId && game.turn()==="b") scheduleBotMove();
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
  if(roomId){toast("Keluar dari room untuk memulai game lokal.");return;}
  clearTimeout(botTimer);botThinking=false;$("playBotBtn").disabled=false;
  game.reset();selected=null;legalTargets=[];lastMove=null;render();toast("New game started.");
};
$("flipBtn").onclick=()=>{flipped=!flipped;render();};
$("soundToggle").onclick=()=>{
  if (!soundEnabled) { setSoundEnabled(true); woodenTap(undefined,0.75,0); }
  else setSoundEnabled(false);
};
setSoundEnabled(soundEnabled);
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
  selectedBot = "random";
  if (roomId && channel && supabase) {
    supabase.removeChannel(channel);
    channel = null;
  }
  roomId = null; roomRow = null; myColor = "w"; resultApplied = false;
  history.replaceState({}, "", location.pathname);
  game.reset(); selected = null; legalTargets = []; lastMove = null;
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

async function createRoom() {
  if (!supabase) return toast("Isi URL dan anon key Supabase di app.js terlebih dahulu.");
  $("createRoomBtn").disabled=true;
  try {
    const id = Math.random().toString(36).slice(2,8).toUpperCase();
    const {data,error}=await supabase.from("chess_rooms").insert({
      id,fen:game.fen(),pgn:game.pgn(),white_id:playerId,black_id:null,updated_at:new Date().toISOString()
    }).select().single();
    if(error)throw error;
    roomRow=data;roomId=id;myColor="w";resultApplied=false;await connectRoom();
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
    roomId=id;roomRow=data;resultApplied=false;
    game.load(data.fen);selected=null;legalTargets=[];lastMove=null;
    await connectRoom();
    $("roomStatus").textContent=`Joined room ${id} as ${myColor==="w"?"White":"Black"}.`;
    $("copyRoomBtn").disabled=false;$("connectionLabel").textContent="ONLINE · ROOM "+id;
    render();toast("Connected to room.");
  } catch(e){console.error(e);toast("Room tidak ditemukan atau gagal diakses.");}
}
async function connectRoom() {
  if(channel) await supabase.removeChannel(channel);
  channel=supabase.channel("chess-room-"+roomId);
  channel.on("postgres_changes",{event:"UPDATE",schema:"public",table:"chess_rooms",filter:`id=eq.${roomId}`},payload=>{
    const row=payload.new;
    if(row.updated_at===roomRow?.updated_at)return;
    if(row.fen!==game.fen()) {
      isApplyingRemote=true;
      try {game.load(row.fen);woodenTap(undefined,0.88,0);roomRow=row;selected=null;legalTargets=[];lastMove=null;render();}
      finally {isApplyingRemote=false;}
    }
    roomRow=row;
    if(row.black_id) $("blackCaption").textContent="Connected";
  }).subscribe(status=>{
    if(status==="SUBSCRIBED") $("roomStatus").textContent=`Connected · room ${roomId}`;
  });
  if(roomRow?.black_id) $("blackCaption").textContent="Connected";
}
async function saveRoom() {
  if(!supabase||!roomId)return;
  const {data,error}=await supabase.from("chess_rooms").update({
    fen:game.fen(),pgn:game.pgn(),updated_at:new Date().toISOString(),
    result:game.isCheckmate()?(game.turn()==="w"?"Black wins":"White wins"):(game.isDraw()?"Draw":null),
    completed_at:game.isGameOver()?new Date().toISOString():null
  }).eq("id",roomId).select().single();
  if(error){console.error(error);toast("Gagal menyinkronkan langkah.");}
  else roomRow=data;
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
  if(roomId){toast("Keluar dari room online sebelum bermain melawan bot.");return;}
  clearTimeout(botTimer);botThinking=false;$("playBotBtn").disabled=false;
  activeRandomBot=null; game.reset();selected=null;legalTargets=[];lastMove=null;
  $("roomStatus").textContent="Local bot match · You play White.";
  render();toast("New match vs "+BOT_PROFILES[selectedBot].name);
};
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
