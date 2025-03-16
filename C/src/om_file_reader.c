#include "om_file_reader.h"
#include "om_common.h"


EMSCRIPTEN_KEEPALIVE
uint64_t om_variable_get_dimension_count(const OmVariable_t* variable) {
    OmDimensions_t dims = om_variable_get_dimensions(variable);
    return dims.count;
}

EMSCRIPTEN_KEEPALIVE
uint64_t om_variable_get_dimension_value(const OmVariable_t* variable, uint64_t index) {
    OmDimensions_t dims = om_variable_get_dimensions(variable);
    if (index >= dims.count) return 0;
    return dims.values[index];
}

// Similarly for chunks
EMSCRIPTEN_KEEPALIVE
uint64_t om_variable_get_chunk_count(const OmVariable_t* variable) {
    OmDimensions_t chunks = om_variable_get_chunks(variable);
    return chunks.count;
}

EMSCRIPTEN_KEEPALIVE
uint64_t om_variable_get_chunk_value(const OmVariable_t* variable, uint64_t index) {
    OmDimensions_t chunks = om_variable_get_chunks(variable);
    if (index >= chunks.count) return 0;
    return chunks.values[index];
}

EMSCRIPTEN_KEEPALIVE
uint16_t om_variable_get_name_count(const OmVariable_t* variable) {
    OmString_t name = om_variable_get_name(variable);
    return name.size;
}

EMSCRIPTEN_KEEPALIVE
const char* om_variable_get_name_ptr(const OmVariable_t* variable) {
    OmString_t name = om_variable_get_name(variable);
    return name.value;
}
