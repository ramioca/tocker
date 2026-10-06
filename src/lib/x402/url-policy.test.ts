import { describe, expect, it } from "vitest";
import { checkPaidUrl, PAID_HOSTS } from "./url-policy";

describe("checkPaidUrl", () => {
  it("allows a registry source's own https host", () => {
    expect(checkPaidUrl("https://sentimentalpha.ai/v1/narrative-alpha")).toBeNull();
    expect(checkPaidUrl("https://api.deepnets.ai/api/token-safety?mint=abc")).toBeNull();
    // Hostnames are case-insensitive; the URL parser lowercases them.
    expect(checkPaidUrl("https://API.Nansen.AI/api/v1/smart-money/netflow")).toBeNull();
  });

  it("refuses any other host, however close it looks", () => {
    const only = ["one.example"];
    for (const url of [
      "https://other.example/x402",
      "https://one.example.other.example/",
      "https://other.example/?u=https://one.example/",
      "https://xone.example/",
      "https://sub.one.example/",
      "https://one.example./",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://169.254.169.254/latest/meta-data/",
      "https://localhost/",
    ]) {
      expect(checkPaidUrl(url, only), url).toMatch(/is not a registry source's host/);
    }
    expect(checkPaidUrl("https://other.example/x402")).toMatch(/is not a registry source's host/);
  });

  it("refuses anything that is not plain https on the default port", () => {
    const only = ["one.example"];
    expect(checkPaidUrl("http://one.example/", only)).toBe("only https URLs are paid for");
    expect(checkPaidUrl("file:///etc/passwd", only)).toBe("only https URLs are paid for");
    expect(checkPaidUrl("ftp://one.example/", only)).toBe("only https URLs are paid for");
    expect(checkPaidUrl("https://one.example:8443/", only)).toBe("only the default https port is allowed");
    expect(checkPaidUrl("https://user:pw@one.example/", only)).toBe("URLs with credentials are not allowed");
    expect(checkPaidUrl("https://one.example@other.example/", only)).toBe("URLs with credentials are not allowed");
    expect(checkPaidUrl("not a url", only)).toBe("the URL could not be read");
    expect(checkPaidUrl("", only)).toBe("the URL could not be read");
    // An explicit default port is the default port.
    expect(checkPaidUrl("https://one.example:443/", only)).toBeNull();
  });

  it("takes an explicit host list, and an empty one allows nothing", () => {
    expect(checkPaidUrl("https://one.example/", ["one.example"])).toBeNull();
    expect(checkPaidUrl("https://sentimentalpha.ai/", [])).toMatch(/is not a registry source's host/);
  });

  it("lists bare lowercase hostnames only", () => {
    for (const host of PAID_HOSTS) {
      expect(host, host).toMatch(/^[a-z0-9.-]+$/);
      expect(checkPaidUrl(`https://${host}/`), host).toBeNull();
    }
    expect(new Set(PAID_HOSTS).size).toBe(PAID_HOSTS.length);
  });
});
