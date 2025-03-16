import { describe, it, expect } from "vitest";
import { S3Backend } from "../lib/backends/S3Backend";
import { OmFileReader } from "../lib/OmFileReader";
import { initWasm } from "../lib/wasm";
import { OmDataType } from "../lib/types";
import { expectFloatArrayToBeClose } from "./utils";

describe("S3Backend", () => {
  // This test needs network access to S3, so mark it as slow
  it("should read data from S3 correctly", async () => {
    // Initialize WASM module
    await initWasm();

    // Create S3 backend with anonymous access (public bucket)
    const s3Backend = new S3Backend({
      region: "us-west-2",
      bucket: "openmeteo",
      key: "data/dwd_icon_d2/temperature_2m/chunk_3960.om",
    });

    // Create and initialize reader
    const reader = await OmFileReader.create(s3Backend);

    try {
      // Define ranges similar to the Python slice [57812:57813, 0:100]
      const ranges = [
        { start: 57812, end: 57813 },
        { start: 0, end: 100 },
      ];

      // Read the data: it is a float array (temperature data)
      const data = await reader.read(OmDataType.FloatArray, ranges);

      // Use our helper function to verify the results
      expectFloatArrayToBeClose(
        data.slice(0, 10), // Only check the first few values
        [18.0, 17.7, 17.65, 17.45, 17.15, 17.6, 18.7, 20.75, 21.7, 22.65], // Expected data in the remote file
        0.01, // 2 decimal places tolerance
        "Temperature values should match reference data"
      );

      // Also check the dimensions
      const dimensions = reader.getDimensions();
      expect(dimensions).toStrictEqual([906390, 121]);
    } finally {
      // Clean up resources
      reader.dispose();
    }
  }, 30000); // 30 second timeout for network request
});
