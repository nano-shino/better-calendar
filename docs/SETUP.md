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

The warning "Google hasn't verified this app" is expected while the app is in
Testing: click Continue.
