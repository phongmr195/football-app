import { describe, expect, it, vi } from "vitest";
import { FallbackLlmProvider } from "./fallback-provider";
import type { LlmProvider } from "./provider.interface";

function makeFakeProvider(name: string, impl: LlmProvider["generateText"]): LlmProvider {
  return { providerName: name, generateText: impl };
}

describe("FallbackLlmProvider", () => {
  it("primary thành công thì trả kết quả của primary, không gọi fallback", async () => {
    const primaryGenerate = vi.fn().mockResolvedValue({ content: "từ primary", model: "m1", tokensInput: 1, tokensOutput: 1 });
    const fallbackGenerate = vi.fn();
    const provider = new FallbackLlmProvider(
      makeFakeProvider("primary", primaryGenerate),
      makeFakeProvider("fallback", fallbackGenerate),
    );

    const result = await provider.generateText({ prompt: "x" });

    expect(result.content).toBe("từ primary");
    expect(fallbackGenerate).not.toHaveBeenCalled();
  });

  it("primary fail thì tự chuyển qua fallback và trả kết quả của fallback", async () => {
    const primaryGenerate = vi.fn().mockRejectedValue(new Error("primary fail: 429"));
    const fallbackGenerate = vi.fn().mockResolvedValue({ content: "từ fallback", model: "m2", tokensInput: 2, tokensOutput: 2 });
    const provider = new FallbackLlmProvider(
      makeFakeProvider("primary", primaryGenerate),
      makeFakeProvider("fallback", fallbackGenerate),
    );

    const result = await provider.generateText({ prompt: "x" });

    expect(result.content).toBe("từ fallback");
    expect(fallbackGenerate).toHaveBeenCalledTimes(1);
  });

  it("cả 2 đều fail thì throw 1 lỗi gộp có message của cả primary và fallback", async () => {
    const primaryGenerate = vi.fn().mockRejectedValue(new Error("primary lỗi 429"));
    const fallbackGenerate = vi.fn().mockRejectedValue(new Error("fallback lỗi 503"));
    const provider = new FallbackLlmProvider(
      makeFakeProvider("primary", primaryGenerate),
      makeFakeProvider("fallback", fallbackGenerate),
    );

    await expect(provider.generateText({ prompt: "x" })).rejects.toThrow(/primary lỗi 429/);
    await expect(provider.generateText({ prompt: "x" })).rejects.toThrow(/fallback lỗi 503/);
  });
});
