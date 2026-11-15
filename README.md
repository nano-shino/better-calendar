# Better Calendar

Your Google Calendar with a photo behind every event. It shows Day, Week and Month views and reads calendars from several Google accounts at once. It's a static site that runs on GitHub Pages. Your settings and uploaded photos sync through Firebase.

## How it works

| Piece | What it does |
|---|---|
| **Firebase Auth** (Google sign-in) | Identifies you. Your main Google account is linked automatically. |
| **Google Identity Services** | Gets a read-only Calendar token for each extra Google account you link. |
| **Google Calendar API** | Called straight from the browser with those tokens. |
| **Firestore** | Stores your linked accounts, hidden calendars, photo choices and uploaded photos. Uploads are shrunk to JPEG, under 750 KB each, so everything fits the free Spark plan. Cloud Storage isn't needed. |
| **Openverse** | Supplies the automatic Creative Commons photos. No key needed. |

Access tokens stay in your browser's localStorage and are never written to Firestore.

### Where each photo comes from (first match wins)
1. A photo you chose for this event
2. A photo you chose for every repeat of the series
3. A keyword photo (any title containing "gym", for example)
4. An image link in the event's description
5. An automatic photo matched to the title's theme or the location

Click any event to open it, then pick a suggestion, search, or upload, drop or paste your own photo.

### Keyboard
`D` `W` `M` switch views · `←` `→` move · `T` today · `Esc` closes the panel. On phones, swipe left or right.

## Setup (about 10 minutes, once)

### 1. Firebase project
1. Go to https://console.firebase.google.com and create a project. You can also add Firebase to the existing Google Cloud project used by `crunchroll-calendar`.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
3. **Build → Firestore Database → Create database** (production mode, any region).
4. **Firestore → Rules**: paste the contents of `firestore.rules` and click **Publish**.
5. **Project settings → General → Your apps → Web app (`</>`)**. Register it and copy `apiKey`, `authDomain`, `projectId` and `appId` into `js/config.js`.

### 2. Google Cloud (same project)
Open https://console.cloud.google.com, select the same project, then:
1. **APIs & Services → Library → Google Calendar API → Enable.**
2. **Google Auth Platform → Data access → Add scope** `.../auth/calendar.readonly`.
3. **Audience**: while the app is in *Testing*, add every Google account you want to link as a test user.
4. **Clients**: open **"Web client (auto created by Google Service)"**:
   - Copy its Client ID into `googleClientId` in `js/config.js`.
   - Under **Authorized JavaScript origins**, add `https://<your-github-username>.github.io` and `http://localhost:8000`.

### 3. Authorized domains
Firebase console → **Authentication → Settings → Authorized domains** → add `<your-github-username>.github.io`. `localhost` is already there.

### 4. Publish on GitHub Pages
```powershell
cd better-calendar
git init; git add .; git commit -m "Better Calendar"
gh repo create better-calendar --public --source . --push
gh api -X POST repos/{owner}/better-calendar/pages -f "source[branch]=main" -f "source[path]=/"
```
The site will be at `https://<username>.github.io/better-calendar/`. All paths are relative, so any repo name works.

### Try it locally
```powershell
python -m http.server 8000
```
Open http://localhost:8000. Before Firebase is set up, it shows sample events.

## Things to know
- **Reconnecting accounts.** Google gives browser-only apps tokens that last about an hour, with no refresh token unless a server is involved. When an account's token runs out, a "Reconnect" button appears. One click usually completes without asking again, because Google remembers your consent. Removing this limit would need a small backend, such as a Cloud Function on the Blaze plan.
- **"Google hasn't verified this app"** appears while the OAuth app is in Testing. Click **Continue**. For personal use you don't need to publish or verify it.
- If the same meeting is in two of your accounts, it's shown once.
- Events you declined are hidden.
