//
//  om_encoder.c
//  OpenMeteoApi
//
//  Created by Patrick Zippenfenig on 29.10.2024.
//

#include "om_encoder.h"
#include <stdlib.h>
#include <assert.h>
#include "vp4.h"
#include "fp.h"
#include "delta2d.h"


OmError_t OmEncoder_init(OmEncoder_t* encoder, float scale_factor, float add_offset, OmCompression_t compression, OmDataType_t data_type, const size_t* dimensions, const size_t* chunks, size_t dimension_count, size_t lut_chunk_element_count) {
    encoder->scale_factor = scale_factor;
    encoder->add_offset = add_offset;
    encoder->dimensions = dimensions;
    encoder->chunks = chunks;
    encoder->dimension_count = dimension_count;
    encoder->lut_chunk_element_count = lut_chunk_element_count;
    
    // Set element sizes and copy function
    switch (data_type) {
        case DATA_TYPE_INT8:
        case DATA_TYPE_UINT8:
            encoder->bytes_per_element = 1;
            encoder->bytes_per_element_compressed = 1;
            encoder->compress_copy_callback = om_common_copy8;
            break;
        
        case DATA_TYPE_INT16:
        case DATA_TYPE_UINT16:
            encoder->bytes_per_element = 2;
            encoder->bytes_per_element_compressed = 2;
            encoder->compress_copy_callback = om_common_copy16;
            break;
            
        case DATA_TYPE_INT32:
        case DATA_TYPE_UINT32:
        case DATA_TYPE_FLOAT:
            encoder->bytes_per_element = 4;
            encoder->bytes_per_element_compressed = 4;
            encoder->compress_copy_callback = om_common_copy32;
            break;
            
        case DATA_TYPE_INT64:
        case DATA_TYPE_UINT64:
        case DATA_TYPE_DOUBLE:
            encoder->bytes_per_element = 8;
            encoder->bytes_per_element_compressed = 8;
            encoder->compress_copy_callback = om_common_copy32;
            break;
            
        default:
            return ERROR_INVALID_DATA_TYPE;
    }
    
    // TODO more compression and datatypes
    switch (compression) {
        case COMPRESSION_PFOR_16BIT_DELTA2D:
            if (data_type != DATA_TYPE_FLOAT) {
                return ERROR_INVALID_DATA_TYPE;
            }
            encoder->bytes_per_element = 4;
            encoder->bytes_per_element_compressed = 2;
            encoder->compress_copy_callback = om_common_copy_float_to_int16;
            encoder->compress_filter_callback = (om_compress_filter_callback_t)delta2d_encode;
            encoder->compress_callback = (om_compress_callback_t)p4nzenc128v16;
            break;
            
        case COMPRESSION_FPX_XOR2D:
            switch (data_type) {
                case DATA_TYPE_FLOAT:
                    encoder->compress_callback = om_common_compress_fpxenc32;
                    encoder->compress_filter_callback = (om_compress_filter_callback_t)delta2d_encode_xor;
                    break;
                    
                case DATA_TYPE_DOUBLE:
                    encoder->compress_callback = om_common_compress_fpxenc64;
                    encoder->compress_filter_callback = (om_compress_filter_callback_t)delta2d_encode_xor_double;
                    break;
                    
                default:
                    return ERROR_INVALID_DATA_TYPE;
            }
            break;
            
        case COMPRESSION_PFOR_16BIT_DELTA2D_LOGARITHMIC:
            if (data_type != DATA_TYPE_FLOAT) {
                return ERROR_INVALID_DATA_TYPE;
            }
            encoder->bytes_per_element = 4;
            encoder->bytes_per_element_compressed = 2;
            encoder->compress_callback = (om_compress_callback_t)p4nzenc128v16;
            encoder->compress_filter_callback = (om_compress_filter_callback_t)delta2d_encode;
            encoder->compress_copy_callback = om_common_copy_float_to_int16_log10;
            break;
            
        default:
            return ERROR_INVALID_COMPRESSION_TYPE;
    }
    
    return ERROR_OK;
}

size_t OmEncoder_countChunks(const OmEncoder_t* encoder) {
    size_t n = 1;
    for (int i = 0; i < encoder->dimension_count; i++) {
        n *= divide_rounded_up(encoder->dimensions[i], encoder->chunks[i]);
    }
    return n;
}

size_t OmEncoder_countChunksInArray(const OmEncoder_t* encoder, const size_t* array_count) {
    size_t numberOfChunksInArray = 1;
    for (int i = 0; i < encoder->dimension_count; i++) {
        numberOfChunksInArray *= divide_rounded_up(array_count[i], encoder->chunks[i]);
    }
    return numberOfChunksInArray;
}

size_t OmEncoder_chunkBufferSize(const OmEncoder_t* encoder) {
    size_t chunkLength = 1;
    for (int i = 0; i < encoder->dimension_count; i++) {
        chunkLength *= encoder->chunks[i];
    }
    return chunkLength * encoder->bytes_per_element_compressed;
}

size_t OmEncoder_compressedChunkBufferSize(const OmEncoder_t* encoder) {
    size_t chunkLength = 1;
    for (int i = 0; i < encoder->dimension_count; i++) {
        chunkLength *= encoder->chunks[i];
    }
    // P4NENC256_BOUND. Compressor may write 32 integers more
    return (chunkLength + 255) /256 + (chunkLength + 32) * encoder->bytes_per_element_compressed;
}

size_t OmEncoder_lutBufferSize(const OmEncoder_t* encoder, const size_t* lookUpTable, size_t lookUpTableCount) {
    unsigned char buffer[MAX_LUT_ELEMENTS+32] = {0};
    size_t nLutChunks = divide_rounded_up(lookUpTableCount, encoder->lut_chunk_element_count);
    size_t maxLength = 0;
    for (int i = 0; i < nLutChunks; i++) {
        size_t rangeStart = i * encoder->lut_chunk_element_count;
        size_t rangeEnd = min(rangeStart + encoder->lut_chunk_element_count, lookUpTableCount);
        size_t len = p4ndenc64((uint64_t*)&lookUpTable[rangeStart], rangeEnd - rangeStart, buffer);
        if (len > maxLength) maxLength = len;
    }
    /// Compression function can write 32 integers more
    return maxLength * nLutChunks + 32 * sizeof(size_t);
}

size_t OmEncoder_compressLut(const OmEncoder_t* encoder, const size_t* lookUpTable, size_t lookUpTableCount, uint8_t* out, size_t compressed_lut_buffer_size) {
    size_t nLutChunks = divide_rounded_up(lookUpTableCount, encoder->lut_chunk_element_count);
    size_t lutSize = compressed_lut_buffer_size - 32 * sizeof(size_t);
    size_t lutChunkLength = lutSize / nLutChunks;

    for (size_t i = 0; i < nLutChunks; i++) {
        size_t rangeStart = i * encoder->lut_chunk_element_count;
        size_t rangeEnd = min(rangeStart + encoder->lut_chunk_element_count, lookUpTableCount);
        p4ndenc64((uint64_t*)&lookUpTable[rangeStart], rangeEnd - rangeStart, &out[i * lutChunkLength]);
    }
    return lutSize;
}

size_t OmEncoder_compressChunk(const OmEncoder_t* encoder, const void* array, const size_t* arrayDimensions, const size_t* arrayOffset, const size_t* arrayCount, size_t chunkIndex, size_t chunkIndexOffsetInThisArray, uint8_t* out, uint8_t* chunkBuffer) {
    /// The total size of `arrayDimensions`. Only used to check for out of bound reads
    size_t arrayTotalCount = 1;
    for (size_t i = 0; i < encoder->dimension_count; i++) {
        arrayTotalCount *= arrayDimensions[i];
    }
    
    size_t rollingMultiply = 1;
    size_t rollingMultiplyChunkLength = 1;
    size_t rollingMultiplyTargetCube = 1;
    size_t readCoordinate = 0;
    size_t writeCoordinate = 0;
    size_t linearReadCount = 1;
    bool linearRead = true;
    size_t lengthLast = 0;

    for (int64_t i = encoder->dimension_count - 1; i >= 0; i--) {
        size_t nChunksInThisDimension = divide_rounded_up(encoder->dimensions[i], encoder->chunks[i]);
        size_t c0 = (chunkIndex / rollingMultiply) % nChunksInThisDimension;
        size_t c0Offset = (chunkIndexOffsetInThisArray / rollingMultiply) % nChunksInThisDimension;
        size_t length0 = min((c0 + 1) * encoder->chunks[i], encoder->dimensions[i]) - c0 * encoder->chunks[i];

        if (i == encoder->dimension_count - 1) {
            lengthLast = length0;
        }

        readCoordinate += rollingMultiplyTargetCube * (c0Offset * encoder->chunks[i] + arrayOffset[i]);
        assert(length0 <= arrayCount[i]);
        assert(length0 <= arrayDimensions[i]);

        if (i == encoder->dimension_count - 1 && !(arrayCount[i] == length0 && arrayDimensions[i] == length0)) {
            linearReadCount = length0;
            linearRead = false;
        }
        if (linearRead && arrayCount[i] == length0 && arrayDimensions[i] == length0) {
            linearReadCount *= length0;
        } else {
            linearRead = false;
        }

        rollingMultiply *= nChunksInThisDimension;
        rollingMultiplyTargetCube *= arrayDimensions[i];
        rollingMultiplyChunkLength *= length0;
    }

    size_t lengthInChunk = rollingMultiplyChunkLength;

    while (true) {
        assert(readCoordinate + linearReadCount <= arrayTotalCount);
        assert(writeCoordinate + linearReadCount <= lengthInChunk);
        (*encoder->compress_copy_callback)(linearReadCount, encoder->scale_factor, encoder->add_offset, &array[encoder->bytes_per_element * readCoordinate], &chunkBuffer[encoder->bytes_per_element_compressed * writeCoordinate]);

        readCoordinate += linearReadCount - 1;
        writeCoordinate += linearReadCount - 1;
        writeCoordinate += 1;

        rollingMultiplyTargetCube = 1;
        linearRead = true;
        linearReadCount = 1;

        for (int64_t i = encoder->dimension_count - 1; i >= 0; i--) {
            size_t qPos = ((readCoordinate / rollingMultiplyTargetCube) % arrayDimensions[i] - arrayOffset[i]) / encoder->chunks[i];
            size_t length0 = min((qPos + 1) * encoder->chunks[i], arrayCount[i]) - qPos * encoder->chunks[i];
            readCoordinate += rollingMultiplyTargetCube;

            if (i == encoder->dimension_count - 1 && !(arrayCount[i] == length0 && arrayDimensions[i] == length0)) {
                linearReadCount = length0;
                linearRead = false;
            }
            if (linearRead && arrayCount[i] == length0 && arrayDimensions[i] == length0) {
                linearReadCount *= length0;
            } else {
                linearRead = false;
            }
            size_t q0 = ((readCoordinate / rollingMultiplyTargetCube) % arrayDimensions[i] - arrayOffset[i]) % encoder->chunks[i];
            if (q0 != 0 && q0 != length0) {
                break;
            }
            readCoordinate -= length0 * rollingMultiplyTargetCube;
            rollingMultiplyTargetCube *= arrayDimensions[i];

            if (i == 0) {
                (*encoder->compress_filter_callback)(lengthInChunk / lengthLast, lengthLast, chunkBuffer);
                return (*encoder->compress_callback)(chunkBuffer, lengthInChunk, out);
            }
        }
    }
}
