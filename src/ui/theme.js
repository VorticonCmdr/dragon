// Theme preference: follows the system until the user picks one.

const KEY = 'theme';

function stored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function effectiveTheme() {
  const theme = document.documentElement.dataset.theme;
  if (theme) return theme;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function toggleTheme() {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // The choice then simply lasts for this page view.
  }
  return next;
}

export function initTheme() {
  const theme = stored();
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
}
