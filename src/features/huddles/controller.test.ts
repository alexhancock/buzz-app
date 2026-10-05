import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RelaySession } from "../relay/session";
import type { HuddleHost } from "../relay/transport";

const audio = vi.hoisted(() => ({
  send: undefined as
    | undefined
    | ((opus: Uint8Array, timestamp: number, level: number) => void),
  play: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./audio", () => ({
  startHuddleAudio: async (send: typeof audio.send) => {
    audio.send = send;
    return {
      setMuted: vi.fn(),
      play: audio.play,
      drop: vi.fn(),
      close: audio.close,
    };
  },
}));
const { huddles } = await import("./controller");

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | undefined;
  readyState = 1;
  binaryType = "blob";
  sent: (string | Uint8Array)[] = [];
  onmessage?: (event: { data: unknown }) => Promise<void> | void;
  onclose?: () => void;
  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  send(data: string | Uint8Array) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}
const viewer = "a".repeat(64);
const peer = "b".repeat(64);
const parent = "11111111-1111-4111-8111-111111111111";
const relayUrl = "wss://relay.test";

function session(events: unknown[] = []) {
  const published: { kind: number; tags: string[][]; content: string }[] = [];
  const huddle: HuddleHost = {
    relayUrl,
    query: vi.fn(async () => events as never),
    writer: {
      sign: vi.fn(async (template) => ({
        ...template,
        id: "1".repeat(64),
        pubkey: viewer,
        sig: "2".repeat(128),
      })) as never,
      publish: vi.fn(async (event) => {
        published.push(event);
      }),
    },
  };
  return {
    published,
    huddle,
    session: { viewer, huddle } as unknown as RelaySession,
  };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket);
});
afterEach(() => {
  huddles.leave();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it("starts a huddle, authenticates the audio socket, and streams once joined", async () => {
  const { session: relay, published } = session();
  await huddles.join(relay, parent);
  const [backing, start] = published;
  expect(backing?.kind).toBe(9007);
  const id = backing?.tags[0]?.[1];
  expect(start).toMatchObject({
    kind: 48100,
    tags: [["h", parent]],
    content: JSON.stringify({ ephemeral_channel_id: id }),
  });
  const socket = FakeSocket.last as FakeSocket;
  expect(socket.url).toBe(`${relayUrl}/huddle/${id}/audio`);
  expect(huddles.snapshot().status).toBe("connecting");

  audio.send?.(new Uint8Array([1]), 0, -20);
  expect(socket.sent).toHaveLength(0); // no audio before admission
  await socket.onmessage?.({
    data: JSON.stringify({ type: "challenge", challenge: "c" }),
  });
  const auth = JSON.parse(socket.sent[0] as string);
  expect(auth).toMatchObject({
    type: "auth",
    parent_channel_id: parent,
    protocol_version: 2,
    event: {
      kind: 22242,
      tags: [
        ["relay", relayUrl],
        ["challenge", "c"],
      ],
    },
  });
  await socket.onmessage?.({
    data: JSON.stringify({
      type: "joined",
      pubkey: viewer,
      peers: [
        { pubkey: viewer, peer_index: 0 },
        { pubkey: peer, peer_index: 1 },
      ],
    }),
  });
  expect(huddles.snapshot()).toMatchObject({
    status: "live",
    participants: [viewer, peer],
  });
  audio.send?.(new Uint8Array([1]), 960, -20);
  expect(socket.sent[1]).toBeInstanceOf(Uint8Array);
  await socket.onmessage?.({
    data: new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0xec, 0, 5]).buffer,
  });
  expect(audio.play).toHaveBeenCalledWith(1, new Uint8Array([5]));

  huddles.leave();
  expect(JSON.parse(socket.sent.at(-1) as string)).toEqual({ type: "leave" });
  expect(audio.close).toHaveBeenCalled();
  expect(huddles.snapshot().status).toBe("idle");
});

it("joins an active huddle without creating another", async () => {
  const backing = "0123abcd-0000-4000-8000-000000000000";
  const { session: relay, published } = session([
    {
      kind: 48100,
      pubkey: peer,
      created_at: Math.floor(Date.now() / 1000) - 5,
      content: JSON.stringify({ ephemeral_channel_id: backing }),
      tags: [["h", parent]],
    },
  ]);
  await huddles.join(relay, parent);
  expect(published).toEqual([]);
  expect(FakeSocket.last?.url).toBe(`${relayUrl}/huddle/${backing}/audio`);
});

it("surfaces relay refusals and an unexpected close", async () => {
  const { session: relay } = session();
  await huddles.join(relay, parent);
  await FakeSocket.last?.onmessage?.({
    data: JSON.stringify({ type: "error", message: "not a member" }),
  });
  expect(huddles.snapshot()).toMatchObject({
    status: "error",
    error: "not a member",
  });
  expect(audio.close).toHaveBeenCalled();

  await huddles.join(relay, parent);
  FakeSocket.last?.close();
  expect(huddles.snapshot().error).toBe("The huddle connection closed.");
  await flush();
});
