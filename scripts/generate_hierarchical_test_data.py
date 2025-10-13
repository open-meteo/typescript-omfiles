#!/usr/bin/env -S uv run --script
#
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "omfiles>=1.0.0",
# ]
# ///

import numpy as np
from omfiles import OmFileWriter

file_name = "hierarchical.om"
writer = OmFileWriter(file_name)
# Create the hierarchy:
# root
# └── child_0
#     ├── child_0_0
#     │   └── child_0_0_1  (2x3 float32 array)
#     └── child_0_1
#         ├── child_0_1_0
#         └── child_0_1_1  (2 float32 values)

data_0_0_1 = np.array([[20.1, 20.2, 20.3], [21.1, 21.2, 21.3]], dtype=np.float32)
child_0_0_1 = writer.write_array(
    data_0_0_1,
    name="child_0_0_1",
    chunks=[2, 3],
    compression="pfor_delta_2d",
    scale_factor=20,
)
child_0_1_0 = writer.write_scalar(42, name="child_0_1_0")
data_0_1_1 = np.array([1013.25, 1012.5], dtype=np.float32)
child_0_1_1 = writer.write_array(
    data_0_1_1,
    name="child_0_1_1",
    chunks=[2],
    compression="pfor_delta_2d",
    scale_factor=20,
)


child_0_0 = writer.write_group("child_0_0", children=[child_0_0_1])
child_0_1 = writer.write_group("child_0_1", children=[child_0_1_0, child_0_1_1])

child_0 = writer.write_group("child_0", children=[child_0_0, child_0_1])
root = writer.write_group("root", children=[child_0])

writer.close(root)
