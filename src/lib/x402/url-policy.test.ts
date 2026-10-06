import { describe, expect, it } from "vitest";
import { INFERENCE_GATEWAY } from "./inference-types";
import { checkInferenceUrl, checkPaidUrl, PAID_HOSTS } from "./url-policy";

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

describe("checkInferenceUrl", () => {
  const url = INFERENCE_GATEWAY.solana.url;

  it("allows the gateway's one endpoint, and only by POST", () => {
    expect(checkInferenceUrl(url)).toBeNull();
    expect(checkInferenceUrl(url, "POST")).toBeNull();
    expect(checkInferenceUrl(url, "post")).toBeNull();
    // An explicit default port and an upper-case host are the same place.
    expect(checkInferenceUrl("https://SOL.BlockRun.ai:443/api/v1/chat/completions")).toBeNull();
    for (const method of ["GET", "PUT", "DELETE", "PATCH", "HEAD", ""]) {
      expect(checkInferenceUrl(url, method), method).toBe("only POST requests are sent to the inference gateway");
    }
  });

  it("refuses every other path, query and fragment on the gateway's own host", () => {
    for (const other of [
      "https://sol.blockrun.ai/",
      "https://sol.blockrun.ai/api/v1/responses",
      "https://sol.blockrun.ai/api/v1/chat/completions/",
      "https://sol.blockrun.ai/api/v1/chat/completions/x",
      "https://sol.blockrun.ai/api/v1/chat/completions?to=https://other.example",
      "https://sol.blockrun.ai/api/v1/chat/completions?",
      "https://sol.blockrun.ai/api/v1/chat/completions#x",
      "https://sol.blockrun.ai/api/v1/images/generations",
      "https://sol.blockrun.ai/api/v1/chat/../chat/completions/..",
      "https://sol.blockrun.ai//api/v1/chat/completions",
    ]) {
      expect(checkInferenceUrl(other), other).not.toBeNull();
    }
    // Dot segments that resolve to the endpoint are the endpoint: the check reads what
    // the parser produced, which is where the request would go.
    expect(checkInferenceUrl("https://sol.blockrun.ai/api/v1/x/../chat/completions")).toBeNull();
  });

  it("refuses any other host, port, scheme or a URL with credentials", () => {
    expect(checkInferenceUrl("https://blockrun.ai/api/v1/chat/completions")).toBe("the host is not the inference gateway's");
    expect(checkInferenceUrl("https://sol.blockrun.ai.other.example/api/v1/chat/completions")).toBe("the host is not the inference gateway's");
    expect(checkInferenceUrl("https://xsol.blockrun.ai/api/v1/chat/completions")).toBe("the host is not the inference gateway's");
    expect(checkInferenceUrl("https://sol.blockrun.ai./api/v1/chat/completions")).toBe("the host is not the inference gateway's");
    expect(checkInferenceUrl("https://127.0.0.1/api/v1/chat/completions")).toBe("the host is not the inference gateway's");
    expect(checkInferenceUrl("http://sol.blockrun.ai/api/v1/chat/completions")).toBe("only https URLs are paid for");
    expect(checkInferenceUrl("https://sol.blockrun.ai:8443/api/v1/chat/completions")).toBe("only the default https port is allowed");
    expect(checkInferenceUrl("https://user:pw@sol.blockrun.ai/api/v1/chat/completions")).toBe("URLs with credentials are not allowed");
    expect(checkInferenceUrl("https://sol.blockrun.ai@other.example/api/v1/chat/completions")).toBe("URLs with credentials are not allowed");
    expect(checkInferenceUrl("not a url")).toBe("the URL could not be read");
    expect(checkInferenceUrl("")).toBe("the URL could not be read");
  });

  it("is a separate door: the data path's list still refuses the gateway", () => {
    // `PAID_HOSTS` is what the platform wallet may pay. The gateway must never be on it,
    // or a data source could be pointed at it and paid from the platform's money.
    expect(PAID_HOSTS).not.toContain("blockrun.ai");
    expect(PAID_HOSTS).not.toContain(INFERENCE_GATEWAY.solana.host);
    expect(checkPaidUrl(url)).toMatch(/is not a registry source's host/);
    expect(checkPaidUrl("https://blockrun.ai/api/v1/chat/completions")).toMatch(/is not a registry source's host/);
    // And the inference door opens for no data source.
    for (const host of PAID_HOSTS) {
      expect(checkInferenceUrl(`https://${host}/api/v1/chat/completions`), host).toBe("the host is not the inference gateway's");
    }
  });
});
