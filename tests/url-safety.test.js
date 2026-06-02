const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isPublicIpAddress,
  normalizePublicHttpUrl,
  resolvePublicHttpUrl,
} = require("../04_code/url-safety");

test("normalizes only credential-free http and https URLs", () => {
  assert.equal(normalizePublicHttpUrl("https://example.com/a#secret"), "https://example.com/a");
  assert.equal(normalizePublicHttpUrl("ftp://example.com"), null);
  assert.equal(normalizePublicHttpUrl("https://user:pass@example.com"), null);
});

test("blocks private and local literal addresses", () => {
  for (const value of [
    "http://localhost",
    "http://127.0.0.1",
    "http://10.0.0.1",
    "http://172.16.0.1",
    "http://192.168.1.1",
    "http://169.254.169.254",
    "http://[::1]",
    "http://[::ffff:127.0.0.1]",
  ]) {
    assert.equal(normalizePublicHttpUrl(value), null, value);
  }
});

test("classifies public and reserved IP addresses", () => {
  assert.equal(isPublicIpAddress("8.8.8.8"), true);
  assert.equal(isPublicIpAddress("100.64.0.1"), false);
  assert.equal(isPublicIpAddress("224.0.0.1"), false);
  assert.equal(isPublicIpAddress("2001:4860:4860::8888"), true);
  assert.equal(isPublicIpAddress("fd00::1"), false);
});

test("blocks hostnames that resolve to private addresses", async () => {
  const lookup = async () => [{ address: "10.0.0.12", family: 4 }];

  assert.equal(await resolvePublicHttpUrl("https://public-looking.example", { lookup }), null);
});

test("allows hostnames only when every DNS answer is public", async () => {
  const lookup = async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "2001:4860:4860::8888", family: 6 },
  ];

  assert.equal(
    await resolvePublicHttpUrl("https://example.com/path#fragment", { lookup }),
    "https://example.com/path",
  );
});
