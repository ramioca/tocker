import { describe, expect, it } from "vitest";
import { describeUserAgent } from "./user-agent";

describe("describeUserAgent", () => {
  it("names the browser and the system", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      ),
    ).toBe("Chrome on Linux");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
      ),
    ).toBe("Safari on Mac");
    expect(
      describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"),
    ).toBe("Firefox on Windows");
  });

  it("checks the specific Chromium browsers before Chrome", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
      ),
    ).toBe("Edge on Windows");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Samsung Internet on Android");
  });

  it("tells iOS browsers apart, though all of them are WebKit", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Safari on iPhone");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("Chrome on iPhone");
    expect(
      describeUserAgent(
        "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
      ),
    ).toBe("Firefox on iPad");
  });

  it("reads Android before Linux, which every Android UA also says", () => {
    expect(
      describeUserAgent(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Chrome on Android");
  });

  it("falls back rather than guessing", () => {
    expect(describeUserAgent("curl/8.7.1")).toBe("Unknown browser");
    expect(describeUserAgent("")).toBe("Unknown browser");
    expect(describeUserAgent("Mozilla/5.0 (compatible) Firefox/128.0")).toBe("Firefox");
  });
});
