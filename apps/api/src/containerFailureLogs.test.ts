import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatLogMessages,
  formatServiceEvents,
  formatStoppedTasks,
  readAwsServiceNames,
  stateHasEcsExpress,
} from "./lib/containerFailureLogs.js";

describe("container failure logs", () => {
  it("reads the AWS service name from tfvars", () => {
    const names = readAwsServiceNames(`region = "eu-west-1"\nname_prefix = "shipdeck-xyrmu9"\n`);
    assert.deepEqual(names, { region: "eu-west-1", name: "shipdeck-xyrmu9" });
    assert.equal(readAwsServiceNames(`region = "eu-west-1"\n`), null);
  });

  it("detects an Express service in Terraform state", () => {
    assert.equal(
      stateHasEcsExpress(
        JSON.stringify({ resources: [{ type: "aws_ecs_express_gateway_service", name: "api" }] })
      ),
      true
    );
    assert.equal(stateHasEcsExpress(JSON.stringify({ resources: [{ type: "aws_instance" }] })), false);
  });

  it("formats the task stop reason and the last API log lines", () => {
    const events = formatServiceEvents("shipdeck-xyrmu9-api", [
      { message: "service shipdeck-xyrmu9-api deployment failed: tasks failed health checks." },
    ]);
    const stopped = formatStoppedTasks([
      {
        stopCode: "TaskFailedToStart",
        stoppedReason: "CannotPullContainerError: request canceled while waiting for connection",
        containers: [{ name: "api", exitCode: 1, reason: "Essential container exited" }],
      },
    ]);
    const logs = formatLogMessages("/shipdeck/shipdeck-xyrmu9/api", [
      { message: "Error: Cannot find module '/app/apps/api/dist/index.js'" },
    ]);
    assert.match(events[0], /failed health checks/);
    assert.match(stopped[0], /CannotPullContainerError/);
    assert.match(stopped[1], /exited 1/);
    assert.match(logs[0], /Cannot find module/);
  });
});
