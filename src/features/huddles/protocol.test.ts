import { describe, expect, it } from "vitest";
import {
  activeHuddle,
  authTemplate,
  backingTemplate,
  decodeFrame,
  encodeFrame,
  parseControl,
  startTemplate,
  validateHuddleTemplate,
} from "./protocol";

const relay = "wss://relay.test";
const parent = "11111111-1111-4111-8111-111111111111";
const backing = "0123abcd-0000-4000-8000-000000000000";
const viewer = "a".repeat(64);

describe("huddle signing boundary", () => {
  it("accepts only the exact backing, start and audio-auth shapes", () => {
    for (const template of [
      backingTemplate(backing),
      startTemplate(parent, backing),
      authTemplate(relay, "challenge"),
    ])
      expect(() => validateHuddleTemplate(template, relay)).not.toThrow();
    expect(backingTemplate(backing).tags).toEqual([
      ["h", backing],
      ["name", "huddle-0123abcd"],
      ["visibility", "private"],
      ["channel_type", "stream"],
      ["ttl", "3600"],
    ]);
  });

  it.each([
    [
      "an open backing channel",
      {
        ...backingTemplate(backing),
        tags: backingTemplate(backing).tags.map((t) =>
          t[0] === "visibility" ? ["visibility", "open"] : t,
        ),
      },
    ],
    [
      "a renamed backing channel",
      {
        ...backingTemplate(backing),
        tags: backingTemplate(backing).tags.map((t) =>
          t[0] === "name" ? ["name", "Team"] : t,
        ),
      },
    ],
    [
      "extra start content",
      {
        ...startTemplate(parent, backing),
        content: JSON.stringify({ ephemeral_channel_id: backing, x: 1 }),
      },
    ],
    [
      "a start without a channel",
      { ...startTemplate(parent, backing), tags: [] },
    ],
    ["auth for another relay", authTemplate("wss://other.test", "challenge")],
    ["auth without a challenge", authTemplate(relay, "")],
    [
      "an ordinary message",
      { kind: 9, created_at: 1, content: "hi", tags: [["h", parent]] },
    ],
  ])("rejects %s", (_, template) => {
    expect(() => validateHuddleTemplate(template, relay)).toThrow(
      "Invalid huddle command",
    );
  });
});

describe("active huddle discovery", () => {
  const at = 1_700_000_000;
  const event = (kind: number, id: string, created_at = at - 10) => ({
    kind,
    pubkey: viewer,
    created_at,
    content: JSON.stringify({ ephemeral_channel_id: id }),
    tags: [["h", parent]],
  });
  const other = "22222222-2222-4222-8222-222222222222";

  it("returns the newest unexpired start without an end", () => {
    expect(
      activeHuddle(
        [event(48100, other, at - 60), event(48100, backing)],
        parent,
        at,
      ),
    ).toBe(backing);
    expect(
      activeHuddle([event(48100, backing), event(48103, backing)], parent, at),
    ).toBeUndefined();
    expect(
      activeHuddle([event(48100, backing, at - 3600)], parent, at),
    ).toBeUndefined();
    expect(activeHuddle([event(48100, backing)], other, at)).toBeUndefined();
  });

  it("honors the relay's own end event, which carries extra fields", () => {
    const relayEnd = {
      ...event(48103, backing),
      pubkey: "f".repeat(64),
      content: JSON.stringify({
        ephemeral_channel_id: backing,
        generation: "g1",
      }),
      tags: [
        ["h", parent],
        ["p", viewer],
      ],
    };
    expect(
      activeHuddle([event(48100, backing), relayEnd], parent, at),
    ).toBeUndefined();
  });
});

describe("audio wire", () => {
  it("frames v2 headers and reads the relay's peer prefix", () => {
    const frame = encodeFrame(
      0x1_0002,
      0x1_0000_0003,
      -200,
      new Uint8Array([9]),
    );
    expect([...frame]).toEqual([0, 2, 0, 0, 0, 3, 0x81, 0, 9]);
    const incoming = new Uint8Array([7, ...frame]).buffer;
    const decoded = decodeFrame(incoming);
    expect(decoded?.peer).toBe(7);
    expect(decoded?.level).toBe(-127);
    expect([...(decoded?.opus ?? [])]).toEqual([9]);
    expect(decodeFrame(new Uint8Array(9).buffer)).toBeUndefined();
  });

  it("parses control messages and ignores malformed ones", () => {
    expect(
      parseControl(
        JSON.stringify({
          type: "joined",
          pubkey: viewer,
          peer_index: 0,
          peers: [{ pubkey: viewer, peer_index: 0, epoch: 0 }],
        }),
      ),
    ).toEqual({
      type: "joined",
      pubkey: viewer,
      peers: [{ pubkey: viewer, peer_index: 0 }],
    });
    expect(
      parseControl(JSON.stringify({ type: "restricted", message: "nope" })),
    ).toEqual({ type: "error", message: "nope" });
    expect(
      parseControl(
        JSON.stringify({ type: "roster", peers: [{ pubkey: "x" }] }),
      ),
    ).toBeUndefined();
    expect(parseControl("not json")).toBeUndefined();
  });
});
