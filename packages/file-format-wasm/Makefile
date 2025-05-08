# Define the compiler and flags
EMCC = emcc

EXPORTED_FUNCS = '[\
	"_om_header_size",\
	"_om_header_type",\
	"_om_trailer_size",\
	"_om_trailer_read",\
	"_om_variable_init",\
	"_om_variable_get_type",\
	"_om_variable_get_compression",\
	"_om_variable_get_scale_factor",\
	"_om_variable_get_add_offset",\
	"_om_variable_get_dimensions",\
	"_om_variable_get_children_count",\
	"_om_variable_get_children",\
	"_om_variable_get_scalar",\
	"_om_decoder_init",\
	"_om_decoder_init_index_read",\
	"_om_decoder_init_data_read",\
	"_om_decoder_read_buffer_size",\
	"_om_decoder_next_index_read",\
	"_om_decoder_next_data_read",\
	"_om_decoder_decode_chunks",\
	"_malloc",\
	"_free"\
]'

RUNTIME_METHODS = '[\
	"ccall",\
	"cwrap",\
	"setValue",\
	"getValue",\
	"HEAPU8"\
]'

INCLUDES = -I/src/C/include \
          -I/src/om-file-format/c/include

CFLAGS = $(INCLUDES) \
			-msimd128 \
			-mssse3 \
			-O3 \
			-s EXPORTED_FUNCTIONS=$(EXPORTED_FUNCS) \
			-s EXPORTED_RUNTIME_METHODS=$(RUNTIME_METHODS) \
			-s INITIAL_MEMORY=67108864 \
			-s WASM_BIGINT \
			-s FILESYSTEM=0 \
			-s ELIMINATE_DUPLICATE_FUNCTIONS=1 \
			-s MODULARIZE=1 \
			-s EXPORT_ES6=1 \
			-s EXPORT_NAME="OmFileFormat" \
			-Wbad-function-cast \
			-fwasm-exceptions

# Define the source files
SRC_FILES = $(wildcard /src/C/src/*.c) \
			$(wildcard /src/om-file-format/c/src/*.c)

OUT_DIR = dist
OUT_JS = $(OUT_DIR)/om_reader_wasm.js

# Default target
all: $(OUT_JS)

$(OUT_JS): $(SRC_FILES) Makefile
	mkdir -p $(OUT_DIR)
	$(EMCC) $(SRC_FILES) $(CFLAGS) -o $(OUT_JS)


# Clean target
clean:
	rm -rf $(OUT_DIR)/*
