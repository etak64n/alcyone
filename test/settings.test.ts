import { describe, expect, it } from "vitest";
import example from "../alcyone.config.example.ts";
import { SettingsError, validateSettings } from "../config/settings.ts";

const clone = () => structuredClone(example) as unknown as Record<string, unknown> & { production: Record<string, unknown>; development: Record<string, unknown> };

describe("validateSettings", () => {
  it("accepts the example settings", () => {
    expect(validateSettings(example)).toEqual(example);
  });

  it("names every problem at once", () => {
    const settings = clone();
    settings["accountId"] = "nope";
    settings["unknown"] = true;
    settings.production["domain"] = "https://boards.example.com";
    let error: unknown;
    try {
      validateSettings(settings);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SettingsError);
    const problems = (error as SettingsError).problems.join("\n");
    expect(problems).toMatch(/accountId/);
    expect(problems).toMatch(/unknown is not a setting/);
    expect(problems).toMatch(/production.domain/);
  });

  it("lets Access in every admin", () => {
    const settings = clone();
    settings["admins"] = ["boss@example.com"];
    expect(() => validateSettings(settings)).toThrow(/must include every admin/);
  });

  it("keeps the local bucket to development", () => {
    const settings = clone();
    settings.production["storage"] = { type: "local-r2" };
    expect(() => validateSettings(settings)).toThrow(/only in cf dev/);
  });

  it("allows http on localhost for development storage only", () => {
    const settings = clone();
    settings.development["storage"] = { type: "s3", endpoint: "http://localhost:9000", region: "us-east-1", bucket: "alcyone-dev", urlStyle: "path" };
    expect(() => validateSettings(settings)).not.toThrow();
    const production = clone();
    (production.production["storage"] as Record<string, unknown>)["endpoint"] = "http://localhost:9000";
    expect(() => validateSettings(production)).toThrow(/https:\/\/ origin/);
  });
});
