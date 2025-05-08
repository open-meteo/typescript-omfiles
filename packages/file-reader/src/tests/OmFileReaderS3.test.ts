import { describe, it, expect } from "vitest";
import { S3Backend } from "../lib/backends/S3Backend";
import { OmFileReader } from "../lib/OmFileReader";
import { OmDataType } from "../lib/types";
import { expectFloatArrayToBeClose } from "./utils";

describe("S3Backend", () => {
  // This test needs network access to S3, so mark it as slow
  it("should read data from S3 correctly", async () => {
    // Create S3 backend with anonymous access (public bucket)
    const s3Backend = new S3Backend({
      region: "us-west-2",
      bucket: "openmeteo",
      key: "data/dwd_icon_d2/temperature_2m/chunk_3996.om",
      cacheEnabled: false
    });

    // Create and initialize reader
    const reader = await OmFileReader.create(s3Backend);

    try {
      const ranges = [
        { start: 300, end: 301 }, // latitude
        { start: 400, end: 401 }, // longitude
        { start: 0, end: 100 }, // time
      ];

      // Read the data: it is a float array (temperature data)
      const data = await reader.read(OmDataType.FloatArray, ranges);

      expectFloatArrayToBeClose(
        data.slice(0, 10), // Only check the first few values
        [7.55, 7.70, 7.55, 7.60, 7.45, 6.60, 5.65, 5.35, 4.75, 5], // Expected data in the remote file
        0.01, // 2 decimal places tolerance
        "Temperature values should match reference data"
      );

      // Also check the dimensions
      const dimensions = reader.getDimensions();
      expect(dimensions).toStrictEqual([746, 1215, 121]);
    } finally {
      // Clean up resources
      reader.dispose();
    }
  }, 30000); // 30 second timeout for network request

  // This test needs network access to S3, so mark it as slow
  it("should read data from S3 with spatial access correctly", async () => {
    // Create S3 backend with anonymous access (public bucket)
    const s3Backend = new S3Backend({
      region: "us-west-2",
      bucket: "openmeteo",
      key: "data/dwd_icon_d2/temperature_2m/chunk_3996.om",
      cacheEnabled: false
    });

    // Create and initialize reader
    const reader = await OmFileReader.create(s3Backend);

    try {
      const ranges = [
        { start: 240, end: 260 }, // latitude
        { start: 240, end: 260 }, // longitude
        { start: 0, end: 1 }, // time
      ];

      // Read the data: it is a float array (temperature data)
      const data = await reader.read(OmDataType.FloatArray, ranges);

      expectFloatArrayToBeClose(
        data.slice(0, 10),
        [8.20, 8.15, 8.25, 8.10, 7.95, 7.70, 7.65, 7.65, 7.8, 7.9], // Expected data in the remote file
        0.01, // 2 decimal places tolerance
        "Temperature values should match reference data"
      );
    } finally {
      // Clean up resources
      reader.dispose();
    }
  }, 30000); // 30 second timeout for network request
});
