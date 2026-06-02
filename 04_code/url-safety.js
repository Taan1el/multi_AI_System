const dns = require("node:dns/promises");
const net = require("node:net");

function normalizePublicHttpUrl(value) {
  try {
    const parsed = new URL(String(value).trim());
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");

    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      return null;
    }

    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return null;
    }

    if (net.isIP(hostname) && !isPublicIpAddress(hostname)) {
      return null;
    }

    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function isPublicIpAddress(address) {
  const normalized = String(address).toLowerCase().replace(/^\[|\]$/g, "");
  const ipVersion = net.isIP(normalized);

  if (ipVersion === 4) {
    return isPublicIpv4(normalized);
  }

  if (ipVersion === 6) {
    const mappedIpv4 = getIpv4MappedAddress(normalized);
    if (mappedIpv4) {
      return isPublicIpv4(mappedIpv4);
    }

    return !(
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:") ||
      normalized.startsWith("fe80::")
    );
  }

  return false;
}

function getIpv4MappedAddress(address) {
  const dotted = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    return dotted[1];
  }

  const hex = address.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) {
    return null;
  }

  const high = Number.parseInt(hex[1], 16);
  const low = Number.parseInt(hex[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join(".");
}

function isPublicIpv4(address) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

async function resolvePublicHttpUrl(value, options = {}) {
  const normalized = normalizePublicHttpUrl(value);
  if (!normalized) {
    return null;
  }

  const hostname = new URL(normalized).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) {
    return normalized;
  }

  const lookup = options.lookup || dns.lookup;
  let records;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    return null;
  }

  if (!Array.isArray(records) || records.length === 0) {
    return null;
  }

  return records.every((record) => isPublicIpAddress(record.address)) ? normalized : null;
}

module.exports = {
  isPublicIpAddress,
  normalizePublicHttpUrl,
  resolvePublicHttpUrl,
};
