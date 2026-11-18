# Quiet Move — Chess

Aplikasi catur browser berbasis HTML, CSS, dan JavaScript. Aturan catur ditangani oleh `chess.js`; multiplayer realtime menggunakan Supabase.

## Jalankan lokal
1. Buka folder ini dengan VS Code.
2. Jalankan server lokal (misalnya ekstensi Live Server).
3. Untuk permainan lokal, langsung main. Untuk Mabar, lanjutkan konfigurasi Supabase.

## Aktifkan multiplayer
1. Buat project di https://supabase.com.
2. Buka SQL Editor, lalu jalankan seluruh isi `supabase.sql`.
3. Di Supabase, buka Database > Publications dan aktifkan tabel `chess_rooms` pada publication `supabase_realtime`.
4. Buka Project Settings > API. Salin Project URL dan anon/public key.
5. Tempel keduanya pada bagian paling atas `app.js`:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
6. Deploy folder ini ke Vercel sebagai project statis. Framework preset: Other. Build command dan output directory dapat dikosongkan/default.

## Cara Mabar
1. Pemain pertama klik **Create room**.
2. Klik **Copy invite**, lalu kirim tautan ke teman.
3. Teman membuka tautan tersebut. Host bermain putih, teman bermain hitam.
4. Langkah akan disinkronkan melalui Supabase Realtime.

## Catatan keamanan
SQL contoh memakai kebijakan RLS terbuka untuk memudahkan demo tanpa akun. Ini cocok untuk prototipe privat, bukan layanan publik yang aman. Sebelum membuka aplikasi untuk umum, tambahkan autentikasi, validasi hak pemain di database/RPC, rate limiting, dan kebijakan RLS yang membatasi perubahan hanya untuk pemain dalam room. Jangan pernah memasukkan `service_role` key ke frontend. Gunakan hanya anon/public key.

## Teknologi
- HTML, CSS, JavaScript ES modules
- chess.js untuk legal move, check, checkmate, castling, en passant, dan promotion
- Supabase Database + Realtime untuk multiplayer


## Bermain melawan bot
Di panel **Choose your opponent**, pilih salah satu lawan:
- Magnus Carlsen — label Elo 2882
- Hikaru Nakamura — label Elo 2816
- Bobby Fischer — label Elo 2785
- Arya — label Elo 5000 (karakter fiksi)

Klik **Play against bot**. Pemain manusia memegang putih dan bot memegang hitam. Bot memilih langkah legal dengan pencarian minimax/alpha-beta sederhana dan evaluasi posisi. Nama-nama grandmaster hanya dipakai sebagai profil simulasi gaya bermain, bukan mesin resmi, replika kemampuan, atau dukungan dari tokoh tersebut. Angka Elo adalah label profil, bukan rating hasil pengujian. Khusus Arya 5000 adalah rating fiksi; bot ini bukan engine 5000 Elo yang tervalidasi.


## Personal Elo rating (multiplayer)
- A new local player starts at 400 Elo.
- Rating is saved in the browser's localStorage on that device/browser.
- In friend rooms, a checkmate win increases rating based on game length: fewer full moves means a larger gain (between +15 and +80).
- A checkmate loss reduces 15 Elo; a draw does not change rating.
- Bot matches do not change the personal Elo.
- This is a lightweight prototype rating, not a full competitive Elo/Glicko system. For a cross-device account rating, store authenticated player profiles and validate results server-side.


## Castling (rokade)
The chess interface includes explicit Kingside (O-O) and Queenside (O-O-O) controls. They become active only when `chess.js` reports a legal castling move for the player whose turn it is. Players can also castle by selecting the king and tapping its castling destination square. The chess engine enforces the normal castling conditions, including unmoved king/rook, clear path, and no castling through or out of check. Castling is recorded in move history using standard notation.


## Wooden move sound
A small Web Audio sound synthesizer adds a warm, short wooden-piece tap when a legal move is made. Captures use a slightly stronger impact and castling plays a paired tap. The Sound button toggles effects on/off and the preference is saved in local browser storage. On mobile browsers, audio starts after the first user interaction because of autoplay restrictions. No external audio files are required.


## Social features (prototype)
This update adds player search, public player profiles, friend requests, friend list, incoming duel invitations, profile editing, online/offline activity (last_seen heartbeat), and completed-room history with PGN metadata.

### Supabase setup
Run the updated `supabase.sql` in the Supabase SQL Editor. It creates `profiles`, `friend_requests`, `friendships`, and `duel_requests`, and adds result/completed_at fields to `chess_rooms`.

The current app still identifies a player using a browser-generated local player ID, not Supabase Auth. This is a convenient prototype identity only: it is not a secure login, can differ across devices, and open demo RLS policies allow impersonation/tampering. Before public release, implement Supabase Auth, bind profiles to `auth.uid()`, and replace the demo policies with strict ownership/participant policies and server-validated duel/game results.

Presence uses a 30-second last_seen heartbeat; a player is shown online for 90 seconds after the last heartbeat. Match history lists rooms that have a completed_at value. For fully trustworthy match results and Elo, finalize games and rating changes in a database function/edge function after validating the PGN and participants.


## Quick matchmaking
- Tekan **Find opponent** untuk mencari pemain yang sedang menunggu.
- Sistem menunggu maksimal sekitar 15 detik. Jika tidak ada lawan, game dimulai melawan bot dengan nama dan Elo acak.
- Matchmaking membutuhkan tabel `matchmaking_queue` dari `supabase.sql`.
- Bot acak adalah simulasi lokal di browser, bukan pemain sungguhan.

## Panduan pemasangan lewat Android
1. Unduh ZIP proyek ini lalu ekstrak memakai ZArchiver atau Files.
2. Buka folder `quiet-move-chess` di Acode.
3. Buka `app.js`, cari `YOUR_SUPABASE_URL` dan `YOUR_SUPABASE_ANON_KEY`.
4. Isi URL Project dan anon/publishable key dari Supabase Project Settings > API. Jangan pernah memasukkan `service_role` key ke website.
5. Di Supabase, buka SQL Editor, buat query baru, tempel seluruh isi `supabase.sql`, lalu tekan Run. Jika sebelumnya sudah menjalankan SQL versi lama, jalankan lagi seluruh script terbaru ini.
6. Buat repository GitHub baru, unggah seluruh isi folder `quiet-move-chess` (bukan file ZIP-nya).
7. Buka Vercel melalui Chrome, pilih Add New > Project, impor repository GitHub tersebut, lalu tekan Deploy.
8. Setiap update: unggah file yang berubah ke repository yang sama dan commit. Vercel akan melakukan redeploy otomatis.
9. Uji matchmaking dengan dua perangkat/browser berbeda. Jika tidak ada pemain yang menunggu, setelah kurang lebih 15 detik sistem akan memulai bot acak.

### Catatan penting
Versi ini masih prototipe tanpa Supabase Auth. Identitas pemain dibuat per browser, dan kebijakan RLS demo masih terbuka. Jangan gunakan untuk kompetisi publik atau menyimpan data sensitif sebelum menambahkan autentikasi, kebijakan RLS ketat, dan validasi hasil pertandingan di server.
