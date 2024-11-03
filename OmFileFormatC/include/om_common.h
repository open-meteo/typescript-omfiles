//
//  om_common.h
//  OpenMeteoApi
//
//  Created by Patrick Zippenfenig on 29.10.2024.
//

#ifndef OM_COMMON_H
#define OM_COMMON_H

#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>

/// The function to convert a single a a sequence of elements and convert data type. Applies scale factor.
typedef void(*om_compress_copy_callback_t)(size_t length, float scale_factor, float add_offset, const void* src, void* dest);

/// compress input, of n-elements to output and return number of compressed byte
typedef size_t(*om_compress_callback_t)(const void* src, size_t length, void* dest);

/// Perform a 2d filter operation
typedef void(*om_compress_filter_callback_t)(const size_t length0, const size_t length1, void* buffer);

#define MAX_LUT_ELEMENTS 256

typedef enum {
    ERROR_OK = 0, // not an error
    ERROR_INVALID_COMPRESSION_TYPE = 1,
    ERROR_INVALID_DATA_TYPE = 2,
    ERROR_INVALID_LUT_CHUNK_LENGTH = 3,
    ERROR_OUT_OF_BOUND_READ = 4,
} OmError_t;

const char* OmError_string(OmError_t error);

/// Data types
typedef enum {
    DATA_TYPE_INT8 = 0,
    DATA_TYPE_UINT8 = 1,
    DATA_TYPE_INT16 = 2,
    DATA_TYPE_UINT16 = 3,
    DATA_TYPE_INT32 = 4,
    DATA_TYPE_UINT32 = 5,
    DATA_TYPE_INT64 = 6,
    DATA_TYPE_UINT64 = 7,
    DATA_TYPE_FLOAT = 8,
    DATA_TYPE_DOUBLE = 9
} OmDataType_t;

/// Compression types
typedef enum {
    COMPRESSION_PFOR_16BIT_DELTA2D = 0, // Lossy compression using 2D delta coding and scalefactor. Only supports float and scales to 16-bit integer.
    COMPRESSION_FPX_XOR2D = 1, // Lossless float/double compression using 2D xor coding.
    COMPRESSION_PFOR_16BIT_DELTA2D_LOGARITHMIC = 3 // Similar to `P4NZDEC256` but applies `log10(1+x)` before.
} OmCompression_t;


/// Divide and round up
#define divide_rounded_up(dividend,divisor) \
  ({ __typeof__ (dividend) _dividend = (dividend); \
      __typeof__ (divisor) _divisor = (divisor); \
    (_dividend + _divisor - 1) / _divisor; })

/// Maxima of 2 terms
#define max(a,b) \
  ({ __typeof__ (a) _a = (a); \
      __typeof__ (b) _b = (b); \
    _a > _b ? _a : _b; })

/// Minima of 2 terms
#define min(a,b) \
  ({ __typeof__ (a) _a = (a); \
      __typeof__ (b) _b = (b); \
    _a < _b ? _a : _b; })

/// Copy 16 bit integer array and convert to float
void om_common_copy_float_to_int16(size_t length, float scale_factor, float add_offset, const void* src, void* dst);

/// Copy 16 bit integer array and convert to float and scale log10
void om_common_copy_float_to_int16_log10(size_t length, float scale_factor, float add_offset, const void* src, void* dst);

/// Convert int16 and scale to float
void om_common_copy_int16_to_float(size_t length, float scale_factor, float add_offset, const void* src, void* dst);

/// Convert int16 and scale to float with log10
void om_common_copy_int16_to_float_log10(size_t length, float scale_factor, float add_offset, const void* src, void* dst);

void om_common_copy8(size_t length, float scale_factor, float add_offset, const void* src, void* dst);
void om_common_copy16(size_t length, float scale_factor, float add_offset, const void* src, void* dst);
void om_common_copy32(size_t length, float scale_factor, float add_offset, const void* src, void* dst);
void om_common_copy64(size_t length, float scale_factor, float add_offset, const void* src, void* dst);

size_t om_common_compress_fpxenc32(const void* src, size_t length, void* dst);
size_t om_common_compress_fpxenc64(const void* src, size_t length, void* dst);
size_t om_common_decompress_fpxdec32(const void* src, size_t length, void* dst);
size_t om_common_decompress_fpxdec64(const void* src, size_t length, void* dst);



#endif // OM_COMMON_H
