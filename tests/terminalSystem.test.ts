import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

const terminalApi = read("src/terminal/terminalApi.ts");
const terminalView = read("src/terminal/TerminalView.tsx");
const terminalCss = read("src/styles/terminal.css");
const terminalRust = read("src-tauri/src/terminal/mod.rs");
const commandRegistry = read("src/core/commandRegistry.ts");
const shortcuts = read("src/core/useKeyboardShortcuts.ts");
const capabilities = JSON.parse(read("src-tauri/capabilities/default.json"));
const tauriConfig = JSON.parse(read("src-tauri/tauri.conf.json"));

test("1. Terminal uses a native PTY with backend-owned shells and session IDs", () => {
  assert.match(terminalRust, /native_pty_system\(\)/);
  assert.match(terminalRust, /fn discover_shells\(\)/);
  assert.match(terminalRust, /Uuid::new_v4\(\)\.to_string\(\)/);
  assert.match(terminalRust, /fn validate_cwd\(/);
  assert.match(terminalRust, /emit_to\(session\.owner\.as_str\(\)/);
  assert.doesNotMatch(
    terminalRust,
    /pub fn spawn_terminal_session[\s\S]{0,500}shell_path:\s*(String|PathBuf)/,
    "frontend must never supply a shell path"
  );
});

test("2. Terminal I/O is base64 encoded and races are handled explicitly", () => {
  assert.match(terminalApi, /bytesToBase64/);
  assert.match(terminalApi, /base64ToBytes/);
  assert.match(terminalApi, /dace:\/\/terminal-output/);
  assert.match(terminalApi, /dace:\/\/terminal-exit/);
  assert.match(terminalView, /pendingRef/);
  assert.match(terminalView, /dispose\(\)/);
  assert.doesNotMatch(terminalApi, /simulat/i);
  assert.doesNotMatch(terminalView, /fake|mock output/i);
});

test("3. Terminal command is available with a real shortcut", () => {
  assert.match(commandRegistry, /id: "nav:terminal"/);
  assert.match(commandRegistry, /shortcut: "Alt\+6"/);
  assert.doesNotMatch(commandRegistry, /nav:terminal[\s\S]{0,400}available: false/);
  assert.match(shortcuts, /setActiveActivity\("terminal"\)/);
});

test("4. Tauri capabilities and CSP are hardened", () => {
  assert.ok(
    capabilities.permissions.includes("core:window:allow-start-dragging"),
    "custom title bar needs explicit drag permission"
  );
  const csp: string = tauriConfig.app.security.csp;
  assert.notEqual(csp, null, "CSP must not be disabled");
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /connect-src[^;]*ipc:/);
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
});

test("5. Terminal grid reserves every row so the scrollback never collapses", () => {
  assert.match(terminalCss, /\.terminal-header\s*\{[^}]*grid-row:\s*1/s);
  assert.match(terminalCss, /\.terminal-context\s*\{[^}]*grid-row:\s*2/s);
  assert.match(terminalCss, /\.terminal-error\s*\{[^}]*grid-row:\s*3/s);
  assert.match(terminalCss, /\.terminal-surfaces\s*\{[^}]*grid-row:\s*4/s);
  assert.match(terminalCss, /\.terminal-footer\s*\{[^}]*grid-row:\s*5/s);
});

test("6. Terminal input is discoverable and sessions only start explicitly", () => {
  assert.match(terminalView, /Focus terminal input/);
  assert.match(terminalView, /terminalsRef\.current\.get\(session\.sessionId\)\?\.focus\(\)/);
  assert.match(terminalView, /value=\{shellChoice\}/);
  assert.match(terminalView, /onChange=\{\(event\) => setShellChoice\(event\.target\.value\)\}/);
  assert.doesNotMatch(terminalView, /onChange=\{\(event\) => void spawnSession/);
  assert.match(terminalRust, /fn display_path_string\(/);
});
