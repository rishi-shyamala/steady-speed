import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../../src/core/settings";
import { SETTINGS_KEY } from "../../src/platform/storage";
import { startHarness, type Harness } from "./harness";

let harness: Harness;

const rateOf = async (page: import("playwright").Page, selector = "#player"): Promise<number> =>
  page.$eval(selector, (element) => (element as HTMLMediaElement).playbackRate);

async function open(path: string): Promise<import("playwright").Page> {
  const page = await harness.context.newPage();
  await page.goto(`${harness.origin}/${path}`);
  return page;
}

beforeAll(async () => {
  harness = await startHarness();
}, 120_000);

afterAll(async () => {
  await harness?.close();
});

describe("the default speed", () => {
  it("is applied to a plain player", async () => {
    const page = await open("plain.html");
    await expect.poll(() => rateOf(page)).toBe(DEFAULT_SETTINGS.defaultSpeed);
    await page.close();
  });

  it("survives a reload", async () => {
    const page = await open("plain.html");
    await expect.poll(() => rateOf(page)).toBe(2);
    await page.reload();
    await expect.poll(() => rateOf(page)).toBe(2);
    await page.close();
  });

  it("follows a change made in storage, without a reload", async () => {
    const page = await open("plain.html");
    await expect.poll(() => rateOf(page)).toBe(2);

    await harness.seedStorage({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, defaultSpeed: 3 } });
    await expect.poll(() => rateOf(page)).toBe(3);

    await harness.seedStorage({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
    await page.close();
  });

  it("survives playback actually starting", async () => {
    const page = await open("plain.html");
    await expect.poll(() => rateOf(page)).toBe(2);
    await page.$eval("#player", (element) => (element as HTMLMediaElement).play());
    await page.waitForTimeout(500);
    expect(await rateOf(page)).toBe(2);
    await page.close();
  });
});

describe("site rules", () => {
  it("pins a site to 1x", async () => {
    await harness.seedStorage({
      [SETTINGS_KEY]: {
        ...DEFAULT_SETTINGS,
        rules: [{ id: "local", pattern: "127.0.0.1", speed: 1, enabled: true }],
      },
    });

    const page = await open("plain.html");
    await page.waitForTimeout(400);
    expect(await rateOf(page)).toBe(1);
    await page.close();

    await harness.seedStorage({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  });
});

describe("awkward places media hides", () => {
  it("finds a player two shadow roots deep", async () => {
    const page = await open("shadow.html");
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { findPlayer(): HTMLMediaElement }).findPlayer().playbackRate,
        ),
      )
      .toBe(2);
    await page.close();
  });

  it("finds a player added after load", async () => {
    const page = await open("late.html");
    await page.waitForSelector("#player");
    await expect.poll(() => rateOf(page)).toBe(2);
    await page.close();
  });

  it("finds a player inside an iframe", async () => {
    const page = await open("iframe.html");
    const frame = page.frameLocator("#frame");
    await expect
      .poll(async () =>
        frame.locator("#player").evaluate((element) => (element as HTMLMediaElement).playbackRate),
      )
      .toBe(2);
    await page.close();
  });
});

describe("players that fight back", () => {
  it("wins against a player that resets the rate on play", async () => {
    const page = await open("hostile-play.html");
    await expect.poll(() => rateOf(page)).toBe(2);

    await page.$eval("#player", (element) => (element as HTMLMediaElement).play());
    await expect.poll(() => rateOf(page), { timeout: 5_000 }).toBe(2);
    await page.close();
  });

  it("gives up in a bounded way against a player that rewrites the rate forever", async () => {
    const page = await open("hostile-loop.html");
    await page.waitForTimeout(2_500);

    const resets = await page.evaluate(() => (window as unknown as { resets: number }).resets);
    // The loop guard caps attempts; without it this would be thousands.
    expect(resets).toBeLessThan(60);
    await page.close();
  });
});

describe("the popup", () => {
  /**
   * A real toolbar popup is not a tab, and Playwright cannot open one. Opening
   * popup.html as a tab is the closest equivalent, but loading it makes it the
   * active tab — so its first render legitimately finds no page to control.
   * Bringing the media page back to the front and then acting on the popup
   * exercises the real path: query the active tab, message its content script,
   * redraw from the reply.
   */
  async function openPopupBehind(page: import("playwright").Page) {
    const popup = await harness.context.newPage();
    await popup.goto(`chrome-extension://${harness.extensionId}/popup.html`);
    await expect.poll(async () => popup.locator(".note").count()).toBe(1);
    await page.bringToFront();
    return popup;
  }

  it("reaches the page it is opened over, and redraws from what it finds", async () => {
    const page = await open("plain.html");
    await expect.poll(() => rateOf(page)).toBe(2);

    const popup = await openPopupBehind(page);
    await popup.locator('[data-act="up"]').dispatchEvent("click");

    await expect.poll(() => rateOf(page)).toBe(2.25);
    await expect.poll(async () => popup.locator(".readout").textContent()).toContain("2.25x");
    await expect.poll(async () => popup.locator(".host").textContent()).toBe("127.0.0.1");

    await popup.close();
    await page.close();
  });

  it("pins the site, and the pin survives a reload", async () => {
    const page = await open("plain.html");
    await expect.poll(() => rateOf(page)).toBe(2);

    const popup = await openPopupBehind(page);
    await popup.locator('[data-act="up"]').dispatchEvent("click");
    await expect.poll(async () => popup.locator('[data-act="pin-normal"]').count()).toBe(1);

    await popup.locator('[data-act="pin-normal"]').dispatchEvent("click");
    await expect.poll(async () => popup.locator(".pinned").textContent()).toBe("pinned at 1x");

    await page.reload();
    await expect.poll(() => rateOf(page)).toBe(1);

    await popup.close();
    await page.close();
    await harness.seedStorage({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  });

  it("says so when there is no page to control", async () => {
    const popup = await harness.context.newPage();
    await popup.goto(`chrome-extension://${harness.extensionId}/popup.html`);
    await expect.poll(async () => popup.locator(".note").textContent()).toMatch(/no media controls/i);
    await popup.close();
  });
});

describe("the settings page", () => {
  it("saves a default that the page then follows", async () => {
    const page = await open("plain.html");
    await expect.poll(() => rateOf(page)).toBe(2);

    const options = await harness.context.newPage();
    await options.goto(`chrome-extension://${harness.extensionId}/options.html`);
    await options.locator("#defaultSpeed").fill("1.5");
    await options.locator("#defaultSpeed").blur();

    await expect.poll(() => rateOf(page)).toBe(1.5);

    await options.close();
    await page.close();
    await harness.seedStorage({ [SETTINGS_KEY]: DEFAULT_SETTINGS });
  });
});
