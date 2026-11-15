# Running your own copy

`js/config.js` already points at a working project. You only need this to host
a copy with your own Firebase and Google Cloud project.

1. **Firebase** (https://console.firebase.google.com): create a project, then:
   - enable **Authentication → Google**;
   - create a **Firestore** database and publish `firestore.rules`;
   - register a **web app** and copy its config into `firebaseConfig` in `js/config.js`.
2. **Google Cloud** (same project):
   - enable the **Google Calendar API**;
   - under **Google Auth Platform**, add the scope `calendar.readonly`;
   - while the app is in Testing, add each account you'll link as a test user;
   - in the auto-created **Web client**, add the Authorized JavaScript origins
     `https://<user>.github.io` and `http://localhost:8000`, and copy its
     Client ID into `googleClientId`.
3. **Firebase → Authentication → Settings → Authorized domains:** add `<user>.github.io`.
4. **GitHub → Settings → Pages:** deploy from the `main` branch, root folder.
5. **Token server** (optional, keeps accounts connected; without it, each
   account needs a Reconnect click every hour). The same code (`worker/index.js`)
   runs on Cloudflare or on your own Linux machine. Either way:
   - **Publish the app** (Google Auth Platform → Audience → *In production*).
     While it is in Testing, Google expires refresh tokens after 7 days.
   - Put its HTTPS URL in `tokenWorkerUrl` in `js/config.js`.
   - The values in `wrangler.toml` / `server.env.example` are for this project's
     site; change them if you run your own copy.

   **a. Cloudflare Workers (free plan).** Use `npx wrangler login`, or an API
   token with *Workers Scripts: Edit* and *Workers KV Storage: Edit* in
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`:
   ```sh
   cd worker
   npx wrangler kv namespace create TOKENS      # paste the id into wrangler.toml
   npx wrangler secret put GOOGLE_CLIENT_SECRET # the Web client's secret (step 2)
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | npx wrangler secret put TOKEN_KEY
   npx wrangler deploy                          # prints the https://….workers.dev URL
   ```

   **b. Your own Linux machine** (Node 22+, systemd). Tokens are kept in
   `/var/lib/better-calendar-tokens/tokens.json`, encrypted.
   ```sh
   scp -r worker you@machine:better-calendar-worker
   ssh you@machine 'sudo sh better-calendar-worker/install-linux.sh'
   ssh you@machine 'sudoedit /etc/better-calendar-tokens.env'   # set GOOGLE_CLIENT_SECRET
   ssh you@machine 'sudo systemctl start better-calendar-tokens'
   ```
   Rerun the first two lines to update. It listens on `127.0.0.1:8787` and
   needs HTTPS in front, because the site is HTTPS. Pick one:
   - **Tailscale Funnel**, with no domain or open ports:
     `sudo tailscale funnel --bg 8787` gives `https://<machine>.<tailnet>.ts.net`.
   - **Cloudflare Tunnel**, if you have a domain on Cloudflare:
     `cloudflared tunnel --url http://127.0.0.1:8787`, or a named tunnel for a fixed hostname.
   - **Caddy**, if the machine has a domain and ports 80/443 open. In `/etc/caddy/Caddyfile`:
     `tokens.example.com { reverse_proxy 127.0.0.1:8787 }`

   To try it locally: `node --env-file=worker/.env worker/server.mjs`, using
   `server.env.example` as the starting point for `worker/.env`.

The warning "Google hasn't verified this app" is expected for an unverified
app (Testing, or In production without verification): click Continue.
