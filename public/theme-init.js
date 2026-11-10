// Blocking on purpose: applies a stored theme before first paint, so a user who
// overrode the system theme never sees a flash of the other one.
try {
  const theme = localStorage.getItem('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  // Storage can be unavailable; the system theme applies.
}
