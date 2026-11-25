import assert from "node:assert/strict";
import test from "node:test";
import { modelUseLabel, modelUseOf, modelUsesOf, modelUsesToRole, readMarketingScenes } from "@shipdeck/shared";

test("a four-scene film script is read from the model reply", () => {
  const scenes = readMarketingScenes(
    'Here is the film:\n[{"scene":1,"visual":"A school gate","voice":"Parents wait."},{"scene":9,"visual":"A list","voice":"The office checks names."}] extra'
  );
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0]?.scene, 1);
  assert.equal(scenes[0]?.visual, "A school gate");
  assert.equal(scenes[1]?.voice, "The office checks names.");
  assert.equal(scenes[0]?.imageUrl, "");
});

test("an older both setting counts as all in one", () => {
  assert.equal(modelUseOf("both"), "all");
  assert.equal(modelUseOf("image"), "image");
  assert.equal(modelUseOf("sales"), "sales");
  assert.equal(modelUseOf("video"), "video");
  assert.equal(modelUseOf(""), "plan");
});

test("one model can cover every chat job and leave image to another", () => {
  assert.deepEqual(modelUsesOf("plan,code,sales,video"), ["plan", "code", "sales", "video"]);
  assert.equal(modelUsesOf("plan,code,sales,video").includes("image"), false);
  assert.deepEqual(modelUsesOf("image"), ["image"]);
  assert.deepEqual(modelUsesOf("all"), ["plan", "code", "sales", "image", "video"]);
  assert.equal(modelUsesToRole(["plan", "code", "sales", "video"]), "plan,code,sales,video");
  assert.equal(modelUsesToRole(["video", "sales", "code", "plan", "image"]), "all");
  assert.equal(modelUseLabel("plan,code,sales,video"), "All except image");
  assert.equal(modelUseLabel("code,sales,image,video"), "All except plan");
  assert.equal(modelUseLabel("image"), "Image");
});
