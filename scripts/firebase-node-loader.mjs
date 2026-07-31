const FIREBASE_NODE_IMPORTS = new Map([
  [
    "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js",
    "firebase/app",
  ],
  [
    "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js",
    "firebase/auth",
  ],
  [
    "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js",
    "firebase/database",
  ],
]);

export async function resolve(specifier, context, nextResolve) {
  return nextResolve(FIREBASE_NODE_IMPORTS.get(specifier) || specifier, context);
}
