/* src/App.css */

@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');

/* --- RESET & BASE --- */
* { box-sizing: border-box; }

body {
  margin: 0;
  padding: 0;
  background-color: #000;
  color: #eee;
  font-family: 'Fira Code', monospace;
  overflow: hidden;
}

#root { width: 100vw; height: 100vh; }

.app-layout {
  position: relative;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at center, #111, #000);
}

/* --- THEMES (Colors) --- */
.theme-green { --c-prim: #0f0; --c-sec: #0a0; --c-bg: #050a05; }
.theme-amber { --c-prim: #fb0; --c-sec: #970; --c-bg: #110d00; }
.theme-plasma { --c-prim: #0ef; --c-sec: #80f; --c-bg: #050010; }
.theme-matrix { --c-prim: #0f0; --c-sec: #050; --c-bg: #000; }

/* --- FULL SCREEN TERMINAL --- */
.terminal-container {
  width: 100%;
  height: 100%;
  background: var(--c-bg);
  padding: 20px 30px; /* Slight padding for readibility */
  overflow-y: auto;
  position: relative;
  z-index: 2;
  font-size: 1rem;
}

/* --- HUD (Fixed Top Right) --- */
.hud-container {
  position: fixed;
  top: 15px;
  right: 25px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  z-index: 1000;
  pointer-events: none; /* Let clicks pass through */
  font-family: 'Fira Code', monospace;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 5px;
  font-size: 0.75rem;
  font-weight: bold;
  letter-spacing: 1px;
  color: #666;
  text-transform: uppercase;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #333;
  transition: all 0.3s;
}
.status-dot.on { background: #0f0; box-shadow: 0 0 5px #0f0; }
.status-dot.off { background: #f00; box-shadow: 0 0 5px #f00; animation: blink 1s infinite; }

.balance-display {
  font-size: 1.5rem;
  color: var(--c-prim);
  font-weight: bold;
  text-shadow: 0 0 8px var(--c-prim);
  letter-spacing: 1px;
  background: rgba(0,0,0,0.5);
  padding: 2px 8px;
  border: 1px solid var(--c-sec);
}

/* --- TERMINAL CONTENT --- */
.line { margin-bottom: 4px; white-space: pre-wrap; line-height: 1.4; word-wrap: break-word; }
.line.command { color: #fff; font-weight: bold; margin-top: 15px; opacity: 0.8; }
.line.system { color: #888; font-style: italic; font-size: 0.9em; }
.line.error { color: #f44 !important; font-weight: bold; }
.line.success { color: var(--c-prim) !important; font-weight: bold; text-shadow: 0 0 5px var(--c-prim); }
.line.warning { color: #ffeb3b !important; }
.line.info { opacity: 0.9; color: #ccc; border-bottom: 1px dashed #333; padding-bottom: 5px; margin-bottom: 10px; }
.line.special { 
  color: #ffeb3b !important; 
  border-left: 3px solid #ffeb3b; 
  padding-left: 10px; 
  font-weight: bold; 
}

/* --- ART (Monospace preservation) --- */
.line.art {
  font-family: 'Courier New', monospace;
  white-space: pre;
  line-height: 1.0;
  overflow-x: auto;
  color: var(--c-prim);
  text-shadow: 0 0 3px var(--c-prim);
  margin: 15px 0;
  font-weight: bold;
}

/* --- INPUT --- */
.input-line { 
  display: flex; 
  align-items: center; 
  margin-top: 15px; 
  border-top: 1px solid #222;
  padding-top: 10px;
}
.prompt { margin-right: 10px; color: var(--c-prim); font-weight: bold; white-space: nowrap; text-shadow: 0 0 5px var(--c-prim); }

input {
  background: transparent;
  border: none;
  outline: none;
  font-family: inherit;
  font-size: 1rem;
  color: #fff;
  caret-color: var(--c-prim);
  width: 100%;
}

/* --- VISUALS --- */
#matrix-canvas { position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 0; display: none; opacity: 0.2; }
.scanline {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.1) 50%), 
              linear-gradient(90deg, rgba(255, 0, 0, 0.03), rgba(0, 255, 0, 0.01), rgba(0, 0, 255, 0.03));
  background-size: 100% 3px, 3px 100%;
  pointer-events: none; z-index: 10;
}

/* Boot Screen */
.boot-screen {
  display: flex; flex-direction: column; justify-content: center; align-items: center;
  height: 100vh; width: 100vw; background: #000; cursor: pointer; z-index: 9999;
  font-family: 'Fira Code', monospace; color: #0f0;
}
.boot-screen h1 { font-size: 3rem; text-shadow: 0 0 15px #0f0; margin-bottom: 20px; animation: pulse 3s infinite; }
.boot-screen p { color: #0a0; font-size: 1rem; animation: blink 1.5s infinite; letter-spacing: 2px; }

@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.7; } 100% { opacity: 1; } }
@keyframes blink { 0% { opacity: 1; } 50% { opacity: 0.3; } 100% { opacity: 1; } }

/* Scrollbar */
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: var(--c-bg); }
::-webkit-scrollbar-thumb { background: #333; border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: #555; }
