import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserEditAttachment } from "./browser";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));

const screenshot = {
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  width: 120,
  height: 32,
};

describe("selected element screenshot attachment", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockResolvedValue("/attachments/Selected element.png");
  });

  it("saves PNG bytes for draft recovery and sends a normal vision attachment", async () => {
    const attachment = await browserEditAttachment(screenshot);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("write_attachment", {
      name: "Selected element.png",
      data: "iVBORw0KGgo=",
    });
    expect(attachment).toEqual({
      id: expect.any(String),
      name: "Selected element.png",
      mimeType: "image/png",
      kind: "image",
      size: 8,
      data: "iVBORw0KGgo=",
      path: "/attachments/Selected element.png",
    });
    expect(attachment).not.toHaveProperty("selector");
  });

  it.each([
    { ...screenshot, dataUrl: "https://example.com/image.png" },
    { ...screenshot, dataUrl: "data:text/html;base64,iVBORw0KGgo=" },
    { ...screenshot, dataUrl: "data:image/png;base64,invalid!" },
    { ...screenshot, width: 0 },
    { ...screenshot, height: Number.NaN },
  ])("rejects unusable captures before writing a file", async (capture) => {
    await expect(browserEditAttachment(capture)).rejects.toThrow(
      "Could not capture",
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("reports save failure rather than producing an attachment that cannot survive reopening", async () => {
    invoke.mockRejectedValue(new Error("Disk unavailable"));
    await expect(browserEditAttachment(screenshot)).rejects.toThrow(
      "Disk unavailable",
    );
  });
});
