import Anthropic from "@anthropic-ai/sdk";

export class AnthropicSdkClient {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  async createMessage(args: unknown) {
    // @ts-expect-error args is a runtime-shaped object
    return await this.anthropic.messages.create(args);
  }
}

