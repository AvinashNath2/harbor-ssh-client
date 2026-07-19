/**
 * Parser for Harbor shell-integration OSC sequences.
 *
 * The terminal backend injects a small shell script that emits custom OSC 9001
 * markers around every command the user runs:
 *
 *   ESC ] 9001 ; start ; cmd=<base64> ; cwd=<base64> BEL
 *   ESC ] 9001 ; end   ; exit=<n>    ; dur=<ms>     BEL
 *
 * This parser sits between the raw byte stream and xterm.js.  It strips the
 * 9001 sequences (so they never appear in the visible terminal), passes all
 * other OSC sequences through unchanged, and fires structured events so the
 * caller can capture every command with its output, exit code, and duration.
 */

export interface OscStartEvent {
  type: "start";
  cmd: string;
  cwd: string;
  executedAt: number; // epoch ms — set by the parser when it sees the marker
}

export interface OscEndEvent {
  type: "end";
  exitCode: number | null;
  durationMs: number | null;
}

export type OscEvent = OscStartEvent | OscEndEvent;

/**
 * A segment returned by `OscParser.feed()`.
 *
 * `bytes` are the clean (non-Harbor-OSC) bytes that arrived BEFORE `event`.
 * `event` is the Harbor OSC event that terminated this segment, or `null` for
 * the trailing segment after the last event (or if no events occurred).
 *
 * Callers should process segments in order: write `bytes` to the terminal and
 * capture them as output (if a command is pending), THEN process `event`.
 * This guarantees that output bytes are associated with the correct command
 * even when output and the end-event arrive in the same PTY chunk.
 */
export interface ParseSegment {
  bytes: Uint8Array;
  event: OscEvent | null;
}

function parseParams(str: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of str.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    out[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return out;
}

function safeDecode(b64: string): string {
  try {
    return atob(b64);
  } catch {
    return b64;
  }
}

function parseHarborOsc(body: string): OscEvent | null {
  if (body.startsWith("start;")) {
    const p = parseParams(body.slice(6));
    return {
      type: "start",
      cmd: p.cmd ? safeDecode(p.cmd) : "",
      cwd: p.cwd ? safeDecode(p.cwd) : "",
      executedAt: Date.now(),
    };
  }
  if (body.startsWith("end;")) {
    const p = parseParams(body.slice(4));
    return {
      type: "end",
      exitCode: p.exit ? parseInt(p.exit, 10) : null,
      durationMs: p.dur ? parseInt(p.dur, 10) : null,
    };
  }
  return null;
}

/**
 * Stateful parser — create one instance per terminal tab and call `feed()`
 * for every chunk of raw bytes received from the PTY.
 *
 * Returns an ordered list of `ParseSegment`s.  Each segment contains the
 * clean bytes that arrived before its event (empty for back-to-back events).
 * The final segment always has `event: null` and holds any trailing bytes.
 */
export class OscParser {
  private inOsc = false;
  private oscBuf: number[] = [];
  // Guard against malformed/unterminated sequences growing the buffer without bound.
  private static readonly MAX_OSC = 65_536;

  feed(bytes: Uint8Array): ParseSegment[] {
    const segments: ParseSegment[] = [];
    let cur: number[] = [];
    let i = 0;

    while (i < bytes.length) {
      const b = bytes[i] ?? 0;

      if (this.inOsc) {
        // BEL (0x07) or ST (ESC \) terminates the OSC sequence.
        if (b === 0x07) {
          const ev = this.flushOsc("bel", cur);
          if (ev !== null) {
            segments.push({ bytes: new Uint8Array(cur), event: ev });
            cur = [];
          }
          i++;
        } else if (b === 0x1b && i + 1 < bytes.length && bytes[i + 1] === 0x5c) {
          const ev = this.flushOsc("st", cur);
          if (ev !== null) {
            segments.push({ bytes: new Uint8Array(cur), event: ev });
            cur = [];
          }
          i += 2;
        } else {
          this.oscBuf.push(b);
          if (this.oscBuf.length > OscParser.MAX_OSC) {
            // Runaway sequence — discard and return to normal mode.
            this.inOsc = false;
            this.oscBuf = [];
          }
          i++;
        }
      } else {
        // ESC ] starts an OSC sequence.
        if (b === 0x1b && i + 1 < bytes.length && bytes[i + 1] === 0x5d) {
          this.inOsc = true;
          this.oscBuf = [];
          i += 2;
        } else {
          cur.push(b);
          i++;
        }
      }
    }

    // Always push the trailing segment so callers can write remaining bytes.
    segments.push({ bytes: new Uint8Array(cur), event: null });
    return segments;
  }

  /**
   * Flushes the current OSC buffer.
   *
   * For Harbor sequences: returns the parsed event (bytes unchanged).
   * For foreign sequences: reconstructs them into `cleanBytes` (pass-through)
   * and returns null so the caller keeps accumulating.
   */
  private flushOsc(terminator: "bel" | "st", cleanBytes: number[]): OscEvent | null {
    const buf = this.oscBuf.slice();
    const seq = new TextDecoder().decode(new Uint8Array(buf));
    this.inOsc = false;
    this.oscBuf = [];

    if (seq.startsWith("9001;")) {
      return parseHarborOsc(seq.slice(5));
    }

    // Foreign OSC — reconstruct and pass through unchanged.
    cleanBytes.push(0x1b, 0x5d, ...buf);
    if (terminator === "st") {
      cleanBytes.push(0x1b, 0x5c);
    } else {
      cleanBytes.push(0x07);
    }
    return null;
  }
}

// Matches ESC [ ... letter  (CSI sequences, e.g. colour codes, cursor moves).
// Matches ESC <non-[>       (other two-byte escape sequences).
// eslint-disable-next-line no-control-regex
const CSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g;
// eslint-disable-next-line no-control-regex
const ESC_RE = /\x1b[^[]/g;

/** Strip ANSI/VT100 escape sequences so captured output is plain text. */
export function stripAnsi(raw: string): string {
  return raw.replace(CSI_RE, "").replace(ESC_RE, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
