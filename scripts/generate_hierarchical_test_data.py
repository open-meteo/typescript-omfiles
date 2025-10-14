#!/usr/bin/env -S uv run --script
#
# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "omfiles==1.0.1",
# ]
# ///

import numpy as np
from omfiles import OmFileWriter

file_name = "hierarchical.om"
writer = OmFileWriter(file_name)

# Short arrays for each supported type
arrays = [
    ("int8", "pfor_delta_2d", np.array([-8, 0, 8], dtype=np.int8)),
    ("uint8", "pfor_delta_2d", np.array([0, 8, 255], dtype=np.uint8)),
    ("int16", "pfor_delta_2d", np.array([-16, 0, 16], dtype=np.int16)),
    ("uint16", "pfor_delta_2d", np.array([0, 16, 65535], dtype=np.uint16)),
    ("int32", "pfor_delta_2d", np.array([-32, 0, 32], dtype=np.int32)),
    ("uint32", "pfor_delta_2d", np.array([0, 32, 4294967295], dtype=np.uint32)),
    ("int64", "pfor_delta_2d", np.array([-64, 0, 64], dtype=np.int64)),
    ("uint64", "pfor_delta_2d", np.array([0, 64, 2**64 - 1], dtype=np.uint64)),
    ("float32", "fpx_xor_2d", np.array([-3.14, 0.0, 2.71], dtype=np.float32)),
    (
        "float64",
        "fpx_xor_2d",
        np.array([-3.1415926535, 0.0, 2.7182818284], dtype=np.float64),
    ),
]

# Scalars for each supported type
scalars = [
    ("int8_scalar", np.int8(-8)),
    ("uint8_scalar", np.uint8(255)),
    ("int16_scalar", np.int16(-16)),
    ("uint16_scalar", np.uint16(65535)),
    ("int32_scalar", np.int32(-32)),
    ("uint32_scalar", np.uint32(4294967295)),
    ("int64_scalar", np.int64(-64)),
    ("uint64_scalar", np.uint64(2**64 - 1)),
    ("float32_scalar", np.float32(-3.14)),
    ("float64_scalar", np.float64(-3.1415926535)),
    ("string_scalar", "blub"),
]

children = []
for name, compression, arr in arrays:
    children.append(
        writer.write_array(arr, name=name, chunks=[3], compression=compression)
    )

for name, value in scalars:
    children.append(writer.write_scalar(value, name=name))

all_types_group = writer.write_group("all_types", children=children)

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
root = writer.write_group("root", children=[child_0, all_types_group])
writer.close(root)
