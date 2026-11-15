# Running your own copy

The repo already points at a working Firebase project (`js/config.js`). Follow
these steps only to host your own copy with your own Firebase and Google Cloud
project. It takes about 10 minutes, once.

## 1. Firebase project
1. Create a project at https://console.firebase.google.com.
2. **Build → Authentication → Get started → Sign-in method → Google → Enable.**
3. **Build → Firestore Database → Create database** (production mode, any region).
4. **Firestore → Rules**: paste `firestore.rules` and click **Publish**.
5. **Project settings → General → Your apps → Web app (`</>`)**. Register it
   and copy the config object into `firebaseConfig` in `js/config.js`.

## 2. Google Cloud (same project)
At https://console.cloud.google.com, select the same project, then:
1. **APIs & Services → Library → Google Calendar API → Enable.**
2. **Google Auth Platform → Data access → Add scope** `.../auth/calendar.readonly`.
3. **Audience**: while the app is in *Testing*, add every Google account you
   want to link as a test user.
4. **Clients**: open **"Web client (auto created by Google Service)"**:
   - Copy its Client ID into `googleClientId` in `js/config.js`.
   - Under **Authorized JavaScript origins**, add `https://<user>.github.io`
     and `http://localhost:8000`.

## 3. Authorized domains
Firebase console → **Authentication → Settings → Authorized domains**, then
add `<user>.github.io`. `localhost` is already listed.

## 4. GitHub Pages
Push to a GitHub repo, then **Settings → Pages → Deploy from a branch → `main` / root**.
Or from the command line:
```sh
gh api -X POST repos/{owner}/{repo}/pages -f "source[branch]=main" -f "source[path]=/"
```
All paths are relative, so any repo name works. `.nojekyll` makes Pages serve
the files as they are.

## Notes
- **"Google hasn't verified this app"** appears while the OAuth app is in
  Testing. Click **Continue**. Personal use doesn't need verification.
- **Tokens last about an hour.** Browser-only apps get no refresh token, so
  when a token expires a Reconnect button appears. One click usually completes
  without asking again. Removing this limit would need a small backend, such as
  a Cloud Function on the Blaze plan.
