import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CODE_PROVIDER_IDS,
  chatProtocolFor,
  codeImplementationKind,
  isFolderAgent,
  normalizeDeliveryPolicy,
  providersFor,
  vendorContract,
} from "@shipdeck/shared";

describe("model providers", () => {
  it("loads an old single-model policy as the plan slot and keeps the default code vendor", () => {
    const policy = normalizeDeliveryPolicy({
      model: {
        provider: "openai",
        endpoint: "https://api.openai.com/v1/chat/completions",
        region: "",
        deploymentName: "gpt-4.1",
        hasApiKey: true,
      },
    });
    assert.equal(policy.planModel.provider, "openai");
    assert.equal(policy.planModel.endpoint, "https://api.openai.com/v1/chat/completions");
    assert.equal(policy.codeModel.provider, "anthropic");
    assert.equal(policy.model.provider, "openai");
  });

  it("keeps separate plan and code vendors when both are saved", () => {
    const policy = normalizeDeliveryPolicy({
      planModel: {
        provider: "azure-openai",
        endpoint: "https://example.openai.azure.com/chat",
        region: "eastus",
        deploymentName: "gpt",
        hasApiKey: true,
      },
      codeModel: {
        provider: "cursor",
        endpoint: "https://api.cursor.com/v0/agents",
        region: "",
        deploymentName: "",
        hasApiKey: true,
      },
    });
    assert.equal(policy.planModel.provider, "azure-openai");
    assert.equal(policy.codeModel.provider, "cursor");
    assert.equal(policy.model.provider, "azure-openai");
  });

  it("keeps folder agents out of the plan list", () => {
    const plan = providersFor("plan").map((item) => item.id);
    const code = providersFor("code").map((item) => item.id);
    assert.equal(plan.includes("anthropic"), true);
    assert.equal(plan.includes("openai"), true);
    assert.equal(plan.includes("cursor"), false);
    assert.equal(code.includes("cursor"), true);
    assert.equal(code.includes("github-copilot"), true);
    assert.equal(isFolderAgent("cursor"), true);
    assert.equal(isFolderAgent("anthropic"), false);
  });

  it("routes each code vendor to a known live adapter instead of a generic POST", () => {
    assert.equal(codeImplementationKind("azure-openai"), "chat-files");
    assert.equal(codeImplementationKind("anthropic"), "chat-files");
    assert.equal(codeImplementationKind("openai"), "chat-files");
    assert.equal(codeImplementationKind("claude-code"), "chat-files");
    assert.equal(chatProtocolFor("claude-code"), "anthropic");
    assert.equal(codeImplementationKind("openai-codex"), "chat-files");
    assert.equal(codeImplementationKind("cursor"), "cursor-cloud");
    assert.equal(codeImplementationKind("github-copilot"), "unsupported");
    assert.equal(codeImplementationKind("devin"), "unsupported");
  });

  it("exposes a UI/backend contract for every code vendor", () => {
    for (const id of CODE_PROVIDER_IDS) {
      const contract = vendorContract(id);
      assert.ok(contract.fields.length > 0, id);
      assert.ok(contract.help.length > 0, id);
      if (id === "cursor") {
        assert.equal(contract.needs.includes("githubRepo"), true);
        assert.equal(contract.needs.includes("githubToken"), true);
      }
      if (id === "anthropic") {
        assert.equal(contract.needs.includes("githubRepo"), false);
        assert.equal(contract.fields.some((field) => field.id === "region"), false);
      }
    }
  });
});
