// Whether the Worker is turning this screen's key down (401): a key that doesn't fix itself (an old
// shared key after a rotation, a revoked device), unlike a network blip. lib/api.js sets it; App.svelte
// shows a banner that says so, rather than the quiet "Offline" a blip gets.
export const keyState = $state({ rejected: false });
