/**
 * config.js — App configuration
 * ⚠️  Do NOT commit real values to a public GitHub repo.
 *     Use the pattern below: keep config.example.js in git,
 *     and create config.js locally (add to .gitignore).
 *
 * For GitHub Pages (public repo), store credentials
 * in a GitHub Actions secret and inject at build time,
 * OR prompt the user to enter them on first launch (see below).
 */

const APP_CONFIG = {
  // Paste your Apps Script Web App URL here
  // Format: https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
  SCRIPT_URL: "",

  // Must match SECRET_TOKEN in Code.gs exactly
  TOKEN: "",

  // App settings
  APP_NAME:      "DCA Tracker",
  VERSION:       "1.0.0",
  SYNC_INTERVAL: 5 * 60 * 1000, // auto-sync every 5 minutes (0 = disabled)
};
