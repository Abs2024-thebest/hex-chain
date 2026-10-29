/* ==========================================================================
   HEX CHAIN — real-time sync between the Host Dashboard and Contestant Board.

   MVP approach: both pages run in the host's browser (the board is opened as a
   second window and screen-shared in Teams). They talk over BroadcastChannel,
   which is instant, needs no server and works on any static host. The latest
   public state is also cached in localStorage so a board opened (or refreshed)
   later catches up immediately, and the `storage` event is a fallback for
   browsers without BroadcastChannel.

   Only the *public* state is ever sent — answers never leave the host page.
   To sync across different computers, swap this file for a Firebase/Supabase/
   Ably adapter exposing the same publish()/onState API (see README).
   ========================================================================== */

const CHANNEL = 'hexchain-sync-v1';
const PUBLIC_KEY = 'hexchain-public-state-v1';
const PING_KEY = 'hexchain-board-ping-v1';
const hasBC = typeof BroadcastChannel !== 'undefined';

export class HostSync {
  constructor({ onBoardSeen } = {}) {
    this.last = null;
    this.onBoardSeen = onBoardSeen;
    this.bc = hasBC ? new BroadcastChannel(CHANNEL) : null;
    if (this.bc) this.bc.onmessage = (e) => this.handle(e.data);
    else {
      window.addEventListener('storage', (e) => {
        if (e.key !== PING_KEY || !e.newValue) return;
        try { this.handle(JSON.parse(e.newValue)); } catch { /* ignore */ }
      });
    }
  }

  handle(msg) {
    if (msg?.type !== 'hello') return;
    this.onBoardSeen?.(msg.id);
    if (msg.needState && this.last) this.bc?.postMessage({ type: 'state', state: this.last });
  }

  publish(state) {
    this.last = state;
    try { localStorage.setItem(PUBLIC_KEY, JSON.stringify(state)); } catch { /* storage full/blocked */ }
    this.bc?.postMessage({ type: 'state', state });
  }
}

export class BoardSync {
  constructor(onState) {
    this.id = Math.random().toString(36).slice(2, 10);
    this.onState = onState;
    this.bc = hasBC ? new BroadcastChannel(CHANNEL) : null;
    if (this.bc) {
      this.bc.onmessage = (e) => e.data?.type === 'state' && onState(e.data.state);
    } else {
      window.addEventListener('storage', (e) => {
        if (e.key !== PUBLIC_KEY || !e.newValue) return;
        try { onState(JSON.parse(e.newValue)); } catch { /* ignore */ }
      });
    }
  }

  start() {
    try {
      const cached = localStorage.getItem(PUBLIC_KEY);
      if (cached) this.onState(JSON.parse(cached));
    } catch { /* ignore */ }
    this.hello(true);
    setInterval(() => this.hello(false), 2000);
  }

  hello(needState) {
    const msg = { type: 'hello', id: this.id, needState, t: Date.now() };
    if (this.bc) this.bc.postMessage(msg);
    else try { localStorage.setItem(PING_KEY, JSON.stringify(msg)); } catch { /* ignore */ }
  }
}
