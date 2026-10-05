import type { EventTemplate } from "nostr-tools";

/** Wire contract shared with old Buzz desktop/mobile and the relay audio room. */
export const HUDDLE_STARTED = 48100;
export const HUDDLE_ENDED = 48103;
export const HUDDLE_TTL_SECONDS = 3600;
export const HUDDLE_PROTOCOL_VERSION = 2;
/** Relay "speaking" threshold and visual hold. */
export const SPEAKING_DBOV = -55;
export const SPEAKING_HOLD_MS = 600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PUBKEY = /^[0-9a-f]{64}$/;
const now = () => Math.floor(Date.now() / 1000);

export type HuddleEvent = Readonly<{
  kind: number;
  pubkey: string;
  created_at: number;
  content: string;
  tags: readonly (readonly string[])[];
}>;
export type HuddlePeer = Readonly<{ pubkey: string; peer_index: number }>;
export type HuddleControl =
  | { type: "challenge"; challenge: string }
  | { type: "joined"; pubkey: string; peers: HuddlePeer[] }
  | { type: "left"; pubkey: string; peer_index: number }
  | { type: "roster"; peers: HuddlePeer[] }
  | { type: "error"; message: string };

const startContent = (backing: string) =>
  JSON.stringify({ ephemeral_channel_id: backing });

/** Private, TTL-bounded stream channel that carries one huddle's membership. */
export function backingTemplate(id: string): EventTemplate {
  return {
    kind: 9007,
    created_at: now(),
    content: "",
    tags: [
      ["h", id],
      ["name", `huddle-${id.slice(0, 8)}`],
      ["visibility", "private"],
      ["channel_type", "stream"],
      ["ttl", String(HUDDLE_TTL_SECONDS)],
    ],
  };
}
export function startTemplate(parent: string, backing: string): EventTemplate {
  return {
    kind: HUDDLE_STARTED,
    created_at: now(),
    content: startContent(backing),
    tags: [["h", parent]],
  };
}
/** NIP-42 for the audio endpoint: `relay` is the community base URL, not the huddle URL. */
export function authTemplate(relay: string, challenge: string): EventTemplate {
  return {
    kind: 22242,
    created_at: now(),
    content: "",
    tags: [
      ["relay", relay],
      ["challenge", challenge],
    ],
  };
}

const exact = (
  tags: readonly (readonly string[])[],
  expected: readonly (readonly string[])[],
) => JSON.stringify(tags) === JSON.stringify(expected);

/** Host signing boundary: only these three exact shapes, never a general signer. */
export function validateHuddleTemplate(
  event: EventTemplate,
  relay: string,
): void {
  const id = event?.tags?.[0]?.[1] ?? "";
  const valid =
    !!event &&
    Number.isSafeInteger(event.created_at) &&
    event.created_at >= 0 &&
    Array.isArray(event.tags) &&
    (event.kind === 9007
      ? UUID.test(id) &&
        event.content === "" &&
        exact(event.tags, backingTemplate(id).tags)
      : event.kind === HUDDLE_STARTED
        ? UUID.test(id) &&
          event.tags.length === 1 &&
          exact(event.tags, [["h", id]]) &&
          UUID.test(huddleId(event.content) ?? "")
        : event.kind === 22242 &&
          event.content === "" &&
          typeof event.tags[1]?.[1] === "string" &&
          !!event.tags[1][1] &&
          event.tags[1][1].length <= 4096 &&
          exact(event.tags, [
            ["relay", relay],
            ["challenge", event.tags[1][1]],
          ]));
  if (!valid) throw new Error("Invalid huddle command");
}

/** Backing channel named by a start/end. Relay-signed ends carry extra fields. */
function linkedId(content: string): string | undefined {
  try {
    const id = (JSON.parse(content) as { ephemeral_channel_id?: unknown })
      .ephemeral_channel_id;
    return typeof id === "string" && UUID.test(id) ? id : undefined;
  } catch {
    return undefined;
  }
}
/** Signing accepts only the exact start content this client produces. */
function huddleId(content: string): string | undefined {
  const id = linkedId(content);
  return id && content === startContent(id) ? id : undefined;
}

/** Newest unexpired start in this parent without a matching end. */
export function activeHuddle(
  events: readonly HuddleEvent[],
  parent: string,
  at = now(),
): string | undefined {
  const scoped = events.filter(
    (event) =>
      event.tags.length >= 1 &&
      event.tags.filter(([name]) => name === "h").length === 1 &&
      event.tags.some(([name, value]) => name === "h" && value === parent),
  );
  const ended = new Set(
    scoped
      .filter((event) => event.kind === HUDDLE_ENDED)
      .map((event) => linkedId(event.content)),
  );
  return scoped
    .filter(
      (event) =>
        event.kind === HUDDLE_STARTED &&
        event.created_at > at - HUDDLE_TTL_SECONDS &&
        event.created_at <= at + 60,
    )
    .sort((a, b) => b.created_at - a.created_at)
    .map((event) => linkedId(event.content))
    .find((id): id is string => !!id && !ended.has(id));
}

/** Client → relay: seq u16 | ts u32 | level i8 | flags u8 | opus (network byte order). */
export function encodeFrame(
  seq: number,
  timestamp: number,
  level: number,
  opus: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(8 + opus.length);
  const view = new DataView(frame.buffer);
  view.setUint16(0, seq & 0xffff);
  view.setUint32(2, timestamp >>> 0);
  view.setInt8(6, Math.max(-127, Math.min(0, Math.round(level))));
  frame.set(opus, 8);
  return frame;
}
/** Relay → client: peer u8 | the same 8-byte header | opus. */
export function decodeFrame(data: ArrayBuffer) {
  if (data.byteLength <= 9 || data.byteLength > 4097) return undefined;
  const view = new DataView(data);
  return {
    peer: view.getUint8(0),
    level: view.getInt8(7),
    opus: new Uint8Array(data, 9),
  };
}

const peers = (input: unknown): HuddlePeer[] | undefined =>
  Array.isArray(input) &&
  input.every(
    (peer) =>
      PUBKEY.test(peer?.pubkey) &&
      Number.isInteger(peer?.peer_index) &&
      peer.peer_index >= 0 &&
      peer.peer_index <= 255,
  )
    ? input.map(({ pubkey, peer_index }) => ({ pubkey, peer_index }))
    : undefined;

/** Unknown or malformed control messages are ignored (undefined). */
export function parseControl(text: string): HuddleControl | undefined {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!data || typeof data !== "object") return undefined;
  const roster = peers(data.peers);
  switch (data.type) {
    case "challenge":
      return typeof data.challenge === "string" && data.challenge
        ? { type: "challenge", challenge: data.challenge }
        : undefined;
    case "joined":
      return typeof data.pubkey === "string" &&
        PUBKEY.test(data.pubkey) &&
        roster
        ? { type: "joined", pubkey: data.pubkey, peers: roster }
        : undefined;
    case "left":
      return typeof data.pubkey === "string" &&
        Number.isInteger(data.peer_index)
        ? {
            type: "left",
            pubkey: data.pubkey,
            peer_index: data.peer_index as number,
          }
        : undefined;
    case "roster":
      return roster ? { type: "roster", peers: roster } : undefined;
    case "error":
    case "restricted":
      return {
        type: "error",
        message:
          typeof data.message === "string" && data.message.length <= 200
            ? data.message
            : "The huddle is unavailable.",
      };
    default:
      return undefined;
  }
}
