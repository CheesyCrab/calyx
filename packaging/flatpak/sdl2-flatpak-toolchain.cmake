# SDL 2.26.4's PipeWire backend is incompatible with the newer PipeWire
# headers in the Freedesktop 25.08 SDK. PulseAudio remains enabled and is the
# package's declared audio path.
set(SDL_PIPEWIRE OFF CACHE BOOL "Disable incompatible optional PipeWire backend" FORCE)
