VALLEY RESCUE ACLS SIMULATOR - GITHUB PAGES + FIREBASE STARTER

WHAT THIS IS
- A clean two-screen browser starter.
- student.html = monitor display
- instructor.html = control screen
- Firebase Realtime Database handles the live sync.

FILES
- index.html
- student.html
- instructor.html
- styles.css
- app.js
- firebase-config.js
- firebase-rules-example.json

STEP 1 - CREATE GITHUB REPO
1. Create a new GitHub repo.
2. Upload all of these files to the root of the repo.
3. In GitHub repo settings, turn on GitHub Pages.
4. Publish from the main branch root folder.

STEP 2 - CREATE FIREBASE PROJECT
1. Go to Firebase console.
2. Create a project.
3. Add a Web App.
4. Go to Realtime Database and create a database.
5. For first testing, use test mode.
6. Copy your web app config.
7. Paste it into firebase-config.js.

STEP 3 - TEST
1. Open your GitHub Pages URL.
2. Open student.html?session=demo-alpha on one device.
3. Open instructor.html?session=demo-alpha on another device.
4. Use the same session code in both.

IMPORTANT
- This starter is meant to get live syncing working in the same way your website works: upload files, publish, test.
- The Firebase rules example is open for initial testing. Tighten security before public release.
- Later, you can add login, password protection, license checks, or paid access controls.
